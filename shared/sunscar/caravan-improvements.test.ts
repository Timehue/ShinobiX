import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceCaravan, caravanBaseReward, caravanProgress, departCaravan, finishCaravan } from '../../api/festival/_caravan.js';
import { createOwnedPet } from '../../api/pet/_owned-pet.js';
import { petRoleOf as clientPetRole } from '../../shinobij.client/src/lib/pet-roles.js';
import { CARAVAN_CONTRACTS } from './caravan-contracts.js';
import { CARAVAN_EVENTS, caravanEvent } from './caravan-events.js';
import { generateCaravanMap } from './caravan-map.js';
import { caravanChoiceBlock, caravanFieldCharacter, caravanObjectiveProgress, caravanRewardPreview, caravanVitalCost, resolveCaravanChoice, revealCaravan, selectCaravanNode } from './caravan-state.js';
import type { CaravanWeather } from './caravan-types.js';

const now = Date.UTC(2026, 8, 19, 12);
const base = { name: 'field-escort', level: 30, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, ryo: 10000, pets: [] };
function encounter(id: string, overrides: Record<string, unknown> = {}) {
    const character = departCaravan({ ...structuredClone(base), ...overrides }, base.name, { contractId: 'market-goods', tools: ['water', 'repair', 'feed'] }, now);
    const progress = caravanProgress(character), run = progress.current!;
    const event = caravanEvent(id);
    run.currentNodeId = run.map[0].id;
    Object.assign(run.map[0], { eventId: id, kind: event.kind });
    run.visited = [run.currentNodeId]; run.status = 'encounter'; run.available = [];
    revealCaravan(run);
    character.sunscarCaravan = progress;
    return { character, progress, run };
}
function choose(character: Record<string, unknown>, id: string, requestId = 'improvements-test-1') {
    const run = caravanProgress(character).current!;
    return advanceCaravan(character, { action: 'choose', runId: run.id, version: run.version, requestId, choiceId: id }, now + 1000);
}

test('every fixed stamina/chakra charge is enforced by UI eligibility and authoritative choice resolution', () => {
    for (const event of CARAVAN_EVENTS) for (const choice of event.choices) {
        for (const field of ['stamina', 'chakra'] as const) {
            const percent = choice.effect[`${field}Percent`];
            if (!percent || percent >= 0) continue;
            for (const maximum of [1, 17, 100, 235]) {
                const maxField = field === 'stamina' ? 'maxStamina' : 'maxChakra';
                const cost = caravanVitalCost(maximum, percent);
                const { character, run } = encounter(event.id, { [maxField]: maximum, [field]: cost - 1 });
                assert.match(caravanChoiceBlock(run, choice, character, now)!, new RegExp(`Requires ${cost} ${field}`));
                const original = structuredClone(character);
                assert.throws(() => choose(character, choice.id), new RegExp(`Requires ${cost} ${field}`));
                assert.deepEqual(character, original, 'Rejected choices consume no resources or version');
                character[field] = cost;
                assert.equal(caravanChoiceBlock(run, choice, character, now), null);
                const next = choose(character, choice.id).character;
                assert.equal(next[field], 0, `${event.id}/${choice.id} charges the previewed amount exactly`);
            }
        }
    }
});

test('exhausted escorts retain an affordable alternative at every stamina/chakra encounter', () => {
    for (const event of CARAVAN_EVENTS.filter(e => e.choices.some(c => (c.effect.staminaPercent ?? 0) < 0 || (c.effect.chakraPercent ?? 0) < 0))) {
        const { run, character } = encounter(event.id, { stamina: 0, chakra: 0, ryo: 0 });
        run.supplies = 0;
        for (const tool of Object.keys(run.tools) as (keyof typeof run.tools)[]) run.tools[tool] = 0;
        assert.ok(event.choices.some(choice => !caravanChoiceBlock(run, choice, character, now)), event.id);
    }
});

