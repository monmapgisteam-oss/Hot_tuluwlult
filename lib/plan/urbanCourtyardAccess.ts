// Recover an existing courtyard driveway and join it to the actual adjacent carriageway.
// Buildings are evidence/obstacles only; this pass never regenerates a lot or a building.
import {add,area,bufPath,bufPoly,clipPath,diff,dot,inside,inter,labelPt,mul,norm,orientedRect,parts,perp,sub,unionAll,type Path,type Rings,type XY} from './geom';
import type {MarkF,ParkingSpace,TreeF,Report} from './rules';

export type CourtyardAccess={lot:number;width:number;path:Path;rings:Rings;street:number;crossings:{k:'walk'|'sidewalk'|'bike';rings:Rings}[];curbReturns?:Path[];roadId?:string};
export type CourtyardAccessRoad={id:number;path:Path;road:number;carriage:number;median:number;ext?:boolean};
type Surface={rings:Rings;k:string;lot?:number};
type AccessScene={base:Surface[];over:Surface[];streets:Surface[];bldgs?:{rings:Rings;lot?:number;use?:string;kind?:string}[];marks?:MarkF[];parkingSpaces?:ParkingSpace[];trees?:TreeF[];lights?:XY[];rep?:Report;accesses?:CourtyardAccess[]};
const WIDTH=6,ROAD_OVERLAP=.75;
const strip=(a:XY,b:XY,width=WIDTH):Rings=>[orientedRect(mul(add(a,b),.5),norm(sub(b,a)),Math.hypot(...sub(b,a)),width)];
const significant=(r:Rings)=>area(r)>.002;

/** A parking entrance is a small T junction: both returns are tangent to the driveway
 * and the actual carriageway edge. The Street_Modern alley preset uses R = 4 m.
 * Reduce that radius only to keep the opening inside the existing public corridor. */
function entranceReturns(edge:XY,inward:XY,carriage:Rings,radius:number):{rings:Rings;curbReturns:Path[]}|null{
 let tangent:XY|undefined,best=.1;
 for(const ring of carriage)for(let i=1;i<ring.length;i++){
  const a=ring[i-1],b=ring[i],d=sub(b,a),length=Math.hypot(...d);if(length<.01)continue;
  const t=Math.max(0,Math.min(1,dot(sub(edge,a),d)/(length*length))),distance=Math.hypot(...sub(edge,add(a,mul(d,t))));
  if(distance<best){best=distance;tangent=mul(d,1/length);}
 }
 if(!tangent)return null;
 const side=perp(inward),curbReturns:Path[]=[],patches:Rings[]=[],mouth:XY[]=[];
 for(const sign of [-1,1]){
  const street=dot(tangent,mul(side,sign))>0?tangent:mul(tangent,-1),alpha=Math.acos(Math.max(-1,Math.min(1,dot(street,inward))));
  if(alpha<Math.PI/6||alpha>5*Math.PI/6)return null;
  const edgePoint=add(edge,mul(side,sign*WIDTH/2)),den=inward[0]*street[1]-inward[1]*street[0];
  const v=sub(edge,edgePoint),along=(v[0]*street[1]-v[1]*street[0])/den,corner=add(edgePoint,mul(inward,along));
  const setback=radius/Math.tan(alpha/2),onStreet=add(corner,mul(street,setback)),onDrive=add(corner,mul(inward,setback));
  const center=add(corner,mul(norm(add(street,inward)),radius/Math.sin(alpha/2))),a0=Math.atan2(onStreet[1]-center[1],onStreet[0]-center[0]);
  let sweep=Math.atan2(onDrive[1]-center[1],onDrive[0]-center[0])-a0;
  while(sweep>Math.PI)sweep-=2*Math.PI;while(sweep< -Math.PI)sweep+=2*Math.PI;
  const steps=Math.max(2,Math.ceil(Math.abs(sweep)/(Math.PI/36))),arc:Path=Array.from({length:steps+1},(_,i)=>i===0?onStreet:i===steps?onDrive:[center[0]+radius*Math.cos(a0+sweep*i/steps),center[1]+radius*Math.sin(a0+sweep*i/steps)]);
  patches.push([[corner,...arc,corner]]);curbReturns.push(arc);mouth.push(onStreet);
 }
 const overlap:Rings=[[mouth[0],mouth[1],add(mouth[1],mul(inward,-ROAD_OVERLAP)),add(mouth[0],mul(inward,-ROAD_OVERLAP)),mouth[0]]];
 // Do not open onto a median, a road end, or a different side of a curved junction.
 if(area(diff(overlap,carriage))>.03)return null;
 return{rings:unionAll([...patches,overlap]),curbReturns};
}

