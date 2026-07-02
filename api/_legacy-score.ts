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
import { kv } from './_storage.js';
import {
    LEGACY_DEFS, LEGACY_MIN_LEVEL, RARITY_ORDER,
    type LegacyDef, type LegacyRarity, type LegacyStatKey,
} from './_legacy-defs.js';
import type { LegacyStats } from './_legacy-track.js';

/** Admin tuning overlay, stored at shared:legacy-defs. All fields optional. */
export type LegacyOverlay = {
    /** Per-legacy absolute threshold overrides: legacyId -> stat -> new floor. */
    thresholds?: Record<string, Partial<Record<LegacyStatKey, number>>>;
    /** Legacy ids removed from offers entirely. */
    disabled?: string[];
    /** Wandering Sage spawn tuning (consumed by api/legacy/sage.ts). */
    sage?: {
        baseChance?: number;        // default 0.05
        pityPerDay?: number;        // default 0.05
        guaranteeDays?: number;     // default 7
        dailyRollCap?: number;      // default 6
        declineCooldownDays?: number; // default 3
    };
};

export const LEGACY_OVERLAY_KEY = 'shared:legacy-defs';

export async function getLegacyOverlay(): Promise<LegacyOverlay> {
    try {
        const raw = await kv.get<LegacyOverlay>(LEGACY_OVERLAY_KEY);
        return raw && typeof raw === 'object' ? raw : {};
    } catch {
        return {};
    }
}

/** suspicionFlags above this cap locks the player out of legendary/mythic offers. */
export const SUSPICION_RARITY_CAP = 2;

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

export type LegacyEvaluation = {
    legacyId: string;
    name: string;
    rarity: LegacyRarity;
    category: string;
    eligible: boolean;
    /** Weighted progress score; >= 1 does not imply eligible (floors are AND). */
    score: number;
    /** Human-readable per-requirement progress, for the Sage + admin views. */
    reasons: string[];
    /** Requirements still unmet (empty when eligible). */
    missing: string[];
};

function floorFor(def: LegacyDef, stat: LegacyStatKey, base: number, overlay: LegacyOverlay): number {
    const o = Number(overlay.thresholds?.[def.id]?.[stat]);
    // An explicit overlay 0 WAIVES the requirement (every value passes a
    // 0 floor) — the admin hot-fix lever for a requirement that turns out to
    // be broken in production (verification finding: the old >0 check made a
    // dead requirement untunable at runtime).
    return Number.isFinite(o) && o >= 0 ? o : base;
}

export function evaluateLegacy(
    def: LegacyDef,
    stats: LegacyStats,
    opts: { village?: string | null; overlay?: LegacyOverlay } = {},
): LegacyEvaluation {
    const overlay = opts.overlay ?? {};
    const reasons: string[] = [];
    const missing: string[] = [];
    let weightSum = 0;
    let scoreSum = 0;
    let allPass = true;

    for (const req of def.reqs) {
        const floors = 'stat' in req ? [req] : req.anyOf;
        const anyMode = !('stat' in req);
        let bestRatio = 0;
        let passed = false;
        const parts: string[] = [];
        for (const f of floors) {
            const floor = floorFor(def, f.stat, f.atLeast, overlay);
            const value = num(stats[f.stat]);
            const ratio = floor > 0 ? value / floor : 1;
            bestRatio = Math.max(bestRatio, ratio);
            if (value >= floor) passed = true;
            parts.push(`${f.stat} ${Math.floor(value).toLocaleString('en-US')}/${floor.toLocaleString('en-US')}`);
        }
        const weight = 'stat' in req ? (req.weight ?? 1) : 1;
        weightSum += weight;
        scoreSum += weight * Math.min(bestRatio, 2);
        const label = (anyMode ? 'any of: ' : '') + parts.join(' | ');
        if (passed) {
            reasons.push(`✓ ${label}`);
        } else {
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

export function evaluateAllLegacies(
    stats: LegacyStats,
    opts: { level?: number; village?: string | null; overlay?: LegacyOverlay } = {},
): LegacyEvaluation[] {
    const overlay = opts.overlay ?? {};
    const disabled = new Set(overlay.disabled ?? []);
    const suspicious = num(stats.suspicionFlags) > SUSPICION_RARITY_CAP;
    const underLevel = (opts.level ?? 0) < LEGACY_MIN_LEVEL;
    const out: LegacyEvaluation[] = [];
    for (const def of LEGACY_DEFS) {
        if (disabled.has(def.id)) continue;
        const ev = evaluateLegacy(def, stats, { village: opts.village, overlay });
        if (underLevel && ev.eligible) {
            ev.eligible = false;
            ev.missing = [`level ${opts.level ?? 0}/${LEGACY_MIN_LEVEL}`, ...ev.missing];
        }
        if (suspicious && ev.eligible && RARITY_ORDER[ev.rarity] >= RARITY_ORDER.legendary) {
            ev.eligible = false;
            ev.missing = ['flagged for review — high-tier paths are sealed', ...ev.missing];
        }
        out.push(ev);
    }
    // Highest rarity first, then score — a stable, readable ordering everywhere.
    out.sort((a, b) => (RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity]) || (b.score - a.score));
    return out;
}

/**
 * The Sage's offer set: best-fit + alternate (different category when
 * possible) + a basic fallback, max 3 (design handoff rule). Assumes `evals`
 * came from evaluateAllLegacies (already sorted).
 */
export function pickSageOffers(evals: LegacyEvaluation[], max = 3): LegacyEvaluation[] {
    const eligible = evals.filter((e) => e.eligible);
    if (eligible.length === 0) return [];
    const offers: LegacyEvaluation[] = [];
    const best = eligible[0];
    offers.push(best);
    const alternate = eligible.find((e) => e !== best && e.category !== best.category)
        ?? eligible.find((e) => e !== best);
    if (alternate) offers.push(alternate);
    if (offers.length < max) {
        const fallback = eligible.find((e) => e.rarity === 'basic' && !offers.includes(e));
        if (fallback) offers.push(fallback);
    }
    return offers.slice(0, max);
}
