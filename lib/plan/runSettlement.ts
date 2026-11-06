// Зурсан полигон дээр суурьшил төлөвлөнө: тохиромж (гадаргын хэлбэр) → runPlan (Бөөрөлжүүтийн components/sections/UrbanPlan.tsx-ийн урсгал).
import proj4 from "proj4";
import { evaluate, surfaceOnly, type Prepared } from "../suit";
import { area, bufPath, bufPoly, diff, inter, labelPt, parts, setPlanWkid, unionAll, type Path, type Rings, type XY } from "./geom";
import { program } from "./layout";
import { DEFAULT, runPlan, type Inputs, type Plan } from "./urban";
import { GER_HOUSEHOLD_SIZE, GER_PARCEL_AREA } from "./gerConfig";

export const MAX_PLAN_KM2 = 500;
/** ТААМАГЛАЛ: тохиромжгүй хэсгийн хамгийн бага зураглалын нэгж (хоригоос бусад) — эх кодтой ижил */
const MMU_HA = 0.5;

export type PlanInputs = Pick<Inputs, "pop" | "floorsRes" | "mode" | "maxSlope" | "water" | "heatWm2" | "elecKwHh"> & { siteHa: number | ""; riverM: number };
export const PLAN_DEFAULT: PlanInputs = {
  pop: DEFAULT.pop, floorsRes: DEFAULT.floorsRes, mode: DEFAULT.mode, maxSlope: 10,
  water: DEFAULT.water, heatWm2: DEFAULT.heatWm2, elecKwHh: DEFAULT.elecKwHh, siteHa: "", riverM: 500,
};

