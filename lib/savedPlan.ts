// Суурьшлын төлөвлөгөөг ArcGIS порталд item болгож хадгалах формат, хөтчийн API (Бөөрөлжүүтийн lib/portalPlans.ts).
// Item: төрөл «Code Sample» (zip файл хүлээн авдаг), файл нь plan.json агуулсан zip.
// Портал CORS зөвшөөрөхгүй, token httpOnly күүкид байгаа тул хөтөч /api/plans-оор дамжина.
import { unzipText, zipText } from "./portalZip.ts";
import type { PlanInputs } from "./plan/runSettlement";
import type { Attrs, Scene } from "./plan/rules";
import type { Check, Plan } from "./plan/urban";

export const PLAN_TAG = "hot-tuluwlult-plan";
export const PLAN_KEYWORD = "hot-tuluwlult-settlement-plan";
export const ITEM_TYPE = "Code Sample";
export const PLAN_FOLDER = "Хот төлөвлөлт";
/** Vercel-ийн хүсэлтийн хязгаар 4.5 МБ; multipart-ийн толгойд зай үлдээв */
export const MAX_ZIP_BYTES = 4_400_000;

/** Төлөвлөгөөг харуулахад хэрэгтэй хэсэг. Өндрийн тор, граф зэрэг тооцооны өгөгдлийг хадгалахгүй. */
export type PlanView = Pick<Plan, "wkid" | "notes" | "t" | "site" | "siteArea" | "bldgs" | "nets" | "streets" | "zones" | "ger"> & {
  streetInputs?: Pick<Attrs, "walkW" | "bikeW" | "laneW" | "artLanes" | "colLanes" | "serviceW">;
  scene: Pick<Scene, "streets" | "base" | "over" | "marks" | "lanes" | "masses" | "trees" | "lights" | "accesses">;
};
export type SavedTarget = { rings: [number, number][][] | null; region: { aimag: string; soum: string | null } | null };
export type PlanBundle = {
  version: 1; kind: typeof PLAN_KEYWORD; name: string; generated: string;
  target: SavedTarget; inputs: PlanInputs; plan: PlanView; checks: Check[];
};
export type PlanItem = { id: string; title: string; owner: string; modified: number; size: number; snippet?: string };

export function toPlanView(p: PlanView & Partial<Pick<Plan, "inp">>): PlanView {
  const { wkid, notes, t, site, siteArea, bldgs, nets, streets, zones, scene, ger } = p;
  const { streets: sceneStreets, base, over, marks, lanes, masses, trees, lights, accesses } = scene;
  const source = p.streetInputs ?? p.inp;
  const streetInputs = source ? { walkW: source.walkW, bikeW: source.bikeW, laneW: source.laneW, artLanes: source.artLanes, colLanes: source.colLanes, serviceW: source.serviceW } : undefined;
  return { wkid, notes, t, site, siteArea, bldgs, nets, streets, zones, ...(ger ? { ger } : {}), ...(streetInputs ? { streetInputs } : {}), scene: { streets: sceneStreets, base, over, marks, lanes, masses, trees, lights, ...(accesses ? { accesses } : {}) } };
}

export function packPlan(b: Omit<PlanBundle, "version" | "kind" | "generated" | "plan"> & { plan: PlanView }, when = new Date()) {
  const bundle: PlanBundle = { ...b, version: 1, kind: PLAN_KEYWORD, generated: when.toISOString(), plan: toPlanView(b.plan) };
  return zipText("plan.json", JSON.stringify(bundle), when);
}

export async function unpackPlan(zip: Uint8Array): Promise<PlanBundle> {
  let b: PlanBundle | null = null;
  try { b = JSON.parse(await unzipText(zip)); } catch { /* доорх алдаа */ }
  if (b?.kind !== PLAN_KEYWORD || b.version !== 1 || !b.plan?.scene || !Array.isArray(b.plan.bldgs)) throw new Error("Энэ item нь төлөвлөгөөний файл биш.");
  return b;
}

/** Нэвтрэлт дууссан: дуудагч onExpired-ийг дуудна */
export class SessionExpired extends Error {}

async function api(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  if (r.status === 401) throw new SessionExpired("Нэвтрэх шаардлагатай.");
  if (!r.ok) {
    const d = await r.json().catch(() => null);
    throw new Error(d?.error ?? `Сервер алдаа буцаалаа (${r.status}).`);
  }
  return r;
}

export async function listPlans(): Promise<PlanItem[]> {
  return (await (await api("/api/plans")).json()).items;
}

export async function savePlan(b: Parameters<typeof packPlan>[0], snippet: string, itemId: string | null): Promise<{ item: PlanItem; shared: boolean }> {
  const zip = await packPlan(b);
  if (zip.length > MAX_ZIP_BYTES) throw new Error(`Төлөвлөгөө хэт том байна (${(zip.length / 1e6).toFixed(1)} МБ, дээд хязгаар ${MAX_ZIP_BYTES / 1e6} МБ).`);
  const form = new FormData();
  form.set("file", new Blob([zip as BlobPart], { type: "application/zip" }), "plan.zip");
  form.set("name", b.name);
  form.set("snippet", snippet);
  if (itemId) form.set("itemId", itemId);
  return (await api("/api/plans", { method: "POST", body: form })).json();
}

export async function openPlan(id: string): Promise<PlanBundle> {
  return unpackPlan(new Uint8Array(await (await api(`/api/plans/${id}`)).arrayBuffer()));
}
