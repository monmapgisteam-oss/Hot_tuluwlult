// ArcGIS Enterprise (arcgis.ubhub.mn) эрхээр нэвтрэх — зөвхөн сервер талд.
// Портал CORS зөвшөөрөхгүй тул хөтөч шууд хандаж чадахгүй: сервер generateToken дуудаж, token-ыг httpOnly күүкид хадгална.
// Нууц үгийг порталд дамжуулахаас өөрөөр хадгалахгүй, логт бичихгүй.
import { createHash } from "node:crypto";

export const PORTAL_URL = (process.env.ARCGIS_PORTAL_URL?.trim() || "https://arcgis.ubhub.mn/arcgis").replace(/\/+$/, "");
export const COOKIE = "suit_session";
const SHARING = `${PORTAL_URL}/sharing/rest`;
/** Token зөвхөн энэ утгатай Referer-ээс ажиллана. Порталд зөвхөн сервер хандах тул тогтмол утга хангалттай. */
export const REFERER = "https://suitability.webapp/";
const EXPIRATION_MIN = 480;
const VERIFY_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE = 1000;

export type PortalUser = { username: string; fullName: string };
type FetchLike = typeof fetch;

/** Хэрэглэгчид харуулах алдаа; status нь HTTP хариу */
export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.name = "AuthError"; this.status = status; }
}
const UNREACHABLE = "ArcGIS порталд холбогдож чадсангүй. Дахин оролдоно уу.";

async function post(path: string, params: Record<string, string>, f: FetchLike) {
  let res: Response;
  try {
    res = await f(`${SHARING}/${path}`, {
      method: "POST", body: new URLSearchParams({ ...params, f: "json" }),
      headers: { Referer: REFERER }, signal: AbortSignal.timeout(20000),
    });
  } catch { throw new AuthError(UNREACHABLE, 503); }
  if (!res.ok) throw new AuthError(UNREACHABLE, 503);
  try { return await res.json() as Record<string, unknown>; } catch { throw new AuthError(UNREACHABLE, 503); }
}

const toUser = (d: Record<string, unknown>): PortalUser | null => (typeof d.username === "string" && d.username
  ? { username: d.username, fullName: typeof d.fullName === "string" && d.fullName ? d.fullName : d.username }
  : null);

const verified = new Map<string, { until: number; user: PortalUser }>();
const keyOf = (token: string) => createHash("sha256").update(token).digest("hex");

/** Хэрэглэгчийн нэр, нууц үгээр token авна */
export async function login(username: unknown, password: unknown, f: FetchLike = fetch) {
  if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
    throw new AuthError("Хэрэглэгчийн нэр, нууц үгээ оруулна уу.", 400);
  }
  if (username.length > 256 || password.length > 1024) throw new AuthError("Хэрэглэгчийн нэр эсвэл нууц үг буруу байна.", 401);
  const d = await post("generateToken", {
    username: username.trim(), password, client: "referer", referer: REFERER, expiration: String(EXPIRATION_MIN),
  }, f);
  if (typeof d.token !== "string" || !d.token) throw new AuthError("Хэрэглэгчийн нэр эсвэл нууц үг буруу байна.", 401);
  const token = d.token;
  const expires = typeof d.expires === "number" ? d.expires : Date.now() + EXPIRATION_MIN * 60000;
  const user = toUser(await post("community/self", { token }, f));
  if (!user) throw new AuthError("Хэрэглэгчийн мэдээлэл уншигдсангүй.", 401);
  return { token, expires, user };
}

/** Token хүчинтэй бол хэрэглэгч, үгүй бол null. Портал холбогдохгүй бол AuthError (503). */
export async function verify(token: string | null, f: FetchLike = fetch): Promise<PortalUser | null> {
  if (!token) return null;
  const key = keyOf(token), hit = verified.get(key);
  if (hit && hit.until > Date.now()) return hit.user;
  verified.delete(key);
  const user = toUser(await post("community/self", { token }, f));
  if (!user) return null;
  if (verified.size >= MAX_CACHE) verified.delete(verified.keys().next().value!);
  verified.set(key, { until: Date.now() + VERIFY_TTL_MS, user });
  return user;
}

/** Гарах үед шалгасан кэшээс хасна — үгүй бол 5 минут хүртэл хүчинтэй хэвээр үлдэнэ */
export const forget = (token: string | null) => { if (token) verified.delete(keyOf(token)); };

export function readToken(req: Request) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) {
      try { return decodeURIComponent(part.slice(i + 1).trim()) || null; } catch { return null; }
    }
  }
  return null;
}

const isHttps = (req: Request) => (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";

export function sessionCookie(req: Request, token: string, expires: number) {
  const maxAge = Math.max(0, Math.floor((expires - Date.now()) / 1000));
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? "; Secure" : ""}`;
}
export const clearCookie = (req: Request) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? "; Secure" : ""}`;
