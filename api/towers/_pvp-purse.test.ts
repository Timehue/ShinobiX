/**
 * Team Arena and tournament purse (2026-10 economy rebalance, owner amendment
 * A7): a won match pays each winning member 0.5 x A(lowest fighter's level)
 * per active minute, under the PvP valid-fight rules (amendment A4).
 *
 * The credit commits through mutatePlayerSave on the global in-memory KV
 * (chosen on first use, so setting the flag here is in time).
 */
import { after, beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kv } from '../_storage.js';
import { readTowerPvpMatch, writeTowerPvpMatch } from './_pvp-store.js';
import { drainBackgroundWork } from '../_background-work.js';
import { ECON_TXN_LIST_KEY } from '../_economy.js';
import { createTowerPvpMatch, type StoredTowerPvpMatch, type TowerPvpFighterSeed } from './_pvp-session.js';
import { settleTowerPvpPurse, towerPvpPurseReply } from './_pvp-purse.js';
import { publicActivityPurse } from '../_activity-purse.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type Json = Record<string, unknown>;
const NOW = Date.now();
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
let matchSeq = 0;

beforeEach(async () => {
    await drainBackgroundWork();
    for (const key of await kv.keys('*')) await kv.del(key);
});
after(drainBackgroundWork);

function fighter(slug: string, skill: number): TowerPvpFighterSeed {
    return {
        slug, displayName: slug.toUpperCase(), skill,
        character: {
            name: slug, level: 40, specialty: 'Ninjutsu', maxHp: 1_000, maxChakra: 100, maxStamina: 100,
            stats: { ninjutsuPower: 220, intelligence: 180, speed: 150, defense: 150 }, jutsu: [], pvpItems: [],
        },
    };
}

/** A finished 2v2 public-queue match: `rounds` completed, `minutes` long, amber won. */
function wonMatch(o: { rounds?: number; minutes?: number; binding?: StoredTowerPvpMatch['binding'] } = {}): StoredTowerPvpMatch {
    const match = createTowerPvpMatch({
        matchId: `tpvp-${String(++matchSeq).padStart(32, '0')}`,
        fighters: [fighter('alpha', 400), fighter('bravo', 300), fighter('charlie', 200), fighter('delta', 100)],
        seed: 7,
        now: NOW - (o.minutes ?? 5) * MINUTE,
    });
    if (o.binding) match.binding = o.binding;
    match.status = 'done';
    match.winner = 'amber';
    match.combat.status = 'done';
    match.combat.round = (o.rounds ?? 6) + 1;
    match.combat.terminalAt = NOW;
    return match;
}

async function seed(levels: Record<string, number>, createdAt = NOW - 10 * DAY) {
    for (const [slug, level] of Object.entries(levels)) {
        await kv.set(`save:${slug}`, { character: { name: slug, level, ryo: 0, createdAt } });
    }
}
const view = (purse: Awaited<ReturnType<typeof settleTowerPvpPurse>>) => (purse ? publicActivityPurse(purse) : purse);
const ryoOf = async (slug: string) => Number(((await kv.get<Json>(`save:${slug}`))!.character as Json).ryo);
const team = (match: StoredTowerPvpMatch, teamId: 'amber' | 'violet') => match.roster.filter((m) => m.teamId === teamId).map((m) => m.slug);

