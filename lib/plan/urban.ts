// 03. Суурьшлын бүсийн загвар тооцоолох — алхам 1–9-ийн дараалал:
// 1 хүн амын хөтөлбөр → 2 гол/туслах тэнхлэг → 3 бүсчлэл → 4 блок хуваалт → 5 барилга, BCR, өндөр →
// 6 ногоон байгууламж → 7 явган, дугуйн зам → 8 инженерийн шугам → 9 ИБАХ.
// Норм: БНбД 30-01-24 (Selbe_db/SELBE_BNBD_NORMS.md) ба хэрэглэгчийн жишиг хүснэгт.
import { d8, loadDem, type Dem } from "./dem";
import {connectUrbanStreets} from "./urbanStreetConnections";
import { add, area, bbox, bufPoly, densify, diff, dist, inside, labelPt, mul, nearest, parts, sub, type Path, type Rings, type XY, unionAll } from "./geom";
import {
  axes, pickBlocks, pickSite, program, seedOf, steepArea, subdivide, zoning,
  type AxesIn, type Lot, type Program, type ProgramIn, type Street, type SubdivIn, type ZonePiece,
} from "./layout";
import { buildGraph, dnOf, nearestNode, network, type Graph, type NetOut, type Sys } from "./network";
import { generateAsync, runoffC, type Attrs, type BldgF, type Scene } from "./rules";
import { analyze, type IbahIn, type IbahOut } from "./ibah";
import { GROUND, ZONE, type ZoneKey } from "./zoning";
import {buildPlanningSuitability,loadPlanningEnvironment,evaluatePlanningPoint,evaluatePlanningFootprint,summarizePlanningSuitability,summarizePlanningPaths,type PlanningProfile,type PlanningSuitability,type PlanningSuitabilitySummary,type PlanningAssessment} from './planningSuitability';
import {accessRoute,terrainSewerPaths,type Net} from './netContext';
import {corridorGraph,sharedUtilityTree} from './sharedUtilityGraph';
import {planningContains,planningElevation} from './planningSuitability';

export type Range = [number, number];
export const SRC = {
  bnbd: "БНбД 30-01-24", table: "Жишиг хүснэгт", who: "ДЭМБ", sanpin: "SanPiN жишиг", ctx: "docs/project_context.md",
  ada: "ADA · ISO 21542", epbd: "EU EPBD", ite: "ITE Parking Generation", tod: "TOD жишиг",
} as const;

export const NORM = {
  share: { road: [20, 25] as Range, green: [25, 40] as Range, res: [35, 45] as Range, pub: [8, 12] as Range },
  densityGross: [150, 300] as Range, densityNetMax: 450, farRes: 1.2, farCom: 1.2 /* ТААМАГЛАЛ: холимог блокийн дээд давхар орон сууц тул орон сууцны FAR-ыг мөрдөв — БНбД-ийн нийтийн барилгын заалтаар ШАЛГАХ */, bcrRes: 40, bcrTable: [25, 40] as Range,
  greenBnbd: 6, greenWho: 9, greenTarget: [15, 20] as Range, parkR: 300, parkMinHa: 0.5, beds: [4, 8] as Range,
  // Зогсоол: БНбД-ийн орон сууцны норм + олон улсын жишиг (яг заалт бүрийг ШАЛГАХ)
  park: {
    bnbdRes: 1.0, // зай/өрх (З.10.32) — ШАЛГАХ
    accessAda: 2, // хүртээмжтэй зайн доод хувь (ADA) — ШАЛГАХ
    evEpbd: 10, // цахилгаан тээврийн цэнэглэх зайн доод хувь (EPBD) — ШАЛГАХ
    bikePerHh: 1.0, // дугуйн зогсоол, зай/өрх — ШАЛГАХ
    todMax: 0.8, // нийтийн тээврийн 500 м дотор зогсоолын дээд хязгаар, зай/өрх — ТААМАГЛАЛ
    surfaceMaxPct: 10, // ил зогсоолын эзлэх талбайн дээд хувь — ТААМАГЛАЛ
  },
  transit: 500, sunK: [2, 3] as Range, floors: [5, 9] as Range, walk: 2.0, walkRetail: 3.0, bike: [1.5, 2] as Range,
  sanitary: { I: 1000, II: 500, III: 300, IV: 100, V: 50 } as Record<string, number>,
};

export type ZoneKind = "residential" | "industrial" | "green" | "energy" | "built";
export function kindOf(name: string, type = ""): ZoneKind {
  if (/станц/i.test(name) && /Баригдаж|Одоо/i.test(type)) return "built";
  if (/Суурьшл/i.test(name)) return "residential";
  if (/ногоон зурвас/i.test(name)) return "green";
  if (/Салхин|Нарны/i.test(name)) return "energy";
  return "industrial";
}

export type Inputs = ProgramIn & AxesIn & SubdivIn & Attrs & IbahIn & {
  seedMode: "plant" | "center" | "rail" | "point"; seedX: number; seedY: number; maxSlope: number;
  // Тогтмол талбай (га): хоосон = хүн амын зорилтоос; утгатай бол талбайг дүүргэж хүн амыг багтаамжаар тооцно
  siteHa: number | "";
  // Хот төлөвлөлтийн загвар (lib/typology.ts): төвийн тоо, дагуул хот, төвөөс холдох тусам давхар буурах, төвд парк
  typo: string; centers: number; satShare: number; satGap: number; parkCenter: boolean; floorGrad: number; windbreak: number; demCell: number;
  jobsMine: number; jobsPlant: number; jobsInd: number | ""; famCoef: number; svcMult: number;
  m2JobCom: number; m2JobOffice: number; m2JobSchool: number; m2JobClinic: number;
  water: number; sewage: number; parking: number; underLv: number;
  parkVisitor: number; parkCom: number; parkPub: number; stallM2: number; stallUnderM2: number; underShare: number; accessShare: number; evShare: number; bikePark: number; heatWm2: number | ""; elecKwHh: number | ""; dT: number;
  hotShare: number; circShare: number;
};

