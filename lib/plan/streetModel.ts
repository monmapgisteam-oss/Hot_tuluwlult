// Гудамжны нарийвчилсан загвар — Streets CGA (Esri) дүрмийг замын тэнхлэг + эгнээний огтлол дээр геометр болгон хэрэгжүүлнэ.
// Хучилт (roadContext.surface) ба хөдөлгөөний сүлжээг өөрчлөхгүй: зөвхөн дүрслэл, тоо хэмжээ, CityEngine экспорт.
// Бүх хотын асфальтаар том boolean үйлдэл хийхгүй: тэнхлэг бүрийн зурвасыг уулзвар бүрийн орон нутгийн геометрээр хайчилна.
import Point from '@arcgis/core/geometry/Point';
import type Polyline from '@arcgis/core/geometry/Polyline';
import * as containsOperator from '@arcgis/core/geometry/operators/containsOperator';
import * as differenceOperator from '@arcgis/core/geometry/operators/differenceOperator';
import {P,L,bufPath,bufPoly,unionAll,diff,inter,area,simplify,inside,bbox,parts,circle,orientedRect,rng,type Rings,type XY} from './geom';
import {offsetPath,samplePath,pathLength,alignedWith,validRoads,heightAtPoint,isCarRoad,type Road} from './roadGeometry';
import {roadContext,slicePath,type RoadContext} from './roadContext';
import {roadEngineContext} from './roadEngineModel';
import {COLORS as ENGINE_COLORS,type Feature as EngineFeature} from './roadEngine';
import {CGA,LANE_KINDS,LAMPS,PLANTS,FURNITURE,CLASS_LABEL,CLASS_RANK,SYMBOLS,SURFACES,VEHICLE_DENSITY,VEHICLE_ASSETS,PLANT_BEDS,GROUND_COVER,boundaryMarking,laneSymbol,parkingAcross,parkingAlong,sectionForRoad,sectionLayout,validateSection,
 type LaneKind,type LaneSlot,type LaneSymbol,type Marking,type MarkingColor,type PlantType,type StreetClass,type StreetSection,type Surface} from './streetSection';

/** Хадгалсан тэмдэглэгээний давхаргын хувилбар (street_v талбар). Хуучин хадгалалтыг runtime-д дахин үүсгэнэ. */
export const STREET_MODEL_VERSION=2;
/** ТААМАГЛАЛ: хашлагын булангийн радиус, м (замын ангиллаар; хоёр замын ихийг нь). ШАЛГАХ: БНбД — уулзварын хашлагын радиус.
 * Ачааны машины бүтэн оврын эргэлтийг turnSurface / cityTurning тусад нь шалгана; энэ нь дүрслэл ба тоо хэмжээ. */
export const KERB_RADIUS:Record<StreetClass,number>={'urban-local':6,'urban-collector':8,'urban-arterial':10,industrial:12,connector:12,'service-track':8};
export const CORNER_RADIUS=Math.max(...Object.values(KERB_RADIUS));
/** surface = тэнхлэг бүрийн хучилт (дугуй төгсгөлтэй буфер); box = h өндөртэй хайрцаг (ваар, Planter.cga). */
/** deck = гүүр / өндөрлөсөн замын бүтэн өргөний ул мөр (Road.elevation; streetMesh хана, доод тал, хашлага хийнэ). */
export type StreetPiece={layer:'surface'|'overlay'|'ground'|'curb'|'paint'|'corner'|'box'|'deck';k:string;surface:Surface;raised:boolean;rings:Rings;road:string;h?:number;color?:MarkingColor};
/** glyph = 3D-д ESRI.lib-ийн glb (StreetFixture k='symbol')-ээр орлох 2D тэмдэг (сум, BUS, STOP). */
export type StreetLine={path:XY[];road:string;edge:boolean;color?:MarkingColor;glyph?:boolean;width?:number};
export type FixtureKind='tree'|'lamp'|'bollard'|'bench'|'table'|'bike-rack'|'trash'|'vehicle'|'symbol'|'plant';
/** asset = ESRI.lib/assets-аас харьцангуй glb («{rep}» = Vegetation_Representation). z = газраас дээш, м. */
export type StreetFixture={k:FixtureKind;x:number;y:number;heading:number;style:string;type:string;h:number;d:number;road:string;asset?:string;z?:number};
export type StreetModel={surface:Rings;junctions:Rings;pieces:StreetPiece[];lines:StreetLine[];fixtures:StreetFixture[];
 /** Тэнхлэг эзэмшсэн замын ID-ээр: урт, эгнээний км, гарц, зогсох шугам, зогсоол */
 perRoad:Record<string,Record<string,number>>;issues:string[]};
/** full: суурьшлын гудамжны явган/ногоон зурвас, модыг мөн runtime-д үүсгэнэ.
 * Гарцын будаг нь хоёр горимд энэ загварт харьяалагдана; хуучин rules.ts гарцыг давхар зурахгүй. */
export type StreetModelOptions={full?:boolean};
export type StreetOptions={contextRoads?:Road[];boundary?:Rings;obstacles?:Rings;full?:boolean};

const distance=(a:XY,b:XY)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const unit=(a:XY,b:XY):XY=>{const l=distance(a,b)||1;return[(b[0]-a[0])/l,(b[1]-a[1])/l];};
/** offsetPath: эерэг = баруун. Тэнхлэгийн дагуу x0..x1 зурвас (хавтгай төгсгөлтэй). */
export function band(path:XY[],x0:number,x1:number):Rings{
 if(path.length<2||!(x1>x0))return[];const a=offsetPath(path,x0),b=offsetPath(path,x1).reverse();
 return simplify([[...a,...b,a[0]]]);
}
function sliceBand(path:XY[],atEnd:boolean,from:number,to:number,x0:number,x1:number){
 const len=pathLength(path);return atEnd?band(slicePath(path,len-to,len-from),x0,x1):band(slicePath(path,from,to),x0,x1);
}
function tester(rings:Rings){
 if(!rings.length)return()=>false;const g=P(rings);containsOperator.accelerateGeometry(g);
 return(x:number,y:number)=>containsOperator.execute(g,new Point({x,y,spatialReference:g.spatialReference}));
}
/** Жижиг орон нутгийн полигонд ray-casting (ArcGIS дуудлагагүй). */
function localTester(rings:Rings){if(!rings.length)return()=>false;const b=bbox(rings);return(x:number,y:number)=>x>=b.x0&&x<=b.x1&&y>=b.y0&&y<=b.y1&&inside(x,y,rings);}
/** Шугамаас полигоныг хасна (differenceOperator). */
function cutPaths(paths:XY[][],rings:Rings):XY[][]{
 if(!paths.length||!rings.length)return paths;const g=differenceOperator.execute(L(paths),P(rings)) as Polyline|null;
 return(g?.paths??[]).map(p=>p.map(q=>[q[0],q[1]] as XY));
}
const pose=(path:XY[],s:number)=>{const p=samplePath(path,s);return{point:p.point as XY,dir:p.dir as XY,right:[p.dir[1],-p.dir[0]] as XY};};
const at=(path:XY[],s:number,x:number):XY=>{const p=pose(path,s);return[p.point[0]+p.right[0]*x,p.point[1]+p.right[1]*x];};
/** ArcGIS heading: хойдоос цагийн зүүний дагуу, градус. */
const heading=(v:XY)=>((Math.atan2(v[0],v[1])*180/Math.PI)+360)%360;
const hash=(s:string)=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;};
/** Битүү тэнхлэг (тойрог)-ийн offset: эхлэл/төгсгөлийн оройг хөршөөр нь тооцно. */
function offsetClosed(path:XY[],x:number):XY[]{const n=path.length-1,ext=[path[n-1],...path.slice(0,n),path[0],path[1]],o=offsetPath(ext,x).slice(1,n+1);return[...o,o[0]];}
const signedArea=(r:XY[])=>r.slice(1).reduce((s,p,i)=>s+(r[i][0]*p[1]-p[0]*r[i][1]),0)/2;

