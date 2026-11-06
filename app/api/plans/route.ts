// GET → { items: PlanItem[] }. POST multipart { file, name, snippet, itemId? } → { item, shared }.
import { AuthError } from "@/lib/server/auth.ts";
import { ITEM_ID, errorResponse, listPlanItems, requireSession, savePlanItem } from "@/lib/server/portalPlans.ts";
import { MAX_ZIP_BYTES } from "@/lib/savedPlan.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_NAME = 120, MAX_SNIPPET = 250;

export async function GET(req: Request) {
  try {
    return Response.json({ items: await listPlanItems(await requireSession(req)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession(req);
    if (Number(req.headers.get("content-length")) > MAX_ZIP_BYTES + 100_000) throw new AuthError("Төлөвлөгөө хэт том байна.", 413);
    const form = await req.formData().catch(() => { throw new AuthError("Хүсэлт буруу байна.", 400); });
    const file = form.get("file"), name = form.get("name"), snippet = form.get("snippet"), itemId = form.get("itemId");
    if (!(file instanceof Blob) || file.size > MAX_ZIP_BYTES) throw new AuthError("Төлөвлөгөөний файл буруу эсвэл хэт том байна.", 400);
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (head[0] !== 0x50 || head[1] !== 0x4b) throw new AuthError("Төлөвлөгөөний файл буруу байна.", 400);
    const title = typeof name === "string" ? name.trim() : "";
    if (!title || title.length > MAX_NAME) throw new AuthError(`Загварын нэр 1–${MAX_NAME} тэмдэгт байна.`, 400);
    if (itemId != null && (typeof itemId !== "string" || !ITEM_ID.test(itemId))) throw new AuthError("Item-ийн дугаар буруу байна.", 400);
    return Response.json(await savePlanItem(session, {
      file, title, snippet: typeof snippet === "string" ? snippet.slice(0, MAX_SNIPPET) : "", ...(itemId ? { itemId: itemId as string } : {}),
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
