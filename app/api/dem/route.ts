// POST { wkid, x0, y0, nx, ny, cell } → Float32 өндрийн тор (мөр бүр x-ээр, өмнөдөөс хойш). Төлөвлөгчид зориулав.
import proj4 from "proj4";
import { AuthError, readToken, verify } from "@/lib/server/auth.ts";
import { sampleDem } from "@/lib/server/rasters.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_POINTS = 2_000_000;

export async function POST(req: Request) {
  try {
    if (!(await verify(readToken(req)))) return Response.json({ error: "Нэвтрэх шаардлагатай." }, { status: 401 });
  } catch (e) {
    return Response.json({ error: e instanceof AuthError ? e.message : "Нэвтрэлт шалгахад алдаа гарлаа." }, { status: 503 });
  }
  const b = await req.json().catch(() => null);
  const { wkid, x0, y0, nx, ny, cell } = b ?? {};
  const north = Number.isInteger(wkid) && wkid >= 32601 && wkid <= 32660, south = Number.isInteger(wkid) && wkid >= 32701 && wkid <= 32760;
  const valid = (north || south) && [x0, y0, cell].every(Number.isFinite) && cell >= 10 && Number.isInteger(nx) && Number.isInteger(ny) && nx > 0 && ny > 0;
  if (!valid) return Response.json({ error: "Хүсэлт буруу байна." }, { status: 400 });
  if (nx * ny > MAX_POINTS) return Response.json({ error: "Өндрийн тор хэт том байна." }, { status: 400 });

  const zone = wkid % 100;
  const tr = proj4(`+proj=utm +zone=${zone}${south ? " +south" : ""} +datum=WGS84 +units=m +no_defs`);
  const lon = new Float64Array(nx * ny), lat = new Float64Array(nx * ny);
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const [a, c] = tr.inverse([x0 + i * cell, y0 + j * cell]);
    lon[j * nx + i] = a; lat[j * nx + i] = c;
    if (a < w) w = a; if (a > e) e = a; if (c < s) s = c; if (c > n) n = c;
  }
  try {
    const z = await sampleDem(lon, lat, { w, s, e, n }, cell);
    return new Response(Float32Array.from(z).buffer as ArrayBuffer, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[dem]", err);
    return Response.json({ error: "Өндрийн мэдээлэл уншиж чадсангүй." }, { status: 502 });
  }
}
