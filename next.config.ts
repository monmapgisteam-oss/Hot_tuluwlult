import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker-т зөвхөн хэрэгтэй файлуудыг багцална; Vercel өөрөө багцалдаг
  ...(process.env.BUILD_STANDALONE ? { output: "standalone" as const } : {}),
  reactStrictMode: false, // ArcGIS MapView-г давхар үүсгэхгүй (Бөөрөлжүүттэй ижил)
  devIndicators: false, // Next-ийн тэмдэг цэсний доод буланг дардаг
  // Next 16 dev горимд localhost-оос өөр хаягийн хүсэлтийг хаадаг — энэ компьютерийн өөрийн IP хаягаар нээх боломжтой байлгана
  allowedDevOrigins: Object.values(networkInterfaces()).flat().flatMap((i) => (i?.family === "IPv4" ? [i.address] : [])),
  serverExternalPackages: ["geotiff"],
  outputFileTracingIncludes: { "/api/prepare": ["./public/data/*.geojson", "./data/infra/*.json"] },
};

export default nextConfig;
