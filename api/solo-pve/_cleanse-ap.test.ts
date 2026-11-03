import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PvpFighter, PvpStatus } from '../pvp/session.js';
import { applySoloPveAction } from './_engine.js';
import { createSoloPveSession, type SoloPveCombatEvent } from './_session.js';

function fighter(name: string, pos: number): PvpFighter {
    return {
        name, pos, hp: 20_000, maxHp: 20_000, chakra: 500, maxChakra: 500,
        stamina: 500, maxStamina: 500, shield: 700, statuses: [],
        character: { level: 100, specialty: 'Ninjutsu', stats: { ninjutsuOffense: 1200 }, jutsu: [] },
    };
}

const LAG: PvpStatus = { name: 'Lag', rounds: 2, kind: 'negative' };
const OVERCLOCK: PvpStatus = { name: 'Overclock', rounds: 2, kind: 'positive' };
const PREVENT: PvpStatus = { name: 'Cleanse Prevent', rounds: 2, kind: 'negative' };
const WOUND: PvpStatus = { name: 'Wound', rounds: 2, amount: 90, kind: 'negative' };
const REFLECT: PvpStatus = { name: 'Reflect', rounds: 2, percent: 20, kind: 'positive' };

function session(statuses: PvpStatus[], ap = 100) {
    const s = createSoloPveSession({ sessionId: 'cleanse-ap', ownerSlug: 'alice', now: 1_800_000_000_000,
        encounter: { kind: 'test', id: 'cleanse-ap' },
        player: fighter('Alice', 26), enemy: fighter('Rival', 27) });
    s.player.statuses = structuredClone(statuses);
    s.ap.player = ap;
    return s;
}

const cases = [
    { label: 'unmodified', statuses: [], cost: 60 },
    { label: 'Lag', statuses: [LAG], cost: 70 },
    { label: 'Overclock', statuses: [OVERCLOCK], cost: 50 },
    { label: 'Lag and Overclock', statuses: [LAG, OVERCLOCK], cost: 60 },
] satisfies Array<{ label: string; statuses: PvpStatus[]; cost: number }>;

function acceptedEvent(result: ReturnType<typeof applySoloPveAction>): SoloPveCombatEvent {
    assert.equal(result.applied, true, result.reason ?? 'Cleanse was rejected');
    assert.equal(result.event?.kind, 'action');
    return result.event as SoloPveCombatEvent;
}

for (const scenario of cases) {
    test(`Solo Cleanse with ${scenario.label} spends its pre-removal cost and removes only negatives`, () => {
        const source = session([...scenario.statuses, WOUND, REFLECT]);
        const before = structuredClone(source);
        const result = applySoloPveAction(source, { type: 'cleanse' });
        const event = acceptedEvent(result);
        assert.equal(event.before.ap.player, 100);
        assert.equal(event.after.ap.player, 100 - scenario.cost);
        assert.deepEqual(event.after.player.statuses, source.player.statuses.filter(status => status.kind === 'positive'));
        assert.equal(event.after.player.shield, 700);
        assert.equal(event.after.player.hp, source.player.hp);
        assert.equal(event.after.player.chakra, source.player.chakra);
        assert.equal(event.after.player.stamina, source.player.stamina);
        assert.equal(event.after.cooldowns.player.cleanse, 10);
        assert.deepEqual(source, before, 'the input snapshot is unchanged');
    });

    test(`Solo blocked Cleanse with ${scenario.label} spends the same cost and preserves all effects`, () => {
        const source = session([...scenario.statuses, WOUND, REFLECT, PREVENT]);
        const result = applySoloPveAction(source, { type: 'cleanse' });
        const event = acceptedEvent(result);
        assert.equal(event.after.ap.player, 100 - scenario.cost);
        assert.deepEqual(event.after.player.statuses, source.player.statuses);
        assert.equal(event.after.cooldowns.player.cleanse, 10);
        assert.ok(event.log.some(line => line.includes('Cleanse Prevent blocks')));
    });

    test(`Solo Cleanse with ${scenario.label} rejects one AP below its required cost`, () => {
        const source = session([...scenario.statuses, WOUND], scenario.cost - 1);
        const before = structuredClone(source);
        const result = applySoloPveAction(source, { type: 'cleanse' });
        assert.equal(result.applied, false);
        assert.equal(result.reason, 'cannot-act');
        assert.deepEqual(result.session, before);
        assert.deepEqual(source, before);
    });

    test(`Solo Cleanse with ${scenario.label} exhausts its exact AP cost and advances the turn`, () => {
        const source = session([...scenario.statuses, WOUND], scenario.cost);
        const result = applySoloPveAction(source, { type: 'cleanse' });
        const event = acceptedEvent(result);
        assert.equal(event.after.ap.player, 0, 'the action snapshot records the full debit before turn refresh');
        assert.equal(event.after.cooldowns.player.cleanse, 10);
        assert.ok(result.session.events.some(next => next.actor === 'enemy' && next.seq > event.seq), 'enemy plays after AP is exhausted');
        assert.equal(result.session.activeSide, 'player');
        assert.ok(result.session.round > source.round);
        assert.equal(result.session.player.statuses.some(status => status.kind === 'negative'), false);
    });
}

test('Solo Cleanse removes a pending Lag without charging a surcharge before activation', () => {
    const result = applySoloPveAction(session([{ ...LAG, activeRound: 2 }]), { type: 'cleanse' });
    const event = acceptedEvent(result);
    assert.equal(event.after.ap.player, 40);
    assert.deepEqual(event.after.player.statuses, []);
});
