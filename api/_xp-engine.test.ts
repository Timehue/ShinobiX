import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    gainXp, applyDerivedLevel, earnedForLevel, levelForEarned, earnedStatPoints,
    maxHpForLevel, maxChakraForLevel, maxStaminaForLevel,
    rankFromLevel, reconcileCharacterStatBudget, effectiveCharacterXpGain,
    rankTitleForLevel, computePvpWinGains, creditPvpWinBase,
    MAX_LEVEL, CHARACTER_XP_GAIN_MULTIPLIER,
    COMBAT_RESOURCES_V2 as V2_COMBAT_RESOURCES,
    CHAKRA_BASE_V2 as V2_CHAKRA_BASE, CHAKRA_CAP_V2 as V2_CHAKRA_CAP,
    STAMINA_BASE_V2 as V2_STAMINA_BASE, STAMINA_CAP_V2 as V2_STAMINA_CAP,
} from './_xp-engine.js';
import { v2JutsuResourceCost, v2ResourceRegen, resolveJutsuDiscipline, v2PoisonOnSpend, POISON_SPEND_FACTOR } from './_combat-resources.js';

// ─── Independent inline replica of the CLIENT level engine ──────────────────
// Transcribed straight from shinobij.client/src/lib/{stats,character-progress}
// .ts. This is a SEPARATE copy from api/_xp-engine.ts so a transcription drift
// on either side fails the sweep below. Character XP is RETIRED
// (docs/leveling-without-xp-map.md): level derives from the earned-points
// ledger, so the replica engine is applyDerivedLevel (rise-only + exam holds),
// and gainXp must be exactly that recompute with the amount ignored.

