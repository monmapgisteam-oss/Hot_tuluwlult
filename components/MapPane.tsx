"use client";
// ArcGIS газрын зураг: EIC-ийн аймаг, сумын хил, полигон зурах (SketchViewModel), үр дүнгийн нүднүүд.
import "@arcgis/core/assets/esri/themes/light/main.css";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import EsriMap from "@arcgis/core/Map";
import Basemap from "@arcgis/core/Basemap";
import Graphic from "@arcgis/core/Graphic";
import Extent from "@arcgis/core/geometry/Extent";
import Polygon from "@arcgis/core/geometry/Polygon";
import { geographicToWebMercator, webMercatorToGeographic } from "@arcgis/core/geometry/support/webMercatorUtils";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Ground from "@arcgis/core/Ground";
import ElevationLayer from "@arcgis/core/layers/ElevationLayer";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import BasemapGallery from "@arcgis/core/widgets/BasemapGallery";
import LocalBasemapsSource from "@arcgis/core/widgets/BasemapGallery/support/LocalBasemapsSource";
import Expand from "@arcgis/core/widgets/Expand";
import ScaleBar from "@arcgis/core/widgets/ScaleBar";
import SketchViewModel from "@arcgis/core/widgets/Sketch/SketchViewModel";
import Zoom from "@arcgis/core/widgets/Zoom";
import proj4 from "proj4";
import type { Plan } from "@/lib/plan/urban";
import type { PlanDim, PlanLayerKey } from "@/lib/plan/planLayers";
import { LEVELS, aspectDir, FLAT_SLOPE, catName, FACTORS, fmtN, type Prepared, type Summary } from "@/lib/suit.ts";

export type MapHandle = {
  startDraw(): void;
  clearDraw(): void;
  zoomTo(b: [number, number, number, number]): void;
};
type LonLatRings = [number, number][][];

