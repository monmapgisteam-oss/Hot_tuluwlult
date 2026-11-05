import {d8,type Dem} from './dem';
import {terrainSegmentMaxGrade} from './terrainRoute';
import {area,bbox,diff,inside,inter,dist,type Rings,type XY} from './geom';
import type {Feat} from './geo';
import {FACTORS,curveScore} from '../suit';
import {SegIndex,type Seg} from '../server/grid';

const SERVICE_URL='';
const ELEVATION_URL='Copernicus DEM GLO-30';

export const PLANNING_SUITABILITY_VERSION='site-suitability-v1';
export type PlanningProfile='building'|'road'|'utility';
/** crossing — тухайн профайлд хатуу хориг биш, өртгийн үржүүлэгчтэй гатлах боломж (жишээ нь төмөр замын инженерийн гарц). */
export type PlanningRestriction={id:string;label:string;rings:Rings;profiles?:PlanningProfile[];crossing?:Partial<Record<PlanningProfile,number>>};
/** Хориг нь тухайн профайлыг бүрэн хаадаг эсэх (гатлах өртөгтэй бол хаахгүй). */
export const blocksProfile=(r:PlanningRestriction,profile:PlanningProfile)=>(!r.profiles||r.profiles.includes(profile))&&!r.crossing?.[profile];
export type EnvironmentalLayer={key:string;label:string;url:string;field:string;status:'loaded'|'missing';features:Feat[];error?:string};
export type PlanningEnvironment={layers:EnvironmentalLayer[];loadedAt:string};
export type PlanningSuitability={version:string;dem:Dem;boundary:Rings;roads:XY[][];restrictions:PlanningRestriction[];environment?:PlanningEnvironment};
export type PlanningEvidence={slopePct:number|null;flowHa:number|null;reliefM:number|null;roadDistanceM:number|null;environment:Record<string,{value:string|null;score:number|null;source:string}>;demCellM:number;terrainSamples?:number};
export type PlanningAssessment={allowed:boolean;score:number|null;cost:number;reasons:string[];missing:string[];evidence:PlanningEvidence;coverage:number};
export type PlanningSuitabilitySummary={version:string;profile:PlanningProfile;assessed:number;placed:number;rejected:Record<string,number>;minScore:number|null;meanScore:number|null;maxSlopePct:number|null;maxFlowHa:number|null;maxReliefM:number|null;maxLongitudinalGradePct?:number|null;demCellM:number;environmentCoverage:number;missing:string[];sources:string[];assumptions:string[]};

const keys=['soil_code','soil_group','permafrost_2016','land_class','landscape'];
const factors=FACTORS.filter(f=>keys.includes(f.key));
let environmentPromise:Promise<PlanningEnvironment>|undefined;
/** Одоо байгаа GIS эх сурвалжийг нэг удаа уншина; татагдаагүйг тохиромжтой гэж нөхөхгүй. */
export function loadPlanningEnvironment():Promise<PlanningEnvironment>{
 if(!environmentPromise)environmentPromise=Promise.resolve({layers:[],loadedAt:new Date().toISOString()});
 return environmentPromise;
}
export function buildPlanningSuitability(o:{dem:Dem;boundary:Rings;roads?:XY[][];restrictions?:PlanningRestriction[];environment?:PlanningEnvironment}):PlanningSuitability{
 return{version:PLANNING_SUITABILITY_VERSION,dem:o.dem,boundary:o.boundary,roads:o.roads??[],restrictions:o.restrictions??[],environment:o.environment};
}