const C_MAX_LEVEL = 100, C_MAX_STAT = 2500, C_MULT = 1;
const C_HP_CAP = 10000, C_CHAKRA_CAP = 5000, C_STAMINA_CAP = 5000;
// combatResourcesV2 flag + pool (MUST match COMBAT_RESOURCES_V2 + the v2 pool constants in
// constants/game.ts + api/_xp-engine.ts). When on, maxChakra/Stamina use the v2 curve.
const C_V2_FLAG = true;
const C_V2_CHAKRA_BASE = 1000, C_V2_CHAKRA_CAP = 10000, C_V2_STAMINA_BASE = 1000, C_V2_STAMINA_CAP = 10000;
const cV2Pool = (base: number, cap: number, lvl: number) => Math.min(cap, Math.floor(base + (Math.max(1, lvl) - 1) * ((cap - base) / (C_MAX_LEVEL - 1))));
const C_KEYS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
] as const;
const cCap = (v: number) => Math.min(C_MAX_STAT, Math.max(0, Math.floor(v)));
const cBase = () => Object.fromEntries(C_KEYS.map(k => [k, 10])) as Record<string, number>;
function cNorm(stats?: Record<string, unknown>) {
    const base = cBase();
    return C_KEYS.reduce((n, k) => { n[k] = cCap(stats?.[k] == null ? base[k] : Number(stats[k])); return n; }, { ...base });
}
const cAllocated = (s: Record<string, number>) => C_KEYS.reduce((t, k) => t + Math.max(0, cCap(s[k]) - 10), 0);
const cMaxHp = (lvl: number) => Math.min(C_HP_CAP, 500 + (Math.max(1, lvl) - 1) * 100);
const cMaxChakra = (lvl: number) => C_V2_FLAG ? cV2Pool(C_V2_CHAKRA_BASE, C_V2_CHAKRA_CAP, lvl) : Math.min(C_CHAKRA_CAP, Math.floor(100 + (Math.max(1, lvl) - 1) * ((C_CHAKRA_CAP - 100) / (C_MAX_LEVEL - 1))));
const cMaxStamina = (lvl: number) => C_V2_FLAG ? cV2Pool(C_V2_STAMINA_BASE, C_V2_STAMINA_CAP, lvl) : Math.min(C_STAMINA_CAP, Math.floor(100 + (Math.max(1, lvl) - 1) * ((C_STAMINA_CAP - 100) / (C_MAX_LEVEL - 1))));
const cRankFrom = (lvl: number) => lvl >= 80 ? 'Special Jonin' : lvl >= 50 ? 'Jonin' : lvl >= 30 ? 'Chunin' : lvl >= 15 ? 'Genin' : 'Academy Student';
function cReconcile(ch: Record<string, unknown>) {
    const stats = cNorm(ch.stats as Record<string, unknown>);
    // Two-axis: preserve the stored pool (mirrors the server + client reconcile).
    const unspentStats = Math.max(0, Math.floor(Number(ch.unspentStats) || 0));
    return { ...ch, stats, unspentStats };
}
const cEffXp = (ch: { elderFocus?: unknown }, amount: number) => {
    const base = Math.max(0, Math.floor(amount));
    const boosted = Math.floor(base * C_MULT);
    return boosted + (ch.elderFocus === 'training' ? Math.floor(boosted * 0.1) : 0);
};
const cLevelOnly = new Set(['Academy Student', 'Genin', 'Chunin', 'Jonin', 'Elite Jonin', 'Special Jonin', 'Kage', 'Legendary Kage']);
function cRoleTitle(ch: Record<string, unknown>) {
    const cur = typeof ch.rankTitle === 'string' ? ch.rankTitle.trim() : '';
    const low = cur.toLowerCase();
    const isRole = low.includes('kage') || low.includes('elder') || low.includes('anbu') || low.includes('clan leader') || low.includes('clan head');
    if (cur && isRole && !cLevelOnly.has(cur)) return cur;
    if (ch.clanFounder) return 'Clan Leader';
    return '';
}
const cRankTitle = (ch: Record<string, unknown>, lvl: number) => lvl < C_MAX_LEVEL ? cRankFrom(lvl) : (cRoleTitle(ch) || 'Special Jonin');
const C_GATES = [{ exam: 'genin', level: 20 }, { exam: 'chunin', level: 39 }];
function cExamCap(ch: Record<string, unknown>) {
    const passed = Array.isArray(ch.examsPassed) ? ch.examsPassed : [];
    for (const g of C_GATES) if (!passed.includes(g.exam)) return g.level;
    return C_MAX_LEVEL;
}
// Stat-derived level curve (fitted anchors — lib/stats.ts LEVEL_EARNED_ANCHORS).
const C_ANCHORS: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [15, 2800], [30, 6200], [50, 11600], [80, 19600], [100, 27500],
];
function cEarnedForLevel(level: number): number {
    const clamped = Math.max(1, Math.min(C_MAX_LEVEL, Math.floor(level)));
    for (let i = 1; i < C_ANCHORS.length; i++) {
        const [aL, aE] = C_ANCHORS[i - 1];
        const [bL, bE] = C_ANCHORS[i];
        if (clamped >= aL && clamped <= bL) return aE + Math.round(((clamped - aL) / (bL - aL)) * (bE - aE));
    }
    return 0;
}
function cLevelForEarned(earned: number): number {
    const pts = Math.max(0, Math.floor(earned));
    for (let level = C_MAX_LEVEL; level >= 2; level--) if (cEarnedForLevel(level) <= pts) return level;
    return 1;
}
const cEarnedPoints = (ch: Record<string, unknown>) =>
    cAllocated(cNorm(ch.stats as Record<string, unknown>)) + Math.max(0, Math.floor(Number(ch.unspentStats) || 0));
function cApplyDerivedLevel(character: Record<string, unknown>): Record<string, unknown> {
    let updated = cReconcile(character) as Record<string, unknown>;
    const target = Math.max(1, Math.min(cExamCap(updated), cLevelForEarned(cEarnedPoints(updated))));
    const current = Math.max(1, Math.min(C_MAX_LEVEL, Math.floor(Number(updated.level) || 1)));
    if (target > current) {
        updated = {
            ...updated, level: target, rankTitle: cRankTitle(updated, target),
            maxHp: cMaxHp(target), maxChakra: cMaxChakra(target), maxStamina: cMaxStamina(target),
            hp: cMaxHp(target), chakra: cMaxChakra(target), stamina: cMaxStamina(target),
        };
    }
    return updated;
}

