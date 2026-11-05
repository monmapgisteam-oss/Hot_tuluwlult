import assert from "node:assert/strict";
import { test } from "node:test";
import { BREAKS, EXCLUSIONS, FACTORS, curveScore, evaluate, levelOf, meanLevel, verdictOf, surfaceOnly, effective, GROUP_DEFAULT } from "../lib/suit.ts";
import { SegIndex, chooseCell, chooseFineCell, flowAccumulation, inPoly, medianInCell, reliefAt, ringArea, slopeAspect, toPoly, tpiAt } from "../lib/server/grid.ts";
import { parseRings } from "../lib/server/prepare.ts";

/** n нүдтэй, бүх шалгуураар ижил утгатай бэлтгэл өгөгдөл */
function prepared(over = {}, n = 4) {
  const full = (v) => new Float64Array(n).fill(v);
  return {
    cell: 100, epsg: 32648, utmZone: 48, n, x: full(0), y: full(0), areaHa: n, centroid: [0, 0],
    zone: new Int32Array(n), zones: [{ aimag: "Төв", soum: "Баянжаргалан" }],
    num: { slope: full(2), aspect: full(180), elev: full(30), elevM: full(1400), tpi: full(0), flow: full(1), ...over.num },
    cat: { landcover: { dict: ["Өвслөг бэлчээр", "Байнгын ус"], idx: new Int32Array(n).fill(0) }, ...over.cat },
    sources: {}, warnings: [], ...over.rest,
  };
}
const demOnly = () => surfaceOnly().factors;

test("curveScore: шугаман интерполяц, хязгаараас гадна захын утга", () => {
  const c = [[0, 0.8], [0.5, 1], [3, 1], [8, 0.75]];
  assert.equal(curveScore(c, -5), 0.8);
  assert.equal(curveScore(c, 2), 1);
  assert.ok(Math.abs(curveScore(c, 5.5) - 0.875) < 1e-12);
  assert.equal(curveScore(c, 100), 0.75);
});

test("levelOf: тогтмол босгын зааг", () => {
  assert.equal(levelOf(0.34), 1);
  assert.equal(levelOf(0.35), 2);
  assert.equal(levelOf(0.5), 3);
  assert.equal(levelOf(0.65), 4);
  assert.equal(levelOf(0.8), 5);
  assert.deepEqual(BREAKS, [0.35, 0.5, 0.65, 0.8]);
});

test("мэдээлэлгүй шалгуурыг 0.5-аар нөхөхгүй, жингээс хасаж хамралтыг бууруулна", () => {
  const p = prepared();
  const factors = FACTORS.map((f) => (["slope", "road"].includes(f.key) ? f : { ...f, weight: 0 }));
  const r = evaluate(p, factors, [], "fixed");
  // road мэдээлэлгүй: оноо зөвхөн налуугаар (2% → 1.0), хамралт 5/(5+3)
  assert.equal(r.cells[0].score, 1);
  assert.equal(r.factorMean.road, null);
  assert.equal(r.factorCover.road, 0);
  assert.ok(Math.abs(r.coverage - 5 / 8) < 1e-12);
});

test("ямар ч мэдээлэлгүй нүд түвшинд орохгүй", () => {
  const r = evaluate(prepared({ num: { slope: new Float64Array(4).fill(NaN) } }), FACTORS.map((f) => (f.key === "slope" ? f : { ...f, weight: 0 })), [], "fixed");
  assert.deepEqual(r.areas, [0, 0, 0, 0, 0]);
  assert.equal(r.noDataHa, 4);
  assert.equal(verdictOf(r.areas), null);
});

test("нуур: хавтгай ч ус тул хоригт орж 1-р түвшин болно", () => {
  const p = prepared({ cat: { landcover: { dict: ["Байнгын ус"], idx: new Int32Array(4) } }, num: { slope: new Float64Array(4).fill(0.6) } });
  const { factors, excl, method } = surfaceOnly();
  const r = evaluate(p, factors, excl, method);
  assert.equal(r.areas[0], 4);
  assert.equal(r.excluded["Байнгын ус"], 4);
  assert.equal(verdictOf(r.areas).level.n, 1);
});