type Terrain={flow:Float64Array;valid:Uint8Array};
const terrainCache=new WeakMap<Dem,Terrain>();
function terrain(d:Dem){
 let t=terrainCache.get(d);if(t)return t;
 const valid=Uint8Array.from(d.z,z=>Number.isFinite(z)&&z!==-999999?1:0),flow=d8(d,valid).acc;
 for(let i=0;i<flow.length;i++)flow[i]*=d.cell*d.cell/1e4;
 t={flow,valid};terrainCache.set(d,t);return t;
}
/** DEM гаднах цэгийг захын өндрөөр clamp хийж зохиохгүй. */
export function planningElevation(d:Dem,x:number,y:number):number|null{
 if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(d.cell)||d.cell<=0||d.nx<2||d.ny<2)return null;
 const fx=(x-d.x0)/d.cell,fy=(y-d.y0)/d.cell;
 if(fx<0||fy<0||fx>d.nx-1||fy>d.ny-1)return null;
 const i=Math.min(d.nx-2,Math.floor(fx)),j=Math.min(d.ny-2,Math.floor(fy)),tx=fx-i,ty=fy-j;
 const a=d.z[j*d.nx+i],b=d.z[j*d.nx+i+1],c=d.z[(j+1)*d.nx+i],e=d.z[(j+1)*d.nx+i+1];
 if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(c)||!Number.isFinite(e)||a===-999999||b===-999999||c===-999999||e===-999999)return null;
 return a*(1-tx)*(1-ty)+b*tx*(1-ty)+c*(1-tx)*ty+e*tx*ty;
}
export function planningTerrainAt(d:Dem,x:number,y:number){
 const z=planningElevation(d,x,y);if(z==null)return null;
 const left=Math.max(d.x0,x-d.cell),right=Math.min(d.x0+(d.nx-1)*d.cell,x+d.cell),bottom=Math.max(d.y0,y-d.cell),top=Math.min(d.y0+(d.ny-1)*d.cell,y+d.cell);
 const zs=[planningElevation(d,left,y),planningElevation(d,right,y),planningElevation(d,x,bottom),planningElevation(d,x,top)];
 if(zs.some(z=>z==null)||right===left||top===bottom)return null;
 const v=zs as number[],slopePct=Math.hypot((v[1]-v[0])/(right-left),(v[3]-v[2])/(top-bottom))*100;
 const k=Math.round((y-d.y0)/d.cell)*d.nx+Math.round((x-d.x0)/d.cell);
 return{z,slopePct,flowHa:terrain(d).flow[k],reliefM:Math.max(z,...v)-Math.min(z,...v)};
}
type RayEdge=[number,number,number,number];
type PolygonIndex={rings:Rings;bounds:ReturnType<typeof bbox>;rows:RayEdge[][];rowScale:number};
type IndexedContext={boundary:PolygonIndex;restrictions:(PlanningRestriction&PolygonIndex)[];environment:Map<string,{feature:Feat;polygon:PolygonIndex}[]>};
const polygonCache=new WeakMap<Rings,PolygonIndex>();
/** Яг even-odd шалгалтад тухайн Y огтлох боломжтой ирмэгүүдийг л авна; координат, нягтралыг өөрчлөхгүй. */
function polygonIndex(rings:Rings):PolygonIndex{
 const cached=polygonCache.get(rings);if(cached)return cached;
 const bounds=bbox(rings),count=Math.max(1,Math.min(256,Math.ceil(Math.sqrt(rings.reduce((n,r)=>n+r.length,0))))),rows=Array.from({length:count},()=>[] as RayEdge[]),rowScale=bounds.y1>bounds.y0?count/(bounds.y1-bounds.y0):0;
 const row=(y:number)=>Math.max(0,Math.min(count-1,Math.floor((y-bounds.y0)*rowScale)));
 for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [xi,yi]=ring[i],[xj,yj]=ring[j];if(yi===yj)continue;
  const edge:RayEdge=[xi,yi,xj,yj];for(let k=row(Math.min(yi,yj));k<=row(Math.max(yi,yj));k++)rows[k].push(edge);
 }
 const result={rings,bounds,rows,rowScale};polygonCache.set(rings,result);return result;
}
const contextCache=new WeakMap<PlanningSuitability,IndexedContext>();
function indexed(c:PlanningSuitability){
 let index=contextCache.get(c);if(index)return index;
 index={boundary:polygonIndex(c.boundary),restrictions:c.restrictions.filter(r=>r.rings.length).map(r=>({...r,...polygonIndex(r.rings)})),environment:new Map((c.environment?.layers??[]).map(l=>[l.key,l.features.filter(f=>f.geometry.rings?.length).map(feature=>({feature,polygon:polygonIndex(feature.geometry.rings as Rings)}))]))};
 contextCache.set(c,index);return index;
}
function contains(p:PolygonIndex,x:number,y:number){
 const b=p.bounds;if(!(x>=b.x0&&x<=b.x1&&y>=b.y0&&y<=b.y1))return false;
 const row=Math.max(0,Math.min(p.rows.length-1,Math.floor((y-b.y0)*p.rowScale)));let result=false;
 for(const [xi,yi,xj,yj]of p.rows[row])if(yi>y!==yj>y&&x<((xj-xi)*(y-yi))/(yj-yi)+xi)result=!result;
 return result;
}
/** Олон удаа шалгах саадын яг геометр; even-odd дүрэм, координат хэвээр. */
export const planningContains=(rings:Rings,x:number,y:number)=>contains(polygonIndex(rings),x,y);
// ArcGIS геометрийн объект цэг бүрт дахин үүсгэхгүйгээр яг шугамын зайг олно.
// Хэрчмийн орон зайн индекс: нүд бүрт бүх замыг шалгавал төлөвлөлт хэдэн минут гацдаг.
const roadIndexes=new WeakMap<XY[][],SegIndex>();
export function planningRoadDistance(paths:XY[][],[x,y]:XY):number|null{
 if(!paths.length)return null;
 let index=roadIndexes.get(paths);
 if(!index){const segs:Seg[]=[];for(const p of paths)for(let i=1;i<p.length;i++)segs.push([p[i-1][0],p[i-1][1],p[i][0],p[i][1]]);index=new SegIndex(segs);roadIndexes.set(paths,index);}
 const d=index.nearest(x,y,100000);
 return Number.isFinite(d)?d:null;
}
const missingSurvey=['Үерийн тооцоот түвшин / гол, усны нарийвчилсан хил','Инженер-геологи, газрын доорх ус / суурийн даац','Кадастр, баталгаажсан хамгаалалтын зурвас'];
export const SUITABILITY_ASSUMPTIONS=[
 'ТААМАГЛАЛ: олон шалгуурын жин, зай ба эрсдэлийн өртгийн үржүүлэгч нь концепцийн эрэмбэ; барилгын норм биш.',
 'D8 ус хураах талбай нь DEM хүрээгээр хязгаарлагдсан гадаргын урсацын screening; баталгаажсан үерийн зураг биш.',
 'Хөрс, цэвдэг, газрын ангилал нь бүс нутгийн ерөнхий GIS; талбайн геотехникийн судалгааг орлохгүй.',
 'DEM-ээс нарийн дотоод дээжлэл нь эх өндрийн торны бодит нягтралыг нэмэгдүүлэхгүй; маршрутын зөөлөн өртгийг эх DEM торонд интерполяцлана.',
];
/** Хатуу хориг нь зөвхөн өгсөн хил, бодит саад, сонгосон налуугийн босго. */
export function evaluatePlanningPoint(c:PlanningSuitability,p:XY,profile:PlanningProfile,o:{maxSlope?:number}={}):PlanningAssessment{
 const [x,y]=p,reasons:string[]=[],missing=[...missingSurvey],t=planningTerrainAt(c.dem,x,y),index=indexed(c);
 if(!contains(index.boundary,x,y))reasons.push('outside-boundary');
 if(!t){reasons.push('missing-dem');missing.push('DEM хамралт / өндөр');}
 if(t&&o.maxSlope!=null&&t.slopePct>o.maxSlope)reasons.push('slope-limit');
 let crossing=1;
 for(const r of index.restrictions)if((!r.profiles||r.profiles.includes(profile))&&contains(r,x,y)){if(blocksProfile(r,profile))reasons.push(r.id);else crossing*=r.crossing![profile]!;}
 let envWeight=0,envScore=0,matched=0;const environment:PlanningEvidence['environment']={};
 for(const f of factors){
  const layer=c.environment?.layers.find(l=>l.key===f.key),hits=(index.environment.get(f.key)??[]).filter(({polygon})=>contains(polygon,x,y)),values=hits.map(({feature})=>String(feature.attributes[f.field!]??'').replace(/\s+/g,' ').trim()).filter(Boolean),known=values.filter(v=>f.cats?.[v]!=null);
  const value=values.length?[...new Set(values)].join(' / '):null,score=known.length?Math.min(...known.map(v=>f.cats![v])):null;
  environment[f.key]={value,score,source:layer?.url??`${SERVICE_URL}/${f.layer}`};
  if(score!=null){envScore+=score*f.weight;envWeight+=f.weight;matched++;}else missing.push(`${f.label}: ${layer?.status==='missing'?'татагдаагүй':value?'онооны ангилал тодорхойгүй':'талбайн хамралтгүй'}`);
 }
 const roadDistanceM=planningRoadDistance(c.roads,p);
 if(roadDistanceM==null)missing.push('Холбох замын геометр');
 const evidence:PlanningEvidence={slopePct:t?.slopePct??null,flowHa:t?.flowHa??null,reliefM:t?.reliefM??null,roadDistanceM,environment,demCellM:c.dem.cell};
 if(!t)return{allowed:false,score:null,cost:Infinity,reasons,missing,evidence,coverage:matched/(factors.length+1)};
 const slopeFactor=FACTORS.find(f=>f.key==='slope')!,flowFactor=FACTORS.find(f=>f.key==='flow')!;
 const slopeScore=curveScore(slopeFactor.curve!,t.slopePct),flowScore=curveScore(flowFactor.curve!,t.flowHa);
 const weights=profile==='building'?[.45,.25,.2,.1]:profile==='road'?[.55,.25,.15,.05]:[.35,.3,.3,.05];
 const parts:[number,number][]=[[slopeScore,weights[0]],[flowScore,weights[1]],...(envWeight?[[envScore/envWeight,weights[2]] as [number,number]]:[]),...(roadDistanceM!=null?[[1/(1+roadDistanceM/1000),weights[3]] as [number,number]]:[])];
 const score=parts.reduce((n,[v,w])=>n+v*w,0)/parts.reduce((n,[,w])=>n+w,0);
 // Өндөр ус хураах талбай, муу хөрс нь тойрох өртгийг өсгөнө; усны хуульчилсан хориг гэж нэрлэхгүй.
 const cost=(1+4*(1-score)+2*(1-flowScore))*crossing;
 return{allowed:!reasons.length,score,cost:reasons.length?Infinity:cost,reasons,missing,evidence,coverage:(matched+1)/(factors.length+1)};
}