// ─── combatResourcesV2 inline client spec ───────────────────────────────────
// Replica of shinobij.client/src/{constants/game.ts, lib/jutsu-scaling.ts} v2 math.
const cV2Lerp = (base: number, cap: number, lvl: number) => {
    const L = Math.max(1, Math.min(C_MAX_LEVEL, Math.floor(Number(lvl) || 1)));
    return Math.round(base + (cap - base) * (L - 1) / (C_MAX_LEVEL - 1));
};
const C_V2_TIERS = [{ minAp: 60, base: 50, cap: 350 }, { minAp: 40, base: 25, cap: 175 }, { minAp: 1, base: 12, cap: 90 }];
const cV2Cost = (ap: number, lvl: number) => { const t = C_V2_TIERS.find(t => (Number(ap) || 0) >= t.minAp); return t ? cV2Lerp(t.base, t.cap, lvl) : 0; };
const cV2Regen = (lvl: number) => cV2Lerp(25, 175, lvl);
const C_V2_CHAKRA_DISC = new Set(['Ninjutsu', 'Genjutsu']);
const C_V2_DISC = ['Taijutsu', 'Bukijutsu', 'Genjutsu', 'Ninjutsu'];
const cResolveDisc = (type: string | null | undefined, sp: string | null | undefined) => {
    let t = type ?? '';
    if (t === 'Any' || !C_V2_DISC.includes(t)) t = C_V2_DISC.includes(String(sp)) ? String(sp) : 'Taijutsu';
    return C_V2_CHAKRA_DISC.has(t) ? 'chakra' : 'stamina';
};

describe('combatResourcesV2 sub-formulas match the client', () => {
    it('flag + pool constants are in sync (server == client spec)', () => {
        assert.equal(V2_COMBAT_RESOURCES, C_V2_FLAG, 'COMBAT_RESOURCES_V2 flag');
        assert.equal(V2_CHAKRA_BASE, C_V2_CHAKRA_BASE);
        assert.equal(V2_CHAKRA_CAP, C_V2_CHAKRA_CAP);
        assert.equal(V2_STAMINA_BASE, C_V2_STAMINA_BASE);
        assert.equal(V2_STAMINA_CAP, C_V2_STAMINA_CAP);
    });
    it('v2 cost + regen match across levels and AP tiers', () => {
        for (let lvl = 1; lvl <= 100; lvl++) {
            assert.equal(v2ResourceRegen(lvl), cV2Regen(lvl), `regen(${lvl})`);
            for (const ap of [0, 20, 40, 55, 60, 80]) {
                assert.equal(v2JutsuResourceCost(ap, lvl), cV2Cost(ap, lvl), `cost(ap${ap},L${lvl})`);
            }
        }
        // Anchor the tuning: 60-AP ~50→~350, 40-AP ~25→~175, regen 25→175.
        assert.equal(v2JutsuResourceCost(60, 1), 50);
        assert.equal(v2JutsuResourceCost(60, 100), 350);
        assert.equal(v2JutsuResourceCost(40, 1), 25);
        assert.equal(v2ResourceRegen(1), 25);
        assert.equal(v2ResourceRegen(100), 175);
    });
    it('poison-on-spend scales off jutsu cost, not the pool', () => {
        const cPoison = (spend: number, pct: number) => {
            const p = pct > 0 ? pct : 6;
            const s = Math.max(0, Number(spend) || 0);
            return s <= 0 ? 0 : Math.max(1, Math.round(s * (p / 100) * POISON_SPEND_FACTOR));
        };
        for (const spend of [0, 50, 120, 200, 350]) {
            for (const pct of [0, 6, 15, 30]) {
                assert.equal(v2PoisonOnSpend(spend, pct), cPoison(spend, pct), `poison(spend${spend},pct${pct})`);
            }
        }
        assert.equal(v2PoisonOnSpend(0, 6), 0, 'no spend → no poison');
        assert.equal(v2PoisonOnSpend(200, 0), v2PoisonOnSpend(200, 6), 'pct 0 defaults to 6');
    });
    it('discipline routing: concrete type → its bar; Any → specialty (fallback stamina)', () => {
        for (const type of ['Ninjutsu', 'Genjutsu', 'Taijutsu', 'Bukijutsu', 'Any', '', null]) {
            for (const sp of ['Ninjutsu', 'Genjutsu', 'Taijutsu', 'Bukijutsu', '', null]) {
                assert.equal(resolveJutsuDiscipline(type, sp), cResolveDisc(type, sp), `disc(${type},${sp})`);
            }
        }
        assert.equal(resolveJutsuDiscipline('Ninjutsu', 'Taijutsu'), 'chakra');
        assert.equal(resolveJutsuDiscipline('Any', 'Bukijutsu'), 'stamina');
        assert.equal(resolveJutsuDiscipline('Any', ''), 'stamina');
    });
});

