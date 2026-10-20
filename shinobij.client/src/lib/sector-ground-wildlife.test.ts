import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GROUND_HABITATS,GROUND_WILDLIFE_LIMITS,GroundWildlifeSession,advanceGroundAnimal,createGroundAnimal,groundAnimalAlpha,groundAnimalFrame,groundSightingAt} from './sector-ground-wildlife';

test('six pet-inspired species use individual sites; fox sightings are much less frequent',()=>{
 assert.equal(new Set(GROUND_HABITATS.map(h=>h.species)).size,6);
 assert.equal(new Set(GROUND_HABITATS.map(h=>h.sector)).size,6);
 assert.equal(GROUND_WILDLIFE_LIMITS.active,1);
 const fox=GROUND_HABITATS.find(h=>h.species==='red-fox')!;
 for(const h of GROUND_HABITATS){
  assert.ok(h.size>=24&&h.size<=72,'subtle wildlife at actual sector scale');
  assert.ok([h.x,h.y,h.coverX,h.coverY].every(p=>p>0&&p<1));
  if(h!==fox)assert.ok(h.exposed/h.period>fox.exposed/fox.period*3);
 }
 assert.ok(GROUND_WILDLIFE_LIMITS.decodedBytes<=GROUND_WILDLIFE_LIMITS.maxDecodedBytes);
});

test('day species and the night-only Pine Owl share exact deterministic sighting boundaries',()=>{
 for(const h of GROUND_HABITATS){
  const start=h.period*100+h.sector*7919%h.period;
  assert.equal(groundSightingAt(h.sector,start,!h.night),undefined);
  const first=groundSightingAt(h.sector,start,h.night)!;
  assert.equal(first.habitat,h);assert.equal(first.start,start);
  assert.equal(groundAnimalAlpha(createGroundAnimal(first),start),0);
  assert.equal(groundAnimalAlpha(createGroundAnimal(first),start+1000),1);
  assert.equal(groundAnimalAlpha(createGroundAnimal(first),first.end-500),.5);
  assert.equal(groundSightingAt(h.sector,first.end,h.night),undefined);
  assert.equal(groundSightingAt(h.sector,start+h.period,h.night)!.cycle,first.cycle+1);
 }
 assert.equal(groundSightingAt(1,Date.now(),false),undefined);
 assert.equal(groundSightingAt(6,NaN,false),undefined);
});

test('nearby players start one bounded retreat into authored cover; distant players do not',()=>{
 for(const h of GROUND_HABITATS){
  const now=h.period*100+h.sector*7919%h.period+2000;
  const sighting=groundSightingAt(h.sector,now,h.night)!;
  const animal=createGroundAnimal(sighting);
  advanceGroundAnimal(animal,.05,{x:1,y:0});assert.equal(animal.escaping,false);
  const before={x:animal.x,y:animal.y};
  advanceGroundAnimal(animal,.05,{x:animal.x,y:animal.y});assert.equal(animal.escaping,true);
  assert.equal(groundAnimalFrame(animal),4,'a newly startled animal begins with its first escape pose');
  assert.notDeepEqual({x:animal.x,y:animal.y},before);
  assert.ok(groundAnimalFrame(animal)>=4&&groundAnimalFrame(animal)<=7);
  assert.equal(groundAnimalFrame(animal,true),0);
  for(let i=0;i<500;i++)advanceGroundAnimal(animal,.05);
  assert.equal(animal.hidden,true);assert.equal(animal.x,h.coverX);assert.equal(animal.y,h.coverY);
  assert.equal(groundAnimalAlpha(animal,now),0);
  const end={...animal};advanceGroundAnimal(animal,50,{x:0,y:0});assert.deepEqual(animal,end);
 }
});

test('background-sized clock gaps are clamped and invalid deltas never teleport wildlife',()=>{
 const h=GROUND_HABITATS[0],now=h.period*100+h.sector*7919%h.period+2000;
 const animal=createGroundAnimal(groundSightingAt(h.sector,now,false)!);
 advanceGroundAnimal(animal,NaN);advanceGroundAnimal(animal,-4);assert.equal(animal.age,0);
 advanceGroundAnimal(animal,3600,{x:animal.x,y:animal.y});
 assert.equal(animal.age,.05);assert.ok(animal.progress>0&&animal.progress<.2);
});

test('leaving and returning preserves a fled animal and retains only the six authored sites',()=>{
 const session=new GroundWildlifeSession(),h=GROUND_HABITATS[0];
 const now=h.period*100+h.sector*7919%h.period+2000;
 const original=session.at(h.sector,now,false)!;
 for(let i=0;i<200;i++)advanceGroundAnimal(original,.05,{x:original.x,y:original.y});
 assert.equal(original.hidden,true);
 assert.equal(session.at(1,now,false),undefined);assert.equal(session.active,undefined);
 assert.equal(session.at(h.sector,now+1000,false),original);
 assert.equal(session.active!.hidden,true);
 for(let cycle=100;cycle<300;cycle++)for(const habitat of GROUND_HABITATS){
  session.at(habitat.sector,habitat.period*cycle+habitat.sector*7919%habitat.period+2000,habitat.night);
  assert.ok(session.retainedSites<=6);
 }
 const later=session.at(h.sector,now+h.period,false)!;
 assert.notEqual(later,original);assert.equal(later.hidden,false);
});
