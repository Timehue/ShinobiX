import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySoloPveAction } from '../api/solo-pve/_engine.js';
import { COAST_FORM_TUNING } from '../api/quests/_coast-boss-forms.js';
import { soloPveBossFormMultiplier, soloPveBossTurnStart } from '../api/solo-pve/_boss-forms.js';
import { breakBossHold } from '../api/solo-pve/_boss-hold.js';
import type { SoloPveSession } from '../api/solo-pve/_session.js';
import { auditCoastBoss, coastBossEntries, coastBossSession, type CoastBossEntry } from './coast-boss-balance-audit.js';

const entries = coastBossEntries();
const entry = (id: string): CoastBossEntry => entries.find(row => row.fight.id === id)!;

/** A fight in which the player cannot die, so a mechanic can be watched for as long as it takes. */
function watched(id: string): SoloPveSession {
    const session = coastBossSession(entry(id), 'Ninjutsu', true);
    session.player = { ...session.player, hp: 5_000_000, maxHp: 5_000_000 };
    return session;
}
const wait = (session: SoloPveSession): SoloPveSession => {
    const result = applySoloPveAction(session, { type: 'wait' });
    assert.ok(result.applied, result.reason);
    return result.session;
};
/** Wait through `rounds` full rounds. */
function pass(session: SoloPveSession, rounds: number): SoloPveSession {
    const until = session.round + rounds;
    for (let guard = 0; session.status === 'active' && session.round < until && guard < 200; guard++) session = wait(session);
    return session;
}
const atHealth = (session: SoloPveSession, pct: number): SoloPveSession =>
    ({ ...session, enemy: { ...session.enemy, hp: Math.max(1, Math.floor(session.enemy.maxHp * pct / 100)) } });
/** The boss's own kit can heal it, so what a mechanic did is read from the log, not from a health total. */
const said = (session: SoloPveSession, pattern: RegExp): string[] => session.log.filter(line => pattern.test(line));

test('every coast boss fight seals its Hold and its forms together', () => {
    assert.equal(entries.length, 23, 'twenty bosses and the three harder papers');
    for (const row of entries) {
        const session = coastBossSession(row, 'Taijutsu', false);
        assert.ok(session.bossHold && !session.bossHold.broken, `${row.fight.id}: the Hold stands`);
        assert.equal(session.bossForms?.plan.id, `coast-${row.fight.castId}`, row.fight.id);
        assert.deepEqual(session.bossForms?.triggered, [], `${row.fight.id}: no form before the fight`);
        assert.equal(coastBossSession(row, 'Taijutsu', false, false).bossForms, undefined, 'the audit can still fight the boss as it was');
    }
});

test('a form is entered once when the boss’s health falls to it, with its scene and no heal', () => {
    for (const row of entries) {
        for (const phase of row.fight.forms!.phases) {
            // One point under the threshold: exactly on it is a rounding coin-toss in the shared rule.
            let session = atHealth(watched(row.fight.id), phase.atHpPct - 1);
            session = wait(session);
            const forms = session.bossForms!;
            assert.ok(forms.triggered.includes(phase.id), `${row.fight.id}: ${phase.id} at ${phase.atHpPct}%`);
            assert.equal(forms.last?.healed ?? 0, 0, `${row.fight.id}: no health comes back`);
            assert.ok(session.log.some(line => line.includes(phase.formName)), `${row.fight.id}: the log names ${phase.formName}`);
            const seq = forms.seq;
            session = pass(session, 2);
            assert.equal(session.bossForms!.seq, seq, `${row.fight.id}: it does not happen twice`);
        }
    }
});

test('a stance turns most attacks and opens to its two weaknesses', () => {
    const session = wait(atHealth(watched('rime-warden'), 50));
    const { taken, weak } = COAST_FORM_TUNING.stance;
    assert.equal(soloPveBossFormMultiplier(session, 'player', { element: 'Water', type: 'Ninjutsu' }), taken);
    assert.equal(soloPveBossFormMultiplier(session, 'player', { element: 'Fire', type: 'Ninjutsu' }), weak, 'Fire cracks the plates');
    assert.equal(soloPveBossFormMultiplier(session, 'player', { element: 'Wind', type: 'Taijutsu' }), weak, 'so does Taijutsu');
    assert.equal(soloPveBossFormMultiplier(session, 'player', { element: 'fire', type: 'ninjutsu' }), weak, 'whatever the casing');
    assert.equal(soloPveBossFormMultiplier(session, 'enemy'), 1, 'and the warden hits no harder for it');
    assert.ok(weak > 1 && taken < 1);
});