// ─── Sub-formula equivalence ────────────────────────────────────────────────
describe('xp-engine sub-formulas match the client', () => {
    it('curves + vitals + rank across all levels', () => {
        for (let lvl = 1; lvl <= 100; lvl++) {
            assert.equal(earnedForLevel(lvl), cEarnedForLevel(lvl), `earnedForLevel(${lvl})`);
            assert.equal(maxHpForLevel(lvl), cMaxHp(lvl), `maxHp(${lvl})`);
            assert.equal(maxChakraForLevel(lvl), cMaxChakra(lvl), `maxChakra(${lvl})`);
            assert.equal(maxStaminaForLevel(lvl), cMaxStamina(lvl), `maxStamina(${lvl})`);
            assert.equal(rankFromLevel(lvl), cRankFrom(lvl), `rankFromLevel(${lvl})`);
        }
    });
    it('effectiveCharacterXpGain stays a retired-but-frozen helper (×1, elder +10%)', () => {
        assert.equal(CHARACTER_XP_GAIN_MULTIPLIER, 1);
        for (const amt of [0, 1, 75, 100, 125, 250]) {
            assert.equal(effectiveCharacterXpGain({}, amt), cEffXp({}, amt), `plain ${amt}`);
            assert.equal(effectiveCharacterXpGain({ elderFocus: 'training' }, amt), cEffXp({ elderFocus: 'training' }, amt), `training ${amt}`);
        }
    });
});

