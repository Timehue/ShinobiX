import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import { anchorRyoPerMinute } from '../../shared/economy-anchor.js';
import { MAX_ROUNDS } from '../combat-core/constants.js';
import { ACCOUNT_AGE_MIN_MS as VANGUARD_AGE, levelGapMult } from './_vanguard-rewards.js';
import { ACCOUNT_AGE_MIN_MS, PVP_CREDIT_LEVEL_GAP_MAX } from './_pvp-anti-alt.js';
import type { PvpSession } from './session.js';
import { repeatKillWeight } from '../_legacy-track.js';
import {
    PVP_COUNTER_TTL_SECONDS,
    assignPvpCreditSlot,
    classifyPvpTerminal,
    evaluateCreditedPvpFight,
    PVP_ESTABLISHED_LEVEL,
    pvpAccountOldEnough,
    parseRankedWeightRow,
    previewSleeperKoCredit,
    pvpCreditAuraDust,
    pvpCreditRyo,
    pvpLossEngaged,
    pvpLossPurse,
    pvpPairCounterKey,
    pvpPairWeight,
    pvpPurseScale,
    pvpWinPurse,
    pvpWinShortMult,
    rankedPurseRyo,
    recordSleeperKoPairCredit,
    resolvePvpFightCredit,
    sealRankedWeightRow,
} from './_valid-fight.js';