/** Сонгосон нүдийг мөр бүрээр дараалсан тэгш өнцөгт болгоно — union-ийг хурдасгана (urbanSuit.ts cellRects) */
function cellRects(p: Prepared, pick: (i: number) => boolean): Rings[] {
  const rows = new Map<number, number[]>();
  for (let i = 0; i < p.n; i++) if (pick(i)) {
    const j = Math.round(p.y[i] / p.cell);
    (rows.get(j) ?? rows.set(j, []).get(j)!).push(i);
  }
  const out: Rings[] = [], h = p.cell / 2;
  for (const list of rows.values()) {
    list.sort((a, b) => p.x[a] - p.x[b]);
    for (let s = 0; s < list.length;) {
      let e = s;
      while (e + 1 < list.length && p.x[list[e + 1]] - p.x[list[e]] < p.cell * 1.5) e++;
      const x0 = p.x[list[s]] - h, x1 = p.x[list[e]] + h, y0 = p.y[list[s]] - h, y1 = p.y[list[s]] + h;
      out.push([[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]);
      s = e + 1;
    }
  }
  return out;
}

/** ТААМАГЛАЛ: ±1 км-т өндрийн зөрүү үүнээс их бол уул, толгод гэж үзэж төлөвлөхгүй */
const MOUNTAIN_RELIEF_M = 150;
/** ТААМАГЛАЛ: ус хураах талбай үүнээс их шугамыг газрын зурагт тэмдэглэгдээгүй гол, том сайр гэж үзнэ */
const RIVER_FLOW_HA = 2000;
const DRAINAGE_SETBACK_M = 200;
/** Үүнээс бага тохиромжтой талбайд суурин төлөвлөхгүй */
const MIN_SITE_HA = 2;

/** Уул, ой, гол, усны ойролцоохыг хасаж, гадаргын хэлбэрээр тохиромжтой (4–5 түвшин) талбайг гаргана */
export function suitableArea(p: Prepared, zone: Rings, riverM: number) {
  const { factors, excl, method } = surfaceOnly();
  const res = evaluate(p, factors, excl, method);
  const all = cellRects(p, (i) => res.cells[i].level > 0);
  if (!all.length) throw new Error("Полигонд үнэлэгдсэн нүд олдсонгүй.");
  const lc = p.cat.landcover;
  const hardBad = (i: number) => {
    if (res.cells[i].why) return true;
    if (p.num.relief?.[i] > MOUNTAIN_RELIEF_M) return true;
    return !!lc && lc.idx[i] >= 0 && lc.dict[lc.idx[i]] === "Мод бүрхэвч";
  };
  // Оноо бага боловч хориггүй жижиг хэсэг нүх гаргахгүй — газар шорооны ажлаар шийдэгдэнэ; хориг хэмжээнээс үл хамааран үлдэнэ
  const lowScore = parts(unionAll(cellRects(p, (i) => !hardBad(i) && res.cells[i].level > 0 && res.cells[i].level < 4))).filter((r) => area(r) >= MMU_HA * 1e4);
  const low: Rings[] = [...lowScore, ...cellRects(p, hardBad)];
  const big = cellRects(p, (i) => p.num.flow?.[i] > RIVER_FLOW_HA);
  if (big.length) low.push(bufPoly(unionAll(big), DRAINAGE_SETBACK_M));
  if (riverM > 0 && p.rivers?.length) low.push(bufPath(p.rivers as Path[], riverM));
  // ТХГН, нуур, газар тариалан: нүдээр биш яг хилээр нь хасна — нүднээс жижиг талбар ч үлдэхгүй
  if (p.noBuild?.length) low.push(...(p.noBuild as Rings[]));
  const lowU = unionAll(low);
  const bad = lowU.length ? unionAll([inter(lowU, zone), inter(diff(zone, unionAll(all)), bufPoly(lowU, p.cell * 0.75))]) : [];
  const raw = diff(zone, bad);
  const smooth = !bad.length ? zone : raw.length ? inter(bufPoly(bufPoly(raw, p.cell * 0.3), -p.cell * 0.3), zone) : [];
  // Тэгшлэлт нүднээс жижиг нүхийг бөглөдөг тул албан ёсны хилийг дахин хасна
  return p.noBuild?.length ? diff(smooth, unionAll(p.noBuild as Rings[])) : smooth;
}

export async function planSettlement(o: { rings: XY[][]; prep: Prepared; inputs: PlanInputs; onStep: (s: string) => void }): Promise<Plan> {
  const { prep, inputs, onStep } = o;
  if (prep.areaHa > MAX_PLAN_KM2 * 100) throw new Error(`Төлөвлөлтөд полигон хэт том байна (${Math.round(prep.areaHa / 100)} км²). ${MAX_PLAN_KM2} км²-ээс бага полигон зурна уу.`);
  setPlanWkid(prep.epsg);
  const tr = proj4(`+proj=utm +zone=${prep.utmZone}${prep.epsg >= 32700 ? " +south" : ""} +datum=WGS84 +units=m +no_defs`);
  const zone: Rings = o.rings.map((r) => r.map((p) => tr.forward(p) as XY));

  onStep("Уул, гол, ойг хасаж тохиромжтой талбайг ялгаж байна…");
  await new Promise((ok) => setTimeout(ok, 0));
  const usable = suitableArea(prep, zone, Number(inputs.riverM) || 0);
  const pieces = usable.length ? parts(usable).map((r) => ({ r, a: area(r), c: labelPt(r) })).filter((v) => v.a >= MIN_SITE_HA * 1e4) : [];
  if (!pieces.length) throw new Error("Энэ полигонд уул, гол, ойгоос зайтай тохиромжтой талбай олдсонгүй. Сум, аймгийн төвийн ойролцоох тэгш газар зурна уу.");

  // Өндрийн торыг полигоны хэмжээнд тааруулна: төлөвлөгчийн нүд бүрийн тооцоо Worker дээр явагдана
  const xs = zone.flat().map((p) => p[0]), ys = zone.flat().map((p) => p[1]);
  const boxM2 = (Math.max(...xs) - Math.min(...xs) + 1000) * (Math.max(...ys) - Math.min(...ys) + 1000);
  // Урт нарийн полигонд хүрээ нь том тул /api/dem-ийн 1 сая цэгийн хязгаарт багтаана
  const demCell = Math.max(DEFAULT.demCell, Math.ceil(Math.sqrt((prep.areaHa * 1e4) / 80000) / 10) * 10, Math.ceil(Math.sqrt(boxM2 / 900000) / 10) * 10);
  let inp: Inputs = { ...DEFAULT, ...inputs, demCell };
  if (inp.mode === "ger") inp = { ...inp, hhSize: GER_HOUSEHOLD_SIZE, resShare: 70, pubShare: 10, greenShare: 18, engShare: 2 };
  const notes: string[] = [];
  const gaps = surfaceOnly().excl.filter((e) => e.mask && !prep.num[e.key]).map((e) => e.label);
  if (gaps.length) notes.push(`${gaps.join(", ")}: давхарга татагдсангүй, энэ төлөвлөгөөнөөс хасагдаагүй. Дахин төлөвлөнө үү.`);
  const anchor: XY | null = prep.anchor ? [prep.anchor.x, prep.anchor.y] : null;
  if (prep.anchor) {
    notes.push(`Хамгийн ойрын төв: ${prep.anchor.name} (${prep.anchor.km} км). Төлөвлөлтийг түүн рүү чиглүүлэв.`);
    if (prep.anchor.km > 30) notes.push("Сум, аймгийн төвөөс хол байна: дэд бүтцийн зардал их. Төвийн ойролцоо зурвал илүү тохиромжтой.");
  }

  // Тасархай хэсгүүдийг нийлүүлэхгүй: хэрэгцээт хэмжээтэй хамгийн ойр хэсэг, эс бөгөөс хамгийн том хэсэг
  const need = typeof inp.siteHa === "number" && inp.siteHa > 0 ? inp.siteHa * 1e4 : program(inp, 1).site;
  const dist0 = (c: XY) => (anchor ? Math.hypot(c[0] - anchor[0], c[1] - anchor[1]) : 0);
  const fit = pieces.filter((v) => v.a >= need).sort((a, b) => dist0(a.c) - dist0(b.c))[0];
  const chosen = fit ?? [...pieces].sort((a, b) => b.a - a.a)[0];
  if (!fit) {
    // Тохиромжтой талбай бага: хүн амыг багтах хэмжээнд багасгаж жижиг суурин төлөвлөнө
    const share = (chosen.a * 0.9) / need;
    const pop = inp.mode === "ger"
      ? Math.max(1, Math.floor(inp.pop * share / inp.hhSize)) * inp.hhSize
      : Math.max(100, Math.floor((inp.pop * share) / 100) * 100);
    notes.push(`Тохиромжтой талбай бага (${Math.round(chosen.a / 1e4)} га) тул хүн амыг ${inp.pop.toLocaleString("en-US")}-оос ${pop.toLocaleString("en-US")} болгож багасгав.`);
    inp = { ...inp, pop, siteHa: "" };
  }
  const roads = (prep.roads ?? []) as Path[];
  const plan = await runPlan(zone, inp, { plant: anchor, sanitary: [], suitable: chosen.r, roads }, onStep);
  if (plan.ger) notes.push(`Гэр хороолол: ${plan.ger.parcels.length} хашаа, тус бүр ${GER_PARCEL_AREA.toLocaleString("en-US")} м² (0.7 га). Нэг хашаа = нэг өрх; өрх бүрийг ${GER_HOUSEHOLD_SIZE} хүнээр тооцов.`);
  if (!plan.ger && (plan.inp.arterialW < inp.arterialW || plan.inp.windbreak < inp.windbreak)) {
    const fmt = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 1 });
    notes.push(`${fmt(plan.siteArea / 1e4)} га талбайн хэмжээнд тохируулж гол гудамжийг ${fmt(plan.inp.arterialW)} м, салхины хамгаалалтын ногоон зурвасыг ${fmt(plan.inp.windbreak)} м өргөнөөр төлөвлөв.`);
  }
  if (plan.t.pop < inp.pop * 0.95) {
    notes.push(`Төлөвлөсөн барилгуудын багтаамж ${Math.round(plan.t.pop).toLocaleString("en-US")} хүн; ${inp.pop.toLocaleString("en-US")} хүний зорилтоос бага байна.`);
  }
  return { ...plan, notes, wkid: prep.epsg };
}
