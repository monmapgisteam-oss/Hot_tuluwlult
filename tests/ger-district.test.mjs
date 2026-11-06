import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    if (specifier.startsWith('@arcgis/core/') && !specifier.endsWith('.js')) return nextResolve(specifier + '.js', context);
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + '.ts', context);
    throw error;
  }
}});
const { buildGerDistrict } = await import('../lib/plan/gerDistrict.ts');
const { DEFAULT } = await import('../lib/plan/urban.ts');
const { area, bufMany, diff, inter, unionAll } = await import('../lib/plan/geom.ts');
const { buildPlanningSuitability } = await import('../lib/plan/planningSuitability.ts');
const { corridorGraph } = await import('../lib/plan/sharedUtilityGraph.ts');
const { streetComponents } = await import('../lib/plan/urbanStreetConnections.ts');
hook.deregister();

const rect = (x0, y0, x1, y1) => [[[500000+x0, 5200000+y0], [500000+x0, 5200000+y1], [500000+x1, 5200000+y1], [500000+x1, 5200000+y0], [500000+x0, 5200000+y0]]];
const nx=71,ny=71,cell=10,x0=499900,y0=5199900;
const dem={x0,y0,nx,ny,cell,z:Float32Array.from({length:nx*ny},(_,k)=>1400+(k%nx)*0.05)};
const inp={...DEFAULT,mode:'ger',hhSize:3.6,maxSlope:10};

for (const restricted of [false,true]) test(`ger district keeps full 0.7 ha households connected to streets${restricted?' around an exclusion':''}`, {timeout:60000}, async () => {
  const boundary=rect(0,0,400,500), prohibited=restricted?rect(180,220,220,280):[];
  const site=diff(boundary,prohibited);
  const suitability=buildPlanningSuitability({dem,boundary,restrictions:restricted?[{id:'protected',label:'Protected area',rings:prohibited}]:[]});
  const plan=await buildGerDistrict(site,dem,inp,suitability);
  assert.ok(plan.ger.parcels.length>=8);
  assert.equal(plan.ger.parcels.length,plan.ger.yards.length);
  assert.equal(plan.scene.bldgs.length,plan.ger.parcels.length);
  assert.equal(streetComponents(corridorGraph(plan.streets.map(s=>s.path))).count,1);
  const corridor=bufMany(plan.streets.map(s=>({paths:[s.path],d:s.w/2})));
  assert.ok(area(diff(corridor,site))<0.1);
  for(const surface of plan.scene.streets) assert.ok(area(diff(surface.rings,site))<0.1, 'rendered street must stay within the suitable boundary');
  for(const parcel of plan.ger.parcels){
    assert.ok(Math.abs(parcel.area-7000)<0.1);
    assert.ok(area(diff(parcel.rings,site))<0.1);
    assert.ok(area(inter(parcel.rings,corridor))<0.1);
    for(const surface of plan.scene.streets) assert.ok(area(inter(parcel.rings,surface.rings))<0.1, 'rendered street must not cover a household parcel');
  }
  assert.ok(Math.abs(area(unionAll(plan.ger.parcels.map(p=>p.rings)))-plan.ger.parcels.reduce((a,p)=>a+p.area,0))<0.1);
  for(const building of plan.scene.bldgs){
    assert.equal(building.households,1);
    assert.ok(building.floors===1||building.floors===2);
    assert.equal(building.gfaRes,building.foot*building.floors);
    assert.ok(area(diff(building.rings,plan.ger.parcels[building.lot-1].rings))<0.1);
  }
});

test('ger district rejects a site that cannot fit a complete household parcel', async () => {
  const site=rect(0,0,50,100),suitability=buildPlanningSuitability({dem,boundary:site});
  await assert.rejects(buildGerDistrict(site,dem,inp,suitability),/0\.7 га бүтэн хашаа/);
});
