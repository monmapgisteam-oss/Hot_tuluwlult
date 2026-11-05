// Гудамжны хөндлөн огтлол — Esri CityEngine «Streets» (lane-based Complete Streets) CGA дүрмийн вебийн загвар.
// Эх дүрэм: Streets/Streets/Lane/** (эгнээ бүр нэг .cga), Imports/Elements/** (тэмдэглэгээ, гарц, зогсоол, мод, гэрэл).
// Хэмжээсийн анхны утгыг CGA attr-аас авсан (файл бүрийг доор заав). Эдгээр нь Esri-ийн жишээ утга бөгөөд
// Монголын БНбД / MNS-ийн батлагдсан утга биш — ТААМАГЛАЛ. ШАЛГАХ: замын ангилал, эгнээ, тэмдэглэгээний норм.
import type {Road} from './roadGeometry';
import {DESIGN_VEHICLES} from './vehiclePaths';

export type LaneKind='car'|'bus'|'bike'|'unmarked'|'parking'|'buffer'|'shoulder'|'sidewalk'|'lamp'|'furniture'|'bollard'|'sidewalkPlant'|'vegetation';
export type Surface='dark_asphalt'|'red_asphalt'|'green_asphalt'|'light_concrete'|'dark_concrete'|'paver'|'gravel'|'grass'|'soil';
export type Marking='none'|'continuous'|'dashed'|'continuous-double'|'dashed-double'|'dashed+continuous'|'continuous+dashed';
export type Direction='forward'|'reverse'|'both'|'undefined';
export type PlantType='Basswood'|'European Larch'|'Paper Birch'|'Scots Pine'|'Black Locust'|'Common Whitebeam'|'Red Alder'|'Oval Leaved Privet'|'American Elderberry'|'Rose'|'Smooth Sumac';
export type LampType='simple'|'two-sided'|'to-street'|'to-sidewalk';
export type ParkingType='parallel'|'perpendicular'|'diagonal';
export type ParkingElement='empty'|'curb-extension'|'bike-rack'|'tree-bed'|'planter';
export type MarkingColor='white'|'yellow';
/** Lane_Fill_Pattern.cga Pattern (Lines Along / Accross, Cross, Diagonal, Arrow Forward/Backward, Solid). */
export type FillPattern='none'|'solid'|'along'|'across'|'diagonal-forward'|'diagonal-backward'|'cross'|'diagonal-cross'|'arrow-forward'|'arrow-backward';
/** Lane_Symbol.cga Symbol (USDOT glb: BikeRider, BUS, BUSLANE, BUSONLY, POOL, TAXI). */
export type LaneSymbol='none'|'bike'|'bus'|'bus-lane'|'bus-only'|'pool'|'taxi';
/** Vehicle.cga Density: Low 0.2 / 60 м, Medium 0.5 / 40 м, High 0.85 / 20 м. */
export type VehicleDensity='none'|'low'|'medium'|'high';
/** Sidewalk_Plant_Lane.cga Plant_Bed_Type. */
export type PlantBed='curb-round'|'curb-rect'|'pot-round'|'pot-rect';
/** Ground_Cover.cga Type. */
export type GroundCover='grass'|'soil'|'flowers';
/** Street_Modern_Standard.cga CrosswalkBegin/End: zebra = «continental». */
export type Crosswalk='none'|'zebra'|'ladder'|'transverse'|'dashed'|'solid';
/** Street_Modern_Standard.cga StopBegin/End: line only / with stop marking / arrows on all lanes / side lanes / right turn. */
export type StopMarking='line'|'stop-word'|'arrows-all'|'arrows-sides'|'arrows-right';
export type StreetClass='urban-arterial'|'urban-collector'|'urban-local'|'industrial'|'service-track'|'connector';

export type SectionLane={
 kind:LaneKind;width:number;
 /** Хөдөлгөөний чиглэл замын тэнхлэгийн дагуу (CGA travelDirection). Өгөхгүй бол баруун тал = forward. */
 dir?:Direction;
 /** Эгнээний зүүн/баруун ирмэгийн тэмдэглэгээ (CGA Left_Marking_Style / Right_Marking_Style). */
 left?:Marking;right?:Marking;
 surface?:Surface;
 /** Хашлагын түвшинд өргөгдсөн эсэх (CGA Curb_Height > 0). Өгөхгүй бол эгнээний төрлөөс. */
 raised?:boolean;
 symbol?:LaneSymbol;
 fill?:FillPattern;
 parking?:{type:ParkingType;perGroup:number;element:ParkingElement;elementLength:number};
 plant?:{type:PlantType;spacing:number};
 lamp?:{type:LampType;spacing:number};
 furniture?:{type:FurnitureType;spacing:number};
 bollard?:{spacing:number};
 /** Vehicle.cga: зогсоол / эгнээн дээрх статик тээврийн хэрэгсэл (CityEngine-ийн дүрслэл; хөдөлгөөний симуляци тусдаа). */
 vehicles?:VehicleDensity;
 /** Sidewalk_Plant_Lane.cga модны нүх: хашлагатай/ваартай, дугуй/тэгш өнцөгт, диаметр м. */
 bed?:{type:PlantBed;diameter:number};
 /** Vegetation_Buffer_Lane / Sidewalk_Plant_Lane Ground_Cover. */
 ground?:GroundCover;
};
export type StreetSection={cls:StreetClass;lanes:SectionLane[];crossing:Crosswalk;stopLines:boolean;source:'derived'|'urban-plan'|'design';
 /** Street_Modern_Standard.cga: зогсох шугамын хувилбар (stopLines үед), гарцын өнгө, голын шугамын өнгө. */
 stop?:StopMarking;crosswalkColor?:MarkingColor;centerline?:MarkingColor};
