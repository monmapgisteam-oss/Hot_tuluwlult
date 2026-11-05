import {alignRoute,MIN_TURN_RADIUS} from './roadAlignment';
// Шулуун fallback байхгүй: хориглосон нүд / налуу / DEM хүрээ зөрчвөл шалтгаантай буцаана.
export type RouteGrid = {x0:number;y0:number;nx:number;ny:number;cell:number;z:Float64Array};
export type RoutePoint = [number,number];
export type RouteResult = {path:RoutePoint[];km:number;maxGrade:number;rise:number;status:"ok"|"blocked";reason:string;weightedCost?:number};
/** gradeWindowM — богино алхмуудын хөрөө шүдэн зиг-загаар налуугийн хязгаарыг тойрохгүй: энэ урттай хөвчийн налууг ч шалгана (анхдагч 4 нүд). */
export type RouteOptions={maxGrade:number;preferred?:Uint8Array;gradeCost?:number;costSurface?:ArrayLike<number>;smooth?:boolean|{tolerance?:number;radius?:number;minRadius?:number};exactEndpoints?:boolean;gradeWindowM?:number};
/** Count shared grid segments once for corridor quantities. */
export function uniqueRouteLength(paths:RoutePoint[][]):number {
  const seen=new Set<string>();let metres=0;
  for(const path of paths)for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i],ka=a.join(","),kb=b.join(","),key=ka<kb?`${ka}|${kb}`:`${kb}|${ka}`;
    if(!seen.has(key)){seen.add(key);metres+=Math.hypot(b[0]-a[0],b[1]-a[1]);}
  }
  return metres/1000;
}
class Queue {
  a:[number,number][]=[];
  push(k:number,f:number){this.a.push([k,f]);let i=this.a.length-1;while(i){const p=(i-1)>>1;if(this.a[p][1]<=f)break;[this.a[i],this.a[p]]=[this.a[p],this.a[i]];i=p;}}
  pop(){const top=this.a[0],last=this.a.pop()!;if(this.a.length){this.a[0]=last;for(let i=0;;){let m=i;const l=2*i+1,r=l+1;if(l<this.a.length&&this.a[l][1]<this.a[m][1])m=l;if(r<this.a.length&&this.a[r][1]<this.a[m][1])m=r;if(m===i)break;[this.a[m],this.a[i]]=[this.a[i],this.a[m]];i=m;}}return top[0];}
}
export function routeTerrain(d:RouteGrid,mask:Uint8Array,a:RoutePoint,b:RoutePoint,opt:RouteOptions):RouteResult {
  const failed=(reason:string):RouteResult=>({path:[],km:0,maxGrade:0,rise:0,status:"blocked",reason});
  const index=([x,y]:RoutePoint)=>{const i=Math.round((x-d.x0)/d.cell),j=Math.round((y-d.y0)/d.cell);return i<0||j<0||i>=d.nx||j>=d.ny?-1:j*d.nx+i;};
  const xy=(k:number):RoutePoint=>[d.x0+k%d.nx*d.cell,d.y0+Math.floor(k/d.nx)*d.cell];
  const s=index(a),t=index(b),N=d.nx*d.ny;
  if(s<0||t<0)return failed("DEM хүрээнээс гадна: гаднах холболтод нэмэлт судалгаа шаардлагатай");
  const allowed=(k:number)=>k>=0&&k<N&&!!mask[k]&&Number.isFinite(d.z[k])&&(!opt.costSurface||Number.isFinite(opt.costSurface[k])&&opt.costSurface[k]>=1);
  if(!allowed(s)||!allowed(t))return failed("Эхлэл/төгсгөл хориглосон эсвэл DEM дутуу нүдэнд байна");
  const cost=new Float64Array(N).fill(Infinity),parent=new Int32Array(N).fill(-1),closed=new Uint8Array(N),q=new Queue(),windowM=opt.gradeWindowM??4*d.cell;
  const heuristic=(k:number)=>Math.hypot((k%d.nx)-(t%d.nx),Math.floor(k/d.nx)-Math.floor(t/d.nx))*d.cell;
  cost[s]=0;q.push(s,heuristic(s));
  while(q.a.length){const k=q.pop();if(closed[k])continue;closed[k]=1;if(k===t)break;
    const x=k%d.nx,y=Math.floor(k/d.nx);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;const i=x+dx,j=y+dy;if(i<0||j<0||i>=d.nx||j>=d.ny)continue;
      const v=j*d.nx+i;if(!allowed(v)||closed[v])continue;
      if(dx&&dy&&(!allowed(y*d.nx+i)||!allowed(j*d.nx+x)))continue;
      const distance=d.cell*Math.hypot(dx,dy),mid=dx&&dy?(d.z[k]+d.z[v]+d.z[y*d.nx+i]+d.z[j*d.nx+x])/4:(d.z[k]+d.z[v])/2;
      const grade=Math.max(Math.abs(-3*d.z[k]+4*mid-d.z[v]),Math.abs(d.z[k]-4*mid+3*d.z[v]))/distance*100;
      if(grade>opt.maxGrade)continue;
      // Хөвчийн налуу: одоогийн эцэг гинжээр window урт хүртэл ухарч шалгана.
      if(windowM>0){let anc=k,back=0,bad=false;while(anc>=0&&back<windowM){const chord=Math.hypot((v%d.nx)-(anc%d.nx),Math.floor(v/d.nx)-Math.floor(anc/d.nx))*d.cell;if(chord>1e-9&&Math.abs(d.z[v]-d.z[anc])/chord*100>opt.maxGrade+1e-9){bad=true;break;}const prev=parent[anc];if(prev<0)break;back+=d.cell*Math.hypot((anc%d.nx)-(prev%d.nx),Math.floor(anc/d.nx)-Math.floor(prev/d.nx));anc=prev;}if(bad)continue;}
      const suitability=opt.costSurface?(opt.costSurface[k]+opt.costSurface[v])/2:1;
      const c=distance*(1+(grade/(opt.gradeCost??4))**2+(opt.preferred&&!opt.preferred[v]?3:0))*suitability;
      if(cost[k]+c<cost[v]){cost[v]=cost[k]+c;parent[v]=k;q.push(v,cost[v]+heuristic(v));}
    }
  }
  if(!Number.isFinite(cost[t]))return failed(`≤${opt.maxGrade}% налуутай, хориглолтыг тойрсон холбоос олдсонгүй`);
  const ids:number[]=[];for(let k=t;k>=0;k=parent[k])ids.push(k);ids.reverse();
  let path=ids.map(xy);
  if(opt.exactEndpoints)path=[a,...path,b].filter((p,i,all)=>!i||Math.hypot(p[0]-all[i-1][0],p[1]-all[i-1][1])>.001);
  if(opt.smooth)path=smoothTerrainPath(d,mask,path,opt);
  const metrics=routePathMetrics(d,mask,path,opt);
  if(!Number.isFinite(metrics.cost))return failed('Трассын нарийвчилсан DEM / хориглолтын шалгалт хангаагүй');
  return {path,km:metrics.length/1000,maxGrade:metrics.maxGrade,rise:metrics.rise,weightedCost:metrics.cost,status:"ok",reason:opt.smooth?'Тохиромжийн өртгөөр эрэмбэлж, хориг ба DEM налууг дахин шалгасан концепц трасс':'DEM нүдний төвөөр тооцсон концепц трасс; төгсгөлийн холболт ±1 нүд'};
}

