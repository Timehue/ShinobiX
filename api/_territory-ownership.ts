import { homeVillageForSector, isProtectedWarSector } from './_war-map-sectors.js';

function clean(value: unknown): string {
    return String(value ?? '').trim();
}

export interface TerritoryVillageOwnershipCheck {
    sector: number;
    actorVillage: unknown;
    previousOwnerVillage: unknown;
    requestedOwnerVillage: unknown;
    /** True when this write plants a different clan banner. */
    claimingClanChanges?: boolean;
}

/**
 * Server-side ownership invariant for direct territory writes.
 *
 * - A non-admin may only move village ownership to their own village.
 * - An existing village owner cannot be cleared through an omitted/empty field.
 * - A protected village gate may only ever be owned by its home village.
 *
 * The caller still owns HP/capture eligibility; this helper only validates the
 * village identity on an ownership transition (and the permanent-gate rule).
 */
export function territoryVillageOwnershipError(check: TerritoryVillageOwnershipCheck): string | null {
    const actorVillage = clean(check.actorVillage);
    const previousOwner = clean(check.previousOwnerVillage);
    const requestedOwner = clean(check.requestedOwnerVillage);
    const homeVillage = isProtectedWarSector(check.sector)
        ? homeVillageForSector(check.sector)
        : undefined;

    if (homeVillage && requestedOwner !== homeVillage) {
        return `Sector ${Math.floor(Number(check.sector) || 0)} is a protected village gate and must remain owned by ${homeVillage}.`;
    }

    if (check.claimingClanChanges && (!actorVillage || requestedOwner !== actorVillage)) {
        return 'A clan can only capture territory for its member’s own village.';
    }
    if (requestedOwner === previousOwner) return null;
    if (!requestedOwner) return 'Village ownership cannot be cleared from a sector.';
    if (!actorVillage || requestedOwner !== actorVillage) {
        return 'You can only capture a sector for your own village.';
    }
    return null;
}