test('clone and seal techniques consume real chakra once and keep their costs spent after a retry', () => {
    const { character } = encounter('shifting-marker');
    const result = choose(character, 'clone');
    const run = caravanProgress(result.character).current!;
    assert.equal(result.character.chakra, 92);
    assert.ok(run.flags.includes('utility-used-clone'));
    assert.ok(run.flags.includes('tripwire-warning'));
    assert.ok(run.log.at(-1)!.changes!.scouted! > 0);
    assert.equal(run.log.at(-1)!.changes!.chakra, -8);
    const originalRun = caravanProgress(character).current!;
    const retry = advanceCaravan(result.character, { action: 'choose', runId: originalRun.id, version: originalRun.version, requestId: 'improvements-test-1', choiceId: 'clone' }, now + 5000);
    assert.equal(retry.replay, true);
    assert.equal(retry.character.chakra, 92);
    run.status = 'encounter'; run.map[0].eventId = 'camp-high-ground';
    assert.match(caravanChoiceBlock(run, caravanEvent('camp-high-ground').choices.find(c => c.id === 'clone')!, result.character, now)!, /already been used/);
    const sealed = encounter('sand-wall'); sealed.run.cargo = 96;
    const next = choose(sealed.character, 'chakra-seal').character;
    assert.equal(next.chakra, 88);
    const log = caravanProgress(next).current!.log.at(-1)!;
    assert.equal(log.changes!.cargo, 4, 'Feedback reports capped gain, not the offered ten');
    assert.equal(log.changes!.chakra, -12);
});

test('Tracker reconnaissance requires the selected owned role, availability, and feed', () => {
    const tracker = { id: 'tracker-1', role: 'tracker', level: 10 };
    const { run, character } = encounter('raider-toll', { pets: [tracker] });
    const choice = caravanEvent('raider-toll').choices.find(c => c.id === 'tracker')!;
    assert.match(caravanChoiceBlock(run, choice, character, now)!, /Tracker companion/);
    run.selectedPetId = tracker.id;
    assert.equal(caravanChoiceBlock(run, choice, character, now), null);
    for (const pet of [{ ...tracker, role: 'sage' }, { ...tracker, training: {} }, { ...tracker, expedition: {} }]) {
        assert.ok(caravanChoiceBlock(run, choice, { ...character, pets: [pet] }, now));
    }
    assert.match(caravanChoiceBlock(run, choice, { ...character, petBreeding: { state: 'breeding', readyAt: now + 1000, parentIds: [tracker.id] } }, now)!, /busy/);
    run.tools.feed = 0;
    assert.match(caravanChoiceBlock(run, choice, character, now)!, /pet feed/);
    run.tools.feed = 1;
    const next = choose(character, 'tracker').character;
    const updated = caravanProgress(next).current!;
    assert.equal(updated.status, 'travel'); assert.equal(updated.combat, null);
    assert.equal(updated.tools.feed, 0);
    assert.ok(updated.flags.includes('utility-used-tracker'));
    assert.equal(updated.log.at(-1)!.changes!.tools!.feed, -1);
    assert.equal(updated.cargo, 100);
});

test('help and discovery missions offer a connected objective path in every weather', () => {
    const weather: CaravanWeather[] = ['clear', 'sandstorm', 'heat', 'bandits', 'festival', 'night'];
    for (const contract of CARAVAN_CONTRACTS.filter(c => ['help', 'discovery'].includes(c.objective.kind))) {
        for (let seed = 0; seed < 120; seed++) for (const sky of weather) {
            const map = generateCaravanMap(seed, contract, sky);
            const opportunities = map.filter(n => n.objectiveOpportunity);
            assert.equal(opportunities.length, contract.objective.target);
            const ids = new Set<string>();
            for (const node of opportunities) {
                assert.equal(map.filter(n => n.eventId === node.eventId).length, 1, 'Reserved encounters are unique');
                const choice = caravanEvent(node.eventId).choices.find(c => contract.objective.kind === 'help' ? c.effect.addFlags?.includes('helped-traveler') : c.effect.discovery);
                assert.ok(choice, `${contract.id}/${node.eventId}`);
                assert.ok(!choice.requiresFlag && !choice.effect.combat && !choice.utility);
                if (choice.effect.discovery) { assert.ok(!ids.has(choice.effect.discovery)); ids.add(choice.effect.discovery); }
                for (const previous of map.filter(n => n.layer === node.layer - 1)) assert.ok(previous.next.includes(node.id));
            }
            const memo = new Map<string, number>();
            function best(id: string): number {
                if (memo.has(id)) return memo.get(id)!;
                const node = map.find(n => n.id === id)!;
                const value = Number(!!node.objectiveOpportunity) + Math.max(0, ...node.next.map(best));
                memo.set(id, value); return value;
            }
            assert.equal(Math.max(...map.filter(n => n.layer === 0).map(n => best(n.id))), contract.objective.target);
            if (contract.guaranteedBoss) assert.ok(map.filter(n => n.layer === contract.nodes - 2).every(n => n.kind === 'boss'));
        }
    }
});

