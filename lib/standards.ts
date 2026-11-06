// «Стандарт» таб: норм, жишиг бүрийг тухайн төлөвлөгөөний бодит утгаар тулгана.
//
// Хөгжүүлэгчийн тэмдэглэл (2026-11-06-нд эх бичвэртэй тулгав):
// - БНбД 30-01-24: mcis.gov.mn дээрх файлын 2-р хуудсанд «ТӨСӨЛ» гэж бичсэн. Яамны жагсаалтад БНбД 30.01.04 байна.
//   Батлагдсан эсэхийг баталж чадаагүй, 30-01-04-ийн эх бичвэртэй тулгаагүй — ШАЛГАХ.
// - Х.6.1: BCR 0.4 / FAR 1.2 нь 7–16 давхарт; 3–6 давхарт FAR 0.8; гэр сууц, 1–2 айлд BCR 0.2 / FAR 0.4.
// - ДЭМБ-ийн «9 м²/хүн»-ийн анхдагч эх сурвалж олдоогүй тул ашиглахгүй. 0.5 га / 300 м нь WHO Europe 2016.
// - EPBD 2024/1275-ыг хоёрдогч эх сурвалжаар (PwC Legal), ADA §208.2-ыг санахаар бичсэн — эх бичвэрээр ШАЛГАХ.
// - Статус нь зөвхөн автомат тулгалт, мэргэжлийн байгууллагын нийцлийн дүгнэлт биш.
import type { PlanInputs } from "./plan/runSettlement";
import type { Check } from "./plan/urban";
import type { PlanView } from "./savedPlan.ts";

export type StdStatus = "met" | "gap" | "enforced" | "partial" | "pending";
export type StdRow = { clause: string; text: string; status: StdStatus; value?: string };
export type StdDoc = { code: string; title: string; note?: string; url?: string; rows: StdRow[] };
export type StdInput = { plan: PlanView; checks: Check[]; inputs?: PlanInputs } | null;

export const STATUS_LABEL: Record<StdStatus, string> = {
  met: "Хангасан", gap: "Зөрүүтэй", enforced: "Мөрдсөн", partial: "Хэсэгчлэн", pending: "Төлөвлөгөө хүлээж байна",
};

/** Хүснэгт 6.1: давхраас хамаарсан орон сууцны хязгаар */
export const residentialFar = (floors: number) => (floors >= 7 ? 1.2 : 0.8);

const BNBD_3001 = "https://mcis.gov.mn/storage/uploads/process/202403/file_1710112307903138_162364495749810.pdf";
const fmt = (v: number, d = 0) => v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

/** Монгол улсын холбогдох норм — төлөвлөгөөнд тооцоогүй. Нэрс нь БНбД 30-01-24-ийн ишлэлээс. */
export const NOT_COVERED: { code: string; title: string }[] = [
  { code: "БНбД 31-01-10", title: "Орон сууцны барилгын зураг төсөл, төлөвлөлт" },
  { code: "БНбД 21-05-10", title: "Авто зогсоол" },
  { code: "БНбД 21-01-02", title: "Барилга, байгууламжийн галын аюулгүй байдал" },
  { code: "БНбД 22-01-01", title: "Газар хөдлөлтийн бүс дэх барилга" },
  { code: "БНбД 23-04-07", title: "Нарны тусгалын хангамж, барилга хоорондын зай" },
  { code: "БНбД 23-01-09", title: "Барилгад хэрэглэх уур амьсгал, геофизикийн үзүүлэлт" },
  { code: "БНбД 23-05-10", title: "Дуу чимээ тусгаарлалт" },
  { code: "БНбД 30-01-24, З.10.32", title: "Газар доорх зогсоолын доод хэмжээ" },
];

