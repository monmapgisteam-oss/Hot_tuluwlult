// Замын хэвтээ трасс: шулуун хэсэг (tangent) + тойруу муруй. Торны A* шатлалыг (хөрөө хэлбэр) арилгана.
// Хатуу хязгаарлалт (хил, барилга, хориг, DEM, налуу) ба эрсдэлийн өртгөөс илүү гарахгүй; өртгийн жижиг төсөв (2 %)-өөр хязгаарлахгүй:
// налууны квадрат торгууль торны алхмыг «хямд» харагдуулдаг тул зөвшөөрөгдсөн налуутай шулуун хэсгийг сонгоно.
import {DESIGN_VEHICLES} from './vehiclePaths';

type XY=[number,number];
/** ТААМАГЛАЛ: тооцооны хурд → хамгийн бага радиус, м (70–80 км/ц: СП 34.13330 хүснэгтийн утга, ШАЛГАХ). Эх: СП 34.13330 (СНиП 2.05.02-85) хүснэгт (30–60 км/ц);
 * 20 км/ц нь R = V²/(127·(e+f)), e = 0, f = 0.2 (ТААМАГЛАЛ). ШАЛГАХ: БНбД 32-01-04, үйлдвэрийн зам (СНиП 2.05.07-91). */
export const DESIGN_RADIUS:Record<number,number>={20:15,30:30,40:60,50:100,60:150,70:200,80:300};
export function designRadius(speedKmh:number){const keys=Object.keys(DESIGN_RADIUS).map(Number).sort((a,b)=>a-b);for(const k of keys)if(speedKmh<=k)return DESIGN_RADIUS[k];return DESIGN_RADIUS[keys.at(-1)!];}
/** Радиусаас зөвлөмжит хурд (км/ц): хүснэгтийн хамгийн их хурд, R_min ≤ R. */
export function advisorySpeed(radius:number){let v=0;for(const [k,r] of Object.entries(DESIGN_RADIUS))if(radius>=r-1e-6)v=Math.max(v,+k);return v;}
/** Хамгийн бага (эргэлтийн) радиус: SU-30 хойд тэнхлэг 10 м (vehiclePaths.ts). */
export const MIN_TURN_RADIUS=DESIGN_VEHICLES.truck.minRadius;

export type AlignOptions={
 /** Хүссэн тойруу муруйн радиус */ radius:number;
 /** Багтахгүй үед бууруулах доод хязгаар */ minRadius:number;
 /** Хэсэг (шулуун/муруй) хатуу хязгаарлалтыг хангах эсэх */ feasible:(path:XY[])=>boolean;
 /** Хэсгийн хамгийн их эрсдэлийн өртөг (тохиромж): шулуун товчлол анхны трассаас эрсдэлтэй газар орохгүй */ risk?:(path:XY[])=>number;
 /** Хөдлөхгүй зангилаа (салаа, уулзвар) */ anchors?:XY[];
 /** Шулуун товчлолоор орлох оройн хамгийн их хазайлт, м: торны шатлалыг арилгаж, санаатай эргэлтийг (барилгын нүүр, тойрох маршрут) хадгална */ tolerance:number;
};
export type Curve={radius:number;deflection:number;length:number;advisoryKmh:number};
export type Alignment={path:XY[];unresolved:number;curves:Curve[]};
const dist=(a:XY,b:XY)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
const same=(a:XY,b:XY)=>dist(a,b)<.001;

