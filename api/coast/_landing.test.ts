import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'coast-landing-test-secret';

import { clanRecordKey } from '../_utils.js';
import { NPC_BLOCKED_ROUTES } from '../_npc-guard.js';
import { COAST_LANDING_SAGA, SAVE_DEBIT_SAGAS } from '../_save-debit-kinds.js';
import { SaveDebitRefusal } from '../_save-debit-saga.js';
import { countOwned } from '../craft/_forge.js';
import { COAST_LAND, declareCoastContest, readCoastClaim, recordCoastGarrisonWin, releaseCoastClaim, releaseCoastHoldingsForClan } from './_land.js';
import { dressCoastHall, contributeToCoastLanding, coastLandingView, foundCoastLanding, raiseCoastLanding, runCoastLandTick } from './_landing.js';
import { cancelCoastContest, coastGarrisonFightStart, grantCoastClaim, pauseCoastLand, readCoastContest, readCoastLandPause, resumeCoastLand, setCoastClaimImmunity, settleDueCoastLand } from './_land.js';
import { buildCoastLandingWorkFor, restoreCoastLanding } from './_landing.js';
import { coastLandViews, withdrawCoastContest } from './_land.js';
import {
    COAST_LANDING_WORKS, COAST_LANDING_WORK_EFFECTS, buildCoastLandingWork, coastLandingExtraNoticeMs, coastLandingMemberCap, coastLandingUpkeep,
    coastLandingWork, coastLandingWorkBlock, COAST_TOWN_FACILITIES, coastTownFacilities,
} from './_landing-rules.js';
import { QUEST_LINES } from '../quests/_catalog.js';
import {
    COAST_LANDING, COAST_LANDING_MATERIALS, COAST_LANDING_TIERS, applyCoastLandingContribution, canRaiseCoastLanding, coastLandingShortfall, coastWeek,
    raiseCoastLandingTier, settleCoastLandingUpkeep,
    type CoastLanding,
} from './_landing-rules.js';
import { isKeptQuestMaterial } from '../../shared/quest-sites.js';
import { readCoastLanding } from './_landing-store.js';
import { releaseCoastRecordsOfPlayer } from './_player-erasure.js';

/*
 * The Clan Landing: a clan's base on the sector it holds. Pure rules first,
 * then the real actions against the in-memory store, with the sector taken the
 * way a clan really takes one.
 */

const DAY = 24 * 60 * 60_000, HOUR = 60 * 60_000;
const T0 = 1_800_000_000_000;
const STRAND = 102, SEAM = 103;
const CREW = ['founder', 'second', 'third', 'fourth', 'fifth'];
const HERB = 'gather-field-herb', FIBER = 'gather-binding-fiber', SAND = 'gather-iron-sand';

let kv: typeof import('../_storage.js').kv;
before(async () => { ({ kv } = await import('../_storage.js')); });
beforeEach(async () => {
    for (const pattern of ['coast:*', 'save:*', 'lock:*', 'economy-tx:*', 'ratelimit:*']) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
});

const landing = (patch: Partial<CoastLanding> = {}): CoastLanding => ({
    clan: 'Tidewatch', clanSlug: 'tidewatch', generation: 'g1', sector: STRAND, landingEpoch: 1, status: 'active', tier: 0, stores: {},
    foundedAt: T0, foundedBy: 'founder', upkeepWeek: coastWeek(T0), dormantWeeks: 0, contributions: {}, ...patch,
});

describe('the rules', () => {
    it('counts weeks from Monday, 00:00 UTC', () => {
        const firstMonday = 4 * DAY; // 5 January 1970
        assert.equal(coastWeek(firstMonday - 1) + 1, coastWeek(firstMonday));
        assert.equal(coastWeek(firstMonday), coastWeek(firstMonday + 7 * DAY - 1));
    });

    it('a contribution fills the stores and the week\'s list, and keeps only two weeks of lists', () => {
        const week = coastWeek(T0);
        const once = applyCoastLandingContribution(landing({ contributions: { [week - 3]: { old: 9 }, [week - 1]: { second: 4 } } }), { name: 'founder', itemId: FIBER, count: 5, week, landingEpoch: 1 });
        assert.deepEqual(once.stores, { [FIBER]: 5 });
        assert.deepEqual(once.contributions, { [week - 1]: { second: 4 }, [week]: { founder: 5 } });
        const twice = applyCoastLandingContribution(once, { name: 'founder', itemId: HERB, count: 2, week, landingEpoch: 1 });
        assert.deepEqual([twice.stores, twice.contributions[week]], [{ [FIBER]: 5, [HERB]: 2 }, { founder: 7 }]);
    });

    it('a contribution for a Landing that has fallen, or for another epoch, is burned', () => {
        const fallen = landing({ status: 'destroyed' }), rebuilt = landing({ landingEpoch: 2 });
        const plan = { name: 'founder', itemId: FIBER, count: 5, week: coastWeek(T0), landingEpoch: 1 };
        assert.equal(applyCoastLandingContribution(fallen, plan), fallen);
        assert.equal(applyCoastLandingContribution(rebuilt, plan), rebuilt, 'never credited to the clan\'s next Landing');
    });

    it('raising takes the same amount of all three materials', () => {
        const short = landing({ stores: { [HERB]: 20, [FIBER]: 20, [SAND]: 19 } });
        assert.equal(canRaiseCoastLanding(short), false);
        const ready = landing({ stores: { [HERB]: 25, [FIBER]: 20, [SAND]: 20 } });
        assert.equal(canRaiseCoastLanding(ready), true);
        assert.deepEqual([raiseCoastLandingTier(ready).tier, raiseCoastLandingTier(ready).stores], [1, { [HERB]: 5, [FIBER]: 0, [SAND]: 0 }]);
        assert.equal(canRaiseCoastLanding(landing({ tier: 3, stores: { [HERB]: 999, [FIBER]: 999, [SAND]: 999 } })), false, 'the last tier is the last');
        assert.equal(canRaiseCoastLanding({ ...ready, status: 'dormant' }), false);
    });

    it('the taller tiers also take the coast\'s own materials, and upkeep never spends those', () => {
        const CORD = 'quest-wrack-cord', FITTINGS = 'quest-splitstone-fittings', PITCH = 'quest-pitchwood', EEL = 'quest-caulk-eel';
        assert.deepEqual(COAST_LANDING_TIERS.map(tier => Object.keys(tier.cost).filter(itemId => itemId.startsWith('quest-'))), [[], [], [CORD, FITTINGS], [PITCH, EEL]]);
        // Every material a tier names is one a member can give, and one a kept site goes on yielding.
        for (const tier of COAST_LANDING_TIERS) {
            for (const itemId of Object.keys(tier.cost)) {
                assert.ok((COAST_LANDING_MATERIALS as readonly string[]).includes(itemId), itemId);
                if (itemId.startsWith('quest-')) assert.equal(isKeptQuestMaterial(itemId), true, `${itemId} must come from a site that stays open`);
            }
        }
        const camp = landing({ tier: 1, stores: { [HERB]: 60, [FIBER]: 60, [SAND]: 60, [CORD]: 20, [FITTINGS]: 19 } });
        assert.deepEqual([canRaiseCoastLanding(camp), coastLandingShortfall(camp)], [false, { [FITTINGS]: 1 }]);
        const hall = raiseCoastLandingTier({ ...camp, stores: { ...camp.stores, [FITTINGS]: 22 } });
        assert.deepEqual([hall.tier, hall.stores], [2, { [HERB]: 0, [FIBER]: 0, [SAND]: 0, [CORD]: 0, [FITTINGS]: 2 }]);

        // Fifteen units are due at the Landing Hall. Forty units of the coast's own materials do not pay it.
        const week = coastWeek(T0);
        const hoard = landing({ tier: 2, stores: { [HERB]: 5, [PITCH]: 20, [EEL]: 20 } });
        const unpaid = settleCoastLandingUpkeep(hoard, week + 2, T0 + 14 * DAY);
        assert.deepEqual([unpaid.landing.status, unpaid.landing.stores], ['dormant', hoard.stores]);
        const paid = settleCoastLandingUpkeep({ ...hoard, stores: { ...hoard.stores, [SAND]: 12 } }, week + 2, T0 + 14 * DAY);
        assert.deepEqual([paid.landing.status, paid.landing.stores], ['active', { [HERB]: 1, [SAND]: 1, [PITCH]: 20, [EEL]: 20 }]);
    });

    it('upkeep waits out the first week, is paid from the fullest stores, and lapses into a fall', () => {
        const week = coastWeek(T0);
        const camp = landing({ tier: 1, stores: { [HERB]: 2, [FIBER]: 10, [SAND]: 1 } });
        assert.deepEqual(settleCoastLandingUpkeep(camp, week, T0 + DAY), { landing: camp, fell: false }, 'this week is already settled');
        const grace = settleCoastLandingUpkeep(camp, week + 1, T0 + 6 * DAY);
        assert.deepEqual([grace.landing.stores, grace.landing.upkeepWeek, grace.fell], [camp.stores, week + 1, false], 'nothing is asked in the first seven days');

        const paid = settleCoastLandingUpkeep(camp, week + 2, T0 + 14 * DAY);
        assert.deepEqual([paid.landing.stores, paid.landing.status, paid.fell], [{ [HERB]: 2, [FIBER]: 4, [SAND]: 1 }, 'active', false], 'six units, from the fullest');

        const bare = landing({ tier: 1, stores: { [HERB]: 1 } });
        const first = settleCoastLandingUpkeep(bare, week + 2, T0 + 14 * DAY);
        assert.deepEqual([first.landing.status, first.landing.dormantWeeks, first.fell], ['dormant', 1, false]);
        assert.equal(settleCoastLandingUpkeep(first.landing, week + 2, T0 + 15 * DAY).landing, first.landing, 'one unpaid week is counted once');
        const second = settleCoastLandingUpkeep(first.landing, week + 3, T0 + 21 * DAY);
        assert.deepEqual([second.landing.dormantWeeks, second.fell], [COAST_LANDING.dormantWeeksToFall, true]);

        // Stocked again in the same week: it pays late and wakes at once.
        const woken = settleCoastLandingUpkeep({ ...first.landing, stores: { [SAND]: 8 } }, week + 2, T0 + 15 * DAY);
        assert.deepEqual([woken.landing.status, woken.landing.dormantWeeks, woken.landing.stores], ['active', 0, { [SAND]: 2 }]);
        assert.equal(settleCoastLandingUpkeep(landing({ tier: 0 }), week + 5, T0 + 60 * DAY).landing.status, 'active', 'a staked plot costs nothing to keep');
    });
});