/** Line_Marking.cga: Continuous / Dashed / давхар (Line_Width .15, Line_Distance .15, Dash 3, Gap 3). xs = огтлолын координат. */
function markingPaths(path:XY[],len:number,xs:number,style:Marking,toAxis:(x:number)=>number):XY[][]{
 if(style==='none')return[];
 const step=CGA.lineWidth/2+CGA.lineDistance/2,double=style.includes('double')||style.includes('+');
 const parts:[number,'continuous'|'dashed'][]=!double?[[xs,style as 'continuous'|'dashed']]:
  style==='continuous-double'?[[xs-step,'continuous'],[xs+step,'continuous']]:style==='dashed-double'?[[xs-step,'dashed'],[xs+step,'dashed']]:
  style==='dashed+continuous'?[[xs-step,'dashed'],[xs+step,'continuous']]:[[xs-step,'continuous'],[xs+step,'dashed']];
 const out:XY[][]=[];
 for(const [x,kind] of parts){const line=offsetPath(path,toAxis(x));
  if(kind==='continuous'){out.push(line);continue;}
  for(let from=2;from<len-2;from+=CGA.dash+CGA.gap){const to=Math.min(from+CGA.dash,len-2);if(to-from>.5)out.push(slicePath(line,from,to));}
 }
 return out;
}
export type ArrowKind='straight'|'left'|'right'|'left-only'|'right-only';
/** Чиглэлийн сум (Street_Modern_Standard «arrows on …» текстурын санаа): шулуун ± зүүн/баруун, зөвхөн эргэх. */
function arrow(c:XY,u:XY,kind:ArrowKind):XY[][]{
 const l:XY=[-u[1],u[0]],p=(a:number,b:number):XY=>[c[0]+u[0]*a+l[0]*b,c[1]+u[1]*a+l[1]*b];
 if(kind==='left-only'||kind==='right-only'){const s=kind==='left-only'?1:-1,end=p(1.1,1.3*s);return[[p(-2,0),p(.2,0),p(.8,.6*s),end],[p(.3,1.35*s),end,p(1.2,.55*s)]];}
 const tip=p(2,0),out:XY[][]=[[p(-2,0),tip],[p(1,-.7),tip,p(1,.7)]];
 if(kind!=='straight'){const s=kind==='left'?1:-1,end=p(.9,1.1*s);out.push([p(-.4,0),p(.2,.6*s),end],[p(.2,1.2*s),end,p(.9,.3*s)]);}
 return out;
}
/** Энгийн шугаман үсэг (нэгж хайрцаг 0..1): замын тэмдэг (BUS, LANE, ONLY, POOL, TAXI, STOP). */
const GLYPHS:Record<string,XY[][]>={
 A:[[[0,0],[.5,1],[1,0]],[[.25,.5],[.75,.5]]],B:[[[0,0],[0,1],[.75,1],[1,.8],[.75,.55],[0,.55]],[[.75,.55],[1,.3],[.75,0],[0,0]]],E:[[[1,1],[0,1],[0,0],[1,0]],[[0,.5],[.7,.5]]],I:[[[.5,0],[.5,1]]],
 L:[[[0,1],[0,0],[1,0]]],N:[[[0,0],[0,1],[1,0],[1,1]]],O:[[[.2,0],[0,.2],[0,.8],[.2,1],[.8,1],[1,.8],[1,.2],[.8,0],[.2,0]]],P:[[[0,0],[0,1],[.75,1],[1,.8],[1,.65],[.75,.45],[0,.45]]],
 S:[[[1,1],[.2,1],[0,.8],[.2,.55],[.8,.45],[1,.2],[.8,0],[0,0]]],T:[[[0,1],[1,1]],[[.5,1],[.5,0]]],U:[[[0,1],[0,.15],[.2,0],[.8,0],[1,.15],[1,1]]],X:[[[0,0],[1,1]],[[0,1],[1,0]]],Y:[[[0,1],[.5,.5],[1,1]],[[.5,.5],[.5,0]]],
};
/** Үгсийг жолоочийн уншиx дарааллаар (эхний үг ойр) зам дагуу сунгасан үсгээр: 0.6 × 2.4 м. */
function words(c:XY,u:XY,text:string[]):XY[][]{
 const r:XY=[u[1],-u[0]],p=(x:number,y:number):XY=>[c[0]+r[0]*x+u[0]*y,c[1]+r[1]*x+u[1]*y],W=.6,H=2.4,gap=.25,lineGap=1.2,out:XY[][]=[];
 const total=text.length*H+(text.length-1)*lineGap;
 text.forEach((word,k)=>{const y0=-total/2+k*(H+lineGap),width=word.length*W+(word.length-1)*gap;
  [...word].forEach((ch,i)=>{for(const s of GLYPHS[ch]??[])out.push(s.map(([x,y])=>p(-width/2+i*(W+gap)+x*W,y0+y*H)));});});
 return out;
}
/** Lane_Symbol.cga-ийн тэмдэг (USDOT glb-ийн оронд шугаман загвар). */
function laneSymbolLines(c:XY,u:XY,kind:LaneSymbol):XY[][]{
 const r:XY=[u[1],-u[0]],p=(x:number,y:number):XY=>[c[0]+r[0]*x+u[0]*y,c[1]+r[1]*x+u[1]*y];
 if(kind==='bike'){const ring=(cx:number,cy:number)=>Array.from({length:13},(_,i)=>p(cx+.35*Math.cos(i*Math.PI/6),cy+.35*Math.sin(i*Math.PI/6)));return[ring(0,-.6),ring(0,.6),[p(0,-.6),p(0,0),p(0,.6)],[p(0,0),p(.35,.15),p(0,.6)]];}
 return words(c,u,kind==='bus'?['BUS']:kind==='bus-lane'?['BUS','LANE']:kind==='bus-only'?['BUS','ONLY']:kind==='pool'?['POOL']:['TAXI']);
}
/** ESRI.lib glb-ийн бодит урт (м; asset bounds, Marking_*.glb). */
const SYMBOL_LENGTH:Record<LaneSymbol,number>={none:0,bike:1.98,bus:2.4,'bus-lane':6.3,'bus-only':6.1,pool:2.4,taxi:2.74};
/** Zebra_Crossing.cga: Bar_Width 1.0, Gap_Width 0.8, Margin_Along 0.3 — зам дагуу тэгш өнцөгтүүд. */
function zebra(path:XY[],atEnd:boolean,s:number,w:number,x0:number,x1:number,bar:number=CGA.zebra.bar,gap:number=CGA.zebra.gap){
 const bars:Rings=[],{margin}=CGA.zebra;
 for(let x=x0+margin;x+bar<=x1-margin+1e-6;x+=bar+gap)bars.push(...sliceBand(path,atEnd,s,s+w,x,x+bar));
 return bars;
}
/** Street_Modern_Standard.cga Crosswalk(type): continental / ladder / transverse / dashed / solid. s = уулзвараас эхлэх зай. */
function crosswalk(type:StreetSection['crossing'],path:XY[],atEnd:boolean,s:number,w:number,x0:number,x1:number):Rings{
 const {ladder,transverse,dashed}=CGA.crosswalkLines,edges=(d:number)=>[...sliceBand(path,atEnd,s,s+d,x0,x1),...sliceBand(path,atEnd,s+w-d,s+w,x0,x1)];
 switch(type){
  case 'solid':return sliceBand(path,atEnd,s,s+w,x0,x1);
  case 'transverse':return edges(transverse);
  case 'ladder':return[...edges(ladder),...zebra(path,atEnd,s+ladder,w-2*ladder,x0,x1)];
  // CrosswalkStripes(0.6): ирмэгийн 0.17 м-т 0.6 м-ийн тасархай.
  case 'dashed':return[...zebra(path,atEnd,s,dashed,x0,x1,.6,.6),...zebra(path,atEnd,s+w-dashed,dashed,x0,x1,.6,.6)];
  default:return zebra(path,atEnd,s,w,x0,x1);
 }
}
/** Lane_Fill_Pattern.cga: Framed (Line_Width хүрээ), Lines Along/Accross, Diagonal ±45°, Cross, Arrow (33°, алхам 0.35·өргөн). */
function fillPattern(path:XY[],len:number,x0:number,x1:number,fill:string):{lines:XY[][];solid:Rings}{
 const lw=CGA.fill.lineWidth,out:XY[][]=[],w=x1-x0;if(fill==='none'||w<=2*lw)return{lines:[],solid:[]};
 if(fill==='solid')return{lines:[],solid:band(path,x0,x1)};
 const a=x0+lw/2,b=x1-lw/2,s0=1+lw/2,s1=len-1-lw/2;if(s1<=s0)return{lines:[],solid:[]};
 const line=(p:XY[])=>out.push(p);
 // Хүрээ: хоёр урт ирмэг + хоёр төгсгөл.
 line(slicePath(offsetPath(path,a),s0,s1));line(slicePath(offsetPath(path,b),s0,s1));line([at(path,s0,a),at(path,s0,b)]);line([at(path,s1,a),at(path,s1,b)]);
 const step=CGA.fill.distance+lw,tan=Math.tan(CGA.fill.angle*Math.PI/180),shift=(b-a)/tan;
 if(fill==='across'||fill==='cross')for(let d=s0+step;d<s1-lw;d+=step)line([at(path,d,a),at(path,d,b)]);
 if(fill==='along'||fill==='cross')for(let x=a+step;x<b-lw;x+=step)line(slicePath(offsetPath(path,x),s0,s1));
 const diag=(back:boolean)=>{for(let d=s0;d+shift<=s1;d+=step/Math.sin(CGA.fill.angle*Math.PI/180))line([at(path,d,back?b:a),at(path,d+shift,back?a:b)]);};
 if(fill==='diagonal-forward'||fill==='diagonal-cross')diag(false);if(fill==='diagonal-backward'||fill==='diagonal-cross')diag(true);
 if(fill==='arrow-forward'||fill==='arrow-backward'){const sign=fill==='arrow-forward'?1:-1,stepA=Math.max(.5,CGA.fill.arrowStep*w),rise=(b-a)/2*Math.tan(CGA.fill.arrow*Math.PI/180),xc=(a+b)/2;
  for(let d=s0+rise;d<s1-rise;d+=stepA)line([at(path,d-sign*rise,a),at(path,d,xc),at(path,d-sign*rise,b)]);}
 return{lines:out,solid:[]};
}
/** Хоёр шулууны огтлолцол p + u·t = q + v·s. */
function intersectLines(p:XY,u:XY,q:XY,v:XY):XY|null{const c=u[0]*v[1]-u[1]*v[0];if(Math.abs(c)<1e-9)return null;const t=((q[0]-p[0])*v[1]-(q[1]-p[1])*v[0])/c;return[p[0]+u[0]*t,p[1]+u[1]*t];}
/** Уулзварын (junction) хүрээнээс гарах зай: тэнхлэг ба хоёр ирмэг бүгд гадна. */
function exitDistance(path:XY[],atEnd:boolean,half:number,inJ:(x:number,y:number)=>boolean,limit:number){
 const len=pathLength(path);
 for(let d=0;d<=limit;d+=.25){const s=atEnd?len-d:d;if([-half,0,half].every(x=>{const q=at(path,s,x);return!inJ(q[0],q[1]);}))return d;}
 return null;
}
/** Хашлагатай талбай (Curbed_Area.cga): гадна цагирагаас 0.1 м-ийн хашлага. */
const curbRing=(rings:Rings)=>diff(rings,bufPoly(rings,-CGA.curbWidth));
const square=(c:XY,u:XY,size:number):XY[]=>{const r:XY=[u[1],-u[0]],h=size/2,p=(a:number,b:number):XY=>[c[0]+u[0]*a+r[0]*b,c[1]+u[1]*a+r[1]*b];return[p(-h,-h),p(h,-h),p(h,h),p(-h,h),p(-h,-h)];};
const plantAsset=(type:PlantType)=>`Webstyles/Vegetation/{rep}/${PLANTS[type].latin}.glb`;

type Side={x0:number;x1:number;kind:LaneKind;surface:Surface;raised:boolean};
type Arm={axis:number;atEnd:boolean;path:XY[];half:number;median:number;carriage:Rings;sides:Side[];length:number;u:XY};
type NodeLocal={J:Rings;arms:Arm[];corners:Rings;others:Map<number,Rings>;road:string};

/** Уулзварын ойртолт бүр: гол бус (зогсох шугамтай) эсэх. Түлхүүр `${axis}|${atEnd}`. Тэнцүү зэрэглэлд хамгийн шулуун хос нь гол зам. */
export function junctionApproaches(ctx:RoadContext,classOf:(i:number)=>StreetClass=i=>sectionForRoad(ctx.sources[i]).cls){
 const byNode=new Map<number,{axis:number;atEnd:boolean;rank:number;dir:XY}[]>(),out=new Map<string,{node:number;minor:boolean}>();
 ctx.ends.forEach((e,i)=>{const p=ctx.canonical[i].path;for(const [node,atEnd] of [[e.start,false],[e.end,true]] as const){if(node<0||ctx.graph.adj[node].length<3||p.length<2)continue;const l=byNode.get(node)??[];l.push({axis:i,atEnd,rank:CLASS_RANK[classOf(i)],dir:atEnd?unit(p.at(-2)!,p.at(-1)!):unit(p[1],p[0])});byNode.set(node,l);}});
 for(const [node,list] of byNode){const max=Math.max(...list.map(x=>x.rank)),top=list.filter(x=>x.rank===max);let major=new Set(top);
  if(top.length>2){let best:[number,number]=[0,1],dot=Infinity;for(let a=0;a<top.length;a++)for(let b=a+1;b<top.length;b++){const d=top[a].dir[0]*top[b].dir[0]+top[a].dir[1]*top[b].dir[1];if(d<dot){dot=d;best=[a,b];}}major=new Set([top[best[0]],top[best[1]]]);}
  for(const x of list)out.set(`${x.axis}|${x.atEnd}`,{node,minor:!major.has(x)});}
 return out;
}
const models=new WeakMap<Road[],Map<string,WeakMap<Rings|object,StreetModel>>>(),NO_OBSTACLES={};
// Засварын үед зөвхөн өөрчлөгдсөн уулзвар/тэнхлэгийг дахин тооцох кэш (worker амьд байх хугацаанд).
type NodeCached={arms:Pick<Arm,'path'|'half'|'carriage'|'sides'|'length'|'u'>[];others:Rings[];corners:Rings;pieces:StreetPiece[]};
type AxisCached={pieces:StreetPiece[];lines:StreetLine[];fixtures:StreetFixture[];perRoad:Record<string,number>;issues:string[]};
const nodeCache=new Map<string,NodeCached>(),axisCache=new Map<string,AxisCached>(),obstacleIds=new WeakMap<object,number>();let obstacleSeq=0;
const pathKey=(p:XY[])=>p.map(q=>`${Math.round(q[0]*100)},${Math.round(q[1]*100)}`).join(';');
const trim=<K,V>(m:Map<K,V>,n:number)=>{if(m.size>n)m.clear();};
const turnKeys=new WeakMap<Rings,number>();
function turnKey(rings:Rings|undefined){if(!rings?.length)return 0;let value=turnKeys.get(rings);if(value!=null)return value;let h=2166136261;for(const ring of rings){h=Math.imul(h^ring.length,16777619);for(const p of ring)for(const v of p)h=Math.imul(h^Math.round(v*1000),16777619);}value=h>>>0;turnKeys.set(rings,value);return value;}
/** Үр дүнд нөлөөлөх замын шинж (геометрээс бусад). */
const roadKey=(r:Road)=>JSON.stringify([r.id,r.width,r.lanes,r.median??0,r.speed,r.use,r.section??null,r.elevation??null,r.turnPolicy??null,turnKey(r.turnSurface),r.engineMode??null,r.cornerRadius??null]);

