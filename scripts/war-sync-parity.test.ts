/*
 * War-system client/server SYNC-PAIR parity.
 *
 * The village/clan war work (2026-08-06) created several constants that exist on
 * BOTH sides of the wire with a "KEEP IN SYNC" comment. Each drifts silently and
 * each failure mode is nasty:
 *
 *   · CLAN_WAR_PET_DUEL — the client REPLAYS the server-resolved pet duel with
 *     these pinned engine params; drift makes the animated fight disagree with
 *     the recorded winner. Invisible to unit tests, very visible to players.
 *   · Sector garrison liveness window — the client shows/hides the "Assault
 *     Garrison" button off its own GARRISON_UNLOCK_IDLE_MS copy; drift would
 *     offer (or hide) it at the wrong time. The fight itself must keep
 *     resolving on Solo PvE, never Tower's resolveMercBattle/sealTowerFighter
 *     (that was the wrong-owner defect the 2026-08-15 retirement fixed;
 *     rebuilding garrison on Tower again would reintroduce it).
 *   · The war-morale multipliers — the server applies them at the reward seal;
 *     the client's copies are the DISPLAY mirror. Drift means players are shown
 *     one number and given another.
 *   · VILLAGE_WAR_MISSION_DAMAGE — sealed into the war-mission token server-side
 *     and applied to the war record client-side; drift makes the mission token
 *     authorize a different amount than the client writes.
 *
 * This test imports both sides (same cross-package pattern as
 * api/_pet-sim/gauntlet-sim.test.ts) and fails the build on any drift, so the
 * comment becomes a gate. Lives in scripts/ — a run-tests.mjs scan root — like
 * the other cross-package parity tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CLAN_WAR_PET_DUEL as SERVER_PET_DUEL } from '../api/clan/war/_pet-duel.js';
import {
    WAR_DEBUFF_TRAINING_XP_MULT as S_DEBUFF_XP,
    WAR_DEBUFF_JUTSU_TIME_MULT as S_DEBUFF_TIME,
    WAR_BUFF_TRAINING_XP_MULT as S_BUFF_XP,
    WAR_BUFF_JUTSU_TIME_MULT as S_BUFF_TIME,
    resolveWarMorale as serverResolve,
} from '../api/_war-morale.js';
import { GARRISON_UNLOCK_IDLE_MS as SERVER_GARRISON_UNLOCK_IDLE_MS } from '../api/_sector-war.js';

import { CLAN_WAR_PET_DUEL as CLIENT_PET_DUEL } from '../shinobij.client/src/lib/clan-war-pet-api.js';
import {
    WAR_DEBUFF_TRAINING_XP_MULT as C_DEBUFF_XP,
    WAR_DEBUFF_JUTSU_TIME_MULT as C_DEBUFF_TIME,
    WAR_BUFF_TRAINING_XP_MULT as C_BUFF_XP,
    WAR_BUFF_JUTSU_TIME_MULT as C_BUFF_TIME,
    resolveWarMorale as clientResolve,
} from '../shinobij.client/src/lib/war-debuff.js';
import { GARRISON_UNLOCK_IDLE_MS as CLIENT_GARRISON_UNLOCK_IDLE_MS } from '../shinobij.client/src/lib/village-war-map.js';

test('clan-war pet duel params are identical on both sides of the replay', () => {
    assert.deepEqual({ ...CLIENT_PET_DUEL }, { ...SERVER_PET_DUEL });
});

test('the sector garrison surface is live on Solo PvE, never on Tower', () => {
    assert.equal(CLIENT_GARRISON_UNLOCK_IDLE_MS, SERVER_GARRISON_UNLOCK_IDLE_MS);

    const clientApi = readFileSync(
        join(process.cwd(), 'shinobij.client', 'src', 'lib', 'sector-war-garrison-api.ts'),
        'utf8',
    );
    const serverHandler = readFileSync(
        join(process.cwd(), 'api', 'village', 'sector-war.ts'),
        'utf8',
    );

    // The rebuilt garrison action names, actually wired both sides.
    assert.match(clientApi, /action:\s*["']garrison-start["']/);
    assert.match(clientApi, /action:\s*["']garrison-resolve["']/);
    assert.match(serverHandler, /case 'garrison-start': return await doGarrisonStart\(/);
    assert.match(serverHandler, /case 'garrison-resolve': return await doGarrisonResolve\(/);
    // The wrong-owner Tower resolver the 2026-08-15 retirement removed must
    // stay gone even though the surface itself is live again.
    assert.doesNotMatch(serverHandler, /resolveMercBattle|sealTowerFighter/);
});

test('war-morale multipliers shown match the ones applied at the seal', () => {
    assert.equal(C_DEBUFF_XP, S_DEBUFF_XP);
    assert.equal(C_DEBUFF_TIME, S_DEBUFF_TIME);
    assert.equal(C_BUFF_XP, S_BUFF_XP);
    assert.equal(C_BUFF_TIME, S_BUFF_TIME);
});

test('both morale resolvers pick the same window from the same stamps', () => {
    const NOW = Date.UTC(2026, 7, 6);
    const DAY = 86_400_000;
    const cases = [
        {},
        { warLossDebuffUntil: NOW + DAY },
        { warWinBuffUntil: NOW + DAY },
        { warLossDebuffUntil: NOW + DAY, warWinBuffUntil: NOW + 2 * DAY },
        { warLossDebuffUntil: NOW + 2 * DAY, warWinBuffUntil: NOW + DAY },
        { warLossDebuffUntil: NOW - 1, warWinBuffUntil: NOW - 1 },
    ];
    for (const stamps of cases) {
        const s = serverResolve(stamps, NOW);
        const c = clientResolve(stamps, NOW);
        assert.equal(c.morale, s.morale, JSON.stringify(stamps));
        assert.equal(c.xpMult, s.xpMult, JSON.stringify(stamps));
        assert.equal(c.jutsuTimeMult, s.jutsuTimeMult, JSON.stringify(stamps));
    }
});

test('the war-mission damage sealed into the token matches the client write', () => {
    // Both constants live in modules unsafe to import here (the server handler's
    // graph reaches live storage; the client's world-state.ts touches browser
    // globals), so compare the SOURCE — same approach world-reward-api.test.ts uses.
    const grab = (rel: string, re: RegExp) => {
        const m = readFileSync(join(process.cwd(), ...rel.split('/')), 'utf8').match(re);
        assert.ok(m, `${rel}: constant present`);
        return Number(m![1]);
    };
    assert.equal(
        grab('api/village/war-mission.ts', /const VILLAGE_WAR_MISSION_DAMAGE = (\d+);/),
        grab('shinobij.client/src/lib/world-state.ts', /export const VILLAGE_WAR_MISSION_DAMAGE = (\d+);/),
    );
});
