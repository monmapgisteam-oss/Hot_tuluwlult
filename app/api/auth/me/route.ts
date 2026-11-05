import { AuthError, clearCookie, readToken, verify } from "@/lib/server/auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const noStore = { "Cache-Control": "no-store" };
  try {
    const token = readToken(req);
    const user = await verify(token);
    if (user) return Response.json({ user }, { headers: noStore });
    return Response.json({ user: null }, { status: 401, headers: { ...noStore, ...(token ? { "Set-Cookie": clearCookie(req) } : {}) } });
  } catch (e) {
    return Response.json({ error: e instanceof AuthError ? e.message : "Алдаа гарлаа." }, { status: 503, headers: noStore });
  }
}