/** Runtime-д үүсгэдэг, хадгалалтад орохгүй гудамжны нарийвчилсан давхарга (roadDetailLayers). */
export const STREET_RUNTIME_LAYER=/-street-(surface|lanes|ground|curbs|fixtures|models|mesh)$/;
/** quantities: сүүлд тооцсон бүх хотын тоо хэмжээ (санхүүд). */
/** options: ангиллын Street_Modern_Standard тохиргоо (гарц, зогсох шугам, өнгө). */
export type SectionOptions=Pick<StreetSection,'crossing'|'stopLines'|'stop'|'crosswalkColor'|'centerline'>;
export type StreetDesign={version:1;classes:Partial<Record<StreetClass,SectionLane[]>>;options?:Partial<Record<StreetClass,Partial<SectionOptions>>>;updated?:string;quantities?:Record<string,number>};

/** CGA attr-ийн анхны утга. */
export const CGA={
 lineWidth:.15,lineDistance:.15,dash:3,gap:3,               // Imports/Elements/Line_Marking.cga
 curbHeight:.1,curbWidth:.1,                                  // Imports/Lane_Queries.cga defaultCurbHeight/Width
 parking:{width:2.3,length:5.5,line:.15,perGroup:5,elementLength:5}, // Imports/Elements/Parking.cga, Lane/Curbzone/Parking_Lane.cga
 zebra:{bar:1,gap:.8,margin:.3},                              // Imports/Elements/Zebra_Crossing.cga
 crosswalk:{narrow:3.5,wide:4.5},                             // Street_Modern_Standard.cga _crosswalkWidth
 stopLine:.5,                                                 // Street_Modern_Standard.cga StopLine (_stopBegin*0.5)
 symbolSpacing:15,                                            // Imports/Elements/Lane_Symbol.cga Spacing
 plantSpacing:10,lampSpacing:10,furnitureSpacing:10,bollardSpacing:2, // Lane/** Spacing, Row_Distributor.cga
 bollard:{height:.8,diameter:.1},                             // Imports/Elements/Bollard.cga
 fill:{lineWidth:.15,distance:1,angle:45,arrow:33,arrowStep:.35}, // Imports/Elements/Lane_Fill_Pattern.cga (Pattern_Lines ±45°, Pattern_Arrow2 33°, 0.35·өргөн)
 bed:{diameter:1.2,potHeight:.4},                             // Lane/Vegetation/Sidewalk_Plant_Lane.cga Plant_Bed_Diameter, Plant_Pot Height
 planter:{height:1,wall:.1,inset:.1},                         // Imports/Elements/Planter.cga
 bikeRack:{margin:1.2,spacing:1},                             // Imports/Elements/Bike_Racks.cga
 flowerGrid:1.5,                                              // Imports/Elements/Ground_Cover.cga FlowerDistribution
 crosswalkLines:{ladder:.17,transverse:.27,dashed:.17},      // Street_Modern_Standard.cga Crosswalk*
};
/** CGA Solitary_Plant.cga plant_table: [өндөр м, радиус м] ба ArcGIS «EsriRealisticTreesStyle»-ийн ижил төрөл. */
export const PLANTS:Record<PlantType,{label:string;height:number;radius:number;webStyle:string;latin:string}>={
 'Basswood':{label:'Хадмал (Tilia)',height:12,radius:3.54,webStyle:'Tilia',latin:'TiliaAmericana'},
 'European Larch':{label:'Шинэс (Larix)',height:15,radius:2.5,webStyle:'Larix',latin:'LarixDecidua'},
 'Paper Birch':{label:'Хус (Betula)',height:18,radius:3.88,webStyle:'Betula',latin:'BetulaPapyrifera'},
 'Scots Pine':{label:'Нарс (Pinus sylvestris)',height:12,radius:2.02,webStyle:'Pinus Sylvestris',latin:'PinusSylvestris'},
 'Black Locust':{label:'Хуайс (Robinia)',height:14,radius:4,webStyle:'Robinia',latin:'RobiniaPseudoacacia'},
 'Common Whitebeam':{label:'Ятуу (Sorbus)',height:12,radius:3,webStyle:'Sorbus',latin:'SorbusAria'},
 'Red Alder':{label:'Нэрс (Alnus)',height:15,radius:2.74,webStyle:'Alnus',latin:'AlnusRubra'},
 // Solitary_Plant.cga «SMALL PLANTS» ба бут (ваар, ногоон зурвас). webStyle-гүй бол ESRI.lib glb эсвэл энгийн бөмбөрцөг.
 // latin = vegetation_metadata.csv-ийн Proxy-оор шийдсэн файл (Solitary_Plant.cga assetFileName).
 'Oval Leaved Privet':{label:'Бут (Ligustrum)',height:5,radius:.95,webStyle:'',latin:'LigustrumOvalifolium'},
 'American Elderberry':{label:'Бут (Sambucus)',height:2.5,radius:1,webStyle:'',latin:'CrataegusMonogyna'},
 'Rose':{label:'Сарнай (Rosa)',height:1.2,radius:.56,webStyle:'',latin:'RosaGrandiflora'},
 'Smooth Sumac':{label:'Бут (Rhus)',height:2,radius:1.5,webStyle:'',latin:'SpartiumJunceum'},
};
export const SYMBOLS:Record<LaneSymbol,{label:string;cga:string;asset?:string}>={
 none:{label:'Байхгүй',cga:'None'},bike:{label:'Дугуйчин',cga:'Bike Rider',asset:'Streets/Markings/Marking_USDOT_BikeRider.glb'},
 bus:{label:'BUS',cga:'Bus',asset:'Streets/Markings/Marking_USDOT_BUS.glb'},'bus-lane':{label:'BUS LANE',cga:'Bus Lane',asset:'Streets/Markings/Marking_USDOT_BUSLANE.glb'},
 'bus-only':{label:'BUS ONLY',cga:'Bus Only',asset:'Streets/Markings/Marking_USDOT_BUSONLY.glb'},pool:{label:'POOL (олон зорчигч)',cga:'Pool',asset:'Streets/Markings/Marking_USDOT_POOL.glb'},
 taxi:{label:'TAXI',cga:'Taxi',asset:'Streets/Markings/Marking_USGeneric_TAXI.glb'},
};
/** Street_Modern_Standard.cga-ийн гарц (crosswalk_continental_*.jpg, AsphaltPainted). */
export const CROSSWALKS:Record<Crosswalk,{label:string;cga:string}>={none:{label:'Гарцгүй',cga:'none'},zebra:{label:'Зебра (continental)',cga:'continental'},ladder:{label:'Шат (ladder)',cga:'ladder'},transverse:{label:'Хоёр шугам (transverse)',cga:'transverse'},dashed:{label:'Тасархай (dashed)',cga:'dashed'},solid:{label:'Бүтэн будсан',cga:'solid'}};
export const STOPS:Record<StopMarking,{label:string;cga:string}>={line:{label:'Зөвхөн шугам',cga:'line only'},'stop-word':{label:'Шугам + STOP',cga:'with stop marking'},'arrows-all':{label:'Бүх эгнээнд сум',cga:'arrows on all lanes'},'arrows-sides':{label:'Захын эгнээнд сум',cga:'arrows on side lanes'},'arrows-right':{label:'Баруун эргэлтийн сум',cga:'arrows for right turn'}};
export const VEHICLE_DENSITY:Record<VehicleDensity,{label:string;probability:number;distance:number}>={none:{label:'Байхгүй',probability:0,distance:0},low:{label:'Бага',probability:.2,distance:60},medium:{label:'Дунд',probability:.5,distance:40},high:{label:'Их',probability:.85,distance:20}};
/** Vehicle.cga cars / buses / bikes (ESRI.lib Webstyles/Transportation). */
export const VEHICLE_ASSETS={car:['Audi_A6','BMW_3-Series','Ford_Edge','Ford_Expedition','Ford_F-150','Ford_Mustang','Mercedes_S-Class','Porsche_Boxter','Porsche_Carrera','Taxi'],bus:['Bus'],bike:['Mountain_Bike','City_Bike']} as const;
export const PLANT_BEDS:Record<PlantBed,{label:string;cga:string;pot:boolean;round:boolean}>={'curb-round':{label:'Хашлагатай дугуй нүх',cga:'Curbs (Round)',pot:false,round:true},'curb-rect':{label:'Хашлагатай тэгш өнцөгт нүх',cga:'Curbs (Rect)',pot:false,round:false},'pot-round':{label:'Дугуй ваар',cga:'Pot (Round)',pot:true,round:true},'pot-rect':{label:'Тэгш өнцөгт ваар',cga:'Pot (Rect)',pot:true,round:false}};
export const GROUND_COVER:Record<GroundCover,{label:string;cga:string;surface:Surface}>={grass:{label:'Зүлэг',cga:'Grass',surface:'grass'},soil:{label:'Шороо',cga:'Soil',surface:'soil'},flowers:{label:'Цэцэг (сарнай)',cga:'Flowers',surface:'soil'}};
/** CGA Lamp.cga-ийн asset (/ESRI.lib/assets/Webstyles/StreetScene/*.glb) = «EsriRealisticStreetSceneStyle». */
export const LAMPS:Record<LampType,{label:string;cga:string;webStyle:string;height:number}>={
 'simple':{label:'Энгийн шон',cga:'Simple Light',webStyle:'Light_On_Post_-_Light_off',height:4.5},
 'two-sided':{label:'Хоёр талын',cga:'Two Sided Light',webStyle:'Overhanging_Street_and_Sidewalk_-_Light_off',height:9},
 'to-street':{label:'Зам руу унжсан',cga:'Light to Right',webStyle:'Overhanging_Street_-_Light_off',height:9},
 'to-sidewalk':{label:'Явган зам руу',cga:'Light to Left',webStyle:'Overhanging_Sidewalk_-_Light_off',height:6},
};
export const FURNITURE={bench:{label:'Сандал',cga:'Simple Bench',webStyle:'Park_Bench_1'},'bench-2':{label:'Түшлэгтэй сандал',cga:'Bench',webStyle:'Park_Bench_2'},table:{label:'Ширээ',cga:'Table',webStyle:'Picnic_Table'},'bike-rack':{label:'Дугуйн тавиур',cga:'Bike Rack',webStyle:'Bike_Rack'},trash:{label:'Хогийн сав',cga:'Simple Bench',webStyle:'Trash_Bin_1'}} as const;
export type FurnitureType=keyof typeof FURNITURE;

