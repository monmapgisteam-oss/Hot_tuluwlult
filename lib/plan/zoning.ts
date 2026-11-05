// Бүсчлэл, материалын өнгө — Selbe CityEngine дүрмүүдээс (CE_PROJECT/rules).
//   zone/Selbe_zoning.cga zoneColor, zone/zoning.cga buildingColor, lot_chat.cga, Pocket_Park.cga, reparking.cga, Sidewalk_ob.cga

/** Бүсийн ангилал (алхам 3) → Selbe zone attr, өнгө */
export const ZONE = {
  res: { label: "Орон сууц", zone: "Residential area", color: "#F2DCA2" },
  com: { label: "Худалдаа, үйлчилгээ", zone: "Commercial / Residential", color: "#E9762F" },
  edu: { label: "Боловсрол", zone: "Education", color: "#E985A6" },
  health: { label: "Эрүүл мэнд", zone: "Medical", color: "#F0B9B5" },
  park: { label: "Цэцэрлэгт хүрээлэн", zone: "Urban Green Spaces", color: "#75CB98" },
  protect: { label: "Хамгаалалтын ногоон", zone: "Protective Green Space", color: "#3F987C" },
  eng: { label: "Инженерийн дэд бүтэц", zone: "Engineering Infrastructure Zone", color: "#6B6AA1" },
} as const;
export type ZoneKey = keyof typeof ZONE;

export const LOT_LABEL = {
  res: "Орон сууцны блок", com: "Худалдааны блок", school: "Сургууль", kinder: "Цэцэрлэг", clinic: "Эмнэлэг",
  park: "Цэцэрлэгт хүрээлэн", protect: "Хамгаалалтын ногоон", eng: "Инженерийн байгууламж",
} as const;
export const ENG_FAC = ["Цэвэрлэх байгууламж", "Усан сан", "Дулааны станц", "Дэд станц"];

/** Газрын гадаргуу. C — урсацын коэффициент (rational method жишиг, ТААМАГЛАЛ) */
export const GROUND = {
  grass: { label: "Зүлэг", color: "#8FAF72", C: 0.15, green: true, walk: false },
  protect: { label: "Хамгаалалтын ногоон", color: "#5F8068", C: 0.15, green: true, walk: false },
  verge: { label: "Замын ногоон зурвас", color: "#7FA464", C: 0.15, green: true, walk: false },
  walk: { label: "Явган зам", color: "#D7C9A7", C: 0.75, green: false, walk: true },
  plaza: { label: "Талбай", color: "#C7B99A", C: 0.75, green: false, walk: true },
  // Тоглоомын талбай: EPDM резин аюулгүйн хучилт (EN 1177 маягийн), голд элсэн хайрцаг. ТААМАГЛАЛ: урсацын C.
  play: { label: "Тоглоомын талбай (резин хучилт)", color: "#5F93A6", C: 0.5, green: false, walk: false },
  sand: { label: "Элсэн хайрцаг", color: "#E2D2A0", C: 0.3, green: false, walk: false },
  sport: { label: "Спорт талбай", color: "#68A276", C: 0.3, green: false, walk: false },
  court: { label: "Сагс, волейболын талбай", color: "#3E7CB1", C: 0.9, green: false, walk: false },
  track: { label: "Гүйлтийн зам", color: "#C0643F", C: 0.6, green: false, walk: false },
  parking: { label: "Ил зогсоол", color: "#55585A", C: 0.9, green: false, walk: false },
  yard: { label: "Үйлдвэрийн талбай", color: "#8E9296", C: 0.9, green: false, walk: false },
  road: { label: "Авто зам", color: "#4A4E52", C: 0.9, green: false, walk: false },
  sidewalk: { label: "Явган хүний зам", color: "#BF887B", C: 0.8, green: false, walk: true },
  bike: { label: "Дугуйн зам", color: "#6F9FC4", C: 0.85, green: false, walk: true },
} as const;
export type GroundKind = keyof typeof GROUND;

/** Барилгын масс (zoning.cga buildingColor, building_apartment.cga CommercialColor, SelbeSmartBuilding.cga roof) */
export const MASS = {
  res: { label: "Орон сууц", color: "#F5EBD7" },
  com: { label: "Худалдаа, үйлчилгээ (давхар)", color: "#DFAEA8" },
  office: { label: "Оффис", color: "#ADA9C0" },
  kinder: { label: "Цэцэрлэг", color: "#F7E2B0" },
  school: { label: "Сургууль", color: "#F1C5D1" },
  clinic: { label: "Эмнэлэг", color: "#F4DDDC" },
  eng: { label: "Инженерийн байгууламж", color: "#9A97CE" },
  // Хавтгай дээврийн мембран (цайвар саарал) — асфальт/зогсоолоос ялгагдана.
  roof: { label: "Дээвэр", color: "#A3A6A8" },
  pv: { label: "Нарны хавтантай дээвэр", color: "#244B59" },
  groof: { label: "Ногоон дээвэр", color: "#3F7D4B" },
} as const;
export type MassKind = keyof typeof MASS;

/** Мод — Tsahilgaan_nogoon.cga: жижиг/дунд/том 2.5/5/7 м, титэм 1.2/2.5/4 м */
export const TREE = [
  { label: "Шилмүүст", color: "#3E6B3A", h: 8, r: 2.4 },
  { label: "Навчит", color: "#6E9E4E", h: 6, r: 4 },
  { label: "Бут", color: "#8DB35E", h: 2.5, r: 1.2 },
];

export const STREET = {
  arterial: { label: "Гол тэнхлэг (магистраль)", color: "#E4572E" },
  collector: { label: "Туслах тэнхлэг (цуглуулах)", color: "#F3A712" },
  local: { label: "Орон нутгийн гудамж", color: "#A0A4A8" },
} as const;

/** Барилгын өндрийн ангилал (алхам 5) — дараалсан нэг өнгөний шатлал */
export const HEIGHT_CLS = [
  { max: 3, label: "Нам (1–3 давхар)", color: "#C9DDF2" },
  { max: 5, label: "Дунд-нам (4–5)", color: "#86B3E0" },
  { max: 9, label: "Дунд (6–9)", color: "#3F7FC4" },
  { max: 99, label: "Өндөр (10+)", color: "#1B4A86" },
];
export const heightCls = (floors: number) => HEIGHT_CLS.findIndex((c) => floors <= c.max);
