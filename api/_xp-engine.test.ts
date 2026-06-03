import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    gainXp, xpNeeded, maxHpForLevel, maxChakraForLevel, maxStaminaForLevel,
    rankFromLevel, reconcileCharacterStatBudget, effectiveCharacterXpGain,
    rankTitleForLevel, computePvpWinGains, creditPvpWinBase,
    MAX_LEVEL, CHARACTER_XP_GAIN_MULTIPLIER,
} from './_xp-engine.js';

// ─── Independent inline replica of the CLIENT level engine ──────────────────
// Transcribed straight from shinobij.client/src/lib/{stats,progression,
// character-progress}.ts + App.tsx {examLevelCap, gainXp}. This is a SEPARATE
// copy from api/_xp-engine.ts so a transcription drift on either side fails the
// sweep below. If the client formula changes, BOTH this replica and the port
// must change in lockstep — that's the point (the "server == client" rule).

const C_MAX_LEVEL = 100, C_MAX_STAT = 2500, C_STARTING = 20, C_MULT = 3;
const C_HP_CAP = 10000, C_CHAKRA_CAP = 5000, C_STAMINA_CAP = 5000;
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
const cXpNeeded = (lvl: number) => lvl >= C_MAX_LEVEL ? 0 : lvl * 100;
const C_TOTAL_XP = ((C_MAX_LEVEL - 1) * C_MAX_LEVEL / 2) * 100;
const cBeforeLevel = (lvl: number) => { const l = Math.max(1, Math.min(C_MAX_LEVEL, Math.floor(lvl))); return ((l - 1) * l / 2) * 100; };
const cForProgress = (lvl: number, xp: number) => lvl >= C_MAX_LEVEL ? C_TOTAL_XP : Math.min(C_TOTAL_XP, cBeforeLevel(lvl) + Math.max(0, Math.min(cXpNeeded(lvl), Math.floor(xp))));
const cMaxHp = (lvl: number) => Math.min(C_HP_CAP, 100 + (Math.max(1, lvl) - 1) * 100);
const cMaxChakra = (lvl: number) => Math.min(C_CHAKRA_CAP, Math.floor(100 + (Math.max(1, lvl) - 1) * ((C_CHAKRA_CAP - 100) / (C_MAX_LEVEL - 1))));
const cMaxStamina = (lvl: number) => Math.min(C_STAMINA_CAP, Math.floor(100 + (Math.max(1, lvl) - 1) * ((C_STAMINA_CAP - 100) / (C_MAX_LEVEL - 1))));
const cRankFrom = (lvl: number) => lvl >= 80 ? 'Special Jonin' : lvl >= 50 ? 'Jonin' : lvl >= 30 ? 'Chunin' : lvl >= 15 ? 'Genin' : 'Academy Student';
const C_TOTAL_PTS = C_KEYS.reduce((t, k) => t + (C_MAX_STAT - cBase()[k]), 0);
const C_PTS_FROM_XP = C_TOTAL_PTS - C_STARTING;
const cBudget = (lvl: number, xp: number) => Math.min(C_TOTAL_PTS, C_STARTING + Math.floor((cForProgress(lvl, xp) / C_TOTAL_XP) * C_PTS_FROM_XP));
function cReconcile(ch: Record<string, unknown>) {
    const stats = cNorm(ch.stats as Record<string, unknown>);
    const available = Math.max(0, cBudget(Number(ch.level), Number(ch.xp)) - cAllocated(stats));
    return { ...ch, stats, unspentStats: available };
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
function cGainXp(character: Record<string, unknown>, amount: number): Record<string, unknown> {
    const totalAmount = cEffXp(character as { elderFocus?: unknown }, amount);
    const levelCap = cExamCap(character);
    let updated = cReconcile(character) as Record<string, unknown>;
    updated = { ...updated, xp: Number(updated.level) >= C_MAX_LEVEL ? 0 : Number(updated.xp) + totalAmount };
    while (Number(updated.level) < C_MAX_LEVEL && Number(updated.level) < levelCap && Number(updated.xp) >= cXpNeeded(Number(updated.level))) {
        const needed = cXpNeeded(Number(updated.level));
        const newLevel = Number(updated.level) + 1;
        updated = {
            ...updated, xp: Number(updated.xp) - needed, level: newLevel,
            rankTitle: cRankTitle(updated, newLevel),
            maxHp: cMaxHp(newLevel), maxChakra: cMaxChakra(newLevel), maxStamina: cMaxStamina(newLevel),
            hp: cMaxHp(newLevel), chakra: cMaxChakra(newLevel), stamina: cMaxStamina(newLevel),
        };
    }
    if (Number(updated.level) >= levelCap && Number(updated.level) < C_MAX_LEVEL) {
        updated = { ...updated, xp: Math.min(Number(updated.xp), cXpNeeded(Number(updated.level)) - 1) };
    }
    if (Number(updated.level) >= C_MAX_LEVEL) {
        updated = { ...updated, level: C_MAX_LEVEL, xp: 0, rankTitle: cRankTitle(updated, C_MAX_LEVEL) };
    }
    return cReconcile(updated);
}

// ─── Sub-formula equivalence ────────────────────────────────────────────────
describe('xp-engine sub-formulas match the client', () => {
    it('xpNeeded / maxHp/Chakra/Stamina / rankFromLevel across all levels', () => {
        for (let lvl = 1; lvl <= 100; lvl++) {
            assert.equal(xpNeeded(lvl), cXpNeeded(lvl), `xpNeeded(${lvl})`);
            assert.equal(maxHpForLevel(lvl), cMaxHp(lvl), `maxHp(${lvl})`);
            assert.equal(maxChakraForLevel(lvl), cMaxChakra(lvl), `maxChakra(${lvl})`);
            assert.equal(maxStaminaForLevel(lvl), cMaxStamina(lvl), `maxStamina(${lvl})`);
            assert.equal(rankFromLevel(lvl), cRankFrom(lvl), `rankFromLevel(${lvl})`);
        }
    });
    it('effectiveCharacterXpGain applies the ×3 boost mult + elder bonus', () => {
        assert.equal(CHARACTER_XP_GAIN_MULTIPLIER, 3);
        for (const amt of [0, 1, 75, 100, 125, 250]) {
            assert.equal(effectiveCharacterXpGain({}, amt), cEffXp({}, amt), `plain ${amt}`);
            assert.equal(effectiveCharacterXpGain({ elderFocus: 'training' }, amt), cEffXp({ elderFocus: 'training' }, amt), `training ${amt}`);
        }
        assert.equal(effectiveCharacterXpGain({}, 100), 300);
        assert.equal(effectiveCharacterXpGain({ elderFocus: 'training' }, 100), 330);
    });
});

// ─── gainXp full-object sweep vs the inline client replica ───────────────────
describe('gainXp matches the client across a wide input sweep', () => {
    function mkChar(over: Record<string, unknown>): Record<string, unknown> {
        return {
            name: 'Sweep', level: 1, xp: 0, ryo: 1000, hp: 100, chakra: 100, stamina: 100,
            maxHp: 100, maxChakra: 100, maxStamina: 100, rankTitle: 'Academy Student',
            examsPassed: ['genin', 'chunin'], profession: 'none', ...over,
        };
    }
    it('produces an identical character object for every case', () => {
        const levels = [1, 5, 14, 15, 19, 20, 21, 38, 39, 40, 79, 80, 99, 100];
        const xps = [0, 50, 99, 500];
        const amounts = [0, 1, 75, 100, 125, 1000];
        const exams = [[], ['genin'], ['genin', 'chunin']];
        const elders = [undefined, 'training', 'war'];
        let cases = 0;
        for (const level of levels) for (const xp of xps) for (const amount of amounts) for (const examsPassed of exams) for (const elderFocus of elders) {
            const input = mkChar({ level, xp, examsPassed, ...(elderFocus ? { elderFocus } : {}) });
            assert.deepEqual(
                gainXp(structuredClone(input), amount),
                cGainXp(structuredClone(input), amount),
                `level=${level} xp=${xp} amt=${amount} exams=${examsPassed.join('+') || 'none'} elder=${elderFocus ?? 'none'}`,
            );
            cases++;
        }
        assert.ok(cases >= 3000, `swept ${cases} cases`);
    });
    it('preserves unrelated fields (ryo, name, custom) untouched except on level-up vitals', () => {
        const input = { name: 'Keep', level: 1, xp: 0, ryo: 777, custom: 'x', examsPassed: ['genin', 'chunin'], stats: {} };
        const out = gainXp(structuredClone(input), 0);
        assert.equal(out.ryo, 777);
        assert.equal(out.name, 'Keep');
        assert.equal(out.custom, 'x');
    });
});

// ─── Hand-computed golden anchors (cross-check the transcription) ────────────
describe('gainXp golden anchors', () => {
    it('+0 XP only normalizes stats + sets unspentStats (level 1 fresh = 20 budget)', () => {
        const out = gainXp({ level: 1, xp: 0, examsPassed: ['genin', 'chunin'], stats: {} }, 0);
        assert.equal(out.level, 1);
        assert.equal(out.xp, 0);
        assert.equal(out.unspentStats, 20);
    });
    it('level 1 + 100 base XP (×3 = 300) climbs to level 3, xp 0', () => {
        const out = gainXp({ level: 1, xp: 0, examsPassed: ['genin', 'chunin'], stats: {} }, 100);
        assert.equal(out.level, 3);
        assert.equal(out.xp, 0);
        assert.equal(out.maxHp, 300);
        assert.equal(out.hp, 300);
        assert.equal(out.maxChakra, 198);
        assert.equal(out.maxStamina, 198);
        assert.equal(out.rankTitle, 'Academy Student');
        assert.equal(out.unspentStats, 38);
    });
    it('exam gate clamps level + XP (no genin exam → cap 20)', () => {
        const out = gainXp({ level: 19, xp: 0, examsPassed: [], stats: {} }, 2000);
        assert.equal(out.level, 20);
        assert.equal(out.xp, 1999); // clamped to xpNeeded(20)-1
        assert.equal(out.rankTitle, 'Genin');
        assert.equal(out.maxHp, 2000);
    });
    it('clamps to MAX_LEVEL and 0 xp at the top', () => {
        const out = gainXp({ level: 99, xp: 0, examsPassed: ['genin', 'chunin'], stats: {} }, 5000);
        assert.equal(out.level, MAX_LEVEL);
        assert.equal(out.xp, 0);
    });
});

// ─── PvP-win reward composition ──────────────────────────────────────────────
describe('computePvpWinGains (verbatim handlePvpWin)', () => {
    const petChar = (trait: string | null, activePetId = 'p1') => ({
        activePetId,
        pets: trait ? [{ id: 'p1', trait }] : [{ id: 'p1' }],
    });
    it('base win: 100 XP / 75 ryo, no trait, no deaths gate', () => {
        const g = computePvpWinGains(petChar(null), 12);
        assert.deepEqual({ xpGain: g.xpGain, ryoGain: g.ryoGain }, { xpGain: 100, ryoGain: 75 });
    });
    it('Swift trait → 125 XP; Lucky trait → 90 ryo', () => {
        assert.equal(computePvpWinGains(petChar('Swift'), 12).xpGain, 125);
        assert.equal(computePvpWinGains(petChar('Swift'), 12).ryoGain, 75);
        assert.equal(computePvpWinGains(petChar('Lucky'), 12).ryoGain, 90);
        assert.equal(computePvpWinGains(petChar('Lucky'), 12).xpGain, 100);
    });
    it('Death\'s Gate (sector 99) doubles both', () => {
        const g = computePvpWinGains(petChar(null), 99);
        assert.deepEqual({ xpGain: g.xpGain, ryoGain: g.ryoGain }, { xpGain: 200, ryoGain: 150 });
        const swift = computePvpWinGains(petChar('Swift'), 99);
        assert.deepEqual({ xpGain: swift.xpGain, ryoGain: swift.ryoGain }, { xpGain: 250, ryoGain: 150 });
    });
    it('inactive pet trait is ignored (only the active pet counts)', () => {
        const g = computePvpWinGains({ activePetId: 'other', pets: [{ id: 'p1', trait: 'Swift' }] }, 12);
        assert.equal(g.xpGain, 100);
    });
});

describe('creditPvpWinBase', () => {
    it('applies gainXp then adds ryo, and the summary mirrors the credited char', () => {
        const base = { level: 1, xp: 0, ryo: 1000, examsPassed: ['genin', 'chunin'], stats: {} };
        const { xpGain, ryoGain } = computePvpWinGains({ activePetId: 'x', pets: [] }, 12); // 100 / 75
        const out = creditPvpWinBase(structuredClone(base), xpGain, ryoGain);
        const leveled = cGainXp(structuredClone(base), 100);
        assert.equal(out.char.level, leveled.level);
        assert.equal(out.char.xp, leveled.xp);
        assert.equal(out.char.ryo, 1075); // 1000 + 75
        assert.equal(out.summary.ryo, 1075);
        assert.equal(out.summary.level, Number(leveled.level));
        assert.equal(out.summary.xp, Number(leveled.xp));
    });
});

// ─── reconcile + rankTitle spot checks ──────────────────────────────────────
describe('reconcile + rankTitle edge cases', () => {
    it('reconcile normalizes garbage stats and floors unspent at 0', () => {
        const out = reconcileCharacterStatBudget({ level: 1, xp: 0, stats: { strength: 999999, speed: -5 } });
        const stats = out.stats as Record<string, number>;
        assert.equal(stats.strength, 2500); // capped at MAX_STAT
        assert.equal(stats.speed, 0);        // floored at 0
        assert.equal(out.unspentStats, 0);   // over-allocated → 0, never negative
    });
    it('rankTitleForLevel keeps a role title at max level but falls back below it', () => {
        assert.equal(rankTitleForLevel({ rankTitle: 'Kage', clanFounder: false }, 50), 'Jonin'); // below max → level title
        assert.equal(rankTitleForLevel({ rankTitle: 'Fifth Hokage', clanFounder: false }, 100), 'Fifth Hokage'); // role title kept at max
        assert.equal(rankTitleForLevel({ clanFounder: true }, 100), 'Clan Leader');
        assert.equal(rankTitleForLevel({}, 100), 'Special Jonin');
    });
});