test('a burn costs the boss its own health every turn and cannot finish it', () => {
    let session = wait(atHealth(watched('chart-runner'), 50));
    const burn = Math.floor(session.enemy.maxHp * COAST_FORM_TUNING.burn.burnPct / 100);
    session = pass(session, 3);
    const costs = said(session, /costs Shiokaze (\d+) HP/).map(line => Number(/costs Shiokaze (\d+) HP/.exec(line)![1]));
    assert.ok(costs.length >= 2, `the pace was paid for ${costs.length} times in three rounds`);
    assert.ok(costs.every(cost => cost === burn), `each turn costs ${COAST_FORM_TUNING.burn.burnPct}% of full health (${burn}), not ${costs.join(', ')}`);
    assert.ok(soloPveBossFormMultiplier(session, 'enemy') > 1, 'and while it burns it hits harder');
    assert.equal(soloPveBossFormMultiplier(session, 'player', { element: 'Water', type: 'Ninjutsu' }), 1, 'but is no tougher');

    // Nearly spent: the burn takes what is left above the last point and no more, and the fight goes on.
    let spent = wait(atHealth(watched('chart-runner'), 50));
    spent = { ...spent, enemy: { ...spent.enemy, hp: 2 } };
    const lines = spent.log.length;
    spent = pass(spent, 1);
    assert.equal(spent.status, 'active', 'the burn never ends the fight on its own');
    assert.ok(spent.enemy.hp >= 1);
    assert.ok(spent.log.slice(lines).every(line => !/costs Shiokaze (\d+) HP/.test(line) || Number(/costs Shiokaze (\d+) HP/.exec(line)![1]) <= burn));
});

test('a charge is gathered, lands if ignored, and breaks into a stagger when answered', () => {
    let session = wait(atHealth(watched('garrison-commander'), 50));
    for (let guard = 0; !session.bossForms!.charge && guard < 12; guard++) session = wait(session);
    const charge = session.bossForms!.charge!;
    assert.ok(charge, 'Nigami begins gathering the tide');
    assert.equal(charge.breakAt, Math.floor(session.enemy.maxHp * COAST_FORM_TUNING.charge.breakPct / 100));
    assert.ok(session.log.some(line => line.includes('begins gathering Breaking Tide')));

    // Ignored: it lands for a share of the player's health.
    const ignored = pass(structuredClone(session), 2);
    assert.ok(ignored.log.some(line => line.includes('releases Breaking Tide')));

    // Answered: enough health taken off before the next turn breaks it and staggers the boss.
    const answered = structuredClone(session);
    answered.enemy = { ...answered.enemy, hp: answered.enemy.hp - charge.breakAt };
    const after = wait(answered);
    assert.equal(after.bossForms!.charge, undefined);
    assert.ok(after.log.some(line => line.includes('Breaking Tide is broken')));
    assert.equal(after.log.some(line => line.includes('releases Breaking Tide')), false, 'a broken charge never lands');
});

test('a Hold boss never gathers a charge it cannot be made to pay for', () => {
    // The rule is checked at the turn start itself, with the boss's health set by hand, because its own kit can heal it between turns.
    const formed = wait(atHealth(watched('garrison-commander'), 50));
    assert.ok(formed.bossForms!.triggered.includes('tide-call'));
    const turnAt = (hp: number, holdBroken = false) => {
        const session = structuredClone(formed);
        session.enemy = { ...session.enemy, hp };
        if (holdBroken) session.bossHold = { ...session.bossHold!, broken: true };
        delete session.bossForms!.charge;
        delete session.bossForms!.lastChargeRound;
        session.round += 5;
        soloPveBossTurnStart(session);
        return session;
    };
    // On its last point of health, held up only by the Hold: nothing is left to break against, so nothing is gathered.
    const last = turnAt(1);
    assert.equal(last.bossForms!.charge, undefined);
    assert.equal(last.log.length, formed.log.length, 'and nothing is announced');
    // With a little health left, the break point is what it can still lose.
    const low = turnAt(40);
    assert.deepEqual([low.bossForms!.charge?.hpAtArm, low.bossForms!.charge?.breakAt], [40, 39]);
    assert.ok(low.log.at(-1)!.includes('Deal 39 damage'));
    // At full strength the rule changes nothing.
    const healthy = turnAt(formed.enemy.maxHp);
    assert.equal(healthy.bossForms!.charge?.breakAt, Math.floor(formed.enemy.maxHp * COAST_FORM_TUNING.charge.breakPct / 100));
    // Once the Hold is broken the rule is gone: the next blow simply ends the fight.
    assert.equal(turnAt(40, true).bossForms!.charge?.breakAt, Math.floor(formed.enemy.maxHp * COAST_FORM_TUNING.charge.breakPct / 100));
});

