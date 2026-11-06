import assert from "node:assert/strict";
import { test } from "node:test";
import { maskCells, toPoly } from "../lib/server/grid.ts";
import { EXCLUSIONS, FACTORS, evaluate, surfaceOnly } from "../lib/suit.ts";

const square = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];

test("maskCells: нүдний төв полигон дотор бол 1, торын гадна талын полигон алдаа гаргахгүй", () => {
  // 4×1 тор, 10 м нүд; 3-р нүд полигонд ороогүй (-1)
  const cellOf = Int32Array.from([0, 1, -1, 2]);
  const g = { x0: 0, y0: 0, cell: 10, nx: 4, ny: 1 };
  assert.deepEqual([...maskCells([toPoly(square(0, 0, 14, 10))], g, cellOf, 3)], [1, 0, 0]);
  assert.deepEqual([...maskCells([toPoly(square(21, 0, 40, 10))], g, cellOf, 3)], [0, 0, 1]);
  assert.deepEqual([...maskCells([toPoly(square(1000, 1000, 1010, 1010))], g, cellOf, 3)], [0, 0, 0]);
  assert.deepEqual([...maskCells([], g, cellOf, 3)], [0, 0, 0]);
});

test("maskCells: нүхтэй полигон — нүхэн дэх нүд чөлөөтэй", () => {
  const cellOf = Int32Array.from([0, 1, 2]);
  const donut = toPoly([...square(0, 0, 30, 10), ...square(10, 0, 20, 10)]);
  assert.deepEqual([...maskCells([donut], { x0: 0, y0: 0, cell: 10, nx: 3, ny: 1 }, cellOf, 3)], [1, 0, 1]);
});

/** Зөвхөн налуугаар оноолсон жижиг бэлтгэл өгөгдөл */
const prep = (num) => {
  const n = num.slope.length;
  return {
    cell: 100, epsg: 32648, utmZone: 48, n, x: Array.from({ length: n }, (_, i) => i * 100), y: new Array(n).fill(0), areaHa: n, centroid: [100, 47],
    zone: new Array(n).fill(-1), zones: [], num, cat: {}, sources: {}, warnings: [],
  };
};
const slopeOnly = FACTORS.filter((f) => f.key === "slope").map((f) => ({ ...f, weight: 1 }));

test("хориг: ТХГН, нуур, газар тариалан дотор 1-р түвшин, хил нь шалтгаанаар гарна", () => {
  const p = prep({ slope: [1, 1, 1, 1], protected: [1, 0, 0, 0], lake: [0, 1, 0, 0], cropland: [0, 0, 1, 0] });
  const r = evaluate(p, slopeOnly, EXCLUSIONS, "fixed");
  assert.deepEqual(r.cells.map((c) => c.why), ["Тусгай хамгаалалттай газар", "Нуур", "Газар тариалан", ""]);
  assert.deepEqual(r.cells.slice(0, 3).map((c) => c.level), [1, 1, 1]);
  assert.ok(r.cells[3].level > 1);
});

test("хориг: налуу ТХГН-ийн шалтгаан нь хамгаалалт хэвээр", () => {
  const r = evaluate(prep({ slope: [90], protected: [1] }), slopeOnly, EXCLUSIONS, "fixed");
  assert.equal(r.cells[0].why, "Тусгай хамгаалалттай газар");
});

test("хориг: голоос 500 м дотор хасна, цаашаа үгүй", () => {
  const r = evaluate(prep({ slope: [1, 1, 1], river: [100, 499, 500] }), slopeOnly, EXCLUSIONS, "fixed");
  assert.deepEqual(r.cells.map((c) => c.why), ["Голоос < 500 м", "Голоос < 500 м", ""]);
});

test("хориг: давхарга татагдаагүй (num байхгүй) бол нүдийг буруу хасахгүй", () => {
  const r = evaluate(prep({ slope: [1, 1] }), slopeOnly, EXCLUSIONS, "fixed");
  assert.deepEqual(r.cells.map((c) => c.why), ["", ""]);
});

test("surfaceOnly: төлөвлөгч ТХГН, нуур, газар тариаланг хасна; голын зайг өөрийн тохиргоогоор", () => {
  const keys = surfaceOnly().excl.map((e) => e.key);
  for (const k of ["protected", "lake", "cropland"]) assert.ok(keys.includes(k), k);
  assert.ok(!keys.includes("river"));
});
