// Conservative grid mask: every cell and the proposed corridor width remain inside the site.
type XY=[number,number];
export function pointInBoundary(x:number,y:number,rings:XY[][]){let inside=false;for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function boundaryDistance(x:number,y:number,rings:XY[][]){let best=Infinity;for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i],dx=b[0]-a[0],dy=b[1]-a[1],n=dx*dx+dy*dy,t=n?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/n)):0;best=Math.min(best,Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t));}return best;}
export function boundaryMask(d:{x0:number;y0:number;cell:number;nx:number;ny:number},rings:XY[][],halfWidth:number){
 const mask=new Uint8Array(d.nx*d.ny),clearance=halfWidth+d.cell/Math.SQRT2;
 for(let k=0;k<mask.length;k++){const x=d.x0+k%d.nx*d.cell,y=d.y0+Math.floor(k/d.nx)*d.cell;if(pointInBoundary(x,y,rings)&&boundaryDistance(x,y,rings)>=clearance)mask[k]=1;}
 return mask;
}
