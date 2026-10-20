import assert from 'node:assert/strict';
import test from 'node:test';
import { clanBossAssaultResult, clanBossSettlementError } from './clan-boss-assault-result';

const assault = () => ({
    status: 'done',
    runId: 'cboss-golem-live-regression',
    winner: 'enemy',
    round: 21,
    roundCap: 20,
    phaseState: { bossId: 'golem' },
    actors: [
        { id: 'rill', side: 'squad', hp: 6_301, name: 'Rill' },
        { id: 'golem', side: 'enemy', hp: 5_253, name: 'Ancient Stone Golem' },
    ],
});
const presentation = (session: ReturnType<typeof assault>) => clanBossAssaultResult(session, 'clan-boss');

test('a surviving Golem timeout names the assault limit without claiming victory or a Tower floor', () => {
    const session = assault(), before = structuredClone(session);
    const result = presentation(session)!;
    assert.deepEqual(result, {
        chapter: 'Clan Boss', title: 'Assault limit reached', encounter: 'Ancient Stone Golem',
        objective: 'Round limit reached; boss still standing', returnLabel: 'Return to Clan Hall',
        roundsLabel: '20 / 20',
    });
    assert.doesNotMatch(JSON.stringify(result), /9004|Tower|victory|defeated/);
    assert.deepEqual(session, before, 'presentation must leave the authoritative outcome and cap untouched');
});

test('an assault victory remains distinct from defeating the entire shared clan boss pool', () => {
    const session = assault(); session.winner = 'squad'; session.actors[1].hp = 0;
    const result = presentation(session)!;
    assert.equal(result.title, 'Assault victory');
    assert.equal(result.objective, 'Assault objective complete');
    assert.doesNotMatch(result.title, /Clan boss defeated/i);
});

test('only terminal clan results clamp the engine next-round sentinel to the completed round limit', () => {
    const session = assault(), before = structuredClone(session);
    assert.equal(presentation(session)!.roundsLabel, '20 / 20');
    assert.deepEqual(session, before);
    session.round = 10;
    assert.equal(presentation(session)!.roundsLabel, '10 / 20');
    session.status = 'active'; session.round = 21;
    assert.equal(presentation(session)!.roundsLabel, undefined);
    assert.equal(clanBossAssaultResult(session, 'tower'), null);
});

test('a squad wipe is defeat even if it happens on the last round', () => {
    const session = assault(); session.actors[0].hp = 0;
    assert.equal(presentation(session)!.title, 'Assault defeated');
    assert.equal(presentation(session)!.objective, 'Squad defeated');
});

test('an early terminal resolution with a surviving squad does not invent a round-cap outcome', () => {
    const session = assault(); session.round = 8;
    assert.equal(presentation(session)!.title, 'Assault ended');
    delete (session as { roundCap?: number }).roundCap;
    session.round = 99;
    assert.equal(presentation(session)!.title, 'Assault ended');
});

test('the Clan Boss host keeps its explicit mode when reopening a JSON-rehydrated assault', () => {
    const session = assault();
    assert.deepEqual(presentation(JSON.parse(JSON.stringify(session))), presentation(session));
    session.runId = 'legacy-operation';
    assert.equal(clanBossAssaultResult(session), null);
    assert.equal(clanBossAssaultResult(session, 'clan-boss')!.chapter, 'Clan Boss');
});

test('ordinary Towers and other modes keep their existing presentation for either outcome', () => {
    for (const variant of ['tower', 'world-boss', 'hunt', 'team-pvp', 'caravan-ambush']) {
        for (const winner of ['squad', 'enemy', 'draw']) {
            const session = { ...assault(), runId: 'ordinary-tower', floor: 9004, winner };
            assert.equal(clanBossAssaultResult(session, variant), null, 'a floor number alone cannot select Clan Boss labels');
            assert.equal(clanBossAssaultResult({ ...session, runId: 'cboss-recovered-in-tower-host' }, variant), null,
                'a run id alone cannot change a host settlement or return destination');
        }
    }
});

test('a confirmed first settlement and an idempotent replay can both confirm saved contribution', () => {
    assert.equal(clanBossSettlementError({ ok: true, result: { damage: 16_747 }, pool: 5_253 }), null);
    assert.equal(clanBossSettlementError({ ok: true, alreadySettled: true, pool: 5_253 }), null);
});

test('refused or malformed settlement cannot confirm saved contribution', () => {
    for (const response of [null, undefined, {}, { ok: false }, { character: { name: 'Rill' } }]) {
        assert.match(clanBossSettlementError(response)!, /did not confirm/);
    }
    assert.equal(clanBossSettlementError({ error: 'That assault has expired.' }), 'That assault has expired.');
    assert.equal(clanBossSettlementError({ ok: true, error: 'Contribution pending.' }), 'Contribution pending.');
});
