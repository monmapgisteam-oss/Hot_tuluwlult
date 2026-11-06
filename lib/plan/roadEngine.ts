/**
 * roadEngine.ts
 * TypeScript port of the CityEngine "Street_Modern" CGA rules (Street / Lane / Node / Elements).
 * Framework-agnostic: input = centerlines in a projected metric CRS (e.g. EPSG:32648),
 * output = GeoJSON-like FeatureCollection (polygons/lines/points + render properties).
 */

// ───────────────────────────── Types ─────────────────────────────
export type Vec2 = [number, number];
export type Traffic = 'right-hand' | 'left-hand';
export type LaneKind = 'car' | 'bus' | 'bike' | 'parking' | 'buffer' | 'shoulder' | 'vegetation' | 'sidewalk' | 'median';
export type TravelDir = 'forward' | 'reverse' | 'both' | 'none';
export type LineStyle = 'none' | 'continuous' | 'dashed' | 'continuous-double' | 'dashed-double';
export type CrosswalkType = 'none' | 'continental' | 'ladder' | 'transverse' | 'dashed' | 'solid';
export type StopMarking = 'none' | 'line only' | 'with stop marking' | 'arrows on all lanes' | 'arrows on side lanes' | 'arrows for right turn';
export type ParkingType = 'parallel' | 'perpendicular' | 'diagonal';
export type ItemType = 'tree' | 'lamp' | 'bench' | 'bollard' | 'bike-rack';
export type Movement = 'left' | 'straight' | 'right';

export interface LaneSpec {
  kind: LaneKind;
  width: number;
  dir?: TravelDir;                // vehicle lanes: travel direction relative to the digitized centerline
  curbHeight?: number;            // > 0 = raised lane (sidewalk, median, planting strip)
  surface?: string;               // colour override
  symbol?: 'bike' | 'bus';
  parking?: ParkingType;
  items?: { type: ItemType; spacing: number; offsetAcross?: number }[];
}

export interface RoadMode {
  id: string;
  label: string;
  cityEngineShape: 'Street' | 'Freeway' | 'FreewayEntry';
  designSpeed: number;            // km/h → minimum horizontal curve radius
  lanes: LaneSpec[];              // left edge → right edge, looking along the digitizing direction
  centerline: 'yellow' | 'white' | 'none';
  laneLine: LineStyle;            // between same-direction lanes
  edgeLine: LineStyle;            // between traffic lane and shoulder
  dash: [number, number];         // dash, gap (m)
  cornerRadius: number;           // curb-return radius at intersections (m)
  crosswalk: CrosswalkType;       // default at intersection ends
  stop: StopMarking;              // default at intersection ends
}

export interface EndConfig { crosswalk?: CrosswalkType; stop?: StopMarking }

export interface RoadInput {
  id: string;
  path: Vec2[];
  mode: RoadMode | string;
  start?: EndConfig;
  end?: EndConfig;
  smoothRadius?: number;          // fillet radius for horizontal curves (default = min radius for design speed)
}

export interface NodeSpec {
  at: Vec2;
  type?: 'junction' | 'roundabout';
  cornerRadius?: number;
  roundabout?: { islandRadius: number; ringLanes: number; laneWidth?: number };
}

export interface NetworkInput { traffic?: Traffic; roads: RoadInput[]; nodes?: NodeSpec[]; turnPaths?: boolean }

export type Layer = 'surface' | 'curb' | 'marking' | 'crosswalk' | 'stopline' | 'arrow' | 'symbol'
  | 'junction' | 'island' | 'item' | 'turnPath';

export interface Props {
  layer: Layer; kind?: string; roadId?: string; color: string;
  base: number;                   // bottom elevation (m)
  height: number;                 // extrusion (m), 0 = flat
  rotation?: number;              // degrees, math convention (0 = +X / east, ccw)
  text?: string;
  [k: string]: unknown;
}
export type Geometry =
  | { type: 'Polygon'; coordinates: Vec2[][] }
  | { type: 'LineString'; coordinates: Vec2[] }
  | { type: 'Point'; coordinates: Vec2 };
export interface Feature { type: 'Feature'; geometry: Geometry; properties: Props }
export interface FeatureCollection { type: 'FeatureCollection'; features: Feature[]; meta: Record<string, unknown> }

// ──────────────────── Constants taken from the CGA files ────────────────────
export const CGA = {
  curbHeight: 0.1, curbWidth: 0.1,                  // Lane_Queries.defaultCurbHeight / defaultCurbWidth
  lineWidth: 0.15, lineDistance: 0.15,              // Line_Marking.Line_Width / Line_Distance
  dash: 3, gap: 3,                                  // Line_Marking.Dash_Length / Gap_Length
  stopLine: 0.5, stopZone: 14, centerSolidZone: 21, // Street_Modern_Standard: _stopBegin*0.5, 14 m stop texture, 21 m single_white
  crosswalk: 3.5, crosswalkWide: 4.5,               // _crosswalkWidth (wide when > 3 lanes)
  zebraBar: 1.0, zebraGap: 0.8, zebraMargin: 0.3,   // Zebra_Crossing
  transverseBar: 0.3,
  parkingWidth: 2.3, parkingLength: 5.5,            // Parking.Width / Length
  parkingAngle: { parallel: 0, perpendicular: 90, diagonal: 45 } as Record<ParkingType, number>,
  symbolSpacing: 15,                                // Lane_Symbol.Spacing
  markingOffset: 0.01,                              // Street_Materials.marking_vertical_offset
  hatchSpacing: 3,                                  // Lane_Fill_Pattern (buffer)
};

export const COLORS: Record<string, string> = {
  asphalt: '#3b3e42', redAsphalt: '#a3302a', greenAsphalt: '#4f7a4a',
  lightConcrete: '#c9c8c3', darkConcrete: '#5b5f63', curb: '#9a9da0',
  grass: '#5d8b3c', soil: '#6b4f32',
  white: '#f4f4f2', yellow: '#f0c400', turnPath: '#00a2ff',
  tree: '#3f7d3a', lamp: '#6e7378', bench: '#8a6a45', bollard: '#222222', bikeRack: '#555555',
};

// ───────────────────────────── Road modes (presets) ─────────────────────────────
const sw = (w: number, items: LaneSpec['items'] = []): LaneSpec => ({ kind: 'sidewalk', width: w, curbHeight: CGA.curbHeight, items });
const car = (dir: TravelDir, w = 3.5): LaneSpec => ({ kind: 'car', width: w, dir });

