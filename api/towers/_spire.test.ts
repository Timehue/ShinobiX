import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    resolveAscensionModifiers, ascensionHpMult, ascensionDmgMult,
    SPIRE_MAX_TIER, HP_MULT_CAP, DMG_MULT_CAP, SPIRE_ENRAGE_CAP, type TowerModifier,
} from './_modifiers.js';
import {
    getSpireFloor, isValidSpireTier, spireBossForFloor, SPIRE_MILESTONE_FLOORS,
} from './_spire-catalog.js';
import {
    settleSpireForMember, isSpireRun, floorPaidKey, spireRewardKey, SPIRE_SHARDS_PER_TIER,
    type TowerKv, type TowerLock,
} from './_tower-store.js';
import { weekKey } from '../missions/_weekly-board.js';
import { buildTowerEncounter, type SquadMemberInput } from './_encounter.js';
import { getFloor } from './_floor-catalog.js';
import type { TowerSession, TowerActor } from './_tower-session.js';

// ─── resolveAscensionModifiers (pure single source of truth) ─────────────────
describe('Endless Spire — resolveAscensionModifiers', () => {
    it('is PURE: same inputs → deep-equal output', () => {
        const a = resolveAscensionModifiers(12, 'warden', 16);
        const b = resolveAscensionModifiers(12, 'warden', 16);
        assert.deepEqual(a, b);
    });
    it('hp/dmg mults follow the additive curve and CLAMP at the caps', () => {
        assert.equal(ascensionHpMult(1), 1.1);
        assert.equal(ascensionDmgMult(1), 1.06);
        assert.equal(resolveAscensionModifiers(10, 'sovereign', 20).hpMult, 2.0);
        // tier 20: hp 1+20*0.10 = 3.0 (== cap), dmg 1+20*0.06 = 2.2 (== cap)
        const t20 = resolveAscensionModifiers(20, 'sovereign', 20);
        assert.equal(t20.hpMult, HP_MULT_CAP);
        assert.equal(t20.dmgMult, DMG_MULT_CAP);
        // a hypothetical over-cap tier still clamps (clampTier caps at SPIRE_MAX_TIER)
        assert.equal(resolveAscensionModifiers(999, 'sovereign', 20).hpMult, HP_MULT_CAP);
    });
    it('always seals the spire enrage cap (2 stacks) and a >=1 round cap', () => {
        const s = resolveAscensionModifiers(5, 'sovereign', 20);
        assert.equal(s.enrageCap, SPIRE_ENRAGE_CAP);
        assert.equal(s.roundCap, 20);
        assert.ok(resolveAscensionModifiers(1, 'warden', 0).roundCap >= 1); // never 0/negative
    });
    it('folds a NUMBER weekly affix into the effective mults + manifest', () => {
        const affix: TowerModifier = { kind: 'dmg', value: 0.10, label: 'Blood Moon' };
        const base = resolveAscensionModifiers(5, 'sovereign', 20);
        const withAffix = resolveAscensionModifiers(5, 'sovereign', 20, affix);
        assert.equal(withAffix.dmgMult, Math.round((base.dmgMult + 0.10) * 100) / 100);
        assert.ok(withAffix.modifierStack.some(m => m.label === 'Blood Moon'));
        // affix never breaks the cap
        assert.ok(resolveAscensionModifiers(20, 'sovereign', 20, affix).dmgMult <= DMG_MULT_CAP);
    });
});

// ─── getSpireFloor / catalog ─────────────────────────────────────────────────
describe('Endless Spire — floor catalog', () => {
    it('builds exactly SPIRE_MAX_TIER floors; rejects out-of-range tiers', () => {
        assert.equal(getSpireFloor(0), undefined);
        assert.equal(getSpireFloor(SPIRE_MAX_TIER + 1), undefined);
        assert.equal(isValidSpireTier(0), false);
        assert.equal(isValidSpireTier(SPIRE_MAX_TIER), true);
        for (let t = 1; t <= SPIRE_MAX_TIER; t++) {
            const f = getSpireFloor(t)!;
            assert.ok(f, `floor ${t} exists`);
            assert.equal(f.id, t);
            assert.equal(f.objective, 'defeat-boss');
            assert.ok(f.boss, `floor ${t} has a boss`);
            assert.ok((f.boss!.hp ?? 0) > 0, `floor ${t} has authored HP`);
            assert.ok(f.boss!.aiId.startsWith('spire-'), 'uses an endgame spire boss template');
        }
    });
    it('Sovereign anchors every milestone floor; the trio cycles the rest', () => {
        for (const m of SPIRE_MILESTONE_FLOORS) assert.equal(spireBossForFloor(m), 'sovereign');
        assert.equal(spireBossForFloor(1), 'warden');
        assert.equal(spireBossForFloor(2), 'revenant');
        assert.equal(spireBossForFloor(3), 'ravager');
    });
    it('warden floors ship a guard pod (bulwark needs live guards); revenant floors cap regen', () => {
        const warden = getSpireFloor(1)!;
        assert.equal(warden.boss!.mechanic, 'bulwark');
        assert.ok(warden.enemies.some(p => p.aiId === 'spire-guard' && p.count > 0));
        const revenant = getSpireFloor(2)!;
        assert.equal(revenant.boss!.mechanic, 'regen');
        assert.ok((revenant.boss!.regenFlatCap ?? 0) > 0, 'regen boss is flat-capped');
    });
});

