// Бохирын тусдаа концепц трасс: замын тэнхлэгээс үл хамааран бүсийн DEM дээр хайна.
// Гүн, доод налуу нь оролтын таамаглал; эцсийн ёроолын түвшин сүлжээний хуримтлалаар дахин шалгагдана.
import type {RouteGrid,RoutePoint} from './terrainRoute';

class Queue{
 items:[number,number][]=[];
 push(k:number,v:number){const a=this.items;a.push([k,v]);for(let i=a.length-1;i>0;){const p=(i-1)>>1;if(a[p][1]<=v)break;[a[p],a[i]]=[a[i],a[p]];i=p;}}
 pop(){const a=this.items,first=a[0],last=a.pop()!;if(a.length){a[0]=last;for(let i=0;;){let m=i;const l=2*i+1,r=l+1;if(l<a.length&&a[l][1]<a[m][1])m=l;if(r<a.length&&a[r][1]<a[m][1])m=r;if(m===i)break;[a[i],a[m]]=[a[m],a[i]];i=m;}}return first;}
}
export type DrainageField={dem:RouteGrid;parent:Int32Array;owner:Int32Array;outlets:number[];cost:Float64Array};
export const drainagePoint=(d:RouteGrid,k:number):RoutePoint=>[d.x0+k%d.nx*d.cell,d.y0+Math.floor(k/d.nx)*d.cell];
/** Хориглосон талбайгаар тусгаарлагдсан хэсэг бүр өөрийн нам цэгтэй; бүсийн mask-ыг дуудаж буй код тусад нь өгнө. */
export function drainageField(d:RouteGrid,mask:Uint8Array,costSurface?:ArrayLike<number>):DrainageField{
 if(!Number.isSafeInteger(d.nx)||!Number.isSafeInteger(d.ny)||d.nx<1||d.ny<1||!Number.isFinite(d.cell)||d.cell<=0||!Number.isFinite(d.x0)||!Number.isFinite(d.y0)||d.z.length!==d.nx*d.ny||mask.length!==d.nx*d.ny||costSurface&&costSurface.length!==d.nx*d.ny)throw new Error('Бохирын DEM-ийн хэмжээ, нягтрал, хориглолтын торыг шалгана уу.');
 const n=d.nx*d.ny,parent=new Int32Array(n).fill(-1),owner=new Int32Array(n).fill(-1),cost=new Float64Array(n).fill(Infinity),outlets:number[]=[];
 const valid=(k:number)=>k>=0&&k<n&&!!mask[k]&&Number.isFinite(d.z[k])&&d.z[k]!==-999999&&(!costSurface||Number.isFinite(costSurface[k])&&costSurface[k]>=1);
 const neighbors=(k:number)=>{const x=k%d.nx,y=Math.floor(k/d.nx),out:number[]=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
  if(!dx&&!dy)continue;const i=x+dx,j=y+dy,v=j*d.nx+i;if(i<0||j<0||i>=d.nx||j>=d.ny||!valid(v))continue;
  if(dx&&dy&&(!valid(y*d.nx+i)||!valid(j*d.nx+x)))continue;out.push(v);
 }return out;};
 // Доод өндөр адил үед эхний эсийг сонгоно: дахин ажиллуулахад үр дүн тогтвортой.
 for(let start=0;start<n;start++)if(valid(start)&&owner[start]<0){const component=[start],id=outlets.length;owner[start]=id;let low=start;
  for(let i=0;i<component.length;i++){const k=component[i];if(d.z[k]<d.z[low])low=k;for(const v of neighbors(k))if(owner[v]<0){owner[v]=id;component.push(v);}}
  outlets.push(low);
 }
 const q=new Queue();for(const k of outlets){cost[k]=0;q.push(k,0);}
 while(q.items.length){const [k,c]=q.pop();if(c!==cost[k])continue;for(const v of neighbors(k)){
  const length=d.cell*Math.hypot(k%d.nx-v%d.nx,Math.floor(k/d.nx)-Math.floor(v/d.nx));
  // Хайлт ЦБ-аас хэрэглэгч рүү: газрын өндөр буурах нь урсгалын эсрэг өгсөлт болно.
  // .005, .25, 4 нь концепц хайлтын өртгийн жин; хоолойн зөвшөөрөх налуугийн норм биш.
  const adverse=Math.max(0,d.z[k]-d.z[v])/length,grade=Math.abs(d.z[k]-d.z[v])/length;
  const w=length*(1+adverse/.005*4+(grade/.25)**2)*(costSurface?(costSurface[k]+costSurface[v])/2:1),next=c+w;
  if(next<cost[v]){cost[v]=next;parent[v]=k;q.push(v,next);}
 }}
 return{dem:d,parent,owner,outlets,cost};
}
export function traceDrainage(field:DrainageField,start:number):RoutePoint[]{
 if(start<0||start>=field.parent.length||!Number.isFinite(field.cost[start]))return[];
 const path:RoutePoint[]=[];for(let k=start;k>=0;k=field.parent[k])path.push(drainagePoint(field.dem,k));return path;
}