// ── The actions ──────────────────────────────────────────────────────────────

async function player(name: string, clan: string | null, stacks: Array<{ itemId: string; count: number }> = []) {
    await kv.set(`save:${name}`, {
        _saveVersion: 1, currentSector: STRAND,
        character: { name, level: 80, clan, village: 'Stormveil Village', hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, ryo: 0, inventory: [], itemStacks: stacks },
        questLines: { v: 1, active: {}, done: { 'crossing-war-1': { at: 1, marks: 2, unlocks: [COAST_LAND.unlock] } } },
    });
}
const pack = (count = 200) => [HERB, FIBER, SAND].map(itemId => ({ itemId, count }));
async function clan(name: string, members: string[], createdAt = 1_000) {
    await kv.set(clanRecordKey(name), { treasury: { items: [{ itemId: 'territory-control-scroll', count: 300 }] }, name, founderName: members[0], createdAt, members: members.map(member => ({ name: member, joinedAt: 1_000 })), roleOverrides: {} });
    for (const member of members) await player(member, name, pack());
}
/** Take a sector the way a clan does: declare, then twenty garrison wins. */
async function take(sector = STRAND, now = T0) {
    const declared = await declareCoastContest({ playerName: 'founder', sector, now });
    assert.equal(declared.ok, true, JSON.stringify(declared));
    const contest = (declared as { contest: { id: string; opensAt: number } }).contest;
    for (const member of CREW.slice(0, 4)) {
        for (let i = 0; i < 5; i++) await recordCoastGarrisonWin({ playerName: member, sector, contestId: contest.id, proofId: `${contest.id}-${member}-${i}`, now: contest.opensAt + HOUR });
    }
    return (await readCoastClaim(sector))!;
}
const give = (who: string, itemId: string, count: number, requestId: string, now = T0 + 80 * HOUR) =>
    contributeToCoastLanding({ playerName: who, itemId, count, requestId, now });
const stacksOf = async (who: string) => ((await kv.get<Record<string, unknown>>(`save:${who}`))!.character as Record<string, unknown>);
/** Stock a tier's worth: twenty of each material, from three different members (one member's week is 40 units). */
async function stock(tag: string, now = T0 + 80 * HOUR) {
    const givers = ['second', 'third', 'fourth'];
    for (const [index, itemId] of [HERB, FIBER, SAND].entries()) await give(givers[index], itemId, 20, `landing-stock-${tag}-${index}-0000`, now);
}

describe('founding', () => {
    it('shares officer-selected hall paint with the clan and the raised map landmark', async () => {
        await clan('Tidewatch', CREW);
        await take();
        const style = { model: 'pine', dye: 'vermilion' };
        assert.equal((await foundCoastLanding({ playerName: 'founder', hallStyle: { ...style, dye: 'invalid' } })).ok, false);
        assert.equal((await foundCoastLanding({ playerName: 'founder', hallStyle: style, now: T0 + 80 * HOUR })).ok, true);
        assert.deepEqual((await coastLandingView('third')).landing?.hallStyle, style);
        assert.equal((await dressCoastHall('third', { model: 'tide', dye: 'rose' })).ok, false);
        assert.equal((await dressCoastHall('founder', { model: '__proto__', dye: 'cobalt' })).ok, false);
        await stock('hall-dye');
        assert.equal((await raiseCoastLanding({ playerName: 'founder' })).ok, true);
        const next = { model: 'heron', dye: 'jade' };
        assert.equal((await dressCoastHall('founder', next)).ok, true);
        assert.deepEqual((await coastLandingView('second')).landing?.hallStyle, next);
        const { coastLandViews } = await import('./_land.js');
        assert.deepEqual((await coastLandViews(T0 + 80 * HOUR)).find(s => s.sector === STRAND)?.holder?.hallStyle, next);
    });

    it('is for an officer of a clan that holds a sector, and stakes a bare plot', async () => {
        await player('loner', null);
        assert.match(String((await foundCoastLanding({ playerName: 'loner' }) as { error: string }).error), /Only a clan can raise a Landing/);
        await clan('Tidewatch', CREW);
        assert.match(String((await foundCoastLanding({ playerName: 'third' }) as { error: string }).error), /founder, leaders and officers/);
        assert.match(String((await foundCoastLanding({ playerName: 'founder' }) as { error: string }).error), /holds no ground on the coast/);

        const claim = await take();
        assert.deepEqual((await coastLandingView('third')).canFound, false, 'a plain member cannot found');
        assert.equal((await coastLandingView('founder')).canFound, true);
        const founded = await foundCoastLanding({ playerName: 'founder', now: T0 + 80 * HOUR });
        assert.equal(founded.ok, true);
        const row = (await readCoastLanding('tidewatch'))!;
        assert.deepEqual([row.sector, row.landingEpoch, row.tier, row.status, row.stores], [STRAND, claim.landingEpoch, 0, 'active', {}]);
        assert.match(String((await foundCoastLanding({ playerName: 'founder' }) as { error: string }).error), /already staked its Landing here/);

        const view = await coastLandingView('third');
        assert.deepEqual([view.clan, view.holds?.name, view.landing?.name, view.landing?.next?.name, view.landing?.next?.cost, view.canFound], ['Tidewatch', 'Wrack Strand', 'Staked Plot', 'Founding Camp', { [HERB]: 20, [FIBER]: 20, [SAND]: 20 }, false]);
    });
});