export const ROAD_MODES: Record<string, RoadMode> = {
  alley: {
    id: 'alley', label: 'Alley / Lane (unmarked)', cityEngineShape: 'Street', designSpeed: 20,
    lanes: [sw(1.5), { kind: 'car', width: 5, dir: 'both' }, sw(1.5)],
    centerline: 'none', laneLine: 'none', edgeLine: 'none', dash: [3, 3],
    cornerRadius: 4, crosswalk: 'none', stop: 'none',
  },
  street: {
    id: 'street', label: 'Local street', cityEngineShape: 'Street', designSpeed: 40,
    lanes: [sw(2.5, [{ type: 'lamp', spacing: 25 }]), car('reverse', 3.25), car('forward', 3.25), sw(2.5, [{ type: 'lamp', spacing: 25 }])],
    centerline: 'yellow', laneLine: 'dashed', edgeLine: 'continuous', dash: [3, 3],
    cornerRadius: 6, crosswalk: 'continental', stop: 'line only',
  },
  collector: {
    id: 'collector', label: 'Collector street (parking)', cityEngineShape: 'Street', designSpeed: 50,
    lanes: [
      sw(3, [{ type: 'lamp', spacing: 20 }, { type: 'bench', spacing: 40, offsetAcross: 0.8 }]),
      { kind: 'parking', width: 2.4, dir: 'reverse', parking: 'parallel' },
      car('reverse'), car('forward'),
      { kind: 'parking', width: 2.4, dir: 'forward', parking: 'parallel' },
      sw(3, [{ type: 'lamp', spacing: 20 }]),
    ],
    centerline: 'yellow', laneLine: 'dashed', edgeLine: 'continuous', dash: [3, 3],
    cornerRadius: 8, crosswalk: 'continental', stop: 'with stop marking',
  },
  avenue: {
    id: 'avenue', label: 'Avenue (bike lanes)', cityEngineShape: 'Street', designSpeed: 60,
    lanes: [
      sw(3.5, [{ type: 'tree', spacing: 10, offsetAcross: -0.8 }, { type: 'lamp', spacing: 25, offsetAcross: -0.8 }]),
      { kind: 'bike', width: 1.8, dir: 'reverse', symbol: 'bike', surface: COLORS.redAsphalt },
      { kind: 'buffer', width: 0.6 },
      car('reverse'), car('reverse'), car('forward'), car('forward'),
      { kind: 'buffer', width: 0.6 },
      { kind: 'bike', width: 1.8, dir: 'forward', symbol: 'bike', surface: COLORS.redAsphalt },
      sw(3.5, [{ type: 'tree', spacing: 10, offsetAcross: 0.8 }, { type: 'lamp', spacing: 25, offsetAcross: 0.8 }]),
    ],
    centerline: 'yellow', laneLine: 'dashed', edgeLine: 'continuous', dash: [3, 3],
    cornerRadius: 10, crosswalk: 'continental', stop: 'arrows on all lanes',
  },
  boulevard: {
    id: 'boulevard', label: 'Boulevard (planted median, bus lanes)', cityEngineShape: 'Street', designSpeed: 60,
    lanes: [
      sw(4.5, [{ type: 'tree', spacing: 8, offsetAcross: -1 }, { type: 'lamp', spacing: 24, offsetAcross: -1 }, { type: 'bench', spacing: 48, offsetAcross: 1 }]),
      { kind: 'bus', width: 3.5, dir: 'reverse', symbol: 'bus' },
      car('reverse'), car('reverse'),
      { kind: 'vegetation', width: 6, curbHeight: CGA.curbHeight, items: [{ type: 'tree', spacing: 8 }, { type: 'lamp', spacing: 32 }] },
      car('forward'), car('forward'),
      { kind: 'bus', width: 3.5, dir: 'forward', symbol: 'bus' },
      sw(4.5, [{ type: 'tree', spacing: 8, offsetAcross: 1 }, { type: 'lamp', spacing: 24, offsetAcross: 1 }]),
    ],
    centerline: 'none', laneLine: 'dashed', edgeLine: 'continuous', dash: [3, 3],
    cornerRadius: 12, crosswalk: 'ladder', stop: 'arrows on side lanes',
  },
  highway: {
    id: 'highway', label: 'Highway / Freeway (divided)', cityEngineShape: 'Freeway', designSpeed: 100,
    lanes: [
      { kind: 'shoulder', width: 2.5 },
      car('reverse', 3.75), car('reverse', 3.75), car('reverse', 3.75),
      { kind: 'shoulder', width: 1.0 },
      { kind: 'median', width: 0.8, curbHeight: 0.8, surface: COLORS.darkConcrete },   // concrete barrier
      { kind: 'shoulder', width: 1.0 },
      car('forward', 3.75), car('forward', 3.75), car('forward', 3.75),
      { kind: 'shoulder', width: 2.5 },
    ],
    centerline: 'none', laneLine: 'dashed', edgeLine: 'continuous', dash: [4, 8],
    cornerRadius: 0, crosswalk: 'none', stop: 'none',
  },
  ramp: {
    id: 'ramp', label: 'Highway ramp (FreewayEntry)', cityEngineShape: 'FreewayEntry', designSpeed: 60,
    lanes: [{ kind: 'shoulder', width: 1.0 }, car('forward', 4.0), { kind: 'shoulder', width: 2.5 }],
    centerline: 'none', laneLine: 'dashed', edgeLine: 'continuous', dash: [4, 8],
    cornerRadius: 0, crosswalk: 'none', stop: 'none',
  },
};

/** OSM import (mirrors Street_Modern_Simple_for_OpenStreetMap_Import.cga: oneway + lanes tags). */
export function modeFromOSM(tags: Record<string, string>): RoadMode {
  const map: Record<string, string> = {
    motorway: 'highway', trunk: 'highway', motorway_link: 'ramp', trunk_link: 'ramp',
    primary: 'boulevard', secondary: 'avenue', tertiary: 'collector',
    residential: 'street', unclassified: 'street', living_street: 'alley', service: 'alley',
  };
  const base = ROAD_MODES[map[tags.highway] ?? 'street'];
  const lanes = Number(tags.lanes);
  const oneway = tags.oneway === 'yes';
  if (!lanes && !oneway) return base;
  return withLaneCount(base, lanes || base.lanes.filter(isVehicle).length, oneway);
}

/** Rebuild a mode with n vehicle lanes (like CGA NbrOfRightLanes / nLanesTotal). */
export function withLaneCount(mode: RoadMode, n: number, oneway = false): RoadMode {
  const veh = mode.lanes.filter(isVehicle);
  const w = veh[0]?.width ?? 3.5;
  const right = oneway ? n : Math.round(n / 2 + 0.01);          // _getInitialRightLanes
  const left = n - right;
  const firstVeh = mode.lanes.findIndex(isVehicle);
  const lastVeh = mode.lanes.length - 1 - [...mode.lanes].reverse().findIndex(isVehicle);
  const middle: LaneSpec[] = [
    ...Array.from({ length: left }, () => car('reverse', w)),
    ...mode.lanes.slice(firstVeh, lastVeh + 1).filter(l => l.kind === 'median' || l.kind === 'vegetation'),
    ...Array.from({ length: right }, () => car('forward', w)),
  ];
  const lanes = [...mode.lanes.slice(0, firstVeh).filter(l => !oneway || isRaised(l) || l.kind === 'shoulder'), ...middle,
    ...mode.lanes.slice(lastVeh + 1)];
  return { ...mode, id: `${mode.id}-${n}${oneway ? '-oneway' : ''}`, lanes, centerline: oneway ? 'none' : mode.centerline };
}

