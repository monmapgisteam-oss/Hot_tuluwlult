import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import proj4 from 'proj4';

const hook=registerHooks({resolve(specifier,context,nextResolve){
 try{return nextResolve(specifier,context);}catch(error){
  if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
  if(specifier.startsWith('@arcgis/core/')&&!specifier.endsWith('.js'))return nextResolve(`${specifier}.js`,context);
  if((specifier.startsWith('./')||specifier.startsWith('../'))&&!/\.[a-z]+$/i.test(specifier))return nextResolve(`${specifier}.ts`,context);
  throw error;
 }
}});
const {planSettlement,PLAN_DEFAULT}=await import('../lib/plan/runSettlement.ts');
const {checks}=await import('../lib/plan/urban.ts');
const {GER_PARCEL_AREA,GER_HOUSEHOLD_SIZE}=await import('../lib/plan/gerConfig.ts');
const {area,bbox,bufPath,diff,inside,inter,unionAll}=await import('../lib/plan/geom.ts');
const {corridorGraph}=await import('../lib/plan/sharedUtilityGraph.ts');
const {streetComponents}=await import('../lib/plan/urbanStreetConnections.ts');
const {packPlan,unpackPlan}=await import('../lib/savedPlan.ts');
hook.deregister();

const tr=proj4('+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs');
const offset=ring=>ring.map(([x,y])=>[500000+x,5200000+y]);
function fixture(withHole){
 const zone=[offset([[0,0],[400,0],[400,500],[0,500],[0,0]])],bounds=bbox(zone),x=[],y=[];
 for(let yy=Math.floor(bounds.y0/30)*30+15;yy<bounds.y1;yy+=30)for(let xx=Math.floor(bounds.x0/30)*30+15;xx<bounds.x1;xx+=30)if(inside(xx,yy,zone)){x.push(xx);y.push(yy);}
 const rings=zone.map(r=>r.map(p=>tr.inverse(p))),constant=v=>Array(x.length).fill(v);
 const noBuild=withHole?[[offset([[170,215],[230,215],[230,285],[170,285],[170,215]])]]:[];
 const prep={n:x.length,cell:30,epsg:32648,utmZone:48,x,y,areaHa:20,centroid:tr.inverse([500200,5200250]),boundaryLonLat:rings,
  zone:constant(0),zones:[{aimag:'test',soum:'test'}],num:{slope:constant(.5),aspect:constant(270),elev:constant(50),elevM:constant(1400),tpi:constant(0),flow:constant(1),relief:constant(5)},
  cat:{landcover:{dict:['Өвслөг бэлчээр'],idx:constant(0)}},sources:{},warnings:[],roads:[],rivers:[],anchor:null,noBuild};
 return {zone,rings,prep,noBuild,inputs:{...PLAN_DEFAULT,mode:'ger'}};
}

for(const withHole of [false,true])test(`ger settlement: 20 ha ${withHole?'with a prohibited area':'with no exclusions'} retains 0.7 ha household plots`,{timeout:45000},async t=>{
 const input=fixture(withHole),originalFetch=globalThis.fetch;
 t.after(()=>{globalThis.fetch=originalFetch;});
 globalThis.fetch=async(url,init)=>{
  assert.equal(url,'/api/dem');
  const {nx,ny,x0,cell}=JSON.parse(init.body),z=new Float32Array(nx*ny);
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)z[j*nx+i]=1400+(x0+i*cell-500000)*.005;
  return new Response(z.buffer);
 };
 const plan=await planSettlement({...input,onStep:()=>{}}),ger=plan.ger;
 assert.ok(ger&&ger.parcels.length>=4,'a viable district must contain multiple household plots');
 assert.equal(plan.inp.mode,'ger');
 assert.equal(ger.parcelAreaM2,GER_PARCEL_AREA);
 assert.equal(ger.yards.length,ger.parcels.length);
 assert.equal(plan.bldgs.length,ger.parcels.length,'each household gets one residential house');
 assert.equal(plan.t.hh,ger.parcels.length);
 assert.ok(Math.abs(plan.t.pop-ger.parcels.length*GER_HOUSEHOLD_SIZE)<1e-8);
 assert.ok(plan.bldgs.every(b=>b.hh===1&&b.floors<=2),'apartment floor defaults must not leak into household houses');
 const streets=plan.streets.filter(s=>!s.ext),corridor=unionAll(streets.map(s=>bufPath([s.path],s.w/2)));
 assert.equal(streetComponents(corridorGraph(streets.map(s=>s.path))).count,1);
 assert.ok(area(diff(corridor,input.zone))<.1);
 for(let i=0;i<ger.parcels.length;i++){
  const parcel=ger.parcels[i];
  assert.ok(Math.abs(parcel.area-GER_PARCEL_AREA)<.1);
  assert.ok(area(diff(parcel.rings,plan.site))<.1);
  assert.ok(area(inter(parcel.rings,corridor))<.1);
  for(let j=i+1;j<ger.parcels.length;j++)assert.ok(area(inter(parcel.rings,ger.parcels[j].rings))<.1);
  for(const prohibited of input.noBuild)assert.ok(area(inter(parcel.rings,prohibited))<.1);
 }
 for(const prohibited of input.noBuild)assert.ok(area(inter(corridor,prohibited))<.1);
 for(const b of plan.bldgs){assert.ok(area(diff(b.rings,plan.site))<.1);assert.ok(area(inter(b.rings,corridor))<.1);}
 const report=checks(plan);
 assert.equal(report.find(c=>c.label==='Нэг хашааны талбай')?.ok,true);
 assert.equal(report.find(c=>c.label==='Айлын хашаа / өрх')?.ok,true);
 if(!withHole){
  const zipped=await packPlan({name:'Гэр хороолол · 0.7 га',target:{rings:input.rings,region:null},inputs:input.inputs,plan,checks:report});
  const reopened=await unpackPlan(zipped);
  assert.equal(reopened.inputs.mode,'ger');
  assert.deepEqual(reopened.plan.ger,ger);
  assert.equal(reopened.plan.t.hh,ger.parcels.length);
  assert.equal(reopened.checks.find(c=>c.label==='Нэг хашааны талбай')?.ok,true);
 }
 if(process.env.GER_TEST_ARTIFACTS==='1'){
  mkdirSync(new URL('../.cache/',import.meta.url),{recursive:true});
  const tag=withHole?'-hole':'';
  writeFileSync(new URL(`../.cache/ger-plan${tag}.json`,import.meta.url),JSON.stringify(plan,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v));
  writeFileSync(new URL(`../.cache/ger-fixture${tag}.json`,import.meta.url),JSON.stringify(input));
  console.log(JSON.stringify({withHole,parcels:ger.parcels.length,pop:plan.t.pop,siteHa:plan.siteArea/1e4,streets:streets.length}));
 }
});
