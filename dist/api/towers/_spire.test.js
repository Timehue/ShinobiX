"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _modifiers_js_1 = require("./_modifiers.js");
const _spire_catalog_js_1 = require("./_spire-catalog.js");
const _tower_store_js_1 = require("./_tower-store.js");
const _weekly_board_js_1 = require("../missions/_weekly-board.js");
const _encounter_js_1 = require("./_encounter.js");
const _engine_js_1 = require("./_engine.js");
const _sim_js_1 = require("./_sim.js");
const _floor_catalog_js_1 = require("./_floor-catalog.js");
// ─── resolveAscensionModifiers (pure single source of truth) ─────────────────
(0, node_test_1.describe)('Endless Spire — resolveAscensionModifiers', () => {
    (0, node_test_1.it)('is PURE: same inputs → deep-equal output', () => {
        const a = (0, _modifiers_js_1.resolveAscensionModifiers)(12, 'warden', 16);
        const b = (0, _modifiers_js_1.resolveAscensionModifiers)(12, 'warden', 16);
        node_assert_1.strict.deepEqual(a, b);
    });
    (0, node_test_1.it)('hp/dmg mults follow the additive curve and CLAMP at the caps', () => {
        node_assert_1.strict.equal((0, _modifiers_js_1.ascensionHpMult)(1), 1.1);
        node_assert_1.strict.equal((0, _modifiers_js_1.ascensionDmgMult)(1), 1.06);
        node_assert_1.strict.equal((0, _modifiers_js_1.resolveAscensionModifiers)(10, 'sovereign', 20).hpMult, 2.0);
        // tier 20: hp 1+20*0.10 = 3.0 (== cap), dmg 1+20*0.06 = 2.2 (== cap)
        const t20 = (0, _modifiers_js_1.resolveAscensionModifiers)(20, 'sovereign', 20);
        node_assert_1.strict.equal(t20.hpMult, _modifiers_js_1.HP_MULT_CAP);
        node_assert_1.strict.equal(t20.dmgMult, _modifiers_js_1.DMG_MULT_CAP);
        // a hypothetical over-cap tier still clamps (clampTier caps at SPIRE_MAX_TIER)
        node_assert_1.strict.equal((0, _modifiers_js_1.resolveAscensionModifiers)(999, 'sovereign', 20).hpMult, _modifiers_js_1.HP_MULT_CAP);
    });
    (0, node_test_1.it)('always seals the spire enrage cap (2 stacks) and a >=1 round cap', () => {
        const s = (0, _modifiers_js_1.resolveAscensionModifiers)(5, 'sovereign', 20);
        node_assert_1.strict.equal(s.enrageCap, _modifiers_js_1.SPIRE_ENRAGE_CAP);
        node_assert_1.strict.equal(s.roundCap, 20);
        node_assert_1.strict.ok((0, _modifiers_js_1.resolveAscensionModifiers)(1, 'warden', 0).roundCap >= 1); // never 0/negative
    });
    (0, node_test_1.it)('folds a NUMBER weekly affix into the effective mults + manifest', () => {
        const affix = { kind: 'dmg', value: 0.10, label: 'Blood Moon' };
        const base = (0, _modifiers_js_1.resolveAscensionModifiers)(5, 'sovereign', 20);
        const withAffix = (0, _modifiers_js_1.resolveAscensionModifiers)(5, 'sovereign', 20, affix);
        node_assert_1.strict.equal(withAffix.dmgMult, Math.round((base.dmgMult + 0.10) * 100) / 100);
        node_assert_1.strict.ok(withAffix.modifierStack.some(m => m.label === 'Blood Moon'));
        // affix never breaks the cap
        node_assert_1.strict.ok((0, _modifiers_js_1.resolveAscensionModifiers)(20, 'sovereign', 20, affix).dmgMult <= _modifiers_js_1.DMG_MULT_CAP);
    });
});
// ─── Weekly Blessing (rotating, player-favourable affix) ─────────────────────
(0, node_test_1.describe)('Endless Spire — weekly blessing', () => {
    (0, node_test_1.it)('is PURE + deterministic and cycles the pool by week index', () => {
        node_assert_1.strict.equal((0, _modifiers_js_1.weeklySpireBlessing)(3).id, (0, _modifiers_js_1.weeklySpireBlessing)(3).id);
        const n = _modifiers_js_1.SPIRE_WEEKLY_BLESSINGS.length;
        node_assert_1.strict.equal((0, _modifiers_js_1.weeklySpireBlessing)(0).id, (0, _modifiers_js_1.weeklySpireBlessing)(n).id); // wraps
        node_assert_1.strict.equal((0, _modifiers_js_1.weeklySpireBlessing)(-1).id, (0, _modifiers_js_1.weeklySpireBlessing)(n - 1).id); // negative-safe
        // every pool entry is reachable across n consecutive weeks
        const ids = new Set(Array.from({ length: n }, (_, w) => (0, _modifiers_js_1.weeklySpireBlessing)(w).id));
        node_assert_1.strict.equal(ids.size, n);
    });
    (0, node_test_1.it)('every blessing is a BOON (never punishes): more rounds or LESS enemy damage', () => {
        for (const b of _modifiers_js_1.SPIRE_WEEKLY_BLESSINGS) {
            if (b.modifier.kind === 'roundCap')
                node_assert_1.strict.ok(b.modifier.value > 0, `${b.id} roundCap boon`);
            else if (b.modifier.kind === 'dmg')
                node_assert_1.strict.ok(b.modifier.value < 0, `${b.id} dmg boon`);
            else
                node_assert_1.strict.fail(`${b.id} uses a non-boon kind ${b.modifier.kind}`);
            node_assert_1.strict.ok(b.name && b.blurb && b.icon, `${b.id} has display fields`);
        }
    });
    (0, node_test_1.it)('folds into the sealed run: a roundCap blessing adds time; a dmg blessing softens foes', () => {
        const floorRounds = 16;
        const roundBoon = _modifiers_js_1.SPIRE_WEEKLY_BLESSINGS.find(b => b.modifier.kind === 'roundCap');
        const withRound = (0, _modifiers_js_1.resolveAscensionModifiers)(20, 'sovereign', floorRounds, roundBoon.modifier);
        node_assert_1.strict.equal(withRound.roundCap, floorRounds + Math.floor(roundBoon.modifier.value));
        const dmgBoon = _modifiers_js_1.SPIRE_WEEKLY_BLESSINGS.find(b => b.modifier.kind === 'dmg');
        const base = (0, _modifiers_js_1.resolveAscensionModifiers)(20, 'sovereign', floorRounds);
        const withDmg = (0, _modifiers_js_1.resolveAscensionModifiers)(20, 'sovereign', floorRounds, dmgBoon.modifier);
        node_assert_1.strict.ok(withDmg.dmgMult < base.dmgMult, `dmg boon lowers dmgMult (${withDmg.dmgMult} < ${base.dmgMult})`);
        node_assert_1.strict.ok(withDmg.modifierStack.some(m => m.label.includes('Blessing')), 'blessing shown as a chip');
    });
});
// ─── getSpireFloor / catalog ─────────────────────────────────────────────────
(0, node_test_1.describe)('Endless Spire — floor catalog', () => {
    (0, node_test_1.it)('builds exactly SPIRE_MAX_TIER floors; rejects out-of-range tiers', () => {
        node_assert_1.strict.equal((0, _spire_catalog_js_1.getSpireFloor)(0), undefined);
        node_assert_1.strict.equal((0, _spire_catalog_js_1.getSpireFloor)(_modifiers_js_1.SPIRE_MAX_TIER + 1), undefined);
        node_assert_1.strict.equal((0, _spire_catalog_js_1.isValidSpireTier)(0), false);
        node_assert_1.strict.equal((0, _spire_catalog_js_1.isValidSpireTier)(_modifiers_js_1.SPIRE_MAX_TIER), true);
        for (let t = 1; t <= _modifiers_js_1.SPIRE_MAX_TIER; t++) {
            const f = (0, _spire_catalog_js_1.getSpireFloor)(t);
            node_assert_1.strict.ok(f, `floor ${t} exists`);
            node_assert_1.strict.equal(f.id, t);
            node_assert_1.strict.equal(f.objective, 'defeat-boss');
            node_assert_1.strict.ok(f.boss, `floor ${t} has a boss`);
            node_assert_1.strict.ok((f.boss.hp ?? 0) > 0, `floor ${t} has authored HP`);
            node_assert_1.strict.ok(f.boss.aiId.startsWith('spire-'), 'uses an endgame spire boss template');
        }
    });
    (0, node_test_1.it)('Sovereign anchors every milestone floor; the trio cycles the rest', () => {
        for (const m of _spire_catalog_js_1.SPIRE_MILESTONE_FLOORS)
            node_assert_1.strict.equal((0, _spire_catalog_js_1.spireBossForFloor)(m), 'sovereign');
        node_assert_1.strict.equal((0, _spire_catalog_js_1.spireBossForFloor)(1), 'warden');
        node_assert_1.strict.equal((0, _spire_catalog_js_1.spireBossForFloor)(2), 'revenant');
        node_assert_1.strict.equal((0, _spire_catalog_js_1.spireBossForFloor)(3), 'ravager');
    });
    (0, node_test_1.it)('warden floors ship a guard pod (bulwark needs live guards); revenant floors cap regen', () => {
        const warden = (0, _spire_catalog_js_1.getSpireFloor)(1);
        node_assert_1.strict.equal(warden.boss.mechanic, 'bulwark');
        node_assert_1.strict.ok(warden.enemies.some(p => p.aiId === 'spire-guard' && p.count > 0));
        const revenant = (0, _spire_catalog_js_1.getSpireFloor)(2);
        node_assert_1.strict.equal(revenant.boss.mechanic, 'regen');
        node_assert_1.strict.ok((revenant.boss.regenFlatCap ?? 0) > 0, 'regen boss is flat-capped');
    });
});
// ─── encounter sealing + story no-regression ─────────────────────────────────
function squadInput(slug) {
    return { id: 'sq-0', name: slug, ownerSlug: slug, ai: false, character: { maxHp: 10000, stats: {}, level: 100 } };
}
(0, node_test_1.describe)('Endless Spire — encounter sealing', () => {
    (0, node_test_1.it)('a spire build seals ascension onto the session + applies per-floor boss HP', () => {
        const tier = 20;
        const floor = (0, _spire_catalog_js_1.getSpireFloor)(tier);
        const seal = (0, _modifiers_js_1.resolveAscensionModifiers)(tier, 'sovereign', floor.roundBudget);
        const s = (0, _encounter_js_1.buildTowerEncounter)({ floor, squad: [squadInput('hero')], runId: 'r1', seed: 1, partySize: 1, now: 0, ascension: seal, spireBossId: 'sovereign' });
        node_assert_1.strict.equal(s.ascensionTier, tier);
        node_assert_1.strict.equal(s.roundCap, floor.roundBudget);
        node_assert_1.strict.equal(s.enrageCap, _modifiers_js_1.SPIRE_ENRAGE_CAP);
        node_assert_1.strict.equal(s.dmgMult, seal.dmgMult);
        node_assert_1.strict.ok(Array.isArray(s.modifierStack) && s.modifierStack.length > 0);
        node_assert_1.strict.ok((0, _tower_store_js_1.isSpireRun)(s));
        const boss = s.actors.find(a => a.id === 'boss');
        node_assert_1.strict.equal(boss.maxHp, floor.boss.hp); // per-floor authored HP, not the template hp
    });
    (0, node_test_1.it)('a STORY build has NO ascension fields (story runs unchanged)', () => {
        const story = (0, _floor_catalog_js_1.getFloor)(1);
        const s = (0, _encounter_js_1.buildTowerEncounter)({ floor: story, squad: [squadInput('hero')], runId: 'r2', seed: 1, partySize: 4, now: 0 });
        node_assert_1.strict.equal(s.ascensionTier, undefined);
        node_assert_1.strict.equal(s.roundCap, undefined);
        node_assert_1.strict.equal(s.enrageCap, undefined);
        node_assert_1.strict.equal(s.dmgMult, undefined);
        node_assert_1.strict.equal((0, _tower_store_js_1.isSpireRun)(s), false);
    });
});
// ─── real-engine smoke: a spire floor runs end-to-end through the new code paths ──
function endgameSquad(n) {
    const stats = {
        taijutsuOffense: 2500, taijutsuDefense: 2500, bukijutsuOffense: 2500, bukijutsuDefense: 2500,
        genjutsuOffense: 2500, genjutsuDefense: 2500, ninjutsuOffense: 2500, ninjutsuDefense: 2500,
        strength: 2500, speed: 2500, intelligence: 2500, willpower: 2500,
    };
    // one real 60-AP damage jutsu (range 4 so the AI can hit from a distance)
    const jutsu = [{ id: 'j-nuke', name: 'Spirit Bomb', effectPower: 46, ap: 60, range: 4, type: 'Ninjutsu' }];
    return Array.from({ length: n }, (_, i) => ({
        id: `sq-${i}`, name: `hero${i}`, ownerSlug: `hero${i}`, ai: true,
        character: { maxHp: 10000, maxChakra: 2000, maxStamina: 2000, level: 100, stats, jutsu },
    }));
}
(0, node_test_1.describe)('Endless Spire — real engine smoke run', () => {
    (0, node_test_1.it)('runs a spire floor to a terminal state, within the round cap, via the real engine', () => {
        const floor = (0, _spire_catalog_js_1.getSpireFloor)(1); // Warden (bulwark) + guard pod
        const seal = (0, _modifiers_js_1.resolveAscensionModifiers)(1, 'warden', floor.roundBudget);
        const s = (0, _encounter_js_1.buildTowerEncounter)({ floor, squad: endgameSquad(4), runId: 'rt', seed: 7, partySize: 4, now: 0, ascension: seal, spireBossId: 'warden' });
        const boss = s.actors.find(a => a.id === 'boss');
        node_assert_1.strict.equal(boss.maxHp, floor.boss.hp); // endgame per-floor HP applied
        node_assert_1.strict.ok(boss.character.armorRawDR != null); // endgame boss carries armor DR
        // Drive the deterministic engine to completion (auto-run, both sides AI).
        (0, _engine_js_1.runTowerFloor)(s, floor, (0, _sim_js_1.makeRng)(s.seed));
        node_assert_1.strict.equal(s.status, 'done'); // never wedges 'active'
        node_assert_1.strict.ok(s.winner === 'squad' || s.winner === 'enemy');
        // roundCap is the real deadline — the run must resolve at or before it (never MAX_ROUNDS).
        node_assert_1.strict.ok(s.round <= (s.roundCap ?? 25), `round ${s.round} <= cap ${s.roundCap}`);
    });
    (0, node_test_1.it)('a maxed 4-squad clears the intro floor (not a wall) and does real damage to the boss', () => {
        const floor = (0, _spire_catalog_js_1.getSpireFloor)(1);
        const seal = (0, _modifiers_js_1.resolveAscensionModifiers)(1, 'warden', floor.roundBudget);
        const s = (0, _encounter_js_1.buildTowerEncounter)({ floor, squad: endgameSquad(4), runId: 'rt2', seed: 3, partySize: 4, now: 0, ascension: seal, spireBossId: 'warden' });
        (0, _engine_js_1.runTowerFloor)(s, floor, (0, _sim_js_1.makeRng)(s.seed));
        // intro floor should be winnable by a maxed squad (sanity: not an accidental wall)
        node_assert_1.strict.equal(s.winner, 'squad');
        node_assert_1.strict.ok(s.round >= 2, 'not a 1-round faceroll of the intro boss');
    });
});
// ─── settleSpireForMember (best-tier-per-week, server-authoritative) ──────────
const NOW = 1_700_000_000_000;
const now = () => NOW;
function fakeKv() {
    const store = new Map();
    return {
        store,
        async get(key) { return (store.has(key) ? store.get(key) : null); },
        async set(key, value, opts) { if (opts?.nx && store.has(key))
            return null; store.set(key, value); return 'OK'; },
        async del(...keys) { let n = 0; for (const k of keys)
            if (store.delete(k))
                n++; return n; },
        async incr(key) { const v = (Number(store.get(key)) || 0) + 1; store.set(key, v); return v; },
    };
}
const passLock = async (_t, fn) => fn();
function spireSquadActor(slug) {
    return {
        id: 'sq-0', side: 'squad', name: slug, ownerSlug: slug, ai: false,
        hp: 900, maxHp: 10000, chakra: 0, maxChakra: 0, stamina: 0, maxStamina: 0,
        shield: 0, statuses: [], cooldowns: {}, pos: 0, character: {},
    };
}
function spireSession(runId, tier, slug) {
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
function seedSave(kv, slug, char = {}) {
    kv.store.set(`save:${slug}`, { character: { level: 100, xp: 0, ryo: 0, fateShards: 0, boneCharms: 0, maxHp: 10000, stats: {}, ...char } });
}
const charOf = (kv, slug) => kv.store.get(`save:${slug}`).character;
(0, node_test_1.describe)('Endless Spire — settleSpireForMember', () => {
    (0, node_test_1.it)('pays 2 shards + unlocks the tier + sets the weekly best (first clear this week)', async () => {
        const kv = fakeKv();
        seedSave(kv, 'hero');
        const r = await (0, _tower_store_js_1.settleSpireForMember)({ slug: 'hero', session: spireSession('run1', 8, 'hero') }, { kv, lock: passLock, now });
        node_assert_1.strict.equal(r.paid, true);
        const c = charOf(kv, 'hero');
        node_assert_1.strict.equal(c.fateShards, _tower_store_js_1.SPIRE_SHARDS_PER_TIER);
        node_assert_1.strict.equal(c.battleTowerAscension, 8); // unlock gate
        node_assert_1.strict.equal(c.battleTowerSpireWeeklyBest, 8); // leaderboard
        node_assert_1.strict.equal(c.battleTowerSpireWeekKey, (0, _weekly_board_js_1.weekKey)(NOW));
        node_assert_1.strict.ok(kv.store.has((0, _tower_store_js_1.spireRewardKey)('hero', (0, _weekly_board_js_1.weekKey)(NOW), 8)));
        node_assert_1.strict.ok(kv.store.has((0, _tower_store_js_1.floorPaidKey)('run1', 8, 'hero')));
    });
    (0, node_test_1.it)('is idempotent per run (a second settle of the same run pays nothing)', async () => {
        const kv = fakeKv();
        seedSave(kv, 'hero');
        const s = spireSession('run1', 8, 'hero');
        await (0, _tower_store_js_1.settleSpireForMember)({ slug: 'hero', session: s }, { kv, lock: passLock, now });
        const second = await (0, _tower_store_js_1.settleSpireForMember)({ slug: 'hero', session: s }, { kv, lock: passLock, now });
        node_assert_1.strict.equal(second.paid, false);
        node_assert_1.strict.equal(second.reason, 'already-paid');
        node_assert_1.strict.equal(charOf(kv, 'hero').fateShards, _tower_store_js_1.SPIRE_SHARDS_PER_TIER); // not doubled
    });
    (0, node_test_1.it)('best-per-week: a DIFFERENT tier this week pays again; the receipt caps a repeat of the SAME tier', async () => {
        const kv = fakeKv();
        seedSave(kv, 'hero');
        await (0, _tower_store_js_1.settleSpireForMember)({ slug: 'hero', session: spireSession('runA', 8, 'hero') }, { kv, lock: passLock, now });
        await (0, _tower_store_js_1.settleSpireForMember)({ slug: 'hero', session: spireSession('runB', 9, 'hero') }, { kv, lock: passLock, now });
        node_assert_1.strict.equal(charOf(kv, 'hero').fateShards, _tower_store_js_1.SPIRE_SHARDS_PER_TIER * 2); // 8 + 9 both paid this week
        // re-clearing tier 8 in a NEW run this same week → reward receipt already exists → no shards,
        // but the run still settles (unlock/best are max()).
        const again = await (0, _tower_store_js_1.settleSpireForMember)({ slug: 'hero', session: spireSession('runC', 8, 'hero') }, { kv, lock: passLock, now });
        node_assert_1.strict.equal(again.paid, true);
        node_assert_1.strict.equal(charOf(kv, 'hero').fateShards, _tower_store_js_1.SPIRE_SHARDS_PER_TIER * 2); // unchanged — no double-pay for tier 8
    });
    (0, node_test_1.it)('reads the SEALED session tier; a non-spire (story) session is not paid here', async () => {
        const kv = fakeKv();
        seedSave(kv, 'hero');
        const story = spireSession('run1', 8, 'hero');
        delete story.ascensionTier; // now a story-shaped session
        const r = await (0, _tower_store_js_1.settleSpireForMember)({ slug: 'hero', session: story }, { kv, lock: passLock, now });
        node_assert_1.strict.equal(r.paid, false);
        node_assert_1.strict.equal(r.reason, 'not-spire');
    });
    (0, node_test_1.it)('upserts the weekly leaderboard board (best-per-player, no downgrade)', async () => {
        const kv = fakeKv();
        seedSave(kv, 'hero');
        await (0, _tower_store_js_1.settleSpireForMember)({ slug: 'hero', session: spireSession('runA', 8, 'hero') }, { kv, lock: passLock, now });
        let board = kv.store.get((0, _tower_store_js_1.spireLbKey)((0, _weekly_board_js_1.weekKey)(NOW)));
        node_assert_1.strict.ok(Array.isArray(board) && board.length === 1);
        node_assert_1.strict.equal(board[0].slug, 'hero');
        node_assert_1.strict.equal(board[0].tier, 8);
        node_assert_1.strict.equal(board[0].level, 100);
        // a HIGHER clear this week raises the board tier
        await (0, _tower_store_js_1.settleSpireForMember)({ slug: 'hero', session: spireSession('runB', 11, 'hero') }, { kv, lock: passLock, now });
        board = kv.store.get((0, _tower_store_js_1.spireLbKey)((0, _weekly_board_js_1.weekKey)(NOW)));
        node_assert_1.strict.equal(board[0].tier, 11);
        // a LOWER re-clear never downgrades the board
        await (0, _tower_store_js_1.settleSpireForMember)({ slug: 'hero', session: spireSession('runC', 6, 'hero') }, { kv, lock: passLock, now });
        board = kv.store.get((0, _tower_store_js_1.spireLbKey)((0, _weekly_board_js_1.weekKey)(NOW)));
        node_assert_1.strict.equal(board[0].tier, 11);
    });
    (0, node_test_1.it)('weekly best RESETS when the reset-week rolls over', async () => {
        const kv = fakeKv();
        // pre-seed a stale weekly best from a previous week
        seedSave(kv, 'hero', { battleTowerSpireWeeklyBest: 15, battleTowerSpireWeekKey: 'w0', battleTowerAscension: 15 });
        await (0, _tower_store_js_1.settleSpireForMember)({ slug: 'hero', session: spireSession('run1', 3, 'hero') }, { kv, lock: passLock, now });
        const c = charOf(kv, 'hero');
        node_assert_1.strict.equal(c.battleTowerSpireWeeklyBest, 3); // reset to this week's clear, not max(15,3)
        node_assert_1.strict.equal(c.battleTowerSpireWeekKey, (0, _weekly_board_js_1.weekKey)(NOW));
        node_assert_1.strict.equal(c.battleTowerAscension, 15); // permanent unlock is NEVER reset (max)
    });
});
// ─── Wave 2: affix keystones (hazard / debuff / healcut) ─────────────────────
// The seal EMITS the keystones by tier; the engine CONSUMES them (round-end hazard chip,
// incoming-damage debuff, healing throttle) — all squad-side, all story-safe.
(0, node_test_1.describe)('Endless Spire — Wave 2 keystone emission', () => {
    const keystoneKinds = new Set(['hazard', 'debuff', 'healcut']);
    const stackAt = (tier) => (0, _modifiers_js_1.resolveAscensionModifiers)(tier, 'sovereign', 16).modifierStack;
    const has = (tier, kind, variant) => stackAt(tier).some(m => m.kind === kind && (!variant || m.variant === variant));
    (0, node_test_1.it)('emits NO keystones below tier 9 (the chassis-only band)', () => {
        node_assert_1.strict.equal(stackAt(8).filter(m => keystoneKinds.has(m.kind)).length, 0);
    });
    (0, node_test_1.it)('gates each keystone at its own tier and stacks cumulatively', () => {
        node_assert_1.strict.ok(has(9, 'hazard', 'rotating'));
        node_assert_1.strict.ok(!has(9, 'debuff') && !has(9, 'healcut'));
        node_assert_1.strict.ok(has(10, 'debuff', 'flat'));
        node_assert_1.strict.ok(!has(10, 'healcut'));
        node_assert_1.strict.ok(has(11, 'healcut'));
        node_assert_1.strict.ok(has(13, 'hazard', 'proximity'));
        node_assert_1.strict.ok(has(14, 'debuff', 'positional'));
        node_assert_1.strict.ok(has(19, 'hazard', 'escalating'));
        // tier 20 carries the full set: 3 hazard variants, 2 debuffs, 1 healcut
        const s20 = stackAt(20);
        for (const v of ['rotating', 'proximity', 'escalating'])
            node_assert_1.strict.ok(s20.some(m => m.kind === 'hazard' && m.variant === v), `hazard/${v}`);
        node_assert_1.strict.equal(s20.filter(m => m.kind === 'debuff').length, 2);
        node_assert_1.strict.equal(s20.filter(m => m.kind === 'healcut').length, 1);
    });
    (0, node_test_1.it)('stays PURE with keystones live (deep-equal) and keeps every value modest', () => {
        node_assert_1.strict.deepEqual((0, _modifiers_js_1.resolveAscensionModifiers)(14, 'ravager', 14), (0, _modifiers_js_1.resolveAscensionModifiers)(14, 'ravager', 14));
        for (const m of stackAt(20))
            if (keystoneKinds.has(m.kind))
                node_assert_1.strict.ok(m.value > 0 && m.value <= 60, `${m.kind}=${m.value}`);
    });
});
// Minimal ACTIVE combat session for exercising the engine consumers directly.
function combatActor(id, side, pos, over = {}) {
    return {
        id, side, name: id, ownerSlug: side === 'squad' ? id : null, ai: side !== 'squad',
        hp: 10000, maxHp: 10000, chakra: 100, maxChakra: 2000, stamina: 100, maxStamina: 2000,
        shield: 0, statuses: [], cooldowns: {}, pos, character: {}, ...over,
    };
}
function activeSpireSession(over = {}) {
    return {
        towerId: 'endless-spire', runId: 'wt', floor: 9, seed: 1, partySize: 1, ascensionTier: 9, spireBossId: 'sovereign',
        map: { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors: [], turnQueue: [], activeIndex: 0, round: 3, activeAp: 100, actionsThisTurn: 0,
        groundEffects: [], objectiveState: { kind: 'defeat-boss', completed: false, failed: false },
        phaseState: { pendingPhases: [], triggeredPhases: [] },
        status: 'active', winner: null, recentMoveTokens: [], rewardSettlementState: 'pending',
        log: [], createdAt: 0, lastActionAt: 0, ...over,
    };
}
const spireFloor = (0, _spire_catalog_js_1.getSpireFloor)(9);
(0, node_test_1.describe)('Endless Spire — Wave 2 hazard telegraph', () => {
    (0, node_test_1.it)('forecasts the EXACT rotating column that will burn this round', () => {
        const s = activeSpireSession({
            round: 3, modifierStack: [{ kind: 'hazard', variant: 'rotating', value: 4, label: 'Rolling Cinders' }],
            actors: [combatActor('sq-0', 'squad', 3)], turnQueue: ['sq-0'],
        });
        (0, _engine_js_1.startRound)(s);
        const expected = [];
        for (let i = 0; i < 64; i++)
            if (i % 8 === 3)
                expected.push(i); // round 3 → column 3
        node_assert_1.strict.deepEqual(s.map.nextRoundHazardTiles, expected);
    });
    (0, node_test_1.it)('excludes reactive proximity hazards and leaves story runs undefined', () => {
        const prox = activeSpireSession({ modifierStack: [{ kind: 'hazard', variant: 'proximity', value: 5, label: 'CL' }], actors: [combatActor('sq-0', 'squad', 3)], turnQueue: ['sq-0'] });
        (0, _engine_js_1.startRound)(prox);
        node_assert_1.strict.equal(prox.map.nextRoundHazardTiles, undefined); // proximity is not forecast (approximate)
        const story = activeSpireSession({ actors: [combatActor('sq-0', 'squad', 3)], turnQueue: ['sq-0'] });
        delete story.ascensionTier;
        (0, _engine_js_1.startRound)(story);
        node_assert_1.strict.equal(story.map.nextRoundHazardTiles, undefined); // no modifierStack → unchanged wire
    });
});
(0, node_test_1.describe)('Endless Spire — Wave 2 hazard chip', () => {
    (0, node_test_1.it)('chips SQUAD units on the hot tile at round end; never the boss (squad-gated)', () => {
        const s = activeSpireSession({
            round: 3, modifierStack: [{ kind: 'hazard', variant: 'rotating', value: 4, label: 'Rolling Cinders' }],
            actors: [combatActor('sq-0', 'squad', 3), combatActor('boss', 'enemy', 11, { hp: 5000, maxHp: 5000 })], // both on column 3
            turnQueue: ['sq-0'], phaseState: { bossId: 'boss', pendingPhases: [], triggeredPhases: [] },
        });
        (0, _engine_js_1.endTurn)(s, spireFloor);
        node_assert_1.strict.equal(s.actors.find(a => a.id === 'sq-0').hp, 10000 - 400); // 4% of 10000
        node_assert_1.strict.equal(s.actors.find(a => a.id === 'boss').hp, 5000); // enemy on the same hot column is NOT taxed
        node_assert_1.strict.ok(s.log.some(l => /Rolling Cinders/.test(l)));
    });
    (0, node_test_1.it)('escalating hazards bite harder on a later round', () => {
        const esc = (round) => {
            const s = activeSpireSession({
                round, modifierStack: [{ kind: 'hazard', variant: 'escalating', value: 3, label: 'Rising Inferno' }],
                actors: [combatActor('sq-0', 'squad', 4), combatActor('boss', 'enemy', 0, { hp: 5000, maxHp: 5000 })], // pos 4 = central column
                turnQueue: ['sq-0'], phaseState: { bossId: 'boss', pendingPhases: [], triggeredPhases: [] },
            });
            (0, _engine_js_1.endTurn)(s, (0, _spire_catalog_js_1.getSpireFloor)(19));
            return 10000 - s.actors.find(a => a.id === 'sq-0').hp;
        };
        node_assert_1.strict.ok(esc(8) > esc(2), 'a later round chips more (capped growth)');
    });
    (0, node_test_1.it)('a STORY session (no modifierStack) takes no ascension hazard damage', () => {
        const s = activeSpireSession({ round: 3, actors: [combatActor('sq-0', 'squad', 3), combatActor('boss', 'enemy', 0, { hp: 5000, maxHp: 5000 })], turnQueue: ['sq-0'], phaseState: { bossId: 'boss', pendingPhases: [], triggeredPhases: [] } });
        delete s.ascensionTier;
        (0, _engine_js_1.endTurn)(s, spireFloor);
        node_assert_1.strict.equal(s.actors.find(a => a.id === 'sq-0').hp, 10000); // untouched
    });
});
(0, node_test_1.describe)('Endless Spire — Wave 2 heal-cut', () => {
    const healSession = (modifierStack) => activeSpireSession({
        modifierStack, actors: [combatActor('sq-0', 'squad', 0, { hp: 5000, maxHp: 10000 })], turnQueue: ['sq-0'],
    });
    const heal = { actorId: 'sq-0', type: 'heal' };
    (0, node_test_1.it)('throttles a squad Basic Heal by the sealed cut; story heals in full', () => {
        const full = healSession(undefined);
        (0, _engine_js_1.applyAction)(full, spireFloor, heal, (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.equal(full.actors[0].hp, 5000 + 1000); // 10% of maxHp, uncut
        const cut = healSession([{ kind: 'healcut', variant: 'flat', value: 30, label: 'Withering Aura' }]);
        (0, _engine_js_1.applyAction)(cut, spireFloor, heal, (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.equal(cut.actors[0].hp, 5000 + 700); // 30% cut → 700
    });
});
(0, node_test_1.describe)('Endless Spire — Wave 2 damage-taken debuff', () => {
    const attackSession = (modifierStack) => activeSpireSession({
        modifierStack,
        actors: [
            combatActor('en-0', 'enemy', 0, { character: { specialty: 'Taijutsu', stats: { strength: 2500, speed: 2500, taijutsuOffense: 2500, bukijutsuOffense: 2500 } } }),
            combatActor('sq-0', 'squad', 1, { hp: 200000, maxHp: 200000, character: { specialty: 'Taijutsu', stats: { taijutsuDefense: 100, willpower: 100 } } }),
        ],
        turnQueue: ['en-0'], phaseState: { bossId: 'en-0', pendingPhases: [], triggeredPhases: [] },
    });
    const attack = { actorId: 'en-0', type: 'attack', targetId: 'sq-0' };
    const dmgTaken = (s) => 200000 - s.actors.find(a => a.id === 'sq-0').hp;
    (0, node_test_1.it)('a squad target takes MORE damage under a flat debuff, bounded near +10%', () => {
        const base = attackSession(undefined);
        (0, _engine_js_1.applyAction)(base, spireFloor, attack, (0, _sim_js_1.makeRng)(1));
        const dBase = dmgTaken(base);
        node_assert_1.strict.ok(dBase > 0, `baseline deals damage (${dBase})`);
        const deb = attackSession([{ kind: 'debuff', variant: 'flat', value: 10, label: 'Sundered Guard' }]);
        (0, _engine_js_1.applyAction)(deb, spireFloor, attack, (0, _sim_js_1.makeRng)(1));
        const dDeb = dmgTaken(deb);
        node_assert_1.strict.ok(dDeb > dBase, `debuff raises incoming damage (${dDeb} > ${dBase})`);
        node_assert_1.strict.ok(dDeb <= Math.ceil(dBase * 1.10) + 2, `~+10% and capped (${dDeb} vs ${dBase})`);
    });
    (0, node_test_1.it)('the summed debuff is HARD-CAPPED (anti-one-shot): a huge sealed debuff can never exceed +30%', () => {
        const base = attackSession(undefined);
        (0, _engine_js_1.applyAction)(base, spireFloor, attack, (0, _sim_js_1.makeRng)(1));
        const dBase = dmgTaken(base);
        // an (impossible) 500% sealed debuff still clamps to DEBUFF_TAKEN_CAP (1.30×)
        const huge = attackSession([{ kind: 'debuff', variant: 'flat', value: 500, label: 'overflow' }]);
        (0, _engine_js_1.applyAction)(huge, spireFloor, attack, (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.ok(dmgTaken(huge) <= Math.ceil(dBase * 1.30) + 2, `clamped to +30% (${dmgTaken(huge)} vs ${dBase})`);
    });
});
// ─── Wave 3: capstones (extraPhase / objective / dualAugment) ─────────────────
(0, node_test_1.describe)('Endless Spire — Wave 3 capstone emission', () => {
    const stackAt = (tier) => (0, _modifiers_js_1.resolveAscensionModifiers)(tier, 'sovereign', 16).modifierStack;
    const has = (tier, kind) => stackAt(tier).some(m => m.kind === kind);
    (0, node_test_1.it)('gates each capstone at its own tier (extraPhase 15 / objective 17 / dualAugment 18)', () => {
        node_assert_1.strict.ok(!has(14, 'extraPhase'));
        node_assert_1.strict.ok(has(15, 'extraPhase'));
        node_assert_1.strict.ok(!has(16, 'objective'));
        node_assert_1.strict.ok(has(17, 'objective'));
        node_assert_1.strict.ok(!has(17, 'dualAugment'));
        node_assert_1.strict.ok(has(18, 'dualAugment'));
        // tier 20 carries all three capstones on top of the Wave-2 keystones
        for (const k of ['extraPhase', 'objective', 'dualAugment'])
            node_assert_1.strict.ok(has(20, k), k);
    });
});
(0, node_test_1.describe)('Endless Spire — Wave 3 extraPhase (desperation blast)', () => {
    (0, node_test_1.it)('injects the sealed 40% gate into the boss phase ladder + seals the threshold', () => {
        const floor = (0, _spire_catalog_js_1.getSpireFloor)(15);
        const seal = (0, _modifiers_js_1.resolveAscensionModifiers)(15, 'sovereign', floor.roundBudget);
        const s = (0, _encounter_js_1.buildTowerEncounter)({ floor, squad: [squadInput('hero')], runId: 'ep', seed: 1, partySize: 1, now: 0, ascension: seal, spireBossId: 'sovereign' });
        node_assert_1.strict.equal(s.extraPhaseThreshold, 40);
        node_assert_1.strict.ok(s.phaseState.pendingPhases.includes(40), 'desperation gate merged into pendingPhases');
        // a tier-14 build seals NO extra gate
        const f14 = (0, _spire_catalog_js_1.getSpireFloor)(14);
        const s14 = (0, _encounter_js_1.buildTowerEncounter)({ floor: f14, squad: [squadInput('hero')], runId: 'ep2', seed: 1, partySize: 1, now: 0, ascension: (0, _modifiers_js_1.resolveAscensionModifiers)(14, 'warden', f14.roundBudget), spireBossId: 'warden' });
        node_assert_1.strict.equal(s14.extraPhaseThreshold, undefined);
        node_assert_1.strict.ok(!s14.phaseState.pendingPhases.includes(40));
    });
    (0, node_test_1.it)('fires a ONE-TIME bounded blast on ALL squad when the boss crosses the gate', () => {
        const s = activeSpireSession({
            ascensionTier: 15, extraPhaseThreshold: 40, round: 2,
            modifierStack: [{ kind: 'extraPhase', value: 40, label: 'Second Wind' }],
            actors: [
                combatActor('sq-0', 'squad', 1, { character: { specialty: 'Taijutsu', stats: { strength: 2500, speed: 2500, taijutsuOffense: 2500 } } }),
                combatActor('sq-1', 'squad', 40, { hp: 10000, maxHp: 10000 }), // bystander far from the boss
                combatActor('boss', 'enemy', 0, { hp: 405, maxHp: 1000, character: { specialty: 'Taijutsu', stats: { taijutsuDefense: 10 } } }),
            ],
            turnQueue: ['sq-0'], phaseState: { bossId: 'boss', pendingPhases: [40], triggeredPhases: [] },
        });
        (0, _engine_js_1.applyAction)(s, (0, _spire_catalog_js_1.getSpireFloor)(15), { actorId: 'sq-0', type: 'attack', targetId: 'boss' }, (0, _sim_js_1.makeRng)(1));
        // the far bystander took ONLY the blast (6% of maxHp) — isolates it from the attack
        node_assert_1.strict.equal(s.actors.find(a => a.id === 'sq-1').hp, 10000 - 600);
        node_assert_1.strict.ok(s.log.some(l => /desperation blast/.test(l)));
    });
});
(0, node_test_1.describe)('Endless Spire — Wave 3 Sudden Death (objective)', () => {
    const sdSession = (withObjective, round, roundCap) => activeSpireSession({
        round, roundCap, ascensionTier: 17,
        modifierStack: withObjective ? [{ kind: 'objective', variant: 'flat', value: 3, label: 'Sudden Death' }] : [],
        actors: [combatActor('sq-0', 'squad', 3, { hp: 10000, maxHp: 10000 }), combatActor('boss', 'enemy', 40, { hp: 5000, maxHp: 5000 })],
        turnQueue: ['sq-0'], phaseState: { bossId: 'boss', pendingPhases: [], triggeredPhases: [] },
    });
    (0, node_test_1.it)('collapses the floor on the whole squad in the final rounds; leaves earlier rounds alone', () => {
        const late = sdSession(true, 8, 10); // window = last 3 (rounds 8,9,10)
        (0, _engine_js_1.endTurn)(late, (0, _spire_catalog_js_1.getSpireFloor)(17));
        node_assert_1.strict.equal(late.actors.find(a => a.id === 'sq-0').hp, 10000 - 500); // 5% collapse chip
        node_assert_1.strict.ok(late.log.some(l => /collapsing/.test(l)));
        const early = sdSession(true, 5, 10); // round 5 < collapseFrom(7) → safe
        (0, _engine_js_1.endTurn)(early, (0, _spire_catalog_js_1.getSpireFloor)(17));
        node_assert_1.strict.equal(early.actors.find(a => a.id === 'sq-0').hp, 10000);
    });
    (0, node_test_1.it)('does nothing without the objective keystone (floors < 17 unaffected)', () => {
        const s = sdSession(false, 9, 10);
        (0, _engine_js_1.endTurn)(s, (0, _spire_catalog_js_1.getSpireFloor)(17));
        node_assert_1.strict.equal(s.actors.find(a => a.id === 'sq-0').hp, 10000);
    });
});
(0, node_test_1.describe)('Endless Spire — Wave 3 Cataclysm (dualAugment)', () => {
    (0, node_test_1.it)('amplifies a hazard chip by the sealed bonus when active', () => {
        const mk = (dual) => activeSpireSession({
            round: 3,
            modifierStack: [
                { kind: 'hazard', variant: 'rotating', value: 4, label: 'Rolling Cinders' },
                ...(dual ? [{ kind: 'dualAugment', value: 1, label: 'Cataclysm' }] : []),
            ],
            actors: [combatActor('sq-0', 'squad', 3, { hp: 10000, maxHp: 10000 }), combatActor('boss', 'enemy', 40, { hp: 5000, maxHp: 5000 })],
            turnQueue: ['sq-0'], phaseState: { bossId: 'boss', pendingPhases: [], triggeredPhases: [] },
        });
        const base = mk(false);
        (0, _engine_js_1.endTurn)(base, spireFloor);
        const cat = mk(true);
        (0, _engine_js_1.endTurn)(cat, spireFloor);
        node_assert_1.strict.equal(10000 - base.actors.find(a => a.id === 'sq-0').hp, 400); // 4%
        node_assert_1.strict.equal(10000 - cat.actors.find(a => a.id === 'sq-0').hp, 500); // (4+1)%
    });
});