const RESULT_ID = "suit-result";
const ELEVATION_URL = "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer";
// Портал нэвтрэлтгүй ажиллах локал жагсаалт (Бөөрөлжүүтийн MapCanvas-тай ижил). dark — хил цагаанаар харагдах суурь.
const BASEMAPS = [
  { id: "satellite", title: "Хиймэл дагуул", dark: true }, // анхдагч: нэр шошгогүй Imagery
  { id: "hybrid", title: "Хиймэл дагуул, нэртэй", dark: true },
  { id: "topo-vector", title: "Байрзүйн", dark: false },
  { id: "streets-vector", title: "Гудамж", dark: false },
  { id: "gray-vector", title: "Цайвар саарал", dark: false },
  { id: "dark-gray-vector", title: "Бараан саарал", dark: true },
  { id: "osm", title: "OpenStreetMap", dark: false },
];
/** Хилийн өнгөн суурьтай тодрох өнгө: бараан суурьт цагаан, цайвар суурьт бараан */
const boundaryRenderer = (dark: boolean, kind: "aimag" | "soum") => ({
  type: "simple",
  symbol: {
    type: "simple-fill", color: [0, 0, 0, 0],
    outline: kind === "aimag"
      ? { color: dark ? [255, 255, 255, 0.95] : [31, 41, 55, 0.9], width: 1.6 }
      : { color: dark ? [255, 255, 255, 0.6] : [31, 41, 55, 0.55], width: 0.7, style: "dash" },
  },
});
const dataUrl = (name: string) => new URL(`/data/${name}.geojson`, window.location.href).href;
const merc = (lon: number, lat: number): [number, number] => {
  const R = 6378137;
  return [(R * lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
};

/** UTM нүднүүдийн булангуудыг Web Mercator руу хөрвүүлнэ */
function cellRings(p: Prepared) {
  const tr = proj4(`+proj=utm +zone=${p.utmZone}${p.epsg >= 32700 ? " +south" : ""} +datum=WGS84 +units=m +no_defs`);
  const h = p.cell / 2;
  const toM = (x: number, y: number) => { const [a, b] = tr.inverse([x, y]); return merc(a, b); };
  return Array.from({ length: p.n }, (_, i) => {
    const x = p.x[i], y = p.y[i];
    return [toM(x - h, y - h), toM(x - h, y + h), toM(x + h, y + h), toM(x + h, y - h), toM(x - h, y - h)];
  });
}

export default function MapPane({
  ref, prep, res, levels, opacity, visible, plan, planLayers, dim, onPolygon, onDrawing,
}: {
  dim: PlanDim;
  visible: boolean;
  plan: Plan | null;
  planLayers: Record<PlanLayerKey, boolean>;
  ref: Ref<MapHandle>;
  prep: Prepared | null;
  res: Summary | null;
  levels: number[];
  opacity: number;
  onPolygon: (rings: LonLatRings | null) => void;
  onDrawing: (on: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const world = useRef<{ map: EsriMap; sketch: GraphicsLayer; under: GeoJSONLayer; aimag: GeoJSONLayer; soum: GeoJSONLayer; basemaps: { basemap: Basemap; dark: boolean }[] } | null>(null);
  const stage = useRef<{ map: EsriMap; view: MapView | SceneView; sketch: GraphicsLayer; svm: SketchViewModel; under: GeoJSONLayer } | null>(null);
  const camera = useRef<Extent | null>(null);
  const planRefs = useRef<Map<PlanLayerKey, FeatureLayer[]>>(new Map());
  const planLayersRef = useRef(planLayers);
  const wkidRef = useRef(32648);
  if (prep) wkidRef.current = prep.epsg;
  planLayersRef.current = planLayers;
  const resultLayer = useRef<FeatureLayer | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; i?: number; plan?: { t: string; c: string; r: [string, string][] } } | null>(null);
  const cb = useRef({ onPolygon, onDrawing });
  cb.current = { onPolygon, onDrawing };
  const last = useRef("");
  const flown = useRef<Plan | null>(null);

  useEffect(() => {
    const aimag = new GeoJSONLayer({
      url: dataUrl("aimag"), title: "Аймгийн хил", outFields: ["aimag_name"],
      renderer: boundaryRenderer(true, "aimag") as never,
      labelingInfo: [{
        labelExpressionInfo: { expression: "$feature.aimag_name" }, minScale: 0, maxScale: 3000000,
        symbol: { type: "text", color: "#ffffff", haloColor: "#1f2937", haloSize: 0.75, font: { size: 8.5, weight: "bold" } },
      }] as never,
    });
    const soum = new GeoJSONLayer({
      url: dataUrl("soum"), title: "Сумын хил", minScale: 6000000, outFields: ["soum_name", "aimag_name"],
      renderer: boundaryRenderer(true, "soum") as never,
    });
    // Сумын нэр зөвхөн сумын төвийн цэгээс — давхар шошго гаргахгүй
    const centers = new GeoJSONLayer({
      url: dataUrl("soumcenter"), title: "Сумын төв", minScale: 3000000, outFields: ["center_nam"],
      renderer: { type: "simple", symbol: { type: "simple-marker", size: 5, color: "#fbbf24", outline: { color: "#1f2937", width: 0.7 } } } as never,
      labelingInfo: [{
        labelExpressionInfo: { expression: "$feature.center_nam" }, labelPlacement: "above-center",
        symbol: { type: "text", color: "#ffffff", haloColor: "#1f2937", haloSize: 0.75, font: { size: 8 } },
      }] as never,
    });
    const sketch = new GraphicsLayer({ title: "Зурсан полигон" });
    const basemaps = BASEMAPS.flatMap((b) => {
      const m = Basemap.fromId(b.id);
      if (!m) return [];
      // Esri-ийн портал ачаалагдахдаа нэрийг англиар дарж бичдэг тул дараа нь монголоор тавина
      m.title = b.title;
      m.load().then(() => { m.title = b.title; }).catch(() => {});
      return [{ ...b, basemap: m }];
    });
    const map = new EsriMap({
      basemap: basemaps[0].basemap, layers: [soum, aimag, centers, sketch],
      ground: new Ground({ layers: [new ElevationLayer({ url: ELEVATION_URL })] }), // зөвхөн 3D-д нөлөөлнө
    });
    world.current = { map, sketch, under: soum, aimag, soum, basemaps };
    camera.current = geographicToWebMercator(new Extent({ xmin: 87, ymin: 41, xmax: 120.5, ymax: 52.5, spatialReference: { wkid: 4326 } })) as Extent;
    return () => { world.current = null; map.destroy(); };
  }, []);

  // View-г 2D/3D-ээр солиход map, давхаргууд хэвээр үлдэнэ
  useEffect(() => {
    const w = world.current;
    if (!box.current || !w) return;
    const { map, sketch, aimag, soum, basemaps } = w;
    const view: MapView | SceneView = dim === "3d"
      ? new SceneView({
        container: box.current, map, popupEnabled: false, viewingMode: "global", ui: { components: ["attribution"] },
        qualityProfile: "medium",
        // Эх төслийн адил: тогтмол зуны өдрийн нар, хэрэглэгчийн цагаас хамаарч харанхуйлахгүй
        environment: { atmosphereEnabled: true, starsEnabled: false, lighting: { type: "sun", date: new Date("2026-07-15T08:00:00Z"), directShadowsEnabled: false, cameraTrackingEnabled: false } } as never,
      })
      : new MapView({
        container: box.current, map, popupEnabled: false, extent: camera.current ?? undefined,
        constraints: { rotationEnabled: false, snapToZoom: false }, ui: { components: ["attribution"] },
      });
    if (dim === "3d" && camera.current) {
      const target = planRefs.current.get("site")?.[0]?.source?.getItemAt(0)?.geometry?.extent?.clone().expand(1.25) ?? camera.current;
      view.when(() => (view as SceneView).goTo({ target, tilt: 58 }, { animate: false })).catch(() => {});
    }
    view.ui.add(new Zoom({ view }), "top-right");
    const gallery = new BasemapGallery({ view, source: new LocalBasemapsSource({ basemaps: basemaps.map((b) => b.basemap) }) });
    view.ui.add(new Expand({ view, content: gallery, expandTooltip: "Суурь зураг", collapseTooltip: "Хаах", expandIcon: "basemap" }), "top-right");
    // Суурь зураг солигдоход хилийн өнгийг тааруулна
    const basemapWatch = reactiveUtils.watch(() => map.basemap, (current) => {
      const dark = basemaps.find((b) => b.basemap === current)?.dark ?? true;
      aimag.renderer = boundaryRenderer(dark, "aimag") as never;
      soum.renderer = boundaryRenderer(dark, "soum") as never;
    });
    if (view instanceof MapView) view.ui.add(new ScaleBar({ view, unit: "metric" }), "bottom-left"); // ScaleBar зөвхөн 2D-д

    const svm = new SketchViewModel({
      view, layer: sketch, updateOnGraphicClick: true,
      polygonSymbol: { type: "simple-fill", color: [249, 115, 22, 0.08], outline: { color: [249, 115, 22, 1], width: 2.25 } } as never,
      defaultCreateOptions: { mode: "click" }, defaultUpdateOptions: { tool: "reshape", toggleToolOnClick: false },
    });
    const emit = (g: unknown) => {
      if (!g) return;
      const geo = webMercatorToGeographic(g as Polygon) as Polygon;
      const rings = geo.rings.map((r) => r.map((p) => [p[0], p[1]] as [number, number]));
      const key = JSON.stringify(rings);
      if (key === last.current) return; // өөрчлөгдөөгүй бол дахин шинжлэхгүй
      last.current = key;
      cb.current.onPolygon(rings);
    };
    svm.on("create", (e) => {
      if (e.state === "complete") { cb.current.onDrawing(false); emit(e.graphic?.geometry); }
      if (e.state === "cancel") cb.current.onDrawing(false);
    });
    svm.on("update", (e) => { if (e.state === "complete" && !e.aborted) emit(e.graphics[0]?.geometry); });

    // Нүд дээгүүр хулгана — утга харуулна
    let pending = false;
    view.on("pointer-move", (e) => {
      const layer = resultLayer.current;
      const include = [...(layer ? [layer] : []), ...[...planRefs.current.values()].flat()].filter((l) => l.visible);
      if (!include.length || pending || svm.state === "active") return;
      pending = true;
      view.hitTest({ x: e.x, y: e.y }, { include }).then((h) => {
        const hits = h.results.flatMap((r) => ("graphic" in r ? [r.graphic] : []));
        const g = hits.find((v) => v.attributes?.tip) ?? hits.find((v) => v.attributes?.i != null);
        if (!g) { setTip(null); return; }
        setTip(g.attributes.tip ? { x: e.x, y: e.y, plan: JSON.parse(g.attributes.tip) } : { x: e.x, y: e.y, i: Number(g.attributes.i) });
      }).catch(() => setTip(null)).finally(() => { pending = false; });
    });
    view.on("pointer-leave", () => setTip(null));

    stage.current = { map, view, sketch, svm, under: w.under };
    return () => {
      basemapWatch.remove();
      svm.destroy();
      if (view.extent) camera.current = view.extent.clone();
      stage.current = null;
      view.map = null as never; // view.destroy() map-ыг хамт устгахаас сэргийлнэ
      view.destroy();
    };
  }, [dim]);

  useImperativeHandle(ref, () => ({
    startDraw() {
      const s = stage.current;
      if (!s) return;
      s.svm.cancel();
      s.sketch.removeAll();
      last.current = "";
      setTip(null);
      cb.current.onPolygon(null);
      cb.current.onDrawing(true);
      s.svm.create("polygon");
    },
    clearDraw() {
      const s = stage.current;
      if (!s) return;
      s.svm.cancel();
      s.sketch.removeAll();
      last.current = "";
      setTip(null);
      cb.current.onDrawing(false);
      cb.current.onPolygon(null);
    },
    zoomTo([w, s, e, n]) {
      const ext = geographicToWebMercator(new Extent({ xmin: w, ymin: s, xmax: e, ymax: n, spatialReference: { wkid: 4326 } }));
      stage.current?.view.goTo((ext as Extent).clone().expand(1.15), { duration: 700 }).catch(() => {});
    },
  }), []);

  // Полигон шинэчлэгдэхэд геометрийг нэг л удаа тооцно
  const rings = useMemo(() => (prep ? cellRings(prep) : null), [prep]);

  // Үр дүнгийн давхарга — жин, хориг өөрчлөгдөхөд шинэчилнэ
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    const drop = () => {
      const old = s.map.findLayerById(RESULT_ID);
      if (old) { s.map.remove(old); old.destroy(); }
      resultLayer.current = null;
    };
    if (!prep || !res || !rings) { drop(); setTip(null); return; }
    const t = setTimeout(() => {
      const source: Graphic[] = [];
      for (let i = 0; i < prep.n; i++) {
        const level = res.cells[i].level;
        if (!level) continue;
        source.push(new Graphic({
          geometry: new Polygon({ rings: [rings[i]], spatialReference: { wkid: 102100 } }),
          attributes: { oid: i + 1, i, level },
        }));
      }
      drop();
      const layer = new FeatureLayer({
        id: RESULT_ID, title: "Тохиромж", geometryType: "polygon", spatialReference: { wkid: 102100 }, objectIdField: "oid",
        fields: [{ name: "oid", type: "oid" }, { name: "i", type: "integer" }, { name: "level", type: "integer" }] as never,
        source, outFields: ["*"], popupEnabled: false, opacity, visible,
        copyright: "Copernicus DEM · ESA WorldCover · © OpenStreetMap contributors · EIC",
        definitionExpression: levels.length === 5 ? "1=1" : levels.length ? `level IN (${levels.join(",")})` : "1=0",
        renderer: {
          type: "unique-value", field: "level",
          uniqueValueInfos: LEVELS.map((l) => ({ value: l.n, label: `${l.n} · ${l.label}`, symbol: { type: "simple-fill", color: l.color, outline: { width: 0 } } })),
        } as never,
      });
      s.map.add(layer, 0); // хил, зурсан полигон дээр нь харагдана
      resultLayer.current = layer;
    }, 150);
    return () => clearTimeout(t);
    // levels, opacity-г давхаргыг дахин үүсгэхгүйгээр доорх effect-ээр хэрэглэнэ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prep, res, rings]);

  useEffect(() => {
    const l = resultLayer.current;
    if (l) l.definitionExpression = levels.length === 5 ? "1=1" : levels.length ? `level IN (${levels.join(",")})` : "1=0";
  }, [levels]);
  // Төлөвлөгөөний давхаргууд: тохиромжийн давхарга дээр, хилийн доор
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    let live = true;
    const clear = () => {
      for (const l of [...planRefs.current.values()].flat()) { s.map.remove(l); l.destroy(); }
      planRefs.current = new Map();
    };
    clear();
    setTip(null);
    if (!plan) { flown.current = null; return; }
    void import("@/lib/plan/planLayers").then(({ buildPlanLayers }) => {
      if (!live) return;
      const built = buildPlanLayers(plan, wkidRef.current, dim);
      const order: PlanLayerKey[] = ["ground", "zones", "streets", "storm", "water", "sewer", "heat", "power", "trees", "buildings", "site"];
      for (const k of order) for (const l of built.get(k) ?? []) {
        l.visible = planLayersRef.current[k];
        s.map.add(l, s.map.layers.indexOf(s.under));
      }
      planRefs.current = built;
      // Шинэ төлөвлөгөө дээр нэг удаа ойртоно; 2D/3D солиход камер хэвээр
      if (flown.current === plan) return;
      flown.current = plan;
      const site = built.get("site")?.[0]?.source?.getItemAt(0)?.geometry?.extent?.clone().expand(1.25);
      if (site) (s.view as MapView).goTo(dim === "3d" ? ({ target: site, tilt: 58 } as never) : site, { duration: 900 }).catch(() => {});
    }).catch((e) => console.error("[plan layers]", e));
    return () => { live = false; };
  }, [plan, dim]);
  useEffect(() => {
    for (const [k, list] of planRefs.current) for (const l of list) l.visible = planLayers[k];
    setTip(null);
  }, [planLayers]);

  useEffect(() => { if (resultLayer.current) resultLayer.current.opacity = opacity; }, [opacity]);
  useEffect(() => {
    if (resultLayer.current) resultLayer.current.visible = visible;
    if (!visible) setTip(null);
  }, [visible]);

  return (
    <div className="mapWrap">
      <div ref={box} className="map" />
      {tip?.plan && <PlanTip info={tip.plan} x={tip.x} y={tip.y} w={box.current?.clientWidth ?? 0} h={box.current?.clientHeight ?? 0} />}
      {tip?.i != null && prep && res && <CellTip prep={prep} res={res} i={tip.i} x={tip.x} y={tip.y} w={box.current?.clientWidth ?? 0} h={box.current?.clientHeight ?? 0} />}
    </div>
  );
}

function PlanTip({ info, x, y, w, h }: { info: { t: string; c: string; r: [string, string][] }; x: number; y: number; w: number; h: number }) {
  return (
    <div className="tip" style={{ left: x + 14, top: y + 14, transform: `translate(${x > w - 310 ? "calc(-100% - 28px)" : "0"}, ${y > h - 200 ? "calc(-100% - 28px)" : "0"})` }}>
      <div className="tipHead"><i style={{ background: info.c }} />{info.t}</div>
      {info.r.map(([k, v]) => <div className="tipRow" key={k}><span>{k}</span><b>{v}</b></div>)}
    </div>
  );
}

function CellTip({ prep, res, i, x, y, w, h }: { prep: Prepared; res: Summary; i: number; x: number; y: number; w: number; h: number }) {
  const c = res.cells[i];
  if (!c?.level) return null;
  const l = LEVELS[c.level - 1];
  const slope = prep.num.slope[i];
  const lc = prep.cat.landcover;
  const f = FACTORS.find((v) => v.key === "landcover")!;
  const lcValue = lc && lc.idx[i] >= 0 ? catName(f, lc.dict[lc.idx[i]]) : "—";
  const rows: [string, string][] = [
    ...(c.why ? [["Хориг", c.why] as [string, string]] : [["Оноо", `${Math.round(c.score * 100)} / 100`] as [string, string]]),
    ...(c.weak && !c.why ? [["Гол сул тал", c.weak] as [string, string]] : []),
    ["Налуу", `${fmtN(slope, 1)} %`],
    ["Зүг", slope < FLAT_SLOPE ? "Хавтгай" : aspectDir(prep.num.aspect[i])[0]],
    ["Өндөр", `${fmtN(prep.num.elevM[i])} м`],
    ["Урсацын хуримтлал", `${fmtN(prep.num.flow[i], 1)} га`],
    ["Газрын бүрхэвч", lcValue],
  ];
  return (
    <div className="tip" style={{ left: x + 14, top: y + 14, transform: `translate(${x > w - 310 ? "calc(-100% - 28px)" : "0"}, ${y > h - 200 ? "calc(-100% - 28px)" : "0"})` }}>
      <div className="tipHead"><i style={{ background: l.color }} />{l.n}-р түвшин · {l.label}</div>
      {rows.map(([k, v]) => <div className="tipRow" key={k}><span>{k}</span><b>{v}</b></div>)}
    </div>
  );
}