export const DEFAULT: Inputs = {
  // 1. Хүн ам — docs/project_context.md: 2,000+ хүн, 500+ өрх; уурхай 500+, ЦС 540+ ажлын байр
  pop: 10000, hhSize: 3.4, m2pp: 25, netRatio: 0.75, floorsRes: 5, bcrRes: 30,
  resShare: 40, pubShare: 10, greenShare: 30, engShare: 2, comSplit: 45, eduSplit: 40, healthSplit: 15,
  seedMode: "plant", maxSlope: 15, demCell: 30,
  // seedMode = "point": хэрэглэгчийн заасан хавь — Б01-ийн зүүн хойд тэгш хэсэг (ТААМАГЛАЛ, 2026-10-27 зурсан хүрээнээс тойм)
  seedX: 715040, seedY: 5244730, siteHa: "",
  typo: "", centers: 1, satShare: 0, satGap: 600, parkCenter: false, floorGrad: 0,
  jobsMine: 0, jobsPlant: 0, jobsInd: "", famCoef: 2.5, svcMult: 1.3,
  // 2. Тэнхлэг
  arterialW: 60, collectorW: 30, ringOn: true, radials: 2, mode: "organic", gridStep: 320,
  // 3–4. Бүсчлэл, блок
  windbreak: 60, localW: 18, resBlock: 22000, comBlock: 12000, schoolLot: 20000, clinicLot: 10000, kinderLot: 5000, minW: 60, rKinder: 400, rPark: 300,
  // 5. Барилга
  setback: 6, depth: 14, maxLen: 60, gapEnd: 12, floorH: 3.0, sunK: 2, openSouth: true, comGround: true,
  farMaxRes: NORM.farRes, // багтаамжийн тооцоо блокийн FAR-ын хязгаартай нийцнэ
  floorsCom: 6, bcrCom: 45, comPodium: 2, floorsSchool: 3, floorsKinder: 2, floorsClinic: 3, pvShare: 0.3, greenRoof: 0.1,
  m2JobCom: 30, m2JobOffice: 20, m2JobSchool: 60, m2JobClinic: 40,
  // 7. Гудамжны огтлол
  walkW: 3, bikeW: 2, laneW: 3.5, treeSp: 10, parkBays: 1, stopSp: 400, artLanes: 3, colLanes: 1, serviceW: 6,
  // 8. Инженерийн хэрэгцээ
  water: 200, sewage: 95, parking: 1.0, underLv: 1,
  parkVisitor: 15, parkCom: 3, parkPub: 1.5, stallM2: 25, stallUnderM2: 30, underShare: 100, accessShare: 3, evShare: 10, bikePark: 1.0, heatWm2: 60, elecKwHh: 3, dT: 40,
  // Т3/Т4: ахуйн усны халуун хэсэг ба эргэлтийн урсгал — ТААМАГЛАЛ, ШАЛГАХ: БНбД "Барилгын дотор ус хангамж"
  hotShare: 40, circShare: 30,
  // 9. ИБАХ
  rain: "", minSlope: 0.005, drainHa: 5, maxGrade: { arterial: 6, collector: 7, local: 8 },
};

export type Bldg = BldgF & { suitability?:PlanningAssessment;pop: number; hh: number; jobs: number; waterM3: number; sewM3: number; heatKw: number | null; elecKw: number | null };
export type Totals = {
  pop: number; hh: number; jobs: number; jobsBase: number; popFromJobs: number; gfa: number; gfaRes: number; gfaCom: number; foot: number;
  far: number; bcrRes: number; farRes: number; densGross: number; densNet: number;
  greenPublic: number; greenSurface: number; greenPP: number; parkCover: number; kinderCover: number; schoolCover: number; transitCover: number;
  water: number; sewer: number; heatMw: number | null; elecMw: number | null;
  parkNeedRes: number; parkNeedVis: number; parkNeedCom: number; parkNeedPub: number; parkingNeed: number;
  stalls: number; stallsUnder: number; parkSupply: number; parkPerHh: number; parkSurfaceHa: number; parkSurfacePct: number;
  parkAccess: number; parkEv: number; parkBike: number;
  beds: Range; runoff: number; trees: number; walkKm: number; bikeKm: number;
  walk15: number; hubDist: number; hub800: number;
};
export type Plan = {
  notes?: string[]; // байршил сонголтын тайлбар: төв, багасгасан хүн ам
  suitability?:PlanningSuitabilitySummary;
  suitabilityReports?:Partial<Record<PlanningProfile,PlanningSuitabilitySummary>>;
  inp: Inputs; dem: Dem; zone: Rings; site: Rings; siteArea: number; steep: Rings; unsuit: Rings; center: XY; entry: XY | null; road: XY | null;
  prog: Program; streets: Street[]; zones: ZonePiece[]; lots: Lot[]; graph: Graph; scene: Scene; bldgs: Bldg[];
  land: Record<ZoneKey, number> & { road: number }; t: Totals; hubs: XY[];
  nets: Record<Sys, NetOut | null>; heatMain: Path | null; ibah: IbahOut; iters: number;
};

const sum = <T,>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);

