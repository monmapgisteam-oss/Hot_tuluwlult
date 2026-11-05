// Тохиромжийн цөм: шалгуур, оноо, ангилал. I:\Booroljuut\web\lib\urbanSuit.ts-ээс зөөв.
// Өөрчлөлт: (1) цахилгаан станцын шалгуур хасагдсан — зөвхөн Бөөрөлжүүтэд хамаатай;
// (2) ESA WorldCover нэмэгдсэн — улсын хэмжээний газрын бүрхэвч, ус/намгийн хориг;
// (3) мэдээлэлгүй шалгуурыг 0.5 оноогоор нөхөхгүй, жингээс хасаж хамралтыг тайлагнана.
// ТААМАГЛАЛ: оноо, босго, жин бүгд концепт шатны санал — мэргэжилтний үнэлгээ, БНбД-ээр ШАЛГАХ.

export type FGroup = "dem" | "env" | "infra";
export const FACTOR_GROUPS: { key: FGroup; title: string }[] = [
  { key: "dem", title: "Гадаргын хэлбэр (DEM)" },
  { key: "env", title: "Байгаль орчин" },
  { key: "infra", title: "Дэд бүтэц" },
];

/** [утга, оноо 0–1] цэгүүд — хооронд нь шугаман интерполяц */
export type Curve = [number, number][];

export type Factor = {
  key: string; label: string; group: FGroup; weight: number; hint: string;
  kind: "curve" | "aspect" | "cat";
  unit?: string; curve?: Curve;
  layer?: number; field?: string; cats?: Record<string, number>; names?: Record<string, string>;
};

// Тохиромжийн 5 түвшин (1 = тохиромжгүй … 5 = маш тохиромжтой)
export const LEVELS = [
  { n: 1, label: "Тохиромжгүй", color: "#d73027" },
  { n: 2, label: "Тохиромж муу", color: "#fc8d59" },
  { n: 3, label: "Дунд зэрэг", color: "#fee08b" },
  { n: 4, label: "Тохиромжтой", color: "#91cf60" },
  { n: 5, label: "Маш тохиромжтой", color: "#1a9850" },
];
/** Тогтмол босго: 2, 3, 4, 5-р түвшний доод оноо — ТААМАГЛАЛ */
export const BREAKS = [0.35, 0.5, 0.65, 0.8];
/** fixed — BREAKS (газар хооронд харьцуулах боломжтой); relative — полигон доторх min–max-ийг 5 тэнцүү хуваана */
export type ClassMethod = "relative" | "fixed";
export const levelOf = (s: number, breaks = BREAKS) => 1 + breaks.filter((b) => s >= b).length;

// ESA WorldCover 2021 v200 ангилал
export const LANDCOVER: Record<number, string> = {
  10: "Мод бүрхэвч", 20: "Бут сөөг", 30: "Өвслөг бэлчээр", 40: "Тариалангийн газар", 50: "Барилгажсан газар",
  60: "Нүцгэн, сийрэг ургамалтай", 70: "Цас, мөс", 80: "Байнгын ус", 90: "Намгархаг өвслөг", 95: "Мангр", 100: "Хөвд, хаг",
};