const routingCostCache=new WeakMap<PlanningSuitability,Partial<Record<'road'|'utility',Float32Array>>>();
/** Өртгийг DEM-ийн эх торонд нэг удаа тооцоод интерполяцлана. Хатуу хоригийг жинхэнэ вектор хилээр шалгана. */
export function planningRoutingCost(c:PlanningSuitability,p:XY,profile:'road'|'utility'):number{
 const [x,y]=p,d=c.dem;
 const index=indexed(c);
 if(planningElevation(d,x,y)==null||!contains(index.boundary,x,y)||index.restrictions.some(r=>blocksProfile(r,profile)&&contains(r,x,y)))return Infinity;
 const crossing=index.restrictions.reduce((m,r)=>!blocksProfile(r,profile)&&r.crossing?.[profile]&&contains(r,x,y)?m*r.crossing[profile]!:m,1);
 let grids=routingCostCache.get(c);if(!grids){grids={};routingCostCache.set(c,grids);}
 let grid=grids[profile];if(!grid){grid=new Float32Array(d.nx*d.ny).fill(NaN);grids[profile]=grid;}
 const fx=(x-d.x0)/d.cell,fy=(y-d.y0)/d.cell,i=Math.min(d.nx-2,Math.floor(fx)),j=Math.min(d.ny-2,Math.floor(fy)),tx=fx-i,ty=fy-j;
 const value=(column:number,row:number)=>{
  const k=row*d.nx+column;if(Number.isNaN(grid![k])){
   const a=evaluatePlanningPoint(c,[d.x0+column*d.cell,d.y0+row*d.cell],profile);
   // Нүдний төв хоригт байсан ч зөөлөн өртгийг тусад нь хадгална: хориотой хил дээрх interpolation зөвшөөрлийг өөрчлөхгүй.
   grid![k]=a.score==null||a.evidence.flowHa==null?Infinity:1+4*(1-a.score)+2*(1-curveScore(FACTORS.find(f=>f.key==='flow')!.curve!,a.evidence.flowHa));
  }return grid![k];
 };
 let result=0;
 for(const [column,row,weight]of [[i,j,(1-tx)*(1-ty)],[i+1,j,tx*(1-ty)],[i,j+1,(1-tx)*ty],[i+1,j+1,tx*ty]])if(weight>1e-10)result+=value(column,row)*weight;
 return result*crossing;
}

