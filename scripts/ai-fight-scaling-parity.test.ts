/*
 * Parity guard for step 3c: the server's AI-fight scaling
 * (api/missions/_ai-fight-scaling.ts) MUST match the client's
 * (shinobij.client/src/data/combat-missions.ts).
 *
 * This decides how hard a combat-mission foe is. A silent divergence means the
 * server seals a different opponent than the client shows — the exact class of
 * bug the migration exists to remove, and one no other test would catch.
 *
 * It also pins the CLAIM this module is built on: that the SERVER re-levels a
 * combat-mission AI and nothing on the client does. This used to permit exactly
 * one client call site (the browser PvE reducer's, gated on combat missions);
 * that reducer is gone and every encounter is now sealed server-side, so the
 * guard below asserts zero client call sites.
 *
 * Lives in scripts/ — excluded from both build roots — like the other
 * cross-build-root parity tests.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, globSync } from 'node:fs';

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

    it('no client screen re-levels its AI — the server owns every encounter build', () => {
        // The load-bearing premise of _ai-fight-scaling.ts. This used to allow
        // exactly ONE client call site (the combat-mission one in the browser PvE
        // reducer). That reducer is deleted and every fight is now built server
        // side, so the invariant tightened: a client screen that re-levels an AI
        // would scale it locally while the server builds it at the authored
        // level — silently divergent, and unenforceable besides.
        const screens = globSync('shinobij.client/src/**/*.{ts,tsx}')
            .map((file) => file.replaceAll('\\', '/'))
            .filter((file) => !/\.test\.tsx?$/.test(file));
        const offenders = screens.filter((file) => {
            const src = readFileSync(file, 'utf8');
            // The definition itself and doc comments referring to it are fine;
            // an actual invocation is not.
            return /\brelevelBuiltinAi\(/.test(src) && !/export function relevelBuiltinAi\(/.test(src);
        });
        assert.deepEqual(
            offenders, [],
            'a client screen re-levels its AI again; server-side encounter building is the only supported path '
            + '(see api/missions/_ai-fight-scaling.ts)',
        );
    });
});
