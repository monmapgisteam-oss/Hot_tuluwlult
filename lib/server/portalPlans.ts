// Төлөвлөгөөний item-ийг порталд хадгалах, жагсаах, татах — зөвхөн сервер талд, хэрэглэгчийн өөрийн token-оор.
// Token нь Referer-т холбогдсон тул дуудлага бүрт ижил Referer илгээнэ. Token-ыг логт бичихгүй.
import { AuthError, PORTAL_URL, REFERER, readToken, verify, type PortalUser } from "./auth.ts";
import { ITEM_TYPE, PLAN_FOLDER, PLAN_KEYWORD, PLAN_TAG, type PlanItem } from "../savedPlan.ts";

const REST = `${PORTAL_URL}/sharing/rest`;
const TIMEOUT_MS = 60000;
const UNREACHABLE = "ArcGIS порталд холбогдож чадсангүй. Дахин оролдоно уу.";
/** Хадгалсан item-ийг хэнд харуулах: бүлгийн id өгвөл тэр бүлэгт, үгүй бол бүх байгууллагад */
const SHARE_GROUP = process.env.ARCGIS_SHARE_GROUP?.trim() || "";
export const ITEM_ID = /^[0-9a-f]{32}$/i;

type FetchLike = typeof fetch;
export type Session = { token: string; user: PortalUser };
type PortalFailure = { code?: number; message?: string };

function failure(e: PortalFailure): AuthError {
  if (e.code === 498 || e.code === 499) return new AuthError("Нэвтрэх шаардлагатай.", 401);
  if (e.code === 403) return new AuthError("Таны порталын эрх энэ үйлдлийг зөвшөөрөхгүй байна.", 403);
  return new AuthError(`Порталын алдаа: ${e.message ?? "тодорхойгүй"}`, 502);
}

