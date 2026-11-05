// Инженерийн хангамжийн эх үүсвэрийн хувилбар (ус, дулаан):
//  А — бүс бүр өөрийн ус, дулааны эх үүсвэртэй, халуун усаа дотроо бэлтгэнэ;
//  Б — нэгдсэн ус, дулааны эх үүсвэрээс бүсүүд хангагдана; техникийн нөхцөл батлагдаагүй.
// Сонгосон хувилбарт бохир бүс бүрийн өөрийн цэвэрлэх байгууламж руу тусдаа сүлжээгээр хүрнэ.
// Энэ модуль зөвхөн геометр (эх үүсвэр, гол шугамын мод, урт) тооцно; өртөг, алдагдлыг utilityCompare.ts тооцно.
import type {XY} from './geom';
import {corridorGraph} from './sharedUtilityGraph';
export const ENGINEERING_REVISION='zone-sewer-lifts-tray-fillets-2026-10-28';

export type ServiceKind='water'|'sewer'|'heat';
export type ServiceMode='zone'|'shared';
export const SERVICE_MODES:[ServiceMode,string][]=[['zone','А · Бүс бүр өөрийн эх үүсвэр'],['shared','Б · Нэгдсэн эх үүсвэр']];
export const SERVICE_LABEL:Record<ServiceKind,string>={water:'Хэрэглээний цэвэр ус',sewer:'Бохир ус',heat:'Дулаан'};

/** Нэг лотокт явах шугам. ШАЛГАХ: лотокийн хөндлөн огтлол, хоолой хоорондын зай — СНиП 2.04.07-86* (Дулааны сүлжээ). */
export type PipeCode='В1'|'Т1'|'Т2'|'Т3'|'Т4'|'К1';
export const PIPES:Record<PipeCode,{label:string;color:string;style:'solid'|'dash';sys:'water'|'heat'|'sewer'}>={
 'В1':{label:'Хэрэглээний цэвэр ус',color:'#1D6FE0',style:'solid',sys:'water'},
 'Т1':{label:'Дулаан өгөх',color:'#E0281F',style:'solid',sys:'heat'},
 'Т2':{label:'Дулаан буцах',color:'#E0281F',style:'dash',sys:'heat'},
 'Т3':{label:'Халуун ус өгөх',color:'#F08A00',style:'solid',sys:'heat'},
 'Т4':{label:'Халуун ус буцах',color:'#F08A00',style:'dash',sys:'heat'},
 'К1':{label:'Бохир ус',color:'#1E8A3A',style:'solid',sys:'sewer'},
};
/** Лотокийн доторх эрэмбэ — гудамжны тэнхлэгээс гадагш. */
export const CHANNEL_ORDER:PipeCode[]=['В1','Т1','Т2','Т3','Т4'];

export type ServiceSpec={
 /** Баталгаажсан байгаа эх үүсвэрийн бүс; зөвхөн өгөгдсөн үед ашиглана. */
 existing?:{id:number};
 /** Б хувилбарын нэгдсэн эх үүсвэрийн бүс. */
 central:number;
};
export type ServiceHub={source:number;members:number[];load:number;edges:[XY,XY][];km:number;existing:boolean};
export type ServicePlan={kind:ServiceKind;mode:ServiceMode;hubs:ServiceHub[];km:number};

/** Prim MST эх үүсвэрээс: [эцэг, хүү] ирмэг. */
function tree(points:XY[]):[XY,XY][]{
 if(points.length<2)return[];
 const n=points.length,inT=new Array(n).fill(false),best=new Array(n).fill(Infinity),par=new Array(n).fill(-1),out:[XY,XY][]=[];
 best[0]=0;
 for(let k=0;k<n;k++){
  let u=-1;for(let i=0;i<n;i++)if(!inT[i]&&(u<0||best[i]<best[u]))u=i;
  inT[u]=true;if(par[u]>=0)out.push([points[par[u]],points[u]]);
  for(let v=0;v<n;v++)if(!inT[v]){const d=Math.hypot(points[u][0]-points[v][0],points[u][1]-points[v][1]);if(d<best[v]){best[v]=d;par[v]=u;}}
 }
 return out;
}

