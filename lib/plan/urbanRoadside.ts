import {add,along,bbox,bufPoly,clipPath,dist,inside,mul,norm,pathLength,perp,sub,unionAll,type Path,type Rings,type XY} from './geom';
import type {Street} from './layout';
import type {Scene,TreeF} from './rules';

export type RoadsideCorridor={street:Street;carriage:number;verge:number;median?:number;road?:number;sep?:number};
export type RoadsideJunction={x:number;y:number;r:number};
type RoadsideScene=Pick<Scene,'streets'|'base'|'over'|'marks'|'trees'|'stops'|'lights'|'rep'>&{bldgs?:{rings:Rings}[]};
type Surface={rings:Rings;box:ReturnType<typeof bbox>};
const boxed=(rings:Rings):Surface=>({rings,box:bbox(rings)});
function segmentDistance(p:XY,a:XY,b:XY){const dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
function nearby(s:Surface,p:XY,r=0){const b=s.box;return p[0]>=b.x0-r&&p[0]<=b.x1+r&&p[1]>=b.y0-r&&p[1]<=b.y1+r;}
function nearBoundary(rings:Rings,p:XY,r:number){for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++)if(segmentDistance(p,ring[j],ring[i])<r)return true;return false;}
function touches(s:Surface,p:XY,r:number){return nearby(s,p,r)&&(inside(...p,s.rings)||nearBoundary(s.rings,p,r));}
function contains(s:Surface,p:XY,r=0){return nearby(s,p)&&inside(...p,s.rings)&&(!r||!nearBoundary(s.rings,p,r));}
function offset(path:Path,d:number):Path{return path.map((p,i)=>add(p,mul(perp(norm(sub(path[Math.min(i+1,path.length-1)],path[Math.max(0,i-1)]))),d)));}
function station(path:Path,p:XY){let best=Infinity,value=0,at=0;for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy),t=l?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(l*l))):0,d=Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);if(d<best){best=d;value=at+t*l;}at+=l;}return value;}

/** Native roadside vegetation and lights share a metric station rhythm. Only
 * corridor points are replaced; courtyard furniture, routes and surfaces keep
 * their source geometry. The same deterministic pass serves saved and live plans. */
