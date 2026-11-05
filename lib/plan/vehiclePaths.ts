/** Бага хурдны хатуу их биетэй машины концепц загвар; баталгаажсан эргэлтийн зураг төсөл биш.
 * SU-30 хэмжээ: SDDCTEA Pamphlet55-17 chapter4 / published AASHTO figure.
 * https://api.army.mil/e2/c/downloads/2026/04/08/543b0be6/tea-pamphlet-55-17-2.pdf
 * Арын тэнхлэгийн 10 м радиус нь sqrt((38ft)^2-(20ft)^2)=9.85 м-ээс их.
 */
import type {Point2 as XY} from './sharedUtilityGraph';
import {distance} from './roadGeometry';
export type VehicleKind='car'|'truck';
export type DesignVehicle={id:string;length:number;width:number;wheelbase:number;frontOverhang:number;rearOverhang:number;minRadius:number;maxSpeed:number;lateralAcceleration:number};
export const DESIGN_VEHICLES:Record<VehicleKind,DesignVehicle>={
 car:{id:'passenger-concept',length:4.5,width:1.85,wheelbase:2.7,frontOverhang:.9,rearOverhang:.9,minRadius:5,maxSpeed:25,lateralAcceleration:1.5},
 truck:{id:'SU-30-rigid',length:9.144,width:2.59,wheelbase:6.096,frontOverhang:1.2192,rearOverhang:1.8288,minRadius:10,maxSpeed:11,lateralAcceleration:1},
};
type Line={kind:'line';a:XY;b:XY;length:number};
type Arc={kind:'arc';center:XY;radius:number;angle:number;sweep:number;length:number};
type Cubic={kind:'cubic';p:XY[];length:number;table:number[];minRadius:number};
export type MotionSegment=Line|Arc|Cubic;
export type MotionPath={segments:MotionSegment[];length:number;ends:number[];minRadius:number};
export type MotionPose={point:XY;dir:XY;radius:number};
const dot=(a:XY,b:XY)=>a[0]*b[0]+a[1]*b[1],cross=(a:XY,b:XY)=>a[0]*b[1]-a[1]*b[0];
const add=(p:XY,u:XY,d:number):XY=>[p[0]+u[0]*d,p[1]+u[1]*d];
const unit=(a:XY,b:XY):XY=>{const l=distance(a,b);return l?[ (b[0]-a[0])/l,(b[1]-a[1])/l]:[1,0];};
const line=(a:XY,b:XY):Line=>({kind:'line',a,b,length:distance(a,b)});
function motion(segments:MotionSegment[]):MotionPath {let length=0;const clean=segments.filter(s=>s.length>1e-7),ends=clean.map(s=>length+=s.length);return{segments:clean,length,ends,minRadius:Math.min(Infinity,...clean.map(s=>s.kind==='line'?Infinity:s.kind==='arc'?s.radius:s.minRadius))};}
function cubicAt(p:XY[],t:number){const v=1-t,point:XY=[0,0],d:XY=[0,0],dd:XY=[0,0];for(let k=0;k<2;k++){point[k]=v*v*v*p[0][k]+3*v*v*t*p[1][k]+3*v*t*t*p[2][k]+t*t*t*p[3][k];d[k]=3*v*v*(p[1][k]-p[0][k])+6*v*t*(p[2][k]-p[1][k])+3*t*t*(p[3][k]-p[2][k]);dd[k]=6*v*(p[2][k]-2*p[1][k]+p[0][k])+6*t*(p[3][k]-2*p[2][k]+p[1][k]);}const speed=Math.hypot(...d),curvature=Math.abs(cross(d,dd))/speed**3;return{point,dir:[d[0]/speed,d[1]/speed] as XY,radius:curvature>1e-9?1/curvature:Infinity};}
export function sampleMotion(path:MotionPath,s:number):MotionPose{
 if(!path.segments.length)return{point:[0,0],dir:[1,0],radius:Infinity};s=Math.max(0,Math.min(path.length,s));let lo=0,hi=path.ends.length-1;while(lo<hi){const m=(lo+hi)>>1;if(path.ends[m]<s)lo=m+1;else hi=m;}const part=path.segments[lo],offset=s-(lo?path.ends[lo-1]:0),t=Math.min(1,offset/part.length);
 if(part.kind==='line')return{point:add(part.a,unit(part.a,part.b),offset),dir:unit(part.a,part.b),radius:Infinity};
 if(part.kind==='arc'){const a=part.angle+part.sweep*t,sign=Math.sign(part.sweep);return{point:[part.center[0]+part.radius*Math.cos(a),part.center[1]+part.radius*Math.sin(a)],dir:[-Math.sin(a)*sign,Math.cos(a)*sign],radius:part.radius};}
 let k=1;while(k<part.table.length-1&&part.table[k]<offset)k++;const a=part.table[k-1],b=part.table[k],u=(k-1+(b>a?(offset-a)/(b-a):0))/(part.table.length-1);return cubicAt(part.p,u);
}
export function motionPoints(path:MotionPath,spacing=.5):XY[]{const n=Math.max(1,Math.ceil(path.length/spacing));return Array.from({length:n+1},(_,i)=>sampleMotion(path,path.length*i/n).point);}
/** Шүргэлцээ тасралтгүй шулуун ба тойргийн нум; зэрэгцээ нумууд шулууны сул уртыг хуваана. */
export function filletMotion(input:XY[],radius:number):MotionPath|null{
 const p=input.filter((q,i)=>!i||distance(q,input[i-1])>1e-5);if(p.length<2)return null;
 const corners=p.map((b,i)=>{if(!i||i===p.length-1)return null;const u=unit(p[i-1],b),v=unit(b,p[i+1]),theta=Math.acos(Math.max(-1,Math.min(1,dot(u,v))));if(theta<1e-5)return null;const trim=radius*Math.tan(theta/2);return{u,v,theta,trim,sign:Math.sign(cross(u,v))};});
 for(let i=1;i<p.length;i++)if((corners[i-1]?.trim??0)+(corners[i]?.trim??0)>distance(p[i-1],p[i])+1e-5)return null;
 const pieces:MotionSegment[]=[];let at=p[0];for(let i=1;i<p.length-1;i++){const c=corners[i];if(!c)continue;if(!Number.isFinite(c.trim)||c.theta>Math.PI-.01)return null;const start=add(p[i],c.u,-c.trim),end=add(p[i],c.v,c.trim),center:XY=[start[0]-c.u[1]*radius*c.sign,start[1]+c.u[0]*radius*c.sign];pieces.push(line(at,start),{kind:'arc',center,radius,angle:Math.atan2(start[1]-center[1],start[0]-center[0]),sweep:c.sign*c.theta,length:radius*c.theta});at=end;}
 pieces.push(line(at,p.at(-1)!));return motion(pieces);
}
/** Эгнээний чиглэлтэй төгсгөлүүдийн эргэлт. Байран дээр эргүүлэх болон U эргэлт үүсгэхгүй. */
export function turnMotion(a:XY,u:XY,b:XY,v:XY,radius:number):MotionPath|null{
 const angle=Math.acos(Math.max(-1,Math.min(1,dot(u,v))));if(angle>Math.PI*.93)return null;
 const det=cross(u,v),delta:XY=[b[0]-a[0],b[1]-a[1]];
 if(Math.abs(det)>1e-5){const da=cross(delta,v)/det,db=cross(u,delta)/det;if(da>0&&db>0){const q=add(a,u,da),result=filletMotion([a,q,b],radius);if(result)return result;}}
 // Өргөн өөрчлөгдөх, бараг шулуун ташуу залгалтыг шүргэлцээтэй куб муруйгаар холбоно.
 // Муруйлтыг нягт дээжилж шаардах радиусаас нөөцтэй байлгана.
 const d=distance(a,b);if(d<.05)return angle<1e-4?motion([line(a,b)]):null;
 for(const scale of [.33,.45,.6]){const p=[a,add(a,u,d*scale),add(b,v,-d*scale),b],count=Math.max(64,Math.ceil(d/.25)),table=[0];let last=a,min=Infinity,valid=true;
  for(let i=1;i<=count;i++){const pose=cubicAt(p,i/count);if(!pose.dir.every(Number.isFinite)){valid=false;break;}min=Math.min(min,pose.radius);table.push(table.at(-1)!+distance(last,pose.point));last=pose.point;}
  min=Math.min(min,cubicAt(p,0).radius);if(valid&&min>=radius*1.005)return motion([{kind:'cubic',p,length:table.at(-1)!,table,minRadius:min}]);
 }return null;
}
export function bodyCorners(pose:MotionPose,vehicle:DesignVehicle,margin=0):XY[]{const front=vehicle.wheelbase+vehicle.frontOverhang+margin,rear=-vehicle.rearOverhang-margin,half=vehicle.width/2+margin,{point:p,dir:u}=pose;return[[rear,-half],[front,-half],[front,half],[rear,half],[rear,-half]].map(([x,y])=>[p[0]+u[0]*x-u[1]*y,p[1]+u[1]*x+u[0]*y]);}
/** Арын тэнхлэг ба их биеийн ирмэгийг 0.5 м алхмаар, 0.20 м нөөцтэй шалгана.
 * Урд/хойд илүү гарах хэсэг болон бүтэн оврыг хамарна; шулууныг бүхэл полигоноор шалгана. */
