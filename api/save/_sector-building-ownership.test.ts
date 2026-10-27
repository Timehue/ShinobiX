import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave, combatProjection } from './[name].js';
const forged={version:1,repairs:999,shardClaims:0,active:{kind:'repair',materials:{'gather-iron-sand-pristine':999}},receipts:[]};
test('building work, escrow and reward latches cannot be created, erased or advanced by generic saves',()=>{
    for(const existing of [null,{character:{}},{character:{sectorBuildings:{version:1,repairs:2,active:{id:'live-reserved-order'}}}}]){
        const result=sanitizeCharacterSave({character:{sectorBuildings:forged}},existing);
        assert.deepEqual((result.character as Record<string,unknown>).sectorBuildings,existing?.character&&'sectorBuildings'in existing.character?existing.character.sectorBuildings:undefined);
        assert.equal((combatProjection(result).character as Record<string,unknown>)?.sectorBuildings,undefined);
    }
});