describe('stocking and raising', () => {
    async function founded() {
        await clan('Tidewatch', CREW);
        await take();
        await foundCoastLanding({ playerName: 'founder', now: T0 + 80 * HOUR });
    }

    it('moves materials from the backpack to the stores, once per request', async () => {
        await founded();
        const first = await give('third', FIBER, 15, 'landing-request-0001');
        assert.deepEqual([first.landing.stores, first.replayed, countOwned(first.character, FIBER)], [{ [FIBER]: 15 }, false, 185]);
        const again = await give('third', FIBER, 15, 'landing-request-0001');
        assert.deepEqual([again.replayed, again.landing.stores, countOwned(await stacksOf('third'), FIBER)], [true, { [FIBER]: 15 }, 185], 'the same request never gives twice');
        await assert.rejects(give('third', HERB, 15, 'landing-request-0001'), (error: unknown) => error instanceof SaveDebitRefusal && error.status === 409, 'a request id cannot be reused for something else');
        assert.equal(((await readCoastLanding('tidewatch'))!.settlementReceipts ?? []).length, 1);

        const view = await coastLandingView('third', T0 + 80 * HOUR);
        assert.deepEqual([view.landing?.stores[FIBER], view.landing?.thisWeek, view.landing?.yours], [15, { third: 15 }, { used: 15, cap: 40 }]);
    });

    it('forgets a deleted account\'s name, and keeps what it gave', async () => {
        await founded();
        await give('third', FIBER, 15, 'landing-request-0101');
        await give('second', HERB, 5, 'landing-request-0102');
        assert.deepEqual(await releaseCoastRecordsOfPlayer('third', 'Tidewatch'), ['coast-landing:tidewatch']);
        const row = (await readCoastLanding('tidewatch'))!;
        assert.deepEqual([row.stores, Object.values(row.contributions), row.foundedBy], [{ [FIBER]: 15, [HERB]: 5 }, [{ second: 5 }], 'founder']);
        // The one who staked it leaves no name behind either.
        assert.deepEqual(await releaseCoastRecordsOfPlayer('founder', 'Tidewatch'), ['coast-landing:tidewatch']);
        assert.equal((await readCoastLanding('tidewatch'))!.foundedBy, '');
        assert.deepEqual(await releaseCoastRecordsOfPlayer('founder', 'Tidewatch'), []);
    });

    it('holds each member to a weekly allowance, and to what they really carry', async () => {
        await founded();
        await give('third', FIBER, 20, 'landing-request-0002');
        await give('third', HERB, 20, 'landing-request-0003');
        await assert.rejects(give('third', SAND, 1, 'landing-request-0004'), /You have 0 of 40 left/);
        assert.equal((await give('third', SAND, 1, 'landing-request-0005', T0 + 80 * HOUR + 7 * DAY)).landing.stores[SAND], 1, 'a new week, a new allowance');

        await player('fourth', 'Tidewatch', [{ itemId: SAND, count: 3 }]);
        await assert.rejects(give('fourth', SAND, 4, 'landing-request-0006'), /do not hold that many/);
        for (const bad of [[SAND, 0], [SAND, 21], ['quest-woundroot', 5], [SAND, 1.5]] as const) {
            await assert.rejects(give('fourth', bad[0], bad[1], 'landing-request-0007'), (error: unknown) => error instanceof SaveDebitRefusal && error.status === 400);
        }
        await assert.rejects(contributeToCoastLanding({ playerName: 'fourth', itemId: SAND, count: 1, requestId: 'short' }), (error: unknown) => error instanceof SaveDebitRefusal && error.status === 400);
        assert.equal(countOwned(await stacksOf('fourth'), SAND), 3, 'a refused contribution takes nothing');
    });

    it('is closed to outsiders and to a clan with no Landing', async () => {
        await founded();
        await player('outsider', null, pack());
        await assert.rejects(give('outsider', SAND, 1, 'landing-request-0008'), /Only a member of a clan/);
        await clan('Saltborn', ['rival', 'r2', 'r3', 'r4', 'r5']);
        await assert.rejects(give('rival', SAND, 1, 'landing-request-0009'), /has no Landing standing/);
        assert.equal(countOwned(await stacksOf('rival'), SAND), 200);
    });

    it('is raised by an officer once the stores cover the next tier', async () => {
        await founded();
        assert.match(String((await raiseCoastLanding({ playerName: 'third' }) as { error: string }).error), /founder, leaders and officers/);
        assert.match(String((await raiseCoastLanding({ playerName: 'founder' }) as { error: string }).error), /The Founding Camp still needs 20 Field Herb, 20 Binding Fiber and 20 Iron Sand in the stores/);
        await stock('raise');
        const raised = await raiseCoastLanding({ playerName: 'founder' });
        assert.equal(raised.ok, true, JSON.stringify(raised));
        const row = (await readCoastLanding('tidewatch'))!;
        assert.deepEqual([row.tier, row.stores], [1, { [HERB]: 0, [FIBER]: 0, [SAND]: 0 }]);
        assert.equal((await coastLandingView('founder')).landing?.name, 'Founding Camp');
    });
});