export function coordinateRoadside<T extends RoadsideScene>(scene:T,corridors:RoadsideCorridor[],junctions:RoadsideJunction[]=[]):T{
 const streetSurfaces=(scene.streets??[]).filter(s=>s.rings.length).map(s=>boxed(s.rings));
 const verges=(scene.streets??[]).filter(s=>s.k==='verge'&&s.rings.length).map(s=>boxed(s.rings));
 if(!corridors.length||!verges.length)return scene;
 const inStreet=(p:XY)=>streetSurfaces.some(s=>contains(s,p));
 const oldTrees=scene.trees??[],oldLights=scene.lights??[],report=scene.rep??{};
 const trees:TreeF[]=oldTrees.filter(t=>!inStreet([t.x,t.y]));
 const lights:XY[]=oldLights.filter(p=>!inStreet(p));
 const originalTrees=trees.length,originalLights=lights.length;
 const ground=[...(scene.base??[]),...(scene.over??[])];
 const obstacleKinds=new Set(['walk','plaza','parking','play','sand','court','sport','track','yard','road','sidewalk','bike']);
 const obstacles=ground.filter(s=>obstacleKinds.has(s.k)&&s.rings.length).map(s=>boxed(s.rings));
 const buildings=(scene.bldgs??[]).filter(b=>b.rings.length).map(b=>boxed(b.rings));
 const crossings=(scene.marks??[]).filter(m=>m.k==='cross'&&m.rings.length).map(m=>boxed(m.rings));
 // Extend actual paths/driveway mouths through the verge, preserving access
 // without inventing a pedestrian crossing at every building or parking bay.
 const accessGround=ground.filter(s=>s.k==='walk'||s.k==='parking'&&(s.lot!==0||s.rings.some(r=>r.some(p=>!inStreet(p))))).map(s=>s.rings);
 const access=accessGround.length?bufPoly(unionAll(accessGround),.35):[];
 const source=corridors.filter(c=>!c.street.ext&&c.street.path.length>1&&c.verge>=.5);
 const layouts=source.map(c=>{
  const entrances=new Map<number,[number,number][]>();
  for(const sign of [-1,1]){
   const ranges: [number,number][]=[];
   if(access.length)for(const path of clipPath([offset(c.street.path,sign*(c.street.w/2-.05))],access)){
    const positions=path.map(p=>station(c.street.path,p));ranges.push([Math.min(...positions)-2,Math.max(...positions)+2]);
   }
   entrances.set(sign,ranges);
  }
  return{...c,length:pathLength(c.street.path),entrances};
 });
 const allowed=(p:XY,r:number,c:RoadsideCorridor,t:number,sign:number,entrances:Map<number,[number,number][]>)=>{
  if(!verges.some(s=>contains(s,p,r+.12)))return false;
  if(obstacles.some(s=>touches(s,p,r+.35))||buildings.some(s=>touches(s,p,r+1)))return false;
  if(crossings.some(s=>touches(s,p,r+2.5)))return false;
  if(junctions.some(n=>Math.hypot(n.x-p[0],n.y-p[1])<n.r+8+r))return false;
  if((entrances.get(sign)??[]).some(([a,b])=>t>=a-r&&t<=b+r))return false;
  if((scene.stops??[]).some(q=>dist(p,q)<r+6))return false;
  // Saved plans need no graph reconstruction: keep an open approach where
  // another actual street crosses or joins this corridor.
  for(const other of corridors){if(other.street===c.street||other.street.id===c.street.id)continue;const limit=other.street.w/2+4+r;for(let i=1;i<other.street.path.length;i++)if(segmentDistance(p,other.street.path[i-1],other.street.path[i])<limit)return false;}
  return true;
 };
 // Canopies remain within green land (including parking bulb-outs); a slim
 // 2.2–3 m crown reads as a maintained street tree instead of an 8 m green ball.
 for(const c of layouts){
  const rows:{offset:number;width:number;sign:number}[]=[];
  if(c.verge>=2.5)for(const sign of [-1,1])rows.push({offset:sign*(c.carriage+c.verge/2),width:c.verge,sign});
  for(const row of rows){const radius=Math.min(1.5,Math.max(1.1,row.width/2-.3));
   for(let t=8;t<c.length-5;t+=16){const {pt,dir}=along(c.street.path,t);
    const shifts=row.sign&&c.verge>=5?[row.offset,row.sign*(c.carriage+c.verge-radius-.3)]:[row.offset];
    for(const d of shifts){const p=add(pt,mul(perp(dir),d));if(!allowed(p,radius,c,t,row.sign,c.entrances))continue;
     if(trees.some(q=>Math.hypot(q.x-p[0],q.y-p[1])<q.r+radius+2))continue;
     trees.push({x:p[0],y:p[1],t:1,h:4.7+((Math.round(t/16)+c.street.id)%3)*.3,r:radius});break;
    }
   }
  }
 }
 // Lamps fall between tree stations. The narrow local separator receives
 // poles only, keeping both its cycle and pedestrian paths unobstructed.
 for(const c of layouts)for(const sign of c.street.cls==='local'?[1]:[-1,1]){
  const d=sign*(c.carriage+(c.verge>=1.5?c.verge-.6:c.verge/2));
  for(let t=16+(sign<0?16:0);t<c.length-5;t+=32){const {pt,dir}=along(c.street.path,t),p=add(pt,mul(perp(dir),d));
   if(!allowed(p,.2,c,t,sign,c.entrances))continue;
   if(trees.some(q=>Math.hypot(q.x-p[0],q.y-p[1])<q.r+2.4))continue;
   if(lights.some(q=>dist(p,q)<8))continue;
   lights.push(p);
  }
 }
 const rep={...report,trees:(report.trees??oldTrees.length)-oldTrees.length+trees.length,lights:(report.lights??oldLights.length)-oldLights.length+lights.length};
 // Preserve object identity if no native corridor points were present or fit.
 if(originalTrees===oldTrees.length&&originalLights===oldLights.length&&trees.length===originalTrees&&lights.length===originalLights)return scene;
 return{...scene,trees,lights,rep};
}