/** Бүх envelope-ийг шалгана: төв ганцаараа зөв байсан ч ирмэг нь саад/налуу дайрч болохгүй. */
export function evaluatePlanningFootprint(c:PlanningSuitability,rings:Rings,o:{maxSlope:number;profile?:PlanningProfile}):PlanningAssessment{
 const profile=o.profile??'building',b=bbox(rings),center:XY=[(b.x0+b.x1)/2,(b.y0+b.y1)/2],out=evaluatePlanningPoint(c,center,profile,o),reasons=new Set(out.reasons);
 if(area(diff(rings,c.boundary))>.01)reasons.add('outside-boundary');
 for(const r of c.restrictions)if(blocksProfile(r,profile)&&r.rings.length&&area(inter(rings,r.rings))>.01)reasons.add(r.id);
 const step=Math.max(5,Math.min(20,c.dem.cell/2)),points:XY[]=rings.flat().map(p=>[p[0],p[1]]);
 for(let y=b.y0;y<=b.y1;y+=step)for(let x=b.x0;x<=b.x1;x+=step)if(inside(x,y,rings))points.push([x,y]);
 let low=Infinity,high=-Infinity,maxSlope=0,maxFlow=0,valid=0;
 for(const p of points){const t=planningTerrainAt(c.dem,...p);if(!t){reasons.add('missing-dem');continue;}valid++;low=Math.min(low,t.z);high=Math.max(high,t.z);maxSlope=Math.max(maxSlope,t.slopePct);maxFlow=Math.max(maxFlow,t.flowHa);if(t.slopePct>o.maxSlope)reasons.add('slope-limit');}
 if(!valid)reasons.add('missing-dem');
 out.evidence={...out.evidence,slopePct:valid?maxSlope:null,flowHa:valid?maxFlow:null,reliefM:valid?high-low:null,terrainSamples:points.length};
 out.reasons=[...reasons];out.allowed=!reasons.size;if(!out.allowed)out.cost=Infinity;
 if(reasons.has('missing-dem')&&!out.missing.includes('DEM хамралт / өндөр'))out.missing.push('DEM хамралт / өндөр');
 return out;
}
export function summarizePlanningSuitability(c:PlanningSuitability,assessments:PlanningAssessment[],rejected:Record<string,number>={},assessed=assessments.length):PlanningSuitabilitySummary{
 const known=assessments.filter(a=>a.score!=null),values=(key:'slopePct'|'flowHa'|'reliefM')=>assessments.map(a=>a.evidence[key]).filter((v):v is number=>v!=null);
 const max=(key:'slopePct'|'flowHa'|'reliefM')=>values(key).reduce<number|null>((n,v)=>Math.max(n??-Infinity,v),null);
 return{version:PLANNING_SUITABILITY_VERSION,profile:'building',assessed,placed:assessments.length,rejected,minScore:known.length?known.reduce((n,a)=>Math.min(n,a.score!),Infinity):null,meanScore:known.length?known.reduce((n,a)=>n+a.score!,0)/known.length:null,maxSlopePct:max('slopePct'),maxFlowHa:max('flowHa'),maxReliefM:max('reliefM'),demCellM:c.dem.cell,environmentCoverage:assessments.length?assessments.reduce((n,a)=>n+Object.values(a.evidence.environment).filter(e=>e.score!=null).length/factors.length,0)/assessments.length:0,missing:[...new Set(assessments.length?assessments.flatMap(a=>a.missing):[...missingSurvey,...factors.map(f=>f.label)])],sources:[ELEVATION_URL,...(c.environment?.layers??[]).filter(l=>l.status==='loaded').map(l=>l.url)],assumptions:[...SUITABILITY_ASSUMPTIONS]};
}
export function summarizePlanningPaths(c:PlanningSuitability,paths:XY[][],profile:'road'|'utility'):PlanningSuitabilitySummary{
 const assessments:PlanningAssessment[]=[],seen=new Set<string>(),rejected:Record<string,number>={};let maxGrade:number|null=null;
 const step=Math.max(1,Math.min(c.dem.cell/2,25));
 for(const path of paths)for(let i=1;i<path.length;i++){
  const a=path[i-1],b=path[i],length=dist(a,b);if(!Number.isFinite(length)||length<1e-6)continue;
  const peak=terrainSegmentMaxGrade(c.dem,a,b);if(Number.isFinite(peak))maxGrade=Math.max(maxGrade??0,peak);
  const count=Math.max(1,Math.ceil(length/step));
  for(let j=0;j<=count;j++){
   const p:XY=[a[0]+(b[0]-a[0])*j/count,a[1]+(b[1]-a[1])*j/count],key=p.map(v=>v.toFixed(3)).join(',');
   if(seen.has(key))continue;seen.add(key);const result=evaluatePlanningPoint(c,p,profile);assessments.push(result);for(const reason of result.reasons)rejected[reason]=(rejected[reason]??0)+1;
  }
 }
 return{...summarizePlanningSuitability(c,assessments,rejected),profile,placed:paths.filter(p=>p.length>1).length,maxLongitudinalGradePct:maxGrade};
}
