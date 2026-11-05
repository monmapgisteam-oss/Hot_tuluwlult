import type {Rings} from './geom';
import type {Point2} from './sharedUtilityGraph';
import {validSection,type StreetSection} from './streetSection';
/** width = хучилтын (зорчих хэсэг + будсан/өргөгдсөн голын зурвас) өргөн; section = CGA маягийн эгнээний огтлол (сонголттой).
 * elevation (сонголттой): [тэнхлэгийн станц м, газраас дээших өндөр м] — гүүр / олон түвшний уулзвар (шугаман интерполяц, байхгүй = 0).
 * mode: авто (анхны) / явган хүний / дугуйн / хосолсон (явган + дугуй) зам — авто бус зам хөдөлгөөний сүлжээнд орохгүй. */
export type RoadMode='car'|'pedestrian'|'bike'|'shared';
export type EngineMode='alley'|'street'|'collector'|'avenue'|'boulevard'|'highway'|'ramp';
export type Road={id:string;path:Point2[];width:number;lanes:number;median?:number;turnSurface?:Rings;turnPolicy?:'fixed';speed:number;use:'residential'|'industrial'|'connector';section?:StreetSection;elevation?:[number,number][];mode?:RoadMode;engineMode?:EngineMode;cornerRadius?:number};
export const isCarRoad=(r:Pick<Road,'mode'>)=>!r.mode||r.mode==='car';
export const distance=(a:Point2,b:Point2)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export const pathLength=(p:Point2[])=>p.slice(1).reduce((s,b,i)=>s+distance(p[i],b),0);
/** Хадгалсан хуучин/эвдэрсэн мөрөөс NaN геометр, хязгааргүй давталт үүсгэхгүй. */
export function validRoads(input:unknown):Road[]{
 if(!Array.isArray(input))return[];
 const roads:Road[]=[],seen=new Set<string>();
 for(const value of input){
  if(!value||typeof value!=='object'||!Array.isArray(value.path)||value.path.some((p:unknown)=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))continue;
  const path=(value.path as Point2[]).filter((p,i,a)=>!i||distance(a[i-1],p)>.001);
  if(path.length<2||!Number.isFinite(value.width)||value.width<(value.mode&&value.mode!=='car'?1.2:value.engineMode==='ramp'?4:5)||!Number.isFinite(value.speed)||value.speed<=0)continue;
  const width=value.width,lanes=Math.max(1,Math.min(8,Math.trunc(value.lanes)||1)),median=Number.isFinite(value.median)?Math.max(0,Math.min(width-5,value.median)):0;
  const turnSurface=Array.isArray(value.turnSurface)&&value.turnSurface.every((r:unknown)=>Array.isArray(r)&&r.length>=4&&r.every((p:unknown)=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))?value.turnSurface as Rings:undefined;
  const mode:RoadMode|undefined=['pedestrian','bike','shared'].includes(value.mode)?value.mode:undefined;
  const engineMode:EngineMode|undefined=['alley','street','collector','avenue','boulevard','highway','ramp'].includes(value.engineMode)?value.engineMode:undefined;
  const cornerRadius=Number.isFinite(value.cornerRadius)&&value.cornerRadius>=0&&value.cornerRadius<=100?Number(value.cornerRadius):undefined;
  const turnPolicy=value.turnPolicy==='fixed'?'fixed' as const:undefined;
  const section=validSection(value.section);
  const elevation=Array.isArray(value.elevation)&&value.elevation.length>=2&&value.elevation.every((q:unknown)=>Array.isArray(q)&&q.length===2&&q.every(Number.isFinite)&&q[1]>=-30&&q[1]<=60)?(value.elevation as [number,number][]).map(q=>[q[0],q[1]] as [number,number]).sort((a,b)=>a[0]-b[0]):undefined;
  const a=JSON.stringify(path),b=JSON.stringify([...path].reverse()),key=[a<b?a:b,width,lanes,median,value.speed,value.use,JSON.stringify(turnSurface??[]),turnPolicy??'',section?JSON.stringify(section):'',elevation?JSON.stringify(elevation):'',mode??'',engineMode??'',cornerRadius??''].join('|');
  if(seen.has(key))continue;seen.add(key);
  roads.push({id:String(value.id??`road-${roads.length}`),path,width,lanes,median,turnSurface,speed:value.speed,use:['residential','industrial','connector'].includes(value.use)?value.use:'connector',...(turnPolicy?{turnPolicy}:{}),...(section?{section}:{}),...(elevation&&elevation.some(q=>Math.abs(q[1])>.01)?{elevation}:{}),...(mode?{mode}:{}),...(engineMode?{engineMode}:{}),...(cornerRadius!=null?{cornerRadius}:{})});
 }
 return roads;
}
export function samplePath(p:Point2[],s:number){
 for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i],l=distance(a,b);if(l<1e-8)continue;if(s<=l||i===p.length-1){const t=Math.max(0,Math.min(1,s/l));return{point:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t] as Point2,dir:[(b[0]-a[0])/l,(b[1]-a[1])/l] as Point2};}s-=l;}
 return{point:p[0]??[0,0] as Point2,dir:[1,0] as Point2};
}
export function offsetPath(path:Point2[],offset:number):Point2[]{
 return path.map((p,i)=>{const a=path[Math.max(0,i-1)],b=path[Math.min(path.length-1,i+1)],l1=distance(a,p),l2=distance(p,b),u=l1>0?[(p[0]-a[0])/l1,(p[1]-a[1])/l1]:[(b[0]-p[0])/l2,(b[1]-p[1])/l2],v=l2>0?[(b[0]-p[0])/l2,(b[1]-p[1])/l2]:u,n=[u[1]+v[1],-u[0]-v[0]],nl=Math.hypot(...n);if(nl<1e-6)return[p[0]+u[1]*offset,p[1]-u[0]*offset];const m=Math.min(1.6,1/Math.max(.2,(n[0]*u[1]-n[1]*u[0])/nl));return[p[0]+n[0]/nl*offset*m,p[1]+n[1]/nl*offset*m];});
}

