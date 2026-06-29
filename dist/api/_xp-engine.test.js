"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _xp_engine_js_1 = require("./_xp-engine.js");
// ─── Independent inline replica of the CLIENT level engine ──────────────────
// Transcribed straight from shinobij.client/src/lib/{stats,progression,
// character-progress}.ts + App.tsx {examLevelCap, gainXp}. This is a SEPARATE
// copy from api/_xp-engine.ts so a transcription drift on either side fails the
// sweep below. If the client formula changes, BOTH this replica and the port
// must change in lockstep — that's the point (the "server == client" rule).
const C_MAX_LEVEL = 100, C_MAX_STAT = 2500, C_STARTING = 20, C_MULT = 1;
const C_HP_CAP = 10000, C_CHAKRA_CAP = 5000, C_STAMINA_CAP = 5000;
const C_KEYS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
];
const cCap = (v) => Math.min(C_MAX_STAT, Math.max(0, Math.floor(v)));
const cBase = () => Object.fromEntries(C_KEYS.map(k => [k, 10]));
function cNorm(stats) {
    const base = cBase();
    return C_KEYS.reduce((n, k) => { n[k] = cCap(stats?.[k] == null ? base[k] : Number(stats[k])); return n; }, { ...base });
}
const cAllocated = (s) => C_KEYS.reduce((t, k) => t + Math.max(0, cCap(s[k]) - 10), 0);
const cXpNeeded = (lvl) => lvl >= C_MAX_LEVEL ? 0 : Math.round(3 * lvl * lvl);
const cMaxHp = (lvl) => Math.min(C_HP_CAP, 500 + (Math.max(1, lvl) - 1) * 100);
const cMaxChakra = (lvl) => Math.min(C_CHAKRA_CAP, Math.floor(100 + (Math.max(1, lvl) - 1) * ((C_CHAKRA_CAP - 100) / (C_MAX_LEVEL - 1))));
const cMaxStamina = (lvl) => Math.min(C_STAMINA_CAP, Math.floor(100 + (Math.max(1, lvl) - 1) * ((C_STAMINA_CAP - 100) / (C_MAX_LEVEL - 1))));
const cRankFrom = (lvl) => lvl >= 80 ? 'Special Jonin' : lvl >= 50 ? 'Jonin' : lvl >= 30 ? 'Chunin' : lvl >= 15 ? 'Genin' : 'Academy Student';
const C_TOTAL_PTS = C_KEYS.reduce((t, k) => t + (C_MAX_STAT - cBase()[k]), 0);
const C_PTS_FROM_XP = C_TOTAL_PTS - C_STARTING;
const cStatBudgetAtLevel = (lvl) => { const l = Math.max(1, Math.min(C_MAX_LEVEL, Math.floor(lvl))); return C_STARTING + Math.round(((l - 1) / (C_MAX_LEVEL - 1)) * C_PTS_FROM_XP); };
const cBudget = (lvl, xp) => {
    if (lvl >= C_MAX_LEVEL)
        return C_TOTAL_PTS;
    const base = cStatBudgetAtLevel(lvl), next = cStatBudgetAtLevel(lvl + 1), need = cXpNeeded(lvl);
    const frac = need > 0 ? Math.max(0, Math.min(1, Math.floor(xp) / need)) : 0;
    return Math.min(C_TOTAL_PTS, Math.round(base + (next - base) * frac));
};
function cReconcile(ch) {
    const stats = cNorm(ch.stats);
    const available = Math.max(0, cBudget(Number(ch.level), Number(ch.xp)) - cAllocated(stats));
    return { ...ch, stats, unspentStats: available };
}
const cEffXp = (ch, amount) => {
    const base = Math.max(0, Math.floor(amount));
    const boosted = Math.floor(base * C_MULT);
    return boosted + (ch.elderFocus === 'training' ? Math.floor(boosted * 0.1) : 0);
};
const cLevelOnly = new Set(['Academy Student', 'Genin', 'Chunin', 'Jonin', 'Elite Jonin', 'Special Jonin', 'Kage', 'Legendary Kage']);
function cRoleTitle(ch) {
    const cur = typeof ch.rankTitle === 'string' ? ch.rankTitle.trim() : '';
    const low = cur.toLowerCase();
    const isRole = low.includes('kage') || low.includes('elder') || low.includes('anbu') || low.includes('clan leader') || low.includes('clan head');
    if (cur && isRole && !cLevelOnly.has(cur))
        return cur;
    if (ch.clanFounder)
        return 'Clan Leader';
    return '';
}
const cRankTitle = (ch, lvl) => lvl < C_MAX_LEVEL ? cRankFrom(lvl) : (cRoleTitle(ch) || 'Special Jonin');
const C_GATES = [{ exam: 'genin', level: 20 }, { exam: 'chunin', level: 39 }];
function cExamCap(ch) {
    const passed = Array.isArray(ch.examsPassed) ? ch.examsPassed : [];
    for (const g of C_GATES)
        if (!passed.includes(g.exam))
            return g.level;
    return C_MAX_LEVEL;
}
function cGainXp(character, amount) {
    const totalAmount = cEffXp(character, amount);
    const levelCap = cExamCap(character);
    let updated = cReconcile(character);
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
(0, node_test_1.describe)('xp-engine sub-formulas match the client', () => {
    (0, node_test_1.it)('xpNeeded / maxHp/Chakra/Stamina / rankFromLevel across all levels', () => {
        for (let lvl = 1; lvl <= 100; lvl++) {
            node_assert_1.strict.equal((0, _xp_engine_js_1.xpNeeded)(lvl), cXpNeeded(lvl), `xpNeeded(${lvl})`);
            node_assert_1.strict.equal((0, _xp_engine_js_1.maxHpForLevel)(lvl), cMaxHp(lvl), `maxHp(${lvl})`);
            node_assert_1.strict.equal((0, _xp_engine_js_1.maxChakraForLevel)(lvl), cMaxChakra(lvl), `maxChakra(${lvl})`);
            node_assert_1.strict.equal((0, _xp_engine_js_1.maxStaminaForLevel)(lvl), cMaxStamina(lvl), `maxStamina(${lvl})`);
            node_assert_1.strict.equal((0, _xp_engine_js_1.rankFromLevel)(lvl), cRankFrom(lvl), `rankFromLevel(${lvl})`);
        }
    });
    (0, node_test_1.it)('effectiveCharacterXpGain applies the ×1 (real) mult + elder bonus', () => {
        node_assert_1.strict.equal(_xp_engine_js_1.CHARACTER_XP_GAIN_MULTIPLIER, 1);
        for (const amt of [0, 1, 75, 100, 125, 250]) {
            node_assert_1.strict.equal((0, _xp_engine_js_1.effectiveCharacterXpGain)({}, amt), cEffXp({}, amt), `plain ${amt}`);
            node_assert_1.strict.equal((0, _xp_engine_js_1.effectiveCharacterXpGain)({ elderFocus: 'training' }, amt), cEffXp({ elderFocus: 'training' }, amt), `training ${amt}`);
        }
        node_assert_1.strict.equal((0, _xp_engine_js_1.effectiveCharacterXpGain)({}, 100), 100);
        node_assert_1.strict.equal((0, _xp_engine_js_1.effectiveCharacterXpGain)({ elderFocus: 'training' }, 100), 110);
    });
});
// ─── gainXp full-object sweep vs the inline client replica ───────────────────
(0, node_test_1.describe)('gainXp matches the client across a wide input sweep', () => {
    function mkChar(over) {
        return {
            name: 'Sweep', level: 1, xp: 0, ryo: 1000, hp: 100, chakra: 100, stamina: 100,
            maxHp: 100, maxChakra: 100, maxStamina: 100, rankTitle: 'Academy Student',
            examsPassed: ['genin', 'chunin'], profession: 'none', ...over,
        };
    }
    (0, node_test_1.it)('produces an identical character object for every case', () => {
        const levels = [1, 5, 14, 15, 19, 20, 21, 38, 39, 40, 79, 80, 99, 100];
        const xps = [0, 50, 99, 500];
        const amounts = [0, 1, 75, 100, 125, 1000];
        const exams = [[], ['genin'], ['genin', 'chunin']];
        const elders = [undefined, 'training', 'war'];
        let cases = 0;
        for (const level of levels)
            for (const xp of xps)
                for (const amount of amounts)
                    for (const examsPassed of exams)
                        for (const elderFocus of elders) {
                            const input = mkChar({ level, xp, examsPassed, ...(elderFocus ? { elderFocus } : {}) });
                            node_assert_1.strict.deepEqual((0, _xp_engine_js_1.gainXp)(structuredClone(input), amount), cGainXp(structuredClone(input), amount), `level=${level} xp=${xp} amt=${amount} exams=${examsPassed.join('+') || 'none'} elder=${elderFocus ?? 'none'}`);
                            cases++;
                        }
        node_assert_1.strict.ok(cases >= 3000, `swept ${cases} cases`);
    });
    (0, node_test_1.it)('preserves unrelated fields (ryo, name, custom) untouched except on level-up vitals', () => {
        const input = { name: 'Keep', level: 1, xp: 0, ryo: 777, custom: 'x', examsPassed: ['genin', 'chunin'], stats: {} };
        const out = (0, _xp_engine_js_1.gainXp)(structuredClone(input), 0);
        node_assert_1.strict.equal(out.ryo, 777);
        node_assert_1.strict.equal(out.name, 'Keep');
        node_assert_1.strict.equal(out.custom, 'x');
    });
});
// ─── Hand-computed golden anchors (cross-check the transcription) ────────────
(0, node_test_1.describe)('gainXp golden anchors', () => {
    (0, node_test_1.it)('+0 XP only normalizes stats + sets unspentStats (level 1 fresh = 20 budget)', () => {
        const out = (0, _xp_engine_js_1.gainXp)({ level: 1, xp: 0, examsPassed: ['genin', 'chunin'], stats: {} }, 0);
        node_assert_1.strict.equal(out.level, 1);
        node_assert_1.strict.equal(out.xp, 0);
        node_assert_1.strict.equal(out.unspentStats, 20);
    });
    (0, node_test_1.it)('level 1 + 100 base XP (×1 = 100) climbs to level 5, xp 10', () => {
        // Under 3·L² the early curve is cheap: xpNeeded 1..4 = 3+12+27+48 = 90,
        // so 100 XP reaches L5 with 10 left over.
        const out = (0, _xp_engine_js_1.gainXp)({ level: 1, xp: 0, examsPassed: ['genin', 'chunin'], stats: {} }, 100);
        node_assert_1.strict.equal(out.level, 5);
        node_assert_1.strict.equal(out.xp, 10);
        node_assert_1.strict.equal(out.maxHp, 900); // maxHpForLevel(5): 500 base + 4×100
        node_assert_1.strict.equal(out.hp, 900);
        node_assert_1.strict.equal(out.maxChakra, 297);
        node_assert_1.strict.equal(out.maxStamina, 297);
        node_assert_1.strict.equal(out.rankTitle, 'Academy Student');
        node_assert_1.strict.equal(out.unspentStats, 1266); // linear budget, interpolated at (5, 10)
    });
    (0, node_test_1.it)('exam gate clamps level + XP (no genin exam → cap 20)', () => {
        const out = (0, _xp_engine_js_1.gainXp)({ level: 19, xp: 0, examsPassed: [], stats: {} }, 2000);
        node_assert_1.strict.equal(out.level, 20);
        node_assert_1.strict.equal(out.xp, 917); // +2000 overflows L19 (need 1083) by 917; cap-20 stops the loop before the clamp bites
        node_assert_1.strict.equal(out.rankTitle, 'Genin');
        node_assert_1.strict.equal(out.maxHp, 2400); // maxHpForLevel(20): 500 base + 19×100
    });
    (0, node_test_1.it)('clamps to MAX_LEVEL and 0 xp at the top', () => {
        // xpNeeded(99) = 29403 under 3·L², so the amount must exceed it to ding 100.
        const out = (0, _xp_engine_js_1.gainXp)({ level: 99, xp: 0, examsPassed: ['genin', 'chunin'], stats: {} }, 30000);
        node_assert_1.strict.equal(out.level, _xp_engine_js_1.MAX_LEVEL);
        node_assert_1.strict.equal(out.xp, 0);
    });
});
// ─── PvP-win reward composition ──────────────────────────────────────────────
(0, node_test_1.describe)('computePvpWinGains (verbatim handlePvpWin)', () => {
    const petChar = (trait, activePetId = 'p1') => ({
        activePetId,
        pets: trait ? [{ id: 'p1', trait }] : [{ id: 'p1' }],
    });
    (0, node_test_1.it)('base win: 100 XP / 75 ryo, no trait, no deaths gate', () => {
        const g = (0, _xp_engine_js_1.computePvpWinGains)(petChar(null), 12);
        node_assert_1.strict.deepEqual({ xpGain: g.xpGain, ryoGain: g.ryoGain }, { xpGain: 100, ryoGain: 75 });
    });
    (0, node_test_1.it)('Swift trait → 125 XP; Lucky trait → 90 ryo', () => {
        node_assert_1.strict.equal((0, _xp_engine_js_1.computePvpWinGains)(petChar('Swift'), 12).xpGain, 125);
        node_assert_1.strict.equal((0, _xp_engine_js_1.computePvpWinGains)(petChar('Swift'), 12).ryoGain, 75);
        node_assert_1.strict.equal((0, _xp_engine_js_1.computePvpWinGains)(petChar('Lucky'), 12).ryoGain, 90);
        node_assert_1.strict.equal((0, _xp_engine_js_1.computePvpWinGains)(petChar('Lucky'), 12).xpGain, 100);
    });
    (0, node_test_1.it)('Death\'s Gate (sector 99) doubles both', () => {
        const g = (0, _xp_engine_js_1.computePvpWinGains)(petChar(null), 99);
        node_assert_1.strict.deepEqual({ xpGain: g.xpGain, ryoGain: g.ryoGain }, { xpGain: 200, ryoGain: 150 });
        const swift = (0, _xp_engine_js_1.computePvpWinGains)(petChar('Swift'), 99);
        node_assert_1.strict.deepEqual({ xpGain: swift.xpGain, ryoGain: swift.ryoGain }, { xpGain: 250, ryoGain: 150 });
    });
    (0, node_test_1.it)('inactive pet trait is ignored (only the active pet counts)', () => {
        const g = (0, _xp_engine_js_1.computePvpWinGains)({ activePetId: 'other', pets: [{ id: 'p1', trait: 'Swift' }] }, 12);
        node_assert_1.strict.equal(g.xpGain, 100);
    });
});
(0, node_test_1.describe)('creditPvpWinBase', () => {
    (0, node_test_1.it)('applies gainXp then adds ryo, and the summary mirrors the credited char', () => {
        const base = { level: 1, xp: 0, ryo: 1000, examsPassed: ['genin', 'chunin'], stats: {} };
        const { xpGain, ryoGain } = (0, _xp_engine_js_1.computePvpWinGains)({ activePetId: 'x', pets: [] }, 12); // 100 / 75
        const out = (0, _xp_engine_js_1.creditPvpWinBase)(structuredClone(base), xpGain, ryoGain);
        const leveled = cGainXp(structuredClone(base), 100);
        node_assert_1.strict.equal(out.char.level, leveled.level);
        node_assert_1.strict.equal(out.char.xp, leveled.xp);
        node_assert_1.strict.equal(out.char.ryo, 1075); // 1000 + 75
        node_assert_1.strict.equal(out.summary.ryo, 1075);
        node_assert_1.strict.equal(out.summary.level, Number(leveled.level));
        node_assert_1.strict.equal(out.summary.xp, Number(leveled.xp));
    });
});
// ─── reconcile + rankTitle spot checks ──────────────────────────────────────
(0, node_test_1.describe)('reconcile + rankTitle edge cases', () => {
    (0, node_test_1.it)('reconcile normalizes garbage stats and floors unspent at 0', () => {
        const out = (0, _xp_engine_js_1.reconcileCharacterStatBudget)({ level: 1, xp: 0, stats: { strength: 999999, speed: -5 } });
        const stats = out.stats;
        node_assert_1.strict.equal(stats.strength, 2500); // capped at MAX_STAT
        node_assert_1.strict.equal(stats.speed, 0); // floored at 0
        node_assert_1.strict.equal(out.unspentStats, 0); // over-allocated → 0, never negative
    });
    (0, node_test_1.it)('rankTitleForLevel keeps a role title at max level but falls back below it', () => {
        node_assert_1.strict.equal((0, _xp_engine_js_1.rankTitleForLevel)({ rankTitle: 'Kage', clanFounder: false }, 50), 'Jonin'); // below max → level title
        node_assert_1.strict.equal((0, _xp_engine_js_1.rankTitleForLevel)({ rankTitle: 'Fifth Hokage', clanFounder: false }, 100), 'Fifth Hokage'); // role title kept at max
        node_assert_1.strict.equal((0, _xp_engine_js_1.rankTitleForLevel)({ clanFounder: true }, 100), 'Clan Leader');
        node_assert_1.strict.equal((0, _xp_engine_js_1.rankTitleForLevel)({}, 100), 'Special Jonin');
    });
});
