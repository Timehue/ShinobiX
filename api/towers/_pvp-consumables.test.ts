/*
 * Ranked 2v2 (and Clan War 2v2) seal a consumable kit; the open Team Arena seals none.
 * The kit used to be granted and then refused by the action allowlist, so a ranked 2v2
 * fighter could never use the pills, smoke bomb or potion the Ranked Format promises.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _makeMemoryKv } from '../_storage.js';
import type { TowerKv, TowerLock } from './_tower-store.js';
import { applyTowerPvpCommand } from './_pvp-action.js';
import { activateReadyTowerPvpMatch, createTowerPvpMatch, type TowerPvpFighterSeed } from './_pvp-session.js';
import { readTowerPvpMatch, writeTowerPvpMatch, type TowerPvpStoreDeps } from './_pvp-store.js';
import { sealRankedFormatItemCharges } from '../pvp/_ranked-format.js';

const NOW = 1_800_000_000_000;
const PILL = { id: 'item-attack-pill', name: 'Attack Pill', slot: 'item', weaponCooldown: 5, weaponEffect: 'Increase Damage Given', weaponEffectValue: 15, apCost: 20 };

function fighter(slug: string, skill: number, kit: boolean): TowerPvpFighterSeed {
    return {
        slug,
        displayName: slug.toUpperCase(),
        skill,
        character: {
            name: slug, level: 100, specialty: 'Ninjutsu', maxHp: 1_000, maxChakra: 100, maxStamina: 100,
            stats: { ninjutsuOffense: 220 }, jutsu: [],
            pvpItems: [PILL], equipment: { item1: PILL.id },
        },
        ...(kit ? { itemCharges: sealRankedFormatItemCharges() } : {}),
    };
}

function deps(): TowerPvpStoreDeps & { kv: TowerKv } {
    const lock: TowerLock = async (_key, fn) => fn();
    return {
        kv: _makeMemoryKv() as unknown as TowerKv,
        lock,
        now: () => NOW,
        claim: async (_matchId, members) => ({ ok: true, members: [...members], replayed: true }),
        release: async () => undefined,
    };
}

async function match(id: string, kit: boolean, store: TowerPvpStoreDeps) {
    const m = createTowerPvpMatch({
        matchId: id,
        fighters: [fighter('alpha', 400, kit), fighter('bravo', 300, kit), fighter('charlie', 200, kit), fighter('delta', 100, kit)],
        seed: 5,
        now: NOW,
    });
    m.roster.forEach(member => { member.ready = true; });
    activateReadyTowerPvpMatch(m, NOW);
    await writeTowerPvpMatch(m, store);
    return m;
}

describe('Team PvP consumables follow the sealed match rule', () => {
    it('a match with a sealed kit accepts the item action and spends a charge', async () => {
        const store = deps();
        const id = `tpvp-${'e'.repeat(32)}`;
        const m = await match(id, true, store);
        assert.equal(m.rules.consumables, 'enabled');
        const result = await applyTowerPvpCommand({
            matchId: id, slug: 'alpha', type: 'item', itemId: PILL.id,
            moveToken: 'tower-pvp-token-pill-0001', expectedVersion: m.version,
        }, store);
        assert.equal(result.applied, true, result.reason ?? 'rejected');
        const after = await readTowerPvpMatch(id, store);
        const alpha = after!.combat.actors.find(actor => actor.ownerSlug === 'alpha')!;
        assert.equal(alpha.itemCharges?.[PILL.id], 1, 'one of the two sealed charges is spent');
        assert.ok(alpha.statuses.some(status => status.source === PILL.id), 'the pill applies its buff');
    });

    it('the open Team Arena still refuses items', async () => {
        const store = deps();
        const id = `tpvp-${'f'.repeat(32)}`;
        const m = await match(id, false, store);
        assert.equal(m.rules.consumables, 'disabled');
        const result = await applyTowerPvpCommand({
            matchId: id, slug: 'alpha', type: 'item', itemId: PILL.id,
            moveToken: 'tower-pvp-token-pill-0002', expectedVersion: m.version,
        }, store);
        assert.equal(result.applied, false);
        assert.equal(result.reason, 'invalid-action-type');
    });
});