type LaneSpec={label:string;cga:string;raised:boolean;drive?:boolean;carriageway:boolean;surface:Surface;width:number};
/** level: carriageway = хучилтын түвшин (замын өргөнд орно); raised = хашлагын түвшин. width = UI-д нэмэх анхны өргөн. */
export const LANE_KINDS:Record<LaneKind,LaneSpec>={
 car:{label:'Авто эгнээ',cga:'Streets/Lane/Vehicle/Car_Lane.cga',raised:false,drive:true,carriageway:true,surface:'dark_asphalt',width:3.5},
 bus:{label:'Автобусны эгнээ',cga:'Streets/Lane/Vehicle/Bus_Lane.cga',raised:false,carriageway:true,surface:'dark_asphalt',width:3.5},
 bike:{label:'Дугуйн эгнээ',cga:'Streets/Lane/Vehicle/Bike_Lane.cga',raised:false,carriageway:true,surface:'red_asphalt',width:1.8},
 unmarked:{label:'Тэмдэглэгээгүй эгнээ',cga:'Streets/Lane/Vehicle/Unmarked_Lane.cga',raised:false,drive:true,carriageway:true,surface:'dark_asphalt',width:3},
 parking:{label:'Зогсоолын эгнээ',cga:'Streets/Lane/Curbzone/Parking_Lane.cga',raised:false,carriageway:true,surface:'dark_asphalt',width:2.6},
 buffer:{label:'Будсан тусгаарлах зурвас',cga:'Streets/Lane/Buffer/Buffer_Lane.cga',raised:false,carriageway:true,surface:'dark_asphalt',width:1},
 // CGA-д тусдаа хажуу зурвас байхгүй: Unmarked_Lane + хайрга (нэмэлт материал, ТААМАГЛАЛ).
 shoulder:{label:'Хажуу зурвас (хайрга)',cga:'Streets/Lane/Vehicle/Unmarked_Lane.cga',raised:false,carriageway:false,surface:'gravel',width:1.5},
 sidewalk:{label:'Явган хүний зам',cga:'Streets/Lane/Sidewalk/Sidewalk_Lane.cga',raised:true,carriageway:false,surface:'light_concrete',width:2},
 lamp:{label:'Гэрэлтүүлгийн зурвас',cga:'Streets/Lane/Sidewalk/Lamp_Lane.cga',raised:true,carriageway:false,surface:'light_concrete',width:.8},
 furniture:{label:'Тавилгын зурвас',cga:'Streets/Lane/Sidewalk/Furniture_Lane.cga',raised:true,carriageway:false,surface:'light_concrete',width:1.2},
 bollard:{label:'Хаалт шонгийн зурвас',cga:'Streets/Lane/Sidewalk/Bollard_Lane.cga',raised:true,carriageway:false,surface:'light_concrete',width:.6},
 sidewalkPlant:{label:'Модны нүхтэй явган зам',cga:'Streets/Lane/Vegetation/Sidewalk_Plant_Lane.cga',raised:true,carriageway:false,surface:'light_concrete',width:1.5},
 vegetation:{label:'Ногоон зурвас',cga:'Streets/Lane/Vegetation/Vegetation_Buffer_Lane.cga',raised:true,carriageway:false,surface:'grass',width:2},
};
export const SURFACES:Record<Surface,{label:string;color:string;cga:string}>={
 dark_asphalt:{label:'Асфальт',color:'#58636b',cga:'Dark Asphalt'},red_asphalt:{label:'Улаан асфальт',color:'#a4554b',cga:'Red Asphalt'},
 green_asphalt:{label:'Ногоон асфальт',color:'#5d8a5b',cga:'Green Asphalt'},light_concrete:{label:'Цайвар бетон',color:'#c9c4b8',cga:'Light Concrete'},
 dark_concrete:{label:'Бараан бетон',color:'#9a968c',cga:'Dark Concrete'},paver:{label:'Хавтан',color:'#b9a58c',cga:'Paver Stacked Bond Grey'},
 gravel:{label:'Хайрга',color:'#a8988a',cga:'(нэмэлт) Gravel'},grass:{label:'Зүлэг',color:'#8faf72',cga:'Grass'},soil:{label:'Шороо',color:'#8d7a62',cga:'Soil'},
};
export const CLASS_LABEL:Record<StreetClass,string>={
 'urban-arterial':'Суурьшлын магистраль','urban-collector':'Суурьшлын цуглуулах гудамж','urban-local':'Суурьшлын орон нутгийн гудамж',
 'industrial':'Үйлдвэрийн дотоод зам','service-track':'Салхи/нарны үйлчилгээний зам','connector':'Бүс хоорондын холбох зам',
};
/** Уулзварын давуу эрх (их = гол зам). Тэнцүү бол бүх ойртолтод зогсох шугам. */
export const CLASS_RANK:Record<StreetClass,number>={connector:5,'urban-arterial':4,'urban-collector':3,industrial:2,'urban-local':1,'service-track':0};