// ─── applyDerivedLevel full-object sweep vs the inline client replica ───────
describe('applyDerivedLevel matches the client replica across a wide input sweep', () => {
    function mkChar(over: Record<string, unknown>): Record<string, unknown> {
        return {
            name: 'Sweep', level: 1, xp: 0, ryo: 1000, hp: 100, chakra: 100, stamina: 100,
            maxHp: 100, maxChakra: 100, maxStamina: 100, rankTitle: 'Academy Student',
            examsPassed: ['genin', 'chunin'], profession: 'none', ...over,
        };
    }
    it('produces an identical character object for every case', () => {
        const levels = [1, 5, 14, 15, 19, 20, 21, 38, 39, 40, 79, 80, 99, 100];
        const pools = [0, 20, 500, 2800, 3933, 8630, 11600, 27500, 40000];
        const exams = [[], ['genin'], ['genin', 'chunin']];
        const statBumps = [0, 100, 4080];
        let cases = 0;
        for (const level of levels) for (const unspentStats of pools) for (const examsPassed of exams) for (const bump of statBumps) {
            const stats = bump > 0 ? { ...cBase(), strength: 10 + Math.min(2490, bump) } : {};
            const input = mkChar({ level, unspentStats, examsPassed, stats });
            assert.deepEqual(
                applyDerivedLevel(structuredClone(input)),
                cApplyDerivedLevel(structuredClone(input)),
                `level=${level} pool=${unspentStats} exams=${examsPassed.join('+') || 'none'} bump=${bump}`,
            );
            cases++;
        }
        assert.ok(cases >= 1000, `swept ${cases} cases`);
    });
    it('gainXp is the same recompute with the amount ignored (retired XP driver)', () => {
        for (const amount of [0, 1, 100, 60000]) {
            const input = mkChar({ level: 1, unspentStats: 3000, examsPassed: ['genin', 'chunin'] });
            assert.deepEqual(
                gainXp(structuredClone(input), amount),
                applyDerivedLevel(structuredClone(input)),
                `amount=${amount} must be ignored`,
            );
        }
    });
    it('preserves unrelated fields (ryo, name, custom) untouched except on level-up vitals', () => {
        const input = { name: 'Keep', level: 1, xp: 0, ryo: 777, custom: 'x', examsPassed: ['genin', 'chunin'], stats: {} };
        const out = applyDerivedLevel(structuredClone(input));
        assert.equal(out.ryo, 777);
        assert.equal(out.name, 'Keep');
        assert.equal(out.custom, 'x');
        assert.equal(out.xp, 0, 'frozen xp field untouched');
    });
});

// ─── Hand-computed golden anchors (cross-check the transcription) ────────────
describe('derived-level golden anchors', () => {
    it('a fresh character (earned 20) is level 1 and keeps its pool', () => {
        const out = applyDerivedLevel({ level: 1, xp: 0, examsPassed: [], stats: {}, unspentStats: 20 });
        assert.equal(out.level, 1);
        assert.equal(out.unspentStats, 20);
    });
    it('earned 2800 → level 15 with a full vitals refill (Genin)', () => {
        const out = applyDerivedLevel({ level: 1, hp: 3, chakra: 1, stamina: 1, examsPassed: [], stats: {}, unspentStats: 2800 });
        assert.equal(out.level, 15);
        assert.equal(out.rankTitle, 'Genin');
        assert.equal(out.maxHp, maxHpForLevel(15));
        assert.equal(out.hp, maxHpForLevel(15));
        assert.equal(out.chakra, maxChakraForLevel(15));
        assert.equal(out.stamina, maxStaminaForLevel(15));
    });
    it('exam gate holds level at 20 (no genin exam) no matter the earned total', () => {
        const out = applyDerivedLevel({ level: 19, examsPassed: [], stats: {}, unspentStats: 30000 });
        assert.equal(out.level, 20);
        assert.equal(out.rankTitle, 'Genin');
        assert.equal(out.maxHp, 2400); // maxHpForLevel(20)
    });
    it('banked earned leaps on exam pass, and 27,500 with both exams reaches 100', () => {
        assert.equal(applyDerivedLevel({ level: 20, examsPassed: ['genin'], stats: {}, unspentStats: 8000 }).level, 36);
        const maxed = applyDerivedLevel({ level: 39, examsPassed: ['genin', 'chunin'], stats: {}, unspentStats: 27500 });
        assert.equal(maxed.level, MAX_LEVEL);
        assert.equal(maxed.rankTitle, 'Special Jonin');
    });
    it('RISE-ONLY: an unmigrated save (high level, low earned) never de-levels', () => {
        const out = applyDerivedLevel({ level: 39, hp: 55, examsPassed: ['genin'], stats: {}, unspentStats: 100 });
        assert.equal(out.level, 39);
        assert.equal(out.hp, 55);
    });
    it('the earned ledger is the same conserved sum the sanitizer guards', () => {
        const spent = { stats: { ...cBase(), willpower: 70 }, unspentStats: 40 };
        const unspent = { stats: cBase(), unspentStats: 100 };
        assert.equal(earnedStatPoints(spent), earnedStatPoints(unspent));
        assert.equal(levelForEarned(earnedForLevel(50)), 50);
    });
});