test("нуур дээр урсац их байсан ч хоригийн шалтгаан нь ус", () => {
  const p = prepared({ cat: { landcover: { dict: ["Байнгын ус"], idx: new Int32Array(4) } }, num: { flow: new Float64Array(4).fill(5000) } });
  const r = evaluate(p, demOnly(), EXCLUSIONS, "fixed");
  assert.deepEqual(r.excluded, { "Байнгын ус": 4 });
});

test("хориг идэвхгүй бол (унтраасан, хоосон утга) нөлөөлөхгүй", () => {
  const p = prepared({ num: { road: new Float64Array(4).fill(0) } });
  const off = EXCLUSIONS.map((e) => (e.key === "water" ? { ...e, value: 0 } : e));
  const r = evaluate(p, demOnly(), off, "fixed");
  assert.deepEqual(r.excluded, {});
});

test("харьцангуй ангилал полигон доторх хүрээг 5 хуваана", () => {
  const slope = Float64Array.from([2, 8, 15, 25]);
  const p = prepared({ num: { slope } });
  const f = FACTORS.map((v) => (v.key === "slope" ? v : { ...v, weight: 0 }));
  const r = evaluate(p, f, [], "relative");
  assert.equal(r.cells[0].level, 5);
  assert.equal(r.cells[3].level, 1);
});

test("effective: нийлбэр 1, бүлгийн хувийг баримтална", () => {
  const e = effective(FACTORS, GROUP_DEFAULT);
  assert.ok(Math.abs(e.reduce((s, f) => s + f.weight, 0) - 1) < 1e-9);
});

test("meanLevel: талбайгаар жигнэнэ", () => {
  assert.equal(meanLevel([0, 0, 0, 0, 10]), 5);
  assert.equal(meanLevel([5, 0, 0, 0, 5]), 3);
  assert.equal(meanLevel([0, 0, 0, 0, 0]), 0);
});

test("налуу: 1 м/10 м (10%) зүүн тийш уруудсан хавтгайд aspect = 90 (зүүн)", () => {
  const nx = 5, ny = 5, z = new Float64Array(25);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 100 - i; // x (зүүн) өсөхөд буурна
  const { slope, aspect } = slopeAspect(z, nx, ny, 10, 2, 2);
  assert.ok(Math.abs(slope - 10) < 1e-9);
  assert.ok(Math.abs(aspect - 90) < 1e-9);
});

test("TPI: хотгор сөрөг, тэгш 0", () => {
  const z = new Float64Array(49).fill(100);
  assert.equal(tpiAt(z, 7, 7, 3, 3, 3), 0);
  z[3 * 7 + 3] = 90;
  assert.equal(tpiAt(z, 7, 7, 3, 3, 3), -10);
});

test("урсац: V хөндийд голын шугамд хуримтлагдаж, хотгорыг дүүргэж цааш урсана", () => {
  const nx = 21, ny = 21, z = new Float64Array(nx * ny);
  // Хойш чиглэн буурах хөндий; голын шугам i = 10
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = Math.abs(i - 10) * 2 + (ny - j) * 0.5;
  const clean = flowAccumulation(z, nx, ny, 100);
  const mouth = clean[(ny - 1) * nx + 10];
  // Гурван тал руу хил рүү гарах ч хамгийн ихийг голын ам хураана
  assert.ok(mouth > 5, `ам ${mouth}`);
  assert.ok(clean[10 * nx + 10] > clean[10 * nx + 3]);
  // Голд жижиг хотгор: дүүргээгүй бол эндээс доош тасарна
  const pit = Float64Array.from(z);
  pit[10 * nx + 10] -= 5;
  const filled = flowAccumulation(pit, nx, ny, 100);
  assert.ok(Math.abs(filled[(ny - 1) * nx + 10] - mouth) < 1.5, `хотгорын дараах ам ${filled[(ny - 1) * nx + 10]} ~ ${mouth}`);
});

test("урсац: нүд бүр нэг удаа тоологдож, хавтгай ба NaN-д гацахгүй", () => {
  const nx = 30, ny = 30, z = new Float64Array(nx * ny).fill(10);
  z[100] = NaN;
  const acc = flowAccumulation(z, nx, ny, 100);
  assert.equal(Math.min(...acc), 1); // нүд бүр дор хаяж өөрийн 1 га
  assert.ok(Number.isFinite(acc.reduce((s, v) => s + v, 0)));
});

