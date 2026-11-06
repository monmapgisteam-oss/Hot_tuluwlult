// The supplied engine stays verbatim. This bridge adapts the app's carriageway
// centre, split street graph and saved cross sections to its metric inputs.
import {buildNetwork,buildRoad,ROAD_MODES,type RoadMode,type LaneSpec,type Feature,type FeatureCollection,type NetworkInput,type Vec2} from './roadEngine';
import {alignedWith,offsetPath,pathLength,samplePath,type Road} from './roadGeometry';
import {sectionForRoad,sectionLayout,LANE_KINDS,SURFACES,STOPS,type StreetClass} from './streetSection';
import {roadContext,type RoadContext} from './roadContext';
import {ROAD_PRESETS} from './roadPresets';

const RADII:Record<StreetClass,number>={'urban-local':6,'urban-collector':8,'urban-arterial':10,industrial:12,connector:12,'service-track':8};
const supported=(r:Road)=>!r.elevation?.some(p=>Math.abs(p[1])>.01)&&!r.turnSurface?.length&&r.turnPolicy!=='fixed'&&!(r.path.length>2&&Math.hypot(r.path[0][0]-r.path.at(-1)![0],r.path[0][1]-r.path.at(-1)![1])<.01);
const reverseDir=(dir:LaneSpec['dir']):LaneSpec['dir']=>dir==='forward'?'reverse':dir==='reverse'?'forward':dir;
const stable=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
/** Keep the richer lane editor (vehicle density, plant species, planters,
 * individual boundary styles) on its existing renderer when customised. */
function engineSectionSupported(road:Road):boolean {
 const section=sectionForRoad(road),preset=ROAD_PRESETS.find(p=>p.engineMode===road.engineMode)?.section;
 if(!preset||section.lanes.length!==preset.lanes.length)return false;
 const shape=(lane:typeof section.lanes[number])=>({...lane,width:0,dir:undefined,surface:undefined,raised:undefined,symbol:undefined,parking:lane.parking?{...lane.parking,type:undefined}:undefined});
 return section.lanes.every((lane,i)=>(!lane.symbol||['none','bus','bike'].includes(lane.symbol))&&stable(shape(lane))===stable(shape(preset.lanes[i])));
}

export function engineModeForRoad(road:Road,aligned=true):RoadMode {
 const section=sectionForRoad(road),layout=sectionLayout(section),preset=road.engineMode?ROAD_MODES[road.engineMode]:undefined;
 let lanes:LaneSpec[]=layout.slots.map((slot,i)=>{
  const lane=slot.lane,original=preset?.lanes[i],kind:LaneSpec['kind']=lane.kind==='unmarked'?'car':lane.kind==='lamp'||lane.kind==='furniture'||lane.kind==='bollard'||lane.kind==='sidewalkPlant'?'sidewalk':lane.kind;
  const same=original&&(original.kind===kind||original.kind==='median'&&kind==='vegetation');
  return {...(same?original:{}),kind:same?original.kind:kind,width:lane.width,dir:slot.dir==='undefined'?'none':slot.dir,
   curbHeight:slot.raised?(same?original.curbHeight??.1:.1):0,
   surface:lane.surface?SURFACES[lane.surface].color:same?original.surface:SURFACES[LANE_KINDS[lane.kind].surface].color,
   ...(lane.parking?{parking:lane.parking.type}:{}),
   ...(lane.symbol==='bus'||lane.symbol==='bike'?{symbol:lane.symbol}:lane.symbol==='none'?{symbol:undefined}:{}),
  };
 });
 if(!aligned)lanes=lanes.reverse().map(l=>({...l,dir:reverseDir(l.dir),items:l.items?.map(it=>({...it,offsetAcross:-(it.offsetAcross??0)}))}));
 return {id:road.engineMode??'section',label:preset?.label??section.cls,cityEngineShape:preset?.cityEngineShape??'Street',designSpeed:road.speed,lanes,
  centerline:section.centerline??preset?.centerline??'white',laneLine:preset?.laneLine??'dashed',edgeLine:preset?.edgeLine??'continuous',dash:preset?.dash??[3,3],
  cornerRadius:road.cornerRadius??preset?.cornerRadius??RADII[section.cls],crosswalk:section.crossing==='zebra'?'continental':section.crossing,
  stop:section.stopLines?(STOPS[section.stop??'line'].cga as RoadMode['stop']):'none'};
}

