// Хотын бүх замын нэгдсэн дүрслэлийн тэнхлэг, уулзвар, асфальт. Хөдөлгөөний сүлжээ (roadTraffic)-г өөрчлөхгүй.
import {bufPath,unionAll,diff,inter,circle,orientedRect,type Rings,type XY} from './geom';
import {corridorGraph} from './sharedUtilityGraph';
import {samplePath,pathLength,validRoads,roadLevels,isCarRoad,type Road} from './roadGeometry';
import {sectionLayout} from './streetSection';

export type RoadContext={roads:Road[];surface:Rings;median:Rings;serviceOpenings:Rings;junctions:Rings;nodeJunctions:Map<number,Rings>;canonical:Road[];sources:Road[];graph:ReturnType<typeof corridorGraph>;owners:Road[];ends:{start:number;end:number}[]};
const cache=new WeakMap<Road[],RoadContext>();
/** Огтлол өөр бол тусдаа тэнхлэг; хуучин section-гүй замын түлхүүр хуучнаараа. */
export const roadStyle=(r:Road)=>[r.width,r.lanes,r.median??0,r.section?JSON.stringify(r.section):'',r.engineMode??'',r.cornerRadius??''].join('|');
const distance=(a:XY,b:XY)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const order=(a:XY,b:XY)=>a[0]-b[0]||a[1]-b[1];

/** Давхардсан хэсэг бүрт нэг хөндлөн огтлол; эх тэнхлэг, хөдөлгөөний сүлжээг өөрчлөхгүй. */
function displayAxes(roads:Road[]){
 const graph=corridorGraph(roads.map(r=>r.path),[],roadLevels(roads)),bins=new Map<string,{road:Road;a:XY;b:XY}[]>();
 for(const road of roads)for(let i=1;i<road.path.length;i++){
  const a=road.path[i-1],b=road.path[i],segment={road,a,b};
  for(let x=Math.floor(Math.min(a[0],b[0])/100);x<=Math.floor(Math.max(a[0],b[0])/100);x++)for(let y=Math.floor(Math.min(a[1],b[1])/100);y<=Math.floor(Math.max(a[1],b[1])/100);y++){const key=`${x},${y}`,list=bins.get(key)??[];list.push(segment);bins.set(key,list);}
 }
 const owners=graph.edges.map(e=>{
  const a=graph.nodes[e.a],b=graph.nodes[e.b],m:XY=[(a[0]+b[0])/2,(a[1]+b[1])/2];
  return(bins.get(`${Math.floor(m[0]/100)},${Math.floor(m[1]/100)}`)??[]).filter(s=>{const dx=s.b[0]-s.a[0],dy=s.b[1]-s.a[1],l2=dx*dx+dy*dy,t=((m[0]-s.a[0])*dx+(m[1]-s.a[1])*dy)/l2;return t>=-1e-6&&t<=1+1e-6&&Math.abs(dx*(m[1]-s.a[1])-dy*(m[0]-s.a[0]))/Math.sqrt(l2)<.002;}).sort((a,b)=>b.road.width-a.road.width)[0]?.road??roads[0];
 });
 const used=new Set<number>(),canonical:Road[]=[],sources:Road[]=[],ends:{start:number;end:number}[]=[],breakAt=(n:number)=>graph.adj[n].length!==2||roadStyle(owners[graph.adj[n][0]])!==roadStyle(owners[graph.adj[n][1]]);
 const trace=(start:number,first:number)=>{const path=[graph.nodes[start]];let n=start,ei=first;
  while(!used.has(ei)){used.add(ei);const e=graph.edges[ei];n=e.a===n?e.b:e.a;path.push(graph.nodes[n]);if(breakAt(n)||n===start)break;ei=graph.adj[n].find(i=>i!==ei)!;}
  let a=start,b=n;
  if(order(path[0],path.at(-1)!)>0){path.reverse();[a,b]=[b,a];}
  if(distance(path[0],path.at(-1)!)<.001){path.pop();let first=0;for(let i=1;i<path.length;i++)if(order(path[i],path[first])<0)first=i;const rotated=[...path.slice(first),...path.slice(0,first)];if(order(rotated[1],rotated.at(-1)!)>0)rotated.splice(1,rotated.length-1,...rotated.slice(1).reverse());path.splice(0,path.length,...rotated,rotated[0]);a=b=-1;}
  canonical.push({...owners[first],id:`paint-${canonical.length}`,path});sources.push(owners[first]);ends.push({start:a,end:b});
 };
 for(let n=0;n<graph.nodes.length;n++)if(breakAt(n))for(const ei of graph.adj[n])if(!used.has(ei))trace(n,ei);
 for(let ei=0;ei<graph.edges.length;ei++)if(!used.has(ei))trace(graph.edges[ei].a,ei);
 return{graph,owners,canonical,sources,ends};
}
export function slicePath(path:XY[],from:number,to:number){
 const out:XY[]=[samplePath(path,from).point];let length=0;
 for(let i=1;i<path.length;i++){length+=distance(path[i-1],path[i]);if(length>from&&length<to)out.push(path[i]);if(length>=to)break;}
 out.push(samplePath(path,to).point);return out;
}
/** Уулзварын өөрийн өргөн, өнцөгт таарсан зураасгүй талбай. Хотын хамгийн өргөн замаар бүх уулзварыг огтлохгүй.
 * Зангилаа бүрийн үр дүнг салааны геометрээр кэшлэнэ: засварт зөвхөн өөрчлөгдсөн уулзварыг дахин тооцно. */
