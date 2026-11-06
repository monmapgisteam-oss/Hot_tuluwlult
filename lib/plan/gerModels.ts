// Ported from Bayandun/web/lib/yardModels.ts for the matching household-yard view.
// Native metre-scale procedural glTF. X = frontage, Y = up, +Z = street/front.
// Horizontal origin is the footprint centre; bottom is ground datum 0.
// PointSymbol3D must use anchor:"origin", height:model.height, width/depth:null.
export type YardBuildingKind = "house" | "parking" | "gazebo" | "greenhouse" | "shed";
export type YardRoof = "hip" | "gable" | "flat";
export type YardModel = {
  href: string; width: number; depth: number; height: number;
  foundationHeight: number; wallHeight: number; eaveHeight: number; roofRise: number; pitchDegrees: number;
};
type V3 = [number, number, number];
type Part = { positions: number[]; normals: number[]; color: number[]; metal: number; rough: number };

class Model {
  parts: Part[] = [];
  part(color: number[], metal = 0, rough = .75): Part {
    const p = { positions: [], normals: [], color, metal, rough };
    this.parts.push(p); return p;
  }
  tri(p: Part, a: V3, b: V3, c: V3) {
    const u = b.map((v, i) => v - a[i]), v = c.map((n, i) => n - a[i]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], length = Math.hypot(...n);
    if (length < 1e-10) return;
    p.positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) p.normals.push(...n.map(x => x / length));
  }
  quad(p: Part, a: V3, b: V3, c: V3, d: V3) { this.tri(p, a, b, c); this.tri(p, a, c, d); }
  box(p: Part, center: V3, size: V3) {
    const q = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]
      .map(v => v.map((n, i) => center[i] + n * size[i] / 2) as V3);
    for (const [a,b,c,d] of [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]]) this.quad(p, q[a], q[b], q[c], q[d]);
  }
  pipe(p: Part, a: V3, b: V3, radius: number, segments = 8) {
    const delta = b.map((v, i) => v - a[i]), length = Math.hypot(...delta);
    if (length < 1e-8) return;
    const u = delta.map(v => v / length), ref = Math.abs(u[1]) < .9 ? [0,1,0] : [1,0,0];
    const cross = (a: number[], b: number[]) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    const raw = cross(u, ref), n = raw.map(v => v / Math.hypot(...raw)), t = cross(u, n);
    const at = (c: V3, theta: number): V3 => c.map((v, i) => v + radius * (n[i] * Math.cos(theta) + t[i] * Math.sin(theta))) as V3;
    for (let i = 0; i < segments; i++) {
      const t0 = i * 2 * Math.PI / segments, t1 = (i + 1) * 2 * Math.PI / segments;
      const a0 = at(a, t0), a1 = at(a, t1), b0 = at(b, t0), b1 = at(b, t1);
      this.quad(p, a0, a1, b1, b0); this.tri(p, a, a1, a0); this.tri(p, b, b0, b1);
    }
  }
  export() {
    const accessors: object[] = [], bufferViews: object[] = [], chunks: Float32Array[] = [];
    let byteLength = 0;
    const add = (values: number[], bounds: boolean) => {
      const data = new Float32Array(values), min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
      for (let i = 0; i < data.length; i++) { min[i%3] = Math.min(min[i%3], data[i]); max[i%3] = Math.max(max[i%3], data[i]); }
      bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.byteLength });
      accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: data.length / 3, type: "VEC3", ...(bounds ? { min, max } : {}) });
      chunks.push(data); byteLength += data.byteLength; return accessors.length - 1;
    };
    const parts = this.parts.filter(p => p.positions.length);
    const primitives = parts.map((p, material) => ({ attributes: { POSITION: add(p.positions, true), NORMAL: add(p.normals, false) }, material }));
    const gltf = {
      asset: { version: "2.0", generator: "Bayandun metre-scale yard architecture" }, scene: 0,
      scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives }],
      materials: parts.map(p => ({ doubleSided: true, ...(p.color[3] < 1 ? { alphaMode: "BLEND" } : {}), pbrMetallicRoughness: { baseColorFactor: p.color.length === 4 ? p.color : [...p.color, 1], metallicFactor: p.metal, roughnessFactor: p.rough } })),
      accessors, bufferViews, buffers: [{ byteLength }],
    };
    const json = new TextEncoder().encode(JSON.stringify(gltf)), jsonLength = Math.ceil(json.length / 4) * 4;
    const buffer = new ArrayBuffer(28 + jsonLength + byteLength), view = new DataView(buffer), bytes = new Uint8Array(buffer);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, buffer.byteLength, true);
    view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + jsonLength); bytes.set(json, 20);
    view.setUint32(20 + jsonLength, byteLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true);
    let offset = 28 + jsonLength;
    for (const chunk of chunks) { bytes.set(new Uint8Array(chunk.buffer), offset); offset += chunk.byteLength; }
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return `data:model/gltf-binary;base64,${btoa(binary)}`;
  }
}

