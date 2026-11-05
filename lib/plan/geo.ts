// Бөөрөлжүүтийн geo.ts-ээс зөвхөн төрлүүд: өгөгдлийг манай сервер өгнө.
export type XY = [number, number];
export type Seg = [number, number, number, number];
export type Feat = { attributes: Record<string, unknown>; geometry: { paths?: XY[][]; rings?: XY[][]; x?: number; y?: number } };
