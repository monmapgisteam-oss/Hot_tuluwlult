import { AuthError, login, sessionCookie } from "@/lib/server/auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const { token, expires, user } = await login(body?.username, body?.password);
    return Response.json({ user }, { headers: { "Set-Cookie": sessionCookie(req, token, expires), "Cache-Control": "no-store" } });
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 500;
    const error = e instanceof AuthError ? e.message : "Нэвтрэлт амжилтгүй боллоо.";
    return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
