import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settlementScale } from '../lib/plan/settlementScale.ts';

const input = {arterialW:60,collectorW:30,localW:18,artLanes:3,serviceW:6,ringOn:true,windbreak:60,gridStep:320,resBlock:22000,comBlock:12000,minW:60};

test('neighbourhood dimensions remain stable at projected area thresholds', () => {
 for(const [ha,arterial] of [[12,20],[40,24],[100,30]]) {
  for(const error of [-0.0001,0,0.0001]) {
   const scaled=settlementScale(input,ha*10000+error,400);
   assert.equal(scaled.arterialW,arterial);
   assert.equal(scaled.serviceW,0);
  }
 }
 assert.equal(settlementScale(input,1010000,1000).arterialW,60);
});

test('small-site scaling preserves explicitly narrower design dimensions', () => {
 const smaller={...input,arterialW:18,collectorW:12,localW:10,windbreak:0,ringOn:false};
 const scaled=settlementScale(smaller,50000,140);
 assert.equal(scaled.arterialW,18);
 assert.equal(scaled.collectorW,12);
 assert.equal(scaled.localW,10);
 assert.equal(scaled.windbreak,0);
 assert.equal(scaled.ringOn,false);
 assert.equal(input.arterialW,60);
});
