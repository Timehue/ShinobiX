"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUSPICION_RARITY_CAP = exports.LEGACY_OVERLAY_KEY = void 0;
exports.getLegacyOverlay = getLegacyOverlay;
exports.evaluateLegacy = evaluateLegacy;
exports.evaluateAllLegacies = evaluateAllLegacies;
exports.pickSageOffers = pickSageOffers;
/*
 * Legacy eligibility scoring — pure evaluation of the 100-legacy roster
 * (api/_legacy-defs.ts) against a player's server-owned counters
 * (api/_legacy-track.ts). Everything here is deterministic and unit-tested;
 * the only KV touch is reading the admin tuning overlay.
 *
 * Anti-gaming posture (docs/legacy-system-plan.md §5.2):
 *  - repeat-kill decay and level-gap zeroing happen at TRACKING time,
 *  - the multi-proof rule is structural in the defs (lint-tested),
 *  - suspicionFlags above the cap locks legendary/mythic offers here,
 *  - thresholds are runtime-tunable via `shared:legacy-defs` without a deploy.
 */
const _storage_js_1 = require("./_storage.js");
const _legacy_defs_js_1 = require("./_legacy-defs.js");
exports.LEGACY_OVERLAY_KEY = 'shared:legacy-defs';
async function getLegacyOverlay() {
    try {
        const raw = await _storage_js_1.kv.get(exports.LEGACY_OVERLAY_KEY);
        return raw && typeof raw === 'object' ? raw : {};
    }
    catch {
        return {};
    }
}
/** suspicionFlags above this cap locks the player out of legendary/mythic offers. */
exports.SUSPICION_RARITY_CAP = 2;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function floorFor(def, stat, base, overlay) {
    const o = overlay.thresholds?.[def.id]?.[stat];
    return Number.isFinite(Number(o)) && Number(o) > 0 ? Number(o) : base;
}
function evaluateLegacy(def, stats, opts = {}) {
    const overlay = opts.overlay ?? {};
    const reasons = [];
    const missing = [];
    let weightSum = 0;
    let scoreSum = 0;
    let allPass = true;
    for (const req of def.reqs) {
        const floors = 'stat' in req ? [req] : req.anyOf;
        const anyMode = !('stat' in req);
        let bestRatio = 0;
        let passed = false;
        const parts = [];
        for (const f of floors) {
            const floor = floorFor(def, f.stat, f.atLeast, overlay);
            const value = num(stats[f.stat]);
            const ratio = floor > 0 ? value / floor : 1;
            bestRatio = Math.max(bestRatio, ratio);
            if (value >= floor)
                passed = true;
            parts.push(`${f.stat} ${Math.floor(value).toLocaleString('en-US')}/${floor.toLocaleString('en-US')}`);
        }
        const weight = 'stat' in req ? (req.weight ?? 1) : 1;
        weightSum += weight;
        scoreSum += weight * Math.min(bestRatio, 2);
        const label = (anyMode ? 'any of: ' : '') + parts.join(' | ');
        if (passed) {
            reasons.push(`✓ ${label}`);
        }
        else {
            allPass = false;
            missing.push(label);
            reasons.push(`✗ ${label}`);
        }
    }
    let score = weightSum > 0 ? scoreSum / weightSum : 0;
    if (def.villageAffinity && opts.village &&
        opts.village.toLowerCase().includes(def.villageAffinity.toLowerCase())) {
        score *= 1.15;
    }
    return {
        legacyId: def.id, name: def.name, rarity: def.rarity, category: def.category,
        eligible: allPass, score: Math.round(score * 1000) / 1000, reasons, missing,
    };
}
function evaluateAllLegacies(stats, opts = {}) {
    const overlay = opts.overlay ?? {};
    const disabled = new Set(overlay.disabled ?? []);
    const suspicious = num(stats.suspicionFlags) > exports.SUSPICION_RARITY_CAP;
    const underLevel = (opts.level ?? 0) < _legacy_defs_js_1.LEGACY_MIN_LEVEL;
    const out = [];
    for (const def of _legacy_defs_js_1.LEGACY_DEFS) {
        if (disabled.has(def.id))
            continue;
        const ev = evaluateLegacy(def, stats, { village: opts.village, overlay });
        if (underLevel && ev.eligible) {
            ev.eligible = false;
            ev.missing = [`level ${opts.level ?? 0}/${_legacy_defs_js_1.LEGACY_MIN_LEVEL}`, ...ev.missing];
        }
        if (suspicious && ev.eligible && _legacy_defs_js_1.RARITY_ORDER[ev.rarity] >= _legacy_defs_js_1.RARITY_ORDER.legendary) {
            ev.eligible = false;
            ev.missing = ['flagged for review — high-tier paths are sealed', ...ev.missing];
        }
        out.push(ev);
    }
    // Highest rarity first, then score — a stable, readable ordering everywhere.
    out.sort((a, b) => (_legacy_defs_js_1.RARITY_ORDER[b.rarity] - _legacy_defs_js_1.RARITY_ORDER[a.rarity]) || (b.score - a.score));
    return out;
}
/**
 * The Sage's offer set: best-fit + alternate (different category when
 * possible) + a basic fallback, max 3 (design handoff rule). Assumes `evals`
 * came from evaluateAllLegacies (already sorted).
 */
function pickSageOffers(evals, max = 3) {
    const eligible = evals.filter((e) => e.eligible);
    if (eligible.length === 0)
        return [];
    const offers = [];
    const best = eligible[0];
    offers.push(best);
    const alternate = eligible.find((e) => e !== best && e.category !== best.category)
        ?? eligible.find((e) => e !== best);
    if (alternate)
        offers.push(alternate);
    if (offers.length < max) {
        const fallback = eligible.find((e) => e.rarity === 'basic' && !offers.includes(e));
        if (fallback)
            offers.push(fallback);
    }
    return offers.slice(0, max);
}