/** Анхны трассыг зангилаагаар хувааж, хэсэг бүрийг шулуун + муруй болгоно. Эх массивыг өөрчлөхгүй. */
export function alignRoute(input:XY[],o:AlignOptions):Alignment{
 const raw=input.filter((p,i)=>!i||!same(p,input[i-1])).map(p=>[p[0],p[1]] as XY);
 if(raw.length<3)return{path:raw,unresolved:0,curves:[]};
 // Сегмент дээрх зангилааг оройд оруулж, тэнд хуваана.
 const pieces:XY[][]=[];let current:XY[]=[raw[0]];
 for(let i=1;i<raw.length;i++){const a=raw[i-1],b=raw[i],dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;
  const cuts=(o.anchors??[]).map(p=>({p,t:((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2})).filter(c=>c.t>1e-8&&c.t<1-1e-8&&Math.abs(dx*(c.p[1]-a[1])-dy*(c.p[0]-a[0]))/Math.sqrt(l2)<.001).sort((x,y)=>x.t-y.t);
  for(const {p} of cuts){current.push(p);pieces.push(current);current=[p];}
  current.push(b);if(i<raw.length-1&&(o.anchors??[]).some(p=>same(p,b))){pieces.push(current);current=[b];}
 }
 if(current.length>1)pieces.push(current);
 const results=pieces.map(p=>alignPiece(p,o));
 return{path:results.flatMap((r,i)=>i?r.path.slice(1):r.path),unresolved:results.reduce((n,r)=>n+r.unresolved,0),curves:results.flatMap(r=>r.curves)};
}
function alignPiece(p:XY[],o:AlignOptions):Alignment{
 if(p.length<3)return{path:p,unresolved:0,curves:[]};
 // 1. «Чангалсан утас»: оройноос хамгийн хол хүрэх боломжтой шулуун хэсэг (анхны сегмент үргэлж хүчинтэй).
 const deviation=(i:number,j:number)=>{const a=p[i],b=p[j],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;let max=0;for(let k=i+1;k<j;k++)max=Math.max(max,Math.abs(dx*(p[k][1]-a[1])-dy*(p[k][0]-a[0]))/l);return max;};
 const ok=(i:number,j:number)=>j===i+1||deviation(i,j)<=o.tolerance&&o.feasible([p[i],p[j]])&&(!o.risk||o.risk([p[i],p[j]])<=o.risk(p.slice(i,j+1))+1e-6);
 const taut:XY[]=[p[0]];let i=0;
 while(i<p.length-1){let best=i+1;
  if(ok(i,p.length-1))best=p.length-1;else{let lo=i+1,hi=p.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(ok(i,mid))lo=mid;else hi=mid;}best=lo;}
  taut.push(p[best]);i=best;}
 // Шулуун дээрх илүүдэл оройг хасна.
 const points:XY[]=[];for(const q of taut){while(points.length>=2){const a=points.at(-2)!,b=points.at(-1)!,u=[b[0]-a[0],b[1]-a[1]],v=[q[0]-b[0],q[1]-b[1]],l=Math.hypot(...u)*Math.hypot(...v);if(!l||Math.abs(u[0]*v[1]-u[1]*v[0])/l>Math.sin(.5*Math.PI/180)||u[0]*v[0]+u[1]*v[1]<0)break;points.pop();}points.push(q);}
 // 2. Тойруу муруй: хүссэн радиусаас эхэлж, шулуун хэсгийн урт ба хязгаарлалтад багтахаар бууруулна.
 const out:XY[]=[points[0]],curves:Curve[]=[];let unresolved=0,usedPrev=0;
 for(let k=1;k<points.length-1;k++){
  const a=points[k-1],b=points[k],c=points[k+1],la=dist(a,b),lb=dist(b,c),u:XY=[(b[0]-a[0])/la,(b[1]-a[1])/la],v:XY=[(c[0]-b[0])/lb,(c[1]-b[1])/lb];
  const theta=Math.acos(Math.max(-1,Math.min(1,u[0]*v[0]+u[1]*v[1])));
  if(theta<.5*Math.PI/180){out.push(b);usedPrev=0;continue;}
  // Дараагийн оройд шулуун хэсгийн хагасыг нөөцөлнө (сүүлийн оройд бүтнээр).
  const availPrev=la-usedPrev,availNext=k+1===points.length-1?lb:lb/2,tan=Math.tan(theta/2),limit=Math.min(availPrev,availNext)/tan;
  const tries=[...new Set([o.radius,o.radius*.75,o.radius*.5,Math.min(o.radius,limit),o.minRadius].filter(r=>r>=o.minRadius-1e-9&&r*tan<=Math.min(availPrev,availNext)+1e-9).map(r=>+r.toFixed(3)))].sort((x,y)=>y-x);
  let placed=false;
  for(const radius of tries){const t=radius*tan,start:XY=[b[0]-u[0]*t,b[1]-u[1]*t],end:XY=[b[0]+v[0]*t,b[1]+v[1]*t],sign=u[0]*v[1]-u[1]*v[0]>0?1:-1;
   const center:XY=[start[0]-u[1]*radius*sign,start[1]+u[0]*radius*sign],angle=Math.atan2(start[1]-center[1],start[0]-center[0]),count=Math.max(4,Math.ceil(theta*radius/2));
   const arc=Array.from({length:count+1},(_,n):XY=>[center[0]+radius*Math.cos(angle+sign*theta*n/count),center[1]+radius*Math.sin(angle+sign*theta*n/count)]);arc[0]=start;arc[count]=end;
   if(!o.feasible(arc)||o.risk&&o.risk(arc)>o.risk([start,b,end])+1e-6)continue;
   out.push(...arc);curves.push({radius,deflection:theta*180/Math.PI,length:theta*radius,advisoryKmh:advisorySpeed(radius)});usedPrev=t;placed=true;break;}
  if(!placed){out.push(b);unresolved++;usedPrev=0;}
 }
 out.push(points.at(-1)!);
 return{path:out.filter((q,n)=>!n||!same(q,out[n-1])),unresolved,curves};
}