/** Барилгын холболтоос тусдаа DEM трассаар нэгдсэн коллекторын цуглуулах зангилаанд хүргэнэ. */
export function residentialSewerNetwork(collection:Graph,loads:Float64Array,net:Net,boundary:Rings,obstacles:Rings,minSlope:number):NetOut{
 if(loads.length!==collection.nodes.length||loads.some(v=>!Number.isFinite(v)||v<0)||!Number.isFinite(minSlope)||minSlope<=0)throw new Error('Суурьшлын бохирын ачаалал, налууг шалгана уу.');
 const terminals=collection.nodes.flatMap((p,i)=>loads[i]>0?[{id:`urban:${i}`,point:[p.x,p.y] as XY,load:loads[i]}]:[]),drainage=terrainSewerPaths(terminals,net,boundary,obstacles);
 const graph=corridorGraph(drainage.paths,[...terminals.map(t=>t.point),...drainage.sources.map(s=>s.point)]);
 for(const source of drainage.sources)if(!graph.nodes.some(p=>dist(p,source.point)<.001)){graph.nodes.push(source.point);graph.adj.push([]);}
 const z=graph.nodes.map(p=>planningElevation(net.dem,...p)),tree=sharedUtilityTree(graph,terminals,drainage.sources,(e,from,to)=>z[from]==null||z[to]==null?Infinity:e.length*(z[to]!<z[from]!?4:1));
 // ТААМАГЛАЛ: хучаас 2.5 м, концепц хамгийн их гүн 6 м, Manning n=.013;
 // оргилын 1.3 нь хуучин төлөвлөгөөний оролт, БНбД-ийн баталгаат коэффициент биш.
 const invert=Float64Array.from(z,h=>h==null?NaN:h-2.5),lineInvert=new Map<typeof tree.lines[number],{from:number;to:number}>(),lifts:{point:XY;headM:number;flow:number}[]=[];
 // Гүн 6 м-ээс хэтэрсэн зангилаанд завсрын өргөлт санал болгож, ёроолыг хучаасын түвшнээс үргэлжлүүлнэ.
 for(const l of tree.lines){let from=invert[l.a];if(z[l.a]!-from>6+1e-6){lifts.push({point:graph.nodes[l.a],headM:z[l.a]!-2.5-from,flow:l.load});from=z[l.a]!-2.5;}const to=Math.min(invert[l.b],from-minSlope*l.length);lineInvert.set(l,{from,to});invert[l.b]=to;}
 const lines=tree.lines.map(l=>{
  const {from,to}=lineInvert.get(l)!,slope=(from-to)/l.length,depth=Math.max(z[l.a]!-from,z[l.b]!-to),q=l.load*1.3/86400;
  const diameter=Math.pow(q*.013*Math.pow(4,5/3)/(Math.PI*Math.sqrt(slope)),3/8)*1000,dn=[200,250,300,400,500,600,800,1000,1200,1600,2000].find(d=>d>=diameter)??null;
  return{sys:'sewer' as const,path:l.path,fromNode:l.a,toNode:l.b,sourceId:l.source,invertFrom:from,invertTo:to,flow:l.load,dn,slope,depth,warn:depth>6||dn==null};
 });
 const total=loads.reduce((a,b)=>a+b,0),unservedLoad=Math.max(0,total-tree.servedLoad),warnings=[
  'Бохирын тусдаа трассыг бүсийн DEM-ээр цуглуулах зангилаанд хүргэв. Тухайн бүсийн өөрийн цэвэрлэх байгууламж руу коллектор/насосны холболтыг тооцно; бүс хооронд бохир дамжуулахгүй.',
  `ТААМАГЛАЛ: оргилын коэффициент 1.3, хучаас 2.5 м, гүн ≤6 м, Manning n=0.013, доод налуу ${minSlope}; хэсэгчилсэн дүүрэлт, БНбД-ийн хурд/налууг ШАЛГАХ.`,
 ];
 if(drainage.sources.length>1)warnings.push('Бүс дотор олон цуглуулах зангилаа байна: нэгдсэн коллектор, өргөх насосыг үнэлнэ.');
 if(lifts.length)warnings.push(`${lifts.length} зангилаанд завсрын өргөлт санал болгов: өөрийн урсгалын гүн 6 м-ээс хэтэрсэн; насос, нөөц ШАЛГАХ.`);
 return{lines,lifts,len:tree.lengthM,maxDn:lines.length?Math.max(...lines.map(l=>l.dn??0))||null:null,maxDepth:lines.length?Math.max(...lines.map(l=>l.depth)):null,srcFlow:tree.servedLoad,unservedLoad,warn:lines.filter(l=>l.warn).length+(unservedLoad>0?1:0),sources:tree.sources.map(s=>({id:s.id,point:s.point,flow:s.load,role:'collection',invertM:invert[graph.nodes.findIndex(p=>dist(p,s.point)<.001)]??null,status:'Бохир цуглуулах зангилаа · өөрийн бүсийн цэвэрлэх байгууламжийн коллектор/насос ШАЛГАХ'})),warnings};
}

// suitable — 2-р хэсгийн «Гадаргын хэлбэр (DEM)» 100% үнэлгээний тохиромжтой (4–5 түвшин) талбай; байхгүй бол зөвхөн налуугаар
type Ctx = { plant: XY | null; sanitary: { rings: Rings; m: number }[]; suitable?: Rings | null; roads?: Path[];suitability?:PlanningSuitability;network?:Net };

