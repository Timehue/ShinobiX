import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEGACY_DEFS, STAT_CATEGORY } from './_legacy-defs.js';
import { trialObjectivesFor, trialProgress } from './_legacy-core.js';
import { LEGACY_TRIAL_PATHS, LEGACY_SESSION_YIELDS, LEGACY_AWAKENING_SESSIONS } from './_legacy-trial-paths.js';
import { evaluateLegacy } from './_legacy-score.js';
import { BATTLE_TOWERS_MIN_LEVEL } from '../shared/tower-pvp.js';
import { RIFT_QUESTS } from './sector/_rift-quest.js';
import type { LegacyStatKey } from './_legacy-defs.js';

const finiteOrScheduled = new Set<LegacyStatKey>(['tilesExplored', 'firstClears', 'endlessTowerBest',
    'arenaTournaments', 'weeklyBossTop10', 'eventCompletions', 'warsWon', 'sectorCaptures']);

test('every qualification requirement has a sustainable route after finite or scheduled proof is exhausted', () => {
    for (const def of LEGACY_DEFS) {
        const stats: Partial<Record<LegacyStatKey, number>> = {};
        for (const req of def.reqs) {
            const alternatives = 'stat' in req ? [req] : req.anyOf;
            const proof = alternatives.find(proof => !finiteOrScheduled.has(proof.stat));
            assert.ok(proof, `${def.id}: exhausted or unavailable proof has no repeatable alternative`);
            stats[proof.stat] = Math.max(stats[proof.stat] ?? 0, proof.atLeast);
        }
        assert.equal(evaluateLegacy(def, stats).eligible, true, def.id);
    }
});

test('every high-tier qualification route retains its required category breadth, including alternatives', () => {
    for (const def of LEGACY_DEFS.filter(def => def.rarity === 'legendary' || def.rarity === 'mythic')) {
        let routes = [new Set<string>()];
        for (const req of def.reqs) routes = routes.flatMap(route => ('stat' in req ? [req] : req.anyOf)
            .map(proof => new Set([...route, STAT_CATEGORY[proof.stat]])));
        for (const route of routes) assert.ok(route.size >= (def.rarity === 'mythic' ? 4 : 2), def.id);
    }
});

test('all 100 paths have two individual repeatable routes through every stage, without level-100 or Era dependencies', () => {
    assert.deepEqual(Object.keys(LEGACY_TRIAL_PATHS).sort(), LEGACY_DEFS.map(def => def.id).sort());
    // The current sources used by the new proof types open before the cap.
    assert.ok(BATTLE_TOWERS_MIN_LEVEL < 100);
    assert.ok(RIFT_QUESTS['rift-legacy-echo'].levelReq <= 50);
    for (const def of LEGACY_DEFS) for (const kind of ['awaken', 'bind', 'prove', 'mythic'] as const) {
        for (const variant of [0, 1]) {
            const objectives = trialObjectivesFor(def, kind, variant);
            assert.equal(new Set(objectives.map(o => o.stat)).size, objectives.length, `${def.id}: duplicate proof`);
            for (const objective of objectives) {
                assert.ok(LEGACY_SESSION_YIELDS[objective.stat], `${def.id}: proof has no repeatable pre-100 earning route`);
                assert.ok(!finiteOrScheduled.has(objective.stat), `${def.id}: finite fresh-delta objective`);
                assert.ok(!objective.stat.startsWith('era'), `${def.id}: circular Era dependency`);
            }
            const baselines = Object.fromEntries(objectives.map(o => [o.stat, 100]));
            const current = Object.fromEntries(objectives.map(o => [o.stat, 100 + o.delta]));
            assert.ok(trialProgress({ legacyId: def.id, kind, variant, startedAt: 1, attempt: 1, objectives, baselines }, current)
                .every(o => o.done), `${def.id}/${kind}/${variant}`);
        }
    }
});

test('Awakening effort increases strictly through the four rarities', () => {
    const budgets = ['basic', 'rare', 'legendary', 'mythic'].map(tier => LEGACY_AWAKENING_SESSIONS[tier as keyof typeof LEGACY_AWAKENING_SESSIONS]);
    for (let i = 1; i < budgets.length; i++) assert.ok(budgets[i] > budgets[i - 1]);
    assert.ok(budgets[0] >= 1 && budgets[0] <= 2);
    assert.ok(budgets[1] >= 3 && budgets[1] <= 5);
    assert.ok(budgets[2] >= 5 && budgets[2] <= 10);
    assert.ok(budgets[3] >= 15 && budgets[3] <= 20);
});
