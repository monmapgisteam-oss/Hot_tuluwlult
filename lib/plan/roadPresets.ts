// Замын төрлийн загвар (засварлагч: шинэ зам, Inspector): өргөн, эгнээ, голын зурвас, хурд, огтлолыг нэг дор.
// ТААМАГЛАЛ: эгнээ 3.0–3.75 м, явган зам 2–3 м, дугуйн 1.8–2.5 м (СП 42.13330 / СНиП 2.07.01-89-ийн түгээмэл утга). ШАЛГАХ: БНбД 30-01-04, 32-01-04.
import type {Road,RoadMode,EngineMode} from './roadGeometry';
import {templateSection,urbanStreetSection,sectionLayout,type StreetSection,type SectionLane,type Surface,type Marking} from './streetSection';
import {ROAD_MODES,COLORS,type StopMarking,type RoadMode as GuideRoadMode} from './roadEngine';

export type RoadPreset={id:string;label:string;group:string;mode:RoadMode;width:number;lanes:number;median:number;speed:number;use:Road['use'];oneWay?:boolean;section?:StreetSection;engineMode?:EngineMode;cornerRadius?:number};
const urban=(cls:'arterial'|'collector'|'local',x:{walk:number;bike:number;verge:number;median:number;lanes:number},laneW:number)=>urbanStreetSection(cls,x,laneW);
const oneWay=(laneW:number,lanes:number,side:number):StreetSection=>({cls:'urban-collector',lanes:[{kind:'sidewalk',width:side},...Array.from({length:lanes},(_,i)=>({kind:'car' as const,width:laneW,dir:'forward' as const,left:i===0?'continuous' as const:'none' as const,right:i<lanes-1?'dashed' as const:'continuous' as const})),{kind:'sidewalk',width:side}],crossing:'zebra',stopLines:true,source:'design'});
const ENGINE_LABELS:Record<EngineMode,string>={alley:'Alley · дотоод зам',street:'Street · гудамж',collector:'Collector · зогсоолтой цуглуулах',avenue:'Avenue · дугуйн эгнээтэй',boulevard:'Boulevard · ногоон голын зурвас, автобус',highway:'Highway · хурдны зам',ramp:'Ramp · нэг чиглэлийн холбох гарц'};
const ENGINE_STOPS:Partial<Record<StopMarking,StreetSection['stop']>>={'line only':'line','with stop marking':'stop-word','arrows on all lanes':'arrows-all','arrows on side lanes':'arrows-sides','arrows for right turn':'arrows-right'};
const ENGINE_SURFACES:Record<string,Surface>={[COLORS.asphalt]:'dark_asphalt',[COLORS.redAsphalt]:'red_asphalt',[COLORS.greenAsphalt]:'green_asphalt',[COLORS.darkConcrete]:'dark_concrete',[COLORS.lightConcrete]:'light_concrete',[COLORS.grass]:'grass',[COLORS.soil]:'soil'};
/** Mirror the guide's boundary rules for the inspector and the bridge/elevation fallback renderer. */
function engineBoundary(mode:GuideRoadMode,edge:number):Marking{
 const a=mode.lanes[edge-1],b=mode.lanes[edge];if(!a||!b||(a.curbHeight??0)>0||(b.curbHeight??0)>0)return'none';
 const vehicle=(kind:string)=>kind==='car'||kind==='bus',va=vehicle(a.kind),vb=vehicle(b.kind);
 if(va&&vb){if(a.dir==='both'||b.dir==='both')return'none';if(a.dir!==b.dir)return mode.centerline==='none'?'dashed':'continuous-double';return a.kind==='bus'||b.kind==='bus'?'continuous':mode.laneLine;}
 if(va&&b.kind==='shoulder'||vb&&a.kind==='shoulder')return mode.edgeLine;
 return va||vb||a.kind==='bike'||b.kind==='bike'?'continuous':'none';
}
/** Guide presets remain the authority; this projection supplies the existing lane editor and traffic graph. */
function enginePreset(id:EngineMode):RoadPreset{
 const mode=ROAD_MODES[id],lanes:SectionLane[]=mode.lanes.map((l,i)=>{
  const tree=l.items?.find(i=>i.type==='tree'),lamp=l.items?.find(i=>i.type==='lamp'),bench=l.items?.find(i=>i.type==='bench');
  return{kind:l.kind==='median'?'vegetation':l.kind,width:l.width,dir:l.dir==='none'?'undefined':l.dir,raised:(l.curbHeight??0)>0,left:engineBoundary(mode,i),right:engineBoundary(mode,i+1),
   ...(l.surface?{surface:ENGINE_SURFACES[l.surface]}:{}),...(l.symbol?{symbol:l.symbol}:{}),
   ...(l.parking?{parking:{type:l.parking,perGroup:5,element:'empty' as const,elementLength:5}}:{}),
   ...(tree?{plant:{type:'Paper Birch' as const,spacing:tree.spacing}}:{}),...(lamp?{lamp:{type:'to-street' as const,spacing:lamp.spacing}}:{}),...(bench?{furniture:{type:'bench' as const,spacing:bench.spacing}}:{})};
 });
 const section:StreetSection={cls:id==='highway'||id==='ramp'?'connector':id==='avenue'||id==='boulevard'?'urban-arterial':id==='collector'?'urban-collector':'urban-local',lanes,
  crossing:mode.crosswalk==='continental'?'zebra':mode.crosswalk,stopLines:mode.stop!=='none',source:'design',...(ENGINE_STOPS[mode.stop]?{stop:ENGINE_STOPS[mode.stop]}:{}),...(mode.centerline==='yellow'?{centerline:'yellow'}:{})};
 const layout=sectionLayout(section);
 return{id:`engine-${id}`,label:ENGINE_LABELS[id],group:'Street Modern · шинэ замын модель',mode:'car',width:layout.width,lanes:Math.max(1,layout.forward.length,layout.reverse.length),median:layout.median,speed:mode.designSpeed,use:mode.cityEngineShape==='Street'?'residential':'connector',section,engineMode:id,cornerRadius:mode.cornerRadius};
}
export const ROAD_PRESETS:RoadPreset[]=[
 ...Object.keys(ENGINE_LABELS).map(id=>enginePreset(id as EngineMode)),
 {id:'arterial-4',group:'Хотын гудамж',label:'Магистраль · 4 эгнээ (2×2×3.5 + голын 3 м) + дугуй + явган',mode:'car',width:17,lanes:2,median:3,speed:50,use:'residential',section:urban('arterial',{walk:3,bike:2,verge:2,median:3,lanes:2},3.5)},
 {id:'collector-2',group:'Хотын гудамж',label:'Цуглуулах · 2 эгнээ (2×3.5) + дугуй + явган',mode:'car',width:7,lanes:1,median:0,speed:40,use:'residential',section:urban('collector',{walk:2.5,bike:1.8,verge:1.5,median:0,lanes:1},3.5)},
 {id:'local-2',group:'Хотын гудамж',label:'Орон нутгийн · 2 эгнээ (2×3.0) + явган',mode:'car',width:6,lanes:1,median:0,speed:30,use:'residential',section:urban('local',{walk:2,bike:0,verge:1.5,median:0,lanes:1},3)},
 {id:'oneway-2',group:'Хотын гудамж',label:'Нэг чиглэлтэй · 2 эгнээ (2×3.5) + явган',mode:'car',width:7,lanes:2,median:0,speed:40,use:'residential',oneWay:true,section:oneWay(3.5,2,2.5)},
 {id:'connector-2',group:'Бүс хоорондын',label:'Холбох зам · 2 эгнээ (2×3.75) + хажуу 1.5',mode:'car',width:7.5,lanes:1,median:0,speed:60,use:'connector'},
 {id:'connector-4',group:'Бүс хоорондын',label:'Холбох зам · 4 эгнээ (2×2×3.75 + голын 2 м)',mode:'car',width:17,lanes:2,median:2,speed:80,use:'connector'},
 {id:'industrial-2',group:'Үйлдвэр',label:'Үйлдвэрийн зам · 2 эгнээ (2×4.0)',mode:'car',width:8,lanes:1,median:0,speed:30,use:'industrial'},
 {id:'yard',group:'Үйлдвэр',label:'Талбайн дотоод зам · 2×4.0, 20 км/ц',mode:'car',width:8,lanes:1,median:0,speed:20,use:'industrial'},
 {id:'service',group:'Үйлдвэр',label:'Үйлчилгээний зам (салхи/нар) · 2×3.0',mode:'car',width:6,lanes:1,median:0,speed:20,use:'industrial'},
 {id:'pedestrian',group:'Авто бус',label:'Явган хүний зам · 3 м',mode:'pedestrian',width:3,lanes:1,median:0,speed:5,use:'residential'},
 {id:'bike',group:'Авто бус',label:'Дугуйн зам · 2.5 м (хоёр чиглэл)',mode:'bike',width:2.5,lanes:1,median:0,speed:20,use:'residential'},
 {id:'shared',group:'Авто бус',label:'Явган + дугуйн зам · 4 м',mode:'shared',width:4,lanes:1,median:0,speed:15,use:'residential'},
];
/** Загварыг замд хэрэглэнэ (тэнхлэг, ID хэвээр). Огтлолгүй загварт ангиллын CGA жишиг огтлол. */
export function applyPreset<T extends Road>(road:T,preset:RoadPreset):T{
 const base={...road,mode:preset.mode==='car'?undefined:preset.mode,width:preset.width,lanes:preset.lanes,median:preset.median,speed:preset.speed,use:preset.use,engineMode:preset.engineMode,cornerRadius:preset.cornerRadius};
 const section=preset.mode!=='car'?undefined:preset.section??templateSection(preset.use==='connector'?'connector':preset.speed<=20&&preset.width<7?'service-track':'industrial',base);
 return{...base,section} as T;
}
/** Замд хамгийн ойр загвар (Inspector-ийн сонголтын анхны утга). */
export function presetOf(road:Road){return ROAD_PRESETS.find(p=>p.engineMode===road.engineMode&&(p.mode==='car'?!road.mode||road.mode==='car':road.mode===p.mode)&&Math.abs(p.width-road.width)<.01&&p.lanes===road.lanes&&p.use===road.use&&p.speed===road.speed)?.id??'';}
