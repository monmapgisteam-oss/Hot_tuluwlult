// Хөтчийн native CompressionStream (deflate-raw)-аар нэг файлтай ZIP үүсгэх, задлах. Гадны сан шаардахгүй.
// Порталын «Code Sample» item нь zip файл хүлээн авдаг тул загварын JSON-ийг plan.json нэрээр zip-д хийнэ.
const TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
export function crc32(b:Uint8Array){let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=TABLE[(c^b[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
async function pipe(bytes:Uint8Array,stream:CompressionStream|DecompressionStream){return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());}
const enc=new TextEncoder(),dec=new TextDecoder();
function dosTime(d:Date){return{time:(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1),date:((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<4)|d.getDate()};}
/** Нэг бичвэр файлыг deflate-ээр шахсан ZIP (Uint8Array). */
export async function zipText(name:string,text:string,when=new Date()){
 const raw=enc.encode(text),data=await pipe(raw,new CompressionStream('deflate-raw')),nameBytes=enc.encode(name),crc=crc32(raw),{time,date}=dosTime(when);
 const local=new DataView(new ArrayBuffer(30)),central=new DataView(new ArrayBuffer(46)),end=new DataView(new ArrayBuffer(22));
 local.setUint32(0,0x04034b50,true);local.setUint16(4,20,true);local.setUint16(6,0x0800,true);local.setUint16(8,8,true);local.setUint16(10,time,true);local.setUint16(12,date,true);
 local.setUint32(14,crc,true);local.setUint32(18,data.length,true);local.setUint32(22,raw.length,true);local.setUint16(26,nameBytes.length,true);local.setUint16(28,0,true);
 const cdOffset=30+nameBytes.length+data.length;
 central.setUint32(0,0x02014b50,true);central.setUint16(4,20,true);central.setUint16(6,20,true);central.setUint16(8,0x0800,true);central.setUint16(10,8,true);central.setUint16(12,time,true);central.setUint16(14,date,true);
 central.setUint32(16,crc,true);central.setUint32(20,data.length,true);central.setUint32(24,raw.length,true);central.setUint16(28,nameBytes.length,true);central.setUint16(30,0,true);central.setUint16(32,0,true);
 central.setUint16(34,0,true);central.setUint16(36,0,true);central.setUint32(38,0,true);central.setUint32(42,0,true);
 end.setUint32(0,0x06054b50,true);end.setUint16(4,0,true);end.setUint16(6,0,true);end.setUint16(8,1,true);end.setUint16(10,1,true);end.setUint32(12,46+nameBytes.length,true);end.setUint32(16,cdOffset,true);end.setUint16(20,0,true);
 const parts=[new Uint8Array(local.buffer),nameBytes,data,new Uint8Array(central.buffer),nameBytes,new Uint8Array(end.buffer)],out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));
 let o=0;for(const p of parts){out.set(p,o);o+=p.length;}return out;
}
/** ZIP-ийн эхний файлыг бичвэр болгон буцаана (deflate эсвэл шахаагүй). */
export async function unzipText(zip:Uint8Array){
 const v=new DataView(zip.buffer,zip.byteOffset,zip.byteLength);
 let eocd=-1;for(let i=zip.length-22;i>=Math.max(0,zip.length-70000);i--)if(v.getUint32(i,true)===0x06054b50){eocd=i;break;}
 if(eocd<0)throw new Error('ZIP файл танигдсангүй.');
 const cd=v.getUint32(eocd+16,true);if(v.getUint32(cd,true)!==0x02014b50)throw new Error('ZIP бүтэц алдаатай.');
 const method=v.getUint16(cd+10,true),csize=v.getUint32(cd+20,true),local=v.getUint32(cd+42,true);
 const start=local+30+v.getUint16(local+26,true)+v.getUint16(local+28,true),data=zip.subarray(start,start+csize);
 if(method===0)return dec.decode(data);
 if(method!==8)throw new Error('ZIP шахалтын төрөл дэмжигдэхгүй.');
 return dec.decode(await pipe(data,new DecompressionStream('deflate-raw')));
}
