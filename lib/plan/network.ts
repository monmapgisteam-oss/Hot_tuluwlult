// Гудамжны граф ба инженерийн шугам сүлжээ (алхам 8) — эх үүсвэрээс гудамжны дагуу салаалсан мод (Dijkstra),
// урсгалыг доош хуримтлуулж диаметр/ачааллыг тооцно. Бохир, борооны ус DEM-ийн дагуу өөрийн урсгалаар.
import { type Dem } from "./dem";
import { area,bufPath,diff,inter,densify, dist, nearest, type Path, type XY,type Rings } from "./geom";
import {corridorGraph} from "./sharedUtilityGraph";
import type { Street, StreetCls } from "./layout";
import {blocksProfile,planningElevation,planningRoutingCost,type PlanningSuitability} from './planningSuitability';
import {terrainSegmentMaxGrade} from './terrainRoute';
import {POWER_LINE_COLOR} from './powerAppearance';

export type Node = { x: number; y: number; z: number; deg: number; cls: StreetCls; r: number };
export type Edge = { a: number; b: number; len: number; cls: StreetCls; w: number;suitabilityCost?:number };
export type Graph = { nodes: Node[]; edges: Edge[]; adj: number[][] };

const RANK: Record<StreetCls, number> = { local: 0, collector: 1, arterial: 2 };

/** Зөвхөн бодит замын геометрээс топологи үүсгэнэ; далд холбоос нэмэхгүй. */
export function buildGraph(streets: Street[], dem: Dem | null,suitability?:PlanningSuitability): Graph {
  const source=streets.filter(s=>s.path.length>1),g=corridorGraph(source.map(s=>densify(s.path,25)));
  const nodes:Node[]=g.nodes.map(([x,y])=>({x,y,z:dem?planningElevation(dem,x,y)??NaN:NaN,deg:0,cls:'local',r:0}));
  const edges:Edge[]=g.edges.map(e=>{
    const a=g.nodes[e.a],b=g.nodes[e.b],mid:XY=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    let street=source[0],best=Infinity;
    for(const s of source){const distance=dist(mid,nearest([s.path],mid,false));if(distance<best-.001||(distance<=best+.001&&RANK[s.cls]>RANK[street.cls])){best=distance;street=s;}}
    for(const i of [e.a,e.b]){nodes[i].r=Math.max(nodes[i].r,street.w/2);if(RANK[street.cls]>RANK[nodes[i].cls])nodes[i].cls=street.cls;}
    let suitabilityCost:number|undefined;
    if(suitability){
      // ТААМАГЛАЛ: инженерийн концепц коридорын хагас өргөн 0.75 м; нормын баталгаажсан зай биш.
      const surface=bufPath([[a,b]],.75),restrictions=suitability.restrictions.filter(r=>blocksProfile(r,'utility'));
      suitabilityCost=0;
      if(restrictions.some(r=>area(inter(surface,r.rings))>.01))suitabilityCost=Infinity;
      else{
        const count=Math.max(1,Math.ceil(e.length/Math.min(suitability.dem.cell/2,25)));
        for(let k=0;k<=count;k++){
          const cost=planningRoutingCost(suitability,[a[0]+(b[0]-a[0])*k/count,a[1]+(b[1]-a[1])*k/count],'utility');
          if(!Number.isFinite(cost)){suitabilityCost=Infinity;break;}
          suitabilityCost+=cost*(k===0||k===count ? .5 : 1)/count;
        }
      }
    }
    return{a:e.a,b:e.b,len:e.length,cls:street.cls,w:street.w,...(suitabilityCost!=null?{suitabilityCost}:{})};
  });
  for(let i=0;i<nodes.length;i++)nodes[i].deg=g.adj[i].length;
  return{nodes,edges,adj:g.adj};
}

export function nearestNode(g: Graph, p: XY) {
  let best = 0, bd = Infinity;
  g.nodes.forEach((n, k) => { const d = Math.hypot(n.x - p[0], n.y - p[1]); if (d < bd) { bd = d; best = k; } });
  return best;
}

/** Dijkstra мод — эх үүсвэрээс бүх зангилаа хүртэл (parent ирмэг) */
function tree(g: Graph, src: number, w: (e: Edge, from: number) => number) {
  const N = g.nodes.length, d = new Float64Array(N).fill(Infinity), par = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  d[src] = 0;
  const q: [number, number][] = [[0, src]];
  while (q.length) {
    let bi = 0;
    for (let i = 1; i < q.length; i++) if (q[i][0] < q[bi][0]) bi = i;
    const [dd, n] = q.splice(bi, 1)[0];
    if (done[n]) continue;
    done[n] = 1;
    for (const ek of g.adj[n]) {
      const e = g.edges[ek], m = e.a === n ? e.b : e.a;
      const nd = dd + w(e, n);
      if (nd < d[m]) { d[m] = nd; par[m] = ek; q.push([nd, m]); }
    }
  }
  return { d, par };
}

