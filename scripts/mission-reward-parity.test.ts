import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { COMBAT_MISSIONS as SERVER_COMBAT, FIELD_MISSIONS as SERVER_FIELD } from '../api/missions/_mission-catalog.ts';
import { builtinFetchMissions, builtinHuntMissions } from '../shinobij.client/src/data/missions.ts';
import { COMBAT_MISSIONS as CLIENT_COMBAT } from '../shinobij.client/src/data/combat-missions.ts';

/*
 * The Mission Hall, Hunter Board and Logbook cards read their rewards from the
 * client mission tables, while the claim pays from the server catalog. The
 * inline replica in api/missions/_mission-catalog.test.ts pins the server
 * against a hand-typed copy; this pins the server against the REAL client
 * modules, so a re-price that misses a client row fails here instead of showing
 * stale rewards on the cards.
 *
 * It lives in scripts/ because it imports BOTH sides: api/** is compiled by
 * tsconfig.server.json, which excludes shinobij.client, so a server-side test
 * cannot import client data (the same home as chest-pool-parity).
 */

describe('mission rewards: client tables match the server catalog', () => {
    it('every hunt and fetch mission pays what its card shows', () => {
        const client = [...builtinHuntMissions, ...builtinFetchMissions];
        assert.deepEqual(client.map((m) => m.id).sort(), SERVER_FIELD.map((m) => m.id).sort(), 'same mission set');
        for (const server of SERVER_FIELD) {
            const card = client.find((m) => m.id === server.id)!;
            assert.equal(card.ryoReward, server.ryoReward, `${server.id} ryoReward`);
            assert.equal(card.staminaReward, server.staminaReward, `${server.id} staminaReward`);
            assert.equal(card.levelReq, server.levelReq, `${server.id} levelReq`);
            assert.equal(card.exploreCount, server.exploreCount, `${server.id} exploreCount`);
            assert.equal(Number(card.raidCount ?? 0), Number(server.raidCount ?? 0), `${server.id} raidCount`);
            assert.deepEqual(card.currencyRewards ?? {}, server.currencyRewards ?? {}, `${server.id} currencyRewards`);
            assert.deepEqual(card.itemRewards ?? [], server.itemRewards ?? [], `${server.id} itemRewards`);
        }
    });

    it('every combat mission pays what its card shows', () => {
        assert.deepEqual(CLIENT_COMBAT.map((m) => m.key), SERVER_COMBAT.map((m) => m.key), 'same missions, same order');
        for (const server of SERVER_COMBAT) {
            const card = CLIENT_COMBAT.find((m) => m.key === server.key)!;
            assert.equal(card.ryo, server.ryo, `${server.key} ryo`);
            assert.equal(card.min, server.min, `${server.key} min`);
            assert.equal(card.aiProfileId, server.aiProfileId, `${server.key} aiProfileId`);
            // xp is retired but hashed into the combat reward fingerprint.
            assert.equal(card.xp, server.xp, `${server.key} xp`);
            assert.equal(card.territoryScrolls, server.territoryScrolls, `${server.key} territoryScrolls`);
        }
    });
});