const colorOf = (hex: string, fallback = "#55616b") => {
  const c = /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback, n = parseInt(c.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};
const foundation = { house: .45, parking: .18, gazebo: .12, greenhouse: .1, shed: .15 };
const pitches = { house: 28, parking: 18, gazebo: 25, greenhouse: 0, shed: 18 };
const cache = new Map<string, YardModel>();

/** Heights are design geometry in metres, separate from DEM / sea-level elevation. */
export function yardBuildingHeights(kind: YardBuildingKind, width: number, depth: number, wallHeight: number, roof: YardRoof) {
  if (![width, depth, wallHeight].every(v => Number.isFinite(v) && v > 0)) throw new Error("Building dimensions must be positive finite metres.");
  const foundationHeight = foundation[kind], eaveHeight = foundationHeight + wallHeight;
  const pitchDegrees = kind === "greenhouse" || roof === "flat" ? 0 : pitches[kind];
  const roofRise = kind === "greenhouse" ? Math.min(1.3, Math.min(width, depth) * .24)
    : roof === "flat" ? .35 : Math.min(width, depth) / 2 * Math.tan(pitchDegrees * Math.PI / 180);
  return { width, depth, wallHeight, foundationHeight, eaveHeight, roofRise, pitchDegrees, height: eaveHeight + roofRise };
}

export function yardBuildingModel(kind: YardBuildingKind, width: number, depth: number, wallHeight: number, roof: YardRoof, colors: string[] = []): YardModel {
  const key = [kind,width,depth,wallHeight,roof,...colors].join(":"), old = cache.get(key);
  if (old) return old;
  const dims = yardBuildingHeights(kind, width, depth, wallHeight, roof);
  const { foundationHeight: base, eaveHeight: eave, roofRise, height } = dims;
  const m = new Model(), w = width, d = depth;
  const concrete = m.part([.47,.45,.4]), wall = m.part(kind === "house" ? [.83,.8,.7] : [.67,.65,.58]);
  const stone = m.part([.36,.34,.3]), wood = m.part([.38,.25,.14]), frame = m.part([.88,.87,.8], .25, .5);
  const glass = m.part([.13,.29,.36], .3, .18), dark = m.part([.12,.16,.18], .25, .55), metal = m.part([.57,.6,.59], .65, .5);
  const roofParts = [0,1,2,3].map(i => m.part(colorOf(colors[i % Math.max(colors.length, 1)] ?? "#46535d"), .22, .65));
  const box = (p: Part, x: number, y: number, z: number, sx: number, sy: number, sz: number) => m.box(p, [x,y,z], [sx,sy,sz]);
  box(concrete, 0, base / 2, 0, w, base, d);
  const wallW = Math.max(.2, w - .16), wallD = Math.max(.2, d - .16);

  const windowFront = (x: number, y: number, z: number, ww = 1.45, hh = 1.35) => {
    box(frame,x,y,z,ww+.14,hh+.14,.09); box(glass,x,y,z + Math.sign(z)*.05,ww,hh,.02);
    box(frame,x,y,z + Math.sign(z)*.065,.055,hh,.025); box(frame,x,y,z + Math.sign(z)*.065,ww,.045,.025);
  };
  const windowSide = (x: number, y: number, z: number, ww = 1.35, hh = 1.3) => {
    box(frame,x,y,z,.09,hh+.14,ww+.14); box(glass,x + Math.sign(x)*.05,y,z,.02,hh,ww);
    box(frame,x + Math.sign(x)*.065,y,z,.025,hh,.055); box(frame,x + Math.sign(x)*.065,y,z,.025,.045,ww);
  };

  if (kind === "gazebo") {
    // Open timber pavilion, not a solid extruded block.
    const postX = w / 2 - .22, postZ = d / 2 - .22;
    for (const x of [-postX, postX]) for (const z of [-postZ, postZ]) box(wood,x,base+wallHeight/2,z,.2,wallHeight,.2);
    for (const z of [-postZ, postZ]) box(wood,0,eave-.13,z,w-.2,.22,.18);
    for (const x of [-postX, postX]) box(wood,x,eave-.13,0,.18,.22,d-.2);
    const tableY = base + .8;
    box(wood,0,tableY,0,Math.min(2.3,w*.5),.12,Math.min(1.1,d*.35));
    for (const x of [-.7,.7]) box(wood,x,base+.4,0,.15,.8,.6);
    for (const z of [-Math.min(d*.3,1.25),Math.min(d*.3,1.25)]) {
      box(wood,0,base+.48,z,Math.min(2.5,w*.6),.12,.35);
      for (const x of [-.8,.8]) box(wood,x,base+.24,z,.12,.48,.28);
    }
  } else if (kind === "greenhouse") {
    const pane = m.part([.55,.8,.79,.3], .05, .15), soil = m.part([.29,.25,.16]), plants = m.part([.23,.44,.14]);
    const span = Math.min(w,d), length = Math.max(w,d), rotate = w > d;
    const at = (x: number, y: number, z: number): V3 => rotate ? [z,y,-x] : [x,y,z];
    for (const side of [-1,1]) m.quad(pane, at(side*span/2,base,-length/2), at(side*span/2,eave,-length/2), at(side*span/2,eave,length/2), at(side*span/2,base,length/2));
    const segments = 12, ribCount = Math.max(3,Math.ceil(length / .9));
    for (let j=0;j<=ribCount;j++) {
      const z = -length/2+j*length/ribCount;
      for (const x of [-span/2,span/2]) m.pipe(metal,at(x,base,z),at(x,eave,z),.026);
      for (let i=0;i<segments;i++) {
        const t0=i*Math.PI/segments,t1=(i+1)*Math.PI/segments;
        // Stay within declared top height, including the metal rib radius.
        const a=at(span/2*Math.cos(t0),eave+(roofRise-.027)*Math.sin(t0),z), b=at(span/2*Math.cos(t1),eave+(roofRise-.027)*Math.sin(t1),z);
        m.pipe(metal,a,b,.026);
        if(j<ribCount){const zn=-length/2+(j+1)*length/ribCount;
          m.quad(pane,at(span/2*Math.cos(t0),eave+roofRise*Math.sin(t0),z),at(span/2*Math.cos(t1),eave+roofRise*Math.sin(t1),z),at(span/2*Math.cos(t1),eave+roofRise*Math.sin(t1),zn),at(span/2*Math.cos(t0),eave+roofRise*Math.sin(t0),zn));}
      }
    }
    for (const z of [-length/2,length/2]) {
      m.quad(pane,at(-span/2,base,z),at(-span/2,eave,z),at(span/2,eave,z),at(span/2,base,z));
      for(let i=0;i<segments;i++)m.tri(pane,at(0,eave,z),at(span/2*Math.cos(i*Math.PI/segments),eave+roofRise*Math.sin(i*Math.PI/segments),z),at(span/2*Math.cos((i+1)*Math.PI/segments),eave+roofRise*Math.sin((i+1)*Math.PI/segments),z));
    }
    for (const x of [-w*.26,w*.26]) { box(soil,x,base+.12,0,w*.24,.24,d*.8);box(plants,x,base+.35,0,w*.2,.24,d*.76); }
    // Rib ends are inset so metal does not exceed the physical footprint.
    for (const p of m.parts) for(let i=0;i<p.positions.length;i+=3){p.positions[i]=Math.max(-w/2,Math.min(w/2,p.positions[i]));p.positions[i+2]=Math.max(-d/2,Math.min(d/2,p.positions[i+2]));}
  } else {
    box(wall,0,base+wallHeight/2,0,wallW,wallHeight,wallD);
    box(stone,0,base+.2,0,wallW+.03,.4,wallD+.03);
    if(kind === "parking") {
      const doorW=Math.min(3.2,w-.7), doorH=Math.min(2.35,wallHeight-.25), z=d/2-.085;
      box(dark,0,base+doorH/2,z,doorW+.18,doorH+.12,.06);
      box(metal,0,base+doorH/2,z+.025,doorW,doorH,.055);
      for(let y=.25;y<doorH;y+=.27)box(dark,0,base+y,z+.06,doorW-.08,.018,.012);
      for(const x of [-doorW*.3,0,doorW*.3])box(glass,x,base+doorH*.75,z+.065,doorW*.19,.27,.015);
      windowSide(-w/2+.085,base+1.9,0,Math.min(1.3,d*.3),.65);
    } else {
      const floors=kind === "house" ? Math.max(1,Math.round(wallHeight/3.2)) : 1;
      const floorHeight=wallHeight/floors;
      const frontZ=d/2-.085, sideX=w/2-.085;
      for(let floor=0;floor<floors;floor++){
        const y=base+floor*floorHeight+Math.min(1.8,floorHeight*.56);
        const ww=Math.min(1.5,w*.18),hh=Math.min(1.35,floorHeight*.44);
        for(const x of [-w*.29,w*.29]){windowFront(x,y,frontZ,ww,hh);windowFront(x,y,-frontZ,ww,hh);}
        for(const z of [-d*.27,d*.27]){windowSide(sideX,y,z,Math.min(1.4,d*.19),hh);windowSide(-sideX,y,z,Math.min(1.4,d*.19),hh);}
        if(floor>0)windowFront(0,y,frontZ,ww,hh);
      }
      const doorH=Math.min(2.15,wallHeight-.3),doorW=Math.min(1.05,w*.24);
      box(frame,0,base+doorH/2,frontZ,doorW+.16,doorH+.12,.1);
      box(wood,0,base+doorH/2,frontZ+.058,doorW,doorH,.025);
      box(glass,0,base+doorH*.73,frontZ+.075,doorW*.55,doorH*.27,.018);
      box(metal,doorW*.34,base+1,frontZ+.07,.05,.22,.018);
    }
  }

  if(kind !== "greenhouse") {
    const span=Math.min(w,d),length=Math.max(w,d),rotate=w>d;
    const at=(x:number,y:number,z:number):V3=>rotate?[z,y,-x]:[x,y,z];
    if(roof === "flat") {
      box(roofParts[0],0,eave-.05,0,w,.1,d);
      for(const x of [-w/2+.09,w/2-.09])box(roofParts[2],x,eave+roofRise/2,0,.18,roofRise,d);
      for(const z of [-d/2+.09,d/2-.09])box(roofParts[2],0,eave+roofRise/2,z,w,roofRise,.18);
      box(metal,-w*.2,eave+.12,-d*.15,Math.min(1.6,w*.25),.24,Math.min(1.1,d*.25));
    } else if(roof === "gable") {
      const a=at(-span/2,eave,-length/2),b=at(span/2,eave,-length/2),c=at(span/2,eave,length/2),e=at(-span/2,eave,length/2);
      const r0=at(0,height,-length/2),r1=at(0,height,length/2);
      m.quad(roofParts[0],a,e,r1,r0);m.quad(roofParts[1],b,r0,r1,c);
      m.tri(wall,a,b,r0);m.tri(wall,e,r1,c);
    } else {
      const ridge=Math.max(0,(length-span)/2),a=at(-span/2,eave,-length/2),b=at(span/2,eave,-length/2),c=at(span/2,eave,length/2),e=at(-span/2,eave,length/2),r0=at(0,height,-ridge),r1=at(0,height,ridge);
      m.quad(roofParts[0],a,e,r1,r0);m.quad(roofParts[1],b,r0,r1,c);m.tri(roofParts[2],a,r0,b);m.tri(roofParts[3],e,c,r1);
    }
    // A thin dark fascia and ridge cap make the roof depth readable, without changing footprint/height.
    for(const z of [-d/2+.035,d/2-.035])box(dark,0,eave-.045,z,w,.09,.07);
    for(const x of [-w/2+.035,w/2-.035])box(dark,x,eave-.045,0,.07,.09,d);
    if(roof !== "flat") {
      const ridgeLength=roof === "gable"?length:Math.max(.12,length-span);
      const c=at(0,height-.025,0),s:V3=rotate?[ridgeLength,.05,.1]:[.1,.05,ridgeLength];
      m.box(roofParts[1],c,s);
    }
  }
  const result={...dims,href:m.export()};
  cache.set(key,result);if(cache.size>64)cache.delete(cache.keys().next().value!);
  return result;
}

let car: YardModel | null = null;
export function yardCarModel(): YardModel {
  if(car)return car;
  const m=new Model(),paint=m.part([.85,.87,.84],.35,.3),trim=m.part([.1,.13,.15],.2),glass=m.part([.1,.22,.29],.4,.16),rubber=m.part([.055,.06,.06],0,.95),wheel=m.part([.54,.56,.56],.8,.3),light=m.part([.94,.94,.77]),red=m.part([.65,.09,.045]);
  m.box(paint,[0,.63,0],[1.72,.56,4.35]);
  for(const z of [-2.2,2.2])m.box(trim,[0,.47,z],[1.75,.17,.1]);
  for(const x of [-.81,.81])for(const z of [-1.34,1.34]){
    m.pipe(rubber,[x<0?-.9:.73,.31,z],[x<0?-.73:.9,.31,z],.31,16);
    m.pipe(wheel,[x<0?-.902:.9,.31,z],[x<0?-.899:.903,.31,z],.19,12);
  }
  // Sloped cabin, roof and actual window faces; nose points toward +Z/street.
  const a:V3=[-.73,.9,-1.1],b:V3=[.73,.9,-1.1],c:V3=[.73,.9,.85],d:V3=[-.73,.9,.85];
  const ar:V3=[-.58,1.5,-.65],br:V3=[.58,1.5,-.65],cr:V3=[.58,1.5,.28],dr:V3=[-.58,1.5,.28];
  m.quad(glass,a,b,br,ar);m.quad(glass,d,dr,cr,c);m.quad(glass,a,ar,dr,d);m.quad(glass,b,c,cr,br);m.quad(paint,ar,br,cr,dr);
  for(const x of [-.7,.7])m.box(trim,[x,1.1,-.18],[.05,.4,.08]);
  for(const x of [-.55,.55]){m.box(light,[x,.74,2.238],[.39,.17,.024]);m.box(red,[x,.72,-2.238],[.4,.15,.024]);}
  // Keep wheel hubs within the 1.8 m overall car width.
  for(const p of m.parts)for(let i=0;i<p.positions.length;i+=3)p.positions[i]=Math.max(-.9,Math.min(.9,p.positions[i]));
  car={href:m.export(),width:1.8,depth:4.5,height:1.5,foundationHeight:0,wallHeight:1.5,eaveHeight:1.5,roofRise:0,pitchDegrees:0};
  return car;
}

const treeCache = new Map<string,YardModel>();
/** Faceted multi-crown tree with a trunk and visible branches; no external tree assets. */
export function yardTreeModel(kind: "deciduous" | "conifer", height = 5, diameter = 3): YardModel {
  if (![height,diameter].every(v => Number.isFinite(v) && v > 0)) throw new Error("Tree dimensions must be positive finite metres.");
  const key=[kind,height,diameter].join(":"),cached=treeCache.get(key);if(cached)return cached;
  const m=new Model(),bark=m.part([.28,.22,.15]), greens=[[.22,.37,.17],[.3,.45,.2],[.38,.51,.24],[.25,.41,.19],[.43,.55,.27]].map(c=>m.part(c));
  m.pipe(bark,[0,0,0],[0,height*.74,0],diameter*.045,8);
  const leaf=(p:Part,center:V3,rx:number,ry:number,rz:number,seed:number)=>{
    // Compact faceted crowns keep neighbourhood-scale scenes light enough for integrated GPUs.
    const layers=4,sectors=7;
    const at=(j:number,i:number):V3=>{const phi=Math.PI*j/layers,t=2*Math.PI*i/sectors,ruffle=1+.1*Math.sin(i*2.2+j*1.9+seed);return[center[0]+rx*Math.sin(phi)*Math.cos(t)*ruffle,center[1]+ry*Math.cos(phi),center[2]+rz*Math.sin(phi)*Math.sin(t)*ruffle];};
    for(let j=0;j<layers;j++)for(let i=0;i<sectors;i++)m.quad(p,at(j,i),at(j+1,i),at(j+1,i+1),at(j,i+1));
  };
  if(kind==="deciduous"){
    for(let i=0;i<5;i++){
      const theta=i*2*Math.PI/5,x=Math.cos(theta)*diameter*.19,z=Math.sin(theta)*diameter*.19,y=height*(.61+.09*Math.sin(i*1.7));
      m.pipe(bark,[0,height*.37,0],[x,y,z],diameter*.018,5);
      leaf(greens[i%greens.length],[x,y,z],diameter*.24,height*.22,diameter*.24,i);
    }
    leaf(greens[2],[diameter*.02,height*.8,0],diameter*.28,height*.2,diameter*.28,9);
  }else{
    for(let level=0;level<5;level++){
      const y0=height*(.2+level*.13),y1=height*(.66+level*.085),r=diameter*.5*(1-level*.16),p=greens[level%greens.length];
      const n=12;
      for(let i=0;i<n;i++){
        const a=i*2*Math.PI/n,b=(i+1)*2*Math.PI/n;
        const r0=r*(i%2?.83:1),r1=r*((i+1)%2?.83:1);
        const v0:V3=[r0*Math.cos(a),y0+.035*height*Math.sin(i*2.3),r0*Math.sin(a)],v1:V3=[r1*Math.cos(b),y0+.035*height*Math.sin((i+1)*2.3),r1*Math.sin(b)];
        m.tri(p,v0,[0,y1,0],v1);
        m.tri(p,[0,y0,0],v1,v0);
      }
    }
  }
  // Normalize actual crown bounds, preserving explicit requested metre dimensions.
  const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
  for(const p of m.parts)for(let i=0;i<p.positions.length;i++){low[i%3]=Math.min(low[i%3],p.positions[i]);high[i%3]=Math.max(high[i%3],p.positions[i]);}
  const scale=[diameter/(high[0]-low[0]),height/(high[1]-low[1]),diameter/(high[2]-low[2])];
  const origin=[(high[0]+low[0])/2,low[1],(high[2]+low[2])/2];
  for(const p of m.parts){
    for(let i=0;i<p.positions.length;i++)p.positions[i]=(p.positions[i]-origin[i%3])*scale[i%3];
    for(let i=0;i<p.positions.length;i+=9){
      const a=p.positions.slice(i,i+3),b=p.positions.slice(i+3,i+6),c=p.positions.slice(i+6,i+9),u=b.map((v,j)=>v-a[j]),v=c.map((q,j)=>q-a[j]);
      const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n)||1;
      for(let j=0;j<9;j++)p.normals[i+j]=n[j%3]/len;
    }
  }
  const result={href:m.export(),width:diameter,depth:diameter,height,wallHeight:0,eaveHeight:0,foundationHeight:0,roofRise:0,pitchDegrees:0};
  treeCache.set(key,result);if(treeCache.size>16)treeCache.delete(treeCache.keys().next().value!);return result;
}