export type EngineJunction={features:Feature[];setbacks:Map<number,number>;key:string;previewInput:NetworkInput;preview?:FeatureCollection};
export type EngineStreetContext={junctions:Map<number,EngineJunction>;axes:Map<number,{features:Feature[];mode:RoadMode;length:number;start:boolean;end:boolean}>};
const contexts=new WeakMap<RoadContext,EngineStreetContext>();
const junctionContexts=new WeakMap<RoadContext,EngineStreetContext>();
const nodes=new Map<string,{features:Feature[];setbacks:number[];input:NetworkInput}>();

/** Interior T/X crossings have already been split by roadContext. Build one
 * local node at a time so moving a junction reuses the other node geometries.
 * The engine assumes straight approaches and has no vertical alignment; keep
 * tight/grade-separated/custom industrial nodes on the established renderer. */
export function roadEngineContext(ctx:RoadContext,junctionsOnly=false):EngineStreetContext {
 const cached=contexts.get(ctx)??(junctionsOnly?junctionContexts.get(ctx):undefined);if(cached)return cached;
 const result:EngineStreetContext={junctions:new Map(),axes:new Map()},arms=new Map<number,{axis:number;atStart:boolean}[]>();
 ctx.ends.forEach((e,axis)=>{for(const [node,atStart] of [[e.start,true],[e.end,false]] as const){if(node<0||ctx.graph.adj[node].length<3)continue;const list=arms.get(node)??[];list.push({axis,atStart});arms.set(node,list);}});
 for(const [node,list] of arms){
  const centre=ctx.graph.nodes[node];
  if(list.length<3||list.some(a=>{const r=ctx.sources[a.axis],s=sectionLayout(sectionForRoad(r));return !supported(r)||Math.abs(s.outerLeft+s.outerRight)>.01||s.slots.some(l=>l.lane.kind==='shoulder')||r.engineMode==='highway'||r.engineMode==='ramp';}))continue;
  const prepared=list.map(a=>{const source=ctx.sources[a.axis],path=ctx.canonical[a.axis].path,mode=engineModeForRoad(source,alignedWith(source.path,path)),near=a.atStart?path[1]:path.at(-2)!,d:Vec2=[near[0]-centre[0],near[1]-centre[1]],len=Math.hypot(...d);return{...a,mode,path,length:pathLength(path),d:[d[0]/len,d[1]/len] as Vec2};});
  if(prepared.some(a=>!a.d.every(Number.isFinite)))continue;
  const radius=Math.max(...prepared.map(a=>a.mode.cornerRadius));
  const key=JSON.stringify([centre,radius,prepared.map(a=>[a.d,a.atStart,a.mode.lanes.map(l=>[l.kind,l.width,l.curbHeight,l.dir]),a.mode.stop,a.length])]);
  let geometry=nodes.get(key);
  if(!geometry){
   // Long straight stubs only generate node geometry. No furniture or paint
   // is generated here; the actual road is rendered once using its setbacks.
   const roads=prepared.map((a,i)=>({id:`arm-${i}`,path:[centre,[centre[0]+a.d[0]*10000,centre[1]+a.d[1]*10000] as Vec2],smoothRadius:0,
    mode:{...a.mode,lanes:(a.atStart?a.mode.lanes:[...a.mode.lanes].reverse().map(l=>({...l,dir:reverseDir(l.dir)}))).map(l=>({...l,items:[],symbol:undefined,kind:l.kind==='parking'?'car' as const:l.kind==='buffer'?'shoulder' as const:l.kind})),centerline:'none' as const,laneLine:'none' as const,edgeLine:'none' as const,crosswalk:'none' as const,stop:'none' as const,dash:[10000,10000] as [number,number]}}));
   const input:NetworkInput={roads,nodes:[{at:centre,cornerRadius:radius}],turnPaths:false},fc=buildNetwork(input);
   const meta=(fc.meta.nodes as {setbacks:{road:string;setback:number}[]}[])[0];
   if(!meta)continue;
   const setbacks=prepared.map((_,i)=>meta.setbacks.find(s=>s.road===`arm-${i}`)?.setback??0);
   geometry={features:fc.features.filter(f=>f.properties.roadId==='node-0'),setbacks,input:{...input,roads:roads.map((r,i)=>{const a=prepared[i],length=setbacks[i]+30;return{...r,path:[centre,[centre[0]+a.d[0]*length,centre[1]+a.d[1]*length]],
    mode:{...r.mode,lanes:(a.atStart?a.mode.lanes:[...a.mode.lanes].reverse().map(l=>({...l,dir:reverseDir(l.dir)}))).map(l=>({...l,items:[],symbol:undefined}))},start:{crosswalk:'none',stop:a.mode.stop}};})}};
   if(nodes.size>2000)nodes.clear();nodes.set(key,geometry);
  }
  // The exact source engine has no overlap solver for neighbouring nodes.
  // Reject a node that cannot fit its arms, rather than emit inverted strips.
  if(geometry.setbacks.some((s,i)=>{const a=prepared[i];return s<=0||s>a.length*.45||[s/2,s].some(d=>{const p=samplePath(a.path,a.atStart?d:a.length-d).point;return Math.hypot(p[0]-centre[0]-a.d[0]*d,p[1]-centre[1]-a.d[1]*d)>.1;});}))continue;
  result.junctions.set(node,{features:geometry.features,setbacks:new Map(prepared.map((a,i)=>[a.axis,geometry!.setbacks[i]])),key,previewInput:geometry.input});
 }
 if(junctionsOnly){junctionContexts.set(ctx,result);return result;}
 ctx.canonical.forEach((axis,i)=>{
  const source=ctx.sources[i];if(!source.engineMode||!supported(source)||!engineSectionSupported(source))return;
  const ends=ctx.ends[i];if([ends.start,ends.end].some(n=>n>=0&&ctx.graph.adj[n].length>=3&&!result.junctions.has(n)))return;
  const aligned=alignedWith(source.path,axis.path),mode=engineModeForRoad(source,aligned),layout=sectionLayout(sectionForRoad(source));
  // The app stores the carriageway centre. The supplied engine centres the
  // whole section, including asymmetric shoulders (e.g. the highway ramp).
  const shift=(layout.outerLeft+layout.outerRight)/2*(aligned?1:-1),path=shift?offsetPath(axis.path,shift):axis.path;
  const start=result.junctions.get(ends.start),end=result.junctions.get(ends.end),trimStart=start?.setbacks.get(i)??0,trimEnd=end?.setbacks.get(i)??0,length=pathLength(path);
  if(length-trimStart-trimEnd<2)return;
  const built=buildRoad({id:source.id,path,mode,smoothRadius:0,start:start?{crosswalk:mode.crosswalk,stop:mode.stop}:undefined,end:end?{crosswalk:mode.crosswalk,stop:mode.stop}:undefined},undefined,{trimStart,trimEnd});
  result.axes.set(i,{features:built.out.features,mode,length,start:!!start,end:!!end});
 });
 contexts.set(ctx,result);return result;
}

/** Planning/selection needs the junction envelope, not thousands of lane
 * markings and street objects along the rest of each incident road. */
export function roadEngineJunctions(ctx:RoadContext):Map<number,EngineJunction>{return roadEngineContext(ctx,true).junctions;}

/** A selected node's lane-to-lane curves, in EPSG:32648. Built lazily so a
 * full-city model does not create invisible turn-path graphics. */
export function engineJunctionPreview(roads:Road[],at:Vec2):FeatureCollection|null {
 const ctx=roadContext(roads),junctions=roadEngineJunctions(ctx);
 const node=[...junctions.keys()].find(n=>Math.hypot(ctx.graph.nodes[n][0]-at[0],ctx.graph.nodes[n][1]-at[1])<1);
 if(node==null)return null;
 const data=junctions.get(node)!;
 if(!data.preview){const fc=buildNetwork({...data.previewInput,turnPaths:true});data.preview={...fc,features:fc.features.filter(f=>f.properties.roadId==='node-0')};}
 return data.preview;
}
