// POST { rings: [[lon, lat], ...][], cell?: number } → NDJSON урсгал: { type: "step" | "result" | "error", ... }
// Татах ажиллагаа хэдэн арван секунд үргэлжилж болох тул алхмыг шууд мэдээлнэ.
import { AuthError, readToken, verify } from "@/lib/server/auth.ts";
import { InputError, parseRings, prepare } from "@/lib/server/prepare.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!(await verify(readToken(req)))) return Response.json({ error: "Нэвтрэх шаардлагатай." }, { status: 401 });
  } catch (e) {
    return Response.json({ error: e instanceof AuthError ? e.message : "Нэвтрэлт шалгахад алдаа гарлаа." }, { status: 503 });
  }
  let rings, cell: number | undefined;
  try {
    const body = await req.json();
    rings = parseRings(body?.rings);
    cell = Number.isFinite(body?.cell) && body.cell > 0 ? body.cell : undefined;
  } catch (e) {
    const message = e instanceof InputError ? e.message : "Хүсэлт буруу байна.";
    return Response.json({ error: message }, { status: 400 });
  }
  const enc = new TextEncoder();
  let gone = false; // хэрэглэгч шинэ полигон зурж хүсэлтийг цуцалсан
  const stream = new ReadableStream({
    cancel() { gone = true; },
    async start(c) {
      const send = (o: unknown) => { if (!gone) c.enqueue(enc.encode(`${JSON.stringify(o)}\n`)); };
      try {
        const data = await prepare({ rings, cell }, (text) => send({ type: "step", text }));
        send({ type: "result", data });
      } catch (e) {
        console.error("[prepare]", e);
        send({ type: "error", message: (e as Error).message });
      }
      if (!gone) c.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform" } });
}