export function streetClass(road:Pick<Road,'use'|'width'|'lanes'|'median'|'speed'>):StreetClass{
 if(road.use==='residential')return (road.median??0)>0||road.lanes>=2?'urban-arterial':road.speed>=30?'urban-collector':'urban-local';
 if(road.use==='industrial')return road.width<7?'service-track':'industrial';
 return 'connector';
}

/** Хоёр эгнээний хоорондох хилийн тэмдэглэгээ: зүүн эгнээний right эсвэл баруун эгнээний left (нэг удаа). */
export const boundaryMarking=(a:SectionLane|undefined,b:SectionLane|undefined):Marking=>{const x=a?.right??'none';return x!=='none'?x:b?.left??'none';};
/** Замын хучилтын хэсэг (тэнхлэг дундаа). Чиглэл бүрт lanes эгнээ; голын тусгаарлах зурвас median. Зүүнээс баруун тийш. */
function carriageway(cls:StreetClass,width:number,lanes:number,median:number):SectionLane[]{
 const laneW=(width-median)/(2*lanes),kind:LaneKind=cls==='service-track'?'unmarked':'car',marked=kind!=='unmarked';
 // ТААМАГЛАЛ: чиглэл бүрт 1 эгнээ бол голын тасархай, 2+ бол давхар үргэлжилсэн (CGA Street_Modern_Standard Centerline-ийн санаа). ШАЛГАХ: MNS 4597.
 const centre:Marking=!marked?'none':lanes>1?'continuous-double':'dashed',sep:Marking=marked?'dashed':'none';
 const edge:Marking=cls==='connector'||cls==='industrial'?'continuous':'none',atMedian:Marking=marked?'continuous':'none';
 // reverse: гаднаас дотогш; forward: дотроос гадагш.
 const reverse:SectionLane[]=Array.from({length:lanes},(_,i)=>({kind,width:laneW,dir:'reverse',left:i===0?edge:'none',right:i<lanes-1?sep:median>0?atMedian:centre}));
 const forward:SectionLane[]=Array.from({length:lanes},(_,i)=>({kind,width:laneW,dir:'forward',left:i===0&&median>0?atMedian:'none',right:i<lanes-1?sep:edge}));
 // ТААМАГЛАЛ: голын ногоон зурваст хус 10 м алхамтай (CGA Vegetation_Buffer_Lane Plant_Distance), хоёр талын гэрэл.
 return median>0?[...reverse,{kind:'vegetation',width:median,plant:{type:'Paper Birch',spacing:CGA.plantSpacing},lamp:{type:'two-sided',spacing:35}},...forward]:[...reverse,...forward];
}
// ТААМАГЛАЛ: гэрлийн алхам 30–35 м нь концепц тоо хэмжээний утга (CGA Lamp_Lane-ийн 10 м нь жишээ). ШАЛГАХ: гэрэлтүүлгийн тооцоо, норм.
const LAMP_SPACING=30;
/** Хучилтын гаднах хэсэг (тэнхлэгээс гадагш дарааллаар). ТААМАГЛАЛ: анхны концепц утга, UI-аар засна. */
function roadside(cls:StreetClass,side:'left'|'right'):SectionLane[]{
 switch(cls){
  case 'urban-arterial':case 'urban-collector':return[{kind:'vegetation',width:2,lamp:{type:'to-street',spacing:LAMP_SPACING}},{kind:'bike',width:2,raised:true,dir:side==='right'?'forward':'reverse'},{kind:'sidewalk',width:3}];
  case 'urban-local':return[{kind:'vegetation',width:1.5,lamp:{type:'simple',spacing:LAMP_SPACING}},{kind:'sidewalk',width:2.5}];
  // Үйлдвэр: баруун талд ажилчдын явган зам, зүүн талд ногоон зурвас. ТААМАГЛАЛ.
  case 'industrial':return side==='right'?[{kind:'sidewalk',width:1.5,lamp:{type:'simple',spacing:LAMP_SPACING}}]:[{kind:'vegetation',width:1}];
  case 'connector':return[{kind:'shoulder',width:1.5}];
  default:return[];
 }
}
const reversed=(lanes:SectionLane[])=>[...lanes].reverse().map(l=>({...l,left:l.right,right:l.left}));
export function templateSection(cls:StreetClass,road:Pick<Road,'width'|'lanes'|'median'>):StreetSection{
 const lanes=[...reversed(roadside(cls,'left')).map(l=>({...l,left:undefined,right:undefined})),...carriageway(cls,road.width,Math.max(1,road.lanes),road.median??0),...roadside(cls,'right').map(l=>({...l,left:undefined,right:undefined}))];
 return {cls,lanes,crossing:cls==='connector'||cls==='service-track'?'none':'zebra',stopLines:cls!=='service-track',source:'derived'};
}
const CGA_PARKING_LANE=2.5;
/** Суурьшлын төлөвлөгөөний бодит огтлолоос (rules.ts section) — хадгалалтад орно. */
export function urbanStreetSection(cls:'arterial'|'collector'|'local',x:{walk:number;bike:number;verge:number;median:number;lanes:number;sep?:number;service?:number},laneW:number):StreetSection{
 const c=cls==='arterial'?'urban-arterial':cls==='collector'?'urban-collector':'urban-local',width=2*x.lanes*laneW+x.median;
 // Туслах зам (тэнхлэгээс гадагш): тусгаарлах ногоон зурвас | нэг чиглэлийн эгнээ (үндсэн замтай ижил чиглэл) | зогсоолын эгнээ (≥ 5.8 м бол).
 // ТААМАГЛАЛ: туслах замын эгнээ = service − 2.5 (зогсоол), зогсоолгүй бол бүтэн өргөн. ШАЛГАХ: БНбД 30-01-04.
 const service=(s:'left'|'right'):SectionLane[]=>{if(!x.service||!x.sep)return[];const dir:Direction=s==='right'?'forward':'reverse',park=x.service>=5.8?CGA_PARKING_LANE:0;
  return[{kind:'vegetation',width:x.sep,plant:{type:'Paper Birch',spacing:CGA.plantSpacing}},{kind:'car',width:x.service-park,dir,left:'none',right:'none'},...(park?[{kind:'parking' as const,width:park,dir}]:[])];};
 const side=(s:'left'|'right'):SectionLane[]=>[...service(s),...(x.verge>0?[{kind:'vegetation' as const,width:x.verge,lamp:{type:(c==='urban-local'?'simple':'to-street') as LampType,spacing:LAMP_SPACING}}]:[]),...(x.bike>0?[{kind:'bike' as const,width:x.bike,raised:true,dir:(s==='right'?'forward':'reverse') as Direction}]:[]),...(x.walk>0?[{kind:'sidewalk' as const,width:x.walk}]:[])];
 // Туслах замын эгнээний тэмдэглэгээ (left/right) хадгалагдана; бусад эгнээнийх хоосон.
 const clean=(l:SectionLane)=>l.kind==='car'?l:{...l,left:undefined,right:undefined};
 return {cls:c,lanes:[...reversed(side('left')).map(clean),...carriageway(c,width,x.lanes,x.median),...side('right').map(clean)],crossing:'zebra',stopLines:true,source:'urban-plan'};
}

