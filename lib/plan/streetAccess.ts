// Shared access openings for the flat street layers and the close-range 3D mesh.
import * as differenceOperator from '@arcgis/core/geometry/operators/differenceOperator';
import type Polyline from '@arcgis/core/geometry/Polyline';
import {P,L,area,bbox,bufPath,bufPoly,diff,inside,inter,orientedRect,unionAll,type Rings,type XY} from './geom';
import {modelSurface,type StreetModel,type StreetPiece,type StreetView,type StreetLine} from './streetModel';
import type {LaneKind} from './streetSection';
import type {CourtyardAccess} from './urbanCourtyardAccess';

export type StreetAccess=CourtyardAccess&{road:string};
const models=new WeakMap<StreetModel,WeakMap<StreetAccess[],StreetModel>>();
const views=new WeakMap<StreetView,WeakMap<StreetAccess[],StreetView>>();
const overlaps=(a:ReturnType<typeof bbox>,b:ReturnType<typeof bbox>)=>a.x0<=b.x1&&a.x1>=b.x0&&a.y0<=b.y1&&a.y1>=b.y0;

/** Continuous coloured foot/cycle crossings, with no upright curb across the vehicle route. */
function additions(accesses:StreetAccess[]):StreetPiece[]{
 const pieces:StreetPiece[]=[];
 for(const a of accesses){
  pieces.push({layer:'surface',k:'courtyard-access',surface:'dark_asphalt',raised:false,rings:a.rings,road:a.road});
  if(a.curbReturns?.length){
   const rings=diff(bufPath(a.curbReturns,.1),a.rings);
   if(rings.length)pieces.push({layer:'curb',k:'access-return',surface:'light_concrete',raised:true,rings,road:a.road});
  }
  const start=a.path[0],end=a.path.at(-1);if(!start||!end)continue;
  const length=Math.hypot(end[0]-start[0],end[1]-start[1]);if(length<.1)continue;
  const u:XY=[(end[0]-start[0])/length,(end[1]-start[1])/length],v:XY=[u[1],-u[0]];
  const at=(s:number,t:number):XY=>[start[0]+u[0]*s+v[0]*t,start[1]+u[1]*s+v[1]*t];
  let first=Infinity;
  for(const c of a.crossings){
   const rings=inter(c.rings,a.rings);if(!rings.length)continue;
   pieces.push({layer:'ground',k:c.k==='bike'?'bike':'sidewalk',surface:c.k==='bike'?'red_asphalt':'light_concrete',raised:false,rings,road:a.road});
   const stations=rings.flat().map(p=>(p[0]-start[0])*u[0]+(p[1]-start[1])*u[1]),lo=Math.min(...stations),hi=Math.max(...stations);first=Math.min(first,lo);
   const paint:Rings[]=[];
   if(c.k==='bike'){
    for(const s of [lo+.12,hi-.12])for(let t=-a.width/2+.2;t<a.width/2-.2;t+=1.2)paint.push([orientedRect(at(s,t+.35),v,.7,.16)]);
   }else for(let t=-a.width/2+.55;t<a.width/2-.25;t+=1)paint.push([orientedRect(at((lo+hi)/2,t),u,Math.max(.2,hi-lo-.4),.45)]);
   const marks=inter(unionAll(paint),rings);if(marks.length)pieces.push({layer:'paint',k:'access-crossing',surface:'light_concrete',raised:false,rings:marks,road:a.road});
  }
  // Outgoing cars yield before crossing either the footway or cycleway.
  if(first>1&&Number.isFinite(first)){
   const rings=inter([orientedRect(at(first-.8,a.width/4),v,a.width/2-.4,.35)],a.rings);
   if(rings.length)pieces.push({layer:'paint',k:'access-stop',surface:'light_concrete',raised:false,rings,road:a.road});
  }
 }
 return pieces;
}