test('a killing blow before a form shows the form, and the Hold still decides when the boss falls', () => {
    let session = watched('gate-captain');
    session = wait({ ...session, enemy: { ...session.enemy, hp: 0 } });
    // The blow is turned at the last point of health. The captain's own kit can heal him on the turn that follows
    // (it does at the levels the coast now opens at), so what is held is the fight, not a health total of 1.
    assert.equal(session.status, 'active');
    assert.ok(session.enemy.hp >= 1);
    assert.deepEqual(session.bossForms!.triggered, ['closed-gate']);
    assert.ok(session.bossHold && !session.bossHold.broken);

    // Still held: another killing blow changes nothing while the Hold stands.
    session = wait({ ...session, enemy: { ...session.enemy, hp: 0 } });
    assert.deepEqual([session.status, session.enemy.hp >= 1], ['active', true]);
    assert.ok(session.log.some(line => line.includes('will not fall while the Oath Guard stands')));

    // The tool breaks the Hold, and with no form left pending the next killing blow ends the fight.
    assert.equal(breakBossHold(session, 'player', session.bossHold!.breakerItemId), true);
    session = wait({ ...session, enemy: { ...session.enemy, hp: 0 } });
    assert.deepEqual([session.status, session.winner, session.outcome], ['done', 'player', 'win']);
});

test('with the Hold already broken, a killing blow before the form still shows it, and the next one wins', () => {
    let session = watched('gate-captain');
    assert.equal(breakBossHold(session, 'player', session.bossHold!.breakerItemId), true);
    session = wait({ ...session, enemy: { ...session.enemy, hp: 0 } });
    assert.deepEqual([session.status, session.enemy.hp >= 1], ['active', true], 'the pending form holds it once');
    assert.deepEqual(session.bossForms!.triggered, ['closed-gate']);
    session = wait({ ...session, enemy: { ...session.enemy, hp: 0 } });
    assert.deepEqual([session.status, session.winner], ['done', 'player']);
});

test('a form is a trade: from where it begins, the reference builds end near where they ended without it', () => {
    // The reference builds lose to these bosses with or without forms, and the owner's ruling is to leave them
    // hard. Whole fights mostly end before the boss is low enough to change, so they cannot show what a form
    // does. Each fight here starts one point above the boss's first form and is played both ways.
    //
    // Held: every build sees the form, so the comparison is never empty; no boss ends more than 10 points of
    // its health easier or harder on average; and the forms do not turn a set of losses into a set of wins.
    // The band is wide because the simulator is: one boss moved 13 points on a 5% change to one number.
    const moved: Array<{ id: string; change: number }> = [];
    for (const row of entries) {
        const start = row.fight.forms!.phases[0].atHpPct + 1;
        const plain = auditCoastBoss(row, false, start), formed = auditCoastBoss(row, true, start);
        const change = Math.round((formed.bossLeftPct - plain.bossLeftPct) * 10) / 10;
        moved.push({ id: row.fight.id, change });
        assert.equal(formed.sawForm, 8, `${row.fight.id}: only ${formed.sawForm} of 8 builds saw the form`);
        assert.equal(plain.sawForm, 0, `${row.fight.id}: the plain arm has no forms`);
        assert.ok(Math.abs(change) <= 10, `${row.fight.id}: ${formed.bossLeftPct}% of the boss left with its form, ${plain.bossLeftPct}% without`);
        assert.ok(formed.wins - plain.wins <= 3, `${row.fight.id}: ${plain.wins} wins without the form, ${formed.wins} with it`);
        assert.ok(formed.maxRounds < 25, `${row.fight.id}: a fight ran ${formed.maxRounds} rounds`);
    }
    // And over all of them together, forms are close to neutral, leaning neither way.
    const mean = moved.reduce((sum, row) => sum + row.change, 0) / moved.length;
    assert.ok(Math.abs(mean) <= 3, `across every boss the forms move the result ${mean.toFixed(1)} points: ${moved.map(row => `${row.id} ${row.change}`).join(', ')}`);
});