export const FACTORS: Factor[] = [
  // ---------- DEM ----------
  { key: "slope", label: "Налуу", group: "dem", kind: "curve", unit: "%", weight: 5,
    curve: [[0, 0.8], [0.5, 1], [3, 1], [8, 0.75], [15, 0.45], [25, 0.1], [35, 0]],
    hint: "0.5–3% налуу барилгажилт, ус зайлуулалтад хамгийн тохиромжтой; 0.5%-иас бага бол гадаргын ус тогтоно. БНбД-ийн заалтыг ШАЛГАХ." },
  { key: "aspect", label: "Налуугийн зүг (aspect)", group: "dem", kind: "aspect", unit: "°", weight: 2,
    hint: "Хүйтэн уур амьсгалд урд зүгт харсан налуу нарны дулаан, гэрэл их авна. 2%-иас бага налуутай хавтгай газарт зүг хамаагүй." },
  { key: "elev", label: "Харьцангуй өндөршил", group: "dem", kind: "curve", unit: "%", weight: 1,
    curve: [[0, 0.8], [25, 1], [70, 0.85], [100, 0.55]],
    hint: "Полигоны хамгийн нам (0%) – хамгийн өндөр (100%) цэгтэй харьцуулсан байрлал. Хэт нам газарт хүйтэн агаар тогтох, өндөрлөг нь салхинд ил." },
  { key: "tpi", label: "Гадаргын байрлал (TPI)", group: "dem", kind: "curve", unit: "м", weight: 2,
    curve: [[-15, 0.15], [-6, 0.55], [-2, 1], [2, 1], [6, 0.75], [15, 0.45]],
    hint: "Нүдний өндрийг ±300 м (том нүдэнд ±3 нүд) орчны дундажтай харьцуулна: сөрөг — хотгор, хөндий; эерэг — оргил, нуруу." },
  { key: "flow", label: "Урсацын хуримтлал", group: "dem", kind: "curve", unit: "га", weight: 3,
    curve: [[0, 1], [20, 1], [100, 0.5], [500, 0.1], [2000, 0]],
    hint: "D8 аргаар тооцсон дээд талын ус хураах талбай. Их утгатай нүд — сайр, гуу жалгын шугам. Тооцооны хүрээнээс гадуурх сав газрыг тооцоогүй." },

  // ---------- Байгаль орчин ----------
  { key: "landcover", label: "Газрын бүрхэвч", group: "env", kind: "cat", weight: 3,
    cats: { "Мод бүрхэвч": 0.3, "Бут сөөг": 0.8, "Өвслөг бэлчээр": 0.9, "Тариалангийн газар": 0.7, "Барилгажсан газар": 1,
      "Нүцгэн, сийрэг ургамалтай": 0.9, "Цас, мөс": 0, "Байнгын ус": 0, "Намгархаг өвслөг": 0.1, "Хөвд, хаг": 0.4 },
    hint: "ESA WorldCover 2021 (10 м, улсын хэмжээнд). Онооны утга нь Бөөрөлжүүтийн газрын ангилалд дүйцүүлсэн ТААМАГЛАЛ." },
  { key: "land_class", label: "Газрын ангилал", group: "env", kind: "cat", layer: 35, field: "classmon", weight: 3,
    cats: { "Бусад газар": 1, "Хөдөө аж ахуйн газар": 0.7, "Ойн сан бүхий газар": 0.3 },
    hint: "Ерөнхий давхарга — Бөөрөлжүүт орчмоор хязгаарлагдана. Газрын кадастрын мэдээллээр ШАЛГАХ." },
  { key: "phenomenon_zone", label: "Үзэгдлийн бүс", group: "env", kind: "cat", layer: 34, field: "type_name", weight: 1,
    cats: {
      "Олон жилийн цэвдэг чулуулаг ховор алаг цоог тархалттай бүслүүр": 0.8,
      "Олон жилийн цэвдэг чулуулаг тохиолдлын тархалттай бүслүүр": 0.5,
    },
    names: {
      "Олон жилийн цэвдэг чулуулаг ховор алаг цоог тархалттай бүслүүр": "Цэвдэг ховор, алаг цоог",
      "Олон жилийн цэвдэг чулуулаг тохиолдлын тархалттай бүслүүр": "Цэвдэг тохиолдлын тархалттай",
    },
    hint: "Олон жилийн цэвдэг чулуулаг суурийн суулт, хөөлт үүсгэнэ — тархалт их байх тусам оноо бага." },
  { key: "soil_group", label: "Хөрсний бүлэг", group: "env", kind: "cat", layer: 33, field: "groupmon", weight: 1,
    cats: { "Тал газар, хөндий хотгорын хөрс": 1, "Уулын хөрс": 0.6, "Чийгт гаралын хөрс": 0.2 },
    hint: "Чийгт гаралын хөрс — гүний ус ойр, даац сул. Уулын хөрс нимгэн, чулуурхаг (газар шорооны ажил хүнд)." },
  { key: "soil_code", label: "Хөрсний төрөл", group: "env", kind: "cat", layer: 28, field: "codemon", weight: 2,
    cats: {
      "Ердийн хархүрэн ба дутуу хөгжилтэй хархүрэн хөрс": 1,
      "Үлдмэл нугархаг хархүрэн ба карбонатгүй хархүрэн хөрс": 0.8,
      "Уулын ердийн хархүрэн ба нимгэн хархүрэн хөрс": 0.6,
      "Уулын нимгэн хархүрэн ба ердийн хархүрэн хөрс": 0.5,
      "Нугат-хүрэн ба нугын хужирлаг хөрс": 0.3,
      "Нугын хужирлаг ба хужир-мараат хам хөрс": 0.1,
    },
    hint: "Хужирлаг, хужир-мараат хөрс барилгын суурь, шугам хоолойг идэмхийлж, чийг ихтэй. Инженер-геологийн судалгаагаар ШАЛГАХ." },
  { key: "permafrost_2016", label: "Цэвдэг (2016)", group: "env", kind: "cat", layer: 32, field: "type_name", weight: 2,
    cats: { "Улирлын хөлдөлтийн бүс": 1, "Тохиолдлын тархалттай бүслүүр": 0.5 },
    hint: "Улирлын хөлдөлттэй газар цэвдэгтэй харьцуулахад суурь барихад эрсдэл бага." },
  { key: "veg_class", label: "Ургамлын анги", group: "env", kind: "cat", layer: 31, field: "classmon", weight: 1,
    cats: { "Бэлчээр биш": 0.9, "Хээрийн ба хуурай хээр": 0.8, "Уулын ойт хээр": 0.3 },
    hint: "Уулын ойт хээр экологийн өндөр ач холбогдолтой — хамгаалах." },
  { key: "veg_group", label: "Ургамлын бүлэг", group: "env", kind: "cat", layer: 30, field: "groupmon", weight: 1,
    cats: { "Бэлчээр биш": 0.9, "Тэгш талын хээр ба хуурай хээр": 0.85, "Уулын хээрийн нуга": 0.4, "Нам дор газрын марзлаг хээр": 0.3 },
    hint: "Нам дор газрын марзлаг хээр — чийглэг, хужирлаг хотгор; уулын нуга — экологийн мэдрэг." },
  { key: "landscape", label: "Ландшафт", group: "env", kind: "cat", layer: 29, field: "descriptio", weight: 1,
    cats: {
      "northern dry-steppe of Bayanjargalan": 0.9,
      "northern dry-steppe and steppe of Bayandelger": 0.85,
      "northern dry-steppe and meadow of the upper Kherlen river": 0.5,
      "northern dry-steppe, southern dry-steppe and solonetz-solonchak of the southern Sergelen": 0.4,
    },
    names: {
      "northern dry-steppe of Bayanjargalan": "Баянжаргалангийн хойд хуурай хээр",
      "northern dry-steppe and steppe of Bayandelger": "Баяндэлгэрийн хойд хуурай хээр ба хээр",
      "northern dry-steppe and meadow of the upper Kherlen river": "Хэрлэнгийн эхийн хуурай хээр ба нуга",
      "northern dry-steppe, southern dry-steppe and solonetz-solonchak of the southern Sergelen":
        "Сэргэлэнгийн урд хэсгийн хуурай хээр, хужирлаг-мараат",
    },
    hint: "Нуга — гүний ус ойр; хужирлаг-мараат ландшафт — хөрс идэмхий." },

  // ---------- Дэд бүтэц (зай, м) ----------
  { key: "road", label: "Авто зам хүртэл", group: "infra", kind: "curve", unit: "м", weight: 3,
    curve: [[0, 0.3], [50, 1], [1000, 1], [3000, 0.6], [8000, 0.2], [15000, 0]],
    hint: "Хучилттай авто зам хүртэлх зай: ойр байх тусам холболт хямд; 50 м-ээс ойр дуу чимээ, аюулгүй байдал." },
  { key: "rail", label: "Төмөр зам хүртэл", group: "infra", kind: "curve", unit: "м", weight: 2,
    curve: [[0, 0], [100, 0.3], [500, 1], [3000, 1], [10000, 0.4]],
    hint: "Логистикт ойр байх ач холбогдолтой, харин 500 м-ээс ойр дуу чимээ, чичиргээ." },
  { key: "tl", label: "Цахилгааны шугам хүртэл", group: "infra", kind: "curve", unit: "м", weight: 2,
    curve: [[0, 0], [50, 0.4], [150, 1], [3000, 1], [10000, 0.5]],
    hint: "Холболтод ойр байх нь давуу; шугамын доор, хамгаалалтын зурвас дотор барилга барихгүй." },
  { key: "soum_center", label: "Сум, аймгийн төв хүртэл", group: "infra", kind: "curve", unit: "м", weight: 1,
    curve: [[0, 1], [10000, 1], [30000, 0.4], [60000, 0.1]],
    hint: "Нийгмийн үйлчилгээ (сургууль, эмнэлэг) рүү хүрэх боломж. Эх сурвалж: EIC." },
];