/** Adapt the guide's polygons to the existing tiled/PBR renderer. Winding is
 * normalized at this boundary; the original roadEngine source is untouched. */
function engineRings(f:EngineFeature):Rings {
 if(f.geometry.type!=='Polygon')return[];
 return f.geometry.coordinates.filter(r=>r.length>=4&&r.every(p=>p.every(Number.isFinite))).map((ring,i)=>signedArea(ring)*(i===0?1:-1)>0?[...ring].reverse():ring);
}
function appendEngineFeatures(target:Pick<StreetModel,'pieces'|'lines'|'fixtures'>,features:EngineFeature[],road:string,urban:boolean,inObstacle:(x:number,y:number)=>boolean){
 for(const f of features){const p=f.properties,g=f.geometry;
  if(g.type==='Polygon'){
   const rings=engineRings(f);if(!rings.length)continue;
   const paint=['marking','crosswalk','stopline','arrow'].includes(p.layer),ground=p.layer==='surface'&&p.height>0||p.layer==='island';
   if(ground&&urban)continue;
   const byColor=(Object.keys(SURFACES) as Surface[]).find(s=>SURFACES[s].color===p.color);
   const surface:Surface=byColor??(p.kind==='median'?'dark_concrete':p.kind==='vegetation'||p.layer==='island'?'grass':p.height>0?'light_concrete':p.color===ENGINE_COLORS.redAsphalt?'red_asphalt':p.color===ENGINE_COLORS.greenAsphalt?'green_asphalt':'dark_asphalt');
   const layer:StreetPiece['layer']=paint?'paint':p.layer==='curb'?'curb':p.layer==='junction'?'corner':ground?p.height>.2?'box':'ground':surface==='dark_asphalt'?'surface':'overlay';
   target.pieces.push({layer,k:p.kind==='median'?'vegetation':p.kind??p.layer,surface,raised:p.height>0,rings,road,...(paint?{color:p.color===ENGINE_COLORS.yellow?'yellow' as const:'white' as const}:{}),...(p.height>.2?{h:p.height}:{})});
  }else if(g.type==='Point'){
   const [x,y]=g.coordinates;if(inObstacle(x,y))continue;const heading=(90-(p.rotation??0)+360)%360;
   if(p.layer==='symbol'){
    const a=(p.rotation??0)*Math.PI/180,u:XY=[Math.cos(a),Math.sin(a)],paths=p.kind==='stop'?words([x,y],u,['STOP']):laneSymbolLines([x,y],u,p.kind==='bike'?'bike':'bus');
    target.lines.push(...paths.map(path=>({path,road,edge:false})));continue;
   }
   if(p.layer!=='item'||urban)continue;
   const k=p.kind as FixtureKind;if(!['tree','lamp','bench','bollard','bike-rack'].includes(k))continue;
   const style=k==='tree'?PLANTS.Basswood.webStyle:k==='lamp'?LAMPS.simple.webStyle:k==='bench'?FURNITURE.bench.webStyle:k==='bike-rack'?FURNITURE['bike-rack'].webStyle:'cylinder';
   const h=k==='tree'?7:k==='lamp'?8:k==='bench'?.45:k==='bollard'?1:.8,d=k==='tree'?3:k==='lamp'||k==='bollard'?.2:k==='bench'?1.8:1.5;
   target.fixtures.push({k,x,y,heading,style,type:k,h,d,road,z:p.base,...(k==='tree'?{asset:plantAsset('Basswood')}:k!=='bollard'?{asset:`Webstyles/StreetScene/${style}.glb`}:{})});
  }
 }
}
// Rebuilt campus roads already carry their checked truck-turn pavement. Keep
// their restrained two-way markings separate from a generic complete street.
const fittedCampusRoad=(r:Road)=>r.use==='industrial'&&r.section?.source==='design'&&r.section.cls==='industrial'&&r.section.crossing==='none'&&r.section.lanes.length===2&&r.section.lanes.every(l=>l.kind==='car'&&l.raised===false);
/** One painted boundary follows the designed pavement through junction returns.
 * Per-arm offsets would leave internal stripes across the widened T mouths. */
function campusEdgeLines(model:StreetModel,ctx:RoadContext){
 const ids=new Set(ctx.roads.filter(fittedCampusRoad).map(r=>r.id));if(!ids.size)return;
 const pavement=unionAll(model.pieces.filter(p=>ids.has(p.road)&&(p.layer==='surface'||p.layer==='corner')).map(p=>p.rings));
 const other=unionAll(model.pieces.filter(p=>!ids.has(p.road)&&(p.layer==='surface'||p.layer==='corner')).map(p=>p.rings));
 const paths=cutPaths(bufPoly(pavement,-.35),other.length?bufPoly(other,.1):[]);
 // An overlapping through road may own the canonical axis. The campus source
 // still owns its supplied turn pavement and needs a stable paint owner.
 const segments=ctx.roads.filter(r=>ids.has(r.id)).flatMap(r=>r.path.slice(1).map((b,k)=>({a:r.path[k],b,road:r.id})));
 const owner=(p:XY)=>{let best=Infinity,road=segments[0]?.road??'';for(const s of segments){const dx=s.b[0]-s.a[0],dy=s.b[1]-s.a[1],l2=dx*dx+dy*dy;if(!l2)continue;const t=Math.max(0,Math.min(1,((p[0]-s.a[0])*dx+(p[1]-s.a[1])*dy)/l2)),d=(p[0]-s.a[0]-t*dx)**2+(p[1]-s.a[1]-t*dy)**2;if(d<best){best=d;road=s.road;}}return road;};
 for(const path of paths){const chunks:{road:string;path:XY[]}[]=[];
  for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i];if(distance(a,b)<1e-6)continue;const road=owner([(a[0]+b[0])/2,(a[1]+b[1])/2]),last=chunks.at(-1);if(last?.road===road)last.path.push(b);else chunks.push({road,path:[a,b]});}
  if(chunks.length>1&&chunks[0].road===chunks.at(-1)!.road&&distance(chunks[0].path[0],chunks.at(-1)!.path.at(-1)!)<1e-5){chunks[0].path=[...chunks.pop()!.path,...chunks[0].path.slice(1)];}
  for(const line of chunks)if(pathLength(line.path)>.01)model.lines.push({...line,edge:true,width:.2});
 }
}
/** Хотын бүх замаар нэг удаа тооцоод кэшлэнэ (roads массивын identity-ээр). */
export function streetModel(input:Road[],obstacles?:Rings,options:StreetModelOptions={}):StreetModel{
 let byMode=models.get(input);if(!byMode){byMode=new Map();models.set(input,byMode);}
 const mode=options.full?'full':'saved';let byObstacle=byMode.get(mode);if(!byObstacle){byObstacle=new WeakMap();byMode.set(mode,byObstacle);}
 const key=obstacles?.length?obstacles:NO_OBSTACLES,old=byObstacle.get(key);if(old)return old;
 const model=build(roadContext(input),obstacles??[],!!options.full);addPaths(model,validRoads(input).filter(r=>!isCarRoad(r)),roadContext(input));byObstacle.set(key,model);return model;
}

