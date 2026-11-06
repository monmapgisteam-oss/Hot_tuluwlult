// GET → порталын item-ийн zip файл (урсгалаар дамжуулна)
import { AuthError } from "@/lib/server/auth.ts";
import { ITEM_ID, errorResponse, fetchPlanData, requireSession } from "@/lib/server/portalPlans.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ITEM_ID.test(id)) throw new AuthError("Item-ийн дугаар буруу байна.", 400);
    const data = await fetchPlanData(await requireSession(req), id);
    return new Response(data.body, { headers: { "Content-Type": "application/zip", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) { return errorResponse(e); }
}