export type Flag = "ТААМАГЛАЛ" | "ШАЛГАХ";
export type Exclusion = {
  key: string; label: string; unit?: string; value: number | ""; flag: Flag; hint: string; toggle?: boolean;
  /** Газрын бүрхэвчийн ангиллаар хориглох бол тухайн ангилал */
  landcover?: string;
};

// Хориглох нөхцөл — хангасан нүд шууд 1-р түвшин (Тохиромжгүй). Хоосон = идэвхгүй.
export const EXCLUSIONS: Exclusion[] = [
  { key: "slope", label: "Налуу >", unit: "%", value: 25, flag: "ТААМАГЛАЛ", hint: "25%-иас их налууд барилгажилт, зам хэт өртөгтэй." },
  { key: "flow", label: "Урсацын хуримтлал >", unit: "га", value: 500, flag: "ТААМАГЛАЛ", hint: "Сайр, гуу жалгын гол шугам — үерийн эрсдэл." },
  { key: "tl", label: "Цахилгааны шугамаас <", unit: "м", value: 40, flag: "ШАЛГАХ", hint: "220 кВ шугамын хамгаалалтын зурвасын өргөн — норм ШАЛГАХ." },
  { key: "rail", label: "Төмөр замаас <", unit: "м", value: 50, flag: "ШАЛГАХ", hint: "Төмөр замын зурвасын өргөн — норм ШАЛГАХ." },
  { key: "road", label: "Авто замаас <", unit: "м", value: "", flag: "ШАЛГАХ", hint: "Замын хамгаалалтын зурвас — норм ШАЛГАХ." },
  { key: "water", label: "Байнгын ус", value: 1, toggle: true, landcover: "Байнгын ус", flag: "ТААМАГЛАЛ", hint: "Нуур, гол: DEM дээр хавтгай харагддаг тул хориггүй бол өндөр оноо авна." },
  { key: "wetland", label: "Намгархаг газар", value: 1, toggle: true, landcover: "Намгархаг өвслөг", flag: "ТААМАГЛАЛ", hint: "Гүний ус ойр, суурийн даац сул." },
  { key: "snow", label: "Цас, мөс", value: 1, toggle: true, landcover: "Цас, мөс", flag: "ТААМАГЛАЛ", hint: "Мөнх цас, мөсөн гол." },
  { key: "forest", label: "Мод бүрхэвч", value: 0, toggle: true, landcover: "Мод бүрхэвч", flag: "ШАЛГАХ", hint: "Ойн тухай хуулиар хамгаалалттай байж болно. WorldCover нь ойн сангийн хил биш тул анхдагчаар унтраасан — кадастраар ШАЛГАХ." },
];

