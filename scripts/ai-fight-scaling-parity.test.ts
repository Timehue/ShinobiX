/*
 * Parity guard for step 3c: the server's AI-fight scaling
 * (api/missions/_ai-fight-scaling.ts) MUST match the client's
 * (shinobij.client/src/data/combat-missions.ts).
 *
 * This decides how hard a combat-mission foe is. A silent divergence means the
 * server seals a different opponent than the client shows — the exact class of
 * bug the migration exists to remove, and one no other test would catch.
 *
 * AI scaling is now owned by the sealed server start. The client host submits
 * intent and renders the returned Solo PvE session; it does not re-level a
 * local combatant.
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

    it('mission re-leveling is owned by the sealed server start', () => {
        const start = readFileSync('api/missions/ai-fight-start.ts', 'utf8');
        const encounter = readFileSync('api/solo-pve/_ai-encounter.ts', 'utf8');
        const host = readFileSync('shinobij.client/src/components/AiFightHost.tsx', 'utf8');

        assert.doesNotMatch(host, /relevelBuiltinAi|missionAiLevelAndBonus/, 'the live AI host must not scale a local combatant');
        assert.match(start, /resolveAiFightScaling\(\{\s*opponentId: body\.opponentId,\s*battleKind: body\.battleKind,\s*playerLevel:/, 'sealed AI start no longer resolves mission scaling from server inputs');
        assert.match(start, /\.\.\.\(scaling \? \{ scaling \} : \{\}\)/, 'sealed AI start no longer passes resolved scaling into encounter construction');
        assert.match(encounter, /const profile = params\.scaling && Number\.isFinite\(params\.scaling\.level\)\s*\? relevelAiProfile\(/, 'Solo PvE encounter no longer applies sealed scaling');
    });
});