test("SegIndex.nearest: цэг, хэрчим хүртэлх зай, хоосон индекс", () => {
  const i = new SegIndex([[0, 0, 1000, 0], [5000, 5000, 5000, 5000]]);
  assert.equal(i.nearest(500, 300), 300);
  assert.equal(Math.round(i.nearest(5000, 4000)), 1000);
  assert.equal(new SegIndex([]).nearest(0, 0), Infinity);
  assert.equal(i.nearest(90000, 90000, 2000), Infinity); // радиус дотор олдоогүй
});

test("inPoly: нүхтэй полигон (even-odd), ringArea", () => {
  const p = toPoly([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]);
  assert.equal(inPoly(1, 1, p), true);
  assert.equal(inPoly(5, 5, p), false);
  assert.equal(inPoly(11, 5, p), false);
  assert.equal(ringArea(p.rings[0]), 100);
});

test("chooseCell: хязгаарт багтсан хамгийн нарийн нүд", () => {
  assert.equal(chooseCell(1e6, 1000, 1000), 30);
  const big = chooseCell(5e9, 1e5, 1e5);
  assert.ok(5e9 / (big * big) <= 25000);
  assert.ok(chooseCell(1e6, 1000, 1000, 200) >= 200);
});

test("chooseFineCell: 100 м хүртэл нүдээрээ, том нүдэд нарийн тор, хязгаарт багтана", () => {
  assert.equal(chooseFineCell(30, 1000, 1000), 30);
  assert.equal(chooseFineCell(100, 1000, 1000), 100);
  assert.equal(chooseFineCell(500, 60000, 60000), 100);
  const f = chooseFineCell(1500, 240000, 190000);
  assert.ok(f > 100 && f < 1500, `нарийн тор ${f}`);
  const pad = 30000;
  assert.ok(((240000 + 2 * pad) / f) * ((190000 + 2 * pad) / f) <= 1_200_000);
});

test("medianInCell: нүдийг дайрах ганц суваг нүдийг хоригт оруулахгүй, NaN-ийг үл тооно", () => {
  // 100 м тор, 500 м нүд: 5×5 нарийн нүдний нэг багана нь том урсацтай
  const nx = 5, ny = 5, v = new Float64Array(25).fill(5);
  for (let j = 0; j < ny; j++) v[j * nx + 2] = 5000;
  assert.equal(medianInCell(v, nx, ny, 0, 0, 100, 250, 250, 500), 5);
  v.fill(NaN);
  assert.ok(Number.isNaN(medianInCell(v, nx, ny, 0, 0, 100, 250, 250, 500)));
  v[12] = 7;
  assert.equal(medianInCell(v, nx, ny, 0, 0, 100, 250, 250, 500), 7);
});

test("reliefAt: цонх доторх өндрийн зөрүү, том цонхонд ч толгойг олно, NaN-ийг үл тооно", () => {
  const nx = 81, ny = 81, z = new Float64Array(nx * ny).fill(1000);
  assert.equal(reliefAt(z, nx, ny, 40, 40, 3), 0);
  for (let j = 30; j < 50; j++) for (let i = 30; i < 50; i++) z[j * nx + i] = 1200;
  assert.equal(reliefAt(z, nx, ny, 25, 40, 40), 200);
  z[0] = NaN;
  assert.equal(reliefAt(z, nx, ny, 25, 40, 40), 200);
  assert.ok(Number.isNaN(reliefAt(new Float64Array(9).fill(NaN), 3, 3, 1, 1, 1)));
});

test("parseRings: буруу оролтыг татгалзана", () => {
  assert.throws(() => parseRings(null));
  assert.throws(() => parseRings([[[0, 0], [1, 1]]]));
  assert.throws(() => parseRings([[[0, 0], [1, 1], [999, 1], [0, 0]]]));
  assert.throws(() => parseRings([[["a", 0], [1, 1], [1, 0], [0, 0]]]));
  assert.equal(parseRings([[[100, 46], [101, 46], [101, 47], [100, 46]]]).length, 1);
});
