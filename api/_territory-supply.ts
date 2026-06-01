// Pure, IO-free core for the server-authoritative clan war-supply collection
// endpoint (api/clan/territory/collect-supply.ts). Split out so the accrual +
// collection math is unit-testable without storage — same pattern as
// api/_treasury-donate.ts and the _*-validate cores.
//
// Mirrors the client's produceSectorWarSupply (shinobij.client/src/App.tsx):
// an owned territory accrues TERRITORY_DAILY_WAR_SUPPLY per whole
// TERRITORY_SUPPLY_INTERVAL_MS elapsed since `lastSupplyAt`. Collecting yields
// the already-stored supply PLUS the newly-accrued amount, then zeroes the
// territory and advances `lastSupplyAt` by the consumed whole cycles (the
// partial-period remainder is preserved, exactly as the client does).
//
// Keep these two constants in sync with shinobij.client/src/constants/game.ts.
export const TERRITORY_DAILY_WAR_SUPPLY = 100;
export const TERRITORY_SUPPLY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type TerritorySupplyInput = {
    warSupply?: unknown;
    lastSupplyAt?: unknown;
    updatedAt?: unknown;
    ownerClan?: unknown;
};

function num(v: unknown, fallback = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Compute what a single territory yields when collected `now`, and the
 * `lastSupplyAt` it should carry afterward. Non-owned territories (no
 * `ownerClan`) never accrue, mirroring the client. The caller is responsible
 * for setting `warSupply` to 0 on the persisted territory after collecting.
 */
export function collectTerritorySupply(
    t: TerritorySupplyInput,
    now: number,
): { collected: number; nextLastSupplyAt: number } {
    const base = num(t.lastSupplyAt, num(t.updatedAt, now));
    const stored = Math.max(0, Math.floor(num(t.warSupply)));
    if (!t.ownerClan) {
        // Unowned sectors don't produce; nothing to collect, base unchanged.
        return { collected: 0, nextLastSupplyAt: base };
    }
    const cycles = Math.max(0, Math.floor((now - base) / TERRITORY_SUPPLY_INTERVAL_MS));
    const accrued = cycles * TERRITORY_DAILY_WAR_SUPPLY;
    return {
        collected: stored + accrued,
        nextLastSupplyAt: base + cycles * TERRITORY_SUPPLY_INTERVAL_MS,
    };
}