/** Left-hand traffic: mirror the cross-section (CGA RoadTraffic = "left-hand"). */
export function mirrorMode(mode: RoadMode): RoadMode {
  return { ...mode, lanes: [...mode.lanes].reverse() };
}

// ───────────────────────────── Vector helpers ─────────────────────────────
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const len = (a: Vec2) => Math.hypot(a[0], a[1]);
const norm = (a: Vec2): Vec2 => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const leftN = (d: Vec2): Vec2 => [-d[1], d[0]];
const deg = (r: number) => (r * 180) / Math.PI;
const angleOf = (d: Vec2) => Math.atan2(d[1], d[0]);
const dist = (a: Vec2, b: Vec2) => len(sub(a, b));
const isVehicle = (l: LaneSpec) => l.kind === 'car' || l.kind === 'bus';
const isRaised = (l: LaneSpec) => (l.curbHeight ?? 0) > 0;

function lineIntersect(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const c = cross(d, e);
  if (Math.abs(c) < 1e-9) return null;
  const t = cross(sub(q, p), e) / c;
  return add(p, mul(d, t));
}

/** Points of a circular arc from a to b around center c, taking the shorter sweep. */
function arcPoints(c: Vec2, a: Vec2, b: Vec2, stepDeg = 5): Vec2[] {
  const r = dist(c, a);
  const a0 = angleOf(sub(a, c));
  let sweep = angleOf(sub(b, c)) - a0;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  const n = Math.max(2, Math.ceil(Math.abs(deg(sweep)) / stepDeg));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = a0 + (sweep * i) / n;
    return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)] as Vec2;
  });
}

function circle(c: Vec2, r: number, n = 72, ccw = true): Vec2[] {
  const pts = Array.from({ length: n }, (_, i) => {
    const t = ((ccw ? 1 : -1) * 2 * Math.PI * i) / n;
    return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)] as Vec2;
  });
  return [...pts, pts[0]];
}

// ───────────────────────────── Polyline geometry ─────────────────────────────
export function polylineLength(pts: Vec2[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** Point + unit tangent at station s (distance along the polyline). */
export function sampleAt(pts: Vec2[], s: number): { p: Vec2; t: Vec2 } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (acc + seg >= s || i === pts.length - 1) {
      const t = norm(sub(pts[i], pts[i - 1]));
      const k = Math.min(Math.max(s - acc, 0), seg);
      return { p: add(pts[i - 1], mul(t, k)), t };
    }
    acc += seg;
  }
  return { p: pts[0], t: [1, 0] };
}

/** Sub-polyline between stations s0..s1. */
export function slicePolyline(pts: Vec2[], s0: number, s1: number): Vec2[] {
  if (s1 <= s0) return [];
  const out: Vec2[] = [sampleAt(pts, s0).p];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += dist(pts[i - 1], pts[i]);
    if (acc > s0 && acc < s1) out.push(pts[i]);
  }
  out.push(sampleAt(pts, s1).p);
  return out;
}

/** Parallel offset (positive = left of travel direction), mitred joints with limit. */
export function offsetPolyline(pts: Vec2[], d: number, miterLimit = 4): Vec2[] {
  if (d === 0) return pts.slice();
  const n = pts.length;
  return pts.map((p, i) => {
    const dPrev = i > 0 ? norm(sub(p, pts[i - 1])) : null;
    const dNext = i < n - 1 ? norm(sub(pts[i + 1], p)) : null;
    if (!dPrev) return add(p, mul(leftN(dNext!), d));
    if (!dNext) return add(p, mul(leftN(dPrev), d));
    const n1 = leftN(dPrev), n2 = leftN(dNext);
    const m = norm(add(n1, n2));
    const k = Math.min(1 / Math.max(dot(m, n1), 1e-6), miterLimit);
    return add(p, mul(m, d * k));
  });
}

/** Closed polygon ring of the band between two offsets. */
export function strip(pts: Vec2[], oLeft: number, oRight: number): Vec2[] {
  const a = offsetPolyline(pts, oLeft);
  const b = offsetPolyline(pts, oRight).reverse();
  const ring = [...a, ...b];
  ring.push(ring[0]);
  return ring;
}

/** Thin rectangle around segment a→b. */
function segmentStrip(a: Vec2, b: Vec2, w: number): Vec2[] {
  const n = mul(leftN(norm(sub(b, a))), w / 2);
  return [add(a, n), add(b, n), sub(b, n), sub(a, n), add(a, n)];
}

// ───────────────────────────── 1. Road geometry: horizontal curves ─────────────────────────────
export interface CurveInfo { vertex: number; radius: number; deflectionDeg: number; arcLength: number; turn: 'left' | 'right' }

/** Minimum curve radius R = V² / (127 (e + f)) — e = superelevation, f ≈ side friction (approx.). */
export function minCurveRadius(speedKmh: number, e = 0.06): number {
  const f = Math.max(0.08, 0.2 - 0.0009 * speedKmh);
  return (speedKmh * speedKmh) / (127 * (e + f));
}

/** Replace sharp vertices with circular arcs (fillets) of the given radius. */
export function filletPolyline(pts: Vec2[], radius: number, stepDeg = 5): { points: Vec2[]; curves: CurveInfo[] } {
  if (pts.length < 3 || radius <= 0) return { points: pts.slice(), curves: [] };
  const out: Vec2[] = [pts[0]];
  const curves: CurveInfo[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const A = pts[i - 1], B = pts[i], C = pts[i + 1];
    const u1 = norm(sub(B, A)), u2 = norm(sub(C, B));
    const theta = Math.acos(Math.min(1, Math.max(-1, dot(u1, u2))));
    if (theta < 1e-3) { out.push(B); continue; }
    const maxT = Math.min(dist(A, B), dist(B, C)) / 2;
    let T = radius * Math.tan(theta / 2);
    let R = radius;
    if (T > maxT) { T = maxT; R = T / Math.tan(theta / 2); }
    const P1 = sub(B, mul(u1, T)), P2 = add(B, mul(u2, T));
    const side = cross(u1, u2) > 0 ? 1 : -1;
    const center = add(P1, mul(leftN(u1), R * side));
    out.push(...arcPoints(center, P1, P2, stepDeg));
    curves.push({ vertex: i, radius: R, deflectionDeg: deg(theta), arcLength: R * theta, turn: side > 0 ? 'left' : 'right' });
  }
  out.push(pts[pts.length - 1]);
  return { points: out, curves };
}

// ───────────────────────────── Cross-section ─────────────────────────────
interface Section { lanes: LaneSpec[]; edges: number[]; width: number; roadLeft: number; roadRight: number; outerLeft: number; outerRight: number }

