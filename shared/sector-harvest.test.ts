import test from 'node:test';
import assert from 'node:assert/strict';
import { harvestGroundTile,validHarvestGround,HARVEST_GROUND_MS } from './sector-harvest.js';
import { PLAYABLE_WILD_SECTOR_IDS } from './sector-geo.js';
import { sectorWalkMask,walkPath } from './sector-walk-mask.js';
import { sealGatherFind,applyGatherClaim } from '../api/world/_gather.js';

test('every sealed harvest location is nearby connected verge ground, never a road or closed structure',()=>{
    for(const sector of PLAYABLE_WILD_SECTOR_IDS){let sites=0;for(let origin=0;origin<144;origin++){
        const tile=harvestGroundTile(sector,origin);if(tile===undefined)continue;sites++;
        assert.equal(sectorWalkMask(sector)![Math.floor(tile/12)][tile%12],'.');assert(walkPath(sector,origin,tile)!.length<=3);
        assert(validHarvestGround(sector,{tile,at:1000},1000));
    }assert(sites>0,`sector ${sector} has no gatherable verge`);}
    assert.equal(harvestGroundTile(0,77),undefined);assert.equal(harvestGroundTile(15,NaN),undefined);
});
test('finds and replay receipts retain the server location and original discovery time without changing rewards',()=>{
    const tile=harvestGroundTile(42,125)!,find=sealGatherFind('harvest-sealed-find-01',42,()=>1,1000,tile)!;
    assert.equal(find.groundTile,tile);const choice={common:'gather-field-herb' as const,takeTrace:false};
    const first=applyGatherClaim({pendingGatherFinds:[find]},find.id,42,choice);assert(first.ok);if(!first.ok)return;
    assert.deepEqual(first.ground,{tile,at:1000});assert.deepEqual(first.rewards,[{itemId:'gather-field-herb',count:3}]);
    const again=applyGatherClaim(first.character,find.id,42,choice);assert(again.ok);if(again.ok){assert.equal(again.character,first.character);assert.deepEqual(again.ground,first.ground);}
    assert.equal(validHarvestGround(42,first.ground,1000+HARVEST_GROUND_MS),false);
    const legacy=sealGatherFind('harvest-legacy-find-01',42,()=>1,1000)!;
    const old=applyGatherClaim({pendingGatherFinds:[legacy]},legacy.id,42,choice);assert(old.ok);if(old.ok)assert.equal(old.ground,undefined);
    assert.equal(validHarvestGround(42,{tile:65,at:1000},1000),false,'stone road cannot become harvested earth');
    assert.equal(validHarvestGround(42,{tile,at:1001},1000),false);
});