test('starter and legacy Tracker instances use the existing role rules on both client and server', () => {
    for (const template of ['starter-wind', 'standard-1', 'legendary-9']) {
        const pet = createOwnedPet(template, { origin: 'wild' });
        delete pet.role;
        const { character, run } = encounter('raider-toll', { pets: [pet] });
        run.selectedPetId = String(pet.id);
        const choice = caravanEvent('raider-toll').choices.find(c => c.id === 'tracker')!;
        assert.equal(caravanChoiceBlock(run, choice, caravanFieldCharacter(character, clientPetRole), now), null, template);
        const next = choose(character, 'tracker').character;
        assert.equal(caravanProgress(next).current!.status, 'travel');
        assert.equal(caravanProgress(next).current!.tools.feed, 0);
    }
});

test('story follow-ups cannot replace a reserved objective opportunity', () => {
    const { run } = encounter('broken-axle');
    run.contract = CARAVAN_CONTRACTS.find(c => c.id === 'medical-relief')!;
    run.map = generateCaravanMap(42, run.contract, 'clear');
    const target = run.map.find(n => n.objectiveOpportunity)!;
    run.status = 'travel'; run.available = [target.id]; run.flags = ['helped-driver'];
    const next = selectCaravanNode(run, target.id);
    assert.equal(next.map.find(n => n.id === target.id)!.eventId, target.eventId);
});

test('reachable reserved encounters can actually fulfill help and discovery objectives', () => {
    for (const contract of CARAVAN_CONTRACTS.filter(c => ['help', 'discovery'].includes(c.objective.kind))) {
        let { run } = encounter('broken-axle');
        run = { ...run, contract, map: generateCaravanMap(7, contract, 'clear'), currentNodeId: null, visited: [], status: 'travel' };
        for (const node of run.map.filter(n => n.objectiveOpportunity)) {
            run.available = [node.id]; run = selectCaravanNode(run, node.id);
            const choice = caravanEvent(node.eventId).choices.find(c => contract.objective.kind === 'help' ? c.effect.addFlags?.includes('helped-traveler') : c.effect.discovery)!;
            run = resolveCaravanChoice(run, choice.id, base, now).run;
        }
        assert.equal(caravanObjectiveProgress(run).complete, true, contract.id);
    }
});

test('delivery forecasts and objective bonus match authoritative settlement across cargo and side bonuses', () => {
    for (const contract of CARAVAN_CONTRACTS) for (const cargo of [1, 49, 85, 100]) for (const bonus of [-30, 0, 8, 30]) {
        const { character, progress, run } = encounter('broken-axle');
        Object.assign(run, { contract, cargo, bonus, baseReward: caravanBaseReward(character, contract), travelersHelped: 2, enemiesDefeated: 3, discoveries: ['one', 'two', 'three'] });
        const preview = caravanRewardPreview(run);
        const paid = finishCaravan(character, progress, 'Delivered', true, now);
        assert.equal(caravanProgress(paid).current!.result!.ryo, preview.ryo);
        assert.equal(caravanProgress(paid).current!.result!.reputation, preview.reputation);
        assert.equal(preview.ryo, preview.withoutObjective + (preview.objectiveComplete ? preview.objectiveBonus : 0));
    }
});

test('saved feedback records actual supply, healing, money, and travel changes and survives reload', () => {
    const full = encounter('sheltered-well'); full.run.supplies = 29;
    let next = choose(full.character, 'fill').character;
    assert.equal(caravanProgress(next).current!.log.at(-1)!.changes!.supplies, 1);
    const rest = encounter('camp-coals', { hp: 97, stamina: 98, chakra: 99 });
    next = choose(rest.character, 'rest').character;
    assert.deepEqual(caravanProgress(next).current!.log.at(-1)!.changes, { supplies: -2, morale: 6, hp: 3, chakra: 1, stamina: 2 });
    const merchant = encounter('spice-merchant');
    next = choose(merchant.character, 'buy').character;
    assert.equal(caravanProgress(next).current!.log.at(-1)!.changes!.ryo, -Math.ceil(merchant.run.baseReward * .04));
    const run = caravanProgress(next).current!;
    const traveled = advanceCaravan(next, { action: 'travel', runId: run.id, version: run.version, requestId: 'feedback-travel-1', nodeId: run.available[0] }, now + 2000).character;
    const report = caravanProgress(traveled).current!.log.at(-1)!;
    assert.equal(report.title, 'Convoy advanced'); assert.equal(report.changes!.supplies, -1);
    assert.deepEqual(caravanProgress(JSON.parse(JSON.stringify(traveled))).current!.log.at(-1), report);
});