export async function runPlan(zone: Rings, inp: Inputs, ctx: Ctx, onStep: (s: string) => void): Promise<Plan> {
  const zb = bbox(zone);
  // Урт тооцооны алхам хооронд хөтчид амсхийх боломж — дэлгэц шинэчлэгдэж, явц харагдана (нэг 40 сек-ийн гацаанаас сэргийлнэ)
  const pause = (msg: string) => { onStep(msg); return new Promise<void>((ok) => setTimeout(ok, 0)); };
  onStep("Өндрийн мэдээлэл авч байна…");
  const dem = await loadDem({ x0: zb.x0 - 500, y0: zb.y0 - 500, x1: zb.x1 + 500, y1: zb.y1 + 500 }, inp.demCell);
  onStep('Байршлын тохиромж · хөрс, цэвдэг, урсац, налуу, замын хүртээмж…');
  const suitability=buildPlanningSuitability({dem,boundary:zone,roads:ctx.roads,environment:ctx.suitability?.environment??await loadPlanningEnvironment(),restrictions:ctx.suitability?.restrictions});
  onStep("Эгц налуу, эхлэх цэг, ойрын зам…");
  const steep = steepArea(dem, zone, inp.maxSlope);
  // DEM-ийн тохиромжоос гадуурх хэсэг (1–3 түвшин) — эгц налуутай хамт хасна
  const unsuit = ctx.suitable ? diff(zone, ctx.suitable) : [];
  const avoid = unionAll([steep,unsuit,...suitability.restrictions.filter(r=>!r.profiles||r.profiles.includes('building')).map(r=>r.rings)]);
  const avail = area(diff(zone, avoid));
  const railPt: XY | null = null; // Төмөр замын цэгээр эхлэх горим хасагдсан
  const referenceSeed: XY = inp.seedMode === "point" ? [inp.seedX, inp.seedY] : seedOf(zone, inp.seedMode === "plant" ? ctx.plant : railPt);
  const candidates:{point:XY;rank:number}[]=[],roadCost=new Float64Array(dem.z.length).fill(Infinity),rejected:Record<string,number>={},roadSuitability=buildPlanningSuitability({...suitability,boundary:ctx.suitability?.boundary??bufPoly(zone,dem.cell*2)});
  // Хугацаагаар (~40 мс) хөтчид чөлөө өгнө — өмнө нь 3000 нүд тутамд (~1.3 с гацалт)
  let slice=performance.now();
  for(let k=0;k<dem.z.length;k++){if(k%100===0&&performance.now()-slice>40){await pause(`Эхлэх цэг: ${Math.round((k/dem.z.length)*100)}%…`);slice=performance.now();}const point:XY=[dem.x0+k%dem.nx*dem.cell,dem.y0+Math.floor(k/dem.nx)*dem.cell];roadCost[k]=evaluatePlanningPoint(roadSuitability,point,'road').cost;if(!inside(...point,zone))continue;
   const value=evaluatePlanningPoint(suitability,point,'building',{maxSlope:inp.maxSlope});
   if(value.allowed&&!planningContains(avoid,...point))candidates.push({point,rank:value.cost+dist(point,referenceSeed)/3000});else for(const reason of value.reasons)rejected[reason]=(rejected[reason]??0)+1;
  }
  candidates.sort((a,b)=>a.rank-b.rank);if(!candidates.length)throw new Error('Суурьшлын тохиромжийн хатуу шалгалт хангасан талбай алга.');
  const seed=candidates[0].point;
  const road = ctx.roads?.length ? nearest(ctx.roads, seed, false) : null;
  // Хөндий (урсацын хуримтлал их) — парк; хамгийн нам цэг — инженерийн бүс (өөрийн урсгалаар)
  const zmask = new Uint8Array(dem.nx * dem.ny);
  const xy = (k: number): XY => [dem.x0 + (k % dem.nx) * dem.cell, dem.y0 + Math.floor(k / dem.nx) * dem.cell];
  for (let k = 0; k < zmask.length; k++) if (inside(...xy(k), zone)) zmask[k] = 1;
  const { acc } = d8(dem, zmask);

  // Тогтмол талбай: хүн амыг талбайн багтаамжаар (program() нь хүн амд шугаман) тогтоож нэг давталтаар төлөвлөнө
  const fixedHa = typeof inp.siteHa === "number" && inp.siteHa > 0 ? inp.siteHa : 0;
  if (fixedHa) inp = { ...inp, pop: Math.max(100, Math.round((inp.pop * Math.min(fixedHa * 1e4, avail)) / program(inp, 1).site / 100) * 100) };
  type Base = Omit<Plan, "t" | "nets" | "heatMain" | "ibah" | "bldgs" | "land">;
  let scale = 1, iters = 0;
  let r: Base;
  const tried: { scale: number; pop: number; r: Base }[] = [];
  for (; iters < 5; iters++) {
    await new Promise((ok) => setTimeout(ok, 0));
    onStep(`Давталт ${iters + 1}: талбай → тэнхлэг → бүсчлэл → блок → барилга…`);
    const prog = program(inp, scale);
    // Дагуул хот: гол хэсэг (1 − satShare) + ногоон зурвасаар (satGap) тусгаарласан дагуул хэсэг
    const sat = inp.satShare > 0 ? inp.satShare / 100 : 0;
    const main = inp.mode === "terrain"
      ? pickBlocks(zone, avoid, seed, prog.site * (1 - sat), dem, inp.gridStep)
      : pickSite(zone, avoid, seed, prog.site * (1 - sat), dem, inp.mode);
    let site = main, satSite: Rings = [];
    if (sat) {
      const gapAvoid = unionAll([avoid, bufPoly(main, inp.satGap)]);
      const rem = parts(diff(zone, gapAvoid)).sort((a, b) => area(b) - area(a))[0];
      if (rem && area(rem) > prog.site * sat * 0.5) {
        satSite = pickSite(zone, gapAvoid, labelPt(rem), prog.site * sat, dem, inp.mode);
        if (satSite.length) site = unionAll([main, satSite]);
      }
    }
    const center = inside(seed[0], seed[1], main) ? seed : labelPt(main);
    const entry = road ? nearest(main, road) : null;
    await pause(`Давталт ${iters + 1}: гол, туслах тэнхлэг…`);
    const ax = axes(main, center, entry, dem, inp,roadCost);
    const hubs: XY[] = [center];
    if (satSite.length) {
      const sc = labelPt(satSite);
      const sx = axes(satSite, sc, nearest(satSite, center), dem, inp,roadCost);
      ax.streets.push(...sx.streets.map((q) => ({ ...q, id: q.id + 500 })));
      if(ctx.network){const path=accessRoute(nearest(main,sc),nearest(satSite,center),ctx.network,[],zone,inp.arterialW/2,inp.maxGrade.arterial);if(path.length)ax.streets.push({id:990,cls:"arterial",path,w:inp.arterialW});}
      hubs.push(sc);
    }
    // Олон төв: гол төвийг тойруулан хоёрдогч төвүүд (гол хэсгийн радиусын 55%)
    if (inp.centers > 1) {
      const Rm = Math.sqrt(area(main) / Math.PI), n = Math.round(inp.centers) - 1;
      for (let k = 0; k < n; k++) {
        const a = (2 * Math.PI * k) / n + Math.PI / 4, p = add(center, mul([Math.cos(a), Math.sin(a)], Rm * 0.55));
        if (inside(p[0], p[1], main)) { hubs.push(p); continue; }
        const q = nearest(main, p);
        hubs.push(add(q, mul(sub(center, q), 0.2)));
      }
    }
    let parkA: XY = center, engA: XY = center, ba = -1, bz = Infinity;
    for (let k = 0; k < acc.length; k++) {
      if (!zmask[k]) continue;
      const p = xy(k);
      if (!inside(p[0], p[1], site)) continue;
      if (acc[k] > ba && dist(p, center) < Math.sqrt(prog.site) * 0.6) { ba = acc[k]; parkA = p; }
      if (dem.z[k] < bz) { bz = dem.z[k]; engA = p; }
    }
    if (inp.parkCenter) parkA = center;
    await pause(`Давталт ${iters + 1}: бүсчлэл, блок хуваалт…`);
    const zn = zoning(site, ax.streets, prog, { centers: hubs, park: parkA, eng: engA }, { windbreak: inp.windbreak, sanitary: ctx.sanitary, localW: inp.localW, parkFirst: inp.parkCenter, parkSpread: inp.rPark * 2 });
    const sd = subdivide(zn.zones, ax.streets, inp);
    await pause(`Давталт ${iters + 1}: гудамжны сүлжээ холбож байна…`);
    const streets: Street[] = connectUrbanStreets([...ax.streets, ...zn.chordStreets, ...sd.local],zone,dem,inp.localW,{suitability:roadSuitability,maxGrade:inp.maxGrade});
    // terrain горимд axes() орох цэгийг торын гол тэнхлэг рүү шилжүүлдэг (ax.E)
    const gate = inp.mode === "terrain" ? ax.E : entry;
    if (road && gate && dist(road, gate) > 20&&ctx.network){const path=accessRoute(road,gate,ctx.network,[],ctx.network.boundary,inp.arterialW/2,inp.maxGrade.arterial);if(path.length)streets.push({ id: 9999, cls: "arterial", path, w: inp.arterialW, ext: true });}
    await pause(`Давталт ${iters + 1}: гудамжны граф…`);
    const graph = buildGraph(streets.filter((s) => !s.ext), dem,suitability);
    if(!graph.nodes.length||!graph.edges.length)throw new Error('Сонгосон талбайд хил, хориг, налуугийн шалгалт хангасан гудамжны сүлжээ олдсонгүй. Байршил эсвэл төлөвлөх хувилбараа өөрчилнө үү.');
    await pause(`Давталт ${iters + 1}: барилга, хашаа, зогсоол, мод…`);
    const scene = await generateAsync(sd.lots, streets, graph, site, { ...inp, hubs, hubR: Math.sqrt(area(site) / Math.PI), bcrMaxRes: NORM.bcrRes, bcrMinRes: NORM.bcrTable[0], farMaxRes: NORM.farRes, farMaxCom: NORM.farCom,acceptFootprint:r=>evaluatePlanningFootprint(suitability,r,{maxSlope:inp.maxSlope}).allowed }, sd.walkCuts);
    const siteArea = area(site);
    r = { inp, dem, zone, site, siteArea, steep, unsuit, center, entry, road, prog, streets, zones: zn.zones, lots: sd.lots, graph, scene, hubs, iters: iters + 1 };
    const pop = sum(scene.bldgs, (b) => (b.gfaRes * inp.netRatio) / inp.m2pp);
    const ratio = inp.pop / Math.max(1, pop);
    tried.push({ scale, pop, r });
    if (fixedHa || Math.abs(ratio - 1) < 0.05 || (siteArea >= avail * 0.97 && ratio > 1)) break;
    // Хүрээлэх + шугаман интерполяц (layout үсрэлттэй тул энгийн пропорц хэлбэлздэг)
    const lo = tried.filter((q) => q.pop < inp.pop).sort((a, b) => b.pop - a.pop)[0];
    const hi = tried.filter((q) => q.pop >= inp.pop).sort((a, b) => a.pop - b.pop)[0];
    let next = lo && hi ? lo.scale + ((inp.pop - lo.pop) / (hi.pop - lo.pop || 1)) * (hi.scale - lo.scale) : scale * Math.max(0.4, Math.min(2.5, ratio));
    if (tried.some((q) => Math.abs(q.scale - next) < 1e-3)) next += 0.004 * (ratio > 1 ? 1 : -1);
    scale = next;
  }
  const best = tried.reduce((m, q) => (Math.abs(q.pop - inp.pop) < Math.abs(m.pop - inp.pop) ? q : m), tried[0]);
  const R = best.r;
  onStep("Хүн ам, ажлын байр, хэрэгцээ…");

  // ---------- Алхам 5: барилга бүрийн хүн ам, ажлын байр, хэрэглээ ----------
  const m2Job = (b: BldgF) => (b.kind === "office" ? inp.m2JobOffice : b.kind === "school" || b.kind === "kinder" ? inp.m2JobSchool : b.kind === "clinic" ? inp.m2JobClinic : b.kind === "eng" ? 0 : inp.m2JobCom);
  const bldgs: Bldg[] = R.scene.bldgs.map((b) => {
    const pop = (b.gfaRes * inp.netRatio) / inp.m2pp, hh = pop / inp.hhSize, waterM3 = (pop * inp.water) / 1000;
    const nonRes = b.gfa - b.gfaRes - b.gfaCom;
    const jobs = b.gfaCom / inp.m2JobCom + (nonRes > 0 && m2Job(b) ? nonRes / m2Job(b) : 0);
    return {
      ...b,suitability:evaluatePlanningFootprint(suitability,b.rings,{maxSlope:inp.maxSlope}), pop, hh, jobs, waterM3, sewM3: (waterM3 * inp.sewage) / 100,
      heatKw: inp.heatWm2 === "" ? null : (b.gfa * Number(inp.heatWm2)) / 1000,
      elecKw: inp.elecKwHh === "" ? null : hh * Number(inp.elecKwHh),
    };
  });
  const land = Object.fromEntries(Object.keys(ZONE).map((k) => [k, 0])) as Record<ZoneKey, number> & { road: number };
  for (const z of R.zones) land[z.cls] += z.area;
  land.road = Math.max(0, R.siteArea - sum(R.zones, (z) => z.area));
  const pop = sum(bldgs, (b) => b.pop), hh = sum(bldgs, (b) => b.hh);
  const resLotA = sum(R.lots.filter((l) => l.use === "res"), (l) => l.area);
  const resBl = bldgs.filter((b) => b.use === "res");
  const rep = R.scene.rep;
  const greenPublic = sum(R.lots.filter((l) => l.use === "park"), (l) => l.area);
  const greenSurface = (Object.keys(GROUND) as (keyof typeof GROUND)[]).filter((k) => GROUND[k].green).reduce((s, k) => s + (rep[`g.${k}`] ?? 0), 0);
  // Хүртээмж: орон сууцны барилгын хүн амаар жигнэнэ
  const resB = bldgs.filter((b) => b.pop > 0), resPop = sum(resB, (b) => b.pop) || 1;
  const cov = (ok: (b: Bldg) => boolean) => (sum(resB.filter(ok), (b) => b.pop) / resPop) * 100;
  const near = (uses: Lot["use"][], Rm: number, minA = 0) => {
    const tg = R.lots.filter((l) => uses.includes(l.use) && l.area >= minA);
    return (b: Bldg) => tg.some((l) => dist(l.c, b.c) <= Rm + Math.sqrt(l.area) / 2);
  };

  // ---------- Алхам 8: инженерийн шугам ----------
  onStep("Инженерийн шугам сүлжээ…");
  const g = R.graph;
  const fac = (f: number) => R.lots.find((l) => l.use === "eng" && (l.fac ?? 0) % 4 === f) ?? R.lots.find((l) => l.use === "eng");
  const srcNode = (f: number) => nearestNode(g, fac(f)?.c ?? R.center);
  const loadOf = (fn: (b: Bldg) => number | null) => {
    const L = new Float64Array(g.nodes.length);
    for (const b of bldgs) { const v = fn(b); if (v) L[nearestNode(g, b.c)] += v; }
    return L;
  };
  // Бүсийн нэг инженерийн төв (дулааны станц / ЦТП): В1, Т1/Т2, Т3/Т4 бүгд эндээс нэг лотокоор — ус ба дулаан ижил мод.
  // Усан сан (fac 1) нь ЦТП-г тэжээнэ. Бохир (К1) тусдаа DEM трасс ба цуглуулах зангилаатай;
  // өмнөх fac 0 инженерийн талбайд байрлуулах боломжийг дараагийн шатанд уялдуулна.
  // Шугам бүрийн дараа хөтчид чөлөө өгнө (дөрвүүлээ нэг дор ~4 с гацдаг байсан)
  const yieldUi = () => new Promise<void>((ok) => setTimeout(ok, 0));
  const hub = srcNode(2);
  onStep("Инженерийн шугам: ус…"); await yieldUi();
  const water = network(g, "water", hub, loadOf((b) => b.waterM3), { toQ: (m3d) => (m3d * 1.3) / 86400, v: 1.0, minDn: 100 });
  const hot = (inp.hotShare ?? 40) / 100, circ = (inp.circShare ?? 30) / 100;
  for (const l of water.lines) { const q = (l.flow * 1.3) / 86400; l.flowHot=l.flow*hot; l.flowCirc=l.flowHot*circ; l.dnHot = dnOf(q * hot, 1.0, 50); l.dnCirc = dnOf(q * hot * circ, 1.0, 50); }
  onStep("Инженерийн шугам: бохир…"); await yieldUi();
  const sewerContext={...ctx.network,dem:R.dem,boundary:R.zone,suitability} as Net;
  const sewer=residentialSewerNetwork(g,loadOf(b=>b.sewM3),sewerContext,R.zone,unionAll(bldgs.map(b=>b.rings)),inp.minSlope);
  if(!g.nodes.length){sewer.unservedLoad=sum(bldgs,b=>b.sewM3);if(sewer.unservedLoad>0){sewer.warn++;sewer.warnings!.push('Барилгын бохирын холболтын зангилаа алга; бүх ачаалал холбогдоогүй.');}}
  onStep("Инженерийн шугам: дулаан, цахилгаан…"); await yieldUi();
  const nets: Record<Sys, NetOut | null> = {
    water,
    sewer,
    // Норм оруулаагүй бол чиглэлийг GFA-аар харуулна, хэмжээг тооцохгүй
    heat: network(g, "heat", hub,loadOf((b) => b.heatKw ?? b.gfa), inp.heatWm2 === "" ? {} : { toQ: (kw) => kw / (4186 * inp.dT), v: 1.5, minDn: 100 }),
    power: network(g, "power", srcNode(3), loadOf((b) => b.elecKw ?? b.gfa), {dem:R.dem}),
    storm: null,
  };
  // GFA is only a topology weight when the load input is absent; never display it as heat or electric demand.
  if(inp.heatWm2==='')for(const l of nets.heat?.lines??[])l.flowKnown=false;
  if(inp.elecKwHh==='')for(const l of nets.power?.lines??[])l.flowKnown=false;
  await yieldUi();
  const heatMain: Path | null = null; // Бүсийн эх үүсвэр; гаднаас дулаан дамжуулах трассгүй.

  // ---------- Алхам 9: ИБАХ ----------
  onStep("ИБАХ: налуу, шороон ажил, урсац…");
  await new Promise((ok) => setTimeout(ok, 0));
  const ibah = analyze(R.dem, R.site, R.lots, g, inp);
  nets.storm = ibah.storm;

  const heat = inp.heatWm2 === "" ? null : sum(bldgs, (b) => b.heatKw ?? 0) / 1000;
  const elec = inp.elecKwHh === "" ? null : sum(bldgs, (b) => b.elecKw ?? 0) / 1000;
  const jobsBase = inp.jobsMine + inp.jobsPlant + (inp.jobsInd === "" ? 0 : Number(inp.jobsInd));
  const resFoot = sum(resBl, (b) => b.foot);
  // ---------- Зогсоолын үзүүлэлт: эрэлт (БНбД орон сууц + зочин + үйлчилгээ + нийтийн барилга), нийлүүлэлт, талбай ----------
  const pubGfa = sum(bldgs.filter((b) => b.use === "school" || b.use === "kinder" || b.use === "clinic"), (b) => b.gfa);
  const parking = (() => {
    const res = hh * inp.parking;
    const vis = res * (inp.parkVisitor / 100);
    const com = (sum(bldgs, (b) => b.gfaCom) / 100) * inp.parkCom;
    const pub = (pubGfa / 100) * inp.parkPub;
    const need = res + vis + com + pub;
    // Ил зогсоолын багтаамж = зурсан зогсоолын гадаргуу / нэг зайн талбай (зураасны тоо нь зөвхөн чимэглэл)
    const surfaceM2 = rep["g.parking"] ?? 0;
    const stalls = Math.floor(surfaceM2 / Math.max(5, inp.stallM2));
    // Далд зогсоол: орон сууцны суурийн талбайн underShare хувь, underLv давхарт
    const stallsUnder = Math.floor((resFoot * (inp.underShare / 100) * inp.underLv) / Math.max(5, inp.stallUnderM2));
    const supply = stalls + stallsUnder;
    return {
      parkNeedRes: res, parkNeedVis: vis, parkNeedCom: com, parkNeedPub: pub, parkingNeed: need,
      stalls, stallsUnder, parkSupply: supply, parkPerHh: hh ? supply / hh : 0,
      parkSurfaceHa: surfaceM2 / 1e4, parkSurfacePct: (surfaceM2 / R.siteArea) * 100,
      parkAccess: Math.ceil(supply * (inp.accessShare / 100)), parkEv: Math.ceil(supply * (inp.evShare / 100)),
      parkBike: Math.ceil(hh * inp.bikePark),
    };
  })();
  const buildingSuitability=summarizePlanningSuitability(suitability,bldgs.map(b=>b.suitability!),rejected,candidates.length);
  return {
    ...R, bldgs, land, nets, heatMain, ibah,suitability:buildingSuitability,suitabilityReports:{building:buildingSuitability,road:summarizePlanningPaths(ctx.network?.suitability??roadSuitability,R.streets.map(s=>s.path),'road'),utility:summarizePlanningPaths(ctx.network?.suitability??roadSuitability,Object.values(nets).flatMap(n=>n?.lines.map(l=>l.path)??[]),'utility')},
    t: {
      pop, hh, jobs: sum(bldgs, (b) => b.jobs), jobsBase, popFromJobs: jobsBase * inp.famCoef * inp.svcMult,
      gfa: sum(bldgs, (b) => b.gfa), gfaRes: sum(bldgs, (b) => b.gfaRes), gfaCom: sum(bldgs, (b) => b.gfaCom), foot: rep.foot ?? 0,
      far: sum(bldgs, (b) => b.gfa) / R.siteArea, bcrRes: resLotA ? resFoot / resLotA : 0, farRes: resLotA ? sum(resBl, (b) => b.gfa) / resLotA : 0,
      densGross: pop / (R.siteArea / 1e4), densNet: resLotA ? pop / (resLotA / 1e4) : 0,
      greenPublic, greenSurface, greenPP: pop ? greenPublic / pop : 0,
      parkCover: cov(near(["park"], NORM.parkR, NORM.parkMinHa * 1e4)), kinderCover: cov(near(["kinder"], inp.rKinder)),
      schoolCover: cov(near(["school"], 750)), transitCover: cov((b) => R.scene.stops.some((s) => dist(s, b.c) <= NORM.transit)),
      water: sum(bldgs, (b) => b.waterM3), sewer: sum(bldgs, (b) => b.sewM3), heatMw: heat, elecMw: elec,
      ...parking, stalls: parking.stalls, stallsUnder: parking.stallsUnder,
      beds: [(pop / 1000) * NORM.beds[0], (pop / 1000) * NORM.beds[1]],
      runoff: runoffC(rep), trees: rep.trees ?? 0,
      walkKm: ((rep["g.sidewalk"] ?? 0) / Math.max(1, inp.walkW) + (rep["g.walk"] ?? 0) / 3) / 1000,
      bikeKm: (rep["g.bike"] ?? 0) / Math.max(0.5, inp.bikeW) / 1000,
      // 15 минут явган ≈ 1.2 км (ТААМАГЛАЛ: 4.8 км/ц): худалдаа, сургууль, эмнэлэг, парк бүгд хүрэхүйц
      walk15: cov((b) => [near(["com"], 1200), near(["school"], 1200), near(["clinic"], 1200), near(["park"], 1200)].every((ok) => ok(b))),
      hubDist: sum(resB, (b) => b.pop * Math.min(...R.hubs.map((h) => dist(h, b.c)))) / resPop,
      hub800: cov((b) => dist(R.hubs[0], b.c) <= 800),
    },
  };
}

