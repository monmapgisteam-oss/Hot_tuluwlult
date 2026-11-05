// Presentation only: retain the planning geometry, quantities and tree dimensions.
import {Model} from './models';
import {GROUND, MASS, TREE, type GroundKind, type MassKind} from './zoning';
import type {GroundF, TreeF, MassF, MarkF} from './rules';
import type {Rings, XY} from './geom';
import {urbanWindowLayout} from './urbanWindowGeometry';

const groundColors: Record<GroundKind, string> = {
 grass:'#929a73', protect:'#748269', verge:'#85906c', walk:'#c4bca7',
 plaza:'#c3beb0', play:'#6f97a3', sand:'#d8cba0', sport:'#71877a', court:'#5f7f99', track:'#a26e58',
 parking:'#626565', yard:'#aaa79e', road:'#53585a', sidewalk:'#c6c1b4', bike:'#a78370',
};
const massColors: Record<MassKind, string> = {
 res:'#ded8c9', com:'#b5aca0', office:'#b6bfc1', kinder:'#d3c3a4',
 school:'#c4b4a7', clinic:'#dddcd3', eng:'#a6aaa6', roof:'#9a9e9f', pv:'#354e5c', groof:'#778664',
};
const tone = (hex:string, shift:number) => [1,3,5].map(i=>Math.max(0,Math.min(255,parseInt(hex.slice(i,i+2),16)+shift)));
const variation = (x:number,y:number) => Math.abs(Math.round(x*13+y*7))%3;

/** Keep parking/crosswalk paint in one multipart feature, including saved scenes. */
export function urbanMarkRows(marks:MarkF[]){
 const rings=marks.flatMap(m=>m.rings).filter(r=>r.length>=4).map(r=>{
  let winding=0;for(let i=1;i<r.length;i++)winding+=(r[i][0]-r[i-1][0])*(r[i][1]+r[i-1][1]);
  return winding>=0?r:[...r].reverse();
 });
 return rings.length?[{g:rings,a:{}}]:[];
}

export function urbanGroundRows(items:GroundF[]) {
 return items.map(o=>{const [x,y]=o.rings[0]?.[0]??[0,0];return {g:o.rings,a:{k:o.k,surface:`${o.k}:${variation(x,y)}`,lot:o.lot??0}};});
}
export function urbanGroundRenderer() {
 return {type:'unique-value',field:'surface',uniqueValueInfos:Object.entries(GROUND).flatMap(([k,m])=>[0,1,2].map(v=>({
  value:`${k}:${v}`,label:m.label,symbol:{type:'simple-fill',color:tone(groundColors[k as GroundKind],(v-1)*4),outline:{width:0}},
 })))};
}
export function urbanMassSymbol(k:MassKind) {
 return {type:'polygon-3d',symbolLayers:[{type:'extrude',size:1,material:{color:massColors[k]}}]};
}
export function urbanMassRenderer() {
 return {type:'unique-value',field:'k',uniqueValueInfos:Object.entries(MASS).map(([value,m])=>({value,label:m.label,symbol:urbanMassSymbol(value as MassKind)})),
  visualVariables:[{type:'size',field:'h',valueUnit:'meters'}]};
}

