import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {lifeActorsAt,lifeActorPosition} from './sector-life';
import {WORLD_HOUR_MS} from './world-clock';
import {LIFE_ROAD_CREWS} from './sector-life-routines';

const review=JSON.parse(readFileSync(new URL('./winter-supply-art-review.json',import.meta.url),'utf8'));
const hash=(file:string)=>createHash('sha256').update(readFileSync(new URL(`../${file}`,import.meta.url))).digest('hex');
test('four winter compositions retain their checked source, original ground and shrine-light states',()=>{
    assert.equal(review.sector,31);assert.equal(review.artKey,53);assert.equal(review.paintings.length,4);
    assert.deepEqual(review.areas,[{left:434,top:718,width:44,height:92},{left:472,top:735,width:110,height:105}]);
    assert.deepEqual(review.protected,[{left:479,top:717,width:36,height:43}]);
    for(const painting of review.paintings){
        assert.match(painting.visualReview,/^passed/,'regenerated compositions require a fresh actual review before admission');
        assert.equal(painting.baseSha256,hash(painting.baseFile));
        assert.equal(painting.deliveredSha256,hash(`shinobij.client/public/sector-life/${painting.key}.webp`));
        assert.equal(painting.changedOutside,0);assert.deepEqual(painting.areas,review.areas);assert.deepEqual(painting.protected,review.protected);
        assert.equal(painting.width,1024);assert.equal(painting.height,1024);assert(painting.bytes<280_000);
        // The only local mine is the northern rime seam, far above the patch.
        assert(painting.areas.every((area:{top:number})=>area.top>=718));
    }
    assert.deepEqual(review.paintings.slice(1).map((p:{key:string})=>p.key),['frostveil-dormant-shrine-supply-v2','frostveil-supported-shrine-supply-v2','frostveil-radiant-shrine-supply-v2']);
});
test('the snow pair warms below the supplies and keeps every approach, rain return and cached closing leg clear',()=>{
    const time=8*WORLD_HOUR_MS,crew=lifeActorsAt(31,time,'clear').filter(actor=>actor.id.startsWith('crew:'));
    assert.deepEqual(crew.map(a=>a.restTile),[125,126]);
    assert.equal(crew.length,2);const blocked=[101,102,113,114];
    for(const weather of ['clear','rain'])for(const actor of lifeActorsAt(31,time,weather).filter(a=>a.id.startsWith('crew:'))){
        assert.deepEqual(actor.clearance,blocked);
        for(const [,tile] of actor.motion!.frames)assert(!blocked.includes(tile),`${weather}: ${actor.id} crosses supplies or the quartermaster`);
        assert(!blocked.includes(actor.hideTile!));
        const finish=lifeActorPosition(31,actor,actor.hideAt!+1000);assert.equal(finish.row*12+finish.col,actor.hideTile);
    }
    const phase=crew[0].cyclePhases!.find(p=>p.activity==='Warming up between road rounds')!;
    assert(phase);assert.match(phase.line,/brazier/);assert(phase.line.includes(LIFE_ROAD_CREWS[31].names[1]));
    assert.equal(phase.workTile,125);
});