// ─── encounter sealing + story no-regression ─────────────────────────────────
function squadInput(slug: string): SquadMemberInput {
    return { id: 'sq-0', name: slug, ownerSlug: slug, ai: false, character: { maxHp: 10000, stats: {}, level: 100 } };
}
describe('Endless Spire — encounter sealing', () => {
    it('a spire build seals ascension onto the session + applies per-floor boss HP', () => {
        const tier = 20;
        const floor = getSpireFloor(tier)!;
        const seal = resolveAscensionModifiers(tier, 'sovereign', floor.roundBudget);
        const s = buildTowerEncounter({ floor, squad: [squadInput('hero')], runId: 'r1', seed: 1, partySize: 1, now: 0, ascension: seal, spireBossId: 'sovereign' });
        assert.equal(s.ascensionTier, tier);
        assert.equal(s.roundCap, floor.roundBudget);
        assert.equal(s.enrageCap, SPIRE_ENRAGE_CAP);
        assert.equal(s.dmgMult, seal.dmgMult);
        assert.ok(Array.isArray(s.modifierStack) && s.modifierStack.length > 0);
        assert.ok(isSpireRun(s));
        const boss = s.actors.find(a => a.id === 'boss')!;
        assert.equal(boss.maxHp, floor.boss!.hp); // per-floor authored HP, not the template hp
    });
    it('a STORY build has NO ascension fields (story runs unchanged)', () => {
        const story = getFloor(1)!;
        const s = buildTowerEncounter({ floor: story, squad: [squadInput('hero')], runId: 'r2', seed: 1, partySize: 4, now: 0 });
        assert.equal(s.ascensionTier, undefined);
        assert.equal(s.roundCap, undefined);
        assert.equal(s.enrageCap, undefined);
        assert.equal(s.dmgMult, undefined);
        assert.equal(isSpireRun(s), false);
    });
});