export function buildStandards(r: StdInput): { mongolia: StdDoc[]; international: StdDoc[] } {
  const t = r?.plan.t, ger = r?.inputs?.mode === "ger" || !!r?.plan.ger, floors = Number(r?.inputs?.floorsRes) || 0;
  /** Төлөвлөгөөгүй бол хүлээнэ; төлөвлөгөөтэй бол утгаар шийднэ */
  const row = (clause: string, text: string, get: (v: NonNullable<typeof t>) => { ok: boolean | "partial"; value: string }): StdRow => {
    if (!t) return { clause, text, status: "pending" };
    const { ok, value } = get(t);
    return { clause, text, value, status: ok === "partial" ? "partial" : ok ? "met" : "gap" };
  };
  const fromCheck = (clause: string, text: string, label: string): StdRow => {
    const c = r?.checks.find((v) => v.label === label);
    if (!r) return { clause, text, status: "pending" };
    return { clause, text, value: c?.value, status: !c || c.ok == null ? "partial" : c.ok ? "met" : "gap" };
  };
  const layerGap = r?.plan.notes?.some((n) => n.includes("Тусгай хамгаалалттай газар") && n.includes("татагдсангүй"));
  const far = ger ? 0.4 : residentialFar(floors), bcr = ger ? 0.2 : 0.4;
  const planning: StdRow[] = [
    row("Х.6.1", `Барилгажилтын коэффициент BCR ≤ ${bcr}`, (v) => ({ ok: v.bcrRes <= bcr, value: fmt(v.bcrRes, 2) })),
    row("Х.6.1", ger ? `Барилгажилтын нягтрал FAR ≤ ${far}` : `Барилгажилтын нягтрал FAR ≤ ${far}${r ? ` (${floors} давхар)` : " (3–6 давхарт 0.8, 7–16 давхарт 1.2)"}`, (v) => ({ ok: v.farRes <= far, value: fmt(v.farRes, 2) })),
    fromCheck("Х.10.4–10.5", "Гудамжны дагуу налуу: гол ≤ 70‰, орон нутгийн ≤ 80‰", "Налуу хэтэрсэн гудамжны хэсэг"),
    { clause: "З.8.2", text: "Онцгой хамгаалалттай нутаг дэвсгэрт шинээр барихгүй (ТХГН-ийн тухай хууль)", status: !r ? "pending" : layerGap ? "gap" : "enforced" },
  ];
  if (!ger) planning.splice(2, 0,
    ...(floors >= 4 || !r ? [row("З.6.9", "Хүн амын нягтрал ≤ 450 хүн/га (4–16 давхар)", (v) => ({ ok: v.densNet <= 450, value: `${fmt(v.densNet)} хүн/га` }))] : []),
    row("Х.8.2", "Хорооллын нийтийн ногоон байгууламж ≥ 6 м²/хүн", (v) => ({ ok: v.greenPP >= 6, value: `${fmt(v.greenPP, 1)} м²` })),
    row("Х.8.2", "Хотын нийтийн ногоон: хот 7–10, хөдөөгийн суурин 12 м²/хүн", (v) => ({ ok: v.greenPP >= 12 ? true : v.greenPP >= 7 ? "partial" : false, value: `${fmt(v.greenPP, 1)} м²` })),
    row("Х.5.4", "Цэцэрлэг: хот 300 м, хөдөөгийн суурин 500 м", (v) => ({ ok: "partial", value: `400 м дотор ${fmt(v.kinderCover)}%` })),
    row("Х.5.4", "Сургууль: хот 500 м, хөдөөгийн суурин 1000 м", (v) => ({ ok: "partial", value: `750 м дотор ${fmt(v.schoolCover)}%` })),
    row("З.10.22", "Нийтийн тээврийн буудал хүртэл ≤ 500 м", (v) => ({ ok: v.transitCover >= 99, value: `${fmt(v.transitCover)}%` })),
    row("Х.10.9", "Ердийн зэрэглэлийн сууц бүрт 1.0 авто зогсоол", (v) => ({ ok: v.parkSupply >= v.parkNeedRes, value: `${fmt(v.parkSupply)} / ${fmt(v.parkNeedRes)}` })),
  );
  const mongolia: StdDoc[] = [
    {
      code: "БНбД 30-01-24", title: "Хот, суурины төлөвлөлт, барилгажилтын норм ба дүрэм", url: BNBD_3001,
      note: "2024 оны төслийн хувилбараар тулгав. Өмнөх хувилбар нь БНбД 30-01-04.", rows: planning,
    },
    {
      code: "БНбД 40-01-14", title: "Ариутгах татуурга. Гадна сүлжээ ба байгууламж", url: "https://legalinfo.mn/uploads/baiguulga/986-1098.pdf",
      rows: [!r ? { clause: "—", text: "Бохирын шугамын гүн, налуу, диаметр", status: "pending" } : (() => {
        const c = r.checks.find((v) => v.label === "Бохирын хамгийн их гүн");
        return { clause: "—", text: "Бохирын шугамын гүн, налуу, диаметр", value: c?.value, status: c?.ok === false ? "gap" as const : "partial" as const };
      })()],
    },
    {
      code: "БНбД 40-02-16", title: "Ус хангамж. Гадна сүлжээ ба байгууламж", url: "https://legalinfo.mn/mn/detail?lawId=16530472761861",
      rows: [{ clause: "—", text: "Усны хэрэглээ, сүлжээний диаметр", status: r ? "partial" : "pending", value: t ? `${fmt(t.water)} м³/хон` : undefined }],
    },
    {
      code: "БНбД 41-02-13", title: "Дулааны сүлжээ",
      rows: [{ clause: "—", text: "Дулааны ачаалал, сүлжээний трасс", status: r ? "partial" : "pending", value: t?.heatMw != null ? `${fmt(t.heatMw, 1)} МВт` : undefined }],
    },
  ];
  const international: StdDoc[] = [
    {
      code: "WHO Europe, 2016", title: "Urban green spaces and health",
      rows: [row("—", "0.5 га-аас том ногоон талбай 300 м дотор", (v) => ({ ok: v.parkCover >= 99, value: `${fmt(v.parkCover)}%` }))],
    },
    {
      code: "ADA 2010, §208.2", title: "Хүртээмжтэй авто зогсоол (АНУ)",
      rows: [{ ...fromCheck("—", "Нийт зогсоолын 2%, бага зогсоолд өндөр хувь", "Хүртээмжтэй зогсоол"), ...(r ? { status: "partial" as const } : {}) }],
    },
    {
      code: "EU 2024/1275 (EPBD), 14-р зүйл", title: "Цэнэглэх цэг, дугуйн зогсоол (ЕХ)",
      rows: [{ clause: "—", text: "Сууц бүрт 2 дугуйн зогсоол, зогсоол бүрт урьдчилсан кабель", status: r ? "gap" : "pending", value: r?.checks.find((c) => c.label === "Дугуйн зогсоол")?.value }],
    },
  ];
  return { mongolia, international };
}
