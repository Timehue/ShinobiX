"use strict";
/*
 * Server port of the bloodline point-budget math from
 * shinobij.client/src/lib/jutsu-points.ts. api/ is a separate build root with no
 * shared module, so the point table is duplicated here and guarded against drift
 * by the cross-build parity test (api/_cross-build-parity.test.ts).
 *
 * Why this exists (P0.1 sub-1): the point budget — the core PvP-balance knob —
 * is enforced ONLY client-side today (BloodlineMaker + lib/jutsu-points.ts), so a
 * forged save (public repo) can ship a bloodline whose jutsu each pass the
 * per-jutsu numeric clamps yet TOGETHER blow past the rank budget (extra
 * Stun/Copy/Wound/amp tags → real combat power above the ceiling). The save
 * normalizer and the PvP session loadout resolver call enforceBloodlineBudget to
 * clamp an over-budget bloodline down deterministically — never reject.
 *
 * Tag-helper mapping vs the client:
 *   client normalizeTagName  -> canonicalTagName (api/pvp/_tags.ts)
 *   client cappedDamageTags  -> CAPPED_AMP_TAGS  (identical members)
 *   client tagCapForRank     -> tagCapForRank below (S 40 / A·B 35 / else 30)
 *   client percentageTags    -> only "Wound" reaches that branch (amp tags are
 *                               caught by CAPPED_AMP_TAGS first), so we test it directly
 *   client hasFixedEffectPower -> jutsuHasFixedEffectPower (api/pvp/_tags.ts)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pointBudgetForRank = pointBudgetForRank;
exports.tagPointValue = tagPointValue;
exports.jutsuPoints = jutsuPoints;
exports.bloodlinePoints = bloodlinePoints;
exports.enforceBloodlineBudget = enforceBloodlineBudget;
const _tags_js_1 = require("./pvp/_tags.js");
/** Point budget per bloodline rank. Mirror of pointBudgetForRank (client). */
function pointBudgetForRank(rank) {
    return rank === 'S Rank' ? 11 : rank === 'A Rank' ? 10 : 7;
}
/** Per-rank percent cap for amp/DR tags. Mirror of tagCapForRank (client tags.ts). */
function tagCapForRank(rank) {
    if (rank === 'S Rank')
        return 40;
    if (rank === 'A Rank' || rank === 'B Rank')
        return 35;
    return 30; // global / no rank
}
/** Point cost of a single tag at a given rank. Mirror of tagPointValue (client). */
function tagPointValue(tag, rank) {
    if (typeof tag?.name !== 'string' || !tag.name)
        return 0;
    const name = (0, _tags_js_1.canonicalTagName)(tag.name);
    const percent = Number(tag.percent) || 0;
    // Amp / DR tags: at-cap bonus cost vs the below-cap floor (never free).
    if (_tags_js_1.CAPPED_AMP_TAGS.has(name)) {
        return percent >= tagCapForRank(rank) ? 0.75 : 0.25;
    }
    // Wound is the only percentage tag not caught by CAPPED_AMP_TAGS above.
    if (name === 'Wound') {
        if (percent >= 35)
            return 1;
        if (percent >= 30)
            return 0.5;
        return 0.25;
    }
    if (name === 'Copy' || name === 'Mirror')
        return 3;
    if (['Stun', 'Bloodline Seal', 'Lag', 'Overclock', 'Debuff Prevent', 'Buff Prevent'].includes(name))
        return 2;
    if (['Reflect', 'Cleanse Prevent', 'Clear Prevent', 'Heal', 'Elemental Seal'].includes(name))
        return 1.5;
    if (['Shield', 'Pierce', 'Wound', 'Barrier', 'Drain'].includes(name))
        return 1;
    if (name === 'Push')
        return 1;
    if (name === 'Pull')
        return 0.75;
    if (['Move', 'Poison', 'Ignition'].includes(name))
        return 0.5;
    return 1;
}
/** Rolled-up point cost of one jutsu at a given rank. Mirror of jutsuPoints. */
function jutsuPoints(jutsu, rank) {
    const tags = Array.isArray(jutsu?.tags) ? jutsu.tags : [];
    let sum = 0;
    for (const tag of tags) {
        if (!tag || typeof tag.name !== 'string' || !tag.name)
            continue;
        sum += tagPointValue(tag, rank);
    }
    const ap = Number(jutsu?.ap) || 0;
    const range = Number(jutsu?.range) || 0;
    const effectPower = Number(jutsu?.effectPower) || 0;
    const cooldown = Number(jutsu?.cooldown) || 0;
    if (ap === 40)
        sum += 1; // 40-AP utility
    if (range >= 5)
        sum += 0.5; // long range
    if (jutsu?.target === 'EMPTY_GROUND') { // ground methods
        if (jutsu.method === 'AOE_CIRCLE')
            sum += 0.5;
        else if (jutsu.method === 'INSTANT_EFFECT')
            sum += 1;
        else if (jutsu.method === 'AOE_SPIRAL')
            sum += 1;
    }
    const namedTags = tags.map((t) => ({ name: typeof t?.name === 'string' ? t.name : undefined }));
    if (!(0, _tags_js_1.jutsuHasFixedEffectPower)(namedTags) && ap === 60 && effectPower >= 45)
        sum += 1; // nuke
    if (cooldown <= 1)
        sum += 0.5; // low cooldown
    return sum;
}
/** Total points of a bloodline's jutsu at the bloodline's rank. */
function bloodlinePoints(jutsus, rank) {
    return (Array.isArray(jutsus) ? jutsus : []).reduce((s, j) => s + jutsuPoints(j, rank), 0);
}
/**
 * Clamp a bloodline's jutsu tags until total points <= the rank budget. Removes
 * the LOWEST-point tags first (ties → earliest jutsu, then earliest tag), so an
 * honest near-budget loadout loses the least identity per point reclaimed. Returns
 * a NEW array (inputs untouched); only TAGS are removed — never a jutsu, never a
 * structural field (AP/range/method/cooldown). Clamp, NEVER reject. Honest
 * within-budget loadouts return deep-equal (no-op).
 */