export type LaneSlot={index:number;lane:SectionLane;x0:number;x1:number;center:number;raised:boolean;carriageway:boolean;dir:Direction;side:'left'|'right'|'center'};
export type SectionLayout={slots:LaneSlot[];width:number;median:number;left:number;right:number;outerLeft:number;outerRight:number;forward:LaneSlot[];reverse:LaneSlot[]};
const raisedOf=(l:SectionLane)=>l.raised??LANE_KINDS[l.kind].raised;
const onCarriageway=(l:SectionLane)=>LANE_KINDS[l.kind].carriageway&&!raisedOf(l);
/** x: хучилтын төвөөс баруун тийш эерэг (offsetPath-ийн тэмдэгтэй ижил). */
export function sectionLayout(section:StreetSection):SectionLayout{
 const lanes=section.lanes,first=lanes.findIndex(onCarriageway),last=lanes.length-1-[...lanes].reverse().findIndex(onCarriageway);
 const start=first<0?0:lanes.slice(0,first).reduce((s,l)=>s+l.width,0),end=first<0?0:lanes.slice(0,last+1).reduce((s,l)=>s+l.width,0),c=(start+end)/2;
 let x=-c;const slots:LaneSlot[]=lanes.map((lane,index)=>{const x0=x,x1=x+lane.width;x=x1;const inside=first>=0&&index>=first&&index<=last,center=(x0+x1)/2;
  const dir=lane.dir??(LANE_KINDS[lane.kind].drive||lane.kind==='bus'||lane.kind==='bike'||lane.kind==='parking'?center>=0?'forward':'reverse':'undefined');
  return{index,lane,x0,x1,center,raised:raisedOf(lane),carriageway:inside,dir,side:center<-1e-9?'left':center>1e-9?'right':'center'};});
 const median=slots.filter(s=>s.carriageway&&s.raised).reduce((s,l)=>s+l.lane.width,0);
 const drive=(s:LaneSlot)=>s.carriageway&&!s.raised&&(LANE_KINDS[s.lane.kind].drive??false);
 const forward=slots.filter(s=>drive(s)&&(s.dir==='forward'||s.dir==='both')).sort((a,b)=>a.center-b.center);
 const reverse=slots.filter(s=>drive(s)&&(s.dir==='reverse'||s.dir==='both')).sort((a,b)=>b.center-a.center);
 return{slots,width:end-start,median,left:start-c,right:end-c,outerLeft:-c,outerRight:x,forward,reverse};
}

