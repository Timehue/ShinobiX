import test from 'node:test';
import assert from 'node:assert/strict';
import { sectorLifePainting,sectorLifePaintingRevision,setSectorLifePainting,sectorTrackerAway } from './sector-life-art';

test('frontier gear uses the protected full floor and missing art returns to canonical terrain',()=>{
    for(const [sector,key]of [[55,'hollow-road-gear-v1'],[60,'lavafront-road-gear-v1']] as const){
        setSectorLifePainting(sector);assert.equal(sectorLifePainting(sector),`/sector-life/${key}.webp`);assert.equal(sectorLifePainting(sector,true),undefined);
    }
});

test('winter fallback retains its supplied warming scene when shrine care is absent',()=>{
    assert.equal(sectorLifePainting(31,true),'/sector-life/frostveil-dormant-shrine-supply-v2.webp');
});

test('a cached festival opens once, packs on time and cannot reopen tomorrow without a new response',t=>{
    let now=Date.now();t.mock.method(Date,'now',()=>now);const start=now;
    setSectorLifePainting(52,'festival-tea-counter-packed-v1',undefined,undefined,{at:start+24_000,key:'festival-tea-counter-open-v1',until:start+60_000});
    assert.equal(sectorLifePainting(52),'/sector-life/festival-tea-counter-packed-v1.webp');
    now=start+24_000;assert.equal(sectorLifePainting(52),'/sector-life/festival-tea-counter-open-v1.webp');
    now=start+60_000;assert.equal(sectorLifePainting(52),'/sector-life/festival-tea-counter-packed-v1.webp');
    now+=86_400_000;assert.equal(sectorLifePainting(52),'/sector-life/festival-tea-counter-packed-v1.webp');
    assert.equal(sectorLifePainting(52,true),undefined,'both missing counter paintings fall back to the original sector floor');setSectorLifePainting(52);
});
test('missing garden art retains the actual tea/card context without promising planted rows',()=>{
    setSectorLifePainting(42);
    assert.equal(sectorLifePainting(42,true),'/sector-life/midlands-tea-stop-v1.webp');
    setSectorLifePainting(42,'midlands-herb-chronicle-table-v2');
    assert.equal(sectorLifePainting(42,true),'/sector-life/midlands-chronicle-table-v1.webp');
    setSectorLifePainting(42);
});

test('temporary table dressing expires without a poll, including when the sector is no longer visible',t=>{
    let now=Date.now();t.mock.method(Date,'now',()=>now);
    setSectorLifePainting(42,'midlands-herb-chronicle-table-v2','away-tracker',now+10_000);
    assert.equal(sectorLifePainting(42),'/sector-life/midlands-herb-chronicle-table-v2.webp');
    const before=sectorLifePaintingRevision();now+=10_001;
    assert(sectorLifePaintingRevision()>before);
    assert.equal(sectorLifePainting(42),'/sector-life/midlands-herb-tea-stop-v2.webp');
    assert.equal(sectorTrackerAway(42,'away-tracker'),true,'painting expiry preserves unrelated tracker authority');
    setSectorLifePainting(42,'midlands-herb-chronicle-table-v2',undefined,now-1);
    assert.equal(sectorLifePainting(42),'/sector-life/midlands-herb-tea-stop-v2.webp','an expired response never restores the cards');
    setSectorLifePainting(42);
});
test('a cached shipment clears the roadside, unloads at the dock and expires while its sector is away',t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);const start=now;
 const schedule={at:start+29_000,key:'north-docks-shipment-delivered-v1',until:start+90_000};
 setSectorLifePainting(2,'north-docks-shipment-spilled-v1','unrelated-away',start+6000,schedule);
 assert.equal(sectorLifePainting(2),'/sector-life/north-docks-shipment-spilled-v1.webp');const first=sectorLifePaintingRevision();
 now=start+6000;assert(sectorLifePaintingRevision()>first);assert.equal(sectorLifePainting(2),'/sector-life/north-docks-work-stop-v1.webp');
 now=schedule.at;assert.equal(sectorLifePainting(2),'/sector-life/north-docks-shipment-delivered-v1.webp');assert(sectorTrackerAway(2,'unrelated-away'));
 now=schedule.until;assert.equal(sectorLifePainting(2),'/sector-life/north-docks-work-stop-v1.webp');
 setSectorLifePainting(2,'north-docks-shipment-spilled-v1',undefined,start+6000,schedule);
 assert.equal(sectorLifePainting(2),'/sector-life/north-docks-work-stop-v1.webp','a late response cannot resurrect an expired load');setSectorLifePainting(2);
});