const nodeAreaCache=new Map<string,Rings>();
function junctionAreas(axes:ReturnType<typeof displayAxes>){
 const {graph,owners}=axes,byNode=new Map<number,Rings>();
 for(let n=0;n<graph.nodes.length;n++){
  const edges=graph.adj[n];if(edges.length<3)continue;
  const half=Math.max(...edges.map(e=>owners[e].width/2)),reach=half*10+20;
  const armPaths=edges.map(first=>{let node=n,ei=first,length=0;const path=[graph.nodes[n]];
   while(length<reach){const edge=graph.edges[ei],next=edge.a===node?edge.b:edge.a;length+=edge.length;path.push(graph.nodes[next]);if(graph.adj[next].length!==2||next===n)break;node=next;ei=graph.adj[next].find(e=>e!==ei)!;}
   return{path:slicePath(path,0,Math.min(length,reach)),w:owners[first].width/2+.6};});
  const key=JSON.stringify(armPaths.map(a=>[a.w,a.path.map(q=>[Math.round(q[0]*100),Math.round(q[1]*100)])]));
  let area=nodeAreaCache.get(key);
  if(!area){const areas:Rings[]=[[circle(graph.nodes[n],Math.max(5,half+1),32)]],arms=armPaths.map(a=>bufPath([a.path],a.w));
   for(let a=0;a<arms.length;a++)for(let b=a+1;b<arms.length;b++){const overlap=inter(arms[a],arms[b]);if(overlap.length)areas.push(overlap);}
   area=unionAll(areas);if(nodeAreaCache.size>4000)nodeAreaCache.clear();nodeAreaCache.set(key,area);}
  byNode.set(n,area);
 }
 return byNode;
}
/** Хүнд нэгтгэл (бүх хотын асфальт, голын зурвас, уулзвар) — хэрэгтэй үед л (lazy, enumerable биш: worker-ээс илгээхгүй). */
/** Хучилт доторх өргөгдсөн зурвас (голын болон туслах замын тусгаарлах зурвас). Тэгш хэмтэй огтлолд |x|-ээр (канон тэнхлэг эргэсэн байж болно). */
function raisedStrips(r:Road):Rings{
 if(!r.section)return(r.median??0)>0?bufPath([r.path],r.median!/2):[];
 const slots=sectionLayout(r.section).slots.filter(s=>s.carriageway&&s.raised);if(!slots.length)return[];
 const out:Rings[]=[];
 for(const s of slots){const a=Math.abs(s.x0),b=Math.abs(s.x1);
  if(s.x0<0&&s.x1>0){out.push(bufPath([r.path],Math.max(a,b)));continue;}
  // Тэгш хэмгүй (зөвхөн нэг талд) зурвасыг алгасна — streetModel өөрөө зурна.
  if(!slots.some(o=>o!==s&&Math.abs(Math.abs(o.x0)-b)<.05&&Math.abs(Math.abs(o.x1)-a)<.05))continue;
  if(s.x1<=0)out.push(diff(bufPath([r.path],Math.max(a,b)),bufPath([r.path],Math.min(a,b))));
 }
 return unionAll(out);
}
/** A service carriageway must join the same-side main lanes at its true end.
 * Open only the off-centre separator, never the central median or outer paths.
 * Junctions already remove these strips through their shared junction polygon. */
