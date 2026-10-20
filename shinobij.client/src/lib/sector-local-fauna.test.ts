import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {HARBOR_GULL_ROUTE,MOONWELL_MOTH_LAMPS,moonwellLampsLit,harborGullPoint,lampMothPoint} from './sector-local-fauna';
import {SECTOR_FLOOR_LAYOUTS} from '../../../shared/sector-floor-layouts';
import {sectorArtKey} from '../../../shared/sector-geo';
import {displayedSectorFloor,recordDisplayedSectorFloor,forgetDisplayedFloors,subscribeDisplayedSectorFloor} from './sector-displayed-floor';

test('habitat points stay bound to the inspected shoreline and lit-lamp floor paintings',()=>{
    const root=new URL('../../public/sector-life/',import.meta.url);
    const hashes={
        'north-docks-work-stop-v1.webp':'cdc146ec5caf6fb231ebd92b45986b0ac3a90b9f8181ffa64153d3a31e2a6055',
        'north-docks-shipment-spilled-v1.webp':'d0e3212d559e3c6b4d571912a9ccbaafd5c2a4bba97a3ffc637d732f6be6adc0',
        'north-docks-shipment-delivered-v1.webp':'9df9ab362633e085da8af7ec89b58cb3df11f0291a477d35f02304859fc05e80',
        'moonwell-supported-shrine-v1.webp':'0305e5880eafcd15f45424facfa065b118ee34600752b6a0d16f9d3fc684840c',
        'moonwell-radiant-shrine-v1.webp':'f3760b040215a1c36cc87448d0ae649e747e8ac73f234d90ba8ff05469ba0b8c',
    };
    for(const [file,sha] of Object.entries(hashes))assert.equal(createHash('sha256').update(readFileSync(new URL(file,root))).digest('hex'),sha,'re-review changed painted habitat: '+file);
    assert(HARBOR_GULL_ROUTE.every(tile=>SECTOR_FLOOR_LAYOUTS[sectorArtKey(2)].hydrology!.waterTiles.includes(tile)));
    assert.deepEqual(MOONWELL_MOTH_LAMPS,[{x:208/1024,y:770/1024},{x:314/1024,y:770/1024}]);
});
test('all gull flight and maximum player avoidance remain over actual water; moths stay at the lamp flames',()=>{
    const water=SECTOR_FLOOR_LAYOUTS[sectorArtKey(2)].hydrology!.waterTiles;
    for(let phase=0;phase<180;phase+=.13)for(const index of [0,1]){
        for(const bias of [{x:0,y:0},{x:1,y:-1},{x:-1,y:1}]){
            const p=harborGullPoint(index,phase,bias),tile=Math.floor(p.y*12)*12+Math.floor(p.x*12);assert(water.includes(tile),`${index}:${phase}:${tile}`);
        }
        const p=lampMothPoint(index,phase),lamp=MOONWELL_MOTH_LAMPS[index];
        assert(Math.abs(p.x-lamp.x)<=23/1024);assert(Math.abs(p.y-lamp.y)<=23/1024*.65);
    }
});
test('moths require the actual displayed supported or radiant Moonwell floor at night',()=>{
    for(const suffix of ['supported','radiant'])assert(moonwellLampsLit(23,true,`https://game.invalid/sector-life/moonwell-${suffix}-shrine-v1.webp`));
    for(const [sector,night,source] of [[23,false,'/sector-life/moonwell-supported-shrine-v1.webp'],[24,true,'/sector-life/moonwell-supported-shrine-v1.webp'],[23,true,'/sector-life/moonwell-dormant-shrine-v1.webp'],[23,true,'/sector-map/s16.webp'],[23,true,undefined]] as const)assert.equal(moonwellLampsLit(sector,night,source),false);
});
test('displayed-floor notifications are change-only and an old renderer cannot clear its replacement',()=>{
    const first={},replacement={};let calls=0;const stop=subscribeDisplayedSectorFloor(23,()=>calls++);
    recordDisplayedSectorFloor(first,23,'dormant');recordDisplayedSectorFloor(first,23,'dormant');assert.equal(calls,1);
    recordDisplayedSectorFloor(replacement,23,'lit');assert.equal(calls,2);forgetDisplayedFloors(first);
    assert.equal(displayedSectorFloor(23),'lit');assert.equal(calls,2);forgetDisplayedFloors(replacement);
    assert.equal(displayedSectorFloor(23),undefined);assert.equal(calls,3);stop();
});