export function streetAccessModel(model:StreetModel,accesses:StreetAccess[]):StreetModel{
 if(!accesses.length)return model;
 let cache=models.get(model);if(!cache){cache=new WeakMap();models.set(model,cache);}const previous=cache.get(accesses);if(previous)return previous;
 const cuts=accesses.map(a=>({rings:a.rings,box:bbox(a.rings)}));
 const near=(rings:Rings)=>{if(!rings.length)return[];const box=bbox(rings);return cuts.filter(c=>overlaps(box,c.box)).map(c=>c.rings);};
 const cut=(rings:Rings)=>{const found=near(rings);return found.length?diff(rings,unionAll(found)):rings;};
 const pieces=model.pieces.flatMap(p=>{
  if(!['ground','curb','box','overlay','paint'].includes(p.layer))return[p];
  const rings=cut(p.rings);return rings.length?[rings===p.rings?p:{...p,rings}]:[];
 });
 pieces.push(...additions(accesses));
 const lines:StreetLine[]=model.lines.flatMap(l=>{
  const found=near([l.path]);if(!found.length)return[l];
  const geometry=differenceOperator.execute(L([l.path]),P(unionAll(found))) as Polyline|null;
  return(geometry?.paths as XY[][]|undefined)?.map(path=>({...l,path}))??[];
 });
 const clear=unionAll(accesses.map(a=>bufPoly(a.rings,.35))),carClear=bufPoly(clear,2.3);
 const fixtures=model.fixtures.filter(f=>!inside(f.x,f.y,f.k==='vehicle'?carClear:clear));
 const result={...model,pieces,lines,fixtures};
 let surface:Rings|undefined;
 Object.defineProperty(result,'surface',{get:()=>surface??=(unionAll([modelSurface(model),...accesses.map(a=>a.rings)])),enumerable:false});
 cache.set(accesses,result);return result;
}

/** The same correction also applies to the compact saved/live street representation. */
export function streetAccessView(view:StreetView,accesses:StreetAccess[]):StreetView{
 if(!accesses.length)return view;
 let cache=views.get(view);if(!cache){cache=new WeakMap();views.set(view,cache);}const previous=cache.get(accesses);if(previous)return previous;
 const road=accesses[0].road,make=(layer:StreetPiece['layer'],rings:Rings,surface:StreetPiece['surface']='dark_asphalt',raised=false,k:string=layer):StreetPiece=>({layer,rings,surface,raised,k,road});
 const original:StreetModel={surface:view.surface,junctions:[],pieces:[make('surface',view.surface),make('corner',view.corners),make('curb',view.curbs,'light_concrete',true),make('paint',view.areas,'light_concrete'),
  ...view.overlays.map(o=>make('overlay',o.rings,o.surface)),...view.ground.map(g=>make('ground',g.rings,g.surface,g.raised,g.k)),...view.boxes.map(b=>({...make('box',b.rings,'light_concrete',true),h:b.h}))],
  lines:view.markingLines??view.lines.map(path=>({path,road,edge:!view.laneLines.includes(path)})),fixtures:view.fixtures,perRoad:{},issues:view.issues};
 const adjusted=streetAccessModel(original,accesses),of=(layer:StreetPiece['layer'])=>adjusted.pieces.filter(p=>p.layer===layer&&p.rings.length);
 const result:StreetView={...view,surface:adjusted.surface,overlays:of('overlay').map(p=>({rings:p.rings,surface:p.surface})),corners:unionAll(of('corner').map(p=>p.rings)),
  ground:of('ground').map(p=>({k:p.k as LaneKind,surface:p.surface,raised:p.raised,rings:p.rings})),curbs:unionAll(of('curb').map(p=>p.rings)),boxes:of('box').map(p=>({rings:p.rings,h:p.h??1})),
  lines:adjusted.lines.map(l=>l.path),markingLines:adjusted.lines,laneLines:adjusted.lines.filter(l=>!l.edge).map(l=>l.path),areas:unionAll(of('paint').map(p=>p.rings)),fixtures:adjusted.fixtures,
  quantities:{...view.quantities,accessM2:accesses.reduce((n,a)=>n+area(a.rings),0)}};
 cache.set(accesses,result);return result;
}