describe('losing it', () => {
    async function camp() {
        await clan('Tidewatch', CREW);
        await take();
        await foundCoastLanding({ playerName: 'founder', now: T0 + 80 * HOUR });
        await give('second', FIBER, 12, 'landing-request-0020');
    }

    it('falls with its sector: emptied, marked, and closed to new contributions', async () => {
        await camp();
        assert.equal(await releaseCoastClaim(STRAND), true);
        const row = (await readCoastLanding('tidewatch'))!;
        assert.deepEqual([row.status, row.tier, row.stores, row.destroyedReason], ['destroyed', 0, {}, 'released']);
        assert.equal((row.settlementReceipts ?? []).length, 1, 'its receipts are kept');
        await assert.rejects(give('second', FIBER, 1, 'landing-request-0021'), /has no Landing standing/);
        const view = await coastLandingView('founder');
        assert.deepEqual([view.landing, view.fallen?.sector, view.holds], [null, STRAND, null]);
    });

    it('must be founded again on ground taken again, and starts from nothing', async () => {
        await camp();
        await releaseCoastClaim(STRAND);
        const again = await take(SEAM, T0 + 200 * HOUR);
        assert.equal(again.landingEpoch, 1, 'a different sector has its own epoch');
        const refounded = await foundCoastLanding({ playerName: 'founder', now: T0 + 300 * HOUR });
        assert.equal(refounded.ok, true, JSON.stringify(refounded));
        const row = (await readCoastLanding('tidewatch'))!;
        assert.deepEqual([row.sector, row.status, row.tier, row.stores], [SEAM, 'active', 0, {}]);
        assert.equal((row.settlementReceipts ?? []).length, 1, 'the old Landing\'s receipts still answer a late retry');
        const replay = await give('second', FIBER, 12, 'landing-request-0020', T0 + 300 * HOUR);
        assert.deepEqual([replay.replayed, replay.landing.stores], [true, {}], 'what was given to the fallen Landing is not carried over');
    });

    it('goes dormant when upkeep is unpaid, and loses the sector after two unpaid weeks', async () => {
        await clan('Tidewatch', CREW);
        await take();
        const foundedAt = T0 + 80 * HOUR;
        await foundCoastLanding({ playerName: 'founder', now: foundedAt });
        await stock('lapse', foundedAt);
        assert.equal((await raiseCoastLanding({ playerName: 'founder' })).ok, true); // the Founding Camp, with empty stores

        assert.deepEqual((await runCoastLandTick(foundedAt + 3 * DAY)).fallen, [], 'inside the first week nothing is asked');
        const firstUnpaid = await runCoastLandTick(foundedAt + 8 * DAY);
        assert.deepEqual([firstUnpaid.dormant, firstUnpaid.fallen], [['tidewatch'], []]);
        assert.match(String((await raiseCoastLanding({ playerName: 'founder' }) as { error: string }).error), /is dormant/);
        assert.equal((await readCoastClaim(STRAND))?.clan, 'Tidewatch', 'one unpaid week does not lose the land');

        const secondUnpaid = await runCoastLandTick(foundedAt + 15 * DAY);
        assert.deepEqual(secondUnpaid.fallen, ['tidewatch']);
        assert.equal(await readCoastClaim(STRAND), null, 'the Unmoored have it back');
        assert.deepEqual([(await readCoastLanding('tidewatch'))!.status, (await readCoastLanding('tidewatch'))!.destroyedReason], ['destroyed', 'upkeep-unpaid']);
    });

    it('is woken by restocking, and stays standing while upkeep is paid', async () => {
        await clan('Tidewatch', CREW);
        await take();
        const foundedAt = T0 + 80 * HOUR;
        await foundCoastLanding({ playerName: 'founder', now: foundedAt });
        await stock('wake', foundedAt);
        assert.equal((await raiseCoastLanding({ playerName: 'founder' })).ok, true);
        assert.deepEqual((await runCoastLandTick(foundedAt + 8 * DAY)).dormant, ['tidewatch']);
        await give('fifth', SAND, 20, 'landing-request-0050', foundedAt + 8 * DAY);
        assert.deepEqual((await runCoastLandTick(foundedAt + 8 * DAY + HOUR)).dormant, []);
        const row = (await readCoastLanding('tidewatch'))!;
        assert.deepEqual([row.status, row.dormantWeeks, row.stores[SAND]], ['active', 0, 14]);
        assert.deepEqual((await runCoastLandTick(foundedAt + 15 * DAY)).fallen, []);
        assert.equal((await readCoastLanding('tidewatch'))!.stores[SAND], 8);
    });

    it('is protected for a week once staked, and falls when another clan takes the sector', async () => {
        await clan('Tidewatch', CREW);
        const taken = await take();
        assert.equal(taken.immuneUntil - taken.since, 72 * HOUR);
        const foundedAt = T0 + 80 * HOUR;
        await foundCoastLanding({ playerName: 'founder', now: foundedAt });
        const guarded = (await readCoastClaim(STRAND))!;
        assert.deepEqual([guarded.immuneUntil, guarded.graceGiven], [foundedAt + 7 * DAY, true], 'staking the Landing buys a week to raise it');

        // Saltborn declares once the week is up, meets the target, and Tidewatch never answers.
        await kv.set(clanRecordKey('Saltborn'), { treasury: { items: [{ itemId: 'territory-control-scroll', count: 300 }] }, name: 'Saltborn', founderName: 'rival', createdAt: 2_000, members: ['rival', 'r2', 'r3', 'r4', 'r5'].map(name => ({ name, joinedAt: 1_000 })), roleOverrides: {} });
        for (const name of ['rival', 'r2', 'r3', 'r4', 'r5']) await player(name, 'Saltborn');
        assert.match(String((await declareCoastContest({ playerName: 'rival', sector: STRAND, now: foundedAt + 6 * DAY }) as { error: string }).error), /protected for now/);
        const declared = await declareCoastContest({ playerName: 'rival', sector: STRAND, now: foundedAt + 8 * DAY });
        assert.equal(declared.ok, true, JSON.stringify(declared));
        const contest = (declared as { contest: { id: string; opensAt: number; closesAt: number } }).contest;
        for (const member of ['rival', 'r2', 'r3', 'r4']) {
            for (let i = 0; i < 5; i++) await recordCoastGarrisonWin({ playerName: member, sector: STRAND, contestId: contest.id, proofId: `${contest.id}-${member}-${i}`, now: contest.opensAt + HOUR });
        }
        assert.equal((await readCoastLanding('tidewatch'))!.status, 'active', 'it stands until the close');
        await runCoastLandTick(contest.closesAt);
        assert.equal((await readCoastClaim(STRAND))?.clan, 'Saltborn');
        const fallen = (await readCoastLanding('tidewatch'))!;
        assert.deepEqual([fallen.status, fallen.destroyedReason, fallen.stores], ['destroyed', 'sector-taken', {}], 'nothing of it passes to the new holder');
        assert.equal(await readCoastLanding('saltborn'), null);
    });

    it('is removed outright when the clan dissolves', async () => {
        await camp();
        await releaseCoastHoldingsForClan('Tidewatch');
        assert.equal(await readCoastLanding('tidewatch'), null);
        assert.equal(await readCoastClaim(STRAND), null);
    });
});