export type Sys = "water" | "sewer" | "heat" | "power" | "storm";
export const SYS: Record<Sys, { label: string; color: string; off: number; unit: string }> = {
  water: { label: "Ус хангамж", color: "#2F80ED", off: 4, unit: "л/с" },
  sewer: { label: "Бохир ус", color: "#8B5A2B", off: 0, unit: "л/с" },
  heat: { label: "Дулаан", color: "#E03E2D", off: -4, unit: "МВт" },
  power: { label: "Цахилгаан", color: POWER_LINE_COLOR, off: 7, unit: "МВт" },
  storm: { label: "Борооны ус", color: "#17BEBB", off: -7, unit: "л/с" },
};
/** streetW — гудамжны өргөн (лоток/бохирыг тэнхлэгээс зэрэгцүүлэхэд). dnHot/dnCirc — Т3/Т4 (зөвхөн усны шугамд). */
export type NetLine = { sys: Sys; path: Path; fromNode?:number;toNode?:number;sourceId?:string;invertFrom?:number|null;invertTo?:number|null; flow: number;flowKnown?:boolean;flowHot?:number|null;flowCirc?:number|null; dn: number | null; slope: number | null; depth: number | null; warn: boolean; streetW?: number; dnHot?: number | null; dnCirc?: number | null };
export type NetOut = { lines: NetLine[]; len: number; maxDn: number | null; warn: number; srcFlow: number; unservedLoad?:number; maxDepth: number | null; sources?:{id:string;point:XY;flow:number;status:string;role?:'collection';invertM?:number|null}[];lifts?:{point:XY;headM:number;flow:number}[];warnings?:string[] };

const DN = [50, 80, 100, 150, 200, 250, 300, 350, 400, 500, 600, 700, 800, 1000, 1200];
export const dnOf = (q: number, v: number, min: number) => {
  const d = Math.sqrt((4 * q) / (Math.PI * v)) * 1000;
  return DN.find((x) => x >= Math.max(d, min)) ?? null;
};

/** Exact bilinear DEM grade for electrical branches, including short diagonal
 * turbine spurs. The optional reservation is a concept corridor, not an
 * overhead-line statutory clearance or a conductor/pole design. */
export function powerEdgeCost(dem:Dem,a:XY,b:XY,o:{maxGrade?:number;halfWidthM?:number;boundary?:Rings;obstacles?:Rings;suitability?:PlanningSuitability}={}){
 const maxGrade=o.maxGrade??25,halfWidth=o.halfWidthM??.75,length=dist(a,b);
 if(!Number.isFinite(maxGrade)||maxGrade<=0||!Number.isFinite(halfWidth)||halfWidth<=0||planningElevation(dem,...a)==null||planningElevation(dem,...b)==null||terrainSegmentMaxGrade(dem,a,b)>maxGrade)return Infinity;
 if(length<.0001)return 0;
 const restrictions=o.suitability?.restrictions.filter(r=>blocksProfile(r,'utility'))??[];
 if(o.boundary||o.obstacles?.length||restrictions.length){const surface=bufPath([[a,b]],halfWidth);if(o.boundary&&area(diff(surface,o.boundary))>.01||o.obstacles?.length&&area(inter(surface,o.obstacles))>.01||restrictions.some(r=>area(inter(surface,r.rings))>.01))return Infinity;}
 if(!o.suitability)return length;
 const count=Math.max(1,Math.ceil(length/Math.min(dem.cell/2,25)));let cost=0;
 for(let i=0;i<=count;i++){const p:XY=[a[0]+(b[0]-a[0])*i/count,a[1]+(b[1]-a[1])*i/count],value=planningRoutingCost(o.suitability,p,'utility');if(!Number.isFinite(value))return Infinity;cost+=value*(i===0||i===count?.5:1)/count;}
 return length*cost;
}

