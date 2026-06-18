"use strict";
/*
 * Server-side mirror of the profession-mastery point RULES, used by the save
 * sanitizer (api/save/[name].ts) to anti-tamper a player's masterySpec: a forged
 * spec can't grant more points than the player's mastery LEVEL allows, can't
 * exceed node max-ranks, and can't unlock a capstone without the path gate.
 *
 * KEEP node ids / paths / costs / the XP wall in sync with
 * shinobij.client/src/lib/profession-mastery.ts (the canonical, fuller copy).
 * This mirror only needs the structural metadata, not the effect text — same
 * client/server duplication pattern as professionLogic.ts ↔ missions/_progress.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.masteryBudget = masteryBudget;
exports.masteryBonus = masteryBonus;
exports.masteryHasCapstone = masteryHasCapstone;
exports.sanitizeMasterySpec = sanitizeMasterySpec;
const NODE_COST = 1;
const CAPSTONE_COST = 2;
const CAPSTONE_GATE = 4;
const MASTERY_MAX_LEVEL = 10;
const MASTERY_XP_PER_LEVEL = 15_000;
// Rank-10 XP wall = last finite profession-XP threshold. Baseline (Vanguard /
// Pet Tamer) = 32850; Healer = ×1.5 = 49275. Mirrors constants/profession.ts.
const RANK10_XP = { vanguard: 32_850, petTamer: 32_850, healer: 49_275 };
function nd(id, path, effectKey, perRank) { return { id, path, effectKey, perRank }; }
function cap(id, path) { return { id, path, capstone: true }; }
const TREES = {
    healer: [
        nd('heal-cooldown', 'triage', 'healCooldownPct', 5), nd('heal-tireless', 'triage', 'healCooldownPct', 5), cap('mass-triage', 'triage'),
        nd('heal-xp', 'restoration', 'healXpPct', 6), nd('heal-discharge', 'restoration', 'healDischargePct', 6), cap('full-recovery', 'restoration'),
        nd('heal-support', 'outreach', 'healXpPct', 6), nd('heal-vigil', 'outreach', 'healCooldownPct', 5), cap('village-lifeline', 'outreach'),
    ],
    vanguard: [
        nd('seal-gap', 'reaver', 'sealGapSoftenPct', 10), nd('seal-cap', 'reaver', 'sealDailyCapFlat', 5), cap('warmonger', 'reaver'),
        nd('seal-train-cost', 'quartermaster', 'sealTrainCostPct', 5), nd('seal-speedup', 'quartermaster', 'sealSpeedupCostPct', 5), cap('logistician', 'quartermaster'),
        nd('stamina', 'warden', 'maxStaminaPct', 4), nd('ai-damage', 'warden', 'pveAiDamagePct', 3), cap('ironclad', 'warden'),
    ],
    petTamer: [
        nd('exp-rewards', 'expeditioner', 'expRewardPct', 5), nd('exp-materials', 'expeditioner', 'expMaterialPct', 5), cap('caravan-master', 'expeditioner'),
        nd('pet-damage', 'beast-handler', 'petPveDamagePct', 2), nd('pet-hp', 'beast-handler', 'petPveHpPct', 4), cap('alpha-bond', 'beast-handler'),
        nd('train-time', 'trainer', 'petTrainTimePct', 5), nd('train-xp', 'trainer', 'petTrainXpPct', 6), cap('prodigy', 'trainer'),
    ],
};
function num(v) { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : 0; }
function maxRank(n) { return n.capstone ? 1 : 3; }
function cost(n) { return n.capstone ? CAPSTONE_COST : NODE_COST; }
function isProf(p) { return p === 'healer' || p === 'vanguard' || p === 'petTamer'; }
/** Mastery level (= point budget) from profession XP earned past the rank-10 wall. */
function masteryBudget(profession, professionXp) {
    if (!isProf(profession))
        return 0;
    const over = num(professionXp) - RANK10_XP[profession];
    if (over <= 0)
        return 0;
    return Math.min(MASTERY_MAX_LEVEL, Math.floor(over / MASTERY_XP_PER_LEVEL));
}
/**
 * Resolved magnitude for an effect key from a player's (already-sanitized) spec.
 * Callers apply this PvE-only. Pass the character's profession + masterySpec.
 */
function masteryBonus(profession, spec, effectKey) {
    if (!isProf(profession) || !spec || typeof spec !== 'object')
        return 0;
    const s = spec;
    let total = 0;
    for (const n of TREES[profession]) {
        if (n.effectKey !== effectKey || !n.perRank)
            continue;
        total += Math.max(0, Math.min(maxRank(n), num(s[n.id]))) * n.perRank;
    }
    return total;
}
/** Is a capstone unlocked in this spec? */
function masteryHasCapstone(profession, spec, capstoneId) {
    if (!isProf(profession) || !spec || typeof spec !== 'object')
        return false;
    const n = TREES[profession].find(m => m.id === capstoneId && m.capstone);
    if (!n)
        return false;
    return num(spec[capstoneId]) >= 1;
}
/**
 * Clamp a (possibly forged) masterySpec to what `budget` allows: legal node ids,
 * ranks ≤ max, capstone gates satisfied, total spend ≤ budget. Greedy: normal
 * nodes first (in catalog order), then capstones whose path gate is met.
 */
function sanitizeMasterySpec(profession, rawSpec, budget) {
    if (!isProf(profession) || !rawSpec || typeof rawSpec !== 'object')
        return {};
    const raw = rawSpec;
    const tree = TREES[profession];
    const out = {};
    let spent = 0;
    for (const n of tree) {
        if (n.capstone)
            continue;
        const want = Math.max(0, Math.min(maxRank(n), num(raw[n.id])));
        const afford = Math.max(0, Math.min(want, Math.floor((budget - spent) / cost(n))));
        if (afford > 0) {
            out[n.id] = afford;
            spent += afford * cost(n);
        }
    }
    for (const n of tree) {
        if (!n.capstone)
            continue;
        if (num(raw[n.id]) < 1)
            continue;
        const pathPts = tree.reduce((s, m) => (m.path === n.path && !m.capstone ? s + (out[m.id] ?? 0) * cost(m) : s), 0);
        if (pathPts >= CAPSTONE_GATE && spent + cost(n) <= budget) {
            out[n.id] = 1;
            spent += cost(n);
        }
    }
    return out;
}