describe('the Landing route', () => {
    type Handler = (req: never, res: never) => Promise<unknown>;
    let handler: Handler, token: typeof import('../_auth.js').issuePlayerToken;
    before(async () => {
        process.env.ADMIN_PASSWORD = 'coast-landing-admin';
        ({ issuePlayerToken: token } = await import('../_auth.js'));
        handler = (await import('./landing.js')).default as unknown as Handler;
    });
    async function call(body: Record<string, unknown>, who?: string, admin = false) {
        const out = { status: 200, body: {} as Record<string, unknown> };
        const res = { setHeader() { return res; }, status(value: number) { out.status = value; return res; }, json(value: Record<string, unknown>) { out.body = value; return res; }, end() { return res; } };
        const headers = admin ? { 'x-admin-password': 'coast-landing-admin' } : who ? { 'x-player-token': token(who) } : {};
        await handler({ method: 'POST', body, query: {}, headers, socket: { remoteAddress: '127.4.9.8' } } as never, res as never);
        return out;
    }

    it('walks a clan from a held sector to a standing camp', async () => {
        assert.equal((await call({ action: 'status' })).status, 401);
        assert.equal((await call({ action: 'status' }, undefined, true)).status, 401, 'a Landing is a player\'s, never an admin\'s');
        await clan('Tidewatch', CREW);
        await take();
        const status = await call({ action: 'status' }, 'third');
        assert.deepEqual([status.status, status.body.clan, status.body.landing, (status.body.rules as { tiers: unknown[] }).tiers.length], [200, 'Tidewatch', null, 4]);

        assert.equal((await call({ action: 'found' }, 'third')).status, 403);
        assert.equal((await call({ action: 'found' }, 'founder')).status, 200);
        assert.equal((await call({ action: 'contribute', itemId: 'quest-woundroot', count: 1, requestId: 'landing-request-0060' }, 'third')).status, 400);
        for (const [index, itemId] of [HERB, FIBER, SAND].entries()) {
            const given = await call({ action: 'contribute', itemId, count: 20, requestId: `landing-request-006${index + 1}` }, ['second', 'third', 'fourth'][index]);
            assert.equal(given.status, 200, JSON.stringify(given.body));
            assert.ok(given.body.character && typeof given.body._saveVersion === 'number', 'the reply carries the new save');
        }
        assert.equal((await call({ action: 'raise' }, 'third')).status, 403);
        const raised = await call({ action: 'raise' }, 'founder');
        assert.deepEqual([raised.status, (raised.body.landing as CoastLanding).tier], [200, 1]);
    });

    it('is closed to Cinderhold accounts, and its saga can be finished by an admin', () => {
        assert.ok(NPC_BLOCKED_ROUTES.includes('/coast/landing'));
        assert.equal(SAVE_DEBIT_SAGAS[COAST_LANDING_SAGA.kind], COAST_LANDING_SAGA);
    });
});

// ── Works ────────────────────────────────────────────────────────────────────

/** Mark quest lines as finished on one player's save, as their claims would have. */
async function finished(who: string, ...questIds: string[]) {
    const save = (await kv.get<Record<string, unknown>>(`save:${who}`))!;
    const lines = save.questLines as { done: Record<string, unknown> };
    await kv.set(`save:${who}`, { ...save, questLines: { ...lines, done: { ...lines.done, ...Object.fromEntries(questIds.map(id => [id, { at: 2, marks: 1 }])) } } });
}

