// One deterministic opening grid shared by glazing, frames and balconies.
import {add,mul,sub,norm,perp,inside,type Rings,type XY} from './geom';
export type WindowEdge={a:XY;u:XY;n:XY;length:number;windows:{s:number;width:number;index:number;balcony:boolean}[]};
const cache=new WeakMap<Rings,WindowEdge[]>();
export function urbanWindowLayout(rings:Rings):WindowEdge[]{
 const saved=cache.get(rings);if(saved)return saved;
 const edges:WindowEdge[]=[];
 for(const ring of rings)for(let i=0;i+1<ring.length;i++){
  const a=ring[i],b=ring[i+1],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(length<5)continue;
  const u=norm(sub(b,a)),left=perp(u),mid=add(a,mul(u,length/2));
  const l=inside(...add(mid,mul(left,.2)),rings),r=inside(...add(mid,mul(left,-.2)),rings),count=Math.min(64,Math.floor((length-1.2)/3.2));
  if(l===r||!count)continue;
  const n=l?mul(left,-1):left,width=Math.min(1.65,length/(count+1)*.55);
  edges.push({a,u,n,length,windows:Array.from({length:count},(_,j)=>({s:(j+1)*length/(count+1),width,index:j,balcony:length>=10&&j%3===1}))});
 }
 cache.set(rings,edges);return edges;
}