/** Хуучин хадгалалт (section-гүй) ба загварын тохиргоог нэг огтлол болгоно. Хучилтын өргөн road.width хэвээр. */
export function sectionForRoad(road:Road,design?:StreetDesign|null):StreetSection{
 const cls=road.section?.cls??streetClass(road),custom=design?.classes?.[cls],options=design?.options?.[cls];
 if(custom?.length){const fitted=fitToWidth(custom,road.width);if(fitted)return{cls,lanes:fitted,crossing:road.section?.crossing??(cls==='connector'||cls==='service-track'?'none':'zebra'),stopLines:road.section?.stopLines??cls!=='service-track',source:'design',...options};}
 const base=road.section&&Math.abs(sectionLayout(road.section).width-road.width)<.05?road.section:templateSection(cls,road);
 return options?{...base,...options}:base;
}
/** Загварын хучилтын бус эгнээг хадгалж, авто/автобусны эгнээг замын бодит өргөнд тэнцүү тааруулна. */
export function fitToWidth(lanes:SectionLane[],width:number):SectionLane[]|null{
 const layout=sectionLayout({cls:'connector',lanes,crossing:'none',stopLines:false,source:'design'}),flex=layout.slots.filter(s=>s.carriageway&&!s.raised&&(s.lane.kind==='car'||s.lane.kind==='bus'||s.lane.kind==='unmarked'));
 if(!flex.length)return null;const fixed=layout.width-flex.reduce((s,f)=>s+f.lane.width,0),each=(width-fixed)/flex.length;
 if(!(each>=DESIGN_VEHICLES.car.width+.4))return null;
 return lanes.map((l,i)=>flex.some(f=>f.index===i)?{...l,width:each}:{...l});
}

