// I:\EIC-ийн shapefile → public/data/*.geojson (WGS84).
// mapshaper нь топологи хадгалж хялбарчилдаг тул хөрш сумдын хил зөрөхгүй.
// Ажиллуулах: npm run boundaries  (эх хавтас өөр бол: EIC_DIR=D:/EIC npm run boundaries)
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const EIC = process.env.EIC_DIR ?? "I:/EIC";
const OUT = "public/data";
const CLI = join("node_modules", "mapshaper", "bin", "mapshaper");
mkdirSync(OUT, { recursive: true });

const JOBS = [
  { src: "countryboundary", out: "country", simplify: "8%", fields: "country_na" },
  { src: "aimagbnd", out: "aimag", simplify: "12%", fields: "aimag_code,aimag_name" },
  { src: "soumbnd", out: "soum", simplify: "12%", fields: "aimag_code,soum_code,soum_name,aimag_name" },
  { src: "soumcenter", out: "soumcenter", fields: "soum_code,center_nam" },
  { src: "aimagcenter", out: "aimagcenter", fields: "aimag_code,center_nam" },
];

for (const j of JOBS) {
  const args = [CLI, join(EIC, j.src, `${j.src}.shp`), "encoding=utf8", "-filter-fields", j.fields];
  if (j.simplify) args.push("-simplify", j.simplify, "keep-shapes", "-clean");
  // countryboundary, soumcenter, aimagcenter нь UTM 48N, бусад нь WGS84 — бүгдийг WGS84 болгоно
  args.push("-proj", "wgs84", "-o", join(OUT, `${j.out}.geojson`), "format=geojson", "precision=0.00001");
  execFileSync(process.execPath, args, { stdio: ["ignore", "ignore", "inherit"] });
  console.log(`${j.out}.geojson  ${(statSync(join(OUT, `${j.out}.geojson`)).size / 1024).toFixed(0)} KB`);
}
