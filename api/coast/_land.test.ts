import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'coast-land-test-secret';

import { clanRecordKey } from '../_utils.js';
import { NPC_BLOCKED_ROUTES } from '../_npc-guard.js';
import { buildWorldAiFightSpec, cleanWorldAiFightRequest } from '../missions/_world-ai-fight.js';
import type { PvpSession } from '../pvp/session.js';
import { settleCoastContestDuel } from './_land-duel.js';
import { releaseCoastRecordsOfPlayer } from './_player-erasure.js';
import {
    COAST_LAND, collectCoastClaimSupply, grantCoastClaim, releaseCoastClaim, coastClaimKey, coastContestKey, coastContestPhase, coastContestResultKey, coastGarrisonFightStart, coastGarrisonGuard, coastLandViews,
    declareCoastContest, isContestableCoastSector, readCoastClaim, readCoastContest, recordCoastContestDuel, recordCoastGarrisonWin,
    releaseCoastHoldingsForClan, settleCoastContest, settleDueCoastLand, withdrawCoastContest,
    type CoastContest, type CoastContestResult,
} from './_land.js';

/*
 * Land on the Unmapped Coast: a clan taking a sector from the Unmoored.
 * Wrack Strand (102) and Splitstone Seam (103) are contestable; the slip (101)
 * and the garrison (107) are not.
 */

const HOUR = 60 * 60_000;
const T0 = 1_800_000_000_000;
const STRAND = 102, SEAM = 103;
const CREW = ['founder', 'second', 'third', 'fourth', 'fifth'];
const RIVALS = ['rival', 'r2', 'r3', 'r4', 'r5'];

let kv: typeof import('../_storage.js').kv;
before(async () => { ({ kv } = await import('../_storage.js')); });
beforeEach(async () => {
    for (const pattern of ['coast:*', 'save:*', 'lock:*', 'audit:*', 'ratelimit:*', 'player-fp:*', 'player-ip:*', 'game:announcements*', 'announce*']) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
});

/** A saved player. `right` is the unlock The Crossing War gives. */
async function player(name: string, clan: string | null, options: { level?: number; right?: boolean; sector?: number } = {}) {
    const right = options.right ?? true;
    await kv.set(`save:${name}`, {
        _saveVersion: 1, currentSector: options.sector ?? STRAND,
        character: { name, level: options.level ?? 80, clan, village: 'Stormveil Village', inventory: [], itemStacks: [] },
        questLines: { v: 1, active: {}, done: right ? { 'crossing-war-1': { at: 1, marks: 2, unlocks: [COAST_LAND.unlock] } } : {} },
    });
}

/** A clan whose founder is the first name. Members joined long ago unless told otherwise. */
async function clan(name: string, members: string[], options: { createdAt?: number; joinedAt?: Record<string, number>; officers?: string[]; scrolls?: number } = {}) {
    await kv.set(clanRecordKey(name), {
        // Declaring costs 75 Territory Control Scrolls from the treasury; a clan here can afford several.
        treasury: { items: [{ itemId: 'territory-control-scroll', count: options.scrolls ?? 300 }, { itemId: 'gather-binding-fiber', count: 4 }] },
        name, founderName: members[0], createdAt: options.createdAt ?? 1_000,
        members: members.map(member => ({ name: member, joinedAt: options.joinedAt?.[member] ?? 1_000 })),
        roleOverrides: Object.fromEntries((options.officers ?? []).map(officer => [officer, 'Officer'])),
    });
    for (const member of members) await player(member, name);
}

const declare = (who: string, sector = STRAND, now = T0) => declareCoastContest({ playerName: who, sector, now });
async function declared(clanName = 'Tidewatch', crew = CREW, sector = STRAND): Promise<CoastContest> {
    await clan(clanName, crew);
    const result = await declare(crew[0], sector);
    assert.equal(result.ok, true, JSON.stringify(result));
    return (result as { contest: CoastContest }).contest;
}
const win = (who: string, contest: CoastContest, proof: string, now = contest.opensAt + HOUR) =>
    recordCoastGarrisonWin({ playerName: who, sector: contest.sector, contestId: contest.id, proofId: proof, now });

describe('which ground can be held', () => {
    it('is the coast\'s contestable sectors and nothing else', async () => {
        assert.equal(isContestableCoastSector(STRAND), true);
        for (const sector of [101, 107, 74, 0, 151]) assert.equal(isContestableCoastSector(sector), false, String(sector));
        const views = await coastLandViews(T0);
        assert.ok(views.length >= 5 && views.every(view => view.holder === null && view.contest === null), 'the Unmoored hold all of it until a clan takes it');
        assert.ok(views.some(view => view.sector === STRAND && view.name === 'Wrack Strand'));
        await clan('Tidewatch', CREW);
        assert.deepEqual(await declare('founder', 107), { ok: false, status: 400, error: 'That ground cannot be held.' });
    });
});