export type SectionIssue={level:'error'|'warning';lane?:number;message:string};
/** CGA дүрмийн доторх шалгалт + төслийн норм (NORM, DESIGN_VEHICLES). */
export function validateSection(section:StreetSection,road?:Pick<Road,'width'|'median'|'engineMode'>):SectionIssue[]{
 const issues:SectionIssue[]=[],layout=sectionLayout(section),slots=layout.slots;
 if(!slots.some(s=>s.carriageway))issues.push({level:'error',message:'Хучилттай эгнээ алга.'});
 if(road&&Math.abs(layout.width-road.width)>.05)issues.push({level:'error',message:`Хучилтын өргөн ${layout.width.toFixed(2)} м нь замын ${road.width.toFixed(2)} м-тэй таарахгүй.`});
 const inner=slots.filter(s=>s.carriageway&&s.raised);
 if(inner.length&&inner.some((s,i)=>i&&s.index!==inner[i-1].index+1))issues.push({level:'error',message:'Хучилтын дотор өргөгдсөн тусгаарлах зурвас нэгээс олон байна.'});
 if(!layout.forward.length&&!layout.reverse.length&&section.cls!=='service-track')issues.push({level:'error',message:'Авто хөдөлгөөний эгнээ алга.'});
 const truck=DESIGN_VEHICLES.truck.width+.4,carMin=DESIGN_VEHICLES.car.width+.4;
 for(const s of slots){const l=s.lane;
  if(!(l.width>0))issues.push({level:'error',lane:s.index,message:`${LANE_KINDS[l.kind].label}: өргөн 0-ээс их байх ёстой.`});
  if((l.kind==='car'||l.kind==='bus'||l.kind==='unmarked')&&l.width<carMin)issues.push({level:'error',lane:s.index,message:`${LANE_KINDS[l.kind].label} ${l.width.toFixed(2)} м < суудлын машин + 2×0.2 м = ${carMin.toFixed(2)} м.`});
  else if((l.kind==='car'||l.kind==='bus')&&(section.cls==='industrial'||section.cls==='connector'||l.kind==='bus')&&l.width<truck)issues.push({level:'warning',lane:s.index,message:`${LANE_KINDS[l.kind].label} ${l.width.toFixed(2)} м < SU-30 + 2×0.2 м = ${truck.toFixed(2)} м.`});
  // ТААМАГЛАЛ/ШАЛГАХ: NORM.bike [1.5, 2] м, NORM.walk 2.0 м (lib/urban.ts).
  if(l.kind==='bike'&&l.width<1.5)issues.push({level:'warning',lane:s.index,message:`Дугуйн эгнээ ${l.width.toFixed(2)} м < 1.5 м (NORM.bike).`});
  if(l.kind==='sidewalk'&&l.width<2&&!section.cls.startsWith('industrial'))issues.push({level:'warning',lane:s.index,message:`Явган зам ${l.width.toFixed(2)} м < 2.0 м (NORM.walk).`});
  if(l.kind==='parking'){const p=l.parking??{type:'parallel'},across=parkingAcross(p.type,!!road?.engineMode);
   // Lane/Curbzone/Parking_Lane.cga: «Lane is too narrow to accomodate parking.»
   if(across>=l.width+.05)issues.push({level:'error',lane:s.index,message:`Зогсоол багтахгүй: ${across.toFixed(2)} м шаардлагатай, эгнээ ${l.width.toFixed(2)} м.`});
   if(!s.carriageway)issues.push({level:'error',lane:s.index,message:'Зогсоолын эгнээ хучилттай хэсэгт залгаа байх ёстой.'});}
  if(l.plant&&!(l.plant.spacing>=PLANTS[l.plant.type].radius))issues.push({level:'warning',lane:s.index,message:'Модны алхам титмийн радиусаас бага.'});
  // Sidewalk_Plant_Lane.cga: нүх эгнээнд багтах (хашлага 0.1 м хоёр талд).
  if(l.kind==='sidewalkPlant'&&l.bed&&l.bed.diameter+2*CGA.curbWidth>l.width+1e-6)issues.push({level:'error',lane:s.index,message:`Модны нүх ${l.bed.diameter.toFixed(2)} м эгнээнд (${l.width.toFixed(2)} м) багтахгүй.`});
  if(l.vehicles&&l.vehicles!=='none'&&!(l.kind==='parking'||l.kind==='car'||l.kind==='bus'||l.kind==='bike'))issues.push({level:'warning',lane:s.index,message:'Vehicle_Density зөвхөн авто, автобус, дугуй, зогсоолын эгнээнд.'});
  if(l.lamp&&!(l.lamp.spacing>=5))issues.push({level:'warning',lane:s.index,message:'Гэрлийн алхам 5 м-ээс бага.'});
 }
 return issues;
}
/** Legacy Parking.cga reserves two paint margins. The supplied Street Modern
 * engine puts the divider inside the lane: its 2.3 m stall fits a 2.4 m lane. */
export function parkingAcross(type:ParkingType,guide=false){const {width,length,line}=CGA.parking,angle=type==='parallel'?0:type==='perpendicular'?90:45,margin=guide?0:2*line;
 if(angle===0)return width+margin;if(angle===90)return length+margin;const r=angle*Math.PI/180,len=length+width/Math.tan(r);return Math.cos(Math.PI/2-r)*len+margin;}
/** Parking.cga getSpotSizeAlong(). Өнцөгт зогсоолд CGA өргөнийг ашигладаг. */
export const parkingAlong=(type:ParkingType)=>type==='parallel'?CGA.parking.length:type==='perpendicular'?CGA.parking.width:CGA.parking.width/Math.sin(Math.PI/4);

/** Хуучин/шинэ мөрөөс огтлолыг шалгаж, эвдэрсэн бол хасна (замыг өөрийг нь хэвээр). */
export function validSection(value:unknown):StreetSection|undefined{
 if(!value||typeof value!=='object')return;const v=value as Partial<StreetSection>;
 if(!v.cls||!(v.cls in CLASS_LABEL)||!Array.isArray(v.lanes)||!v.lanes.length||v.lanes.length>40)return;
 const lanes=v.lanes.filter(l=>l&&typeof l==='object'&&l.kind in LANE_KINDS&&Number.isFinite(l.width)&&l.width>0&&l.width<60);
 if(lanes.length!==v.lanes.length)return;
 return{cls:v.cls,lanes:lanes.map(l=>({...l})),crossing:v.crossing&&v.crossing in CROSSWALKS?v.crossing:'zebra',stopLines:v.stopLines!==false,source:v.source==='urban-plan'||v.source==='design'?v.source:'derived',
  ...(v.stop&&v.stop in STOPS?{stop:v.stop}:{}),...(v.crosswalkColor==='yellow'?{crosswalkColor:'yellow' as const}:{}),...(v.centerline==='yellow'?{centerline:'yellow' as const}:{})};
}