function section(mode: RoadMode): Section {
  const width = mode.lanes.reduce((s, l) => s + l.width, 0);
  const edges = [width / 2];
  mode.lanes.forEach(l => edges.push(edges[edges.length - 1] - l.width));
  // roadway (curb-to-curb) = between the outermost raised non-median lanes
  let i0 = 0, i1 = mode.lanes.length - 1;
  while (i0 < mode.lanes.length && isRaised(mode.lanes[i0]) && mode.lanes[i0].kind !== 'median') i0++;
  while (i1 >= 0 && isRaised(mode.lanes[i1]) && mode.lanes[i1].kind !== 'median') i1--;
  return { lanes: mode.lanes, edges, width, roadLeft: edges[i0], roadRight: edges[i1 + 1], outerLeft: edges[0], outerRight: edges[edges.length - 1] };
}

function surfaceColor(l: LaneSpec): string {
  if (l.surface) return l.surface;
  switch (l.kind) {
    case 'sidewalk': return COLORS.lightConcrete;
    case 'vegetation': return COLORS.grass;
    case 'median': return COLORS.grass;
    default: return COLORS.asphalt;
  }
}

function boundary(a: LaneSpec, b: LaneSpec, mode: RoadMode): { style: LineStyle; color: string } {
  const none = { style: 'none' as LineStyle, color: COLORS.white };
  if (isRaised(a) || isRaised(b)) return none;                       // curb instead of paint
  const va = isVehicle(a), vb = isVehicle(b);
  if (va && vb) {
    if (a.dir === 'both' || b.dir === 'both') return none;
    if (a.dir !== b.dir) {                                            // CGA CenterLine
      if (mode.centerline === 'none') return { style: 'dashed', color: COLORS.white };
      return { style: 'continuous-double', color: mode.centerline === 'yellow' ? COLORS.yellow : COLORS.white };
    }
    if (a.kind === 'bus' || b.kind === 'bus') return { style: 'continuous', color: COLORS.white };
    return { style: mode.laneLine, color: COLORS.white };
  }
  if ((va && b.kind === 'shoulder') || (vb && a.kind === 'shoulder')) return { style: mode.edgeLine, color: COLORS.white };
  if (va || vb || a.kind === 'bike' || b.kind === 'bike') return { style: 'continuous', color: COLORS.white };
  return none;
}

// ───────────────────────────── Feature builder ─────────────────────────────
class Out {
  features: Feature[] = [];
  poly(ring: Vec2[], p: Props, holes: Vec2[][] = []) {
    if (ring.length >= 4) this.features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring, ...holes] }, properties: p });
  }
  line(pts: Vec2[], p: Props) { if (pts.length >= 2) this.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: p }); }
  point(pt: Vec2, p: Props) { this.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: pt }, properties: p }); }
}

// Arrow glyphs (local frame: x = driving direction, y = left), ~5 m long like road arrows
const GLYPH: Record<Movement, Vec2[]> = {
  straight: [[0, -0.15], [3.5, -0.15], [3.5, -0.5], [5, 0], [3.5, 0.5], [3.5, 0.15], [0, 0.15], [0, -0.15]],
  left: [[0, -0.15], [2.9, -0.15], [2.9, 0.6], [3.25, 0.6], [2.75, 1.3], [2.25, 0.6], [2.6, 0.6], [2.6, 0.15], [0, 0.15], [0, -0.15]],
  right: [[0, 0.15], [2.9, 0.15], [2.9, -0.6], [3.25, -0.6], [2.75, -1.3], [2.25, -0.6], [2.6, -0.6], [2.6, -0.15], [0, -0.15], [0, 0.15]],
};
function placeGlyph(g: Vec2[], at: Vec2, heading: Vec2): Vec2[] {
  const n = leftN(heading);
  return g.map(([x, y]) => add(at, add(mul(heading, x), mul(n, y))));
}

/** Lane movements from the CGA stop-marking enum; lanes ordered from driver's left to right. */
export function laneMovements(stop: StopMarking, n: number): Movement[][] {
  return Array.from({ length: n }, (_, i): Movement[] => {
    const first = i === 0, last = i === n - 1;
    switch (stop) {
      case 'arrows on all lanes':
        if (n === 1) return ['left', 'straight', 'right'];
        return first ? ['left', 'straight'] : last ? ['straight', 'right'] : ['straight'];
      case 'arrows on side lanes':
        if (n === 1) return ['left', 'right'];
        return first ? ['left'] : last ? ['right'] : [];
      case 'arrows for right turn':
        return last ? ['right'] : [];
      default: return [];
    }
  });
}

/** Default allowed movements used for turn paths when no arrows are painted. */
function defaultMovements(n: number): Movement[][] {
  return Array.from({ length: n }, (_, i): Movement[] =>
    n === 1 ? ['left', 'straight', 'right'] : i === 0 ? ['left', 'straight'] : i === n - 1 ? ['straight', 'right'] : ['straight']);
}