const distance=(a:RoutePoint,b:RoutePoint)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
function height(d:RouteGrid,[x,y]:RoutePoint){
 const fx=(x-d.x0)/d.cell,fy=(y-d.y0)/d.cell;if(fx<0||fy<0||fx>d.nx-1||fy>d.ny-1)return NaN;
 if(d.nx<2||d.ny<2)return d.z[Math.round(fy)*d.nx+Math.round(fx)];
 const i=Math.min(d.nx-2,Math.floor(fx)),j=Math.min(d.ny-2,Math.floor(fy)),tx=fx-i,ty=fy-j;
 return d.z[j*d.nx+i]*(1-tx)*(1-ty)+d.z[j*d.nx+i+1]*tx*(1-ty)+d.z[(j+1)*d.nx+i]*(1-tx)*ty+d.z[(j+1)*d.nx+i+1]*tx*ty;
}
/** Билинейр DEM дээрх сегментийн налуугийн оргилыг нүд бүрийн хоёр захад бодно. */
export function terrainSegmentMaxGrade(d:RouteGrid,a:RoutePoint,b:RoutePoint):number{
 const dx=b[0]-a[0],dy=b[1]-a[1],length=distance(a,b);if(length<1e-8)return 0;
 const cuts=[0,1];
 for(const [start,delta,origin] of [[a[0],dx,d.x0],[a[1],dy,d.y0]]){
  if(Math.abs(delta)<1e-9)continue;
  const low=Math.min(start,start+delta),high=Math.max(start,start+delta);
  for(let k=Math.floor((low-origin)/d.cell)+1;k<Math.ceil((high-origin)/d.cell);k++)cuts.push((origin+k*d.cell-start)/delta);
 }
 cuts.sort((x,y)=>x-y);const at=(t:number):RoutePoint=>[a[0]+dx*t,a[1]+dy*t];let max=0;
 for(let i=1;i<cuts.length;i++){
  const from=cuts[i-1],to=cuts[i],span=(to-from)*length;if(span<1e-7)continue;
  const za=height(d,at(from)),zm=height(d,at((from+to)/2)),zb=height(d,at(to));
  if(!Number.isFinite(za+zm+zb))return Infinity;
  max=Math.max(max,Math.abs(-3*za+4*zm-zb)/span*100,Math.abs(za-4*zm+3*zb)/span*100);
 }
 return max;
}
/** Бодит сегментийн бүх дайрсан нүд, интерполяцын налуу, тохиромжийн өртгийг шалгана. */
export function routePathMetrics(d:RouteGrid,mask:Uint8Array,path:RoutePoint[],opt:RouteOptions){
 let length=0,maxGrade=0,rise=0,cost=0;
 // Хөвчийн налуугийн цонх: саяхны дээжүүдтэй шулуун зайгаар харьцуулна (зиг-заг хамгаалалт).
 const windowM=opt.gradeWindowM??4*d.cell,recent:{p:RoutePoint;z:number;at:number}[]=[];
 const index=(p:RoutePoint)=>{const x=Math.round((p[0]-d.x0)/d.cell),y=Math.round((p[1]-d.y0)/d.cell);return x<0||y<0||x>=d.nx||y>=d.ny?-1:y*d.nx+x;};
 const valid=(k:number)=>k>=0&&!!mask[k]&&Number.isFinite(d.z[k])&&(!opt.costSurface||Number.isFinite(opt.costSurface[k])&&opt.costSurface[k]>=1);
 for(let j=1;j<path.length;j++){
  const a=path[j-1],b=path[j],len=distance(a,b);if(len<.000001)continue;
  const peakGrade=terrainSegmentMaxGrade(d,a,b);maxGrade=Math.max(maxGrade,peakGrade);
  if(peakGrade>opt.maxGrade+.00001)return{length,maxGrade,rise,cost:Infinity};
  const steps=Math.max(1,Math.ceil(len/Math.min(10,d.cell/4)));let previous=a,pk=index(a),pz=height(d,a);
  if(!valid(pk)||!Number.isFinite(pz))return{length,maxGrade,rise,cost:Infinity};
  for(let i=1;i<=steps;i++){
   const p:RoutePoint=[a[0]+(b[0]-a[0])*i/steps,a[1]+(b[1]-a[1])*i/steps],k=index(p),z=height(d,p),dl=distance(previous,p),grade=Math.abs(z-pz)/dl*100;
   // Диагоналиар хоёр хориглосон нүдний завсраар шахаж гарахгүй.
   const px=pk%d.nx,py=Math.floor(pk/d.nx),x=k%d.nx,y=Math.floor(k/d.nx);
   if(!valid(k)||!Number.isFinite(z)||grade>opt.maxGrade+.00001||(x!==px&&y!==py&&(!valid(py*d.nx+x)||!valid(y*d.nx+px))))return{length,maxGrade:Math.max(maxGrade,grade),rise,cost:Infinity};
   length+=dl;maxGrade=Math.max(maxGrade,grade);rise+=Math.max(0,z-pz);
   if(windowM>0){while(recent.length&&recent[0].at<length-windowM)recent.shift();for(const r of recent){const chord=distance(r.p,p);if(chord>1e-9&&Math.abs(z-r.z)/chord*100>opt.maxGrade+1e-6)return{length,maxGrade:Math.max(maxGrade,Math.abs(z-r.z)/chord*100),rise,cost:Infinity};}recent.push({p,z,at:length});}
   cost+=dl*(1+(grade/(opt.gradeCost??4))**2+(opt.preferred&&!opt.preferred[k]?3:0))*(opt.costSurface?(opt.costSurface[pk]+opt.costSurface[k])/2:1);
   previous=p;pk=k;pz=z;
  }
 }
 return{length,maxGrade,rise,cost};
}
/** Торны шатлалыг шулуун хэсэг + тойруу муруй болгоно (roadAlignment.ts). Хориг, нүд, DEM, налууг хатуу шалгана;
 * шулуун товчлол анхны трассаас өндөр эрсдэлийн өртөгтэй нүд рүү орохгүй (налуугийн квадрат торгуулиар бус). */