/** Зөвхөн гадаргын хэлбэрийн шалгуур — Бөөрөлжүүтийн Б01 суурьшлын загварын шүүлтүүр (urbanSuit.ts surfaceOnly).
 *  Жалганы хориг нь 1 м DSM шаарддаг тул хасагдсан; ус, намаг, цасны хориг нэмэгдсэн. */
export const surfaceOnly = () => ({
  factors: FACTORS.map((f) => (f.group === "dem" ? f : { ...f, weight: 0 })),
  excl: EXCLUSIONS.filter((e) => e.key === "slope" || e.key === "flow" || e.key === "water" || e.key === "wetland" || e.key === "snow"),
  method: "fixed" as ClassMethod,
});

// ---------- Оноо ----------
export function curveScore(c: Curve, v: number) {
  if (!isFinite(v)) return 0.5;
  if (v <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    const [x1, y1] = c[i - 1], [x2, y2] = c[i];
    if (v <= x2) return y1 + ((y2 - y1) * (v - x1)) / (x2 - x1 || 1);
  }
  return c[c.length - 1][1];
}

// 8 зүг: [нэр, оноо]
const ASPECT_DIRS: [string, number][] = [
  ["Хойд", 0.3], ["Зүүн хойд", 0.45], ["Зүүн", 0.65], ["Зүүн урд", 0.85],
  ["Урд", 1], ["Баруун урд", 0.85], ["Баруун", 0.65], ["Баруун хойд", 0.45],
];
export const FLAT_SLOPE = 2; // %
export const aspectDir = (a: number) => ASPECT_DIRS[Math.round((((a % 360) + 360) % 360) / 45) % 8];
export const catName = (f: Factor, v: string) => f.names?.[v] ?? v;