// ---------- CityEngine экспорт: эгнээ бүрийн дүрэм ба attr (CGA нэр, утгаар) ----------
const MARK:Record<Marking,string>={none:'None',continuous:'Continuous',dashed:'Dashed','continuous-double':'Continuous-Double','dashed-double':'Dashed-Double','dashed+continuous':'Dashed + Continuous','continuous+dashed':'Continuous + Dashed'};
const DIR:Record<Direction,string>={forward:'Forward',reverse:'Reverse',both:'Both',undefined:'Undefined'};
const FILL:Record<FillPattern,string>={none:'None',solid:'Solid',along:'Lines Along',across:'Lines Accross','diagonal-forward':'Diagonal Forward','diagonal-backward':'Diagonal Backward',cross:'Cross','diagonal-cross':'Diagonal Cross','arrow-forward':'Arrow Forward','arrow-backward':'Arrow Backward'};
const DENSITY:Record<VehicleDensity,string>={none:'None',low:'Low',medium:'Medium',high:'High'};
const PARK:Record<ParkingType,string>={parallel:'Parallel',perpendicular:'Perpendicular',diagonal:'Diagonal'};
const ELEMENT:Record<ParkingElement,string>={empty:'Empty Space','curb-extension':'Curb Extension','bike-rack':'Bike Rack','tree-bed':'Vegetation',planter:'Planter'};
/** Features From CityEngine Rules / CityEngine-д шууд хэрэглэх attr (Lane/** дүрмийн attr нэр). */
export function cgaLaneAttributes(slot:LaneSlot,crossing:'None'|'Start'|'End'|'Both'='None'):Record<string,string|number>{
 const l=slot.lane,spec=LANE_KINDS[l.kind],a:Record<string,string|number>={rule_file:spec.cga,start_rule:'Start',travelDirection:DIR[slot.dir],shapeType:spec.carriageway||l.kind==='shoulder'?'Street':'Sidewalk',sidewalkSide:slot.side==='left'?'Left':'Right',Crossing_Position:crossing};
 if(l.kind==='car'||l.kind==='bus'||l.kind==='bike')Object.assign(a,{Travel_Direction:DIR[slot.dir],Left_Marking_Style:MARK[l.left??'none'],Right_Marking_Style:MARK[l.right??'none'],Symbol:SYMBOLS[laneSymbol(l)].cga,Vehicle_Density:DENSITY[l.vehicles??'none']});
 if(l.kind==='parking'){const p=l.parking??{type:'parallel',perGroup:CGA.parking.perGroup,element:'empty',elementLength:CGA.parking.elementLength};Object.assign(a,{Travel_Direction:DIR[slot.dir],Parking_Type:PARK[p.type],Element_Type:ELEMENT[p.element],Element_Active:'true',Element_Length:p.elementLength,Number_Of_Parkings:p.perGroup,Curb_Height:0,Vehicle_Density:DENSITY[l.vehicles??'none']});}
 if(l.kind==='buffer')Object.assign(a,{Fill_Pattern_Type:FILL[l.fill??'diagonal-forward'],Bollard_Type:l.bollard?'Black':'None'});
 if(l.kind==='sidewalk'||l.kind==='lamp'||l.kind==='furniture'||l.kind==='bollard'||l.kind==='sidewalkPlant'||l.kind==='vegetation')a.Curb_Height=slot.raised?CGA.curbHeight:0;
 if(l.kind==='lamp'){a.Lamp_Type=LAMPS[l.lamp?.type??'simple'].cga;a.Spacing=l.lamp?.spacing??CGA.lampSpacing;}
 if(l.kind==='furniture'){a.Furniture_Type=FURNITURE[l.furniture?.type??'bench'].cga;a.Spacing=l.furniture?.spacing??CGA.furnitureSpacing;}
 if(l.kind==='bollard'){a.Bollard_Type='Black';a.Spacing=l.bollard?.spacing??CGA.bollardSpacing;}
 if(l.kind==='sidewalkPlant'){const bed=l.bed??{type:'curb-round',diameter:1.2};a.Plant_Type=l.plant?.type??'Basswood';a.Spacing=l.plant?.spacing??CGA.plantSpacing;a.Ground_Cover=GROUND_COVER[l.ground??'soil'].cga;a.Plant_Bed_Type=PLANT_BEDS[bed.type].cga;a.Plant_Bed_Diameter=bed.diameter;}
 if(l.kind==='vegetation'){a.Plant_Type=l.plant?.type??'None';a.Plant_Distance=l.plant?.spacing??CGA.plantSpacing;a.Ground_Cover=GROUND_COVER[l.ground??'grass'].cga;}
 return a;
}
/** Bike_Lane / Bus_Lane-ийн анхны Symbol (Lane_Symbol.bike / bus); Car_Lane = None. */
export const laneSymbol=(l:SectionLane):LaneSymbol=>l.symbol??(l.kind==='bike'?'bike':l.kind==='bus'?'bus':'none');
/** Street_Modern_Standard.cga-ийн гудамжны тэнхлэгийн attr (CityEngine street graph-д). */
export function cgaStreetAttributes(section:StreetSection,stopBegin:boolean,stopEnd:boolean,crossBegin:boolean,crossEnd:boolean){
 const layout=sectionLayout(section),stop=STOPS[section.stop??'line'].cga,cross=CROSSWALKS[section.crossing==='none'?'zebra':section.crossing].cga;
 return{rule_file:'Streets/Street_Modern_Standard.cga',start_rule:'Street',streetWidth:layout.width,laneWidth:layout.forward[0]?.lane.width??layout.reverse[0]?.lane.width??layout.width,NbrOfRightLanes:layout.forward.length,Centerline:layout.median>0||!layout.forward.length||!layout.reverse.length?'none':section.centerline??'white',RoadTraffic:'right-hand',StopBegin:stopBegin?stop:'none',StopEnd:stopEnd?stop:'none',CrosswalkBegin:crossBegin?cross:'none',CrosswalkEnd:crossEnd?cross:'none',CrosswalkColor:section.crosswalkColor??'white'};
}

const applied=new WeakMap<Road[],WeakMap<StreetDesign,Road[]>>();
/** Үндсэн төлөвлөгөөний загварыг замд хэрэглэнэ: хучилтын өргөн, тэнхлэг хэвээр; голын зурвас огтлолоос. */
export function applyStreetDesign(roads:Road[],design?:StreetDesign|null):Road[]{
 if(!design||!Object.values(design.classes??{}).some(l=>l?.length)&&!Object.keys(design.options??{}).length)return roads;
 let byDesign=applied.get(roads);if(!byDesign){byDesign=new WeakMap();applied.set(roads,byDesign);}
 const old=byDesign.get(design);if(old)return old;
 const out=roads.map(r=>{const section=sectionForRoad(r,design);if(section.source!=='design'&&!design.options?.[section.cls])return r;const median=sectionLayout(section).median;return{...r,section,median,lanes:Math.max(1,Math.max(sectionLayout(section).forward.length,sectionLayout(section).reverse.length))};});
 byDesign.set(design,out);return out;
}