/** Ул мөрийн эхний хэсэг замын эх чиглэлтэй ижил эсэх (огтлолын forward/reverse-ийг зөв талд оноох). */
export function alignedWith(road:Point2[],path:Point2[]){
 const a=path[0],b=path[1]??path[0];let best=Infinity,sign=1;
 for(let i=1;i<road.length;i++){const p=road[i-1],q=road[i],dx=q[0]-p[0],dy=q[1]-p[1],l2=dx*dx+dy*dy;if(!l2)continue;const m=[(a[0]+b[0])/2,(a[1]+b[1])/2],t=Math.max(0,Math.min(1,((m[0]-p[0])*dx+(m[1]-p[1])*dy)/l2)),d=Math.hypot(p[0]+dx*t-m[0],p[1]+dy*t-m[1]);if(d<best){best=d;sign=Math.sign(dx*(b[0]-a[0])+dy*(b[1]-a[1]))||1;}}
 return sign>0;
}

/** Станц s дээрх газраас дээших өндөр (elevation-ийн шугаман интерполяц). */
export function heightAt(road:Pick<Road,'elevation'>,s:number){const e=road.elevation;if(!e?.length)return 0;if(s<=e[0][0])return e[0][1];for(let i=1;i<e.length;i++)if(s<=e[i][0]){const [s0,h0]=e[i-1],[s1,h1]=e[i];return s1>s0?h0+(h1-h0)*(s-s0)/(s1-s0):h1;}return e.at(-1)![1];}
/** Цэгийн тэнхлэг дээрх станц (хамгийн ойр проекц). */
export function stationOf(path:Point2[],p:Point2){let best=Infinity,station=0,acc=0;for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy,l=Math.sqrt(l2);if(!l2)continue;const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2)),d=Math.hypot(a[0]+dx*t-p[0],a[1]+dy*t-p[1]);if(d<best){best=d;station=acc+t*l;}acc+=l;}return station;}
export const heightAtPoint=(road:Pick<Road,'elevation'|'path'>,p:Point2)=>road.elevation?.length?heightAt(road,stationOf(road.path,p)):0;
/** corridorGraph-ийн heightOf: аль нэг зам elevation-тэй бол л (бусад тохиолдолд хуучин топологи яг хэвээр). */
export const roadLevels=(roads:Road[])=>roads.some(r=>r.elevation?.length)?(i:number,p:Point2)=>heightAtPoint(roads[i],p):undefined;