// ───────────────────────────── 3. Road modes → road features ─────────────────────────────
export function buildRoad(input: RoadInput, out = new Out(), opts: { trimStart?: number; trimEnd?: number } = {}): { out: Out; path: Vec2[]; curves: CurveInfo[]; mode: RoadMode } {
  const mode = typeof input.mode === 'string' ? ROAD_MODES[input.mode] : input.mode;
  if (!mode) throw new Error(`Unknown road mode: ${input.mode}`);
  const radius = input.smoothRadius ?? minCurveRadius(mode.designSpeed);
  const { points: smooth, curves } = filletPolyline(input.path, radius);
  const L0 = polylineLength(smooth);
  const path = slicePolyline(smooth, opts.trimStart ?? 0, L0 - (opts.trimEnd ?? 0));
  const L = polylineLength(path);
  const sec = section(mode);
  const id = input.id;
  const roadwayLanes = mode.lanes.filter(l => !isRaised(l) || l.kind === 'median');
  const nVeh = mode.lanes.filter(isVehicle).length;

  // End zones (crosswalk + stop) — Street_Modern_Standard: split(u){cw/3 | cw | cw/4 | 0.5 | ~1}
  const cwW = nVeh > 3 && L > 10 ? CGA.crosswalkWide : CGA.crosswalk;
  const ends = (['start', 'end'] as const).map(which => {
    const cfg = (which === 'start' ? input.start : input.end) ?? {};
    const crosswalk = cfg.crosswalk ?? 'none';
    const stop = cfg.stop ?? 'none';
    const cw = crosswalk === 'none' ? 0 : cwW;
    const stopW = stop === 'none' ? 0 : CGA.stopLine;
    const zone = cw ? cw / 3 + cw + cw / 4 + stopW : stopW;
    return { which, crosswalk, stop, cw, stopW, zone };
  });
  const [S, E] = ends;
  const station = (which: 'start' | 'end', d: number) => (which === 'start' ? d : L - d);

  // 3a. Lane surfaces, curbs, parking, buffers, symbols, street furniture
  // raised lanes inside the roadway (median / planted strip) stop before the crosswalk (pedestrian cut-through)
  const innerFrom = sec.edges.indexOf(sec.roadLeft), innerTo = sec.edges.indexOf(sec.roadRight);
  const noseS = S.cw ? S.cw / 3 + S.cw + 0.5 : 0, noseE = E.cw ? E.cw / 3 + E.cw + 0.5 : 0;

  mode.lanes.forEach((lane, i) => {
    const oL = sec.edges[i], oR = sec.edges[i + 1], oC = (oL + oR) / 2;
    const raised = isRaised(lane);
    const inner = raised && i >= innerFrom && i < innerTo;
    const [ls, le] = inner ? [noseS, L - noseE] : [0, L];
    if (le - ls < 1) return;
    const lanePath = inner ? slicePolyline(path, ls, le) : path;
    if (inner) for (const [a, b] of [[0, ls], [le, L]]) if (b - a > 0.01)       // asphalt under the cut-through
      out.poly(strip(slicePolyline(path, a, b), oL, oR), { layer: 'surface', kind: 'car', roadId: id, color: COLORS.asphalt, base: 0, height: 0, lane: i, dir: 'none' });
    out.poly(strip(lanePath, oL, oR), { layer: 'surface', kind: lane.kind, roadId: id, color: surfaceColor(lane), base: 0, height: raised ? lane.curbHeight! : 0, lane: i, dir: lane.dir ?? 'none' });
    if (raised) {
      const prev = mode.lanes[i - 1], next = mode.lanes[i + 1];
      const h = lane.curbHeight! + 0.005;
      if (prev && !isRaised(prev)) out.poly(strip(lanePath, oL, oL - CGA.curbWidth), { layer: 'curb', roadId: id, color: COLORS.curb, base: 0, height: h });
      if (next && !isRaised(next)) out.poly(strip(lanePath, oR + CGA.curbWidth, oR), { layer: 'curb', roadId: id, color: COLORS.curb, base: 0, height: h });
    }
    // Lane_Symbol.cga: symbols every 15 m (rotated 90/270 when reversed)
    if (lane.symbol && L > CGA.symbolSpacing) {
      for (let s = CGA.symbolSpacing / 2 + S.zone + 5; s < L - E.zone - 5; s += CGA.symbolSpacing) {
        const { p, t } = sampleAt(path, s);
        const heading = lane.dir === 'reverse' ? mul(t, -1) : t;
        out.point(add(p, mul(leftN(t), oC)), { layer: 'symbol', kind: lane.symbol, text: lane.symbol === 'bus' ? 'BUS' : '🚲', roadId: id, color: COLORS.white, base: CGA.markingOffset, height: 0, rotation: deg(angleOf(heading)) });
      }
    }
    // Parking.cga: stall dividers (angle 0 / 90 / 45)
    if (lane.kind === 'parking') {
      const ang = CGA.parkingAngle[lane.parking ?? 'parallel'];
      const along = ang === 0 ? CGA.parkingLength + CGA.lineWidth : CGA.parkingWidth / Math.sin((ang * Math.PI) / 180) + CGA.lineWidth;
      const slant = ang === 0 || ang === 90 ? 0 : lane.width / Math.tan((ang * Math.PI) / 180);
      for (let s = S.zone + 1; s + slant < L - E.zone - 1; s += along) {
        const a = sampleAt(path, s), b = sampleAt(path, s + slant);
        const near = isVehicle(mode.lanes[i + 1] ?? lane) ? oR : oL, far = near === oR ? oL : oR;
        const p0 = add(a.p, mul(leftN(a.t), near)), p1 = add(b.p, mul(leftN(b.t), far));
        out.poly(segmentStrip(p0, p1, CGA.lineWidth), { layer: 'marking', kind: 'parking', roadId: id, color: COLORS.white, base: CGA.markingOffset, height: 0 });
      }
    }
    // Lane_Fill_Pattern.cga: diagonal hatch in buffer lanes
    if (lane.kind === 'buffer') {
      const w = oL - oR;
      for (let s = S.zone + 1; s + w < L - E.zone - 1; s += CGA.hatchSpacing) {
        const a = sampleAt(path, s), b = sampleAt(path, s + w);
        out.poly(segmentStrip(add(a.p, mul(leftN(a.t), oR)), add(b.p, mul(leftN(b.t), oL)), CGA.lineWidth), { layer: 'marking', kind: 'hatch', roadId: id, color: COLORS.white, base: CGA.markingOffset, height: 0 });
      }
    }
    // Row_Distributor.cga: trees, lamps, benches, bollards (Spacing, Offset_Along = Spacing/2, Offset_Across)
    for (const it of lane.items ?? []) {
      for (let s = ls + it.spacing / 2; s < le; s += it.spacing) {
        const { p, t } = sampleAt(path, s);
        out.point(add(p, mul(leftN(t), oC + (it.offsetAcross ?? 0))), { layer: 'item', kind: it.type, roadId: id, color: COLORS[it.type === 'bike-rack' ? 'bikeRack' : it.type], base: lane.curbHeight ?? 0, height: 0, rotation: deg(angleOf(t)) });
      }
    }
  });

  // 3b. Line markings between lanes (Line_Marking.cga) — solid in the approach zone before a stop
  for (let i = 0; i < mode.lanes.length - 1; i++) {
    const { style, color } = boundary(mode.lanes[i], mode.lanes[i + 1], mode);
    if (style === 'none') continue;
    const e = sec.edges[i + 1];
    const isCenter = isVehicle(mode.lanes[i]) && isVehicle(mode.lanes[i + 1]) && mode.lanes[i].dir !== mode.lanes[i + 1].dir;
    const solidZone = isCenter ? CGA.centerSolidZone : CGA.stopZone;
    const s0 = S.zone, s1 = L - E.zone;
    const segs: [number, number, LineStyle][] = [];
    const a = S.stop !== 'none' && style.startsWith('dashed') ? Math.min(s0 + solidZone, s1) : s0;
    const b = E.stop !== 'none' && style.startsWith('dashed') ? Math.max(s1 - solidZone, a) : s1;
    if (a > s0) segs.push([s0, a, style === 'dashed' ? 'continuous' : 'continuous-double']);
    segs.push([a, b, style]);
    if (b < s1) segs.push([b, s1, style === 'dashed' ? 'continuous' : 'continuous-double']);
    for (const [from, to, st] of segs) drawLine(out, path, from, to, e, st, color, mode.dash, id);
  }

  // 3c. Ends: crosswalk, stop line, arrows / STOP word
  for (const end of ends) {
    if (end.cw) {
      const d0 = end.cw / 3, d1 = d0 + end.cw;
      const [sa, sb] = [station(end.which, d0), station(end.which, d1)].sort((x, y) => x - y);
      drawCrosswalk(out, path, sa, sb, sec.roadLeft, sec.roadRight, end.crosswalk, id);
    }
    if (end.stop === 'none') continue;
    const dStop = end.cw ? end.cw / 3 + end.cw + end.cw / 4 : 0;
    const approach = mode.lanes
      .map((l, i) => ({ l, i, oL: sec.edges[i], oR: sec.edges[i + 1] }))
      .filter(x => isVehicle(x.l) && (x.l.dir === 'both' || x.l.dir === (end.which === 'end' ? 'forward' : 'reverse')));
    if (!approach.length) continue;
    const top = Math.max(...approach.map(x => x.oL)), bot = Math.min(...approach.map(x => x.oR));
    const [sa, sb] = [station(end.which, dStop), station(end.which, dStop + CGA.stopLine)].sort((x, y) => x - y);
    out.poly(strip(slicePolyline(path, sa, sb), top, bot), { layer: 'stopline', roadId: id, color: COLORS.white, base: CGA.markingOffset, height: 0 });
    // driver's left → right
    approach.sort((x, y) => (end.which === 'end' ? y.oL - x.oL : x.oL - y.oL));
    const moves = laneMovements(end.stop, approach.length);
    approach.forEach((x, k) => {
      const sArrow = station(end.which, dStop + CGA.stopLine + 2 + 5);
      const { p, t } = sampleAt(path, sArrow);
      const heading = end.which === 'end' ? t : mul(t, -1);
      const at = add(p, mul(leftN(t), (x.oL + x.oR) / 2));
      for (const m of moves[k]) out.poly(placeGlyph(GLYPH[m], at, heading), { layer: 'arrow', kind: m, roadId: id, color: COLORS.white, base: CGA.markingOffset, height: 0 });
      if (end.stop === 'with stop marking') out.point(add(at, mul(heading, 2.5)), { layer: 'symbol', kind: 'stop', text: 'STOP', roadId: id, color: COLORS.white, base: CGA.markingOffset, height: 0, rotation: deg(angleOf(heading)) });
    });
  }
  return { out, path, curves, mode };
}

