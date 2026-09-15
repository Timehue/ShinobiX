import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARAVAN_EVENTS, caravanEvent } from './caravan-events.js';
import { CARAVAN_CONTRACTS, caravanDaily } from './caravan-contracts.js';
import { generateCaravanMap, weightedCaravanEvent } from './caravan-map.js';
import { caravanChoiceBlock, resolveCaravanChoice, selectCaravanNode } from './caravan-state.js';
import { sunscarRandom } from './random.js';
import { advanceCaravan, caravanProgress, departCaravan, settleCaravanCombat } from '../../api/festival/_caravan.js';
import { CARAVAN_ENEMIES } from '../../api/festival/_caravan-combat.js';
import { AI_PROFILE_CATALOG } from '../../api/_ai-profile-catalog.js';
import type { CaravanRun, CaravanWeather } from './caravan-types.js';

const now = Date.UTC(2026, 8, 15, 12);
const base = { name: 'escort', hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, level: 30, ryo: 10000, pets: [] };
function started() { return departCaravan(structuredClone(base), 'escort', { contractId: 'market-goods', tools: ['water', 'repair', 'medicine'] }, now); }
function eventRun(id: string): CaravanRun {
    const run = caravanProgress(started()).current!;
    run.currentNodeId = run.map[0].id;
    run.map[0].eventId = id;
    run.map[0].kind = caravanEvent(id).kind;
    run.visited = [run.map[0].id]; run.status = 'encounter';
    return run;
}
test('at least forty authored events have distinct titles, valid choices and real combat kits', () => {
    assert.ok(CARAVAN_EVENTS.length >= 40);
    assert.equal(new Set(CARAVAN_EVENTS.map(e => e.id)).size, CARAVAN_EVENTS.length);
    assert.equal(new Set(CARAVAN_EVENTS.map(e => e.scene)).size, CARAVAN_EVENTS.length);
    for (const event of CARAVAN_EVENTS) {
        assert.ok(event.scene.length > 65, event.id);
        assert.ok(event.choices.length >= 1);
        assert.equal(new Set(event.choices.map(c => c.id)).size, event.choices.length);
        for (const c of event.choices) if (c.effect.combat) assert.ok(AI_PROFILE_CATALOG[CARAVAN_ENEMIES[c.effect.combat].profile]);
    }
});
test('daily contracts and weather are deterministic and always offer three distinct jobs', () => {
    for (let rep = 0; rep <= 200; rep += 40) for (let stage = 0; stage <= 3; stage++) {
        const p = { reputation: rep, chains: { 'missing-shipment': stage, 'black-ledger': stage } };
        const daily = caravanDaily('escort', '2026-09-15', p);
        assert.deepEqual(daily, caravanDaily('escort', '2026-09-15', p));
        assert.equal(new Set(daily.contracts.map(c => c.id)).size, 3);
        assert.ok(daily.contracts.some(c => c.reputationRequired === 0));
    }
});
test('hundreds of generated maps are connected DAGs with a reachable destination from every node', () => {
    for (let seed = 0; seed < 150; seed++) {
        const contract = CARAVAN_CONTRACTS[seed % CARAVAN_CONTRACTS.length];
        const weather = (['clear', 'sandstorm', 'heat', 'bandits', 'festival', 'night'] as CaravanWeather[])[seed % 6];
        const map = generateCaravanMap(seed, contract, weather);
        assert.deepEqual(map, generateCaravanMap(seed, contract, weather));
        for (const node of map) {
            if (node.kind === 'destination') assert.equal(node.next.length, 0);
            else {
                assert.ok(node.next.length > 0);
                for (const id of node.next) assert.equal(map.find(n => n.id === id)!.layer, node.layer + 1);
            }
            if (node.layer > 0) assert.ok(map.some(n => n.next.includes(node.id)));
        }
        assert.equal(map.filter(n => n.kind === 'destination').length, 1);
    }
});
test('rare events are meaningfully rare, not a better-loot default', () => {
    const pool = CARAVAN_EVENTS.filter(e => e.kind === 'ruins' && !e.requiresFlag);
    const random = sunscarRandom(14);
    let rare = 0;
    for (let i = 0; i < 10000; i++) if (weightedCaravanEvent(pool, random).rare) rare++;
    assert.ok(rare > 60 && rare < 500, String(rare));
    assert.ok(CARAVAN_EVENTS.filter(e => e.rare).some(e => e.choices.every(c => !c.effect.bonus)));
});
test('route selection rejects teleporting and charges travel supplies', () => {
    const run = caravanProgress(started()).current!;
    assert.throws(() => selectCaravanNode(run, run.map.at(-1)!.id), /connected/);
    const next = selectCaravanNode(run, run.available[0]);
    assert.equal(next.supplies, run.supplies - 1);
    assert.equal(next.visited.length, 1);
    assert.throws(() => selectCaravanNode(next, run.available[0]), /connected/);
});
test('resource costs, actual vital changes and the cargo floor apply exactly once', () => {
    const c = started();
    const run = eventRun('glass-sand');
    c.sunscarCaravan = { ...caravanProgress(c), current: run };
    const body = { action: 'choose', runId: run.id, version: run.version, requestId: 'choice_test_1', choiceId: 'walk' };
    const result = advanceCaravan(c, body, now + 1000);
    assert.equal(result.character.stamina, 90);
    assert.equal(advanceCaravan(result.character, body, now + 2000).replay, true);
    assert.throws(() => advanceCaravan(result.character, { ...body, choiceId: 'mats' }, now), /different choice/);
});
test('choice availability respects supplies, tools and money', () => {
    const run = eventRun('wheelwright');
    const choice = caravanEvent('wheelwright').choices[0];
    assert.match(caravanChoiceBlock(run, choice, 0)!, /Ryo/);
    const storm = eventRun('sand-wall'); storm.tools.repair = 0; storm.supplies = 0;
    assert.ok(caravanChoiceBlock(storm, caravanEvent('sand-wall').choices[0], 10000));
    assert.ok(caravanChoiceBlock(storm, caravanEvent('sand-wall').choices[1], 10000));
    assert.equal(caravanChoiceBlock(storm, caravanEvent('sand-wall').choices[2], 10000), null);
});
test('seeded event outcomes cannot be rerolled by reload or clock changes', () => {
    const run = eventRun('buried-coins');
    assert.deepEqual(resolveCaravanChoice(run, 'dig', 10000), resolveCaravanChoice(JSON.parse(JSON.stringify(run)), 'dig', 10000));
});
test('earlier decisions produce a later authored follow-up', () => {
    const run = eventRun('broken-axle');
    const resolved = resolveCaravanChoice(run, 'kit', 10000).run;
    const target = resolved.map.find(n => resolved.available.includes(n.id))!;
    target.kind = 'merchant';
    const follow = selectCaravanNode(resolved, target.id);
    assert.equal(follow.map.find(n => n.id === follow.currentNodeId)!.eventId, 'nera-outpost');
});
test('real combat binding suspends travel, settles once, and defeat records a failure', () => {
    const c = started(); const run = eventRun('raider-toll');
    c.sunscarCaravan = { ...caravanProgress(c), current: run };
    const chosen = advanceCaravan(c, { action: 'choose', runId: run.id, version: run.version, requestId: 'fight_test_1', choiceId: 'fight' }, now).character;
    const fighting = caravanProgress(chosen).current!;
    assert.equal(fighting.status, 'combat');
    assert.equal(fighting.available.length, 0);
    assert.throws(() => settleCaravanCombat(chosen, 'forged', true, now));
    const won = settleCaravanCombat(chosen, fighting.combat!.sessionId, true, now);
    assert.equal(caravanProgress(won).current!.enemiesDefeated, 1);
    assert.deepEqual(settleCaravanCombat(won, fighting.combat!.sessionId, true, now), won);
    const lost = settleCaravanCombat(chosen, fighting.combat!.sessionId, false, now);
    assert.equal(caravanProgress(lost).current!.status, 'failed');
    assert.equal(lost.ryo, c.ryo);
});
test('destination pays cargo-scaled Ryo and reputation once; daily stamp survives failure', () => {
    const c = started(); const p = caravanProgress(c); const run = p.current!;
    run.available = [run.map.at(-1)!.id]; run.cargo = 50;
    c.sunscarCaravan = p;
    const body = { action: 'travel', runId: run.id, version: run.version, requestId: 'final_test_1', nodeId: run.available[0] };
    const settled = advanceCaravan(c, body, now + 1000).character;
    const result = caravanProgress(settled).current!.result!;
    assert.equal(result.ryo, Math.floor(run.baseReward * .5));
    assert.ok(result.reputation > 0);
    assert.equal(settled.ryo, base.ryo + result.ryo);
    assert.deepEqual(advanceCaravan(settled, body, now + 2000).character, settled);
    assert.throws(() => departCaravan(settled, 'escort', { contractId: 'market-goods', tools: ['water', 'repair', 'medicine'] }, now), /daily contract/);
});