export function smoothTerrainPath(d:RouteGrid,mask:Uint8Array,path:RoutePoint[],opt:RouteOptions):RoutePoint[]{
 if(path.length<3)return path;
 const settings=typeof opt.smooth==='object'?opt.smooth:{},feasible=(p:RoutePoint[])=>Number.isFinite(routePathMetrics(d,mask,p,opt).cost);
 const index=(p:RoutePoint)=>{const x=Math.round((p[0]-d.x0)/d.cell),y=Math.round((p[1]-d.y0)/d.cell);return x<0||y<0||x>=d.nx||y>=d.ny?-1:y*d.nx+x;};
 const risk=opt.costSurface?(p:RoutePoint[])=>{let max=0;for(let j=1;j<p.length;j++){const a=p[j-1],b=p[j],steps=Math.max(1,Math.ceil(distance(a,b)/Math.min(10,d.cell/4)));for(let i=0;i<=steps;i++){const k=index([a[0]+(b[0]-a[0])*i/steps,a[1]+(b[1]-a[1])*i/steps]);if(k>=0)max=Math.max(max,opt.costSurface![k]);}}return max;}:undefined;
 if(!feasible(path))return path;
 const radius=settings.radius??Math.max(12,Math.min(40,d.cell*.4)),aligned=alignRoute(path,{radius,minRadius:Math.min(radius,settings.minRadius??MIN_TURN_RADIUS),feasible,risk,tolerance:settings.tolerance??Math.max(3*d.cell,2*radius)});
 return feasible(aligned.path)?aligned.path:path;
}
