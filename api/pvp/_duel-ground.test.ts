import test from 'node:test';
import assert from 'node:assert/strict';
import { sealDuelGround } from './_duel-ground.js';
import { worldPositionModel } from '../../shared/continuous-world-layout.js';
import { nearestWalkableTile } from '../../shared/sector-walk-mask.js';

test('a cosmetic duel site is sealed from fresh real presence, never a later winner position',()=>{
    const sector=15,now=1_800_000_000_000,tile=nearestWalkableTile(sector,123);
    const first={sector,tile,lastSeenAt:now},second={...first,worldPosition:worldPositionModel().fallback(sector,tile)!};
    const site=sealDuelGround(true,sector,first,second,now);assert.deepEqual(site,{sector,tile});
    second.worldPosition=worldPositionModel().fallback(42,99)!;assert.deepEqual(site,{sector,tile});
    assert.equal(sealDuelGround(true,sector,first,second,now),undefined);
    for(const bad of [{lastSeenAt:now-30_001},{lastSeenAt:now+1},{sector:42},{worldPosition:{}},{tile:-1},{travelingUntil:now+1}])
        assert.equal(sealDuelGround(true,sector,first,{...first,...bad},now),undefined,JSON.stringify(bad));
    assert.equal(sealDuelGround(false,sector,first,first,now),undefined);
    assert.equal(sealDuelGround(true,99,{...first,sector:99},{...first,sector:99},now),undefined);
    assert.equal(sealDuelGround(true,sector,undefined,first,now),undefined);
});