/** Бүлгийн анхны жин (%) — шалгууруудын анхны жингийн нийлбэрээс */
export const GROUP_DEFAULT = (() => {
  const t = FACTORS.reduce((s, f) => s + f.weight, 0);
  return Object.fromEntries(FACTOR_GROUPS.map((g) => [g.key,
    Math.round((FACTORS.filter((f) => f.group === g.key).reduce((s, f) => s + f.weight, 0) / t) * 100)])) as Record<FGroup, number>;
})();

/** Бүлгийн жин × бүлэг доторх харьцангуй жин = шалгуурын эцсийн жин (нийлбэр 1) */
export function effective(factors: Factor[], gw: Record<FGroup, number>): Factor[] {
  const G = FACTOR_GROUPS.reduce((s, g) => s + gw[g.key], 0) || 1;
  const gsum = Object.fromEntries(FACTOR_GROUPS.map((g) =>
    [g.key, factors.filter((f) => f.group === g.key).reduce((s, f) => s + f.weight, 0)])) as Record<FGroup, number>;
  return factors.map((f) => ({ ...f, weight: gsum[f.group] ? (gw[f.group] / G) * (f.weight / gsum[f.group]) : 0 }));
}

// ---------- Бэлтгэл өгөгдөл (сервер /api/prepare-ээс ирнэ) ----------
export type ZoneInfo = { aimag: string; soum: string };
export type SourceStatus = { status: "loaded" | "partial" | "missing"; source: string; note?: string };
export type Prepared = {
  cell: number; epsg: number; utmZone: number;
  n: number; // полигон доторх нүдний тоо
  x: ArrayLike<number>; y: ArrayLike<number>; // нүдний төв, UTM
  areaHa: number; // полигоны яг талбай
  centroid: [number, number]; // lon, lat
  zone: ArrayLike<number>; zones: ZoneInfo[]; // сум; -1 = Монголын хилийн гадна
  num: Record<string, ArrayLike<number>>; // slope, aspect, elev(%), elevM, tpi, flow, зай; NaN = мэдээлэлгүй
  cat: Record<string, { dict: string[]; idx: ArrayLike<number> }>; // idx -1 = хамраагүй
  sources: Record<string, SourceStatus>;
  warnings: string[];
  roads?: [number, number][][]; // полигоны орчмын хучилттай зам, UTM — төлөвлөгчийн орох цэгт
  rivers?: [number, number][][]; // полигоны орчмын гол мөрөн, UTM — төлөвлөлтөд зай авна
  anchor?: { name: string; x: number; y: number; km: number } | null; // хамгийн ойрын сум, аймгийн төв
};

