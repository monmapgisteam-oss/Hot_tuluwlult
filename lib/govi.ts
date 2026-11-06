// Улс даяарх гол, нуур, газар тариалан, ТХГН. Нэвтрэлт шаардахгүй, CORS зөвшөөрдөг (2026-11-06 шалгасан).
// Сервер хоригт (lib/server/prepare.ts), хөтөч газрын зургийн давхаргад (components/MapPane.tsx) ашиглана.
export const GOVI_URL = "https://arcgis.ubhub.mn/arcgis/rest/services/Hosted/govi_generel_info/FeatureServer";
export const GOVI_LAYER = { river: 24, lake: 27, cropland: 29, protected: 30 } as const;
/** Нуурын давхаргад status=Land мөр байдаг */
export const LAKE_WHERE = "status='Water'";