function serviceEndOpenings(axes:ReturnType<typeof displayAxes>):Rings{
 const openings:Rings[]=[];
 axes.canonical.forEach((r,i)=>{
  if(r.use!=='residential'||r.section?.source!=='urban-plan')return;
  const layout=sectionLayout(r.section),separators=layout.slots.filter(s=>s.carriageway&&s.raised&&s.lane.kind==='vegetation'&&s.x0*s.x1>0);
  if(!separators.length)return;
  const len=pathLength(r.path),length=Math.min(6,len/3);if(length<3)return;
  for(const end of [false,true]){
   const node=end?axes.ends[i].end:axes.ends[i].start;
   if(node<0||axes.graph.adj[node].length!==1)continue;
   const inset=Math.min(5,len/4),q=samplePath(r.path,end?len-inset:inset),right:XY=[q.dir[1],-q.dir[0]];
   for(const s of separators){
    const c:XY=[q.point[0]+right[0]*s.center,q.point[1]+right[1]*s.center];
    openings.push([orientedRect(c,q.dir,length,s.lane.width+.4)]);
   }
  }
 });
 return unionAll(openings);
}
function lazy<T extends object,K extends string,V>(obj:T,key:K,make:()=>V):T&Record<K,V>{let value:V|undefined;Object.defineProperty(obj,key,{get:()=>value??=make(),enumerable:false,configurable:true});return obj as T&Record<K,V>;}
export function roadContext(input:Road[]):RoadContext{
 const old=cache.get(input);if(old)return old;
 // Авто бус зам (явган/дугуй) нь уулзвар, хучилт, тэмдэглэгээний сүлжээнд орохгүй (streetModel тусад нь гарцтай зурна).
 const roads=validRoads(input).filter(isCarRoad);
 if(!roads.length){const empty={roads,surface:[],median:[],serviceOpenings:[],junctions:[],nodeJunctions:new Map<number,Rings>(),canonical:[],sources:[],graph:corridorGraph([]),owners:[],ends:[]};cache.set(input,empty);return empty;}
 const axes=displayAxes(roads),nodeJunctions=junctionAreas(axes);
 const base={roads,nodeJunctions,canonical:axes.canonical,sources:axes.sources,graph:axes.graph,owners:axes.owners,ends:axes.ends};
 const withS=lazy(base,'serviceOpenings',()=>serviceEndOpenings(axes));
 const withJ=lazy(withS,'junctions',()=>unionAll([...nodeJunctions.values()]));
 const withM=lazy(withJ,'median',()=>diff(diff(unionAll(axes.canonical.map(raisedStrips)),withJ.junctions),withJ.serviceOpenings));
 const result=lazy(withM,'surface',()=>diff(unionAll(roads.flatMap(r=>[bufPath([r.path],r.width/2),r.turnSurface??[]])),withM.median)) as RoadContext;
 cache.set(input,result);return result;
}