function drawLine(out: Out, path: Vec2[], s0: number, s1: number, offset: number, style: LineStyle, color: string, dash: [number, number], roadId: string) {
  if (s1 - s0 < 0.5) return;
  const w = CGA.lineWidth, gap = CGA.lineDistance;
  const offs = style.endsWith('double') ? [offset + (gap + w) / 2, offset - (gap + w) / 2] : [offset];
  const dashed = style.startsWith('dashed');
  const props: Props = { layer: 'marking', kind: style, roadId, color, base: CGA.markingOffset, height: 0 };
  for (const o of offs) {
    if (!dashed) { out.poly(strip(slicePolyline(path, s0, s1), o + w / 2, o - w / 2), props); continue; }
    const [d, g] = dash;
    for (let s = s0 + g / 2; s < s1; s += d + g) out.poly(strip(slicePolyline(path, s, Math.min(s + d, s1)), o + w / 2, o - w / 2), props);
  }
}

function drawCrosswalk(out: Out, path: Vec2[], sa: number, sb: number, top: number, bot: number, type: CrosswalkType, roadId: string) {
  const seg = slicePolyline(path, sa, sb);
  const p: Props = { layer: 'crosswalk', kind: type, roadId, color: COLORS.white, base: CGA.markingOffset, height: 0 };
  const W = top - bot;
  const zebra = (from: number, to: number) => {         // Zebra_Crossing.cga bar distribution
    const n = Math.ceil((W - CGA.zebraGap) / (CGA.zebraBar + CGA.zebraGap));
    const g = (W - n * CGA.zebraBar) / (n + 1);
    const piece = slicePolyline(path, from, to);
    for (let k = 0; k < n; k++) {
      const o = top - g - k * (CGA.zebraBar + g);
      out.poly(strip(piece, o, o - CGA.zebraBar), p);
    }
  };
  const bars = (dashed: boolean) => {
    for (const [a, b] of [[sa, sa + CGA.transverseBar], [sb - CGA.transverseBar, sb]]) {
      const piece = slicePolyline(path, a, b);
      if (!dashed) { out.poly(strip(piece, top, bot), p); continue; }
      for (let o = top; o - 0.6 > bot; o -= 1.2) out.poly(strip(piece, o, o - 0.6), p);
    }
  };
  switch (type) {
    case 'solid': out.poly(strip(seg, top, bot), p); break;
    case 'transverse': bars(false); break;
    case 'dashed': bars(true); break;
    case 'ladder': bars(false); zebra(sa + CGA.transverseBar, sb - CGA.transverseBar); break;
    default: zebra(sa + CGA.zebraMargin, sb - CGA.zebraMargin);
  }
}

// ───────────────────────────── 2. Turns: intersections & roundabouts ─────────────────────────────
interface Arm {
  roadIdx: number; atStart: boolean; d: Vec2; n: Vec2;
  hL: number; hR: number; oL: number; oR: number;     // roadway & outer half-widths in the outward frame
  setback: number; mode: RoadMode;
}

function makeArm(roadIdx: number, path: Vec2[], atStart: boolean, mode: RoadMode, node: Vec2): Arm {
  const sec = section(mode);
  const far = atStart ? path[1] : path[path.length - 2];
  const d = norm(sub(far, node));
  return {
    roadIdx, atStart, d, n: leftN(d), mode, setback: 0,
    hL: atStart ? sec.roadLeft : -sec.roadRight, hR: atStart ? -sec.roadRight : sec.roadLeft,
    oL: atStart ? sec.outerLeft : -sec.outerRight, oR: atStart ? -sec.outerRight : sec.outerLeft,
  };
}

/** Curb-return fillet between arm a's left edge and arm b's right edge (b is next ccw). */
function cornerFillet(P: Vec2, a: Arm, b: Arm, hA: number, hB: number, R: number) {
  const pa = add(P, mul(a.n, hA)), pb = sub(P, mul(b.n, hB));
  const alpha = (angleOf(b.d) - angleOf(a.d) + 4 * Math.PI) % (2 * Math.PI);
  const X = lineIntersect(pa, a.d, pb, b.d);
  if (!X || alpha >= Math.PI - 1e-3 || R <= 0) return null;
  const T = R / Math.tan(alpha / 2);
  const T1 = add(X, mul(a.d, T)), T2 = add(X, mul(b.d, T));
  const C = add(X, mul(norm(add(a.d, b.d)), R / Math.sin(alpha / 2)));
  return { T1, T2, C, arc: arcPoints(C, T1, T2), alpha };
}