// ─── settleSpireForMember (best-tier-per-week, server-authoritative) ──────────
const NOW = 1_700_000_000_000;
const now = () => NOW;
function fakeKv(): TowerKv & { store: Map<string, unknown> } {
    const store = new Map<string, unknown>();
    return {
        store,
        async get<T>(key: string) { return (store.has(key) ? store.get(key) : null) as T | null; },
        async set(key, value, opts) { if (opts?.nx && store.has(key)) return null; store.set(key, value); return 'OK'; },
        async del(...keys: string[]) { let n = 0; for (const k of keys) if (store.delete(k)) n++; return n; },
        async incr(key: string) { const v = (Number(store.get(key)) || 0) + 1; store.set(key, v); return v; },
    };
}
const passLock: TowerLock = async (_t, fn) => fn();
function spireSquadActor(slug: string): TowerActor {
    return {
        id: 'sq-0', side: 'squad', name: slug, ownerSlug: slug, ai: false,
        hp: 900, maxHp: 10000, chakra: 0, maxChakra: 0, stamina: 0, maxStamina: 0,
        shield: 0, statuses: [], cooldowns: {}, pos: 0, character: {},
    };
}
function spireSession(runId: string, tier: number, slug: string): TowerSession {
    return {
        towerId: 'endless-spire', runId, floor: tier, seed: 1, partySize: 1, ascensionTier: tier, spireBossId: 'sovereign',
        map: { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors: [spireSquadActor(slug)],
        turnQueue: [], activeIndex: 0, round: 5, activeAp: 0, actionsThisTurn: 0,
        groundEffects: [], objectiveState: { kind: 'defeat-boss', completed: true, failed: false },
        phaseState: { pendingPhases: [], triggeredPhases: [] },
        status: 'done', winner: 'squad', recentMoveTokens: [], rewardSettlementState: 'pending',
        log: [], createdAt: 0, lastActionAt: 0,
    };
}
function seedSave(kv: TowerKv & { store: Map<string, unknown> }, slug: string, char: Record<string, unknown> = {}) {
    kv.store.set(`save:${slug}`, { character: { level: 100, xp: 0, ryo: 0, fateShards: 0, boneCharms: 0, maxHp: 10000, stats: {}, ...char } });
}
const charOf = (kv: TowerKv & { store: Map<string, unknown> }, slug: string) =>
    (kv.store.get(`save:${slug}`) as { character: Record<string, unknown> }).character;

describe('Endless Spire — settleSpireForMember', () => {
    it('pays 2 shards + unlocks the tier + sets the weekly best (first clear this week)', async () => {
        const kv = fakeKv(); seedSave(kv, 'hero');
        const r = await settleSpireForMember({ slug: 'hero', session: spireSession('run1', 8, 'hero') }, { kv, lock: passLock, now });
        assert.equal(r.paid, true);
        const c = charOf(kv, 'hero');
        assert.equal(c.fateShards, SPIRE_SHARDS_PER_TIER);
        assert.equal(c.battleTowerAscension, 8);           // unlock gate
        assert.equal(c.battleTowerSpireWeeklyBest, 8);     // leaderboard
        assert.equal(c.battleTowerSpireWeekKey, weekKey(NOW));
        assert.ok(kv.store.has(spireRewardKey('hero', weekKey(NOW), 8)));
        assert.ok(kv.store.has(floorPaidKey('run1', 8, 'hero')));
    });
    it('is idempotent per run (a second settle of the same run pays nothing)', async () => {
        const kv = fakeKv(); seedSave(kv, 'hero');
        const s = spireSession('run1', 8, 'hero');
        await settleSpireForMember({ slug: 'hero', session: s }, { kv, lock: passLock, now });
        const second = await settleSpireForMember({ slug: 'hero', session: s }, { kv, lock: passLock, now });
        assert.equal(second.paid, false);
        assert.equal(second.reason, 'already-paid');
        assert.equal(charOf(kv, 'hero').fateShards, SPIRE_SHARDS_PER_TIER); // not doubled
    });
    it('best-per-week: a DIFFERENT tier this week pays again; the receipt caps a repeat of the SAME tier', async () => {
        const kv = fakeKv(); seedSave(kv, 'hero');
        await settleSpireForMember({ slug: 'hero', session: spireSession('runA', 8, 'hero') }, { kv, lock: passLock, now });
        await settleSpireForMember({ slug: 'hero', session: spireSession('runB', 9, 'hero') }, { kv, lock: passLock, now });
        assert.equal(charOf(kv, 'hero').fateShards, SPIRE_SHARDS_PER_TIER * 2); // 8 + 9 both paid this week
        // re-clearing tier 8 in a NEW run this same week → reward receipt already exists → no shards,
        // but the run still settles (unlock/best are max()).
        const again = await settleSpireForMember({ slug: 'hero', session: spireSession('runC', 8, 'hero') }, { kv, lock: passLock, now });
        assert.equal(again.paid, true);
        assert.equal(charOf(kv, 'hero').fateShards, SPIRE_SHARDS_PER_TIER * 2); // unchanged — no double-pay for tier 8
    });
    it('reads the SEALED session tier; a non-spire (story) session is not paid here', async () => {
        const kv = fakeKv(); seedSave(kv, 'hero');
        const story = spireSession('run1', 8, 'hero');
        delete (story as { ascensionTier?: number }).ascensionTier; // now a story-shaped session
        const r = await settleSpireForMember({ slug: 'hero', session: story }, { kv, lock: passLock, now });
        assert.equal(r.paid, false);
        assert.equal(r.reason, 'not-spire');
    });
    it('weekly best RESETS when the reset-week rolls over', async () => {
        const kv = fakeKv();
        // pre-seed a stale weekly best from a previous week
        seedSave(kv, 'hero', { battleTowerSpireWeeklyBest: 15, battleTowerSpireWeekKey: 'w0', battleTowerAscension: 15 });
        await settleSpireForMember({ slug: 'hero', session: spireSession('run1', 3, 'hero') }, { kv, lock: passLock, now });
        const c = charOf(kv, 'hero');
        assert.equal(c.battleTowerSpireWeeklyBest, 3);       // reset to this week's clear, not max(15,3)
        assert.equal(c.battleTowerSpireWeekKey, weekKey(NOW));
        assert.equal(c.battleTowerAscension, 15);            // permanent unlock is NEVER reset (max)
    });
});
