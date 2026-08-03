/*
 * Parity guard for step 3c: the server's AI-fight scaling
 * (api/missions/_ai-fight-scaling.ts) MUST match the client's
 * (shinobij.client/src/data/combat-missions.ts).
 *
 * This decides how hard a combat-mission foe is. A silent divergence means the
 * server seals a different opponent than the client shows — the exact class of
 * bug the migration exists to remove, and one no other test would catch.
 *
 * It also pins the CLAIM this module is built on: that combat missions are the
 * ONLY entry point which re-levels its AI. `relevelBuiltinAi` has a single call
 * site in the client, gated on combat missions; if a second one ever appears,
 * the server is silently wrong for that mode and this fails.
 *
 * Lives in scripts/ — excluded from both build roots — like the other
 * cross-build-root parity tests.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// Client (source of truth)
import {
    COMBAT_MISSIONS as CLIENT_MISSIONS,
    missionAiLevelAndBonus as clientScaling,
} from '../shinobij.client/src/data/combat-missions';

// Server (the port under test)
import { COMBAT_MISSIONS } from '../api/missions/_mission-catalog';
import {
    combatMissionByAiId,
    combatMissionRank,
    missionAiLevelAndBonus,
    resolveAiFightScaling,
} from '../api/missions/_ai-fight-scaling';

const LEVELS = [...Array.from({ length: 100 }, (_, i) => i + 1), 0, -1, 101, 150, Number.NaN];

describe('AI-fight scaling parity (server ⇄ client)', () => {
    it('the two combat-mission catalogs agree on key, min, rank and AI profile', () => {
        assert.equal(COMBAT_MISSIONS.length, CLIENT_MISSIONS.length, 'mission count');
        for (const client of CLIENT_MISSIONS) {
            const server = COMBAT_MISSIONS.find(m => m.key === client.key);
            assert.ok(server, `server catalog is missing ${client.key}`);
            assert.equal(server.min, client.min, `${client.key}: min`);
            assert.equal(server.aiProfileId, client.aiProfileId, `${client.key}: aiProfileId`);
            // The server derives rank from the key; the client stores it.
            assert.equal(combatMissionRank(server), client.rank, `${client.key}: derived rank`);
        }
    });

    it('level, statBonus and hp floor match at every player level, for every mission', () => {
        for (const client of CLIENT_MISSIONS) {
            const server = COMBAT_MISSIONS.find(m => m.key === client.key)!;
            for (const level of LEVELS) {
                assert.deepEqual(
                    missionAiLevelAndBonus(server, level),
                    clientScaling(client, level),
                    `${client.key} @ player level ${level}`,
                );
            }
        }
    });

    it('resolveAiFightScaling reproduces the client curve for a mission fight', () => {
        for (const client of CLIENT_MISSIONS) {
            for (const level of [1, 5, 15, 30, 50, 70, 100]) {
                const expected = clientScaling(client, level);
                assert.deepEqual(
                    resolveAiFightScaling({ opponentId: client.aiProfileId, battleKind: 'mission', playerLevel: level }),
                    { level: expected.level, statBonus: expected.statBonus, hpFloor: expected.hp },
                    `${client.key} @ ${level}`,
                );
            }
        }
    });

    it('every mission AI profile is reachable by id', () => {
        for (const client of CLIENT_MISSIONS) {
            assert.equal(combatMissionByAiId(client.aiProfileId)?.key, client.key, client.key);
        }
    });

    it('resolves to undefined for every non-mission fight', () => {
        // Not a gap — the verified answer. Those modes use the authored level on
        // BOTH sides, so undefined is what keeps them identical.
        const id = CLIENT_MISSIONS[0].aiProfileId;
        for (const kind of ['practice', 'raidAi', 'defense', 'explore', 'endless', '', undefined, null]) {
            assert.equal(
                resolveAiFightScaling({ opponentId: id, battleKind: kind, playerLevel: 50 }),
                undefined,
                `battleKind ${String(kind)} must not scale`,
            );
        }
        // ...and an unknown opponent never scales, even claiming 'mission'.
        assert.equal(
            resolveAiFightScaling({ opponentId: 'not-a-mission-ai', battleKind: 'mission', playerLevel: 50 }),
            undefined,
        );
    });

    it('combat missions are still the ONLY entry point that re-levels its AI', () => {
        // The load-bearing premise of _ai-fight-scaling.ts. If a second call site
        // appears, that entry point now scales on the client while the server
        // builds it at the authored level — silently divergent.
        const arena = readFileSync('shinobij.client/src/screens/Arena.tsx', 'utf8');
        const calls = arena.match(/relevelBuiltinAi\(/g) ?? [];
        assert.equal(
            calls.length, 1,
            `expected exactly ONE relevelBuiltinAi call site in Arena.tsx, found ${calls.length} — `
            + 'a new entry point re-levels its AI and api/missions/_ai-fight-scaling.ts must learn it',
        );
        assert.ok(
            /missionAiLevelAndBonus\(combatMissionForAi, character\.level\)/.test(arena),
            'the surviving call site is no longer the combat-mission one — re-verify the server port',
        );
    });
});