const DIALS = ['PVP_PURSE_SCALE', 'PVP_LOSS_FRAC', 'PVP_MIN_ROUNDS', 'PVP_MIN_FIGHT_MS', 'PVP_SHORT_FIGHT_MULT', 'PVP_LOSER_MIN_AGE_MS', 'PVP_RANKED_PURSE'];
const saved = Object.fromEntries(DIALS.map((k) => [k, process.env[k]]));
afterEach(() => {
    for (const k of DIALS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});
const full = () => { process.env.PVP_PURSE_SCALE = '1'; };

const T0 = Date.UTC(2026, 9, 21, 12, 0, 0);
function fight(o: {
    round?: number; durationMs?: number; loserHp?: number; winnerHp?: number; fleedBy?: 'p1' | 'p2';
    continuous?: boolean; winnerStartHp?: number; maxHp?: number; level?: [number, number];
} = {}): PvpSession {
    const maxHp = o.maxHp ?? 1000;
    return {
        battleId: 'pvp-test-battle',
        winner: 'p1',
        status: 'done',
        round: o.round ?? 4,
        createdAt: T0,
        endedAt: T0 + (o.durationMs ?? 70_000),
        continuousVitals: o.continuous ?? false,
        ...(o.fleedBy ? { fleedBy: o.fleedBy } : {}),
        realFighters: { p1: true, p2: true },
        p1: { name: 'A', hp: o.winnerHp ?? 800, maxHp, character: { level: o.level?.[0] ?? 90, hp: o.winnerStartHp ?? maxHp, maxHp } },
        p2: { name: 'B', hp: o.loserHp ?? 0, maxHp, character: { level: o.level?.[1] ?? 90, hp: maxHp, maxHp } },
    } as unknown as PvpSession;
}

describe('purse (13.5 x A(lower level) x PVP_PURSE_SCALE)', () => {
    it('ships at the full purse by default (owner amendment A13: no env var needed to go live)', () => {
        delete process.env.PVP_PURSE_SCALE;
        assert.equal(pvpPurseScale(), 1);
        assert.equal(pvpWinPurse({ lMin: 90 }), 4050);
        assert.equal(pvpWinPurse({ lMin: 10 }), 810);
        assert.equal(pvpLossPurse({ lMin: 90 }), 1620);
    });
    it('the env dial is a down switch: 0.5 halves the purse', () => {
        process.env.PVP_PURSE_SCALE = '0.5';
        assert.equal(pvpPurseScale(), 0.5);
        assert.equal(pvpWinPurse({ lMin: 90 }), 2025);
        assert.equal(pvpWinPurse({ lMin: 10 }), 405);
        assert.equal(pvpLossPurse({ lMin: 90 }), 810);
    });
    it('pays the final table at scale 1', () => {
        full();
        assert.equal(anchorRyoPerMinute(1), 24);
        assert.deepEqual([10, 30, 50, 70, 90].map((l) => pvpWinPurse({ lMin: l })), [810, 1890, 2970, 4050, 4050]);
        assert.deepEqual([10, 30, 50, 90].map((l) => pvpLossPurse({ lMin: l })), [324, 756, 1188, 1620]);
        assert.equal(pvpLossPurse({ lMin: 11 }), 345);
        assert.equal(pvpWinPurse({ lMin: 90, lucky: true }), 4065, 'Lucky is +15 flat');
        assert.equal(pvpWinPurse({ lMin: 90, sector: 99 }), 5062, 'Death’s Gate 1.25x, floored');
        assert.equal(pvpWinPurse({ lMin: 90, sector: 99, stronghold: 'deathsgate' }), 6075, 'Obsidian 1.5x');
        assert.equal(pvpLossPurse({ lMin: 90, sector: 99, stronghold: 'deathsgate' }), 2430);
    });
    it('scale 0 is the kill switch: today’s 75 flat, the x2/x4 table, no loss pay', () => {
        process.env.PVP_PURSE_SCALE = '0';
        assert.equal(pvpWinPurse({ lMin: 90 }), 75);
        assert.equal(pvpWinPurse({ lMin: 90, lucky: true }), 90);
        assert.equal(pvpWinPurse({ lMin: 90, sector: 99, stronghold: 'deathsgate' }), 300);
        assert.equal(pvpLossPurse({ lMin: 90 }), 0);
    });
    it('never pairs the legacy x4 with the anchored purse', () => {
        process.env.PVP_PURSE_SCALE = '0.5';
        assert.equal(pvpWinPurse({ lMin: 90, sector: 99, stronghold: 'deathsgate' }), 3037);
        for (const scale of ['0.25', '0.5', '0.75', '1']) {
            process.env.PVP_PURSE_SCALE = scale;
            const purse = pvpWinPurse({ lMin: 100, sector: 99, stronghold: 'deathsgate' });
            assert.ok(purse <= 1.5 * 13.5 * Number(scale) * 300, `scale ${scale}: ${purse}`);
        }
    });
    it('a garbage or out-of-range dial falls back to the default', () => {
        process.env.PVP_PURSE_SCALE = 'lots';
        assert.equal(pvpPurseScale(), 1);
        process.env.PVP_PURSE_SCALE = '2';
        assert.equal(pvpPurseScale(), 1, 'the dial can never raise the purse past full');
        process.env.PVP_LOSS_FRAC = '0.9';
        assert.equal(pvpLossPurse({ lMin: 90 }), 1620);
    });
});

describe('pair weights', () => {
    it('are 1, 1, 0.5, 0.25 then 0, the same curve as the legacy repeat-kill track', () => {
        assert.deepEqual([1, 2, 3, 4, 5, 6].map(pvpPairWeight), [1, 1, 0.5, 0.25, 0, 0]);
        assert.deepEqual([1, 2, 3, 4, 5, 6].map(pvpPairWeight), [1, 2, 3, 4, 5, 6].map(repeatKillWeight));
        assert.equal(pvpPairWeight(0), 1, 'an invalid ordinal fails open');
    });
});

describe('classifyPvpTerminal', () => {
    it('reads KO, flee, AFK and round-cap from the sealed session', () => {
        assert.deepEqual(classifyPvpTerminal(fight({ round: 1, durationMs: 20_000 })), { kind: 'ko', completedRounds: 0, durationMs: 20_000, short: true });
        assert.equal(pvpWinShortMult(classifyPvpTerminal(fight({ round: 1, durationMs: 20_000 }))), 0.5);
        const flee = classifyPvpTerminal(fight({ round: 2, loserHp: 500, fleedBy: 'p2' }));
        assert.equal(flee.kind, 'flee');
        assert.equal(pvpWinShortMult(flee), 0);
        const afk = classifyPvpTerminal(fight({ round: 3, loserHp: 500 }));
        assert.equal(afk.kind, 'afk');
        assert.equal(pvpWinShortMult(afk), 0);
        assert.equal(pvpWinShortMult(classifyPvpTerminal(fight({ round: 4, durationMs: 70_000 }))), 1);
        const cap = classifyPvpTerminal(fight({ round: MAX_ROUNDS + 1, loserHp: 10 }));
        assert.equal(cap.kind, 'round-cap');
        assert.equal(pvpWinShortMult(cap), 1);
        assert.equal(classifyPvpTerminal(fight({ round: 4, durationMs: 59_999 })).short, true);
        const longFlee = classifyPvpTerminal(fight({ round: 10, loserHp: 500, fleedBy: 'p2' }));
        assert.equal(pvpWinShortMult(longFlee), 1, 'a flee after a real fight is a full win');
    });
    it('classifies from endedAt, never a later publication time', () => {
        const c = classifyPvpTerminal(fight({ round: 4, durationMs: 40_000 }), T0 + 600_000);
        assert.equal(c.durationMs, 40_000);
        assert.equal(pvpWinShortMult(c), 0.5);
    });
    it('a session with no round counter keeps full credit (pre-round rows, fixtures)', () => {
        const legacy = { ...fight(), round: undefined } as unknown as PvpSession;
        assert.equal(classifyPvpTerminal(legacy).short, false);
    });
    it('the floors are dials', () => {
        process.env.PVP_MIN_ROUNDS = '0';
        process.env.PVP_MIN_FIGHT_MS = '0';
        assert.equal(classifyPvpTerminal(fight({ round: 1, durationMs: 1 })).short, false);
    });
});

describe('loss engagement', () => {
    it('needs 15% of the winner’s max HP dealt in a full-length KO', () => {
        assert.equal(pvpLossEngaged(fight({ winnerHp: 860 }), classifyPvpTerminal(fight({ winnerHp: 860 }))), false);
        assert.equal(pvpLossEngaged(fight({ winnerHp: 850 }), classifyPvpTerminal(fight({ winnerHp: 850 }))), true);
        const fled = fight({ round: 10, loserHp: 500, winnerHp: 100, fleedBy: 'p2' });
        assert.equal(pvpLossEngaged(fled, classifyPvpTerminal(fled)), false);
        const quick = fight({ round: 2, winnerHp: 100 });
        assert.equal(pvpLossEngaged(quick, classifyPvpTerminal(quick)), false);
    });
    it('measures from the winner’s sealed start HP in continuous-vitals fights', () => {
        const hurtUntouched = fight({ continuous: true, winnerStartHp: 500, winnerHp: 500 });
        assert.equal(pvpLossEngaged(hurtUntouched, classifyPvpTerminal(hurtUntouched)), false, 'arriving hurt is not damage');
        const hurtThenHit = fight({ continuous: true, winnerStartHp: 500, winnerHp: 350 });
        assert.equal(pvpLossEngaged(hurtThenHit, classifyPvpTerminal(hurtThenHit)), true);
    });
});

describe('credited-fight gate', () => {
    it('zeroes a >20-level stomp and a loser under 72 h old (missing createdAt passes)', () => {
        assert.deepEqual(evaluateCreditedPvpFight({ winnerLevel: 91, loserLevel: 70, loserCreatedAt: 1, terminalAt: T0 }), { credited: false, reason: 'level-gap' });
        assert.deepEqual(evaluateCreditedPvpFight({ winnerLevel: 90, loserLevel: 70, loserCreatedAt: 1, terminalAt: T0 }), { credited: true });
        assert.deepEqual(evaluateCreditedPvpFight({ winnerLevel: 19, loserLevel: 19, loserCreatedAt: T0 - 71 * 3_600_000, terminalAt: T0 }), { credited: false, reason: 'too-young' });
        assert.deepEqual(evaluateCreditedPvpFight({ winnerLevel: 90, loserLevel: 90, loserCreatedAt: undefined, terminalAt: T0 }), { credited: true });
        process.env.PVP_LOSER_MIN_AGE_MS = '0';
        assert.equal(evaluateCreditedPvpFight({ winnerLevel: 19, loserLevel: 19, loserCreatedAt: T0 - 1, terminalAt: T0 }).credited, true, 'emergency age dial');
        delete process.env.PVP_LOSER_MIN_AGE_MS;
    });
    it('treats an account at PVP_ESTABLISHED_LEVEL as established, so a reset week pays with no env change', () => {
        const fresh = T0 - 3_600_000;
        assert.equal(PVP_ESTABLISHED_LEVEL, 20);
        assert.deepEqual(evaluateCreditedPvpFight({ winnerLevel: 20, loserLevel: 20, loserCreatedAt: fresh, terminalAt: T0 }), { credited: true });
        assert.deepEqual(evaluateCreditedPvpFight({ winnerLevel: 25, loserLevel: 19, loserCreatedAt: fresh, terminalAt: T0 }), { credited: false, reason: 'too-young' });
        assert.equal(pvpAccountOldEnough(fresh, T0, 20), true);
        assert.equal(pvpAccountOldEnough(fresh, T0, 19), false);
        assert.equal(pvpAccountOldEnough(fresh, T0), false, 'no level given: the age floor alone decides');
    });
    it('shares one source of truth with the Vanguard seal rules', () => {
        assert.equal(VANGUARD_AGE, ACCOUNT_AGE_MIN_MS);
        assert.equal(levelGapMult(PVP_CREDIT_LEVEL_GAP_MAX + 30, 30), 0.5);
        assert.equal(levelGapMult(PVP_CREDIT_LEVEL_GAP_MAX + 31, 30), 0);
    });
});

describe('credit slots', () => {
    it('assigns once per fight, shares one counter per unordered pair, and fails open', async () => {
        const store = _makeMemoryKv();
        const counterKey = pvpPairCounterKey('alpha', 'beta', '2026-10-21');
        assert.equal(counterKey, pvpPairCounterKey('beta', 'alpha', '2026-10-21'));
        const first = await assignPvpCreditSlot(store, { slotKey: 'pvp:pairslot:f1', counterKey });
        const replay = await assignPvpCreditSlot(store, { slotKey: 'pvp:pairslot:f1', counterKey });
        const second = await assignPvpCreditSlot(store, { slotKey: 'pvp:pairslot:f2', counterKey: pvpPairCounterKey('beta', 'alpha', '2026-10-21') });
        assert.deepEqual([first, replay, second], [1, 1, 2]);
        assert.equal(await store.get(counterKey), 2);
        // A racing helper's stored slot wins over its own increment.
        await store.set('pvp:pairslot:f3', 7);
        assert.equal(await assignPvpCreditSlot(store, { slotKey: 'pvp:pairslot:f3', counterKey }), 7);
        const broken = { get: async () => { throw new Error('down'); }, set: async () => 'OK' as const, incr: async () => 1 };
        assert.equal(await assignPvpCreditSlot(broken, { slotKey: 'x', counterKey: 'y' }), 1);
        assert.ok(PVP_COUNTER_TTL_SECONDS >= 74 * 3600);
    });
});

describe('resolvePvpFightCredit', () => {
    it('prices alternating winners in one pair from one counter: 1, 1, 0.5, 0.25, 0', async () => {
        full();
        const store = _makeMemoryKv();
        const factors: number[] = [];
        for (let i = 0; i < 5; i += 1) {
            const winnerSlug = i % 2 === 0 ? 'alpha' : 'beta';
            const loserSlug = i % 2 === 0 ? 'beta' : 'alpha';
            const credit = await resolvePvpFightCredit(store, {
                session: { ...fight(), battleId: `pvp-alt-${i}` } as PvpSession,
                battleId: `pvp-alt-${i}`, winnerSlug, loserSlug, terminalAt: T0 + 70_000, role: 'win',
            });
            factors.push(credit.factor);
            assert.equal(pvpCreditRyo(credit, { role: 'win' }), Math.floor(4050 * credit.factor));
        }
        assert.deepEqual(factors, [1, 1, 0.5, 0.25, 0]);
    });
    it('an uncredited fight takes no slot and pays nothing', async () => {
        const store = _makeMemoryKv();
        const credit = await resolvePvpFightCredit(store, {
            session: fight({ level: [91, 70] }), battleId: 'pvp-stomp', winnerSlug: 'alpha', loserSlug: 'beta', terminalAt: T0 + 70_000, role: 'win',
        });
        assert.equal(credit.credited, false);
        assert.equal(credit.reason, 'level-gap');
        assert.equal(pvpCreditRyo(credit, { role: 'win' }), 0);
        assert.equal(pvpCreditAuraDust(credit), 0);
        assert.equal(await store.get(pvpPairCounterKey('alpha', 'beta', '2026-10-21')), null);
    });
    it('a short flee win still counts against the pair but pays no ryo or dust', async () => {
        const store = _makeMemoryKv();
        const credit = await resolvePvpFightCredit(store, {
            session: fight({ round: 1, loserHp: 900, fleedBy: 'p2', durationMs: 15_000 }), battleId: 'pvp-flee', winnerSlug: 'alpha', loserSlug: 'beta', terminalAt: T0 + 15_000, role: 'win',
        });
        assert.equal(credit.pairOrdinal, 1);
        assert.equal(credit.factor, 0);
        assert.equal(pvpCreditAuraDust(credit), 0);
        const shortKo = await resolvePvpFightCredit(store, {
            session: fight({ round: 1, durationMs: 20_000 }), battleId: 'pvp-short-ko', winnerSlug: 'alpha', loserSlug: 'beta', terminalAt: T0 + 20_000, role: 'win',
        });
        assert.equal(pvpCreditAuraDust(shortKo), 3, 'floor(6 x 0.5)');
    });
    it('loss pay needs an engaged loser and a winner past the age floor', async () => {
        full();
        const store = _makeMemoryKv();
        const engaged = await resolvePvpFightCredit(store, {
            session: fight({ round: 10, winnerHp: 800 }), battleId: 'pvp-loss-1', winnerSlug: 'alpha', loserSlug: 'beta', terminalAt: T0 + 70_000, role: 'loss',
        });
        assert.equal(pvpCreditRyo(engaged, { role: 'loss' }), 1620);
        const freshWinner = await resolvePvpFightCredit(store, {
            session: fight({ round: 10, winnerHp: 800, level: [19, 19] }), battleId: 'pvp-loss-2', winnerSlug: 'alpha', loserSlug: 'gamma',
            winnerChar: { createdAt: T0 - 71 * 3_600_000 }, terminalAt: T0 + 70_000, role: 'loss',
        });
        assert.equal(pvpCreditRyo(freshWinner, { role: 'loss' }), 0, 'a main cannot farm loss pay from fresh alts');
        const establishedWinner = await resolvePvpFightCredit(store, {
            session: fight({ round: 10, winnerHp: 800, level: [20, 20] }), battleId: 'pvp-loss-3', winnerSlug: 'alpha', loserSlug: 'delta',
            winnerChar: { createdAt: T0 - 71 * 3_600_000 }, terminalAt: T0 + 70_000, role: 'loss',
        });
        assert.ok(pvpCreditRyo(establishedWinner, { role: 'loss' }) > 0, 'a fresh account at L20 is established');
    });
});

describe('sleeper KO', () => {
    it('pays a quarter of the purse inside the pair weights, counted after commit', async () => {
        delete process.env.PVP_PURSE_SCALE;
        const store = _makeMemoryKv();
        const base = { attackerSlug: 'stalker', targetSlug: 'prey', attackerLevel: 90, targetLevel: 90, targetCreatedAt: undefined, rewardEligible: true, now: T0 };
        const ryo: number[] = [];
        for (let i = 0; i < 3; i += 1) {
            const preview = await previewSleeperKoCredit(store, base);
            ryo.push(preview.ryo);
            await recordSleeperKoPairCredit(store, base);
        }
        assert.deepEqual(ryo, [1012, 1012, 506]);
        assert.equal((await previewSleeperKoCredit(store, { ...base, attackerLevel: 19, targetLevel: 19, targetCreatedAt: T0 - 3_600_000 })).ryo, 0, 'a fresh target below L20 pays nothing');
        assert.ok((await previewSleeperKoCredit(_makeMemoryKv(), { ...base, targetCreatedAt: T0 - 3_600_000 })).ryo > 0, 'a fresh L90 target is established');
        process.env.PVP_PURSE_SCALE = '0';
        assert.equal((await previewSleeperKoCredit(_makeMemoryKv(), base)).ryo, 18, 'floor(0.25 x 75) on the legacy purse');
    });
});

describe('ranked weight row', () => {
    const ranked = (o: Parameters<typeof fight>[0] = {}) => ({ ...fight(o), rankedMatchId: 'player-ranked-x' }) as PvpSession;
    it('weighs short fights and the pair’s repeat results, write-once', async () => {
        const store = _makeMemoryKv();
        const flee = await sealRankedWeightRow(store, { session: ranked({ round: 1, loserHp: 900, fleedBy: 'p2', durationMs: 10_000 }), matchId: 'm-flee', a: 'alpha', b: 'beta', terminalAt: T0, ttlSeconds: 3600 });
        assert.equal(flee.weight, 0);
        const shortKo = await sealRankedWeightRow(store, { session: ranked({ round: 2, durationMs: 40_000 }), matchId: 'm-ko', a: 'alpha', b: 'beta', terminalAt: T0 + 600_000, ttlSeconds: 3600 });
        assert.equal(shortKo.shortMult, 0.5, 'publication time cannot lengthen a 40 s fight');
        assert.equal(shortKo.weight, 0.5);
        const weights = [];
        for (const id of ['m3', 'm4', 'm5']) {
            weights.push((await sealRankedWeightRow(store, { session: ranked(), matchId: id, a: 'alpha', b: 'beta', terminalAt: T0, ttlSeconds: 3600 })).weight);
        }
        assert.deepEqual(weights, [0.5, 0.25, 0], 'the pair’s 3rd, 4th and 5th results today');
        const again = await sealRankedWeightRow(store, { session: ranked({ round: 1, loserHp: 900, fleedBy: 'p2' }), matchId: 'm3', a: 'alpha', b: 'beta', terminalAt: T0, ttlSeconds: 3600 });
        assert.equal(again.weight, 0.5, 'a retry reuses the sealed row');
        assert.equal(parseRankedWeightRow({ v: 1, weight: 2 }), null);
    });
    it('a store without incr prices the match as the pair’s first', async () => {
        const memory = _makeMemoryKv();
        const noIncr = { get: memory.get.bind(memory), set: memory.set.bind(memory) };
        const row = await sealRankedWeightRow(noIncr, { session: ranked(), matchId: 'm-noincr', a: 'alpha', b: 'beta', terminalAt: T0, ttlSeconds: 3600 });
        assert.equal(row.weight, 1);
    });
    it('the ranked purse is off by default and shares the casual pair counter when on', async () => {
        const store = _makeMemoryKv();
        const off = await sealRankedWeightRow(store, { session: ranked(), matchId: 'm-off', a: 'alpha', b: 'beta', terminalAt: T0, ttlSeconds: 3600 });
        assert.equal(off.sharedPairOrdinal, undefined);
        assert.equal(rankedPurseRyo(off, { role: 'winner' }), 0);
        process.env.PVP_RANKED_PURSE = '1';
        full();
        const casual = { slotKey: 'pvp:pairslot:casual-1', counterKey: pvpPairCounterKey('alpha', 'beta', '2026-10-21') };
        await assignPvpCreditSlot(store, casual);
        const on = await sealRankedWeightRow(store, { session: { ...ranked(), battleId: 'pvp-ranked-on' } as PvpSession, matchId: 'm-on', a: 'alpha', b: 'beta', terminalAt: T0, ttlSeconds: 3600 });
        assert.equal(on.sharedPairOrdinal, 2, 'after one casual fight today');
        assert.equal(rankedPurseRyo(on, { role: 'winner' }), Math.floor(4050 * on.weight * 1));
        assert.equal(rankedPurseRyo({ ...on, engaged: true }, { role: 'loser' }), 1620);
        assert.equal(rankedPurseRyo({ ...on, engaged: false }, { role: 'loser' }), 0);
    });
});