export type YardAmenityKind = "football-goal" | "basketball-stand" | "bench" | "pergola";
export type YardAmenityModel = YardModel & {
  openingWidth?: number; openingHeight?: number; rimHeight?: number; seatHeight?: number;
  frontPlaneOffset?: number; rimOffset?: number; supportOffset?: number; backboardOffset?: number;
};
const amenityCache = new Map<YardAmenityKind,YardAmenityModel>();

/** Ground-zero, horizontally centred sports/rest objects; +Z faces the playing court or seated viewer. */
export function yardAmenityModel(kind: YardAmenityKind): YardAmenityModel {
  const cached=amenityCache.get(kind);if(cached)return cached;
  if(kind === "pergola") {
    const result=yardBuildingModel("gazebo",6,5,2.4,"hip",["#b48656","#91643b","#c49b6c","#a57646"]);
    amenityCache.set(kind,result);return result;
  }
  const m=new Model(),white=m.part([.88,.9,.87],.35,.5),steel=m.part([.25,.3,.3],.6,.55),net=m.part([.79,.83,.77],0,.85),wood=m.part([.55,.35,.18],0,.75);
  let extra: Partial<YardAmenityModel> = {};
  if(kind === "football-goal") {
    const xf=1.54,zf=.56,zb=-.57,top=2.04;
    // Inner post edges are x=±1.50 and underside of crossbar is y=2.00.
    for(const x of [-xf,xf]) {
      m.pipe(white,[x,0,zf],[x,top,zf],.04,12);
      m.pipe(white,[x,0,zb],[x,1.8,zb],.025,8);
      m.pipe(white,[x,.035,zb],[x,.035,zf],.025,8);
      m.pipe(white,[x,1.8,zb],[x,top,zf],.025,8);
    }
    m.pipe(white,[-xf,top,zf],[xf,top,zf],.04,12);
    m.pipe(white,[-xf,1.8,zb],[xf,1.8,zb],.025,8);
    m.pipe(white,[-xf,.035,zb],[xf,.035,zb],.025,8);
    // Physical net strands rather than an opaque rectangle across the goal mouth.
    for(let x=-1.5;x<=1.501;x+=.25){m.pipe(net,[x,.07,zb],[x,1.8,zb],.006,4);m.pipe(net,[x,1.8,zb],[x,top,zf],.006,4);}
    for(let y=.25;y<1.8;y+=.25)m.pipe(net,[-1.5,y,zb],[1.5,y,zb],.006,4);
    for(let j=1;j<=4;j++){
      const t=j/5,z=zb+(zf-zb)*t,y=1.8+(top-1.8)*t;
      m.pipe(net,[-1.5,y,z],[1.5,y,z],.006,4);
      for(const x of [-xf,xf])m.pipe(net,[x,.07,z],[x,y,z],.006,4);
    }
    extra={openingWidth:3,openingHeight:2,frontPlaneOffset:zf};
  } else if(kind === "basketball-stand") {
    const board=m.part([.9,.91,.86],0,.65),red=m.part([.77,.19,.055],.3,.45),black=m.part([.13,.16,.16],0,.7);
    const poleZ=-2.01;
    m.box(steel,[0,.08,poleZ],[.65,.16,.64]);
    m.box(steel,[0,1.83,poleZ],[.18,3.66,.18]);
    m.pipe(steel,[0,3.61,poleZ],[0,3.61,.13],.07,8);
    m.pipe(steel,[0,2.1,poleZ],[0,3.61,-.14],.055,8);
    // Regulation-size backboard:1.8 ×1.05m; highest point3.95m.
    m.box(board,[0,3.425,.15],[1.8,1.05,.08]);
    for(const x of [-.87,.87])m.box(steel,[x,3.425,.192],[.06,1.05,.004]);
    for(const y of [2.93,3.92])m.box(steel,[0,y,.192],[1.8,.06,.004]);
    for(const x of [-.295,.295])m.box(black,[x,3.275,.1905],[.035,.45,.001]);
    for(const y of [3.05,3.5])m.box(black,[0,y,.1905],[.625,.035,.001]);
    const rimY=3.036,r=.239,zc=.565,n=20;
    m.box(red,[0,rimY,.278],[.14,.026,.15]);
    for(let i=0;i<n;i++){
      const a=i*2*Math.PI/n,b=(i+1)*2*Math.PI/n;
      m.pipe(red,[r*Math.cos(a),rimY,zc+r*Math.sin(a)],[r*Math.cos(b),rimY,zc+r*Math.sin(b)],.014,8);
      if(i%2===0)m.pipe(net,[r*Math.cos(a),3.02,zc+r*Math.sin(a)],[r*.65*Math.cos(a+.12),2.6,zc+r*.65*Math.sin(a+.12)],.0045,4);
    }
    for(const [y,radius] of [[2.82,.19],[2.6,.146]])for(let i=0;i<12;i++)m.pipe(net,[radius*Math.cos(i*Math.PI/6),y,zc+radius*Math.sin(i*Math.PI/6)],[radius*Math.cos((i+1)*Math.PI/6),y,zc+radius*Math.sin((i+1)*Math.PI/6)],.004,4);
    // Rim centre is2.575m in front of the pole; backboard face is0.375m behind rim centre.
    extra={rimHeight:3.05,rimOffset:zc,backboardOffset:.19,supportOffset:poleZ};
  } else {
    // Bench's finished timber seat is exactly0.45m above datum.
    for(const x of [-.67,.67])for(const z of [-.18,.18])m.box(steel,[x,.19,z],[.065,.38,.065]);
    for(const z of [-.16,0,.16])m.box(wood,[0,.415,z],[1.8,.07,.14]);
    for(const x of [-.83,.83]){
      m.box(steel,[x,.55,-.215],[.055,.9,.055]);
      m.box(steel,[x,.61,.01],[.06,.05,.43]);
      m.box(steel,[x,.49,.18],[.055,.26,.055]);
    }
    for(const y of [.62,.78,.94])m.box(wood,[0,y,-.22],[1.8,.13,.065]);
    extra={seatHeight:.45};
  }
  // Derive the native bounds, centring the point origin without changing any physical height.
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const p of m.parts)for(let i=0;i<p.positions.length;i++){min[i%3]=Math.min(min[i%3],p.positions[i]);max[i%3]=Math.max(max[i%3],p.positions[i]);}
  const cx=(min[0]+max[0])/2,cz=(min[2]+max[2])/2;
  for(const p of m.parts)for(let i=0;i<p.positions.length;i+=3){p.positions[i]-=cx;p.positions[i+2]-=cz;}
  if(extra.frontPlaneOffset!==undefined)extra.frontPlaneOffset-=cz;
  if(extra.rimOffset!==undefined)extra.rimOffset-=cz;
  if(extra.backboardOffset!==undefined)extra.backboardOffset-=cz;
  if(extra.supportOffset!==undefined)extra.supportOffset-=cz;
  const result={href:m.export(),width:max[0]-min[0],depth:max[2]-min[2],height:max[1],foundationHeight:0,wallHeight:max[1],eaveHeight:max[1],roofRise:0,pitchDegrees:0,...extra};
  amenityCache.set(kind,result);return result;
}