// ---------- Үнэлгээ (жин, хориг солигдоход дахин хурдан тооцно) ----------
export type CellResult = { score: number; level: number; why: string; weak: string; coverage: number };
export type Summary = {
  breaks: number[];
  hist: { area: number[]; step: number }; // хоригоос бусад нүдний онооны тархалт (га), 0–1 хүрээ
  factorMean: Record<string, number | null>; // шалгуур бүрийн дундаж оноо (0–1), мэдээлэлгүй бол null
  factorCover: Record<string, number>; // шалгуурын утгатай нүдний хувь (0–1)
  unscored: Record<string, string[]>; // хамрагдсан ч онооны хүснэгтэд байхгүй ангилал
  coverage: number; // жингээр жигнэсэн мэдээллийн хамралт (0–1)
  cells: CellResult[];
  areas: number[]; // түвшин 1..5, га
  noDataHa: number;
  excluded: Record<string, number>; // хоригийн шалтгаан → га
  mean: number;
  byZone: { z: ZoneInfo; areas: number[]; mean: number; total: number }[];
};

const catValue = (p: Prepared, key: string, i: number) => {
  const c = p.cat[key];
  if (!c) return "";
  const k = c.idx[i];
  return k >= 0 ? c.dict[k] : "";
};

/** Мэдээлэлгүй бол null — зохиомол оноогоор нөхөхгүй */
export function factorScore(f: Factor, p: Prepared, i: number): number | null {
  if (f.kind === "cat") {
    const v = catValue(p, f.key, i);
    return v && f.cats && v in f.cats ? f.cats[v] : null;
  }
  if (f.kind === "aspect") {
    const s = p.num.slope?.[i];
    if (s == null || !Number.isFinite(s)) return null;
    return s < FLAT_SLOPE ? 1 : aspectDir(p.num.aspect[i])[1];
  }
  const v = p.num[f.key]?.[i];
  return v == null || !Number.isFinite(v) ? null : curveScore(f.curve!, v);
}

function excludedBy(e: Exclusion, p: Prepared, i: number) {
  if (e.value === "" || (e.toggle && !e.value)) return false;
  if (e.landcover) return catValue(p, "landcover", i) === e.landcover;
  const v = p.num[e.key]?.[i];
  if (v == null || !Number.isFinite(v)) return false;
  return e.key === "slope" || e.key === "flow" ? v > e.value : v < e.value;
}

