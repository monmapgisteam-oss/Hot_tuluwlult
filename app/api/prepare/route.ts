// POST { rings: [[lon, lat], ...][], cell?: number } → NDJSON урсгал: { type: "step" | "result" | "error", ... }
// Татах ажиллагаа хэдэн арван секунд үргэлжилж болох тул алхмыг шууд мэдээлнэ.
import { AuthError, readToken, verify } from "@/lib/server/auth.ts";
import { InputError, parseRings, prepare } from "@/lib/server/prepare.ts";
import { loadAdmin } from "@/lib/server/vectors.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    if (!(await verify(readToken(req)))) return Response.json({ error: "Нэвтрэх шаардлагатай." }, { status: 401 });
  } catch (e) {
    return Response.json({ error: e instanceof AuthError ? e.message : "Нэвтрэлт шалгахад алдаа гарлаа." }, { status: 503 });
  }
  let rings, cell: number | undefined, admin: { anchor: { name: string; lonLat: [number, number] } | null } | undefined;
  try {
    const body = await req.json();
    if (body?.admin) {
      // Сонгосон сум, аймаг: хилийг сервер өөрөө уншина
      const { aimag, soum } = body.admin;
      if (typeof aimag !== "string" || (soum != null && typeof soum !== "string")) throw new InputError("Аймаг, сумын нэр буруу байна.");
      const found = await loadAdmin(aimag, soum);
      if (!found) throw new InputError("Сонгосон аймаг, сум олдсонгүй.");
      rings = found.rings;
      admin = { anchor: found.anchor };
    } else rings = parseRings(body?.rings);
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
        const data = await prepare({ rings, cell, admin }, (text) => send({ type: "step", text }));
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
