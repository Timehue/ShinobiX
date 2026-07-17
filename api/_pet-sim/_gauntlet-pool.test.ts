import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawPetPool } from '../../shinobij.client/src/data/pet-pool.js';
import { balanceBuiltInPetTemplate } from '../../shinobij.client/src/lib/pet-balance.js';
import { derivePetRole } from '../../shinobij.client/src/lib/pet-roles.js';
import { GAUNTLET_EXCLUDED_IDS } from '../../shinobij.client/src/lib/pet-gauntlet.js';
import { GAUNTLET_POOL } from './_gauntlet-pool.js';

/*
 * Drift guard: the server's GAUNTLET_POOL MUST equal the client's balanced draft
 * pool — same ids, IN THE SAME ORDER (rollShop picks tiers by index, so order is
 * load-bearing for reproducing a run), same stats/role/element, and same jutsu
 * kits (kind/power/cooldown drive the fight). A divergence would make the server
 * re-sim disagree with the run the player actually played — wrongly rejecting a
 * legit run, or paying a fabricated one. Same pattern as _card-catalog.test.ts.
 */
test('GAUNTLET_POOL matches the client balanced pool exactly (order, stats, role, jutsus)', () => {
    const expected = rawPetPool.map(balanceBuiltInPetTemplate).filter((p) => !GAUNTLET_EXCLUDED_IDS.has(p.id));
    assert.equal(GAUNTLET_POOL.length, expected.length, 'pool size matches');
    for (let i = 0; i < expected.length; i++) {
        const p = expected[i];
        const server = GAUNTLET_POOL[i];
        assert.equal(server.id, p.id, `index ${i} id (order preserved)`);
        const role = (p.role as string | undefined) ?? derivePetRole(p).role;
        assert.equal(server.name, p.name, `${p.id} name`);
        assert.equal(server.element, p.element ?? null, `${p.id} element`);
        assert.equal(server.rarity, p.rarity, `${p.id} rarity`);
        assert.equal(server.role, role, `${p.id} role`);
        assert.equal(server.hp, Math.round(p.hp), `${p.id} hp`);
        assert.equal(server.attack, Math.round(p.attack), `${p.id} attack`);
        assert.equal(server.defense, Math.round(p.defense), `${p.id} defense`);
        assert.equal(server.speed, Math.round(p.speed), `${p.id} speed`);
        const jut = (p.jutsus ?? []).map((j: { name: string; kind: string; power: number; cooldown: number }) => ({ name: j.name, kind: j.kind, power: Math.round(j.power), cooldown: Math.round(j.cooldown) }));
        assert.deepEqual(server.jutsus, jut, `${p.id} jutsus`);
    }
});
