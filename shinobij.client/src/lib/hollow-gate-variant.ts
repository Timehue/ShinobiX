/**
 * Hollow Gate — variant (event gate) helpers.
 *
 * A HollowGateVariant reshapes a run without forking the engine: fewer floors
 * (a 1-3 floor event gauntlet), a smaller grid, and/or a different final boss.
 * Everything that used to read the global constants goes through these
 * accessors instead, with the STANDARD shrine as the universal default — a
 * run with no variant behaves byte-identically to before this file existed.
 *
 * Boss scaling generalizes the original per-floor ramp (F1 −5 … F5 +15 levels,
 * 1.0×…1.4× HP) by ramping over the variant's own floor count, so the final
 * floor of ANY gate hits Warden strength and the 5-floor values are unchanged.
 *
 * Pure — unit-tested in hollow-gate-variant.test.ts.
 */
import { HOLLOW_GATE_MAX_FLOOR, HOLLOW_GATE_SHRINE_W, HOLLOW_GATE_SHRINE_H } from "../constants/game";
import type { HollowGateEventConfig, HollowGateShrineRun, HollowGateVariant } from "../types/character";

// Sane bounds for authored variants. Floors: 1..9 (the standard 5 sits inside;
// the server run-token layer accepts up to 20). Grids: small enough for a
// punchy event floor, large enough that the room generator always has space.
export const HOLLOW_GATE_VARIANT_MIN_FLOORS = 1;
export const HOLLOW_GATE_VARIANT_MAX_FLOORS = 9;
export const HOLLOW_GATE_VARIANT_MIN_W = 15;
export const HOLLOW_GATE_VARIANT_MAX_W = 31;
export const HOLLOW_GATE_VARIANT_MIN_H = 11;
export const HOLLOW_GATE_VARIANT_MAX_H = 21;

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
};

/** Total floors for a run (its variant's, else the standard shrine's). */
export function hollowGateRunMaxFloor(run: Pick<HollowGateShrineRun, "variant"> | null | undefined): number {
    const v = run?.variant?.maxFloor;
    if (v == null) return HOLLOW_GATE_MAX_FLOOR;
    return clampInt(v, HOLLOW_GATE_VARIANT_MIN_FLOORS, HOLLOW_GATE_VARIANT_MAX_FLOORS, HOLLOW_GATE_MAX_FLOOR);
}

/** Generated floor dimensions for a variant (standard 25×17 when absent). */
export function hollowGateVariantDims(variant?: HollowGateVariant | null): { width: number; height: number } {
    return {
        width: clampInt(variant?.width, HOLLOW_GATE_VARIANT_MIN_W, HOLLOW_GATE_VARIANT_MAX_W, HOLLOW_GATE_SHRINE_W),
        height: clampInt(variant?.height, HOLLOW_GATE_VARIANT_MIN_H, HOLLOW_GATE_VARIANT_MAX_H, HOLLOW_GATE_SHRINE_H),
    };
}

/** Display name of the run's final boss (logs, objectives, clear modal). */
export function hollowGateBossDisplayName(run: Pick<HollowGateShrineRun, "variant"> | null | undefined): string {
    const name = run?.variant?.bossName?.trim();
    return name || "Hollow Gate Warden";
}

/**
 * Boss difficulty ramp, generalized over the run's own floor count.
 * levelOffset: −5 on floor 1 rising to +15 on the final floor (a 1-floor gate
 * IS the final floor → +15). hpMult: 1.0 rising to 1.4 the same way.
 * For the standard 5-floor shrine this reproduces the original table exactly
 * (−5/0/+5/+10/+15 and 1.0/1.1/1.2/1.3/1.4).
 */
export function hollowGateBossScaling(floor: number, maxFloor: number): { levelOffset: number; hpMult: number } {
    const f = Math.max(1, Math.floor(floor) || 1);
    const m = Math.max(1, Math.floor(maxFloor) || 1);
    const t = m <= 1 ? 1 : Math.min(1, (f - 1) / (m - 1));   // 0 at floor 1 → 1 at the final floor
    return { levelOffset: Math.round(-5 + 20 * t), hpMult: 1 + 0.4 * t };
}

/**
 * Client-side hygiene for the shared admin event config (it arrives through
 * the admin-save content channel; clamp before trusting it for display/flow).
 * Returns null when the value is not a usable config.
 */
export function normalizeHollowGateEventConfig(raw: unknown): HollowGateEventConfig | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim().slice(0, 64) : "";
    if (!id) return null;
    const str = (v: unknown, max: number): string | undefined => {
        if (typeof v !== "string") return undefined;
        const s = v.trim().slice(0, max);
        return s || undefined;
    };
    const dims = hollowGateVariantDims({ id, width: r.width as number, height: r.height as number });
    return {
        id,
        label: str(r.label, 48),
        maxFloor: clampInt(r.maxFloor, HOLLOW_GATE_VARIANT_MIN_FLOORS, HOLLOW_GATE_VARIANT_MAX_FLOORS, HOLLOW_GATE_MAX_FLOOR),
        width: r.width == null ? undefined : dims.width,
        height: r.height == null ? undefined : dims.height,
        bossAiId: str(r.bossAiId, 128),
        bossName: str(r.bossName, 64),
        active: Boolean(r.active),
        keyCost: clampInt(r.keyCost, 0, 1, 1),
        requiresUnlock: Boolean(r.requiresUnlock),
        updatedAt: Number(r.updatedAt) || 0,
    };
}

/** The run-shape fields of an event config (what gets stamped on the run). */
export function variantFromEventConfig(cfg: HollowGateEventConfig): HollowGateVariant {
    return {
        id: cfg.id,
        label: cfg.label,
        maxFloor: cfg.maxFloor,
        width: cfg.width,
        height: cfg.height,
        bossAiId: cfg.bossAiId,
        bossName: cfg.bossName,
    };
}