async function send(url: string, init: RequestInit, f: FetchLike) {
  try {
    return await f(url, { ...init, headers: { Referer: REFERER }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch { throw new AuthError(UNREACHABLE, 503); }
}

async function readJson<T>(r: Response): Promise<T> {
  if (!r.ok) throw new AuthError(UNREACHABLE, 503);
  let j: (T & { error?: PortalFailure }) | null;
  try { j = await r.json(); } catch { throw new AuthError(UNREACHABLE, 503); }
  if (!j) throw new AuthError(UNREACHABLE, 503);
  if (j.error) throw failure(j.error);
  return j;
}

const get = async <T>(path: string, token: string, f: FetchLike, query: Record<string, string> = {}) =>
  readJson<T>(await send(`${REST}/${path}?${new URLSearchParams({ ...query, f: "json", token })}`, {}, f));

async function post<T>(path: string, fields: Record<string, string | Blob>, token: string, f: FetchLike) {
  const body = new FormData();
  body.set("f", "json");
  body.set("token", token);
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string") body.set(k, v); else body.set(k, v, "settlement-plan.zip");
  }
  return readJson<T>(await send(`${REST}/${path}`, { method: "POST", body }, f));
}

/** Хэрэглэгчийн хавтас: байхгүй бол үүсгэнэ */
async function ensureFolder(base: string, token: string, f: FetchLike) {
  const info = await get<{ folders?: { id: string; title: string }[] }>(base, token, f);
  const found = info.folders?.find((v) => v.title === PLAN_FOLDER)?.id;
  if (found) return found;
  return (await post<{ folder: { id: string } }>(`${base}/createFolder`, { title: PLAN_FOLDER }, token, f)).folder.id;
}

/** Өөрийн төлөвлөгөөний item бол хавтасны id ("" = root); бусад тохиолдолд null — шинээр үүсгэнэ */
async function ownFolderOf(id: string, c: Session, f: FetchLike) {
  try {
    const item = await get<{ owner?: string; ownerFolder?: string | null; typeKeywords?: string[] }>(`content/items/${id}`, c.token, f);
    return item.owner === c.user.username && item.typeKeywords?.includes(PLAN_KEYWORD) ? item.ownerFolder || "" : null;
  } catch (e) {
    // Устсан эсвэл хандах эрхгүй item бол шинээр үүсгэнэ
    if (e instanceof AuthError && (e.status === 401 || e.status === 503)) throw e;
    return null;
  }
}

export async function savePlanItem(c: Session, input: { file: Blob; title: string; snippet: string; itemId?: string }, f: FetchLike = fetch): Promise<{ item: PlanItem; shared: boolean }> {
  const base = `content/users/${encodeURIComponent(c.user.username)}`;
  const meta = {
    title: input.title, type: ITEM_TYPE, tags: PLAN_TAG, typeKeywords: `${PLAN_KEYWORD},v1`, snippet: input.snippet,
    description: "Хот төлөвлөлтийн системийн суурьшлын концепт төлөвлөгөө.", file: input.file,
  };
  const existing = input.itemId ? await ownFolderOf(input.itemId, c, f) : null;
  let id: string, folder: string;
  if (existing != null) {
    id = input.itemId!;
    folder = existing;
    await post(`${base}${folder ? `/${folder}` : ""}/items/${id}/update`, meta, c.token, f);
  } else {
    folder = await ensureFolder(base, c.token, f);
    id = (await post<{ id: string }>(`${base}/${folder}/addItem`, meta, c.token, f)).id;
  }
  // Хуваалцах алдаа нь хадгалалтыг унагахгүй
  let shared = true;
  try {
    await post(`${base}${folder ? `/${folder}` : ""}/items/${id}/share`, SHARE_GROUP ? { everyone: "false", org: "false", groups: SHARE_GROUP } : { everyone: "false", org: "true" }, c.token, f);
  } catch (e) {
    shared = false;
    console.warn("[plans] share", (e as Error).message);
  }
  return { item: { id, title: input.title, owner: c.user.username, modified: Date.now(), size: input.file.size, snippet: input.snippet }, shared };
}

/** Өөрийн болон хуваалцсан төлөвлөгөөнүүд, сүүлд өөрчлөгдсөн нь эхэндээ */
export async function listPlanItems(c: Session, f: FetchLike = fetch): Promise<PlanItem[]> {
  const q = `tags:"${PLAN_TAG}" AND typekeywords:"${PLAN_KEYWORD}"`;
  const r = await get<{ results?: PlanItem[] }>("search", c.token, f, { q, num: "100", sortField: "modified", sortOrder: "desc" });
  return (r.results ?? []).map(({ id, title, owner, modified, size, snippet }) => ({ id, title, owner, modified, size, snippet }));
}

/** Item-ийн zip файлын хариу. Портал алдааг ч 200-аар JSON буцаадаг тул ялгана. */
export async function fetchPlanData(c: Session, id: string, f: FetchLike = fetch) {
  const r = await send(`${REST}/content/items/${id}/data?${new URLSearchParams({ token: c.token })}`, {}, f);
  if (r.headers.get("content-type")?.includes("json")) {
    const j = await r.json().catch(() => null) as { error?: PortalFailure } | null;
    throw j?.error ? failure(j.error) : new AuthError("Энэ item нь төлөвлөгөөний файл биш.", 502);
  }
  if (!r.ok || !r.body) throw new AuthError(UNREACHABLE, 503);
  return r;
}

export async function requireSession(req: Request): Promise<Session> {
  const token = readToken(req), user = await verify(token);
  if (!token || !user) throw new AuthError("Нэвтрэх шаардлагатай.", 401);
  return { token, user };
}

export function errorResponse(e: unknown) {
  if (!(e instanceof AuthError)) console.error("[plans]", (e as Error)?.message);
  return Response.json({ error: e instanceof AuthError ? e.message : "Алдаа гарлаа." }, { status: e instanceof AuthError ? e.status : 500, headers: { "Cache-Control": "no-store" } });
}