/** All masks are real metre-scale polygons. Source arrays/records remain unchanged. */
export function refreshCourtyardAccess<T extends AccessScene>(scene:T,roads:CourtyardAccessRoad[]):T&{accesses:CourtyardAccess[]}{
 const accesses:CourtyardAccess[]=[],asphalt=unionAll(scene.streets.filter(s=>s.k==='road').map(s=>s.rings));
 if(!roads.length||!asphalt.length)return{...scene,accesses:scene.accesses??[]};
 const targets=roads.filter(r=>!r.ext&&r.path.length>1).map(road=>({road,rings:inter(bufPath([road.path],road.carriage),asphalt)}));
 const parking=unionAll(scene.over.filter(s=>s.k==='parking').map(s=>s.rings));
 const walks=unionAll([...scene.base,...scene.over].filter(s=>s.k==='walk').map(s=>s.rings));
 const obstacles=unionAll((scene.bldgs??[]).map(b=>b.rings)),clearance=obstacles.length?bufPoly(obstacles,.25):[];
 const lots=scene.base.filter(s=>s.k==='grass'&&s.rings.length).flatMap((surface,index)=>parts(surface.rings).map(rings=>({rings,lot:surface.lot||index+1})));
 for(const lot of lots){
  const lotParking=inter(parking,lot.rings);if(area(lotParking)<40)continue;
  const paved=unionAll([lotParking,inter(walks,lot.rings)]);
  let best:CourtyardAccess|undefined,bestDistance=Infinity;
  // A driveway must already meet the lot boundary at its full six-metre width. Nearby bays
  // or an arbitrary building gap do not authorize inventing a new route across the lot.
  const contact=bufPoly(lotParking,.025);
  for(const ring of lot.rings)for(let i=1;i<ring.length;i++){
   const a=ring[i-1],b=ring[i],u=norm(sub(b,a));if(Math.hypot(...sub(b,a))<WIDTH-.05)continue;
   for(const edge of clipPath([[a,b]],contact)){
    const first=edge[0],last=edge[edge.length-1],length=Math.hypot(...sub(last,first));if(length<WIDTH-.08)continue;
    const c=mul(add(first,last),.5),left=perp(u),inward=inside(...add(c,mul(left,.15)),lot.rings)?left:mul(left,-1);
    // Follow contiguous existing parking, allowing only a real facade walk to cross it.
    const inwardRay:Path=[c,add(c,mul(inward,60))];
    const spans=clipPath([inwardRay],lotParking).map(path=>path.map(p=>dot(sub(p,c),inward))).map(ds=>[Math.min(...ds),Math.max(...ds)]).sort((p,q)=>p[0]-q[0]);
    let reach=0;
    for(const [start,end]of spans){
     if(start>reach+.08){if(start-reach>3.15||significant(diff(strip(add(c,mul(inward,reach)),add(c,mul(inward,start)),WIDTH-.1),walks)))break;}
     reach=Math.max(reach,end);
    }
    if(reach<4)continue;
    const start=add(c,mul(inward,Math.max(3,reach-.5))),insideRoute=strip(start,c,WIDTH-.08);
    if(significant(diff(insideRoute,paved))||significant(inter(insideRoute,clearance)))continue;
    const ray:Path=[c,add(c,mul(inward,-40))];
    for(const target of targets){
     const entries=clipPath([ray],target.rings).flatMap(path=>[path[0],path[path.length-1]]).map(p=>-dot(sub(p,c),inward)).filter(d=>d>=-.05&&d<32);
     if(!entries.length)continue;
     const distance=Math.max(0,Math.min(...entries));if(distance>=bestDistance)continue;
     const end=add(c,mul(inward,-distance-ROAD_OVERLAP));let route=strip(start,end),curbReturns:Path[]=[];
     if(area(inter(route,target.rings))<WIDTH*.35||significant(inter(route,clearance)))continue;
     // The connector may use only this lot and the verified public street corridor.
     const authorized=unionAll([lot.rings,...scene.streets.map(s=>s.rings)]);
     if(area(diff(route,authorized))>.03)continue;
     const edge=add(c,mul(inward,-distance));
     for(const radius of [4,3,2]){
      const returns=entranceReturns(edge,inward,target.rings,radius);if(!returns)continue;
      if(significant(inter(returns.rings,clearance))||area(diff(returns.rings,authorized))>.03||area(diff(inter(returns.rings,lot.rings),paved))>.03)continue;
      route=unionAll([route,returns.rings]);curbReturns=returns.curbReturns;break;
     }
     const crossings:CourtyardAccess['crossings']=[];
     for(const k of ['walk','sidewalk','bike'] as const){
      const surface=k==='walk'?walks:unionAll(scene.streets.filter(s=>s.k===k).map(s=>s.rings));
      const rings=inter(route,surface);if(significant(rings))crossings.push({k,rings});
     }
     best={lot:lot.lot,width:WIDTH,path:[start,end],rings:route,street:target.road.id,crossings,...(curbReturns.length?{curbReturns}:{})};bestDistance=distance;
    }
   }
  }
  if(best)accesses.push(best);
 }
 if(!accesses.length)return{...scene,accesses};
 const route=unionAll(accesses.map(a=>a.rings)),streetArea=unionAll(scene.streets.map(s=>s.rings));
 const publicCut=inter(bufPoly(route,.5),streetArea),verge=inter(route,unionAll(scene.streets.filter(s=>s.k==='verge').map(s=>s.rings)));
 // Remove obsolete asphalt painted over foot/cycle paths and street parking that blocks the
 // entrance. The paths themselves retain their geometry and are explicit at-grade crossings.
 let removed=0;const restored=new Map<string,number>();
 const over=scene.over.flatMap(surface=>{
  if(surface.k!=='parking')return[surface];
  const rings=diff(surface.rings,publicCut),delta=area(surface.rings)-area(rings);if(delta<=.002)return[surface];
  removed+=delta;
  const gone=inter(surface.rings,publicCut);
  for(const k of ['sidewalk','bike','verge']){const amount=area(inter(gone,unionAll(scene.streets.filter(s=>s.k===k).map(s=>s.rings))));restored.set(k,(restored.get(k)??0)+amount);}
  return rings.length?[{...surface,rings}]:[];
 });
 if(significant(verge))over.push({rings:verge,k:'parking',lot:0});
 const clear=bufPoly(route,.4),hit=(p:XY)=>inside(...p,clear);
 const parkingSpaces=scene.parkingSpaces?.filter(b=>{
  const angle=b.heading*Math.PI/180,u:XY=[Math.cos(angle),-Math.sin(angle)];
  return!significant(inter([orientedRect([b.x,b.y],u,b.width,b.length)],clear));
 });
 const marks=scene.marks?.filter(m=>m.k!=='stall'||!hit(labelPt(m.rings))),trees=scene.trees?.filter(t=>!hit([t.x,t.y])),lights=scene.lights?.filter(p=>!hit(p));
 const rep=scene.rep?{...scene.rep}:undefined;
 if(rep){
  rep['g.parking']=(rep['g.parking']??0)-removed+area(verge);
  for(const [k,value]of restored)rep[`g.${k}`]=(rep[`g.${k}`]??0)+value;
  rep['g.verge']=(rep['g.verge']??0)-area(verge);
  if(parkingSpaces)rep.stalls=(rep.stalls??scene.parkingSpaces!.length)+parkingSpaces.length-scene.parkingSpaces!.length;
  if(trees)rep.trees=(rep.trees??scene.trees!.length)+trees.length-scene.trees!.length;
  if(lights)rep.lights=(rep.lights??scene.lights!.length)+lights.length-scene.lights!.length;
 }
 return{...scene,over:over as T['over'],accesses,...(parkingSpaces?{parkingSpaces}:{}),...(marks?{marks}:{}),...(trees?{trees}:{}),...(lights?{lights}:{}),...(rep?{rep}:{})};
}