function buildJunction(out: Out, P: Vec2, arms: Arm[], R: number, nodeId: string) {
  arms.sort((a, b) => angleOf(a.d) - angleOf(b.d));
  const corners = arms.map((a, i) => {
    const b = arms[(i + 1) % arms.length];
    const curb = cornerFillet(P, a, b, a.hL, b.hR, R);
    const swA = a.oL - a.hL, swB = b.oR - b.hR;
    const outer = cornerFillet(P, a, b, a.oL, b.oR, Math.max(0.5, R - Math.min(swA, swB)));
    return { a, b, curb, outer };
  });
  // setbacks: far enough for every tangent point + 1 m
  for (const c of corners) for (const f of [c.curb, c.outer]) {
    if (!f) continue;
    c.a.setback = Math.max(c.a.setback, dot(sub(f.T1, P), c.a.d) + 0.01);
    c.b.setback = Math.max(c.b.setback, dot(sub(f.T2, P), c.b.d) + 0.01);
  }
  for (const a of arms) a.setback = Math.max(a.setback, Math.max(a.hL, a.hR) + 1);

  const at = (a: Arm, off: number): Vec2 => add(add(P, mul(a.d, a.setback)), mul(a.n, off));
  const ring: Vec2[] = [];
  corners.forEach(c => {
    ring.push(at(c.a, -c.a.hR), at(c.a, c.a.hL));
    if (c.curb) ring.push(...c.curb.arc);
  });
  ring.push(ring[0]);
  out.poly(ring, { layer: 'junction', kind: 'Junction', roadId: nodeId, color: COLORS.asphalt, base: 0, height: 0 });

  // corner sidewalks + curb returns
  for (const c of corners) {
    if (c.a.oL - c.a.hL < 0.01 && c.b.oR - c.b.hR < 0.01) continue;      // no sidewalks (e.g. highway)
    const h = CGA.curbHeight;
    const innerA = at(c.a, c.a.hL), innerB = at(c.b, -c.b.hR);
    const outerA = at(c.a, c.a.oL), outerB = at(c.b, -c.b.oR);
    const curbArc = c.curb ? c.curb.arc : [innerA, innerB];
    const outerArc = c.outer ? c.outer.arc : [outerA, outerB];
    const ringSW = [innerA, ...curbArc, innerB, outerB, ...outerArc.slice().reverse(), outerA, innerA];
    out.poly(ringSW, { layer: 'surface', kind: 'sidewalk', roadId: nodeId, color: COLORS.lightConcrete, base: 0, height: h });
    if (c.curb) {
      const inner = c.curb.arc.map(p => add(p, mul(norm(sub(c.curb!.C, p)), CGA.curbWidth)));
      out.poly([...c.curb.arc, ...inner.reverse(), c.curb.arc[0]], { layer: 'curb', roadId: nodeId, color: COLORS.curb, base: 0, height: h + 0.005, radius: R });
    }
  }
}

function buildRoundabout(out: Out, P: Vec2, arms: Arm[], spec: NonNullable<NodeSpec['roundabout']>, r: number, nodeId: string) {
  arms.sort((a, b) => angleOf(a.d) - angleOf(b.d));
  const lw = spec.laneWidth ?? 4.5;
  const Ri = spec.islandRadius, R0 = Ri + spec.ringLanes * lw;
  // line/circle fillet: center at distance (R0 + r) from P and (h + r) from the arm edge line
  const fil = (a: Arm, side: 1 | -1) => {
    const h = side > 0 ? a.hL : a.hR;
    const x = Math.sqrt(Math.max((R0 + r) ** 2 - (h + r) ** 2, 0));
    const Q = add(add(P, mul(a.d, x)), mul(a.n, side * (h + r)));
    const onLine = add(add(P, mul(a.d, x)), mul(a.n, side * h));
    const onCircle = add(P, mul(sub(Q, P), R0 / (R0 + r)));
    return { x, Q, onLine, onCircle };
  };
  const F = arms.map(a => ({ L: fil(a, 1), R: fil(a, -1) }));
  arms.forEach((a, i) => (a.setback = Math.max(F[i].L.x, F[i].R.x) + 0.01));
  const at = (a: Arm, off: number): Vec2 => add(add(P, mul(a.d, a.setback)), mul(a.n, off));
  const ring: Vec2[] = [];
  arms.forEach((a, i) => {
    const f = F[i], next = F[(i + 1) % arms.length];
    ring.push(...arcPoints(f.R.Q, f.R.onCircle, f.R.onLine), at(a, -a.hR), at(a, a.hL), ...arcPoints(f.L.Q, f.L.onLine, f.L.onCircle));
    // along the outer circle (ccw) to the next arm
    const a0 = angleOf(sub(f.L.onCircle, P));
    let a1 = angleOf(sub(next.R.onCircle, P));
    while (a1 <= a0) a1 += 2 * Math.PI;
    const n = Math.ceil(deg(a1 - a0) / 5);
    const arc: Vec2[] = [];
    for (let k = 1; k < n; k++) { const t = a0 + ((a1 - a0) * k) / n; arc.push([P[0] + R0 * Math.cos(t), P[1] + R0 * Math.sin(t)]); }
    ring.push(...arc);
    const outer = arc.map(p => add(P, mul(norm(sub(p, P)), R0 + CGA.curbWidth)));
    if (arc.length > 1) out.poly([...arc, ...outer.reverse(), arc[0]], { layer: 'curb', roadId: nodeId, color: COLORS.curb, base: 0, height: CGA.curbHeight + 0.005 });
  });
  ring.push(ring[0]);
  out.poly(ring, { layer: 'junction', kind: 'Roundabout', roadId: nodeId, color: COLORS.asphalt, base: 0, height: 0 }, [circle(P, Ri, 72, false)]);
  // RoundaboutIsland → green with curb (Street_Modern_Standard: IslandWithGreen)
  out.poly(circle(P, Ri), { layer: 'island', kind: 'RoundaboutIsland', roadId: nodeId, color: COLORS.grass, base: 0, height: CGA.curbHeight });
  out.poly([...circle(P, Ri), ...circle(P, Ri - CGA.curbWidth, 72, false)], { layer: 'curb', roadId: nodeId, color: COLORS.curb, base: 0, height: CGA.curbHeight + 0.005 });
  // ring lane lines
  for (let k = 1; k < spec.ringLanes; k++) {
    const rr = Ri + k * lw, circ = 2 * Math.PI * rr, dashA = (CGA.dash / circ) * 2 * Math.PI, stepA = ((CGA.dash + CGA.gap) / circ) * 2 * Math.PI;
    for (let t = 0; t < 2 * Math.PI; t += stepA) {
      const pts: Vec2[] = Array.from({ length: 5 }, (_, j) => { const u = t + (dashA * j) / 4; return [P[0] + rr * Math.cos(u), P[1] + rr * Math.sin(u)] as Vec2; });
      out.poly(strip(pts, CGA.lineWidth / 2, -CGA.lineWidth / 2), { layer: 'marking', kind: 'dashed', roadId: nodeId, color: COLORS.white, base: CGA.markingOffset, height: 0 });
    }
  }
}