/** Нэг системийн мод: node-ийн ачаалал (load) → ирмэгийн урсгал, хэмжээ */
export function network(g: Graph, sys: Sys, src: number, load: Float64Array, o: {
  gravity?: boolean; toQ?: (x: number) => number; v?: number; minDn?: number; minSlope?: number; cover?: number; maxDepth?: number; powerMaxGrade?:number;dem?:Dem;
}): NetOut {
  if(o.powerMaxGrade!=null&&(!Number.isFinite(o.powerMaxGrade)||o.powerMaxGrade<=0))throw new Error('Цахилгааны концепц трассын налууг шалгана уу.');
  const powerCosts=new Map<Edge,number>();
  const w = (e: Edge, from: number) => {
    if((o.gravity||sys==='power'&&!o.dem)&&(!Number.isFinite(g.nodes[e.a].z)||!Number.isFinite(g.nodes[e.b].z)||g.nodes[e.a].z===-999999||g.nodes[e.b].z===-999999))return Infinity;
    // 25% нь концепц кабелийн угсралтын таамаглал; агаарын шугамын зай/унжилтын норм биш.
    if(sys==='power'&&o.dem){let cost=powerCosts.get(e);if(cost==null){const a=g.nodes[e.a],b=g.nodes[e.b];cost=powerEdgeCost(o.dem,[a.x,a.y],[b.x,b.y],{maxGrade:o.powerMaxGrade});powerCosts.set(e,cost);}if(!Number.isFinite(cost))return Infinity;}
    else if(sys==='power'&&Math.abs(g.nodes[e.a].z-g.nodes[e.b].z)/e.len*100>(o.powerMaxGrade??25))return Infinity;
    const cost=e.len*(e.suitabilityCost??1);if (!o.gravity) return cost;
    // Урсгал эх үүсвэр (гарц) руу: from нь доод, нөгөө нь дээд байх ёстой — өгсөж урсах ирмэгт торгууль
    const m = e.a === from ? e.b : e.a;
    return g.nodes[m].z >= g.nodes[from].z ? cost : cost * 4;
  };
  if(!g.nodes.length)return{lines:[],len:0,maxDn:null,warn:load.some(v=>v>0)?1:0,srcFlow:0,unservedLoad:load.reduce((a,b)=>a+b,0),maxDepth:null};
  if(src<0||src>=g.nodes.length||load.length!==g.nodes.length||load.some(v=>!Number.isFinite(v)||v<0))throw new Error('Сүлжээний эх үүсвэр, ачааллыг шалгана уу.');
  const sourceHeight=sys==='power'&&o.dem?planningElevation(o.dem,g.nodes[src].x,g.nodes[src].y):g.nodes[src].z;
  if((o.gravity||sys==='power')&&(sourceHeight==null||!Number.isFinite(sourceHeight)||sourceHeight===-999999))return{lines:[],len:0,maxDn:null,warn:1,srcFlow:0,unservedLoad:load.reduce((a,b)=>a+b,0),maxDepth:null};
  const { par } = tree(g, src, w);
  const unservedLoad=load.reduce((total,value,i)=>total+(i!==src&&par[i]<0?value:0),0);
  const N = g.nodes.length, acc = Float64Array.from(load);
  const order = Array.from({ length: N }, (_, k) => k).filter((k) => par[k] >= 0 || k === src);
  // Модны гүнээр эрэмбэлж навчнаас дээш хуримтлуулна
  const depth = new Int32Array(N);
  const dep = (k: number): number => { if (k === src || par[k] < 0) return 0; if (depth[k]) return depth[k]; const e = g.edges[par[k]]; return (depth[k] = dep(e.a === k ? e.b : e.a) + 1); };
  order.sort((a, b) => dep(b) - dep(a));
  // Өөрийн урсгалтай шугамын ёроолын түвшин: навчнаас доош — inv[дээд] ≥ inv[доод] + i·L, хучаас доош ≥ cover
  const cover = o.cover ?? 2.5, sMin = o.minSlope ?? 0.005;
  const upOf = (k: number) => { const e = g.edges[par[k]]; return k === e.a ? e.b : e.a; };
  for (const k of order) if (k !== src && par[k] >= 0 && acc[k] > 0) acc[upOf(k)] += acc[k];
  const inv = Float64Array.from(g.nodes.map((n) => n.z - cover));
  if (o.gravity) for (const k of order) {
    if (k === src || par[k] < 0 || acc[k] <= 0) continue;
    inv[upOf(k)] = Math.min(inv[upOf(k)], inv[k] - sMin * g.edges[par[k]].len);
  }
  const lines: NetLine[] = [];
  let len = 0, maxDn: number | null = null, warn = unservedLoad>0?1:0, maxDepth: number | null = null;
  for (const k of order) {
    if (k === src || par[k] < 0 || acc[k] <= 0) continue;
    const e = g.edges[par[k]], up = upOf(k);
    const a: XY = [g.nodes[k].x, g.nodes[k].y], b: XY = [g.nodes[up].x, g.nodes[up].y];
    // Нэг зангилаанд хүрэх сегментүүд нэг координаттай. Энэ нь коридорын тэнхлэг; хөндлөн зайг дараагийн шатанд шийднэ.
    const q = o.toQ ? o.toQ(acc[k]) : acc[k];
    const dn = o.v ? dnOf(q, o.v, o.minDn ?? 100) : null;
    const slope = o.gravity ? (inv[k] - inv[up]) / e.len : null;
    const depth = o.gravity ? Math.max(g.nodes[up].z-inv[up],g.nodes[k].z-inv[k]) : null;
    const bad = (depth != null && depth > (o.maxDepth ?? 6)) || (!!o.v && dn==null);
    lines.push({ sys, path: [a,b], fromNode:k,toNode:up,invertFrom:o.gravity?inv[k]:null,invertTo:o.gravity?inv[up]:null, flow: acc[k], dn, slope, depth, warn: bad, streetW: e.w });
    len += e.len; if (dn != null) maxDn = Math.max(maxDn ?? 0, dn); if (bad) warn++;
    if (depth != null) maxDepth = Math.max(maxDepth ?? 0, depth);
  }
  return { lines, len, maxDn, warn, srcFlow: acc[src], unservedLoad, maxDepth,...(sys==='power'&&!o.dem?{warnings:['Зөвхөн зангилааны өндрөөр шалгасан; цахилгааны трассын дотоод DEM профайл ДУТУУ ӨГӨГДӨЛ.']}: {}) };
}
