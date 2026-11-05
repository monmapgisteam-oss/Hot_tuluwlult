/** Метрийн коридорын топологи. Давхардсан физик сегментийг нэг удаа тоолно. */
export type Point2=[number,number];
export type CorridorGraph={nodes:Point2[];edges:{a:number;b:number;length:number}[];adj:number[][]};
const distance=(a:Point2,b:Point2)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const cross=(a:Point2,b:Point2)=>a[0]*b[1]-a[1]*b[0];
const sub=(a:Point2,b:Point2):Point2=>[a[0]-b[0],a[1]-b[1]];
const key=(p:Point2)=>`${Math.round(p[0]*1000)},${Math.round(p[1]*1000)}`;
/** Өөр түвшний (гүүр / доогуур гарц) огтлолцол: өндрийн зөрүү энэнээс их бол уулзвар үүсгэхгүй, м. */
export const LEVEL_GAP=2.5;
/** heightOf (сонголттой): зам pi-ийн цэг p дээрх газраас дээших өндөр (Road.elevation). Өгвөл өөр түвшний огтлолцол ба давхцсан оройд зангилаа үүсэхгүй. */
export function corridorGraph(paths:Point2[][],anchors:Point2[]=[],heightOf?:(path:number,p:Point2)=>number):CorridorGraph{
 const segments=paths.flatMap((path,pi)=>path.slice(1).map((b,i)=>({a:path[i],b,cuts:[0,1],pi}))).filter(s=>distance(s.a,s.b)>0.001);
 const level=(s:{pi:number;a:Point2;b:Point2},t:number)=>heightOf?heightOf(s.pi,[s.a[0]+(s.b[0]-s.a[0])*t,s.a[1]+(s.b[1]-s.a[1])*t]):0;
 const sameLevel=(s:{pi:number;a:Point2;b:Point2},u:number,t:{pi:number;a:Point2;b:Point2},w:number)=>!heightOf||Math.abs(level(s,u)-level(t,w))<=LEVEL_GAP;
 const parameter=(p:Point2,a:Point2,b:Point2)=>{const r=sub(b,a),q=sub(p,a);return(q[0]*r[0]+q[1]*r[1])/(r[0]**2+r[1]**2);};
 const cut=(s:typeof segments[number],p:Point2)=>{const t=parameter(p,s.a,s.b);if(t>=-1e-8&&t<=1+1e-8&&Math.abs(cross(sub(s.b,s.a),sub(p,s.a)))/distance(s.a,s.b)<0.001)s.cuts.push(Math.max(0,Math.min(1,t)));};
 const bins=new Map<string,number[]>(),seen=new Set<string>();
 segments.forEach((s,i)=>{for(let x=Math.floor(Math.min(s.a[0],s.b[0])/100);x<=Math.floor(Math.max(s.a[0],s.b[0])/100);x++)for(let y=Math.floor(Math.min(s.a[1],s.b[1])/100);y<=Math.floor(Math.max(s.a[1],s.b[1])/100);y++){const k=`${x},${y}`,ids=bins.get(k)??[];ids.push(i);bins.set(k,ids);}});
 for(const ids of bins.values())for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
  const a=ids[i],b=ids[j],pair=`${Math.min(a,b)}:${Math.max(a,b)}`;if(seen.has(pair))continue;seen.add(pair);
  const s=segments[a],t=segments[b],r=sub(s.b,s.a),v=sub(t.b,t.a),q=sub(t.a,s.a),den=cross(r,v);
  if(Math.abs(den)<=1e-9*Math.hypot(...r)*Math.hypot(...v)){if(sameLevel(s,.5,t,.5)){cut(s,t.a);cut(s,t.b);cut(t,s.a);cut(t,s.b);}continue;}
  const u=cross(q,v)/den,w=cross(q,r)/den;if(u>=-1e-8&&u<=1+1e-8&&w>=-1e-8&&w<=1+1e-8&&sameLevel(s,Math.max(0,Math.min(1,u)),t,Math.max(0,Math.min(1,w)))){s.cuts.push(Math.max(0,Math.min(1,u)));t.cuts.push(Math.max(0,Math.min(1,w)));}
 }
 for(const p of anchors)for(const i of bins.get(`${Math.floor(p[0]/100)},${Math.floor(p[1]/100)}`)??[])cut(segments[i],p);
 const nodes:Point2[]=[],edges:CorridorGraph['edges']=[],index=new Map<string,number>(),levels=new Map<string,{h:number;i:number}[]>(),edgeKeys=new Set<string>();
 // Түвшинтэй үед ижил координат ч өөр өндөрт бол тусдаа зангилаа (гүүрийн доор дайрах зам).
 const node=(p:Point2,h=0)=>{const k=key(p);if(!heightOf){let i=index.get(k);if(i==null){i=nodes.length;nodes.push(p);index.set(k,i);}return i;}
  const list=levels.get(k)??[];const hit=list.find(c=>Math.abs(c.h-h)<=LEVEL_GAP);if(hit)return hit.i;const i=nodes.length;nodes.push(p);list.push({h,i});levels.set(k,list);if(!index.has(k))index.set(k,i);return i;};
 for(const s of segments){const ts=[...new Set(s.cuts)].sort((a,b)=>a-b);for(let i=1;i<ts.length;i++){
  const at=(t:number):Point2=>[s.a[0]+(s.b[0]-s.a[0])*t,s.a[1]+(s.b[1]-s.a[1])*t],a=node(at(ts[i-1]),level(s,ts[i-1])),b=node(at(ts[i]),level(s,ts[i]));if(a===b)continue;
  const k=`${Math.min(a,b)}:${Math.max(a,b)}`;if(edgeKeys.has(k))continue;edgeKeys.add(k);edges.push({a,b,length:distance(nodes[a],nodes[b])});
 }}
 const adj=nodes.map(()=>[] as number[]);edges.forEach((e,i)=>{adj[e.a].push(i);adj[e.b].push(i);});return{nodes,edges,adj};
}
export type Terminal={id:string;point:Point2;load:number};
export type Source={id:string;point:Point2;capacity?:number};
class Queue{
 items:{node:number;cost:number}[]=[];
 push(node:number,cost:number){const a=this.items;a.push({node,cost});for(let i=a.length-1;i>0;){const p=(i-1)>>1;if(a[p].cost<=a[i].cost)break;[a[p],a[i]]=[a[i],a[p]];i=p;}}
 pop(){const a=this.items,first=a[0],last=a.pop()!;if(a.length){a[0]=last;for(let i=0;;){let m=i;const l=2*i+1,r=l+1;if(l<a.length&&a[l].cost<a[m].cost)m=l;if(r<a.length&&a[r].cost<a[m].cost)m=r;if(m===i)break;[a[i],a[m]]=[a[m],a[i]];i=m;}}return first;}
}
export function sharedUtilityTree(graph:CorridorGraph,terminals:Terminal[],sources:Source[],edgeCost?:(edge:CorridorGraph['edges'][number],from:number,to:number)=>number){
 if(terminals.some(t=>!Number.isFinite(t.load)||t.load<0)||sources.some(s=>s.capacity!=null&&(!Number.isFinite(s.capacity)||s.capacity<0)))throw new Error('Сүлжээний ачаалал, эх үүсвэрийн чадлыг шалгана уу.');
 const {nodes,edges,adj}=graph,index=new Map(nodes.map((p,i)=>[key(p),i])),cost=new Float64Array(nodes.length).fill(Infinity),parent=new Int32Array(nodes.length).fill(-1),owner=new Int32Array(nodes.length).fill(-1),queue=new Queue();
 sources.forEach((s,i)=>{const n=index.get(key(s.point));if(n!=null&&cost[n]>0){cost[n]=0;owner[n]=i;queue.push(n,0);}});
 while(queue.items.length){const {node:n,cost:c}=queue.pop();if(c!==cost[n])continue;for(const ei of adj[n]){const e=edges[ei],v=e.a===n?e.b:e.a,weight=edgeCost?edgeCost(e,n,v):e.length;if(!Number.isFinite(weight)||weight<0)continue;const newCost=c+weight;if(newCost<cost[v]){cost[v]=newCost;parent[v]=ei;owner[v]=owner[n];queue.push(v,newCost);}}}
 const load=new Float64Array(nodes.length),served:string[][]=nodes.map(()=>[]),unresolved:{id:string;load:number}[]=[],sourceLoads=new Float64Array(sources.length);
 for(const t of terminals){if(t.load===0)continue;const n=index.get(key(t.point));if(n==null||owner[n]<0){unresolved.push({id:t.id,load:t.load});continue;}load[n]+=t.load;served[n].push(t.id);sourceLoads[owner[n]]+=t.load;}
 const order=nodes.map((_,i)=>i).filter(i=>Number.isFinite(cost[i])).sort((a,b)=>cost[b]-cost[a]);
 const lines:{a:number;b:number;path:Point2[];length:number;load:number;source:string;terminals:string[]}[]=[];
 for(const n of order){const ei=parent[n];if(ei<0||load[n]<=0)continue;const e=edges[ei],p=e.a===n?e.b:e.a;lines.push({a:n,b:p,path:[nodes[n],nodes[p]],length:e.length,load:load[n],source:sources[owner[n]].id,terminals:[...served[n]]});load[p]+=load[n];served[p].push(...served[n]);}
 return{lines,unresolved,sources:sources.map((s,i)=>({...s,load:sourceLoads[i],status:s.capacity==null?'unknown':sourceLoads[i]>s.capacity?'overloaded':'within-input'})),lengthM:lines.reduce((n,l)=>n+l.length,0),servedLoad:sourceLoads.reduce((n,v)=>n+v,0)};
}
