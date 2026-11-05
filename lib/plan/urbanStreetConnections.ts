import {corridorGraph,type CorridorGraph} from './sharedUtilityGraph';
import {area,bufPath,diff,dist,inter,nearest,unionAll,type Rings,type XY} from './geom';
import type {Dem} from './dem';
import {terrainSegmentMaxGrade} from './terrainRoute';
import type {Street,StreetCls} from './layout';
import {planningElevation,planningRoutingCost,type PlanningSuitability} from './planningSuitability';

export type UrbanStreetOptions={suitability?:PlanningSuitability;maxGrade?:Partial<Record<StreetCls,number>>};
/** Нөөц зурвасын бүх өргөн, нарийн вектор хориг, ангиллын налууг хамтад нь шалгана. */
export function urbanStreetAllowed(street:Street,boundary:Rings,dem:Dem|null,options:UrbanStreetOptions={}){
 if(street.path.length<2)return false;
 const surface=bufPath([street.path],street.w/2),context=options.suitability;
 if(area(diff(surface,boundary))>.01)return false;
 if(context?.restrictions.some(r=>(!r.profiles||r.profiles.includes('road'))&&area(inter(surface,r.rings))>.01))return false;
 for(let i=1;i<street.path.length;i++){
  const a=street.path[i-1],b=street.path[i],length=dist(a,b);if(length<.0001)continue;
  if(dem&&terrainSegmentMaxGrade(dem,a,b)>(options.maxGrade?.[street.cls]??8)+.00001)return false;
  const count=Math.max(1,Math.ceil(length/Math.min((dem?.cell??50)/2,25)));
  for(let k=0;k<=count;k++){
   const p:XY=[a[0]+(b[0]-a[0])*k/count,a[1]+(b[1]-a[1])*k/count];
   if(dem&&planningElevation(dem,...p)==null||context&&!Number.isFinite(planningRoutingCost(context,p,'road')))return false;
  }
 }
 return true;
}

export function streetComponents(g:Pick<CorridorGraph,'nodes'|'edges'|'adj'>){
 const component=new Int32Array(g.nodes.length).fill(-1);let count=0;
 for(let i=0;i<g.nodes.length;i++){if(component[i]>=0)continue;const pending=[i];component[i]=count;while(pending.length){const n=pending.pop()!;for(const ei of g.adj[n]){const e=g.edges[ei],v=e.a===n?e.b:e.a;if(component[v]<0){component[v]=count;pending.push(v);}}}count++;}
 return{component,count};
}

/** Блок хуваалтын замын төгсгөлийг бодит геометрээр залгана.
 * Зөвхөн өмнө нь нөөцөлсөн замын зурвас дотор богино холбоос нэмнэ:
 * барилгын газрыг дайрах, холын тусдаа хороололд зохиомол зам үүсгэхгүй. */
export function connectUrbanStreets(input:Street[],boundary:Rings,dem:Dem|null,localWidth:number,options:UrbanStreetOptions={}){
 const streets=options.suitability||options.maxGrade?input.filter(s=>urbanStreetAllowed(s,boundary,dem,options)):[...input],internal=()=>streets.filter(s=>!s.ext),corridor=unionAll(internal().map(s=>bufPath([s.path],s.w/2+.05)));
 const half=localWidth/2,maxGap=Math.max(localWidth,...input.map(s=>s.w))+8;
 let nextId=Math.max(10000,...input.map(s=>s.id))+1;
 for(let round=0;round<input.length;round++){
  const graph=corridorGraph(internal().map(s=>s.path)),{component,count}=streetComponents(graph);if(count<=1)break;
  const candidates:{path:XY[];distance:number;a:number;b:number}[]=[];
  graph.nodes.forEach((point,i)=>{for(const edge of graph.edges){if(component[i]===component[edge.a])continue;
   // bbox-оор хурдан хасна — ихэнх ирмэг maxGap-аас хол
   const p=graph.nodes[edge.a],q=graph.nodes[edge.b];if(point[0]<Math.min(p[0],q[0])-maxGap||point[0]>Math.max(p[0],q[0])+maxGap||point[1]<Math.min(p[1],q[1])-maxGap||point[1]>Math.max(p[1],q[1])+maxGap)continue;
   const end=nearest([[p,q]],point,false),distance=dist(point,end);if(distance>.005&&distance<=maxGap)candidates.push({path:[point,end],distance,a:component[i],b:component[edge.a]});}});
  candidates.sort((a,b)=>a.distance-b.distance);
  // Нэг давталтад өөр өөр хэсгийг холбох бүх холбогчийг нэмнэ (union-find) — өмнө нь нэг холбогч тутамд граф,
  // бүх цэг × ирмэгийг дахин тооцдог байсан (Б01: ~14 сек)
  const parent=new Map<number,number>(),find=(c:number):number=>{let r=c;while(parent.has(r)&&parent.get(r)!==r)r=parent.get(r)!;return r;};
  let joined=0;
  for(const {path,a,b}of candidates){
   const ra=find(a),rb=find(b);if(ra===rb)continue;
   const surface=bufPath([path],half);if(area(diff(surface,boundary))>.01||area(diff(surface,corridor))>.1)continue;
   const connector:Street={id:nextId,cls:'local',path,w:localWidth};if(!urbanStreetAllowed(connector,boundary,dem,options))continue;
   streets.push(connector);nextId++;parent.set(ra,rb);joined++;
  }
  if(!joined)break;
 }
 snapDeadEnds(streets);
 return streets;
}

/** Мухар төгсгөл нөгөө замын улаан шугамын ирмэг дээр (тэнхлэгээс w/2) зогсдог байсан — тэнд явган зам, ногоон
 *  зурвас үлдэж уулзвар нийлдэггүй. Төгсгөлийг нөгөө замын тэнхлэг хүртэл (≤ w/2 + 1 м) сунгаж T уулзвар үүсгэнэ. */
export function snapDeadEnds(streets:Street[]){
 const segs:{s:Street;a:XY;b:XY}[]=[];
 for(const s of streets)for(let i=1;i<s.path.length;i++)segs.push({s,a:s.path[i-1],b:s.path[i]});
 const touches=(p:XY,self:Street)=>segs.some(q=>q.s!==self&&dist(nearest([[q.a,q.b]],p,false),p)<=.05);
 for(const s of streets){
  if(s.ext||s.path.length<2)continue;
  for(const end of [0,1] as const){
   const p=end?s.path[s.path.length-1]:s.path[0];
   if(touches(p,s))continue;
   let best:{q:XY;d:number}|null=null;
   for(const g of segs){
    if(g.s===s)continue;
    const q=nearest([[g.a,g.b]],p,false),d=dist(q,p);
    if(d>.05&&d<=g.s.w/2+1&&(!best||d<best.d))best={q,d};
   }
   if(!best)continue;
   if(end)s.path=[...s.path,best.q];else s.path=[best.q,...s.path];
  }
 }
 return streets;
}
