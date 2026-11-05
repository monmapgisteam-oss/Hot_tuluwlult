// Бөөрөлжүүтийн facilitySite.ts, corridors.ts, industrialNetworks.ts-ээс зөөсөн хандах зам ба бохирын трасс.
import {designRadius,MIN_TURN_RADIUS} from './roadAlignment';
import {area,bufPath,bufPoly,diff,dist,inside,inter,unionAll,type Path,type Rings,type XY} from './geom';
import {boundaryMask} from './planBoundary';
import {routeTerrain,uniqueRouteLength,terrainSegmentMaxGrade} from './terrainRoute';
import {buildPlanningSuitability,blocksProfile,planningContains,planningRoutingCost,planningElevation,type PlanningSuitability} from './planningSuitability';
import {drainageField,drainagePoint,traceDrainage} from './terrainDrainage';
import type {Terminal,Source} from './sharedUtilityGraph';
import type {Dem} from './dem';

export type Net={dem:Dem;boundary:Rings;suitability?:PlanningSuitability;exist?:Path[];roads?:{path:Path}[]};
const accessSuitability=new WeakMap<Net,PlanningSuitability>();
function accessContext(net:Net){if(net.suitability)return net.suitability;let context=accessSuitability.get(net);if(!context){context=buildPlanningSuitability({dem:net.dem,boundary:net.boundary,roads:[...(net.exist??[]),...(net.roads??[]).map(r=>r.path)]});accessSuitability.set(net,context);}return context;}
export function maxDeflection(path:XY[]){let max=0;for(let i=1;i<path.length-1;i++){const u=[path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]],v=[path[i+1][0]-path[i][0],path[i+1][1]-path[i][1]],l=Math.hypot(u[0],u[1])*Math.hypot(v[0],v[1]);if(l>1e-9)max=Math.max(max,Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/l)))*180/Math.PI);}return max;}
export function accessRoute(start:XY,target:XY,net:Net,obstacles:Rings,allowed:Rings,halfWidth=4,maxGrade=8,options:{maxKinkDeg?:number}={}):XY[]{
 const length=dist(start,target);if(!Number.isFinite(length)||length<.001)return[];
 const suitability=accessContext(net),profile=halfWidth<=1?'utility':'road';
 const costAt=(p:XY)=>planningRoutingCost(suitability,p,profile);
 const restrictions=suitability.restrictions.filter(r=>!r.profiles||r.profiles.includes(profile));
 const intersectsRestriction=(surface:Rings)=>restrictions.some(r=>r.rings.length&&area(inter(surface,r.rings))>.01);
 // Шууд коридор нь хил, саад, DEM налуугаар бүрэн зөв бол торны шатлал хэрэггүй.
 const direct=bufPath([[start,target]],halfWidth);
 if(terrainSegmentMaxGrade(net.dem,start,target)<=maxGrade+.00001&&area(diff(direct,allowed))<.01&&(!obstacles.length||area(inter(direct,obstacles))<.01)&&!intersectsRestriction(direct)){
  let valid=true,minCost=Infinity,maxCost=0;const count=Math.max(1,Math.ceil(length/5));let previous=start;
  for(let i=0;i<=count;i++){const point:XY=[start[0]+(target[0]-start[0])*i/count,start[1]+(target[1]-start[1])*i/count],a=planningElevation(net.dem,...point),b=planningElevation(net.dem,...previous),grade=i&&a!=null&&b!=null?Math.abs(a-b)/dist(point,previous)*100:0,cost=costAt(point);if(a==null||b==null||!Number.isFinite(grade)||grade>maxGrade||!Number.isFinite(cost)){valid=false;break;}minCost=Math.min(minCost,cost);maxCost=Math.max(maxCost,cost);previous=point;}
  // ТААМАГЛАЛ: зөвхөн жигд, бага өртөгтэй коридорт шууд холбоос; ялгаатай эрсдэлийг A* харьцуулна.
  if(valid&&maxCost<=1.8&&maxCost-minCost<=.1)return[start,target];
 }
 const pad=length>2000?250:100,width=Math.abs(target[0]-start[0])+pad*2,height=Math.abs(target[1]-start[1])+pad*2;
 // Урт хотын холбоос 2 км дээр тасрахгүй. Нүдний тоог хязгаарлана;
 // энэ нь DEM-ийн эх нягтралыг нэмэгдүүлэхгүй.
 const cell=Math.max(length>2000?10:5,Math.ceil(Math.sqrt(width*height/250000)/5)*5),x0=Math.floor((Math.min(start[0],target[0])-pad)/cell)*cell,y0=Math.floor((Math.min(start[1],target[1])-pad)/cell)*cell;
 const nx=Math.ceil((Math.max(start[0],target[0])+pad-x0)/cell)+1,ny=Math.ceil((Math.max(start[1],target[1])+pad-y0)/cell)+1;
 const d={x0,y0,nx,ny,cell,z:new Float64Array(nx*ny)},mask=boundaryMask(d,allowed,halfWidth),costSurface=new Float64Array(nx*ny).fill(Infinity);
 const frame:Rings=[[[x0,y0],[x0,y0+ny*cell],[x0+nx*cell,y0+ny*cell],[x0+nx*cell,y0],[x0,y0]]];
 const allObstacles=restrictions.length?unionAll([obstacles,...restrictions.map(r=>r.rings)]):obstacles;
 const localObstacles=allObstacles.length?inter(allObstacles,frame):[];
 const block=localObstacles.length?bufPoly(localObstacles,halfWidth+cell/Math.SQRT2):[];
 for(let k=0;k<mask.length;k++){const x=x0+k%nx*cell,y=y0+Math.floor(k/nx)*cell,z=planningElevation(net.dem,x,y);d.z[k]=z??NaN;if(z==null||block.length&&planningContains(block,x,y))mask[k]=0;if(mask[k]){const cost=costAt([x,y]);if(!Number.isFinite(cost))mask[k]=0;else costSurface[k]=cost;}}
 // Хандах зам: 20 км/ц-ийн тооцооны радиус; явган/шугамын нарийн коридорт жижиг радиус.
 // Эхлэл/төгсгөлийн цэгийг трассын тэгшлэлтэд оруулна: холболтын богино хугарал муруйгаар шийдэгдэнэ.
 const result=routeTerrain(d,mask,start,target,{maxGrade,costSurface,exactEndpoints:true,smooth:halfWidth>1.5?{radius:designRadius(20),minRadius:MIN_TURN_RADIUS}:{radius:3,minRadius:1}});if(result.status!=='ok')return [];
 const path=result.path,surface=bufPath([path],halfWidth);
 // Задгай газрын хандах зам: муруйгүй их хугарал (өндөрлөг дээрх 2–4 м радиустай зигзаг) байж болохгүй — дуудагч өөр хувилбар туршина.
 // Үйлдвэрийн талбайн дотоод эргэлтийг industrialTurningAprons тусад нь шийддэг тул энд хязгаарлахгүй.
 if(options.maxKinkDeg!=null&&maxDeflection(path)>options.maxKinkDeg)return [];
 if(area(diff(surface,allowed))>0.01||obstacles.length&&area(inter(surface,obstacles))>0.01||intersectsRestriction(surface))return [];
 for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i];if(terrainSegmentMaxGrade(net.dem,a,b)>maxGrade+.00001)return[];const count=Math.max(1,Math.ceil(dist(a,b)/Math.min(5,net.dem.cell/2)));let previous=a;for(let j=1;j<=count;j++){const p:XY=[a[0]+(b[0]-a[0])*j/count,a[1]+(b[1]-a[1])*j/count],za=planningElevation(net.dem,...previous),zb=planningElevation(net.dem,...p),len=dist(previous,p);if(za==null||zb==null||len>.0001&&Math.abs(zb-za)/len*100>maxGrade+1e-6||!Number.isFinite(costAt(p)))return[];previous=p;}}
 return path;
}
export function restrictCorridorMask(dem:Dem,input:Uint8Array,excluded:Rings,halfWidth:number){
 const mask=input.slice(),blocked=excluded.length?bufPoly(excluded,halfWidth+dem.cell/Math.SQRT2):[];
 if(blocked.length)for(let k=0;k<mask.length;k++)if(mask[k]&&inside(dem.x0+k%dem.nx*dem.cell,dem.y0+Math.floor(k/dem.nx)*dem.cell,blocked))mask[k]=0;
 return mask;
}
export function terrainSewerPaths(terminals:Terminal[],net:Net,boundary:Rings,obstacles:Rings){
 const excluded=unionAll([obstacles,...(net.suitability?.restrictions??[]).filter(r=>blocksProfile(r,'utility')).map(r=>r.rings)]);
 const mask=restrictCorridorMask(net.dem,boundaryMask(net.dem,boundary,.75),excluded,.75);
 const costs=net.suitability?Float64Array.from(mask,(valid,k)=>valid?planningRoutingCost(net.suitability!,drainagePoint(net.dem,k),'utility'):Infinity):undefined;
 const field=drainageField(net.dem,mask,costs),paths:XY[][]=[],sources:Source[]=[],used=new Set<number>();
 for(const t of terminals.filter(t=>t.load>0)){
  // Терминалын нарийн вектор холболтыг шалгана; DEM-ийн тор дээр зүгээр шилжүүлэхгүй.
  const col=Math.round((t.point[0]-net.dem.x0)/net.dem.cell),row=Math.round((t.point[1]-net.dem.y0)/net.dem.cell),nearby:{k:number;d:number}[]=[];
  // Холболтын ойр нүдийг орон нутгийн хүрээнээс авна; барилга бүрт бүтэн DEM-ийг эрэмбэлэхгүй.
  for(let radius=1;radius<=8&&nearby.length<12;radius++)for(let y=row-radius;y<=row+radius;y++)for(let x=col-radius;x<=col+radius;x++){
   if(radius>1&&Math.abs(x-col)<radius&&Math.abs(y-row)<radius||x<0||y<0||x>=net.dem.nx||y>=net.dem.ny)continue;
   const k=y*net.dem.nx+x;if(Number.isFinite(field.cost[k]))nearby.push({k,d:dist(t.point,drainagePoint(net.dem,k))});
  }
  const candidates=nearby.sort((a,b)=>a.d-b.d).slice(0,12);
  for(const {k}of candidates){const p=drainagePoint(net.dem,k),link=dist(t.point,p)<.001?[t.point]:accessRoute(t.point,p,net,excluded,boundary,.75,25);if(!link.length)continue;
   const route=[...link,...traceDrainage(field,k).slice(1)];
   paths.push(route);used.add(field.owner[k]);break;
  }
 }
 for(const id of used)sources.push({id:`sewer:collection-${id+1}`,point:drainagePoint(net.dem,field.outlets[id])});
 return{paths,sources};
}