/** Lane-to-lane turning paths (quadratic Bézier) through a junction — for animation / simulation. */
function buildTurnPaths(out: Out, P: Vec2, arms: Arm[], nodeId: string, stopOf: (a: Arm) => StopMarking) {
  const laneOffsets = (a: Arm, approaching: boolean) => {
    const sec = section(a.mode);
    const wantDir: TravelDir = a.atStart === approaching ? 'reverse' : 'forward';
    return a.mode.lanes
      .map((l, i) => ({ l, o: (sec.edges[i] + sec.edges[i + 1]) / 2 }))
      .filter(x => isVehicle(x.l) && (x.l.dir === 'both' || x.l.dir === wantDir))
      .map(x => (a.atStart ? x.o : -x.o));                               // offset in outward frame (+ = outward left)
  };
  for (const A of arms) {
    // approaching lanes: driver heads −d, driver's left = −n → order by offset ascending
    const inL = laneOffsets(A, true).sort((x, y) => x - y);
    const painted = laneMovements(stopOf(A), inL.length);
    const defaults = defaultMovements(inL.length);
    const moves = painted.map((m, k) => (m.length ? m : defaults[k]));
    for (const B of arms) {
      if (B === A) continue;
      const turn = deg(Math.atan2(cross(mul(A.d, -1), B.d), dot(mul(A.d, -1), B.d)));
      const mv: Movement = Math.abs(turn) < 30 ? 'straight' : turn > 0 ? 'left' : 'right';
      const outL = laneOffsets(B, false).sort((x, y) => y - x);           // departing: driver's left = +n
      if (!outL.length) continue;
      inL.forEach((oi, k) => {
        if (!moves[k].includes(mv)) return;
        const target = mv === 'left' ? outL[0] : mv === 'right' ? outL[outL.length - 1] : outL[Math.min(k, outL.length - 1)];
        const p0 = add(add(P, mul(A.d, A.setback)), mul(A.n, oi));
        const p2 = add(add(P, mul(B.d, B.setback)), mul(B.n, target));
        const ctrl = lineIntersect(p0, mul(A.d, -1), p2, B.d) ?? mul(add(p0, p2), 0.5);
        const pts: Vec2[] = Array.from({ length: 13 }, (_, j) => {
          const t = j / 12, u = 1 - t;
          return add(add(mul(p0, u * u), mul(ctrl, 2 * u * t)), mul(p2, t * t));
        });
        out.line(pts, { layer: 'turnPath', kind: mv, roadId: nodeId, color: COLORS.turnPath, base: 0.3, height: 0, from: A.roadIdx, to: B.roadIdx });
      });
    }
  }
}

// ───────────────────────────── Network entry point ─────────────────────────────
export function buildNetwork(input: NetworkInput): FeatureCollection {
  const traffic = input.traffic ?? 'right-hand';
  const out = new Out();
  const roads = input.roads.map(r => {
    let mode = typeof r.mode === 'string' ? ROAD_MODES[r.mode] : r.mode;
    if (!mode) throw new Error(`Unknown road mode: ${r.mode}`);
    if (traffic === 'left-hand') mode = mirrorMode(mode);
    const smooth = filletPolyline(r.path, r.smoothRadius ?? minCurveRadius(mode.designSpeed));
    return { r: { ...r, mode }, mode, path: smooth.points, curves: smooth.curves, trim: [0, 0] as [number, number], ends: [{ ...r.start }, { ...r.end }] as EndConfig[] };
  });

  // group road ends into nodes (snap tolerance 0.5 m)
  const key = (p: Vec2) => `${Math.round(p[0] * 2) / 2}_${Math.round(p[1] * 2) / 2}`;
  const groups = new Map<string, { at: Vec2; ends: { idx: number; atStart: boolean }[] }>();
  roads.forEach((rd, idx) => {
    for (const atStart of [true, false]) {
      const p = atStart ? rd.path[0] : rd.path[rd.path.length - 1];
      const near = [...groups.values()].find(g => dist(g.at, p) < 0.5);
      const g = near ?? { at: p, ends: [] };
      g.ends.push({ idx, atStart });
      if (!near) groups.set(key(p), g);
    }
  });

  const nodesOut: Record<string, unknown>[] = [];
  let nodeNo = 0;
  for (const g of groups.values()) {
    const spec = input.nodes?.find(n => dist(n.at, g.at) < 1);
    const isRb = spec?.type === 'roundabout';
    if (g.ends.length < 3 && !isRb) continue;                          // Joint / dead end: nothing to build
    const nodeId = `node-${nodeNo++}`;
    const arms = g.ends.map(e => makeArm(e.idx, roads[e.idx].path, e.atStart, roads[e.idx].mode, g.at));
    const R = spec?.cornerRadius ?? Math.max(...arms.map(a => a.mode.cornerRadius));
    if (isRb) buildRoundabout(out, g.at, arms, spec!.roundabout ?? { islandRadius: 8, ringLanes: 1 }, R || 10, nodeId);
    else buildJunction(out, g.at, arms, R, nodeId);
    // trim roads + default end markings (CGA _getInitialCrosswalk / _getInitialStop)
    for (const a of arms) {
      const rd = roads[a.roadIdx], k = a.atStart ? 0 : 1;
      rd.trim[k] = a.setback;
      const cfg = rd.ends[k];
      cfg.crosswalk ??= isRb ? 'none' : rd.mode.crosswalk;
      cfg.stop ??= isRb ? (rd.mode.stop === 'none' ? 'none' : 'line only') : rd.mode.stop;
    }
    if (input.turnPaths !== false && !isRb) buildTurnPaths(out, g.at, arms, nodeId, a => roads[a.roadIdx].ends[a.atStart ? 0 : 1].stop ?? 'none');
    nodesOut.push({ id: nodeId, at: g.at, type: isRb ? 'Roundabout' : 'Junction', valency: arms.length, cornerRadius: R, setbacks: arms.map(a => ({ road: rd(a), setback: +a.setback.toFixed(2) })) });
  }
  function rd(a: Arm) { return roads[a.roadIdx].r.id; }

  const roadsOut = roads.map(rdx => {
    const res = buildRoad({ ...rdx.r, path: rdx.path, smoothRadius: 0, start: rdx.ends[0], end: rdx.ends[1] }, out, { trimStart: rdx.trim[0], trimEnd: rdx.trim[1] });
    return { id: rdx.r.id, mode: rdx.mode.id, shape: rdx.mode.cityEngineShape, length: +polylineLength(res.path).toFixed(2), width: section(rdx.mode).width, minRadius: +minCurveRadius(rdx.mode.designSpeed).toFixed(1), curves: rdx.curves };
  });

  // draw order: surfaces → junction → curbs/islands → markings → items
  const order: Layer[] = ['surface', 'junction', 'island', 'curb', 'marking', 'crosswalk', 'stopline', 'arrow', 'symbol', 'turnPath', 'item'];
  out.features.sort((a, b) => order.indexOf(a.properties.layer) - order.indexOf(b.properties.layer));
  return { type: 'FeatureCollection', features: out.features, meta: { traffic, roads: roadsOut, nodes: nodesOut } };
}
