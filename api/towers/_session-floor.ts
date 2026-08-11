import { getFloor, TOWER_CATALOG_VERSION, type TowerFloor } from './_floor-catalog.js';
import { getSpireFloor, isValidSpireTier, SPIRE_CATALOG_VERSION } from './_spire-catalog.js';
import type { TowerFloorProvenance, TowerSession } from './_tower-session.js';

const CONTENT_VERSION = /^[A-Za-z0-9_.-]{1,80}$/;

function validVersion(value: unknown): value is string {
    return typeof value === 'string' && CONTENT_VERSION.test(value);
}

/**
 * Seal the exact rules/reward snapshot used by a newly minted public Tower run.
 * The generated Spire floor and Story catalog intentionally share this storage
 * field but never provenance, so a Spire snapshot cannot enter Story settlement.
 */
export function sealTowerCatalogFloor(
    session: TowerSession,
    floor: TowerFloor,
    mode: 'story' | 'spire',
): void {
    if (floor.id !== session.floor) throw new Error('Tower floor seal does not match the session floor.');
    if (mode === 'story') {
        if (session.towerId !== 'celestial' || session.ascensionTier !== undefined) {
            throw new Error('Story floor provenance does not match the session identity.');
        }
        session.floorProvenance = {
            kind: 'story-catalog',
            mintedBy: 'tower-start',
            contentVersion: TOWER_CATALOG_VERSION,
            floorId: floor.id,
        };
    } else {
        if (session.towerId !== 'endless-spire' || session.ascensionTier !== floor.id || !isValidSpireTier(floor.id)) {
            throw new Error('Spire floor provenance does not match the session identity.');
        }
        session.floorProvenance = {
            kind: 'spire-generated',
            mintedBy: 'tower-start',
            contentVersion: SPIRE_CATALOG_VERSION,
            tier: floor.id,
        };
    }
    session.sealedCatalogFloor = structuredClone(floor);
    // Public Tower starts must never be classified as generic embedded PvE.
    delete session.encounterFloor;
}

function floorFromProvenance(session: TowerSession, provenance: TowerFloorProvenance): TowerFloor | undefined {
    if (!validVersion(provenance.contentVersion)) return undefined;
    if (provenance.kind === 'embedded') {
        const floor = session.encounterFloor;
        if (provenance.mintedBy !== 'authoritative-pve' || session.sealedCatalogFloor || !floor) return undefined;
        return provenance.floorId === session.floor && floor.id === session.floor ? floor : undefined;
    }

    const floor = session.sealedCatalogFloor;
    if (!floor || session.encounterFloor || provenance.mintedBy !== 'tower-start') return undefined;
    if (provenance.kind === 'story-catalog') {
        return session.towerId === 'celestial'
            && session.ascensionTier === undefined
            && provenance.floorId === session.floor
            && floor.id === session.floor
            ? floor
            : undefined;
    }
    return session.towerId === 'endless-spire'
        && isValidSpireTier(provenance.tier)
        && provenance.tier === session.floor
        && session.ascensionTier === provenance.tier
        && floor.id === provenance.tier
        ? floor
        : undefined;
}

export function sealedStoryFloorForSession(session: TowerSession): TowerFloor | undefined {
    return session.floorProvenance?.kind === 'story-catalog'
        ? floorFromProvenance(session, session.floorProvenance)
        : undefined;
}

export function sealedSpireFloorForSession(session: TowerSession): TowerFloor | undefined {
    return session.floorProvenance?.kind === 'spire-generated'
        ? floorFromProvenance(session, session.floorProvenance)
        : undefined;
}

/** Resolve sealed rules first; safely fall back for sessions minted before floor seals existed. */
export function floorForSession(session: TowerSession): TowerFloor | undefined {
    // Presence of either half opts into strict provenance validation. Never fall
    // through to a same-number Story floor when a new seal is malformed.
    if (session.floorProvenance || session.sealedCatalogFloor) {
        return session.floorProvenance ? floorFromProvenance(session, session.floorProvenance) : undefined;
    }
    // Legacy authoritative embedded encounters retain their exact snapshot.
    if (session.encounterFloor) return session.encounterFloor;
    // Legacy Spire sessions lacked a snapshot. Resolve through the Spire factory,
    // never through the numerically overlapping Story catalog.
    const tier = Math.floor(Number(session.ascensionTier ?? 0));
    if (session.towerId === 'endless-spire' && session.floor === tier && isValidSpireTier(tier)) {
        return getSpireFloor(tier);
    }
    // Legacy Story and reserved Clan Boss sessions keep their catalog fallback.
    return getFloor(session.floor);
}