// ---------- Нормын шалгалт ----------
export type Check = { step: number; label: string; value: string; norm: string; src: string; ok: boolean | null };
const inR = (v: number, [a, b]: Range) => v >= a && v <= b;
const n0 = (v: number, d = 0) => v.toLocaleString("en-US", { maximumFractionDigits: d });

export function checks(pl: Plan): Check[] {
  const t = pl.t, p = pl.inp, S = pl.siteArea;
  const pct = (v: number) => (v / S) * 100;
  const pub = pl.land.com + pl.land.edu + pl.land.health, green = pl.land.park + pl.land.protect;
  return [
    { step: 1, label: "Хүн ам (зорилт)", value: `${n0(t.pop)} / ${n0(p.pop)}`, norm: "±5%", src: "Хөтөлбөр", ok: Math.abs(t.pop / p.pop - 1) <= 0.05 },
    { step: 1, label: "15 минутын хүртээмж (1.2 км)", value: `${n0(t.walk15)}%`, norm: "худалдаа + сургууль + эмнэлэг + парк", src: "15-Minute City · ТААМАГЛАЛ", ok: null },
    { step: 1, label: "Төв хүртэлх дундаж зай", value: `${n0(t.hubDist)} м`, norm: `${pl.hubs.length} төв`, src: "Загвар", ok: null },
    { step: 1, label: "Гол төвөөс 800 м дотор", value: `${n0(t.hub800)}%`, norm: "TOD: буудлаас 800 м", src: SRC.tod, ok: null },
    { step: 1, label: "Нягтшил (нийт)", value: `${n0(t.densGross)} хүн/га`, norm: "150–300 (ШАЛГАХ: FAR ≤1.2-тай нийцэхгүй, бага давхрын суурингийн заалт)", src: SRC.table, ok: null },
    { step: 3, label: "Орон сууцны бүс", value: `${n0(pct(pl.land.res), 1)}%`, norm: "35–45%", src: SRC.table, ok: inR(pct(pl.land.res), NORM.share.res) },
    { step: 3, label: "Нийтийн үйлчилгээ", value: `${n0(pct(pub), 1)}%`, norm: "8–12%", src: SRC.table, ok: inR(pct(pub), NORM.share.pub) },
    { step: 3, label: "Ногоон бүс", value: `${n0(pct(green), 1)}%`, norm: "25–40%", src: SRC.table, ok: inR(pct(green), NORM.share.green) },
    { step: 4, label: "Зам, гудамж", value: `${n0(pct(pl.land.road), 1)}%`, norm: "20–25%", src: SRC.table, ok: inR(pct(pl.land.road), NORM.share.road) },
    { step: 5, label: "BCR (орон сууцны блок)", value: `${n0(t.bcrRes * 100, 1)}%`, norm: "25–40% · ≤40 (Х.6.1)", src: `${SRC.table} · ${SRC.bnbd}`, ok: inR(t.bcrRes * 100, NORM.bcrTable) },
    { step: 5, label: "FAR (орон сууцны блок)", value: n0(t.farRes, 2), norm: "≤1.2 (Х.6.1)", src: SRC.bnbd, ok: t.farRes <= NORM.farRes },
    { step: 5, label: "Нягтшил (орон сууцны блок)", value: `${n0(t.densNet)} хүн/га`, norm: "≤450 (З.6.9)", src: SRC.bnbd, ok: t.densNet <= NORM.densityNetMax },
    { step: 7, label: "Зогсоол, орон сууц (ил + далд)", value: `${n0(t.stalls + t.stallsUnder)} / ${n0(t.parkNeedRes)}`, norm: `${NORM.park.bnbdRes}/өрх (З.10.32 — ШАЛГАХ)`, src: SRC.bnbd, ok: t.parkSupply >= t.parkNeedRes },
    { step: 7, label: "Зогсоол, нийт эрэлт (зочин, үйлчилгээ орсон)", value: `${n0(t.parkSupply)} / ${n0(t.parkingNeed)}`, norm: `зочин ${p.parkVisitor}%, үйлчилгээ ${p.parkCom}/100 м² (ШАЛГАХ)`, src: `${SRC.ite} · ТААМАГЛАЛ`, ok: t.parkSupply >= t.parkingNeed },
    { step: 7, label: "Зогсоол нэг өрхөд", value: `${n0(t.parkPerHh, 2)} зай/өрх`, norm: `нийтийн тээврийн 500 м дотор ≤${NORM.park.todMax} (ТААМАГЛАЛ)`, src: SRC.tod, ok: t.transitCover < 90 ? null : t.parkPerHh <= NORM.park.todMax },
    { step: 7, label: "Ил зогсоолын талбай", value: `${n0(t.parkSurfaceHa, 2)} га (${n0(t.parkSurfacePct, 1)}%)`, norm: `≤${NORM.park.surfaceMaxPct}% (ТААМАГЛАЛ)`, src: "ТААМАГЛАЛ", ok: t.parkSurfacePct <= NORM.park.surfaceMaxPct },
    { step: 7, label: "Хүртээмжтэй зогсоол", value: `${n0(t.parkAccess)} зай · ${n0(p.accessShare, 1)}%`, norm: `≥${NORM.park.accessAda}% (ШАЛГАХ)`, src: SRC.ada, ok: p.accessShare >= NORM.park.accessAda },
    { step: 7, label: "Цахилгаан тээврийн цэнэглэх зай", value: `${n0(t.parkEv)} зай · ${n0(p.evShare, 1)}%`, norm: `≥${NORM.park.evEpbd}% (ШАЛГАХ)`, src: SRC.epbd, ok: p.evShare >= NORM.park.evEpbd },
    { step: 7, label: "Дугуйн зогсоол", value: `${n0(t.parkBike)} зай · ${n0(p.bikePark, 2)}/өрх`, norm: `≥${NORM.park.bikePerHh}/өрх (ШАЛГАХ)`, src: SRC.epbd, ok: p.bikePark >= NORM.park.bikePerHh },
    { step: 6, label: "Нийтийн ногоон / хүн", value: `${n0(t.greenPP, 1)} м²`, norm: "≥6 (Х.8.2) · ≥9 · 15–20", src: `${SRC.bnbd} · ${SRC.who}`, ok: t.greenPP >= NORM.greenWho },
    { step: 6, label: "Парк ≤300 м (≥0.5 га)", value: `${n0(t.parkCover)}%`, norm: "100%", src: SRC.table, ok: t.parkCover >= 99 },
    { step: 6, label: `Цэцэрлэг ≤${p.rKinder} м`, value: `${n0(t.kinderCover)}%`, norm: "100%", src: SRC.table, ok: t.kinderCover >= 99 },
    { step: 7, label: "Нийтийн тээвэр ≤500 м", value: `${n0(t.transitCover)}%`, norm: "100% (З.10.22)", src: SRC.bnbd, ok: t.transitCover >= 99 },
    { step: 7, label: "Явган / дугуйн зам", value: `${n0(p.walkW, 1)} / ${n0(p.bikeW, 1)} м`, norm: "≥2–3 / 1.5–2", src: SRC.table, ok: p.walkW >= NORM.walk && inR(p.bikeW, NORM.bike) },
    { step: 8, label: "Бохирын хамгийн их гүн", value: `${n0(pl.nets.sewer?.maxDepth ?? 0, 1)} м`, norm: `≤6 м, эс бөгөөс насос (i≥${p.minSlope * 100}%, хучаас 2.5 м — ШАЛГАХ)`, src: "ТААМАГЛАЛ", ok: (pl.nets.sewer?.warn ?? 0) === 0 },
    { step: 9, label: "Налуу хэтэрсэн гудамжны хэсэг", value: String(pl.ibah.grade.over), norm: `${p.maxGrade.arterial}/${p.maxGrade.collector}/${p.maxGrade.local}% (ШАЛГАХ)`, src: "ТААМАГЛАЛ", ok: pl.ibah.grade.over === 0 },
    { step: 9, label: "Үерийн эрсдэлтэй блок", value: String(pl.ibah.floodLots.length), norm: "0 — суваг, хоолой", src: "D8 урсац", ok: pl.ibah.floodLots.length === 0 },
  ];
}
