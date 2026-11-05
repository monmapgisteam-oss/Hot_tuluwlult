import { clearCookie, forget, readToken } from "@/lib/server/auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  forget(readToken(req));
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearCookie(req), "Cache-Control": "no-store" } });
}
