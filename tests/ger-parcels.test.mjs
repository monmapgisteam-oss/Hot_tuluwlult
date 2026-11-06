import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPlan, GER_DEFAULT_PARAMS, GER_PARCEL_AREA, area, inter, diff, inside } from '../lib/plan/gerParcels.ts';
import { HOUSE_TYPES, yardOf } from '../lib/plan/gerYards.ts';

const rectangle = (x0, y0, x1, y1) => [[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
const rotate = (ring, degrees) => {
 const a=degrees*Math.PI/180;
 return ring.map(([x,y])=>[500000+x*Math.cos(a)-y*Math.sin(a),5200000+x*Math.sin(a)+y*Math.cos(a)]);
};

test('Bayandun ger preset places whole 0.7 ha parcels inside a rotated boundary', () => {
 const site=[[rotate(rectangle(0,0,400,500),31)]];
 const plan=runPlan(site,{...GER_DEFAULT_PARAMS,angle:31});
 assert.equal(GER_PARCEL_AREA,7000);
 assert.ok(plan.lots.length>=12);
 for(let i=0;i<plan.lots.length;i++) {
  const lot=plan.lots[i];
  assert.equal(lot.trimmed,false);
  assert.ok(Math.abs(lot.area-7000)<0.1,`lot ${lot.id}: ${lot.area} m²`);
  assert.ok(area(diff(lot.poly,site))<0.1,'parcel crosses the outer boundary');
  assert.ok(area(inter(lot.poly,plan.streets))<0.1,'parcel overlaps its street');
  for(let j=i+1;j<plan.lots.length;j++) assert.ok(area(inter(lot.poly,plan.lots[j].poly))<0.1,'parcels overlap');
 }
 assert.ok(Math.abs(plan.metrics.closure)<0.1,'land area closes');
});

test('sub-parcel exclusion holes remain empty and incomplete parcels are omitted', () => {
 const outer=rotate(rectangle(0,0,500,400),0),hole=rotate(rectangle(244,170,256,230),0);
 const site=[[outer,hole]],prohibited=[[hole]];
 const plan=runPlan(site,GER_DEFAULT_PARAMS);
 assert.ok(plan.lots.length>=10);
 for(const lot of plan.lots) {
  assert.ok(Math.abs(lot.area-7000)<0.1);
  assert.ok(area(inter(lot.poly,prohibited))<0.01);
 }
 assert.ok(area(inter(plan.streets,prohibited))<0.01);
 assert.ok(area(inter(plan.green,prohibited))<0.01);
});

test('outer and hole winding does not move the rotated parcel grid', () => {
 const outer=rotate(rectangle(0,0,500,400),27),hole=rotate(rectangle(350,200,390,280),27);
 const a=runPlan([[outer,hole]],{...GER_DEFAULT_PARAMS,angle:27});
 const b=runPlan([[outer.toReversed(),hole.toReversed()]],{...GER_DEFAULT_PARAMS,angle:27});
 const positions=p=>p.lots.map(l=>l.c.map(v=>Math.round(v*100)/100));
 assert.deepEqual(positions(a),positions(b));
 assert.equal(a.metrics.resCount,b.metrics.resCount);
});

test('ported 0.7 ha yards retain a street-facing gate, house, garage and gardens within the parcel', () => {
 const W=GER_DEFAULT_PARAMS.lotW,D=GER_DEFAULT_PARAMS.lotD;
 const lot=[[rectangle(0,0,W,D)]],street=[[rectangle(-10,-12,W+10,0)]];
 for(const type of HOUSE_TYPES) {
  const yard=yardOf(`test-${type.id}`,lot,street,type,W);
  assert.ok(yard,`${type.id} faces the street`);
  assert.equal(yard.frame.W,W);
  assert.equal(yard.frame.D,D);
  assert.equal(yard.bldgs.filter(b=>b.k==='house').length,1);
  assert.ok(Math.abs(yard.houseArea-type.w*type.d)<0.01,'house dimensions remain in metres');
  for(const building of yard.bldgs) assert.ok(area(diff([[building.r]],lot))<0.01,`${building.k} crosses its parcel`);
  assert.ok(yard.parts.some(p=>p.k==='orchard'));
  assert.ok(yard.parts.some(p=>p.k==='beds'));
  assert.equal(yard.bldgs.filter(b=>b.k==='greenhouse').length,2);
  const fence=yard.details.find(d=>d.k==='gate'&&d.r.length>2),gate=yard.details.find(d=>d.k==='gate'&&d.color==='#4f5549');
  assert.ok(fence&&gate);
  assert.ok(fence.r.every(p=>inside(p,lot)));
  const mid=gate.r.map(p=>p[0]).reduce((a,b)=>a+b,0)/gate.r.length;
  assert.ok(inside([mid,-3],street),'gate faces a valid street');
 }
});