function enforceBloodlineBudget(jutsus, rank) {
    if (!Array.isArray(jutsus) || jutsus.length === 0)
        return jutsus;
    const budget = pointBudgetForRank(rank);
    // Shallow-clone each jutsu + its tag array so we can splice without mutating input.
    const out = jutsus.map((j) => j && typeof j === 'object'
        ? { ...j, ...(Array.isArray(j.tags) ? { tags: [...j.tags] } : {}) }
        : j);
    if (bloodlinePoints(out, rank) <= budget)
        return out;
    // Remove one lowest-point tag per pass, recomputing the total (loadouts are
    // tiny; the guard caps pathological inputs). Removing a fixed-effect tag can
    // re-enable a jutsu's +1 nuke cost, but the net per removal is still negative,
    // so the total strictly trends down and converges.
    let guard = 0;
    while (bloodlinePoints(out, rank) > budget && guard++ < 500) {
        let best = null;
        for (let ji = 0; ji < out.length; ji++) {
            const tags = Array.isArray(out[ji]?.tags) ? out[ji].tags : null;
            if (!tags)
                continue;
            for (let ti = 0; ti < tags.length; ti++) {
                const t = tags[ti];
                if (!t || typeof t.name !== 'string' || !t.name)
                    continue;
                const pts = tagPointValue(t, rank);
                if (pts <= 0)
                    continue;
                if (!best || pts < best.pts)
                    best = { ji, ti, pts }; // lowest first; stable on ties
            }
        }
        if (!best)
            break; // no removable tags remain
        out[best.ji].tags.splice(best.ti, 1);
    }
    return out;
}