export function vehicleFits(path:MotionPath,vehicle:DesignVehicle,contains:(x:number,y:number)=>boolean,margin=.2,covers?:(ring:XY[])=>boolean):boolean{
 if(path.minRadius+1e-5<vehicle.minRadius)return false;
 let from=0;for(const segment of path.segments){
  if(segment.kind==='line'&&covers){const u=unit(segment.a,segment.b),a=add(segment.a,u,-vehicle.rearOverhang-margin),b=add(segment.b,u,vehicle.wheelbase+vehicle.frontOverhang+margin),half=vehicle.width/2+margin;
   const ring:XY[]=[[a[0]-u[1]*half,a[1]+u[0]*half],[b[0]-u[1]*half,b[1]+u[0]*half],[b[0]+u[1]*half,b[1]-u[0]*half],[a[0]+u[1]*half,a[1]-u[0]*half],[a[0]-u[1]*half,a[1]+u[0]*half]];
   if(!covers(ring))return false;from+=segment.length;continue;
  }
  const n=Math.max(1,Math.ceil(segment.length/.5));for(let i=0;i<=n;i++){
   const pose=sampleMotion(path,from+segment.length*i/n),corners=bodyCorners(pose,vehicle,margin);
   for(let j=1;j<corners.length;j++){const a=corners[j-1],b=corners[j],steps=Math.max(1,Math.ceil(distance(a,b)/.5));for(let k=0;k<=steps;k++)if(!contains(a[0]+(b[0]-a[0])*k/steps,a[1]+(b[1]-a[1])*k/steps))return false;}
   for(let d=-vehicle.rearOverhang;d<=vehicle.wheelbase+vehicle.frontOverhang;d+=.5)if(!contains(pose.point[0]+pose.dir[0]*d,pose.point[1]+pose.dir[1]*d))return false;
  }from+=segment.length;
 }return true;
}
/** Машины замд нум тааруулахын өмнө нэг метрээс бага жижиг хугарлыг арилгана.
 * Бүтэн оврыг хучилтаар тусад нь шалгана; хадгалсан замын тэнхлэг өөрчлөгдөхгүй. */
export function laneMotion(path:XY[],radius:number):MotionPath|null{
 const original=filletMotion(path,radius);if(original)return original;
 const simplify=(p:XY[],tolerance:number):XY[]=>{if(p.length<3)return p;const a=p[0],b=p.at(-1)!,dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;let max=0,index=0;for(let i=1;i<p.length-1;i++){const t=l2?Math.max(0,Math.min(1,((p[i][0]-a[0])*dx+(p[i][1]-a[1])*dy)/l2)):0,d=distance(p[i],[a[0]+dx*t,a[1]+dy*t]);if(d>max){max=d;index=i;}}return max<=tolerance?[a,b]:[...simplify(p.slice(0,index+1),tolerance).slice(0,-1),...simplify(p.slice(index),tolerance)];};
 for(const tolerance of [.05,.2,.5,1]){const result=filletMotion(simplify(path,tolerance),radius);if(result)return result;}return null;
}
