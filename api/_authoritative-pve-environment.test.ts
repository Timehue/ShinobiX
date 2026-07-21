import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { missionEnvironment, dynamicBossFloor } from './_authoritative-pve.js';

// Locks the combat-mission battlefield theming (Phase 1 of "missions play like the
// Arena"): the biome drives the board art + the shared +10% school terrain buff,
// and the optional weather feeds the engine's wMult ±element term. The wMult fold
// itself is default-off (no session.weather → ×1), which the tower-engine suite
// covers by staying byte-identical.
describe('mission battlefield environment', () => {
    it('themes each combat mission to a biome, central fallback for the rest', () => {
        assert.equal(missionEnvironment('combat-d-errand').biome, 'forest');
        assert.equal(missionEnvironment('combat-c-patrol').biome, 'volcano');
        assert.equal(missionEnvironment('combat-b-escort').biome, 'snow');
        assert.equal(missionEnvironment('combat-a-hunt').biome, 'shadow');
        assert.equal(missionEnvironment('combat-e-drill').biome, 'central');
        assert.equal(missionEnvironment('combat-s-crisis').biome, 'central');
        assert.equal(missionEnvironment('unknown-mission').biome, 'central');
    });

    it('seals themed weather only for the weathered missions', () => {
        assert.deepEqual(missionEnvironment('combat-c-patrol').weather, { positiveElement: 'Fire', negativeElement: 'Water' });
        assert.deepEqual(missionEnvironment('combat-b-escort').weather, { positiveElement: 'Water', negativeElement: 'Fire' });
        assert.deepEqual(missionEnvironment('combat-a-hunt').weather, { positiveElement: 'Lightning', negativeElement: 'Earth' });
        assert.equal(missionEnvironment('combat-e-drill').weather, undefined);
        assert.equal(missionEnvironment('combat-s-crisis').weather, undefined);
    });

    it('dynamicBossFloor carries the sealed biome onto the floor (central default)', () => {
        assert.equal(dynamicBossFloor({ id: 1, name: 'x', bossAiId: 'y', biome: 'volcano' }).biome, 'volcano');
        assert.equal(dynamicBossFloor({ id: 1, name: 'x', bossAiId: 'y' }).biome, 'central');
    });
});