describe('works', () => {
    it('are opened one by one by Raise the Clan Gate, and each costs less than the tier it needs', () => {
        assert.deepEqual(COAST_LANDING_WORKS.map(work => [work.id, work.quest, work.minTier]), [['store-shed', 'clan-gate-1', 1], ['drying-racks', 'clan-gate-2', 2], ['watch-fire', 'clan-gate-3', 3]]);
        for (const work of COAST_LANDING_WORKS) {
            const quest = QUEST_LINES[work.quest];
            assert.deepEqual([quest?.title, quest?.gate.clan], [work.questTitle, true], work.id);
            const tier = COAST_LANDING_TIERS[work.minTier].cost as Record<string, number>;
            for (const [itemId, units] of Object.entries(work.cost)) {
                assert.ok((COAST_LANDING_MATERIALS as readonly string[]).includes(itemId), `${work.id}: ${itemId}`);
                if (itemId.startsWith('quest-')) assert.equal(isKeptQuestMaterial(itemId), true, `${work.id}: ${itemId} must come from a site that stays open`);
                if (tier[itemId] !== undefined) assert.ok(units < tier[itemId], `${work.id}: ${itemId}`);
            }
            const total = (cost: Record<string, number | undefined>) => Object.values(cost).reduce((sum: number, units) => sum + (units ?? 0), 0);
            assert.ok(total(work.cost) < total(tier), `${work.id} costs less than a ${COAST_LANDING_TIERS[work.minTier].name}`);
        }
        assert.equal(coastLandingWork('a-wall'), undefined);
    });

    it('give utility only: a larger weekly allowance, lighter upkeep, a longer warning', () => {
        const bare = landing({ tier: 3 });
        assert.deepEqual([coastLandingMemberCap(bare), coastLandingUpkeep(bare), coastLandingExtraNoticeMs(bare)], [40, 30, 0]);
        assert.equal(coastLandingMemberCap(landing({ works: ['store-shed'] })), 60);
        // A quarter off, rounded up so it is never more than a quarter.
        assert.deepEqual([1, 2, 3].map(tier => coastLandingUpkeep(landing({ tier, works: ['drying-racks'] }))), [5, 12, 23]);
        assert.equal(coastLandingExtraNoticeMs(landing({ tier: 3, works: ['watch-fire'] })), 12 * HOUR);
        assert.equal(COAST_LANDING_WORK_EFFECTS.watchFireNoticeMs, 12 * HOUR);
        // A dormant Landing's fire is out; a fallen Landing has nothing.
        assert.equal(coastLandingExtraNoticeMs(landing({ tier: 3, works: ['watch-fire'], status: 'dormant' })), 0);
        assert.deepEqual([coastLandingMemberCap(landing({ works: ['store-shed'], status: 'destroyed' })), coastLandingMemberCap(null)], [40, 40]);

        // The racks are what upkeep is really settled with.
        const week = coastWeek(T0);
        const hall = landing({ tier: 2, works: ['drying-racks'], stores: { [HERB]: 12 } });
        assert.deepEqual(settleCoastLandingUpkeep(hall, week + 2, T0 + 14 * DAY).landing.stores, { [HERB]: 0 });
        assert.equal(settleCoastLandingUpkeep({ ...hall, works: [] }, week + 2, T0 + 14 * DAY).landing.status, 'dormant', 'without them twelve units do not pay fifteen');
    });

    it('say what stands in the way, and take their cost from the stores', () => {
        const shed = coastLandingWork('store-shed')!;
        assert.equal(coastLandingWorkBlock(landing({ tier: 0 }), shed), 'tier');
        assert.equal(coastLandingWorkBlock(landing({ tier: 1 }), shed), 'stores');
        const stocked = landing({ tier: 1, stores: { [HERB]: 15, [FIBER]: 20, [SAND]: 15 } });
        assert.equal(coastLandingWorkBlock(stocked, shed), null);
        assert.equal(coastLandingWorkBlock({ ...stocked, status: 'dormant' }, shed), 'dormant');
        assert.equal(coastLandingWorkBlock({ ...stocked, status: 'destroyed' }, shed), 'fallen');
        const built = buildCoastLandingWork(stocked, shed);
        assert.deepEqual([built.works, built.stores, built.tier], [['store-shed'], { [HERB]: 0, [FIBER]: 5, [SAND]: 0 }, 1]);
        assert.equal(coastLandingWorkBlock(built, shed), 'built');
    });

    it('are built by an officer who has finished the quest, and raise what a member may give', async () => {
        await clan('Tidewatch', CREW);
        await take();
        await foundCoastLanding({ playerName: 'founder', now: T0 + 80 * HOUR });
        await stock('camp');
        assert.equal((await raiseCoastLanding({ playerName: 'founder' })).ok, true);
        const build = async (who: string, workId: unknown) => (await buildCoastLandingWorkFor({ playerName: who, workId })) as { ok: boolean; error?: string; landing?: CoastLanding };

        assert.match(String((await build('founder', 'a-wall')).error), /not something a Landing can build/);
        assert.match(String((await build('third', 'store-shed')).error), /founder, leaders and officers/);
        // The quest is read from the officer's own save. A member's does not count for them.
        await finished('third', 'clan-gate-1');
        assert.match(String((await build('founder', 'store-shed')).error), /Finish Raise the Clan Gate I first/);
        await finished('founder', 'clan-gate-1');
        assert.match(String((await build('founder', 'store-shed')).error), /still needs 15 Field Herb, 15 Binding Fiber and 15 Iron Sand/);
        assert.match(String((await build('founder', 'drying-racks')).error), /Finish Raise the Clan Gate II first/);

        const before = await coastLandingView('founder', T0 + 80 * HOUR);
        assert.deepEqual(before.landing?.works.map(work => [work.id, work.built, work.block, work.canBuild]), [['store-shed', false, 'stores', false], ['drying-racks', false, 'tier', false], ['watch-fire', false, 'tier', false]]);
        assert.deepEqual(before.landing?.works.map(work => work.needsQuest ?? false), [false, true, true]);

        // Next week, so the givers have their allowance back.
        const later = T0 + 80 * HOUR + 7 * DAY;
        await stock('shed', later);
        assert.equal((await coastLandingView('founder', later)).landing?.works[0].canBuild, true);
        assert.equal((await coastLandingView('third', later)).landing?.works[0].canBuild, false, 'a plain member is shown it, and cannot build it');
        const built = await build('founder', 'store-shed');
        assert.deepEqual([built.ok, built.landing?.works, built.landing?.stores], [true, ['store-shed'], { [HERB]: 5, [FIBER]: 5, [SAND]: 5 }]);
        assert.match(String((await build('founder', 'store-shed')).error), /already stands/);

        // The allowance is now 60: a member who gave 20 this week can give 40 more, and no more.
        const view = await coastLandingView('second', later);
        assert.deepEqual([view.landing?.yours, view.landing?.works[0].built], [{ used: 20, cap: 60 }, true]);
        await give('second', FIBER, 20, 'landing-request-0201', later);
        await give('second', FIBER, 20, 'landing-request-0202', later);
        await assert.rejects(give('second', FIBER, 1, 'landing-request-0203', later), (error: unknown) => error instanceof SaveDebitRefusal && /0 of 60 left/.test(error.message));

        // The handler reaches it, for the signed-in player only.
        const handler = (await import('./landing.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
        const { issuePlayerToken } = await import('../_auth.js');
        const res = { statusCode: 200, body: {} as Record<string, unknown>, setHeader() { return this; }, status(code: number) { this.statusCode = code; return this; }, json(body: Record<string, unknown>) { this.body = body; return this; }, end() { return this; } };
        await handler({ method: 'POST', query: {}, headers: { 'x-player-token': issuePlayerToken('founder') }, socket: { remoteAddress: '127.4.9.9' }, body: { action: 'build', workId: 'store-shed' } } as never, res as never);
        assert.deepEqual([res.statusCode, /already stands/.test(String(res.body.error))], [409, true]);
    });

    it('fall with the Landing, and can be built again because the quest stays finished', async () => {
        await clan('Tidewatch', CREW);
        await take();
        await foundCoastLanding({ playerName: 'founder', now: T0 + 80 * HOUR });
        await finished('founder', 'clan-gate-1');
        const row = (await readCoastLanding('tidewatch'))!;
        await kv.set('coast:landing:tidewatch', { ...row, tier: 1, works: ['store-shed'] });
        assert.equal(await releaseCoastClaim(STRAND, 'test'), true);
        assert.equal((await readCoastLanding('tidewatch'))!.status, 'destroyed');
        // Taken again and staked again: a bare plot, with nothing built on it.
        await take(STRAND, T0 + 30 * DAY);
        await foundCoastLanding({ playerName: 'founder', now: T0 + 34 * DAY });
        assert.deepEqual([(await readCoastLanding('tidewatch'))!.works ?? [], (await coastLandingView('founder', T0 + 34 * DAY)).landing?.works[0].built], [[], false]);
    });
});

// ── The admin's tools ────────────────────────────────────────────────────────

describe('the admin tools', () => {
    const RIVALS = ['rival-1', 'rival-2', 'rival-3', 'rival-4', 'rival-5'];
    /** Tidewatch holds the Strand with a Landing on it; Rimewake is a second clan with the right to contest. */
    async function held() {
        await clan('Tidewatch', CREW);
        await take();
        await foundCoastLanding({ playerName: 'founder', now: T0 + 80 * HOUR });
        await clan('Rimewake', RIVALS);
    }
    const D = T0 + 300 * HOUR; // past the founding grace
    const declare = async (now = D) => (await declareCoastContest({ playerName: 'rival-1', sector: STRAND, now })) as { ok: boolean; error?: string; contest?: { id: string; declaredAt: number; opensAt: number; closesAt: number } };

    it('a lit Watch Fire makes a declaration on that ground open 12 hours later', async () => {
        await held();
        const row = (await readCoastLanding('tidewatch'))!;
        await kv.set('coast:landing:tidewatch', { ...row, tier: 3, works: ['watch-fire'] });
        const warned = (await declare()).contest!;
        assert.deepEqual([warned.opensAt - warned.declaredAt, warned.closesAt - warned.opensAt], [36 * HOUR, COAST_LAND.windowMs], 'a longer notice, and the same two days of fighting');

        // Called off by an admin: no holder changes, and no cooldown is left behind.
        const cancelled = await cancelCoastContest(STRAND, D + HOUR);
        assert.deepEqual([cancelled?.outcome, (await readCoastClaim(STRAND))?.clanSlug, await readCoastContest(STRAND), await cancelCoastContest(STRAND)], ['void', 'tidewatch', null, null]);

        // A dormant Landing's fire is out.
        await kv.set('coast:landing:tidewatch', { ...row, tier: 3, works: ['watch-fire'], status: 'dormant' });
        const unwarned = (await declare(D + 2 * HOUR)).contest!;
        assert.equal(unwarned.opensAt - unwarned.declaredAt, COAST_LAND.noticeMs);
    });

    it('a pause stops declaring, fighting and settling, and gives every contest its time back', async () => {
        await held();
        const posted = (await declare()).contest!;
        assert.equal(await readCoastLandPause(), null);
        const pause = await pauseCoastLand('  a fault in the garrison fight  ', D + 10 * HOUR);
        assert.deepEqual(pause, { at: D + 10 * HOUR, reason: 'a fault in the garrison fight' });
        assert.deepEqual(await pauseCoastLand('again', D + 11 * HOUR), pause, 'a second pause keeps the first clock');

        await clan('Saltmark', ['salt-1', 'salt-2', 'salt-3', 'salt-4', 'salt-5']);
        assert.match(String(((await declareCoastContest({ playerName: 'salt-1', sector: SEAM, now: D + 12 * HOUR })) as { error?: string }).error), /paused for now/);
        const rival = (await kv.get<Record<string, unknown>>('save:rival-1'))!;
        await assert.rejects(coastGarrisonFightStart('rival-1', rival, STRAND, posted.id, posted.opensAt + HOUR), /paused for now/);
        // Its time runs out on the clock, and nothing is settled.
        assert.deepEqual((await settleDueCoastLand(posted.closesAt + HOUR)).settled, []);
        assert.equal((await readCoastContest(STRAND))?.id, posted.id);

        // Lifted twenty hours after it began: the notice and the window both move twenty hours.
        const lifted = await resumeCoastLand(D + 30 * HOUR);
        assert.deepEqual(lifted, { resumed: true, pausedMs: 20 * HOUR, moved: [STRAND] });
        const after = (await readCoastContest(STRAND))!;
        assert.deepEqual([after.opensAt - posted.opensAt, after.closesAt - posted.closesAt], [20 * HOUR, 20 * HOUR]);
        assert.deepEqual([await readCoastLandPause(), await resumeCoastLand(D + 31 * HOUR)], [null, { resumed: false, pausedMs: 0, moved: [] }]);
        assert.equal(((await declareCoastContest({ playerName: 'salt-1', sector: SEAM, now: D + 31 * HOUR })) as { ok: boolean }).ok, true);

        // A window already open when the pause began keeps its start and gains the lost time at its end.
        await pauseCoastLand('second fault', after.opensAt + HOUR);
        await resumeCoastLand(after.opensAt + 6 * HOUR);
        const open = (await readCoastContest(STRAND))!;
        assert.deepEqual([open.opensAt, open.closesAt - after.closesAt], [after.opensAt, 5 * HOUR]);
    });

    it('a sector can be given to a clan, protected, and a Landing lost to a fault stood up again', async () => {
        await held();
        const landingBefore = (await readCoastLanding('tidewatch'))!;
        await kv.set('coast:landing:tidewatch', { ...landingBefore, tier: 2, works: ['store-shed'], stores: { [HERB]: 30 } });
        const epoch = (await readCoastClaim(STRAND))!.landingEpoch;

        assert.match(String(((await grantCoastClaim({ sector: STRAND, clanName: 'Nobody', now: D })) as { error?: string }).error), /No clan has that name/);
        assert.match(String(((await grantCoastClaim({ sector: 101, clanName: 'Rimewake', now: D })) as { error?: string }).error), /cannot be held/);
        assert.match(String(((await grantCoastClaim({ sector: STRAND, clanName: 'Tidewatch', now: D })) as { error?: string }).error), /already holds that ground/);
        // Never over a fight in progress.
        await declare();
        assert.match(String(((await grantCoastClaim({ sector: STRAND, clanName: 'Rimewake', now: D })) as { error?: string }).error), /Settle or cancel it first/);
        await cancelCoastContest(STRAND, D);

        // Given as a won contest would give it: the epoch rises and the old holder's Landing falls.
        const granted = (await grantCoastClaim({ sector: STRAND, clanName: 'Rimewake', now: D })) as { ok: true; claim: { clanSlug: string; landingEpoch: number; immuneUntil: number; contestId: string } };
        assert.deepEqual([granted.ok, granted.claim.clanSlug, granted.claim.landingEpoch, granted.claim.immuneUntil, granted.claim.contestId.startsWith('admin:')], [true, 'rimewake', epoch + 1, D + COAST_LAND.immunityMs, true]);
        const fallen = (await readCoastLanding('tidewatch'))!;
        assert.deepEqual([fallen.status, fallen.destroyedReason], ['destroyed', 'admin-granted']);
        assert.match(String(((await grantCoastClaim({ sector: SEAM, clanName: 'Rimewake', now: D })) as { error?: string }).error), /as much ground as a clan may/);

        // Protection can be set, and ended.
        assert.equal((await setCoastClaimImmunity(STRAND, D + 500 * HOUR))?.immuneUntil, D + 500 * HOUR);
        assert.equal((await setCoastClaimImmunity(STRAND, D))?.immuneUntil, D);
        assert.equal(await setCoastClaimImmunity(SEAM, D), null, 'the Unmoored hold it: there is nothing to protect');

        // A Landing stands on ground, so it comes back only once the clan holds some.
        assert.match(String(((await restoreCoastLanding('Tidewatch', D)) as { error?: string }).error), /holds no ground/);
        assert.match(String(((await restoreCoastLanding('Rimewake', D)) as { error?: string }).error), /never staked a Landing/);
        const seam = (await grantCoastClaim({ sector: SEAM, clanName: 'Tidewatch', now: D })) as { ok: true; claim: { landingEpoch: number } };
        const restored = (await restoreCoastLanding('Tidewatch', D + HOUR)) as { ok: true; landing: CoastLanding };
        assert.deepEqual(
            [restored.ok, restored.landing.status, restored.landing.sector, restored.landing.landingEpoch, restored.landing.tier, restored.landing.works, restored.landing.stores, restored.landing.destroyedAt],
            [true, 'active', SEAM, seam.claim.landingEpoch, 2, ['store-shed'], { [HERB]: 30 }, undefined],
        );
        assert.match(String(((await restoreCoastLanding('Tidewatch', D + HOUR)) as { error?: string }).error), /is standing/);
        // It is a real Landing again: its members can stock it.
        assert.equal((await give('second', FIBER, 5, 'landing-request-0301', D + 2 * HOUR)).landing.stores[FIBER], 5);
    });

    it('the route is for a full admin only, and writes what it did to the audit log', async () => {
        await held();
        process.env.ADMIN_PASSWORD = 'coast-admin-test-password';
        const handler = (await import('./admin.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
        const call = async (body: Record<string, unknown>, headers: Record<string, string> = { 'x-admin-password': 'coast-admin-test-password' }) => {
            const res = { statusCode: 200, body: {} as Record<string, unknown>, setHeader() { return this; }, status(code: number) { this.statusCode = code; return this; }, json(payload: Record<string, unknown>) { this.body = payload; return this; }, end() { return this; } };
            await handler({ method: 'POST', query: {}, headers, body, socket: { remoteAddress: '127.4.9.7' } } as never, res as never);
            return res;
        };
        const { issuePlayerToken } = await import('../_auth.js');
        assert.equal((await call({ action: 'overview' }, { 'x-player-token': issuePlayerToken('founder')! })).statusCode, 403, 'a signed-in player is not an admin');
        assert.equal((await call({ action: 'overview' }, {})).statusCode, 403);

        const overview = await call({ action: 'overview' });
        assert.equal(overview.statusCode, 200, JSON.stringify(overview.body));
        const sectors = overview.body.sectors as Array<{ sector: number; holder: { clan: string } | null }>;
        const landings = overview.body.landings as Array<{ clanSlug: string; sector: number; status: string; tierName: string }>;
        assert.deepEqual([overview.body.paused, sectors.find(row => row.sector === STRAND)?.holder?.clan, landings.map(row => [row.clanSlug, row.sector, row.status, row.tierName])], [null, 'Tidewatch', [['tidewatch', STRAND, 'active', 'Staked Plot']]]);

        assert.equal((await call({ action: 'pause' })).statusCode, 400, 'a pause needs its reason');
        assert.deepEqual([(await call({ action: 'pause', reason: 'test' })).statusCode, !!(await readCoastLandPause())], [200, true]);
        assert.deepEqual([(await call({ action: 'resume' })).body.resumed, await readCoastLandPause()], [true, null]);
        assert.equal((await call({ action: 'set-immunity', sector: STRAND, hours: -1 })).statusCode, 400);
        assert.equal((await call({ action: 'set-immunity', sector: SEAM, hours: 5 })).statusCode, 404);
        assert.equal((await call({ action: 'cancel-contest', sector: STRAND })).statusCode, 404);
        assert.equal((await call({ action: 'grant-claim', sector: STRAND })).statusCode, 400);
        assert.equal((await call({ action: 'restore-landing', clan: 'Tidewatch' })).statusCode, 409);
        assert.equal((await call({ action: 'release-claim', sector: STRAND })).body.released, true);
        assert.equal(await readCoastClaim(STRAND), null);

        const { readAudit } = await import('../_audit.js');
        const actions = (await readAudit('sector')).map(entry => entry.action);
        for (const action of ['coast-land.pause', 'coast-land.resume', 'coast-land.release-claim']) assert.ok(actions.includes(action), action);
    });

    // What the audit of 2026-11-20 found in the pause: each of these was wrong before it.
    it('under a pause nothing scores, every clock stands still, and no Landing is charged', async () => {
        await held();
        const posted = (await declare()).contest!;
        const phaseOf = async (now: number) => (await coastLandViews(now)).find(row => row.sector === STRAND)?.contest?.phase;
        assert.equal(await phaseOf(posted.opensAt + HOUR), 'open', 'with no pause the clock is the real one');

        // Paused ten hours in, while the contest is still only posted.
        await pauseCoastLand('incident', D + 10 * HOUR);
        // The contest reads as posted for as long as the pause lasts, however late it gets.
        assert.deepEqual([await phaseOf(posted.opensAt + HOUR), await phaseOf(posted.closesAt + 50 * HOUR)], ['posted', 'posted']);
        // A fight that began before the pause and ends inside it scores nothing.
        const late = await recordCoastGarrisonWin({ playerName: 'rival-1', sector: STRAND, contestId: posted.id, proofId: 'fight-ended-in-the-pause', now: posted.opensAt + HOUR });
        assert.deepEqual([late.counted, late.reason, (await readCoastContest(STRAND))?.score], [false, 'paused', 0]);

        // No Landing is charged upkeep, however many weeks pass.
        const before = (await readCoastLanding('tidewatch'))!;
        await kv.set('coast:landing:tidewatch', { ...before, tier: 1, stores: {} });
        const tick = await runCoastLandTick(D + 60 * DAY);
        const after = (await readCoastLanding('tidewatch'))!;
        assert.deepEqual([tick.dormant, tick.fallen, after.status, after.dormantWeeks, (await readCoastClaim(STRAND))?.clanSlug], [[], [], 'active', 0, 'tidewatch']);

        // Still posted on its stopped clock, so it can still be taken back.
        assert.equal(((await withdrawCoastContest({ playerName: 'rival-1', sector: STRAND, now: posted.closesAt + HOUR })) as { ok: boolean }).ok, true);
    });

    it('lifting a pause moves each contest once, even when the first attempt stopped partway', async () => {
        await held();
        const posted = (await declare()).contest!;
        const pause = await pauseCoastLand('incident', D + 10 * HOUR);
        // A first attempt moved this contest by 5 hours and then failed on a busy lock, so the pause row is still there.
        const row = (await readCoastContest(STRAND))!;
        await kv.set('coast:contest:' + STRAND, { ...row, opensAt: row.opensAt + 5 * HOUR, closesAt: row.closesAt + 5 * HOUR, resumedPauseAt: pause.at });
        const again = await resumeCoastLand(D + 30 * HOUR);
        const after = (await readCoastContest(STRAND))!;
        assert.deepEqual([again.resumed, again.moved, after.opensAt - posted.opensAt, after.closesAt - posted.closesAt], [true, [], 5 * HOUR, 5 * HOUR], 'not moved a second time');
        // A later pause is a new one, and moves it again. By then the fighting has
        // opened, so its start stays put and the two lost hours go on the end.
        await pauseCoastLand('second incident', D + 31 * HOUR);
        assert.deepEqual((await resumeCoastLand(D + 33 * HOUR)).moved, [STRAND]);
        const twice = (await readCoastContest(STRAND))!;
        assert.deepEqual([twice.opensAt - posted.opensAt, twice.closesAt - posted.closesAt], [5 * HOUR, 7 * HOUR]);
    });

    it('a fallen Landing is given back only to the clan that raised it, and says why it fell in plain words', async () => {
        await held();
        assert.equal(await releaseCoastClaim(STRAND, 'upkeep-unpaid'), true);
        const view = await coastLandingView('founder', D);
        assert.deepEqual([view.fallen?.cause, view.fallen?.reason, view.landing], ['upkeep-unpaid', 'Its upkeep went unpaid for two weeks.', null]);
        // A word a player was never meant to read is never shown as one.
        const row = (await readCoastLanding('tidewatch'))!;
        await kv.set('coast:landing:tidewatch', { ...row, destroyedReason: 'admin-granted' });
        assert.equal((await coastLandingView('founder', D)).fallen?.reason, 'The ground it stood on was given up.');

        // The row is kept under the clan's name. A later clan of that name is a different clan.
        await kv.set('coast:landing:tidewatch', { ...row, generation: 'an-earlier-tidewatch' });
        assert.equal(((await grantCoastClaim({ sector: STRAND, clanName: 'Tidewatch', now: D })) as { ok: boolean }).ok, true);
        assert.match(String(((await restoreCoastLanding('Tidewatch', D)) as { error?: string }).error), /earlier clan of the same name/);
        assert.equal((await readCoastLanding('tidewatch'))!.status, 'destroyed');
    });
});

describe('the clan town', () => {
    it('grows a tier at a time from facilities a village already has, and is shut when the Landing is not standing', () => {
        const town = (tier: number, status: 'active' | 'dormant' | 'destroyed' = 'active') => coastTownFacilities({ tier, status });
        assert.deepEqual(town(0), [], 'a staked plot is ground, not a town');
        assert.deepEqual(town(1), ['clan-hall', 'cafeteria']);
        assert.deepEqual(town(2), ['clan-hall', 'cafeteria', 'bank', 'shop', 'hospital']);
        assert.deepEqual(town(3), ['clan-hall', 'cafeteria', 'bank', 'shop', 'hospital', 'mission-hall', 'stat-training', 'jutsu-training']);
        // Every tier keeps what the one before it had, and one list is kept for each Landing tier.
        assert.equal(COAST_TOWN_FACILITIES.length, COAST_LANDING_TIERS.length);
        for (let tier = 1; tier < COAST_TOWN_FACILITIES.length; tier++) {
            assert.deepEqual(COAST_TOWN_FACILITIES[tier].slice(0, COAST_TOWN_FACILITIES[tier - 1].length), COAST_TOWN_FACILITIES[tier - 1]);
        }
        assert.deepEqual([town(3, 'dormant'), town(3, 'destroyed'), coastTownFacilities(null), town(99)], [[], [], [], COAST_TOWN_FACILITIES[3]]);
        // Nothing a village does not have: no facility is invented for a town.
        const village = ['battle-arena', 'story-hall', 'town-hall', 'bank', 'shop', 'clan-hall', 'hospital', 'mission-hall', 'cafeteria', 'tavern', 'stat-training', 'jutsu-training', 'world-map', 'home', 'pet-yard', 'card-hall'];
        for (const id of COAST_TOWN_FACILITIES.flat()) assert.ok(village.includes(id), id);
    });
});