describe('Team Arena purse', { concurrency: false }, () => {
    it('pays each winner 0.5 x A(lowest level) per minute, and the losers nothing', async () => {
        await seed({ alpha: 40, bravo: 50, charlie: 60, delta: 70 });
        const match = wonMatch();
        // A(40) = 180; 5 minutes x 0.5 x 180 = 450.
        for (const slug of team(match, 'amber')) {
            assert.deepEqual(view(await settleTowerPvpPurse(match, slug)), { ryo: 450, minutes: 5 });
            assert.equal(await ryoOf(slug), 450);
        }
        for (const slug of team(match, 'violet')) {
            assert.equal((await settleTowerPvpPurse(match, slug))?.reason, 'not-a-winner');
            assert.equal(await ryoOf(slug), 0);
        }
    });

    it('a repeat settle answers with the purse and pays nothing more', async () => {
        await seed({ alpha: 40, bravo: 40, charlie: 40, delta: 40 });
        const match = wonMatch();
        const [winner] = team(match, 'amber');
        await settleTowerPvpPurse(match, winner!);
        const replay = await settleTowerPvpPurse(match, winner!);
        assert.deepEqual(view(replay), { ryo: 450, minutes: 5, reason: 'already-paid' });
        assert.equal(await ryoOf(winner!), 450);
        await drainBackgroundWork();
        const txns = ((await kv.get<Json[]>(ECON_TXN_LIST_KEY)) ?? []).filter((txn) => txn.source === 'arena.purse');
        assert.equal(txns.length, 1);
    });

    it('a short fight pays half, or nothing when the losing side forfeited', async () => {
        await seed({ alpha: 40, bravo: 40, charlie: 40, delta: 40 });
        const short = wonMatch({ rounds: 2 });
        assert.equal((await settleTowerPvpPurse(short, team(short, 'amber')[0]!))?.ryo, 225);
        const forfeited = wonMatch({ rounds: 2 });
        forfeited.afkStrikes[team(forfeited, 'violet')[0]!] = 2;
        assert.equal((await settleTowerPvpPurse(forfeited, team(forfeited, 'amber')[0]!))?.reason, 'nothing-earned');
        const unfought = wonMatch({ rounds: 0 });
        assert.equal((await settleTowerPvpPurse(unfought, team(unfought, 'amber')[0]!))?.reason, 'nothing-earned');
    });

    it('an opponent account under the PvP age floor pays nothing', async () => {
        await seed({ alpha: 15, bravo: 15, charlie: 15, delta: 15 });
        const match = wonMatch();
        const [young] = team(match, 'violet');
        await kv.set(`save:${young}`, { character: { name: young, level: 15, ryo: 0, createdAt: NOW - 60 * MINUTE } });
        assert.equal((await settleTowerPvpPurse(match, team(match, 'amber')[0]!))?.reason, 'too-young');
        // At L20 the same fresh account is established (a reset week pays with no env change).
        await kv.set(`save:${young}`, { character: { name: young, level: 20, ryo: 0, createdAt: NOW - 60 * MINUTE } });
        assert.notEqual((await settleTowerPvpPurse(match, team(match, 'amber')[0]!))?.reason, 'too-young');
    });

    it('a winner more than 20 levels above the strongest opponent is paid nothing', async () => {
        const match = wonMatch();
        const [stomper, partner] = team(match, 'amber');
        const [o1, o2] = team(match, 'violet');
        await seed({ [stomper!]: 90, [partner!]: 40, [o1!]: 60, [o2!]: 50 });
        assert.equal((await settleTowerPvpPurse(match, stomper!))?.reason, 'level-gap');
        assert.equal((await settleTowerPvpPurse(match, partner!))?.ryo, 450, 'the partner is not stomping');
    });

    it('the same four fighters are weighted 1 / 1 / 0.5 / 0.25 / 0 across a day', async () => {
        await seed({ alpha: 40, bravo: 40, charlie: 40, delta: 40 });
        const paid: number[] = [];
        for (let i = 0; i < 5; i++) {
            const match = wonMatch();
            paid.push((await settleTowerPvpPurse(match, team(match, 'amber')[0]!))!.ryo);
        }
        assert.deepEqual(paid, [450, 450, 225, 112, 0]);
    });

    it('caps the credited minutes per match', async () => {
        await seed({ alpha: 40, bravo: 40, charlie: 40, delta: 40 });
        const long = wonMatch({ minutes: 90 });
        assert.deepEqual(view(await settleTowerPvpPurse(long, team(long, 'amber')[0]!)), { ryo: 1_800, minutes: 20 });
    });

    it('tournament matches pay the same purse; clan-war and ranked bindings pay none here', async () => {
        await seed({ alpha: 40, bravo: 40, charlie: 40, delta: 40 });
        const tourney = wonMatch({ binding: { kind: 'tournament', eventId: 'e', bracketMatchId: 'b', endsAt: NOW + DAY, tieWinner: 'amber' } });
        assert.equal((await settleTowerPvpPurse(tourney, team(tourney, 'amber')[0]!))?.ryo, 450);
        const war = wonMatch({ binding: { kind: 'clan-war', warId: 'w', challengeId: 'c', fromClan: 'a', toClan: 'b' } });
        assert.equal(await settleTowerPvpPurse(war, team(war, 'amber')[0]!), null);
    });

    it('the route reply carries the purse and lifts the payee save beside it', async () => {
        await seed({ alpha: 40, bravo: 40, charlie: 40, delta: 40 });
        const match = wonMatch();
        const [winner] = team(match, 'amber');
        const reply = towerPvpPurseReply(await settleTowerPvpPurse(match, winner!));
        assert.deepEqual(reply.purse, { ryo: 450, minutes: 5 });
        assert.equal((reply.character as Json).ryo, 450, 'the fight screen adopts the new balance');
        assert.equal(typeof reply._saveVersion, 'number');
        assert.deepEqual(towerPvpPurseReply(null), {});
    });

    it('both route surfaces that own these bindings credit the purse after the acknowledgement', () => {
        const read = (rel: string) => readFileSync(join(process.cwd(), ...rel.split('/')), 'utf8');
        assert.match(read('api/towers/pvp-settle.ts'), /settleTowerPvpPurse\(result\.response\.match, slug\)/);
        assert.match(read('api/tournaments/event.ts'), /settleTowerPvpPurse\(purseFor\.match, playerId\)/);
        // The acknowledgement itself still writes no save.
        assert.doesNotMatch(read('api/towers/_pvp-lifecycle.ts'), /mutatePlayerSave|creditActivityPurse/);
    });

    it('the store stamps the first terminal write of a match and keeps it', async () => {
        const match = wonMatch();
        delete match.combat.terminalAt;
        match.updatedAt = NOW - MINUTE;
        await writeTowerPvpMatch(match);
        match.updatedAt = NOW;
        await writeTowerPvpMatch(match);
        assert.equal((await readTowerPvpMatch(match.matchId))?.combat.terminalAt, NOW - MINUTE);
    });

    it('a draw, an unfinished match or a match with no terminal stamp pays nothing', async () => {
        await seed({ alpha: 40, bravo: 40, charlie: 40, delta: 40 });
        const draw = wonMatch();
        draw.winner = 'draw';
        assert.equal((await settleTowerPvpPurse(draw, 'alpha'))?.reason, 'draw');
        const live = wonMatch();
        live.status = 'active';
        assert.equal((await settleTowerPvpPurse(live, 'alpha'))?.reason, 'not-done');
        const legacy = wonMatch();
        delete legacy.combat.terminalAt;
        assert.equal((await settleTowerPvpPurse(legacy, team(legacy, 'amber')[0]!))?.reason, 'no-terminal-time');
    });
});