describe('declaring', () => {
    it('is for a clan\'s founder, leaders and officers who have earned the right', async () => {
        await player('loner', null);
        assert.match(String((await declare('loner') as { error: string }).error), /Only a clan can hold land/);

        await clan('Tidewatch', CREW, { officers: ['second'] });
        assert.match(String((await declare('third') as { error: string }).error), /founder, leaders and officers/);
        assert.equal((await declare('second')).ok, true, 'an officer may declare');
    });

    it('needs five members who each earned the right, and counts only those', async () => {
        await clan('Tidewatch', CREW, { joinedAt: { fifth: T0 - HOUR } });
        const short = await declare('founder');
        assert.deepEqual([short.ok, (short as { error: string }).error], [false, 'Your clan needs 5 members who have earned the right to contest land. It has 4.'], 'a member who joined an hour ago does not count');

        await clan('Tidewatch', CREW);
        await player('fifth', 'Tidewatch', { right: false });
        assert.match(String((await declare('founder') as { error: string }).error), /It has 4\./, 'nor one who has not finished The Crossing War');
        await player('fifth', 'Tidewatch', { level: 74 });
        assert.match(String((await declare('founder') as { error: string }).error), /It has 4\./, 'nor one under level 75');
        await player('fifth', 'Otherclan');
        assert.match(String((await declare('founder') as { error: string }).error), /It has 4\./, 'nor one whose own save says they have left');

        await player('fifth', 'Tidewatch');
        await player('founder', 'Tidewatch', { right: false });
        assert.match(String((await declare('founder') as { error: string }).error), /You have not earned the right/);
    });

    it('posts a contest with a day\'s notice, a two-day window and a frozen roster', async () => {
        const contest = await declared();
        assert.deepEqual([contest.opensAt - T0, contest.closesAt - contest.opensAt], [24 * HOUR, 48 * HOUR]);
        assert.deepEqual([contest.target, contest.perPlayerCap, contest.score], [15, 5, 0]);
        assert.deepEqual(contest.roster, [...CREW].sort());
        assert.deepEqual([coastContestPhase(contest, T0), coastContestPhase(contest, contest.opensAt), coastContestPhase(contest, contest.closesAt)], ['posted', 'open', 'closed']);
        const view = (await coastLandViews(T0)).find(entry => entry.sector === STRAND)!;
        assert.deepEqual([view.contest?.clan, view.contest?.phase, view.contest?.roster], ['Tidewatch', 'posted', 5]);
    });

    it('allows one contest on a sector and one contest per clan', async () => {
        await declared();
        await clan('Saltborn', ['rival', 'r2', 'r3', 'r4', 'r5']);
        assert.match(String((await declare('rival') as { error: string }).error), /Tidewatch has already declared here/);
        assert.match(String((await declare('founder', SEAM) as { error: string }).error), /already has a contest posted/);
        assert.equal((await declare('rival', SEAM)).ok, true, 'another sector is free for another clan');
    });

    it('can be withdrawn by its officers before the fighting opens, and leaves no cooldown', async () => {
        const contest = await declared();
        assert.equal((await withdrawCoastContest({ playerName: 'third', sector: STRAND, now: T0 }) as { status: number }).status, 403);
        assert.equal((await withdrawCoastContest({ playerName: 'founder', sector: STRAND, now: contest.opensAt }) as { status: number }).status, 409, 'not once it has opened');
        assert.deepEqual(await withdrawCoastContest({ playerName: 'founder', sector: STRAND, now: T0 + HOUR }), { ok: true });
        assert.equal(await readCoastContest(STRAND), null);
        assert.equal((await kv.get<CoastContestResult>(coastContestResultKey(STRAND)))?.outcome, 'withdrawn');
        assert.equal((await declare('founder', STRAND, T0 + 2 * HOUR)).ok, true);
    });
});