function hub(members:number[],load:Record<number,number>,at:Record<number,XY>,s:ServiceSpec,detour:number,source:number):ServiceHub{
 const ids=[source,...members.filter(id=>id!==source)],edges=tree(ids.map(id=>at[id]));
 const km=edges.reduce((n,[a,b])=>n+Math.hypot(a[0]-b[0],a[1]-b[1]),0)/1000*detour;
 return{source,members:members.filter(id=>id!==source||(load[id]??0)>0),load:members.reduce((n,id)=>n+(load[id]??0),0),edges,km,existing:!!s.existing&&source===s.existing.id};
}

/** Ус/дулаан А: бүсийн эх үүсвэр, Б: нэгдсэн эх үүсвэр. Бохир А/Б-д ижил бүсийн ЦБ.
 * Бохирын бодит хүлээн авах цэг, трассыг бүс тус бүрийн DEM тооцоо сонгоно. */
export function planService(kind:ServiceKind,mode:ServiceMode,load:Record<number,number>,at:Record<number,XY>,s:ServiceSpec,detour:number):ServicePlan{
 const users=Object.keys(load).map(Number).filter(id=>load[id]>0&&at[id]).sort((a,b)=>a-b);
 const effectiveMode=kind==='sewer'?'zone':mode;
 const hubs=!users.length?[]:effectiveMode==='zone'?users.map(id=>hub([id],load,at,s,detour,id)):[hub(users,load,at,s,detour,s.existing?.id??s.central)];
 return{kind,mode:effectiveMode,hubs,km:hubs.reduce((n,h)=>n+h.km,0)};
}

// ---------- Гудамжны огтлол дахь байрлал ----------
// ТААМАГЛАЛ: лоток гудамжны нэг талд (улаан шугамаас 4 м дотогш), бохир ба кабель нөгөө талд, борооны ус тэнхлэгт.
// Хоолой хоорондын 0.8 м нь бүдүүвч; ШАЛГАХ: инженерийн шугам хоорондын хэвтээ зай — БНбД 30-01-04 / СНиП 2.07.01-89 хавсралт.
export const PIPE_GAP=0.8;
const EDGE_IN=4;
/** СНиП 2.04.03-85 п.4.14 жишиг: худгийн хоорондын хамгийн их зай DN-ээр. ШАЛГАХ: Монгол БНбД-ийн заалт. */
export function manholeSpacing(dn:number|null){
 const d=dn??200;return d<=150?35:d<=450?50:d<=600?75:d<=900?100:d<=1400?150:200;
}
type Topo={fromNode?:number;toNode?:number;sourceId?:string;invertFrom?:number|null;invertTo?:number|null};
type AxisLine=Topo&{sys:string;path:XY[];dn:number|null;dnHot?:number|null;dnCirc?:number|null;streetW?:number;flow:number;flowKnown?:boolean;flowHot?:number|null;flowCirc?:number|null;slope:number|null;depth:number|null};
export type PipeRow=Topo&{pipe:PipeCode|'Э'|'К2';sys:string;path:XY[];dn:number|null;flow:number|null;slope:number|null;depth:number|null;reserved?:boolean};
/**
 * Тэнхлэгээс зэрэгцээ шугам. Хэрчим бүрийн нормаль тогтмол чиглэлтэй (зүүн→баруун, эсвэл доороос дээш),
 * тиймээс модны ямар ч мөчир, ямар ч чиглэлд зурсан ч хоолой гудамжны нэг талдаа үлдэнэ. Булан нь mitre;
 * тал солигдох (босоо чиглэлийг давах) газарт шугам гудамжийг хөндлөн гатална.
 */