// ─── PvP-win reward composition ──────────────────────────────────────────────
describe('computePvpWinGains (XP retired — ryo + growth multiplier)', () => {
    const petChar = (trait: string | null, activePetId = 'p1') => ({
        activePetId,
        pets: trait ? [{ id: 'p1', trait }] : [{ id: 'p1' }],
    });
    it('base win: 75 ryo, growthMult 1', () => {
        const g = computePvpWinGains(petChar(null), 12);
        assert.deepEqual({ ryoGain: g.ryoGain, growthMult: g.growthMult }, { ryoGain: 75, growthMult: 1 });
    });
    it('Swift trait → growthMult 1.25 (its old +25% XP now boosts stat growth); Lucky → 90 ryo', () => {
        assert.equal(computePvpWinGains(petChar('Swift'), 12).growthMult, 1.25);
        assert.equal(computePvpWinGains(petChar('Swift'), 12).ryoGain, 75);
        assert.equal(computePvpWinGains(petChar('Lucky'), 12).ryoGain, 90);
        assert.equal(computePvpWinGains(petChar('Lucky'), 12).growthMult, 1);
    });
    it("Death's Gate (sector 99) doubles ryo and stat growth", () => {
        const g = computePvpWinGains(petChar(null), 99);
        assert.deepEqual({ ryoGain: g.ryoGain, growthMult: g.growthMult }, { ryoGain: 150, growthMult: 2 });
        assert.equal(computePvpWinGains(petChar('Swift'), 99).growthMult, 2.5);
    });
    it('inactive pet trait is ignored (only the active pet counts)', () => {
        const g = computePvpWinGains({ activePetId: 'other', pets: [{ id: 'p1', trait: 'Swift' }] }, 12);
        assert.equal(g.growthMult, 1);
        assert.equal(g.ryoGain, 75);
    });
});

describe('creditPvpWinBase', () => {
    it('adds ryo, recomputes the derived level, and reports xp 0 in the summary', () => {
        const base = { level: 1, xp: 0, ryo: 1000, examsPassed: ['genin', 'chunin'], stats: {}, unspentStats: 250 };
        const { ryoGain } = computePvpWinGains({ activePetId: 'x', pets: [] }, 12); // 75
        const out = creditPvpWinBase(structuredClone(base), ryoGain);
        assert.equal(out.char.ryo, 1075); // 1000 + 75
        assert.equal(out.char.level, levelForEarned(250)); // derived from the ledger
        assert.equal(out.summary.ryo, 1075);
        assert.equal(out.summary.xp, 0); // retired — shape kept for old clients
        assert.equal(out.summary.level, Number(out.char.level));
        assert.equal(out.summary.unspentStats, 250);
    });
});

// ─── reconcile + rankTitle spot checks ──────────────────────────────────────
describe('reconcile + rankTitle edge cases', () => {
    it('reconcile normalizes garbage stats and floors unspent at 0', () => {
        const out = reconcileCharacterStatBudget({ level: 1, xp: 0, stats: { strength: 999999, speed: -5 } });
        const stats = out.stats as Record<string, number>;
        assert.equal(stats.strength, 2500); // capped at MAX_STAT
        assert.equal(stats.speed, 0);        // floored at 0
        assert.equal(out.unspentStats, 0);   // never negative
    });
    it('rankTitleForLevel keeps a role title at max level but falls back below it', () => {
        assert.equal(rankTitleForLevel({ rankTitle: 'Kage', clanFounder: false }, 50), 'Jonin'); // below max → level title
        assert.equal(rankTitleForLevel({ rankTitle: 'Fifth Kage', clanFounder: false }, 100), 'Fifth Kage'); // role title kept at max
        assert.equal(rankTitleForLevel({ clanFounder: true }, 100), 'Clan Leader');
        assert.equal(rankTitleForLevel({}, 100), 'Special Jonin');
    });
});