const trees = new Map<number,string>();
function treeModel(kind:number) {
 const cached=trees.get(kind);if(cached)return cached;
 // glTF factors are linear colours: low values keep sunlit foliage green rather than mint.
 const m=new Model(),bark=m.part([.07,.05,.032],0,.97);
 const leaf=m.part(kind===0?[.022,.065,.032]:[.055,.102,.025],0,.98);
 const light=m.part(kind===0?[.032,.082,.037]:[.070,.125,.034],0,.96);
 // Models have a one-metre nominal height; feature dimensions scale every instance.
 m.pipe(bark,[0,0,0],[0,kind===2?.4:.78,0],kind===2?.045:.025,7);
 if(kind===0){
  for(let tier=0;tier<5;tier++){
   const y=.16+tier*.145,r=.37-tier*.066,top=Math.min(1,y+.31);
   const cx=Math.sin(tier*2.1)*.012,cz=Math.cos(tier*1.8)*.012,p=tier%3===1?light:leaf;
   const rim=(j:number,upper:boolean):[number,number,number]=>{
    const q=j%12,a=q*Math.PI/6+tier*.37,irregular=1+.10*Math.sin(q*2.1+tier)+.045*Math.cos(q*3.7);
    return [cx+Math.cos(a)*r*(upper?.28:irregular),upper?Math.min(top-.045,y+.20):y+.012*Math.sin(q*2.5),cz+Math.sin(a)*r*(upper?.28:irregular)];
   };
   for(let j=0;j<12;j++){
    const a=rim(j,false),b=rim(j+1,false),c=rim(j+1,true),d=rim(j,true);
    m.quad(p,a,d,c,b);
    m.tri(p,d,[cx,top,cz],c);
   }
  }
 }else{
  // Overlapping irregular crowns give silhouettes and self-shadowing without downloaded assets.
  for(let crown=0;crown<6;crown++){
   const a=crown*2.4,cx=crown?Math.cos(a)*.21:0,cz=crown?Math.sin(a)*.21:0;
   const cy=kind===2?.42+(crown%3)*.07:.64+(crown%3)*.07;
   const rx=kind===2?.29:.25,ry=kind===2?.33:.24,rz=rx*(.90+.035*(crown%3)),p=crown%3===1?light:leaf;
   if(kind!==2)m.pipe(bark,[0,.3,0],[cx,cy,cz],.012,5);
   const at=(lat:number,lon:number):[number,number,number]=>[cx+rx*Math.sin(lat)*Math.cos(lon),cy+ry*Math.cos(lat),cz+rz*Math.sin(lat)*Math.sin(lon)];
   // Ellipsoid-gradient normals are continuous across triangles, longitudes and the poles.
   const tri=(...vertices:[number,number,number][])=>{for(const v of vertices){
    const n=[(v[0]-cx)/(rx*rx),(v[1]-cy)/(ry*ry),(v[2]-cz)/(rz*rz)],length=Math.hypot(...n);
    p.positions.push(...v);p.normals.push(...n.map(x=>x/length));
   }};
   for(let lat=0;lat<6;lat++)for(let lon=0;lon<10;lon++){
    const a0=lat*Math.PI/6,a1=(lat+1)*Math.PI/6,b0=lon*Math.PI/5,b1=(lon+1)*Math.PI/5;
    if(lat>0)tri(at(a0,b0),at(a0,b1),at(a1,b1));
    if(lat<5)tri(at(a0,b0),at(a1,b1),at(a1,b0));
   }
  }
 }
 const href=m.export();trees.set(kind,href);return href;
}
export function urbanTreeRows(items:TreeF[]) {
 return items.map(t=>({g:[t.x,t.y] as XY,a:{t:t.t,h:t.h,d:t.r*2,heading:Math.abs(Math.round(t.x*19+t.y*31))%360}}));
}
export function urbanTreeRenderer() {
 return {type:'unique-value',field:'t',uniqueValueInfos:TREE.map((t,i)=>({value:i,label:t.label,symbol:{type:'point-3d',symbolLayers:[{
  type:'object',resource:{href:treeModel(i)},anchor:'bottom',
 }]}})),visualVariables:[{type:'size',field:'h',axis:'height',valueUnit:'meters'},{type:'size',field:'d',axis:'width-and-depth',valueUnit:'meters'},
  {type:'rotation',field:'heading',rotationType:'geographic'}]};
}

/** One multipart feature per floor, not a layer/feature per window. Only drawn nearby. */
export function urbanFacadeRows(masses:MassF[]) {
 const footprints=new Map<Rings,Rings>();
 return masses.filter(m=>m.fl>0&&m.h>1.8).flatMap(m=>{
  let windows=footprints.get(m.rings);
  if(!windows){
   windows=[];
   for(const edge of urbanWindowLayout(m.rings))for(const {s,width}of edge.windows){
     const {a,u,n}=edge,w=width/2;
     const p=(along:number,across:number):XY=>[a[0]+u[0]*along+n[0]*across,a[1]+u[1]*along+n[1]*across];
     // Glazing sits outside the retained wall and behind the projecting frame/reveal.
     const q=[p(s-w,.055),p(s-w,.085),p(s+w,.085),p(s+w,.055)];
     if(u[0]*n[1]-u[1]*n[0]<0)q.reverse();
     windows.push([...q,q[0]]);
   }
   footprints.set(m.rings,windows);
  }
  return windows.length?[{g:windows,a:{bid:m.bid,z0:m.z0+.85,h:Math.min(1.8,m.h-1.2),tone:(m.bid+m.fl)%3}}]:[];
 });
}
export function urbanFacadeRenderer(){
 return {type:'unique-value',field:'tone',defaultSymbol:{type:'polygon-3d',symbolLayers:[{type:'extrude',size:1,material:{color:'#4b6068'},castShadows:false}]},
  uniqueValueInfos:['#435760','#4b6068','#536970'].map((color,value)=>({value,symbol:{type:'polygon-3d',symbolLayers:[{type:'extrude',size:1,material:{color},castShadows:false}]}})),visualVariables:[{type:'size',field:'h',valueUnit:'meters'}]};
}