export function sideOffset(path:XY[],d:number):XY[]{
 const pts=path.filter((p,i)=>!i||Math.hypot(p[0]-path[i-1][0],p[1]-path[i-1][1])>1e-6);
 if(pts.length<2||!d)return pts.map(p=>[p[0],p[1]] as XY);
 // flip — тогтмол нормаль явах чиглэлийн баруун тал руу эргэсэн эсэх; хоёр хэрчимд ялгаатай бол тал солигдоно.
 const seg=pts.slice(1).map((b,i)=>{const a=pts[i];let dx=b[0]-a[0],dy=b[1]-a[1];const flip=dx<0||(dx===0&&dy<0);if(flip){dx=-dx;dy=-dy;}const L=Math.hypot(dx,dy);return{n:[-dy/L,dx/L] as XY,flip};});
 const n=seg.map(s=>s.n),at=(p:XY,v:XY,k=d):XY=>[p[0]+v[0]*k,p[1]+v[1]*k],out:XY[]=[at(pts[0],n[0])];
 for(let i=1;i<pts.length-1;i++){
  const a=n[i-1],b=n[i],dot=a[0]*b[0]+a[1]*b[1];
  if(seg[i-1].flip===seg[i].flip&&dot>-0.9)out.push(at(pts[i],[a[0]+b[0],a[1]+b[1]],d/(1+dot)));
  else out.push(at(pts[i],a),at(pts[i],b));
 }
 out.push(at(pts[pts.length-1],n[n.length-1]));
 return out;
}
/** edge — лотокийн эхний хоолой (В1) хүртэлх зай; өгөөгүй бол гудамжны улаан шугамаас EDGE_IN дотогш. */
export function channelPipes(lines:AxisLine[],o:{edge?:number}={}):PipeRow[]{
 const out:PipeRow[]=[],channel=lines.filter(l=>l.sys==='water'||l.sys==='heat'),trayMeta:{row:PipeRow;a:number;b:number;i:number;forward:boolean}[]=[];
 // Ус/дулааны мод ялгаатай байсан ч лотокийн физик сегмент бүрт таван хоолой байна.
 // Давхардсан, эсрэг чиглэлтэй ба хэсэгчлэн давхардсан сегментийг топологиор нэгтгэнэ.
 const graph=corridorGraph(channel.map(l=>l.path)),near=(p:XY,a:XY,b:XY)=>{
  const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy,t=l2?((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2:-1;
  return t>=-1e-8&&t<=1+1e-8&&Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)<.001;
 };
 const edgeLines=graph.edges.map(e=>{const a=graph.nodes[e.a],b=graph.nodes[e.b],mid:XY=[(a[0]+b[0])/2,(a[1]+b[1])/2];return channel.filter(l=>l.path.some((p,i)=>i>0&&near(mid,l.path[i-1],p)));});
 const nodeBase=graph.nodes.map((_,id)=>o.edge??Math.max(1.5,...graph.adj[id].flatMap(e=>edgeLines[e].map(l=>(l.streetW??18)/2-EDGE_IN))));
 const edgeFlow=(e:{a:number;b:number},line:AxisLine)=>{const a=graph.nodes[e.a],b=graph.nodes[e.b];return near(a,line.path[0],line.path.at(-1)!)&&Math.hypot(a[0]-line.path[0][0],a[1]-line.path[0][1])<=Math.hypot(b[0]-line.path[0][0],b[1]-line.path[0][1]);};
 // Хоолой тэнхлэгийн зүүн талд явна. Нэг гинжийн хэрчмүүдийг урсгалын чиглэлээр нэг мөр чиглүүлнэ:
 // булан бүрт тал солигдож хоолой тэнхлэгээ огтолж байсан алдааг арилгана.
 const orient:boolean[]=graph.edges.map((e,i)=>{const m=edgeLines[i],ref=m.find(l=>l.sys==='water')??m[0];return ref?edgeFlow(e,ref):true;});
 const nodeDir=(ei:number,node:number):XY=>{const e=graph.edges[ei],other=graph.nodes[e.a===node?e.b:e.a],p=graph.nodes[node],L=Math.hypot(other[0]-p[0],other[1]-p[1])||1;return[(other[0]-p[0])/L,(other[1]-p[1])/L];};
 // Хоолойн хөвч: хоёр зангилаа дээрх offset (гудамжны өргөнөөр ялгаатай байж болно) дундуур татсан шулуун.
 const lineAt=(ei:number,node:number,d:number)=>{const e=graph.edges[ei],a=graph.nodes[orient[ei]?e.a:e.b],b=graph.nodes[orient[ei]?e.b:e.a],L=Math.hypot(b[0]-a[0],b[1]-a[1])||1,n:XY=[-(b[1]-a[1])/L,(b[0]-a[0])/L],other=e.a===node?e.b:e.a,p=graph.nodes[node],q=graph.nodes[other],dq=d-nodeBase[node]+nodeBase[other];
  const o:XY=[p[0]+n[0]*d,p[1]+n[1]*d],far:XY=[q[0]+n[0]*dq,q[1]+n[1]*dq],len=Math.hypot(far[0]-o[0],far[1]-o[1])||1;return{o,u:[(far[0]-o[0])/len,(far[1]-o[1])/len] as XY};};
 const meet=(A:{o:XY;u:XY},B:{o:XY;u:XY}):XY|null=>{const cross=A.u[0]*B.u[1]-A.u[1]*B.u[0];if(Math.abs(cross)<1e-6)return null;const t=((B.o[0]-A.o[0])*B.u[1]-(B.o[1]-A.o[1])*B.u[0])/cross;return[A.o[0]+A.u[0]*t,A.o[1]+A.u[1]*t];};
 const maxOffset=(id:number)=>nodeBase[id]+(CHANNEL_ORDER.length-1)*PIPE_GAP;
 // Уулзварын хэрчмүүдийг хамгийн эсрэг чиглэлтэй (>~107°) хосоор нь «үргэлжлэл» болгон хослуулна; үлдсэн нь салаа.
 const pairingCache=new Map<number,{pairs:[number,number][];pairOf:Map<number,number>}>();
 const pairingAt=(id:number)=>{let c=pairingCache.get(id);if(c)return c;const rest=[...graph.adj[id]],pairs:[number,number][]=[],pairOf=new Map<number,number>();
  for(;;){let best:[number,number]|null=null,bestDot=-.3;for(let x=0;x<rest.length;x++)for(let y=x+1;y<rest.length;y++){const a=nodeDir(rest[x],id),b=nodeDir(rest[y],id),dot=a[0]*b[0]+a[1]*b[1];if(dot<bestDot){bestDot=dot;best=[rest[x],rest[y]];}}
   if(!best)break;pairs.push(best);pairOf.set(best[0],best[1]);pairOf.set(best[1],best[0]);rest.splice(rest.indexOf(best[0]),1);rest.splice(rest.indexOf(best[1]),1);}
  c={pairs,pairOf};pairingCache.set(id,c);return c;};
 // Чиглэлийг гинжээр (2 хэрчимтэй зангилаа) болон уулзварын үргэлжлэх хосоор дамжуулна: нэг гинж/үргэлжлэлийн хоолой нэг талд байна.
 const visited=new Uint8Array(graph.edges.length);
 for(let seed=0;seed<graph.edges.length;seed++){if(visited[seed])continue;const stack=[seed];visited[seed]=1;
  while(stack.length){const ei=stack.pop()!,e=graph.edges[ei];
   for(const node of [e.a,e.b]){const fi=graph.adj[node].length===2?graph.adj[node].find(i=>i!==ei):pairingAt(node).pairOf.get(ei);if(fi==null||visited[fi])continue;const f=graph.edges[fi],entersHere=(orient[ei]?e.b:e.a)===node;orient[fi]=entersHere?f.a===node:f.b===node;visited[fi]=1;stack.push(fi);}
  }}
 /** Зангилаанаас хэрчим рүү чиглэсэн цэгүүд: offset шугамуудын нийлүүлэг, хоёр хэрчмийн буланд концентрик нумын хагас. */
 const nodeEnd=(id:number,pipeIndex:number,ei:number):XY[]=>{
  const d=nodeBase[id]+pipeIndex*PIPE_GAP,p=graph.nodes[id],mine=lineAt(ei,id,d),others=graph.adj[id].filter(i=>i!==ei);
  if(!others.length)return[mine.o];
  const junction=(A:{o:XY;u:XY},B:{o:XY;u:XY}):XY=>{const x=meet(A,B);if(!x)return A.o;return Math.hypot(x[0]-p[0],x[1]-p[1])>6*Math.max(d,1)?[(A.o[0]+B.o[0])/2,(A.o[1]+B.o[1])/2]:x;};
  if(others.length>1){
   // Уулзвар: хамгийн шулуун үргэлжлэх хос хэрчим нийлүүлгээр нийлнэ; салаа нь тэр хосын хоолойн хэрчим дээр (тээ) төгсөнө.
   const {pairs,pairOf}=pairingAt(id),mate=pairOf.get(ei);
   if(mate!=null)return[junction(mine,lineAt(mate,id,d))];
   for(const pair of pairs)for(const f of pair){const L=lineAt(f,id,d),x=meet(mine,L);if(!x)continue;const mf=junction(L,lineAt(pair[0]===f?pair[1]:pair[0],id,d)),t=(x[0]-mf[0])*L.u[0]+(x[1]-mf[1])*L.u[1];if(t>=-1e-6&&t<=graph.edges[f].length+1e-6)return[x];}
   if(pairs.length)return[junction(lineAt(pairs[0][0],id,d),lineAt(pairs[0][1],id,d))];
   const partner=others.map(i=>({i,dot:mine.u[0]*nodeDir(i,id)[0]+mine.u[1]*nodeDir(i,id)[1]})).sort((x,y)=>x.dot-y.dot||x.i-y.i)[0].i;return[junction(mine,lineAt(partner,id,d))];
  }
  const partner=others[0],theirs=lineAt(partner,id,d),m=meet(mine,theirs);
  if(!m)return[mine.o];
  if(Math.hypot(m[0]-p[0],m[1]-p[1])>6*Math.max(d,1))return[[(mine.o[0]+theirs.o[0])/2,(mine.o[1]+theirs.o[1])/2]];
  // ТААМАГЛАЛ: тэнхлэгийн дугуйруулах радиус = гадна хоолойн offset + 3 м; богино хэрчимд багтахгүй бол нийлүүлэг хэвээр.
  const v1=mine.u,v2=theirs.u,phi=Math.acos(Math.max(-1,Math.min(1,v1[0]*v2[0]+v1[1]*v2[1])));
  if(phi>Math.PI-.17||phi<.35)return[m];
  const len=Math.min(graph.edges[ei].length,graph.edges[partner].length),r0=Math.min(maxOffset(id)+3,.45*len*Math.tan(phi/2));
  if(r0<=maxOffset(id)+.5)return[m];
  const bis=[v1[0]+v2[0],v1[1]+v2[1]],bl=Math.hypot(bis[0],bis[1])||1,c:XY=[p[0]+bis[0]/bl*r0/Math.sin(phi/2),p[1]+bis[1]/bl*r0/Math.sin(phi/2)];
  const tangent=(L:{o:XY;u:XY}):XY=>{const t=(c[0]-L.o[0])*L.u[0]+(c[1]-L.o[1])*L.u[1];return[L.o[0]+L.u[0]*t,L.o[1]+L.u[1]*t];};
  const t1=tangent(mine),t2=tangent(theirs),r=Math.hypot(t1[0]-c[0],t1[1]-c[1]);
  if(r<.5||Math.abs(r-Math.hypot(t2[0]-c[0],t2[1]-c[1]))>1e-6)return[m];
  const a1=Math.atan2(t1[1]-c[1],t1[0]-c[0]);let delta=Math.atan2(t2[1]-c[1],t2[0]-c[0])-a1;delta=Math.atan2(Math.sin(delta),Math.cos(delta));
  // Хуваалцах цэг нь нумын дунд; хэрчим бүр өөрийн хагасыг авна.
  const half=delta/2,steps=Math.max(2,Math.ceil(r*Math.abs(half)/3)),out:XY[]=[];
  for(let k=0;k<=steps;k++){const ang=a1+half*(1-k/steps);out.push([c[0]+r*Math.cos(ang),c[1]+r*Math.sin(ang)]);}
  out[out.length-1]=t1;return out;
 };
 for(const [edgeIndex,e] of graph.edges.entries()){
  const a=graph.nodes[e.a],b=graph.nodes[e.b],matches=edgeLines[edgeIndex];
  const water=matches.find(l=>l.sys==='water'),heat=matches.find(l=>l.sys==='heat'),reference=water??heat!;
  for(const [i,pipe]of CHANNEL_ORDER.entries()){
   const source=pipe==='Т1'||pipe==='Т2'?heat:water;
   const dn=pipe==='Т3'?water?.dnHot??null:pipe==='Т4'?water?.dnCirc??null:source?.dn??null;
   const flow=source?.flowKnown===false?null:pipe==='Т3'?water?.flowHot??null:pipe==='Т4'?water?.flowCirc??null:source?.flow??null;
   // Урсгал/налууг өөр системээс зохиомлоор хуулж болохгүй; нөөц шугам DN-гүй.
   const origin=source??reference,forward=near(a,origin.path[0],origin.path.at(-1)!)&&Math.hypot(a[0]-origin.path[0][0],a[1]-origin.path[0][1])<=Math.hypot(b[0]-origin.path[0][0],b[1]-origin.path[0][1]);
   const path:XY[]=forward?[a,b]:[b,a],whole=origin.path.length===2&&Math.hypot(path[0][0]-origin.path[0][0],path[0][1]-origin.path[0][1])<.001&&Math.hypot(path[1][0]-origin.path[1][0],path[1][1]-origin.path[1][1])<.001;
   const drawn=[...nodeEnd(e.a,i,edgeIndex),...nodeEnd(e.b,i,edgeIndex).reverse()];
   // Цэгийн дараалал тэнхлэгийн (өгөх) чиглэлээр; Т2/Т4 буцах хоолойн урсгал эсрэг гэдгийг атрибутаар тэмдэглэнэ.
   out.push({pipe,sys:PIPES[pipe].sys,path:forward?drawn:[...drawn].reverse(),dn,flow,slope:source?.slope??null,depth:source?.depth??null,
    ...(whole?{fromNode:origin.fromNode,toNode:origin.toNode,invertFrom:origin.invertFrom,invertTo:origin.invertTo}:{}),sourceId:source?.sourceId,reserved:!source||dn==null});
   trayMeta.push({row:out[out.length-1],a:e.a,b:e.b,i,forward});
  }
 }
 // Тээ ба богино хэрчмийн үлдэгдэл зөрүү: зангилаа бүрт ижил хоолойн салааны төгсгөлийг өөр салааны хоолой дээр яг буулгаж, тэр цэгийг оруулна.
 const ends=new Map<string,{meta:typeof trayMeta[number];end:number}[]>();
 for(const meta of trayMeta)for(const [node,atStart]of [[meta.a,meta.forward],[meta.b,!meta.forward]] as [number,boolean][]){const key=`${meta.i}:${node}`,rows=ends.get(key)??[];rows.push({meta,end:atStart?0:meta.row.path.length-1});ends.set(key,rows);}
 const project=(q:XY,path:XY[])=>{let best={d:Infinity,p:q,k:0};for(let k=1;k<path.length;k++){const a=path[k-1],b=path[k],dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy,t=l2?Math.max(0,Math.min(1,((q[0]-a[0])*dx+(q[1]-a[1])*dy)/l2)):0,p:XY=[a[0]+dx*t,a[1]+dy*t],d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<best.d)best={d,p,k};}return best;};
 for(const rows of ends.values()){if(rows.length<2)continue;
  for(const row of rows){const q=row.meta.row.path[row.end];
   if(rows.some(o=>o!==row&&project(q,o.meta.row.path).d<1e-6))continue;
   const target=rows.filter(o=>o!==row).map(o=>({o,hit:project(q,o.meta.row.path)})).sort((x,y)=>x.hit.d-y.hit.d)[0];
   if(!target||target.hit.d>2.5)continue;
   row.meta.row.path[row.end]=target.hit.p;const path=target.o.meta.row.path;
   if(!path.some(p=>Math.hypot(p[0]-target.hit.p[0],p[1]-target.hit.p[1])<1e-6))path.splice(target.hit.k,0,[target.hit.p[0],target.hit.p[1]]);
  }
 }
 for(const l of lines.filter(l=>l.sys!=='water'&&l.sys!=='heat')){
  // Бохир/цахилгааны тооцсон тусдаа трассыг зураг дээр дахин зөөвөл өндөр, ёроолын түвшин
  // ба хориглолтын шалгалт хүчингүй болно. Тооцсон координатыг яг хэвээр харуулна.
  out.push({...l,flow:l.flowKnown===false?null:l.flow,pipe:l.sys==='sewer'?'К1':l.sys==='power'?'Э':'К2',path:l.path.map(p=>[...p] as XY)});
 }
 return out;
}
/** Бохирын худаг: зангилаа бүрт ба DN-ээс хамаарсан алхмаар. */
export function manholes(rows:PipeRow[]):{p:XY;dn:number|null}[]{
 const seen=new Map<string,{p:XY;dn:number|null}>(),key=(p:XY)=>`${Math.round(p[0]*2)},${Math.round(p[1]*2)}`;
 for(const r of rows){if(r.pipe!=='К1')continue;
  const step=manholeSpacing(r.dn);
  for(let i=1;i<r.path.length;i++){const a=r.path[i-1],b=r.path[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(L/step));
   for(let k=0;k<=n;k++){const p:XY=[a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n];if(!seen.has(key(p)))seen.set(key(p),{p,dn:r.dn});}}
 }
 return[...seen.values()];
}

export type ServiceSet=Record<ServiceKind,ServicePlan>;
export function compareServices(load:Record<ServiceKind,Record<number,number>>,at:Record<number,XY>,spec:Record<ServiceKind,ServiceSpec>,detour:number){
 return Object.fromEntries(SERVICE_MODES.map(([m])=>[m,Object.fromEntries((['water','sewer','heat'] as ServiceKind[]).map(k=>[k,planService(k,m,load[k],at,spec[k],detour)]))])) as Record<ServiceMode,ServiceSet>;
}