function build(ctx:RoadContext,obstacles:Rings,full:boolean):StreetModel{
 const model={pieces:[],lines:[],fixtures:[],perRoad:{},issues:[]} as unknown as StreetModel;
 // Turn pavement belongs to its source road, independently of which road wins
 // a coincident canonical axis or which rendering engine handles that axis.
 // Workers transfer pieces, not the lazy combined surface getter below.
 for(const road of ctx.roads)if(road.turnSurface?.length)model.pieces.push({layer:'surface',k:'turn',surface:'dark_asphalt',raised:false,rings:road.turnSurface,road:road.id});
 const engine=roadEngineContext(ctx);
 // surface/junctions: бүх хотын нэгтгэл — хэрэгтэй үед л (enumerable биш тул worker-ээс илгээгдэхгүй; streetView нөхнө).
 let surface:Rings|undefined,junctions:Rings|undefined;
 Object.defineProperty(model,'surface',{get:()=>surface??=engine.junctions.size||engine.axes.size?unionAll([ctx.surface,...model.pieces.filter(p=>p.layer==='surface'||p.layer==='corner').map(p=>p.rings)]):ctx.surface,enumerable:false});Object.defineProperty(model,'junctions',{get:()=>junctions??=engine.junctions.size?unionAll([...ctx.nodeJunctions].map(([n,r])=>engine.junctions.get(n)?.features.filter(f=>f.properties.layer==='junction').flatMap(engineRings)??r)):ctx.junctions,enumerable:false});
 if(!ctx.canonical.length)return model;
 const obstacleToken=obstacles.length?(obstacleIds.get(obstacles)??(obstacleIds.set(obstacles,++obstacleSeq),obstacleSeq)):0;
 const graph=ctx.graph,inObstacle=tester(obstacles),serviceOpening=localTester(ctx.serviceOpenings),issues=new Set<string>(),pieces=model.pieces,lines=model.lines,fixtures=model.fixtures;
 const add=(road:string,k:string,v:number)=>{const r=model.perRoad[road]??={};r[k]=(r[k]??0)+v;};
 const axes=ctx.canonical.map((r,i)=>{const src=ctx.sources[i],section=sectionForRoad(src),layout=sectionLayout(section),al=alignedWith(src.path,r.path);
  return{r,src,section,layout,al,len:pathLength(r.path),half:layout.width/2,toAxis:(x:number)=>al?x:-x,X:(s:LaneSlot):[number,number]=>al?[s.x0,s.x1]:[-s.x1,-s.x0]};});
 const campusTurns=ctx.roads.some(r=>fittedCampusRoad(r)&&r.turnSurface?.length);
 // Уулзвар бүрийн орон нутгийн геометр: залгаа тэнхлэгүүдийн эхний хэсэг (хавтгай төгсгөлтэй зурвас).
 const locals=new Map<number,NodeLocal>();
 ctx.ends.forEach((e,i)=>{for(const [node,atEnd] of [[e.start,false],[e.end,true]] as const){if(node<0||graph.adj[node].length<3)continue;
  let local=locals.get(node);if(!local){local={J:ctx.nodeJunctions.get(node)??[],arms:[],corners:[],others:new Map(),road:axes[i].src.id};locals.set(node,local);}
  local.arms.push({axis:i,atEnd,path:[],half:axes[i].half,median:axes[i].layout.median,carriage:[],sides:[],length:0,u:[1,0]});}});
 // Саадын (барилга, PV) хэсгүүд bbox-оор: тэнхлэг/уулзвар бүрд зөвхөн ойрын хэсгийг хасна.
 const obstacleParts=parts(obstacles).map(r=>({r,b:bbox(r)}));
 const obstaclesNear=(b:{x0:number;y0:number;x1:number;y1:number}):Rings=>obstacleParts.filter(o=>o.b.x1>=b.x0&&o.b.x0<=b.x1&&o.b.y1>=b.y0&&o.b.y0<=b.y1).flatMap(o=>o.r);
 for(const [node,local] of locals){
  const nKey=JSON.stringify([graph.nodes[node].map(v=>Math.round(v*100)),full,campusTurns,obstacleToken,local.arms.map(a=>[roadKey(axes[a.axis].src),a.atEnd,pathKey(axes[a.axis].r.path)])]),hitN=nodeCache.get(nKey);
  (local as NodeLocal&{key?:string}).key=nKey;
  const engineNode=engine.junctions.get(node);
  if(!engineNode&&hitN){hitN.arms.forEach((c,k)=>Object.assign(local.arms[k],c));local.arms.forEach((a,k)=>local.others.set(a.axis,hitN.others[k]));local.corners=hitN.corners;model.pieces.push(...hitN.pieces);continue;}
  const pieces:StreetPiece[]=[];
  const centre=graph.nodes[node],reach=Math.max(...local.arms.map(a=>{const l=axes[a.axis].layout;return Math.max(Math.abs(l.outerLeft),Math.abs(l.outerRight));}))+CORNER_RADIUS+8;
  for(const arm of local.arms){const ax=axes[arm.axis],d=Math.min(reach,ax.len);arm.path=arm.atEnd?slicePath(ax.r.path,ax.len-d,ax.len).reverse():slicePath(ax.r.path,0,d);
   // Зурвасыг уулзвараас гадагш чиглэлд: тэнхлэгийн төгсгөл бол x-ийн тэмдэг солигдоно.
   const flip=arm.atEnd?-1:1;arm.carriage=band(arm.path,-arm.half,arm.half);arm.length=pathLength(arm.path);arm.u=unit(arm.path[0],arm.path[1]);
   for(const s of ax.layout.slots){if(s.carriageway)continue;const [a,b]=ax.X(s),x0=flip*a,x1=flip*b;arm.sides.push({x0:Math.min(x0,x1),x1:Math.max(x0,x1),kind:s.lane.kind,surface:s.lane.surface??LANE_KINDS[s.lane.kind].surface,raised:s.raised});}
  }
  for(const arm of local.arms)local.others.set(arm.axis,unionAll(local.arms.filter(o=>o!==arm).map(o=>o.carriage)));
  if(engineNode){
   const junction=unionAll(engineNode.features.filter(f=>f.properties.layer==='junction').map(engineRings)),footprint=unionAll(engineNode.features.filter(f=>f.geometry.type==='Polygon').map(engineRings));
   const near=obstaclesNear(bbox(footprint)),generated={pieces:[] as StreetPiece[],lines:[] as StreetLine[],fixtures:[] as StreetFixture[]};
   local.J=junction;local.corners=diff(junction,unionAll(local.arms.map(a=>a.carriage)));
   // Trim legacy side strips to the same engine mouth as an engine-mode arm.
   for(const arm of local.arms)local.others.set(arm.axis,unionAll([local.others.get(arm.axis)??[],footprint]));
   appendEngineFeatures(generated,engineNode.features,local.road,!full&&local.arms.every(a=>axes[a.axis].src.use==='residential'),inObstacle);
   for(const piece of generated.pieces){piece.rings=diff(piece.rings,near);if(piece.rings.length)model.pieces.push(piece);}
   (local as NodeLocal&{key?:string}).key=`${nKey}|${engineNode.key}`;
   continue;
  }
  // Булан (аналитик): цагийн зүүний эсрэг дараалсан хоёр салааны ирмэгийн шугамд шүргэгч R радиустай нум.
  const sorted=[...local.arms].sort((a,b)=>Math.atan2(a.u[1],a.u[0])-Math.atan2(b.u[1],b.u[0])),corners:Rings[]=[],curbs:Rings[]=[],fills:{rings:Rings;side:Side}[]=[];
  for(let k=0;k<sorted.length&&sorted.length>1;k++){
   const A=sorted[k],B=sorted[(k+1)%sorted.length];let theta=Math.atan2(B.u[1],B.u[0])-Math.atan2(A.u[1],A.u[0]);if(theta<=0)theta+=2*Math.PI;
   if(fittedCampusRoad(axes[A.axis].src)&&fittedCampusRoad(axes[B.axis].src))continue;
   if(theta>=Math.PI-.05||theta<.05)continue;
   const lA:XY=[-A.u[1],A.u[0]],rB:XY=[B.u[1],-B.u[0]],pA:XY=[centre[0]+lA[0]*A.half,centre[1]+lA[1]*A.half],pB:XY=[centre[0]+rB[0]*B.half,centre[1]+rB[1]*B.half];
   const Q=intersectLines(pA,A.u,pB,B.u);if(!Q)continue;
   const R=Math.max(KERB_RADIUS[axes[A.axis].section.cls],KERB_RADIUS[axes[B.axis].section.cls]);
   const tA=(Q[0]-pA[0])*A.u[0]+(Q[1]-pA[1])*A.u[1],tB=(Q[0]-pB[0])*B.u[0]+(Q[1]-pB[1])*B.u[1],d=R/Math.tan(theta/2);
   if(tA<-.01||tB<-.01||tA+d>A.length||tB+d>B.length)continue;
   const T1:XY=[pA[0]+A.u[0]*(tA+d),pA[1]+A.u[1]*(tA+d)],T2:XY=[pB[0]+B.u[0]*(tB+d),pB[1]+B.u[1]*(tB+d)],m=Math.hypot(A.u[0]+B.u[0],A.u[1]+B.u[1])||1;
   const C:XY=[Q[0]+(A.u[0]+B.u[0])/m*R/Math.sin(theta/2),Q[1]+(A.u[1]+B.u[1])/m*R/Math.sin(theta/2)];
   const arc=(r:number):XY[]=>{const a1=Math.atan2(T1[1]-C[1],T1[0]-C[0]);let delta=Math.atan2(T2[1]-C[1],T2[0]-C[0])-a1;while(delta>Math.PI)delta-=2*Math.PI;while(delta<-Math.PI)delta+=2*Math.PI;return Array.from({length:13},(_,j)=>[C[0]+r*Math.cos(a1+delta*j/12),C[1]+r*Math.sin(a1+delta*j/12)] as XY);};
   corners.push(simplify([[Q,...arc(R),Q]]));
   const sa=A.sides.filter(s=>s.x1<=-A.half+.01).sort((p,q)=>q.x1-p.x1)[0],sb=B.sides.filter(s=>s.x0>=B.half-.01).sort((p,q)=>p.x0-q.x0)[0];
   // Хашлага булангийн нумын дагуу (өргөгдсөн тал руу 0.1 м).
   if(sa?.raised||sb?.raised){const outer=arc(R),inner=arc(R-CGA.curbWidth).reverse();curbs.push(simplify([[...outer,...inner,outer[0]]]));}
   // Мохоо булангийн явган замын завсар: хоёр салааны гадна ирмэгийн огтлолцлоор нөхнө (суурьшилд rules.ts зурна).
   const ownGround=(i:number)=>full||axes[i].src.use!=='residential';
   if(sa?.raised&&sb?.raised&&ownGround(A.axis)&&ownGround(B.axis)){
    const wA=sa.x1-sa.x0,wB=sb.x1-sb.x0,oA:XY=[centre[0]+lA[0]*(A.half+wA),centre[1]+lA[1]*(A.half+wA)],oB:XY=[centre[0]+rB[0]*(B.half+wB),centre[1]+rB[1]*(B.half+wB)],Qo=intersectLines(oA,A.u,oB,B.u);
    if(Qo)fills.push({rings:simplify([[pA,oA,Qo,oB,pB,Q,pA]]),side:sa});}
  }
  const box={x0:centre[0]-reach,y0:centre[1]-reach,x1:centre[0]+reach,y1:centre[1]+reach},near=obstaclesNear(box),carriage=unionAll(local.arms.map(a=>a.carriage));
  local.corners=diff(diff(unionAll(corners),carriage),near);
  if(local.corners.length)pieces.push({layer:'corner',k:'corner',surface:'dark_asphalt',raised:false,rings:local.corners,road:local.road});
  const curbRings=diff(diff(unionAll(curbs),carriage),near);if(curbRings.length)pieces.push({layer:'curb',k:'curb',surface:'light_concrete',raised:true,rings:curbRings,road:local.road});
  for(const f of fills){const rings=diff(f.rings,unionAll([carriage,local.corners,near]));if(area(rings)>.5)pieces.push({layer:'ground',k:f.side.kind,surface:f.side.surface,raised:true,rings,road:local.road});}
  trim(nodeCache,6000);nodeCache.set(nKey,{arms:local.arms.map(a=>({path:a.path,half:a.half,carriage:a.carriage,sides:a.sides,length:a.length,u:a.u})),others:local.arms.map(a=>local.others.get(a.axis)??[]),corners:local.corners,pieces});
  model.pieces.push(...pieces);
 }
 const nodeOf=(i:number,atEnd:boolean)=>{const n=atEnd?ctx.ends[i].end:ctx.ends[i].start,local=locals.get(n);return local?{node:n,local}:null;};
 const junctionBoxes=[...ctx.nodeJunctions].map(([node,rings])=>locals.get(node)?.J??rings).filter(r=>r.length).map(rings=>({rings,b:bbox(rings)}));
 const roles=junctionApproaches(ctx,i=>axes[i].section.cls),minor=(_local:NodeLocal,axis:number,atEnd:boolean)=>roles.get(`${axis}|${atEnd}`)?.minor??false;
 const firstAxis=new Map<string,number>();axes.forEach((ax,i)=>{if(!firstAxis.has(ax.src.id))firstAxis.set(ax.src.id,i);});
 const nearKey=(rings:Rings)=>{const b=bbox(rings);return `${Math.round(b.x0)},${Math.round(b.y0)},${Math.round(b.x1)},${Math.round(b.y1)}`;};
 axes.forEach((ax,i)=>{
  const {r,src,section,layout,len,half,toAxis,X}=ax,path=r.path,rid=src.id;if(len<.5)return;
  const first=firstAxis.get(rid)===i,endKeys=[false,true].map(e=>{const n=nodeOf(i,e);return n?[(n.local as NodeLocal&{key?:string}).key,roles.get(`${i}|${e}`)?.minor??false]:null;});
  const aBox=bbox([path]),aPad=Math.max(Math.abs(layout.outerLeft),Math.abs(layout.outerRight))+1;
  const aKey=JSON.stringify([roadKey(src),pathKey(path),ax.al,full,obstacleToken,endKeys,[ctx.ends[i].start,ctx.ends[i].end].map(n=>n<0?0:ctx.graph.adj[n].length),ctx.ends[i].start<0&&ctx.ends[i].end<0,first?[pathKey(src.path),src.turnSurface?.length??0]:0,
   junctionBoxes.filter(j=>j.b.x1>=aBox.x0-aPad&&j.b.x0<=aBox.x1+aPad&&j.b.y1>=aBox.y0-aPad&&j.b.y0<=aBox.y1+aPad).map(j=>nearKey(j.rings))]),hitA=axisCache.get(aKey);
  if(hitA){model.pieces.push(...hitA.pieces);model.lines.push(...hitA.lines);model.fixtures.push(...hitA.fixtures);const pr=model.perRoad[rid]??={};for(const [k,v] of Object.entries(hitA.perRoad))pr[k]=(pr[k]??0)+v;for(const m of hitA.issues)issues.add(m);return;}
  const pieces:StreetPiece[]=[],lines:StreetLine[]=[],fixtures:StreetFixture[]=[],own:Record<string,number>={},axisIssues=new Set<string>();
  const add=(_road:string,k:string,v:number)=>{own[k]=(own[k]??0)+v;};
  const done=()=>{trim(axisCache,8000);axisCache.set(aKey,{pieces,lines,fixtures,perRoad:own,issues:[...axisIssues]});model.pieces.push(...pieces);model.lines.push(...lines);model.fixtures.push(...fixtures);const pr=model.perRoad[rid]??={};for(const [k,v] of Object.entries(own))pr[k]=(pr[k]??0)+v;for(const m of axisIssues)issues.add(m);};
  const engineAxis=engine.axes.get(i);
  if(engineAxis){
   appendEngineFeatures({pieces,lines,fixtures},engineAxis.features,rid,src.use==='residential'&&!full,inObstacle);
   if(obstacleParts.length){const b=bbox([path]),pad=Math.max(Math.abs(layout.outerLeft),Math.abs(layout.outerRight))+1,near=obstaclesNear({x0:b.x0-pad,y0:b.y0-pad,x1:b.x1+pad,y1:b.y1+pad});
    for(const piece of pieces)if(piece.layer==='ground'||piece.layer==='curb'||piece.layer==='box')piece.rings=diff(piece.rings,near);}
   add(rid,`len.${section.cls}`,len);
   for(const lane of engineAxis.mode.lanes)if(['car','bus','bike','parking','buffer'].includes(lane.kind))add(rid,`laneKm.${lane.kind}`,len/1000);
   if(engineAxis.mode.crosswalk!=='none')add(rid,'crosswalks',Number(engineAxis.start)+Number(engineAxis.end));
   add(rid,'stopLines',engineAxis.features.filter(f=>f.properties.layer==='stopline').length);
   add(rid,'parkingSpaces',Math.max(0,engineAxis.features.filter(f=>f.properties.kind==='parking'&&f.properties.layer==='marking').length-engineAxis.mode.lanes.filter(l=>l.kind==='parking').length));
   done();return;
  }
  for(const issue of validateSection(section,src))axisIssues.add(`${CLASS_LABEL[section.cls]}: ${issue.message}`);
  const along=(s:LaneSlot)=>(s.dir==='forward')===ax.al,urban=src.use==='residential'&&!full,campus=fittedCampusRoad(src),drive=[...layout.forward,...layout.reverse];
  const fixtureStart=fixtures.length,random=rng(hash(`${rid}|${pathKey([path[0],path.at(-1)!])}`)),closed=ctx.ends[i].start<0&&ctx.ends[i].end<0&&distance(path[0],path.at(-1)!)<.01;
  // Тэнхлэгийн хучилт (дугуй төгсгөл уулзварын төвийг нөхнө) + эх замын эргэлтийн талбай (нэг удаа).
  pieces.push({layer:'surface',k:'surface',surface:'dark_asphalt',raised:false,rings:bufPath([path],half),road:rid});
  // Гүүр / өндөрлөсөн хэсэг: бүтэн огтлолын ул мөр (тэнхлэг бүрт нэг удаа).
  if(src.elevation?.some(e=>e[1]>.3)){const a=toAxis(layout.outerLeft),b=toAxis(layout.outerRight);pieces.push({layer:'deck',k:'deck',surface:'light_concrete',raised:false,rings:band(path,Math.min(a,b),Math.max(a,b)),road:rid});}
  // Тулгуур төгсгөл (cul-de-sac): хучилтын дугуй үзүүрийг хашлага + явган замын хагас цагирагаар хүрээлнэ (хажуугийн зурвас хавтгай төгсдөг тул хөрс ил гарахгүй).
  if(!urban&&!closed&&layout.slots.some(s=>!s.carriageway&&s.raised)&&!src.elevation?.some(e=>e[1]>.3))for(const atEnd of [false,true]){const n=atEnd?ctx.ends[i].end:ctx.ends[i].start;if(n<0||ctx.graph.adj[n]?.length!==1)continue;
   const e=atEnd?path.at(-1)!:path[0],d=atEnd?unit(path.at(-2)!,e):unit(path[1],e),outer=Math.max(Math.abs(layout.outerLeft),Math.abs(layout.outerRight),half+1);
   const beyond:Rings=[orientedRect([e[0]+d[0]*outer/2,e[1]+d[1]*outer/2],d,outer+.02,2*outer+2)],cap=bufPath([path],half);
   pieces.push({layer:'ground',k:'sidewalk',surface:'light_concrete',raised:true,rings:diff(inter([circle(e,outer,32)],beyond),cap),road:rid});
   pieces.push({layer:'curb',k:'curb',surface:'light_concrete',raised:true,rings:inter(diff(bufPath([path],half+CGA.curbWidth),cap),beyond),road:rid});}
  const ends=[nodeOf(i,false),nodeOf(i,true)].filter((x):x is {node:number;local:NodeLocal}=>!!x);
  // Хайчлах полигон: бусад залгаа замын хучилт + булан; эгнээний зураасанд уулзварын талбай нэмэгдэнэ.
  // Эгнээний зураас уулзвараас 0.1 м зайтай (0.15 м будгийн хагас өргөн уулзвар руу орохгүй; өмнөх laneArea-тай ижил).
  // Уулзварын талбай салааны дагуу хөрш тэнхлэг рүү сунаж болно: тэнхлэгийн хүрээтэй огтлолцох бүх уулзварын талбайг хасна.
  const axisBox=bbox([path]),pad=Math.max(Math.abs(layout.outerLeft),Math.abs(layout.outerRight))+1,nearJ=junctionBoxes.filter(j=>j.b.x1>=axisBox.x0-pad&&j.b.x0<=axisBox.x1+pad&&j.b.y1>=axisBox.y0-pad&&j.b.y0<=axisBox.y1+pad).map(j=>j.rings);
  const others=unionAll(ends.flatMap(e=>[e.local.others.get(i)??[],e.local.corners])),laneCut=unionAll([bufPoly(others,.1),...nearJ.map(r=>bufPoly(r,.1))]);
  const nearTests=ends.map(e=>localTester(unionAll([e.local.J,e.local.others.get(i)??[],e.local.corners])));
  const blocked=(x:number,y:number)=>serviceOpening(x,y)||nearTests.some(t=>t(x,y));
  add(rid,`len.${section.cls}`,len);
  const groups=new Map<string,{piece:StreetPiece;list:Rings[]}>();
  const put=(layer:StreetPiece['layer'],k:string,surface:Surface,raised:boolean,rings:Rings,h?:number)=>{if(!rings.length)return;const key=`${layer}|${k}|${surface}|${raised}|${h??''}`,g=groups.get(key);if(g)g.list.push(rings);else groups.set(key,{piece:{layer,k,surface,raised,rings:[],road:rid,...(h?{h}:{})},list:[rings]});};
  const fixture=(f:Omit<StreetFixture,'road'>)=>{if(!blocked(f.x,f.y)&&!inObstacle(f.x,f.y))fixtures.push({...f,road:rid});};
  const groundSurface=(s:LaneSlot):Surface=>s.lane.surface??(s.lane.ground?GROUND_COVER[s.lane.ground].surface:LANE_KINDS[s.lane.kind].surface);
  for(const s of layout.slots){
   const k=s.lane.kind,surface=groundSurface(s),[x0,x1]=X(s);
   if(LANE_KINDS[k].carriageway||k==='bike')add(rid,`laneKm.${k}`,len/1000);
   if(s.carriageway&&!s.raised){if(surface!=='dark_asphalt')put('overlay',k,surface,false,band(path,x0,x1));continue;}
   // Суурьшлын төлөвлөгөө (rules.ts) явган/дугуйн зам, ногоон зурвас, модыг өөрөө зурдаг: давхардуулахгүй.
   if(!urban)put('ground',k,surface,s.raised,band(path,x0,x1));
   // Хашлага (Curb_UV.cga 0.1 × 0.1 м): хучилттай залгаа өргөгдсөн эгнээний ирмэгт.
   if(s.raised){
    if(s.carriageway)put('curb','curb','light_concrete',true,[...band(path,x0,x0+CGA.curbWidth),...band(path,x1-CGA.curbWidth,x1)]);
    else{const inward=layout.slots[s.index+(s.center>0?-1:1)];if(inward&&inward.carriageway&&!inward.raised){const inner=Math.abs(x0)<Math.abs(x1)?x0:x1;put('curb','curb','light_concrete',true,inner>0?band(path,inner,inner+CGA.curbWidth):band(path,inner-CGA.curbWidth,inner));}}
   }
  }
  // Тойргийн арал (Street_Modern_Standard RoundaboutIsland → IslandWithGreen): нэг чиглэлтэй битүү тэнхлэгийн дотор тал.
  // Уулзварын зангилаа тойргийг хэд хэдэн тэнхлэгт хуваадаг тул эх замын битүү тэнхлэгээр нэг удаа.
  const ring=src.path.length>3&&distance(src.path[0],src.path.at(-1)!)<.01;
  if(ring&&first&&(!layout.forward.length||!layout.reverse.length)){
   const ccw=signedArea(src.path)>0,edge=offsetClosed(src.path,ccw?layout.outerLeft:layout.outerRight);
   const island=simplify([signedArea(edge)>0?[...edge].reverse():edge]);
   if(area(island)>4){put('ground','island','grass',true,island);put('curb','curb','light_concrete',true,curbRing(island));add(rid,'roundabouts',1);}
  }
  type Mark={p:XY[];cut:'lane'|'edge';color?:MarkingColor;glyph?:boolean};
  const cw=layout.slots.filter(s=>s.carriageway&&!s.raised),marks:Mark[]=[],mark=(paths:XY[][],cut:Mark['cut'],extra:Omit<Mark,'p'|'cut'>={})=>{for(const p of paths)marks.push({p,cut,...extra});};
  for(let j=0;j<layout.slots.length-1;j++){
   const a=layout.slots[j],b=layout.slots[j+1];if(!a.carriageway||!b.carriageway||a.raised&&b.raised)continue;
   const style=boundaryMarking(a.lane,b.lane);if(style==='none')continue;
   if(a.raised||b.raised){mark(markingPaths(path,len,a.raised?a.x1+.35:a.x1-.35,style,toAxis),'lane');continue;}
   // Street_Modern_Standard Centerline: эсрэг чиглэлийн эгнээний хооронд (yellow / white).
   const centre=(a.dir==='reverse'&&b.dir==='forward')||(a.dir==='forward'&&b.dir==='reverse');
   mark(markingPaths(path,len,a.x1,style,toAxis),'lane',centre&&section.centerline==='yellow'?{color:'yellow'}:{});
  }
  // Гадна ирмэг (CGA Line_Marking; төслийн өмнөх 0.35 м байрлал хэвээр).
  if(cw.length&&!campus){const l=cw[0].lane.left??'none',rr=cw.at(-1)!.lane.right??'none';
   if(l!=='none')mark(markingPaths(path,len,cw[0].x0+.35,l,toAxis),'edge');if(rr!=='none')mark(markingPaths(path,len,cw.at(-1)!.x1-.35,rr,toAxis),'edge');}
  // Буфер эгнээний дүүргэлт (Lane_Fill_Pattern.cga).
  const paint:Rings[]=[],paintYellow:Rings[]=[];
  for(const s of cw)if(s.lane.kind==='buffer'){const [x0,x1]=X(s),f=fillPattern(path,len,x0,x1,s.lane.fill??'diagonal-forward');mark(f.lines,'lane');if(f.solid.length)paint.push(f.solid);}
  // Lane_Symbol.cga (Spacing 15): дугуйчин, BUS, BUS LANE/ONLY, POOL, TAXI. 3D-д USDOT glb.
  for(const s of cw){const symbol=laneSymbol(s.lane);if(symbol==='none')continue;
   const [x0,x1]=X(s),xc=(x0+x1)/2;
   for(let d=CGA.symbolSpacing/2;d<len-3;d+=CGA.symbolSpacing){const p=pose(path,d),u=along(s)?p.dir:[-p.dir[0],-p.dir[1]] as XY,c=at(path,d,xc);if(blocked(c[0],c[1]))continue;
    mark(laneSymbolLines(c,u,symbol),'lane',{glyph:true});fixtures.push({k:'symbol',x:c[0],y:c[1],heading:heading(u),style:symbol,type:symbol,h:.01,d:SYMBOL_LENGTH[symbol],road:rid,asset:SYMBOLS[symbol].asset});}
  }
  // Street_Modern_Standard: сум, STOP нь текстур (lanes_4_stop_*) — геометр зураасаар. USDOT сумны glb-ийн гурвалжны чиглэл холилдсон (ArcGIS backface cull) тул ашиглахгүй.
  const arrowAt=(c:XY,u:XY,kind:ArrowKind)=>mark(arrow(c,u,kind),'lane');
  // Эгнээ бүрийн дунд хэсгийн чиглэлийн сум (өмнөх 25 %/75 % байрлал).
  if(!campus&&len>45&&!closed)for(const s of drive){const {point,dir}=pose(path,along(s)?len*.25:len*.75),u:XY=along(s)?dir:[-dir[0],-dir[1]],[x0,x1]=X(s),xc=(x0+x1)/2,c:XY=[point[0]+dir[1]*xc,point[1]-dir[0]*xc];if(!blocked(c[0],c[1]))arrowAt(c,u,'straight');}
  // Уулзварын ойртолт: гарц (Street_Modern_Standard Crosswalk*), зогсох шугам (StopLine), STOP / сумны хувилбар.
  const crossZones:Rings[]=[];
  for(const atEnd of [false,true]){
   const end=nodeOf(i,atEnd);if(!end)continue;const inJ=localTester(end.local.J);
   const s0=exitDistance(path,atEnd,half,inJ,Math.min(80,len/2));if(s0==null)continue;
   let s=s0+.5;const cwWidth=drive.length>3?CGA.crosswalk.wide:CGA.crosswalk.narrow;
   if(section.crossing!=='none'&&s+cwWidth<len/2){(section.crosswalkColor==='yellow'?paintYellow:paint).push(crosswalk(section.crossing,path,atEnd,s,cwWidth,-half,half));crossZones.push(sliceBand(path,atEnd,s,s+cwWidth,-half-8,half+8));add(rid,'crosswalks',1);s+=cwWidth+1;}
   else s+=urban&&section.crossing!=='none'?CGA.crosswalk.wide+1:1;
   if(!section.stopLines||!minor(end.local,i,atEnd)||s+CGA.stopLine>len/2)continue;
   const inbound=drive.filter(t=>along(t)===atEnd);if(!inbound.length)continue;
   const xs=inbound.flatMap(X),x0=Math.min(...xs),x1=Math.max(...xs);
   paint.push(sliceBand(path,atEnd,s,s+CGA.stopLine,x0+(x0<=-half+.01?.1:0),x1-(x1>=half-.01?.1:0)));add(rid,'stopLines',1);
   // Дотор (тэнхлэгт ойр) эгнээ эхэнд. stop өгөөгүй бол хуучин дүрэм: олон эгнээтэй ойртолтод зүүн/шулуун/баруун.
   const ordered=[...inbound].sort((a,b)=>Math.abs(X(a)[0]+X(a)[1])-Math.abs(X(b)[0]+X(b)[1])),d=s+CGA.stopLine+6,n=ordered.length,stop=section.stop;
   const kinds:(ArrowKind|null)[]=ordered.map((_,k)=>{
    if(stop==='line'||stop==='stop-word'||campus&&!stop)return null;
    if(stop==='arrows-right')return k===n-1?'right-only':null;
    if(stop==='arrows-sides')return n>1&&(k===0||k===n-1)?k===0?'left':'right':null;
    if(stop==='arrows-all')return n===1?'straight':k===0?'left':k===n-1?'right':'straight';
    return n>1?k===0?'left':k===n-1?'right':'straight':null;});
   if(d+3<len/2)ordered.forEach((t,k)=>{const {point,dir}=pose(path,atEnd?len-d:d),u:XY=atEnd?dir:[-dir[0],-dir[1]],[a,b]=X(t),xc=(a+b)/2,c:XY=[point[0]+dir[1]*xc,point[1]-dir[0]*xc];
    if(stop==='stop-word')mark(words(c,u,['STOP']),'lane');
    else if(kinds[k])arrowAt(c,u,kinds[k]!);});
  }
  // Зогсоолын эгнээ (Parking.cga / Parking_Lane.cga): бүлэг бүрт Number_Of_Parkings зай, хооронд Element_Length.
  for(const s of cw)if(s.lane.kind==='parking'){
   const p=s.lane.parking??{type:'parallel' as const,perGroup:CGA.parking.perGroup,element:'empty' as const,elementLength:CGA.parking.elementLength};
   const curved=path.length>2&&path.slice(1,-1).some((pt,k)=>{const a=unit(path[k],pt),b=unit(pt,path[k+2]);return a[0]*b[0]+a[1]*b[1]<Math.cos(5*Math.PI/180);});
   if(p.type==='diagonal'&&curved){axisIssues.add('Lane/Curbzone/Parking_Lane.cga: муруй замд налуу зогсоол зөвшөөрөхгүй.');continue;}
   if(parkingAcross(p.type,!!src.engineMode)>=s.lane.width+.05)continue;
   const [x0,x1]=X(s),outer=Math.abs(x0)>Math.abs(x1)?x0:x1,inner=outer===x0?x1:x0,spot=parkingAlong(p.type)+CGA.parking.line,shift=p.type==='diagonal'?(outer-inner):0;
   const gapAt=(atEnd:boolean)=>{const e=nodeOf(i,atEnd);return e?(exitDistance(path,atEnd,half,localTester(e.local.J),Math.min(80,len/2))??len)+8:2;};
   const startD=gapAt(false),stopD=len-gapAt(true),density=VEHICLE_DENSITY[s.lane.vehicles??'none'],travel=along(s)?1:-1;
   for(let d=startD;d+spot*p.perGroup<=stopD;d+=spot*p.perGroup+p.elementLength){const g1=d+spot*p.perGroup;
    mark([slicePath(offsetPath(path,inner+(inner>outer?-.075:.075)),d,g1)],'lane');
    for(let k=0;k<=p.perGroup;k++){const t=d+k*spot;mark([[at(path,t,inner),at(path,t+shift,outer)]],'lane');}
    add(rid,'parkingSpaces',p.perGroup);
    // Vehicle.cga Randomize: зай бүрт магадлалаар нэг машин (зогсоолын чиглэл).
    if(density.probability>0)for(let k=0;k<p.perGroup;k++){if(random()>=density.probability)continue;const t=d+(k+.5)*spot,c=at(path,t+shift/2,(inner+outer)/2),q=pose(path,t),dir:XY=[q.dir[0]*travel,q.dir[1]*travel],across:XY=outer>inner?q.right:[-q.right[0],-q.right[1]];
     const u:XY=p.type==='parallel'?dir:p.type==='perpendicular'?across:unit([0,0],[across[0]+dir[0],across[1]+dir[1]]),name=VEHICLE_ASSETS.car[Math.floor(random()*VEHICLE_ASSETS.car.length)];
     fixture({k:'vehicle',x:c[0],y:c[1],heading:heading(u),style:name,type:'car',h:1.5,d:4.9,asset:`Webstyles/Transportation/${name}.glb`});}
    // Бүлэг хоорондын элемент (Element_Type): хашлагын сунгалт, модны нүх, ваар, дугуйн тавиур.
    const e0=g1,e1=g1+p.elementLength;if(e1>stopD||p.element==='empty'||p.elementLength<2)continue;
    const xa=Math.min(inner,outer),xb=Math.max(inner,outer),area0=band(slicePath(path,e0+.3,e1-.3),xa,xb);
    if(!area0.length)continue;
    const mid=at(path,(e0+e1)/2,(x0+x1)/2),q=pose(path,(e0+e1)/2);
    if(p.element==='curb-extension'||p.element==='bike-rack'){put('ground','curb-extension','light_concrete',true,area0);put('curb','curb','light_concrete',true,curbRing(area0));
     if(p.element==='bike-rack'){const {margin,spacing}=CGA.bikeRack;for(let t=e0+margin;t<=e1-margin+1e-6;t+=spacing){const c=at(path,t,(x0+x1)/2);fixture({k:'bike-rack',x:c[0],y:c[1],heading:heading(q.right),style:FURNITURE['bike-rack'].webStyle,type:'bike-rack',h:.8,d:2.5,z:CGA.curbHeight,asset:`Webstyles/StreetScene/${FURNITURE['bike-rack'].webStyle}.glb`});}}}
    if(p.element==='tree-bed'){const bed=simplify([circle(mid,Math.min(1.5,(xb-xa)/2-.15),24)]),spec=PLANTS['Paper Birch'];put('ground','tree-bed','soil',true,bed);put('curb','curb','light_concrete',true,curbRing(bed));
     fixture({k:'tree',x:mid[0],y:mid[1],heading:0,style:spec.webStyle,type:'Paper Birch',h:spec.height,d:spec.radius*2,z:CGA.curbHeight,asset:plantAsset('Paper Birch')});add(rid,'treeBeds',1);}
    if(p.element==='planter'){const box=simplify([square(mid,q.dir,Math.min(p.elementLength-1,xb-xa-.3))]),{height,wall}=CGA.planter,spec=PLANTS['American Elderberry'];
     put('box','planter','light_concrete',true,diff(box,bufPoly(box,-wall)),height);put('ground','planter-soil','soil',true,bufPoly(box,-wall),height-CGA.planter.inset);
     fixture({k:'plant',x:mid[0],y:mid[1],heading:0,style:spec.webStyle,type:'American Elderberry',h:spec.height,d:spec.radius*2,z:height-CGA.planter.inset,asset:plantAsset('American Elderberry')});add(rid,'planters',1);}
   }
  }
  // Эгнээн дээрх статик тээвэр (Vehicle.cga Subdivide: getDistance алхам, 0.25–0.75 санамсаргүй байрлал).
  for(const s of cw){const v=s.lane.vehicles??'none';if(v==='none'||s.lane.kind==='parking')continue;const density=VEHICLE_DENSITY[v],[x0,x1]=X(s),xc=(x0+x1)/2,type=s.lane.kind==='bus'?'bus':s.lane.kind==='bike'?'bike':'car';
   for(let d=density.distance*.5;d<len-density.distance*.5;d+=density.distance){const t=d+(random()-.5)*density.distance*.5,c=at(path,t,xc),q=pose(path,t),u:XY=along(s)?q.dir:[-q.dir[0],-q.dir[1]],list=VEHICLE_ASSETS[type],name=list[Math.floor(random()*list.length)];
    fixture({k:'vehicle',x:c[0],y:c[1],heading:heading(u),style:name,type,h:type==='bus'?3.8:type==='bike'?1.1:1.5,d:type==='bus'?12:type==='bike'?1.8:4.9,asset:`Webstyles/Transportation/${name}.glb`});}}
  // Хайчлалт: зураас ба будаг уулзвар, бусад замын хучилтад орохгүй; гадна ирмэг уулзварын ам нээлттэй.
  const byCut=new Map<string,{cut:Mark['cut'];color?:MarkingColor;glyph?:boolean;paths:XY[][]}>();
  for(const m of marks){const key=`${m.cut}|${m.color??''}|${m.glyph?1:0}`,g=byCut.get(key)??{cut:m.cut,color:m.color,glyph:m.glyph,paths:[]};g.paths.push(m.p);byCut.set(key,g);}
  for(const g of byCut.values())for(const p of cutPaths(g.paths,g.cut==='edge'?others:laneCut)){if(campus&&pathLength(p)<.75)continue;lines.push({path:p,road:rid,edge:g.cut==='edge',...(g.color?{color:g.color}:{}),...(g.glyph?{glyph:true}:{})});}
  const ramps=unionAll(crossZones);
  const reachOut=Math.max(Math.abs(layout.outerLeft),Math.abs(layout.outerRight))+1,pb=bbox([path]),nearObstacles=obstacleParts.length?obstaclesNear({x0:pb.x0-reachOut,y0:pb.y0-reachOut,x1:pb.x1+reachOut,y1:pb.y1+reachOut}):[];
  const painted=diff(unionAll(paint),others);if(painted.length)pieces.push({layer:'paint',k:'paint',surface:'dark_asphalt',raised:false,rings:painted,road:rid});
  const yellow=diff(unionAll(paintYellow),others);if(yellow.length)pieces.push({layer:'paint',k:'paint',surface:'dark_asphalt',raised:false,rings:yellow,road:rid,color:'yellow'});
  const crossTest=localTester(ramps);
  // Гэрэл, мод, хаалт шон, тавилга (Row_Distributor.cga: Offset_Along = Spacing / 2).
  for(const s of layout.slots){
   const l=s.lane,[x0,x1]=X(s),xc=(x0+x1)/2,near=Math.abs(x0)<Math.abs(x1)?x0:x1,width=x1-x0,z=s.raised?CGA.curbHeight:0;
   const items:{k:FixtureKind;spacing:number;x:number;style:string;type:string;h:number;d:number;face:boolean;asset?:string;bed?:boolean}[]=[];
   const lamp=l.lamp??(l.kind==='lamp'?{type:'simple' as const,spacing:CGA.lampSpacing}:undefined);
   if(lamp){const spec=LAMPS[lamp.type],x=s.carriageway||l.kind==='lamp'||width<1.2?xc:near+Math.sign(xc)*.5;items.push({k:'lamp',spacing:lamp.spacing,x,style:spec.webStyle,type:lamp.type,h:spec.height,d:.3,face:true,asset:`Webstyles/StreetScene/${spec.webStyle}.glb`});}
   const plant=l.plant??(l.kind==='sidewalkPlant'?{type:'Basswood' as const,spacing:CGA.plantSpacing}:undefined);
   if(plant&&!(urban&&!s.carriageway)){const spec=PLANTS[plant.type];items.push({k:'tree',spacing:plant.spacing,x:xc,style:spec.webStyle,type:plant.type,h:spec.height,d:spec.radius*2,face:false,asset:plantAsset(plant.type),bed:l.kind==='sidewalkPlant'});}
   if(l.kind==='bollard'||l.bollard)items.push({k:'bollard',spacing:l.bollard?.spacing??CGA.bollardSpacing,x:xc,style:'cylinder',type:'bollard',h:CGA.bollard.height,d:CGA.bollard.diameter*2,face:false});
   const furniture=l.furniture??(l.kind==='furniture'?{type:'bench' as const,spacing:CGA.furnitureSpacing}:undefined);
   if(furniture){const spec=FURNITURE[furniture.type];items.push({k:furniture.type==='bench'||furniture.type==='bench-2'?'bench':furniture.type,spacing:furniture.spacing,x:xc,style:spec.webStyle,type:furniture.type,h:1,d:1.8,face:false,asset:`Webstyles/StreetScene/${spec.webStyle}.glb`});}
   for(const item of items){if(!(item.spacing>0))continue;
    // Хоёр талын гэрэл шатрын байдлаар: зүүн тал хагас алхмаар зөрнө.
    const phase=item.k==='lamp'&&xc<0&&!s.carriageway?item.spacing/2:0;
    for(let d=item.spacing/2+phase;d<len;d+=item.spacing){const p=pose(path,d),c:XY=[p.point[0]+p.right[0]*item.x,p.point[1]+p.right[1]*item.x];
     if(blocked(c[0],c[1])||crossTest(c[0],c[1])||inObstacle(c[0],c[1]))continue;
     const toStreet:XY=item.x>0?[-p.right[0],-p.right[1]]:p.right;let fz=z;
     // Sidewalk_Plant_Lane.cga модны нүх: хашлагатай (Curbs) эсвэл ваар (Pot, Height 0.4).
     if(item.bed&&!urban){const bed=l.bed??{type:'curb-round' as const,diameter:CGA.bed.diameter},spec=PLANT_BEDS[bed.type],shape=spec.round?simplify([circle(c,bed.diameter/2,20)]):simplify([square(c,p.dir,bed.diameter)]);
      if(spec.pot){put('box','pot','light_concrete',true,diff(shape,bufPoly(shape,-CGA.planter.wall)),CGA.bed.potHeight+z);put('ground','pot-soil','soil',true,bufPoly(shape,-CGA.planter.wall),CGA.bed.potHeight+z-.05);fz=CGA.bed.potHeight+z;}
      else{put('ground','tree-bed',GROUND_COVER[l.ground??'soil'].surface,true,shape);put('curb','bed-curb','light_concrete',true,curbRing(shape));}
      add(rid,'treeBeds',1);}
     fixtures.push({k:item.k,x:c[0],y:c[1],heading:heading(item.face?toStreet:p.dir),style:item.style,type:item.type,h:item.h,d:item.d,road:rid,...(item.asset?{asset:item.asset}:{}),...(fz?{z:fz}:{})});}
   }
   // Ground_Cover.cga Flowers: 1.5 м торны захын нүдэнд сарнай (дотор нүд хоосон).
   if((l.kind==='vegetation'||l.kind==='sidewalkPlant')&&l.ground==='flowers'&&!urban){const g=CGA.flowerGrid,spec=PLANTS.Rose;
    for(const x of width>2*g?[x0+g/2,x1-g/2]:[xc])for(let d=g/2;d<len;d+=g){const c=at(path,d,x);if(blocked(c[0],c[1])||crossTest(c[0],c[1])||inObstacle(c[0],c[1]))continue;
     fixtures.push({k:'plant',x:c[0],y:c[1],heading:(hash(`${rid}${d}${x}`)%360),style:'',type:'Rose',h:spec.height,d:spec.radius*2,road:rid,asset:plantAsset('Rose'),...(z?{z}:{})});}}
  }
  // Гүүрэн дээрх тоноглол (гэрэл, мод, тэмдэг) замын өндөрт.
  if(src.elevation)for(let k=fixtureStart;k<fixtures.length;k++){const f=fixtures[k],h=heightAtPoint(src,[f.x,f.y]);if(h)fixtures[k]={...f,z:(f.z??0)+h};}
  // Модны нүх, ваар (дээрх давталтаар нэмэгдсэн) орсны дараа нэгтгэнэ.
  for(const {piece:g,list} of groups.values()){g.rings=diff(unionAll(list),others);if(g.layer==='curb'&&ramps.length)g.rings=diff(g.rings,bufPoly(ramps,.2));if((g.layer==='curb'||g.layer==='ground'&&g.k==='vegetation')&&ctx.serviceOpenings.length)g.rings=diff(g.rings,ctx.serviceOpenings);if((g.layer==='ground'||g.layer==='box')&&nearObstacles.length)g.rings=diff(g.rings,nearObstacles);if(g.rings.length)pieces.push(g);}
  done();
 });
 campusEdgeLines(model,ctx);model.issues=[...issues];return model;
}

