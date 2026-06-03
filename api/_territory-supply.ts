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

export type ClaimedWarSupplyInput = {
    ownerClan?: unknown;
    ownerVillage?: unknown;
    warSupply?: unknown;
    lastSupplyAt?: unknown;
    updatedAt?: unknown;
};

/**
 * Decide the SERVER-authoritative `warSupply` + `lastSupplyAt` for a territory
 * write on the CLAIMING path (the writer's clan/village owns or is claiming the
 * sector). War Supply must never be taken from the client: collectTerritorySupply
 * banks a sector's stored `warSupply` straight into the clan treasury, so a
 * client-supplied value is a direct mint (audit H4).
 *
 *   • Same owner continuing  → carry `prev`'s warSupply + lastSupplyAt unchanged.
 *     Accrual is derived lazily from `lastSupplyAt` by collectTerritorySupply, so
 *     freezing the stored value here loses NOTHING — the collected total is the
 *     same whether the client rolled accrual into `stored` or left it implicit.
 *   • Fresh claim / ownership flip / previously-unowned / first write (no `prev`)
 *                            → reset `warSupply` to 0 and anchor `lastSupplyAt` to
 *     `now`, so the new owner accrues from claim time (and a defeated owner
 *     forfeits uncollected supply, matching the capture reset).
 *
 * `incoming` only supplies the claiming owner identity; its `warSupply` /
 * `lastSupplyAt` are intentionally ignored.
 */
export function resolveClaimedWarSupply(
    prev: ClaimedWarSupplyInput | null | undefined,
    incoming: { ownerClan?: unknown; ownerVillage?: unknown },
    now: number,
): { warSupply: number; lastSupplyAt: number } {
    const prevClan = String(prev?.ownerClan ?? '').trim();
    const prevVillage = String(prev?.ownerVillage ?? '').trim();
    const claimClan = String(incoming.ownerClan ?? '').trim();
    const claimVillage = String(incoming.ownerVillage ?? '').trim();
    const hadOwner = !!(prevClan || prevVillage);
    const sameOwner =
        hadOwner &&
        (!claimClan || claimClan === prevClan) &&
        (!claimVillage || claimVillage === prevVillage);
    if (prev && sameOwner) {
        return {
            warSupply: Math.max(0, Math.floor(num(prev.warSupply))),
            lastSupplyAt: num(prev.lastSupplyAt, num(prev.updatedAt, now)),
        };
    }
    return { warSupply: 0, lastSupplyAt: now };
}