describe('fighting the garrison', () => {
    it('is open to the roster only, inside the window, up to each member\'s cap', async () => {
        const contest = await declared();
        const save = (name: string) => kv.get<Record<string, unknown>>(`save:${name}`) as Promise<Record<string, unknown>>;
        await assert.rejects(coastGarrisonFightStart('founder', await save('founder'), STRAND, contest.id, T0), /has not opened yet/);
        const open = contest.opensAt + HOUR;
        assert.equal((await coastGarrisonFightStart('founder', await save('founder'), STRAND, contest.id, open)).id, contest.id);
        await assert.rejects(coastGarrisonFightStart('founder', await save('founder'), STRAND, 'another-contest', open), /No contest is being fought here/);
        await assert.rejects(coastGarrisonFightStart('founder', await save('founder'), STRAND, contest.id, contest.closesAt), /is over/);

        // Joined after the declaration: in the clan, with the right, but not on the roster.
        await player('latecomer', 'Tidewatch');
        await assert.rejects(coastGarrisonFightStart('latecomer', await save('latecomer'), STRAND, contest.id, open), /not on this contest's roster/);
        // Left the clan since: the roster named them, their own save no longer does.
        await player('fifth', null);
        await assert.rejects(coastGarrisonFightStart('fifth', await save('fifth'), STRAND, contest.id, open), /not on this contest's roster/);

        for (let i = 0; i < 5; i++) assert.equal((await win('second', contest, `second-${i}`)).counted, true);
        await assert.rejects(coastGarrisonFightStart('second', await save('second'), STRAND, contest.id, open), /You have done your part here: 5 wins/);
    });

    it('scores one point per settled fight, once, and never past a member\'s cap', async () => {
        const contest = await declared();
        assert.deepEqual(await win('founder', contest, 'token-a', T0), { counted: false, reason: 'not-open' });
        assert.deepEqual(await win('founder', contest, 'token-a'), { counted: true, score: 1, target: 15 });
        assert.deepEqual(await win('founder', contest, 'token-a'), { counted: false, reason: 'replayed', score: 1, target: 15 }, 'a settlement that is retried scores nothing more');
        assert.equal((await win('stranger', contest, 'token-b')).reason, 'not-on-roster');
        assert.equal((await recordCoastGarrisonWin({ playerName: 'founder', sector: STRAND, contestId: 'stale', proofId: 'token-c', now: contest.opensAt + HOUR })).reason, 'no-contest');
        for (let i = 0; i < 4; i++) await win('founder', contest, `founder-${i}`);
        assert.equal((await win('founder', contest, 'founder-over')).reason, 'capped');
        const stored = (await readCoastContest(STRAND))!;
        assert.deepEqual([stored.score, stored.wins.founder, stored.proofs.length], [5, 5, 5]);
    });

    it('takes the sector the moment the target is met', async () => {
        const contest = await declared();
        let last = { counted: false } as Awaited<ReturnType<typeof win>>;
        for (const member of CREW.slice(0, 3)) for (let i = 0; i < 5; i++) last = await win(member, contest, `${member}-${i}`);
        assert.deepEqual([last.counted, last.score, last.taken], [true, 15, true]);

        const claim = (await readCoastClaim(STRAND))!;
        assert.deepEqual([claim.clan, claim.landingEpoch, claim.contestId, claim.immuneUntil - claim.since], ['Tidewatch', 1, contest.id, 72 * HOUR]);
        assert.equal(await readCoastContest(STRAND), null);
        assert.equal((await kv.get<CoastContestResult>(coastContestResultKey(STRAND)))?.outcome, 'won');
        assert.equal((await win('fifth', contest, 'fifth-late')).reason, 'no-contest', 'a fight that ends after the sector fell scores nothing');

        const view = (await coastLandViews(T0)).find(entry => entry.sector === STRAND)!;
        assert.deepEqual([view.holder?.clan, view.contest], ['Tidewatch', null]);
        // One sector is all a clan may hold, and newly taken ground is protected for three days.
        assert.match(String((await declare('founder', SEAM, T0 + 100 * HOUR) as { error: string }).error), /already holds a sector/);
        assert.match(String((await declare('founder', STRAND, T0 + 100 * HOUR) as { error: string }).error), /already holds that ground/);
        await clan('Saltborn', RIVALS);
        assert.match(String((await declare('rival', STRAND, claim.since + 71 * HOUR) as { error: string }).error), /Tidewatch holds that ground, and it is protected for now/);
    });
});

describe('taking a sector from another clan', () => {
    /** Tidewatch holds Wrack Strand; Saltborn declares on it once its protection has run out. */
    async function contested(): Promise<{ contest: CoastContest; open: number }> {
        const first = await declared();
        for (const member of CREW.slice(0, 3)) for (let i = 0; i < 5; i++) await win(member, first, `${member}-${i}`);
        const claim = (await readCoastClaim(STRAND))!;
        await clan('Saltborn', RIVALS);
        const result = await declare('rival', STRAND, claim.immuneUntil + HOUR);
        assert.equal(result.ok, true, JSON.stringify(result));
        const contest = (result as { contest: CoastContest }).contest;
        return { contest, open: contest.opensAt + HOUR };
    }
    const duel = (winner: string, loser: string, battleId: string, now: number) => recordCoastContestDuel({ sector: STRAND, winner, loser, battleId, now });
    /** Twenty garrison wins for the attackers, five past the target: four members at their cap. */
    async function attackersMeetTarget(contest: CoastContest) {
        for (const member of RIVALS.slice(0, 4)) for (let i = 0; i < 5; i++) await win(member, contest, `${contest.id}-${member}-${i}`);
    }

    it('freezes both rosters, and shows the holder defending', async () => {
        const { contest } = await contested();
        assert.deepEqual([contest.defender?.clan, contest.defender?.roster, contest.defense, contest.roster], ['Tidewatch', [...CREW].sort(), 0, [...RIVALS].sort()]);
        const view = (await coastLandViews(contest.opensAt)).find(entry => entry.sector === STRAND)!;
        assert.deepEqual([view.holder?.clan, view.contest?.clan, view.contest?.defender], ['Tidewatch', 'Saltborn', { clan: 'Tidewatch', score: 0, roster: 5 }]);
    });

    it('scores a duel for the winner\'s side, between opposite rosters, once per pair per day', async () => {
        const { contest, open } = await contested();
        assert.equal((await duel('rival', 'founder', 'battle-0', contest.declaredAt)).reason, 'not-open');
        assert.deepEqual(await duel('rival', 'founder', 'battle-1', open), { counted: true, side: 'attack', score: 1, target: 15, defense: 0 });
        assert.equal((await duel('rival', 'founder', 'battle-1', open)).reason, 'replayed', 'a settlement that is retried scores once');
        assert.equal((await duel('rival', 'founder', 'battle-2', open)).reason, 'pair-used');
        assert.equal((await duel('founder', 'rival', 'battle-3', open)).reason, 'pair-used', 'the pair is spent for the day whoever wins next');
        assert.deepEqual([(await duel('second', 'rival', 'battle-4', open)).side, (await duel('second', 'rival', 'battle-4b', open)).reason], ['defense', 'pair-used']);
        assert.equal((await duel('rival', 'founder', 'battle-5', open + 24 * HOUR)).counted, true, 'a new day, the pair may score again');

        // Not a contest duel: two of the same side, an outsider, or a member who joined after the declaration.
        await player('outsider', null);
        await player('latecomer', 'Saltborn');
        for (const [winner, loser] of [['rival', 'r2'], ['founder', 'second'], ['outsider', 'founder'], ['latecomer', 'founder']]) {
            assert.equal((await duel(winner, loser, `battle-x-${winner}`, open)).reason, 'not-on-roster', `${winner} over ${loser}`);
        }
        const stored = (await readCoastContest(STRAND))!;
        assert.deepEqual([stored.score, stored.defense], [2, 1]);
    });

    it('runs its full two days: meeting the target does not take a defended sector early', async () => {
        const { contest } = await contested();
        await attackersMeetTarget(contest);
        assert.equal((await readCoastContest(STRAND))?.score, 20);
        assert.equal((await readCoastClaim(STRAND))?.clan, 'Tidewatch', 'the holder still has until the close to answer');
        assert.equal(await settleCoastContest(STRAND, contest.closesAt - 1), null);
    });

    it('takes no point from either side once a defended contest has closed, even before it is settled', async () => {
        const { contest, open } = await contested();
        // Fourteen for the attackers, one short. The row is still there after the close, until the settle tick.
        for (const member of RIVALS.slice(0, 2)) for (let i = 0; i < 5; i++) await win(member, contest, `${contest.id}-${member}-${i}`);
        for (let i = 0; i < 4; i++) await win('r3', contest, `${contest.id}-r3-${i}`);
        assert.equal((await readCoastContest(STRAND))?.score, 14);
        assert.deepEqual(await win('r3', contest, `${contest.id}-r3-late`, contest.closesAt), { counted: false, reason: 'closed', score: 14, target: 15 });
        assert.equal((await duel('rival', 'founder', 'late-attack', contest.closesAt)).reason, 'closed');
        assert.equal((await duel('founder', 'rival', 'late-defence', contest.closesAt + HOUR)).reason, 'closed');
        assert.equal((await settleCoastContest(STRAND, contest.closesAt))?.outcome, 'lost', 'one short stays one short');

        // A duel is judged by when it ended, not by when its settlement was read.
        const session = (endedAt: number) => ({
            battleId: `ended-${endedAt}`, rewardAuthority: 'world', progressionAuthorityVersion: 1, joined: { p1: true, p2: true }, winner: 'p1',
            p1: { name: 'r4' }, p2: { name: 'fourth' }, rewardSector: STRAND, endedAt,
        }) as unknown as PvpSession;
        const kept = (await readCoastClaim(STRAND))!;
        const redeclared = await declare('rival', STRAND, kept.immuneUntil + HOUR);
        assert.equal(redeclared.ok, true, JSON.stringify(redeclared));
        const second = (redeclared as { contest: CoastContest }).contest;
        assert.ok(second.opensAt > open);
        assert.equal((await settleCoastContestDuel(session(second.closesAt - 1), second.closesAt + 60_000))?.counted, true, 'fought inside the window, read a minute after it');
        assert.equal((await settleCoastContestDuel(session(second.closesAt), second.closesAt + 60_000))?.reason, 'closed');
    });

    it('takes a deleted account off both rosters, and keeps the score it earned', async () => {
        const { contest, open } = await contested();
        await win('r2', contest, `${contest.id}-r2-0`);
        await duel('rival', 'founder', 'duel-1', open);
        assert.deepEqual(await releaseCoastRecordsOfPlayer('r2', 'Saltborn'), [`coast-contest:${STRAND}`]);
        let stored = (await readCoastContest(STRAND))!;
        assert.deepEqual([stored.roster.includes('r2'), Object.hasOwn(stored.wins, 'r2'), stored.score, stored.roster.length], [false, false, 2, 4]);
        // Whoever registers that name next is on no roster.
        assert.equal((await win('r2', contest, `${contest.id}-r2-reused`)).reason, 'not-on-roster');

        // A defender goes the same way, with the day's duel pairs that named them.
        assert.deepEqual(await releaseCoastRecordsOfPlayer('founder', 'Tidewatch'), [`coast-contest:${STRAND}`]);
        stored = (await readCoastContest(STRAND))!;
        assert.deepEqual([stored.defender?.roster.includes('founder'), stored.duels, stored.score], [false, [], 2]);
        assert.equal((await duel('rival', 'founder', 'duel-2', open + 24 * HOUR)).reason, 'not-on-roster');
        // Asked again, or about someone the coast never knew, it touches nothing.
        assert.deepEqual([await releaseCoastRecordsOfPlayer('founder', 'Tidewatch'), await releaseCoastRecordsOfPlayer('stranger', null)], [[], []]);
    });

    it('changes hands at the close when the attackers met the target and outscored the defence', async () => {
        const { contest, open } = await contested();
        const before = (await readCoastClaim(STRAND))!;
        await attackersMeetTarget(contest);
        await duel('founder', 'rival', 'defence-1', open);
        const result = (await settleDueCoastLand(contest.closesAt)).settled[0];
        assert.deepEqual([result.outcome, result.score, result.defender, result.defense], ['won', 20, 'Tidewatch', 1]);
        const claim = (await readCoastClaim(STRAND))!;
        assert.deepEqual([claim.clan, claim.landingEpoch, claim.immuneUntil - claim.since], ['Saltborn', before.landingEpoch + 1, 72 * HOUR]);
    });

    it('is seen off when the defence scores as much as the attack, or the target is missed', async () => {
        const { contest } = await contested();
        const before = (await readCoastClaim(STRAND))!;
        // Two attackers at their cap is ten: short of fifteen.
        for (const member of RIVALS.slice(0, 2)) for (let i = 0; i < 5; i++) await win(member, contest, `${contest.id}-${member}-${i}`);
        assert.equal((await settleCoastContest(STRAND, contest.closesAt))?.outcome, 'lost');
        const kept = (await readCoastClaim(STRAND))!;
        assert.deepEqual([kept.clan, kept.landingEpoch], ['Tidewatch', before.landingEpoch]);
        assert.equal(kept.immuneUntil, contest.closesAt + 72 * HOUR, 'a holder that saw it off is protected again');
        assert.match(String((await declare('rival', STRAND, contest.closesAt + 30 * HOUR) as { error: string }).error), /protected for now/);

        // Target met, but the defence matched it point for point: the holder keeps the ground.
        const again = await declare('rival', STRAND, kept.immuneUntil + HOUR);
        assert.equal(again.ok, true, JSON.stringify(again));
        const second = (again as { contest: CoastContest }).contest;
        await attackersMeetTarget(second);
        await kv.set(coastContestKey(STRAND), { ...(await readCoastContest(STRAND))!, defense: 20 });
        assert.equal((await settleCoastContest(STRAND, second.closesAt))?.outcome, 'lost');
        assert.equal((await readCoastClaim(STRAND))?.clan, 'Tidewatch');
    });

    it('counts a finished world duel, and nothing else, from the PvP settlement', async () => {
        const { contest, open } = await contested();
        const session = (patch: Record<string, unknown> = {}) => ({
            battleId: 'pvp-battle-1', rewardAuthority: 'world', progressionAuthorityVersion: 1, joined: { p1: true, p2: true }, winner: 'p1',
            p1: { name: 'rival' }, p2: { name: 'founder' }, rewardSector: STRAND, ...patch,
        }) as unknown as PvpSession;

        // What never counts: a spar or clan-war match, a no-show, a draw, a fight somewhere else.
        for (const [label, patch] of Object.entries({
            'no reward authority': { rewardAuthority: undefined },
            'a clan-war queue match': { rewardAuthority: 'clan-war' },
            'an opponent who never joined': { joined: { p1: true, p2: false } },
            'a draw': { winner: 'draw' },
            'a fight on the home map': { rewardSector: 5 },
            'a fight in another coast sector': { rewardSector: SEAM },
        })) assert.equal(await settleCoastContestDuel(session({ battleId: `no-${label}`, ...patch }), open), null, label);
        assert.equal((await readCoastContest(STRAND))?.score, 0);

        // A win the game pays nothing for scores nothing: the loser fled or went quiet in the opening rounds.
        const started = open - 20_000;
        for (const [label, patch] of Object.entries({
            'the loser fled at once': { round: 1, fleedBy: 'p2', p2: { name: 'founder', hp: 400 } },
            'the loser stopped answering': { round: 2, p2: { name: 'founder', hp: 400 } },
        })) assert.deepEqual(await settleCoastContestDuel(session({ battleId: `quit-${label}`, createdAt: started, endedAt: open, ...patch }), open), { counted: false, reason: 'no-fight' }, label);
        assert.equal((await readCoastContest(STRAND))?.score, 0);
        // The same rule does not turn away a quick knockout, or a loser who fled a long fight.
        assert.equal((await settleCoastContestDuel(session({ battleId: 'quick-ko', createdAt: started, endedAt: open, round: 2, p1: { name: 'r4' }, p2: { name: 'fourth', hp: 0 } }), open))?.counted, true);
        assert.equal((await settleCoastContestDuel(session({ battleId: 'long-flee', createdAt: open - 10 * 60_000, endedAt: open, round: 9, fleedBy: 'p2', p1: { name: 'r5' }, p2: { name: 'fifth', hp: 300 } }), open))?.counted, true);
        await kv.set(coastContestKey(STRAND), { ...(await readCoastContest(STRAND))!, score: 0, duels: [] });

        assert.deepEqual(await settleCoastContestDuel(session(), open), { counted: true, side: 'attack', score: 1, target: 15, defense: 0 });
        assert.equal((await settleCoastContestDuel(session(), open))?.reason, 'replayed', 'the other fighter\'s settlement reads the same battle');
        assert.equal((await settleCoastContestDuel(session({ battleId: 'pvp-battle-2', winner: 'p2', p1: { name: 'r2' }, p2: { name: 'second' } }), open))?.side, 'defense');

        // Two accounts that have shared a browser cannot feed each other points.
        await kv.set('player-fp:r3:shared-browser', 1);
        await kv.set('player-fp:third:shared-browser', 1);
        assert.deepEqual(await settleCoastContestDuel(session({ battleId: 'pvp-battle-3', p1: { name: 'r3' }, p2: { name: 'third' } }), open), { counted: false, reason: 'shared-device' });
        const stored = (await readCoastContest(STRAND))!;
        assert.deepEqual([stored.score, stored.defense, contest.id === stored.id], [1, 1, true]);
    });

    it('needs only the target if the holding clan is gone by the close', async () => {
        const { contest } = await contested();
        await attackersMeetTarget(contest);
        await kv.del(clanRecordKey('Tidewatch'));
        await settleDueCoastLand(contest.opensAt + HOUR); // the sweep hands the dead clan's sector back
        assert.equal(await readCoastClaim(STRAND), null);
        assert.equal((await settleCoastContest(STRAND, contest.closesAt))?.outcome, 'won');
        assert.equal((await readCoastClaim(STRAND))?.clan, 'Saltborn');
    });

    it('is announced: the declaration, and how it ended, once each', async () => {
        const posted = async () => ((await kv.get<Array<{ type: string; title: string; message: string }>>('game:announcements')) ?? []).map(entry => `${entry.title}. ${entry.message}`);
        const { contest } = await contested();
        assert.deepEqual((await posted()).reverse(), [
            'Tidewatch has declared for Wrack Strand. The Unmoored hold it. The contest opens in a day and runs for two.',
            'Tidewatch has taken Wrack Strand. The Unmoored garrison has been driven off.',
            'Saltborn has declared for Wrack Strand. Tidewatch holds it. The contest opens in a day and runs for two.',
        ], 'a holder learns of a declaration without opening any screen');
        await settleCoastContest(STRAND, contest.closesAt);
        await settleCoastContest(STRAND, contest.closesAt);
        assert.equal((await posted())[0], 'Tidewatch has held Wrack Strand. Saltborn could not take it.');
        assert.equal((await posted()).length, 4, 'a settlement that is retried announces once');
        // A failed attempt on the Unmoored's own ground is nobody's news.
        await clan('Reedwake', ['w1', 'w2', 'w3', 'w4', 'w5']);
        const lone = (await declare('w1', SEAM, contest.closesAt) as { contest: CoastContest }).contest;
        await settleCoastContest(SEAM, lone.closesAt);
        assert.deepEqual((await posted()).slice(0, 2).map(line => line.split('.')[0]), ['Reedwake has declared for Splitstone Seam', 'Tidewatch has held Wrack Strand']);
    });

    it('posts a stronger guard the taller the holder\'s Landing stands', async () => {
        const { contest } = await contested();
        assert.deepEqual(await coastGarrisonGuard(contest), { name: 'Tidewatch Garrison Guard', statBonus: 3 }, 'no Landing: the same as the Unmoored');
        const landing = { clan: 'Tidewatch', clanSlug: 'tidewatch', generation: contest.defender!.generation, sector: STRAND, landingEpoch: contest.defender!.landingEpoch,
            status: 'active', tier: 2, stores: {}, foundedAt: T0, foundedBy: 'founder', upkeepWeek: 0, dormantWeeks: 0, contributions: {} };
        await kv.set('coast:landing:tidewatch', landing);
        assert.equal((await coastGarrisonGuard(contest)).statBonus, 5);
        await kv.set('coast:landing:tidewatch', { ...landing, status: 'destroyed' });
        assert.equal((await coastGarrisonGuard(contest)).statBonus, 3);
        const unmoored = await declared('Reedwake', ['w1', 'w2', 'w3', 'w4', 'w5'], SEAM);
        assert.deepEqual(await coastGarrisonGuard(unmoored), { name: 'Unmoored Garrison Guard', statBonus: 3 });
    });
});

describe('a contest that runs out the clock', () => {
    it('is lost at its close, and the clan waits a day before trying that sector again', async () => {
        const contest = await declared();
        await win('founder', contest, 'only-one');
        assert.deepEqual(await settleDueCoastLand(contest.closesAt - 1), { settled: [], released: [] });
        const pass = await settleDueCoastLand(contest.closesAt);
        assert.deepEqual(pass.settled.map(result => [result.sector, result.outcome, result.score]), [[STRAND, 'lost', 1]]);
        assert.equal(await readCoastClaim(STRAND), null, 'the Unmoored keep it');

        assert.match(String((await declare('founder', STRAND, contest.closesAt + HOUR) as { error: string }).error), /Wait a day before declaring again/);
        assert.equal((await declare('founder', SEAM, contest.closesAt + HOUR)).ok, true, 'another sector is not on cooldown');
        await withdrawCoastContest({ playerName: 'founder', sector: SEAM, now: contest.closesAt + HOUR });
        assert.equal((await declare('founder', STRAND, contest.closesAt + 25 * HOUR)).ok, true);
    });

    it('can be ended early by force, as its score stands', async () => {
        const contest = await declared();
        assert.equal(await settleCoastContest(STRAND, contest.opensAt), null, 'not due, so nothing happens');
        assert.equal((await settleCoastContest(STRAND, contest.opensAt, { force: true }))?.outcome, 'lost');
        assert.equal(await settleCoastContest(STRAND, contest.opensAt, { force: true }), null, 'and there is nothing left to settle');
    });
});

describe('a clan that is gone', () => {
    async function holding(): Promise<void> {
        const contest = await declared();
        for (const member of CREW.slice(0, 4)) for (let i = 0; i < 5; i++) await win(member, contest, `${member}-${i}`);
        assert.equal((await readCoastClaim(STRAND))?.clan, 'Tidewatch');
    }

    it('gives its land and its posted contest back when it dissolves', async () => {
        await holding();
        await clan('Saltborn', ['rival', 'r2', 'r3', 'r4', 'r5']);
        await declare('rival', SEAM);
        assert.deepEqual(await releaseCoastHoldingsForClan('Tidewatch'), { claims: 1, contests: 0 });
        assert.deepEqual(await releaseCoastHoldingsForClan('Saltborn'), { claims: 0, contests: 1 });
        assert.deepEqual([await readCoastClaim(STRAND), await readCoastContest(SEAM)], [null, null]);
        assert.deepEqual(await releaseCoastHoldingsForClan('Tidewatch'), { claims: 0, contests: 0 }, 'safe to run again');
    });

    it('is not inherited by a new clan that takes the same name', async () => {
        await holding();
        // The old clan's record is replaced by a new clan of the same name.
        await clan('Tidewatch', ['newfounder', 'n2', 'n3', 'n4', 'n5'], { createdAt: 9_999 });
        await clan('Saltborn', ['rival', 'r2', 'r3', 'r4', 'r5']);
        // The stale claim frees the ground for anyone, and the new clan holds nothing.
        assert.equal((await declare('rival', STRAND, T0 + 200 * HOUR)).ok, true);
        assert.equal((await declare('newfounder', SEAM, T0 + 200 * HOUR)).ok, true, 'the new Tidewatch is not counted as holding a sector');
    });

    it('is swept by the scheduled pass when its record has simply vanished', async () => {
        await holding();
        await kv.del(clanRecordKey('Tidewatch'));
        assert.deepEqual(await settleDueCoastLand(T0 + 300 * HOUR), { settled: [], released: [STRAND] });
        assert.equal(await kv.get(coastClaimKey(STRAND)), null);
    });

    it('voids a contest it had already won on points', async () => {
        const contest = await declared();
        for (const member of CREW.slice(0, 3)) for (let i = 0; i < 4; i++) await win(member, contest, `${member}-${i}`);
        // Twelve points in, the clan's record is replaced.
        await kv.set(coastContestKey(STRAND), { ...(await readCoastContest(STRAND))!, score: 20 });
        await clan('Tidewatch', ['newfounder', 'n2', 'n3', 'n4', 'n5'], { createdAt: 9_999 });
        assert.equal((await settleCoastContest(STRAND, contest.opensAt + HOUR))?.outcome, 'void');
        assert.equal(await readCoastClaim(STRAND), null);
    });
});

describe('the garrison fight itself', () => {
    it('can be asked for only on the coast, and is built from the contest', async () => {
        assert.equal(cleanWorldAiFightRequest({ kind: 'coast-garrison', sourceId: 'abc', sector: 5 }), null, 'never on the home map');
        const contest = await declared();
        const request = cleanWorldAiFightRequest({ kind: 'coast-garrison', sourceId: contest.id, sector: STRAND })!;
        assert.equal(request.sector, STRAND);
        const save = (await kv.get<Record<string, unknown>>('save:founder'))!;
        await assert.rejects(buildWorldAiFightSpec({ playerName: 'founder', request, save, now: T0 }), /has not opened yet/);
        const spec = await buildWorldAiFightSpec({ playerName: 'founder', request, save, now: contest.opensAt + HOUR });
        assert.deepEqual([spec.context.kind, spec.context.sourceId, spec.context.displayName, spec.context.sealVersion], ['coast-garrison', contest.id, 'Unmoored Garrison Guard', undefined]);
        assert.equal(spec.profile.level, 80, 'the guard stands at the player\'s level, never below the region\'s');
        await assert.rejects(buildWorldAiFightSpec({ playerName: 'founder', request, save: { ...save, currentSector: SEAM }, now: contest.opensAt + HOUR }), /world-sector-mismatch/);
    });
});

describe('the land route', () => {
    type Handler = (req: never, res: never) => Promise<unknown>;
    let handler: Handler, token: typeof import('../_auth.js').issuePlayerToken;
    before(async () => {
        process.env.ADMIN_PASSWORD = 'coast-land-admin';
        ({ issuePlayerToken: token } = await import('../_auth.js'));
        handler = (await import('./land.js')).default as unknown as Handler;
    });
    async function call(body: Record<string, unknown>, who?: string, admin = false) {
        const out = { status: 200, body: {} as Record<string, unknown> };
        const res = { setHeader() { return res; }, status(value: number) { out.status = value; return res; }, json(value: Record<string, unknown>) { out.body = value; return res; }, end() { return res; } };
        const headers = admin ? { 'x-admin-password': 'coast-land-admin' } : who ? { 'x-player-token': token(who) } : {};
        await handler({ method: 'POST', body, query: {}, headers, socket: { remoteAddress: '127.4.9.7' } } as never, res as never);
        return out;
    }

    it('shows the land to any signed-in player, and lets an officer declare', async () => {
        assert.equal((await call({ action: 'status' })).status, 401);
        await clan('Tidewatch', CREW);
        const status = await call({ action: 'status' }, 'third');
        assert.equal(status.status, 200);
        assert.deepEqual((status.body.rules as Record<string, number>).target, 15);
        assert.ok((status.body.sectors as unknown[]).length >= 5);

        assert.equal((await call({ action: 'declare', sector: 107 }, 'founder')).status, 400);
        assert.equal((await call({ action: 'declare', sector: STRAND }, 'third')).status, 403);
        const posted = await call({ action: 'declare', sector: STRAND }, 'founder');
        assert.equal(posted.status, 200, JSON.stringify(posted.body));
        assert.equal((posted.body.contest as CoastContest).clan, 'Tidewatch');
        assert.equal((await call({ action: 'withdraw', sector: STRAND }, 'founder')).status, 200);
    });

    it('keeps force-settle and release for an admin, and writes both to the audit log', async () => {
        await declared();
        assert.equal((await call({ action: 'force-settle', sector: STRAND }, 'founder')).status, 403);
        const forced = await call({ action: 'force-settle', sector: STRAND }, undefined, true);
        assert.equal(forced.status, 200);
        assert.equal((forced.body.result as CoastContestResult).outcome, 'lost');
        assert.equal((await call({ action: 'release', sector: STRAND }, undefined, true)).body.released, false, 'nothing was held');
        const audit = (await kv.get<Array<{ action: string; entityId: string }>>('audit:sector')) ?? [];
        assert.deepEqual(audit.map(entry => [entry.action, entry.entityId]).sort(), [['coast-land.force-settle', '102'], ['coast-land.release', '102']]);
    });

    it('is closed to Cinderhold accounts', () => {
        assert.ok(NPC_BLOCKED_ROUTES.includes('/coast/land'));
    });
});

describe('War Supply from the coast sector (clans hold land on the coast only)', () => {
    it('pays a day of supply for each whole day held, once, to the clan that holds the sector', async () => {
        for (const name of CREW) await player(name, 'Tidewatch');
        await clan('Tidewatch', CREW);
        const granted = await grantCoastClaim({ sector: STRAND, clanName: 'Tidewatch', now: T0 });
        assert.equal(granted.ok, true, JSON.stringify(granted));

        assert.deepEqual(await collectCoastClaimSupply('Tidewatch', T0 + 23 * HOUR), { collected: 0, sector: STRAND }, 'nothing before a whole day');
        // The figure a member is shown is the figure a collection pays: the same sum, read without collecting.
        const { coastLandingView } = await import('./_landing.js');
        const shown = async (now: number) => (await coastLandingView('third', now)).holds?.supply;
        assert.deepEqual([await shown(T0 + 23 * HOUR), await shown(T0 + 60 * HOUR)], [0, 200]);
        assert.deepEqual(await collectCoastClaimSupply('Tidewatch', T0 + 60 * HOUR), { collected: 200, sector: STRAND }, 'two whole days at 100 a day');
        assert.deepEqual([await shown(T0 + 60 * HOUR), await shown(T0 + 72 * HOUR)], [0, 100], 'and it falls to nothing once collected');
        // Marked paid up to the end of the second day, so the half day already run is not lost.
        assert.equal((await readCoastClaim(STRAND))?.supplyAt, T0 + 48 * HOUR);
        assert.deepEqual(await collectCoastClaimSupply('Tidewatch', T0 + 60 * HOUR), { collected: 0, sector: STRAND }, 'never twice');
        assert.deepEqual(await collectCoastClaimSupply('Tidewatch', T0 + 72 * HOUR), { collected: 100, sector: STRAND });

        // A clan that holds nothing gets nothing, and a sector given up stops paying.
        assert.deepEqual(await collectCoastClaimSupply('Nobody Here', T0 + 900 * HOUR), { collected: 0, sector: null });
        assert.equal(await releaseCoastClaim(STRAND), true);
        assert.deepEqual(await collectCoastClaimSupply('Tidewatch', T0 + 900 * HOUR), { collected: 0, sector: null });
    });
});

describe('declaring costs the clan its Territory Control Scrolls', () => {
    const scrolls = async (name = 'Tidewatch') => ((await kv.get<{ treasury?: { items?: Array<{ itemId: string; count: number }> } }>(clanRecordKey(name)))?.treasury?.items ?? [])
        .find(stack => stack.itemId === 'territory-control-scroll')?.count ?? 0;
    const crew = async (count?: number) => {
        await clan('Tidewatch', CREW, count === undefined ? {} : { scrolls: count });
        for (const name of CREW) await player(name, 'Tidewatch');
    };

    it('takes 75 from the treasury when the contest is posted, and records what was paid', async () => {
        await crew();
        const posted = await declare('founder');
        assert.equal(posted.ok, true, JSON.stringify(posted));
        assert.equal(COAST_LAND.declareScrolls, 75, 'what capturing a home sector used to cost');
        assert.equal(await scrolls(), 225);
        assert.equal(posted.ok && posted.contest.paid, 75);
        // Nothing else in the treasury is touched.
        const items = (await kv.get<{ treasury: { items: Array<{ itemId: string; count: number }> } }>(clanRecordKey('Tidewatch')))!.treasury.items;
        assert.deepEqual(items.find(stack => stack.itemId === 'gather-binding-fiber'), { itemId: 'gather-binding-fiber', count: 4 });
    });

    it('is refused, and posts nothing, when the treasury is short', async () => {
        await crew(74);
        const refused = await declare('founder') as { ok: false; error: string; status: number };
        assert.deepEqual([refused.ok, refused.status], [false, 409]);
        assert.match(refused.error, /needs 75 Territory Control Scrolls/);
        assert.equal(await readCoastContest(STRAND), null);
        assert.equal(await scrolls(), 74, 'and what it has is left alone');
    });

    it('spends nothing on a declaration that would not stand', async () => {
        await crew();
        // Not an officer; then ground that cannot be held; then a clan that has already declared.
        assert.equal((await declare('second')).ok, false);
        assert.equal((await declare('founder', 101)).ok, false);
        assert.equal(await scrolls(), 300);
        assert.equal((await declare('founder')).ok, true);
        assert.equal((await declare('founder', SEAM)).ok, false, 'one contest at a time');
        assert.equal(await scrolls(), 225, 'only the one that was posted was paid for');
    });

    it('gives the scrolls back when the clan withdraws before the fighting opens', async () => {
        await crew();
        assert.equal((await declare('founder')).ok, true);
        assert.equal(await scrolls(), 225);
        assert.deepEqual(await withdrawCoastContest({ playerName: 'founder', sector: STRAND, now: T0 + HOUR }), { ok: true });
        assert.equal(await scrolls(), 300);
        // A contest posted before declaring had a cost carries nothing to give back, so withdrawing it mints nothing.
        assert.equal((await declare('founder')).ok, true);
        const old = (await readCoastContest(STRAND))!;
        await kv.set(coastContestKey(STRAND), { ...old, paid: undefined });
        assert.deepEqual(await withdrawCoastContest({ playerName: 'founder', sector: STRAND, now: T0 + HOUR }), { ok: true });
        assert.equal(await scrolls(), 225);
    });

    it('gives them back when an admin calls the contest off, at any stage, and only once', async () => {
        const { cancelCoastContest } = await import('./_land.js');
        await crew();
        const posted = await declare('founder');
        assert.equal(posted.ok, true, JSON.stringify(posted));
        assert.equal(await scrolls(), 225);
        // Called off after the fighting has opened, when the clan itself could no longer withdraw.
        assert.equal((await cancelCoastContest(STRAND, T0 + 30 * HOUR))?.outcome, 'void');
        assert.equal(await scrolls(), 300);
        assert.equal(await cancelCoastContest(STRAND, T0 + 31 * HOUR), null, 'nothing is posted now');
        assert.equal(await scrolls(), 300, 'and nothing more is paid back');
    });
});
