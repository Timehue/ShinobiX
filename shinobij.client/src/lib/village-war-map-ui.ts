/*
 * Village War Map — presentation helpers.
 *
 * Pure copy/affordability/feedback logic lifted out of screens/VillageWarMap.tsx
 * so it can be unit-tested without a DOM. Nothing here talks to the network or
 * decides an outcome: every number is a DISPLAY mirror of a server constant and
 * the server re-derives the real cost when the action is taken.
 *
 * CANONICAL TERMINOLOGY: the two village stocks are **Provisions** (unit:
 * rations) and **Materials** (unit: materials). Never "craft points", "material
 * points", "pts" or "supplies" in player-facing strings.
 */

/* Rations a single active sector war eats per day. There is exactly ONE client
 * mirror of api/_village-stores.ts WAR_RATIONS_PER_DAY and it lives in
 * lib/village-stores.ts (guarded against the server by
 * scripts/village-stores-parity.test.ts); this re-export only keeps the import
 * sites that already reach for it here working. Do NOT redeclare the literal. */
import { WAR_RATIONS_PER_DAY } from "./village-stores";
export { WAR_RATIONS_PER_DAY };
/** Kill points a war's garrison can bank when nobody is feeding it. Mirrors
 *  api/_sector-war.ts GARRISON_POINTS_CAP — KEEP IN SYNC. */
export const GARRISON_POINTS_CAP = 150;
/** …and when a village IS feeding it. Mirrors api/_village-stores.ts
 *  GARRISON_POINTS_CAP_FED — KEEP IN SYNC. */
export const GARRISON_POINTS_CAP_FED = 200;

// ── C5: never render "raised to L?" ─────────────────────────────────────────

/**
 * The level a structure just reached. The server reports `newLevel`, but a
 * truncated/absent body must never print a literal "?" at the player — fall
 * back to the level the screen already knew plus one.
 */
export function resolvedStructureLevel(reported: unknown, knownCurrentLevel: number): number {
    const n = Math.floor(Number(reported));
    if (Number.isFinite(n) && n > 0) return n;
    const cur = Math.floor(Number(knownCurrentLevel));
    return (Number.isFinite(cur) && cur > 0 ? cur : 0) + 1;
}

/** The confirmation shown after a structure upgrade lands. */
export function structureUpgradeNotice(opts: {
    name: string;
    reportedLevel: unknown;
    knownCurrentLevel: number;
    materialsSpent?: unknown;
    remainingMaterials?: unknown;
}): string {
    const level = resolvedStructureLevel(opts.reportedLevel, opts.knownCurrentLevel);
    const spent = Math.max(0, Math.floor(Number(opts.materialsSpent) || 0));
    if (spent <= 0) return `${opts.name} raised to L${level}.`;
    const left = Math.max(0, Math.floor(Number(opts.remainingMaterials) || 0));
    return `${opts.name} raised to L${level} — ${spent.toLocaleString()} materials spent (${left.toLocaleString()} left).`;
}

// ── 3c: affordability, matching the "Need {cost} seals" pattern ─────────────

export interface AffordabilityView {
    /** False → render the button disabled with `label`. */
    affordable: boolean;
    /** The button's visible text. */
    label: string;
}

/**
 * Affordability of a War-Resources purchase. `cost` is an ESTIMATE for the
 * declare button (the server re-prices intel + comeback discounts at the moment
 * of the declare), so the affordable label keeps the `~`; the short label never
 * does, because the shortfall against the current pool is exact.
 */
export function wrAffordability(cost: number, pool: number, opts: { verb: string; estimate?: boolean }): AffordabilityView {
    const need = Math.max(0, Math.floor(Number(cost) || 0));
    const have = Math.max(0, Math.floor(Number(pool) || 0));
    if (have < need) return { affordable: false, label: `Need ${need.toLocaleString()} WR` };
    return { affordable: true, label: `${opts.verb} · ${opts.estimate ? "~" : ""}${need.toLocaleString()} WR` };
}

/**
 * The visible explanation of the `~` on the declare button — never a tooltip,
 * and short enough to sit inside a sector card at 360px. The intel tier is
 * per-sector, so the line belongs on the card rather than once per screen.
 */
export function declareEstimateNote(intelLabel: string): string {
    return `~ estimate: ${intelLabel} intel sets the base, your comeback discount comes off on top. The server charges the exact amount when you declare.`;
}

// ── 3e / 3f: garrison-feed copy that means something ───────────────────────

/** The read-only garrison-feed line for a villager who cannot toggle it. */
export function garrisonFeedStatusLine(opts: { feeding: boolean; sector: number }): string {
    return opts.feeding
        ? `Your Kage is feeding the Sector ${opts.sector} garrison.`
        : "Nobody is feeding this garrison — your Kage or ANBU can.";
}

/** The line under an ON feed: what the rations actually buy, in points. */
export function garrisonFedCapLine(village: string, covered: boolean): string {
    return covered
        ? `Fed by ${village} — the garrison holds ${GARRISON_POINTS_CAP_FED} points instead of ${GARRISON_POINTS_CAP}.`
        : `Feed ordered by ${village} — it takes effect after tonight's supply run, then the garrison holds ${GARRISON_POINTS_CAP_FED} points instead of ${GARRISON_POINTS_CAP}.`;
}

/** The always-visible Provisions one-liner under the resources stat row (C2). */
export function provisionsMeaningLine(garrisonRationsPerDay: number): string {
    return `Provisions feed your sieges — ${WAR_RATIONS_PER_DAY} rations a day per war, ${garrisonRationsPerDay} for a fed garrison. Cook at the Cafeteria, donate at the Town Hall.`;
}

/** 3l: the Supply Depot's daily conversion allowance, or "" when there is none. */
export function depotConversionNote(cap: unknown, pointsPerWr: number): string {
    const c = Math.floor(Number(cap) || 0);
    if (c <= 0) return "";
    return `→ up to ${c.toLocaleString()} WR/day at ${pointsPerWr} materials each`;
}

// ── 3a: notices auto-dismiss, errors stick ─────────────────────────────────

export interface WarMapErrorState {
    text: string;
    /** True when the text came from a USER ACTION: it must survive the 15s poll
     *  and only clear when the player acts again (or dismisses it). */
    sticky: boolean;
}

export const NO_WAR_MAP_ERROR: WarMapErrorState = { text: "", sticky: false };

/**
 * Fold a background-refresh outcome into the error slot. A sticky (action)
 * error is NEVER wiped by the poll — that inversion is what let a failed
 * upgrade vanish before the Kage read it. `loadError` of "" means the refresh
 * succeeded, which clears only a non-sticky load error.
 */
export function warMapErrorAfterRefresh(prev: WarMapErrorState, loadError: string): WarMapErrorState {
    if (prev.sticky) return prev;
    const text = String(loadError ?? "");
    if (!text) return prev.text ? NO_WAR_MAP_ERROR : prev;
    return text === prev.text ? prev : { text, sticky: false };
}

/** The error slot after a user action failed — sticky until the next action. */
export function warMapErrorAfterAction(message: string): WarMapErrorState {
    const text = String(message ?? "").trim();
    return text ? { text, sticky: true } : NO_WAR_MAP_ERROR;
}

// ── 3g: per-button in-flight labels ────────────────────────────────────────

/** `busy` holds the id of the ONE action in flight; only that button relabels. */
export function busyLabel(busy: string, id: string, pendingLabel: string, restingLabel: string): string {
    return busy === id ? pendingLabel : restingLabel;
}