/** Явган хүний / дугуйн / хосолсон зам (Road.mode): хавтан, улаан асфальт; авто замтай огтлолцолд гарц (зебра) эсвэл дугуйн гарцын дөрвөлжин. ТААМАГЛАЛ: гэрэл 30 м алхамтай. */
export const PATH_STYLE={pedestrian:{surface:'paver' as Surface,k:'sidewalk'},bike:{surface:'red_asphalt' as Surface,k:'bike'},shared:{surface:'paver' as Surface,k:'sidewalk'}};
function addPaths(model:StreetModel,paths:Road[],ctx:RoadContext){
 if(!paths.length)return;const carSurface=model.pieces.filter(p=>p.layer==='surface'),boxes=carSurface.map(p=>({p,b:bbox(p.rings)}));
 for(const r of paths){const mode=r.mode as 'pedestrian'|'bike'|'shared',w=r.width,half=w/2,len=pathLength(r.path),pb=bbox([r.path]);if(len<1)continue;
  const near=unionAll(boxes.filter(x=>x.b.x1>=pb.x0-20&&x.b.x0<=pb.x1+20&&x.b.y1>=pb.y0-20&&x.b.y0<=pb.y1+20).map(x=>x.p.rings)),cut=(g:Rings)=>near.length?diff(g,near):g;
  const style=PATH_STYLE[mode],add=(k:string,v:number)=>{const o=model.perRoad[r.id]??={};o[k]=(o[k]??0)+v;};add(`len.path-${mode}`,len);
  if(mode==='shared'){model.pieces.push({layer:'ground',k:'sidewalk',surface:'paver',raised:false,rings:cut(band(r.path,-half,0)),road:r.id},{layer:'ground',k:'bike',surface:'red_asphalt',raised:false,rings:cut(band(r.path,0,half)),road:r.id});}
  else model.pieces.push({layer:'ground',k:style.k,surface:style.surface,raised:false,rings:cut(band(r.path,-half,half)),road:r.id});
  // Тэмдэглэгээ: дугуйн замд голын тасархай (хоёр чиглэл), хосолсонд явган/дугуйн хоорондын үргэлжилсэн шугам.
  const divider=mode==='bike'?markingPaths(r.path,len,0,'dashed',x=>x):mode==='shared'?markingPaths(r.path,len,0,'continuous',x=>x):[];
  for(const q of near.length?cutPaths(divider,near):divider)model.lines.push({path:q,road:r.id,edge:false});
  // Авто замтай огтлолцол: тэнхлэг бүрийн станц дээр гарц.
  ctx.canonical.forEach((ax,i)=>{const src=ctx.sources[i],lay=sectionLayout(sectionForRoad(src)),cw=lay.width/2,ap=ax.path;
   for(let a=1;a<r.path.length;a++)for(let b=1;b<ap.length;b++){const p0=r.path[a-1],p1=r.path[a],q0=ap[b-1],q1=ap[b],rr=[p1[0]-p0[0],p1[1]-p0[1]],v=[q1[0]-q0[0],q1[1]-q0[1]],den=rr[0]*v[1]-rr[1]*v[0];if(Math.abs(den)<1e-9)continue;
    const q=[q0[0]-p0[0],q0[1]-p0[1]],u=(q[0]*v[1]-q[1]*v[0])/den,t=(q[0]*rr[1]-q[1]*rr[0])/den;if(u<0||u>1||t<0||t>1)continue;
    const s0=pathLength(ap.slice(0,b))+t*Math.hypot(v[0],v[1]),wc=Math.max(w,CGA.crosswalk.narrow);if(s0-wc/2<0||s0+wc/2>pathLength(ap))continue;
    const paint=mode==='bike'?zebra(ap,false,s0-wc/2,wc,-cw,cw,.5,.5).filter((_,k)=>k%3!==1):crosswalk('zebra',ap,false,s0-wc/2,wc,-cw,cw);
    if(paint.length){model.pieces.push({layer:'paint',k:'paint',surface:'dark_asphalt',raised:false,rings:paint,road:r.id});add('crosswalks',1);}}});
  // Гэрэлтүүлэг (Lamp.cga Simple Light) замын баруун талд.
  if(mode!=='bike')for(let d=15;d<len;d+=30){const q=pose(r.path,d),c:XY=[q.point[0]+q.right[0]*(half+.5),q.point[1]+q.right[1]*(half+.5)];if(inside(c[0],c[1],near))continue;
   model.fixtures.push({k:'lamp',x:c[0],y:c[1],heading:heading([-q.right[0],-q.right[1]]),style:LAMPS.simple.webStyle,type:'simple',h:LAMPS.simple.height,d:.3,road:r.id,asset:`Webstyles/StreetScene/${LAMPS.simple.webStyle}.glb`});}
 }
}
export type StreetView={surface:Rings;overlays:{surface:Surface;rings:Rings}[];corners:Rings;ground:{k:LaneKind;surface:Surface;raised:boolean;rings:Rings}[];curbs:Rings;boxes:{rings:Rings;h:number}[];lines:XY[][];markingLines?:StreetLine[];laneLines:XY[][];areas:Rings;fixtures:StreetFixture[];quantities:Record<string,number>;issues:string[]};
const views=new WeakMap<StreetModel,Map<string,StreetView>>();
/** Дүрслэлд нэгтгэнэ: own = эзэмшигч замын ID (байхгүй бол бүх хот), boundary = хайчлах хил. */
/** Worker-ээс ирсэн загварт бүх хотын нэгтгэсэн хучилт байхгүй: тэнхлэгийн хучилт − голын өргөгдсөн зурвас. */
const surfaces=new WeakMap<StreetModel,Rings>();
export function modelSurface(model:StreetModel):Rings{const own=Object.getOwnPropertyDescriptor(model,'surface');if(own&&(own.get||own.value))return model.surface;let s=surfaces.get(model);if(!s){s=diff(unionAll(model.pieces.filter(p=>p.layer==='surface'||p.layer==='corner').map(p=>p.rings)),unionAll(model.pieces.filter(p=>(p.layer==='ground'||p.layer==='box')&&p.raised&&p.k==='vegetation').map(p=>p.rings)));surfaces.set(model,s);}return s;}
export function streetView(model:StreetModel,own?:Set<string>,boundary?:Rings,surface=modelSurface(model)):StreetView{
 const key=own?[...own].sort().join(','):'*';let cache=views.get(model);if(!cache){cache=new Map();views.set(model,cache);}
 const reusable=!boundary?.length&&surface===modelSurface(model),cached=reusable?cache.get(key):undefined;if(cached)return cached;
 const mine=(road:string)=>!own||own.has(road),clip=(r:Rings)=>boundary?.length?inter(r,boundary):r;
 const pieces=model.pieces.filter(p=>mine(p.road)),group=(layer:StreetPiece['layer'])=>pieces.filter(p=>p.layer===layer);
 const overlaysBy=new Map<Surface,Rings[]>();for(const p of group('overlay')){const l=overlaysBy.get(p.surface)??[];l.push(p.rings);overlaysBy.set(p.surface,l);}
 const overlays=[...overlaysBy].map(([s,list])=>({surface:s,rings:clip(unionAll(list))})).filter(o=>o.rings.length);
 // Хашлагын түвшний бүсүүд: хатуу хучилт эхэлж, дараа нь ногоон; бусдыг давхардуулахгүй.
 const order:string[]=['sidewalk','sidewalkPlant','lamp','furniture','bollard','bike','parking','buffer','curb-extension','vegetation','island','shoulder','car','bus','unmarked','tree-bed','pot-soil','planter-soil'];
 const ground:StreetView['ground']=[];let taken:Rings=[];
 for(const k of order){const list=group('ground').filter(p=>p.k===k);if(!list.length)continue;const late=k==='tree-bed'||k.endsWith('-soil');const rings=clip(late?unionAll(list.map(p=>p.rings)):diff(unionAll(list.map(p=>p.rings)),taken));if(!rings.length)continue;ground.push({k:k as LaneKind,surface:list[0].surface,raised:list[0].raised,rings});if(!late)taken=unionAll([taken,rings]);}
 const boxes=[...new Set(group('box').map(p=>p.h??1))].map(h=>({h,rings:clip(unionAll(group('box').filter(p=>(p.h??1)===h).map(p=>p.rings)))})).filter(b=>b.rings.length);
 const lines=model.lines.filter(l=>mine(l.road)),out:StreetView={surface,overlays,corners:clip(unionAll(group('corner').map(p=>p.rings))),ground,curbs:clip(unionAll(group('curb').map(p=>p.rings))),boxes,
  lines:lines.map(l=>l.path),markingLines:lines,laneLines:lines.filter(l=>!l.edge).map(l=>l.path),areas:clip(unionAll(group('paint').map(p=>p.rings))),fixtures:model.fixtures.filter(f=>mine(f.road)&&(!boundary?.length||inside(f.x,f.y,boundary))),quantities:{},issues:model.issues};
 const q=out.quantities;
 for(const [road,values] of Object.entries(model.perRoad))if(mine(road))for(const [k,v] of Object.entries(values))q[k]=(q[k]??0)+v;
 q.carriagewayM2=area(surface);q.cornerM2=area(out.corners);
 for(const o of overlays)q[`overlayM2.${o.surface}`]=area(o.rings);
 for(const g of ground)q[`groundM2.${g.k}`]=area(g.rings);
 q.curbM=area(out.curbs)/CGA.curbWidth;
 // Будгийн талбай ≈ Σ зураасны урт × 0.15 + өргөн будаг (union хийхгүй).
 q.paintM2=lines.reduce((s,l)=>s+pathLength(l.path)*(l.width??CGA.lineWidth),0)+area(out.areas);
 for(const f of out.fixtures)if(f.k!=='symbol'&&f.k!=='vehicle')q[`count.${f.k}`]=(q[`count.${f.k}`]??0)+1;
 if(reusable)cache.set(key,out);
 return out;
}
const forCache=new WeakMap<Road[],WeakMap<object,WeakMap<object,WeakMap<object,StreetView>>>>(),NONE={};
function memo(roads:Road[],options:StreetOptions,make:()=>StreetView){
 let a=forCache.get(roads);if(!a){a=new WeakMap();forCache.set(roads,a);}const k1=options.contextRoads??NONE;let b=a.get(k1);if(!b){b=new WeakMap();a.set(k1,b);}
 const k2=options.boundary?.length?options.boundary:NONE;let c=b.get(k2);if(!c){c=new WeakMap();b.set(k2,c);}const k3=options.obstacles?.length?options.obstacles:NONE,old=c.get(k3);if(old)return old;
 const view=make();c.set(k3,view);return view;
}
/** Нэг сэдвийн өөрийн зам: бүх хотын загвараас (contextRoads) өөрийн ID-аар шүүнэ. */
export function streetModelFor(roads:Road[],options:StreetOptions={}):StreetView{return memo(roads,options,()=>computeFor(roads,options));}
function computeFor(roads:Road[],options:StreetOptions):StreetView{
 const context=options.contextRoads??roads,model=streetModel(context,options.obstacles,{full:options.full});
 if(context===roads&&!options.boundary?.length)return streetView(model);
 const own=validRoads(roads),ids=new Set(own.map(r=>r.id)),ctx=roadContext(context);
 // Давхардсан замд тэнхлэгийн эзэмшигч өөр сэдвийнх байж болно: өөрийн замтай давхцсан эзэмшигчийг нэмнэ.
 for(let i=0;i<ctx.canonical.length;i++){const src=ctx.sources[i];if(ids.has(src.id))continue;if(own.some(r=>overlaps(r.path,ctx.canonical[i].path)))ids.add(src.id);}
 let surface=diff(unionAll(own.flatMap(r=>[bufPath([r.path],r.width/2),r.turnSurface??[]])),ctx.median);
 if(options.boundary?.length)surface=inter(surface,options.boundary);
 return streetView(model,ids,options.boundary,surface);
}
/** Хоёр тэнхлэг давхцаж буй эсэх (дунд цэг нь нөгөө тэнхлэгээс 0.01 м дотор). */
function overlaps(a:XY[],b:XY[]){
 const len=pathLength(b);if(len<1)return false;const m=samplePath(b,len/2).point as XY;
 for(let i=1;i<a.length;i++){const p=a[i-1],q=a[i],dx=q[0]-p[0],dy=q[1]-p[1],l2=dx*dx+dy*dy;if(!l2)continue;const t=Math.max(0,Math.min(1,((m[0]-p[0])*dx+(m[1]-p[1])*dy)/l2));if(Math.hypot(p[0]+dx*t-m[0],p[1]+dy*t-m[1])<.01)return true;}
 return false;
}
/** Тоо хэмжээний мөр (тайлан, санхүү). ТААМАГЛАЛ: концепц геометрээс; ажлын зураг биш. */
export function streetQuantityRows(q:Record<string,number>){
 const rows:{key:string;label:string;unit:string;value:number}[]=[];const put=(key:string,label:string,unit:string,value=q[key])=>{if(value&&Number.isFinite(value))rows.push({key,label,unit,value});};
 for(const cls of Object.keys(CLASS_LABEL) as StreetClass[])put(`len.${cls}`,`${CLASS_LABEL[cls]} — тэнхлэгийн урт`,'км',(q[`len.${cls}`]??0)/1000);
 for(const k of Object.keys(LANE_KINDS) as LaneKind[])put(`laneKm.${k}`,`${LANE_KINDS[k].label} — эгнээний урт`,'км');
 put('len.path-pedestrian','Явган хүний зам','км',(q['len.path-pedestrian']??0)/1000);put('len.path-bike','Дугуйн зам','км',(q['len.path-bike']??0)/1000);put('len.path-shared','Явган + дугуйн зам','км',(q['len.path-shared']??0)/1000);
 put('carriagewayM2','Зорчих хэсгийн хучилт','м²');put('cornerM2','Уулзварын булангийн хучилт (дүрслэл)','м²');
 const GROUND_LABEL:Record<string,string>={island:'Тойргийн арал','curb-extension':'Хашлагын сунгалт','tree-bed':'Модны нүх','pot-soil':'Ваарны хөрс','planter-soil':'Ваарны хөрс'};
 for(const [key,value] of Object.entries(q))if(key.startsWith('groundM2.')){const k=key.slice(9);put(key,`${LANE_KINDS[k as LaneKind]?.label??GROUND_LABEL[k]??k} — талбай`,'м²',value);}
 for(const [key,value] of Object.entries(q))if(key.startsWith('overlayM2.'))put(key,`Будсан эгнээний хучилт (${key.slice(10)})`,'м²',value);
 put('curbM','Хашлага (0.1 × 0.1 м)','м');put('paintM2','Тэмдэглэгээний будаг (ойролцоо)','м²');put('crosswalks','Явган хүний гарц','ш');put('stopLines','Зогсох шугам','ш');
 put('parkingSpaces','Гудамжны зогсоолын зай','зай');put('count.lamp','Гэрэлтүүлгийн шон','ш');put('count.tree','Мод (гудамжны)','ш');put('count.plant','Бут, цэцэг','ш');put('count.bollard','Хаалт шон','ш');put('count.bench','Сандал','ш');
 put('count.bike-rack','Дугуйн тавиур','ш');put('treeBeds','Модны нүх / ваар','ш');put('planters','Ваар (Planter)','ш');put('roundabouts','Тойрог уулзвар','ш');
 return rows;
}