export function evaluate(p: Prepared, factors: Factor[], excl: Exclusion[], method: ClassMethod = "fixed"): Summary {
  const active = factors.filter((f) => f.weight > 0);
  const W = active.reduce((s, f) => s + f.weight, 0) || 1;
  const ha = (p.cell * p.cell) / 1e4;
  const cells: CellResult[] = new Array(p.n);
  const areas = [0, 0, 0, 0, 0];
  const excluded: Record<string, number> = {};
  const zs = p.zones.map((z) => ({ z, areas: [0, 0, 0, 0, 0], sum: 0, total: 0 }));
  const fsum: Record<string, number> = Object.fromEntries(active.map((f) => [f.key, 0]));
  const fcnt: Record<string, number> = Object.fromEntries(active.map((f) => [f.key, 0]));
  const unscored: Record<string, Set<string>> = {};
  let lo = Infinity, hi = -Infinity, coverSum = 0, noData = 0;
  // Газрын бүрхэвчийн хоригийг түрүүлж шалгана: нуур дээр урсац хуримтлагддаг ч шалтгаан нь ус
  const ordered = [...excl.filter((e) => e.landcover), ...excl.filter((e) => !e.landcover)];
  // 1-р алхам: нийлбэр оноо, хориг
  for (let i = 0; i < p.n; i++) {
    let score = 0, avail = 0, weak = "", loss = -1;
    for (const f of active) {
      const s = factorScore(f, p, i);
      if (s == null) {
        if (f.kind === "cat") {
          const v = catValue(p, f.key, i);
          if (v) (unscored[f.key] ??= new Set()).add(v);
        }
        continue;
      }
      fsum[f.key] += s; fcnt[f.key]++;
      score += f.weight * s; avail += f.weight;
      const l = f.weight * (1 - s);
      if (l > loss) { loss = l; weak = f.label; }
    }
    const hit = ordered.find((e) => excludedBy(e, p, i));
    const why = hit ? `${hit.label}${hit.toggle ? "" : ` ${hit.value} ${hit.unit ?? ""}`}`.trim() : "";
    const value = avail ? score / avail : NaN;
    cells[i] = { score: value, level: 0, why, weak: loss > 0 ? weak : "", coverage: avail / W };
    coverSum += avail / W;
    if (!hit && avail) { lo = Math.min(lo, value); hi = Math.max(hi, value); }
  }
  // 2-р алхам: түвшин тогтоох
  const breaks = method === "relative" && hi > lo ? [0.2, 0.4, 0.6, 0.8].map((t) => lo + t * (hi - lo)) : BREAKS;
  const HB = 50;
  const hist = new Array(HB).fill(0);
  let sum = 0, cnt = 0;
  for (let i = 0; i < p.n; i++) {
    const c = cells[i];
    if (c.why) c.level = 1;
    else if (Number.isFinite(c.score)) c.level = levelOf(c.score, breaks);
    else { noData += ha; continue; } // мэдээлэлгүй нүдийг түвшинд оруулахгүй
    if (!c.why) hist[Math.min(HB - 1, Math.max(0, Math.floor(c.score * HB)))] += ha;
    areas[c.level - 1] += ha;
    if (c.why) excluded[c.why] = (excluded[c.why] ?? 0) + ha;
    const z = zs[p.zone[i]];
    if (z) { z.areas[c.level - 1] += ha; z.total += ha; if (Number.isFinite(c.score)) z.sum += c.score; }
    if (Number.isFinite(c.score)) { sum += c.score; cnt++; }
  }
  return {
    breaks, hist: { area: hist, step: 1 / HB },
    factorMean: Object.fromEntries(active.map((f) => [f.key, fcnt[f.key] ? fsum[f.key] / fcnt[f.key] : null])),
    factorCover: Object.fromEntries(active.map((f) => [f.key, p.n ? fcnt[f.key] / p.n : 0])),
    unscored: Object.fromEntries(Object.entries(unscored).map(([k, v]) => [k, [...v]])),
    coverage: p.n ? coverSum / p.n : 0,
    cells, areas, noDataHa: noData, excluded, mean: cnt ? sum / cnt : 0,
    byZone: zs.filter((z) => z.total > 0)
      .map((z) => ({ z: z.z, areas: z.areas, total: z.total, mean: z.sum / (z.total / ha) })),
  };
}

/** Талбайгаар жигнэсэн дундаж түвшин (1–5) */
export const meanLevel = (areas: number[]) => {
  const t = areas.reduce((s, v) => s + v, 0);
  return t ? areas.reduce((s, v, i) => s + v * (i + 1), 0) / t : 0;
};
/** Полигоны нэгдсэн дүгнэлт: дундаж түвшнийг бүхэл болгож ангилна */
export const verdictOf = (areas: number[]) => {
  const m = meanLevel(areas);
  return m ? { mean: m, level: LEVELS[Math.max(0, Math.min(4, Math.round(m) - 1))] } : null;
};

export const fmtN = (v: number | null | undefined, d = 0) =>
  v == null || !isFinite(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
