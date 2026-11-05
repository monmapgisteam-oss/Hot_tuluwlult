// Бөөрөлжүүтийн renewableModels.ts-ийн Model анги: татаж авах загваргүй glTF үүсгэнэ.
type V3 = [number, number, number];
type Part = { positions: number[]; normals: number[]; color: number[]; metal: number; rough: number; emissive?: number[] };

export class Model {
  parts: Part[] = [];
  part(color: number[], metal = 0, rough = 0.7, emissive?: number[]) {
    const p: Part = { positions: [], normals: [], color, metal, rough, emissive };
    this.parts.push(p);
    return p;
  }
  tri(p: Part, a: V3, b: V3, c: V3) {
    const u = b.map((v, i) => v - a[i]), v = c.map((n, i) => n - a[i]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1;
    p.positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) p.normals.push(...n.map((x) => x / len));
  }
  quad(p: Part, a: V3, b: V3, c: V3, d: V3) {
    this.tri(p, a, b, c); this.tri(p, a, c, d);
  }
  box(p: Part, center: V3, size: V3, transform = (v: V3): V3 => v) {
    const points = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]
      .map((v) => transform(v.map((n, i) => center[i] + n * size[i] / 2) as V3));
    for (const [a,b,c,d] of [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]])
      this.quad(p, points[a], points[b], points[c], points[d]);
  }
  cone(p: Part, y0: number, y1: number, r0: number, r1: number) {
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12, b = (i + 1) * Math.PI / 12;
      const q: V3[] = [[r0*Math.cos(a),y0,r0*Math.sin(a)], [r1*Math.cos(a),y1,r1*Math.sin(a)],
        [r1*Math.cos(b),y1,r1*Math.sin(b)], [r0*Math.cos(b),y0,r0*Math.sin(b)]];
      this.quad(p, ...q as [V3,V3,V3,V3]);
      this.tri(p, [0,y1,0], q[2], q[1]);
    }
  }
  pipe(p:Part,a:V3,b:V3,r:number,segments=12){
    const delta=b.map((v,i)=>v-a[i]),length=Math.hypot(...delta),u=delta.map(v=>v/length);
    const ref=Math.abs(u[1])<0.9?[0,1,0]:[1,0,0];
    const cross=(x:number[],y:number[])=>[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
    const raw=cross(u,ref),n=raw.map(v=>v/Math.hypot(...raw)),t=cross(u,n);
    const at=(c:V3,angle:number)=>c.map((v,i)=>v+r*(n[i]*Math.cos(angle)+t[i]*Math.sin(angle))) as V3;
    for(let i=0;i<segments;i++){const a0=at(a,i*2*Math.PI/segments),a1=at(a,(i+1)*2*Math.PI/segments),b0=at(b,i*2*Math.PI/segments),b1=at(b,(i+1)*2*Math.PI/segments);this.quad(p,a0,a1,b1,b0);this.tri(p,a,a1,a0);this.tri(p,b,b0,b1);}
  }
  export() {
    const accessors: object[] = [], bufferViews: object[] = [], chunks: Float32Array[] = [];
    let byteLength = 0;
    const add = (values: number[], bounds: boolean) => {
      const data = new Float32Array(values), count = data.length / 3;
      const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
      for (let i = 0; i < data.length; i++) { min[i%3] = Math.min(min[i%3], data[i]); max[i%3] = Math.max(max[i%3], data[i]); }
      bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.byteLength });
      accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count, type: "VEC3", ...(bounds ? { min, max } : {}) });
      chunks.push(data); byteLength += data.byteLength;
      return accessors.length - 1;
    };
    const parts = this.parts.filter((p) => p.positions.length);
    const primitives = parts.map((p, material) => ({ attributes: { POSITION: add(p.positions, true), NORMAL: add(p.normals, false) }, material }));
    const gltf = { asset: { version: "2.0", generator: "Booroljuut planning models" }, scene: 0,
      scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives }],
      materials: parts.map((p) => ({ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [...p.color,1], metallicFactor: p.metal, roughnessFactor: p.rough }, ...(p.emissive ? {emissiveFactor:p.emissive} : {}) })),
      accessors, bufferViews, buffers: [{ byteLength }] };
    const json = new TextEncoder().encode(JSON.stringify(gltf)), jsonLength = Math.ceil(json.length / 4) * 4;
    const buffer = new ArrayBuffer(28 + jsonLength + byteLength), dv = new DataView(buffer), bytes = new Uint8Array(buffer);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, buffer.byteLength, true);
    dv.setUint32(12, jsonLength, true); dv.setUint32(16, 0x4e4f534a, true);
    bytes.fill(32, 20, 20 + jsonLength); bytes.set(json, 20);
    dv.setUint32(20 + jsonLength, byteLength, true); dv.setUint32(24 + jsonLength, 0x004e4942, true);
    let offset = 28 + jsonLength;
    for (const chunk of chunks) { bytes.set(new Uint8Array(chunk.buffer), offset); offset += chunk.byteLength; }
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return `data:model/gltf-binary;base64,${btoa(binary)}`;
  }
}
