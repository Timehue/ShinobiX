import test from 'node:test';
import assert from 'node:assert/strict';
import {frontierEmissaryHomeTile} from './frontier-emissary-placement';
import {EMISSARY_DEFS,EMISSARY_WANDERER_PREFIX} from './legacy-emissaries';
import {loiterPositionAt} from './wanderer-loiter';
import {isWalkableTile} from '../../../shared/sector-walk-mask';
import {FRONTIER_SITES,frontierRestSpot} from '../../../shared/sector-frontier-work';

test('every Hollow emissary seed leaves native resting, work and gear sites clear throughout its loop',()=>{
    const site=FRONTIER_SITES[55],reserved=[frontierRestSpot(55,79),site.stop,site.inspection,...site.clearance];
    for(const def of EMISSARY_DEFS)for(let row=2;row<=9;row++)for(let col=2;col<=9;col++){
        const id=EMISSARY_WANDERER_PREFIX+def.slug,seed=row*12+col,home=frontierEmissaryHomeTile(55,id,seed);
        assert(isWalkableTile(55,home));assert.equal(frontierEmissaryHomeTile(55,id,seed),home);
        for(let at=0;at<60_000;at+=100){
            const p=loiterPositionAt(id,home,at,tile=>isWalkableTile(55,tile));
            for(const tile of reserved)assert(Math.max(Math.abs(p.col-tile%12),Math.abs(p.row-Math.floor(tile/12)))>=1,`${id} seeded at ${seed} crosses reserved ${tile} at ${at}ms`);
        }
    }
});

test('other sectors retain the exact seeded emissary placement',()=>{
    for(const sector of [9,42,52,60])for(const home of [26,69,78,117])assert.equal(frontierEmissaryHomeTile(sector,'legacy-emissary-mapless-ojii',home),home);
});
