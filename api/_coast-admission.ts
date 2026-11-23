/*
 * Who may stand where on the Unmapped Coast.
 *
 * One rule, read from the player's durable save and nothing else:
 *   - level 75 or higher (COAST_MIN_LEVEL, shared/world-maps.ts);
 *   - the boat, which the first quest line unlocks;
 *   - the region the sector is in, which later quest lines open one at a time;
 *   - and the sector itself must be open (its floor is in the game).
 *
 * Every way onto or across the coast asks here: map travel, crossing a trail,
 * and walking. The client's copy of the same facts only decides what to draw.
 *
 * Admission only ever grows: a level is never lost, and a finished quest stays
 * finished. So a cached "yes" is always safe to reuse, and only a "no" is
 * re-read from the save before it is believed.
 */
import { kv } from './_storage.js';
import { safeName } from './_utils.js';
import { COAST_DOCK, coastSectorName, coastSite, isCoastSectorOpen } from '../shared/coast-world.js';
import { COAST_MIN_LEVEL, coastRegionOf, isCoastSector } from '../shared/world-maps.js';
import { hasQuestLineUnlock, openedCoastRegion, parseQuestLines } from './quests/_record.js';

export { COAST_MIN_LEVEL };
/** The unlock the first quest line grants. */
export const COAST_BOAT_UNLOCK = 'boat';

/**
 * The second dock: the Low Water Quay in Brackwater Fields. The boat can put a
 * player down there once The Uncounted has opened it. Every other rule of the
 * crossing still holds, so the quay's region must be open too.
 */
export const COAST_SECOND_DOCK = Object.freeze({ sector: 116, siteId: 'brackwater-dock-116', unlock: 'second-dock' });

/**
 * The last Garrison: The Last Crown, the one sector of Hushcrown Heights that
 * stays shut after the region opens. The Crossing War V opens it ("opens: the
 * last Garrison" in the plan). The sector is a dead end, it cannot be held by a
 * clan, and only The Unmoored, which needs that same quest, happens there, so
 * shutting it strands nobody.
 */
export const COAST_LAST_GARRISON = Object.freeze({ sector: 150, unlock: 'last-garrison' });

export interface CoastAdmission {
    level: number;
    /** True once the boat has been unlocked. */
    boat: boolean;
    /** The highest coast region opened, 0 before any. */
    region: number;
    /** True once the second dock has been opened. */
    secondDock: boolean;
    /** True once the last Garrison has been opened. */
    lastGarrison: boolean;
}

export type CoastRefusalReason = 'not-coast' | 'closed' | 'level' | 'boat' | 'region' | 'sealed';

export interface CoastRefusal {
    reason: CoastRefusalReason;
    /** What the player is told. */
    error: string;
}

/** Read admission off a save record. Pure. */
export function coastAdmissionOf(record: unknown): CoastAdmission {
    const save = record && typeof record === 'object' ? record as Record<string, unknown> : {};
    const character = save.character && typeof save.character === 'object' ? save.character as Record<string, unknown> : {};
    const lines = parseQuestLines(save.questLines);
    return {
        level: Math.max(0, Math.floor(Number(character.level) || 0)),
        boat: hasQuestLineUnlock(lines, COAST_BOAT_UNLOCK),
        region: openedCoastRegion(lines),
        secondDock: hasQuestLineUnlock(lines, COAST_SECOND_DOCK.unlock),
        lastGarrison: hasQuestLineUnlock(lines, COAST_LAST_GARRISON.unlock),
    };
}

/** Coast sectors that are shut to this player though their region is open. */
export function coastSealedSectors(admission: Pick<CoastAdmission, 'lastGarrison'>): number[] {
    return admission.lastGarrison ? [] : [COAST_LAST_GARRISON.sector];
}

/** Whether the boat may put this player down at the second dock. Read from the save every time: it is asked once per crossing. */
export async function coastSecondDockOpenFor(playerName: string): Promise<boolean> {
    return coastAdmissionOf(await kv.get<Record<string, unknown>>(`save:${safeName(playerName)}`)).secondDock;
}

/** Why this player may not stand in this coast sector, or null when they may. Pure. */
export function coastEntryRefusal(admission: CoastAdmission, sector: number): CoastRefusal | null {
    if (!isCoastSector(sector)) return { reason: 'not-coast', error: 'That is not a place on the coast.' };
    if (!isCoastSectorOpen(sector)) return { reason: 'closed', error: 'That part of the coast is not charted yet.' };
    if (admission.level < COAST_MIN_LEVEL) return { reason: 'level', error: `The crossing is for shinobi of level ${COAST_MIN_LEVEL} or higher.` };
    if (!admission.boat) return { reason: 'boat', error: 'The boat will not sail yet. Find the Wandering Sage.' };
    if (admission.region < coastRegionOf(sector)) return { reason: 'region', error: 'That region of the coast is not open to you yet.' };
    if (coastSealedSectors(admission).includes(sector)) {
        return { reason: 'sealed', error: `${coastSectorName(sector) ?? 'That ground'} is shut. Break the Twin Ward first.` };
    }
    return null;
}

export interface CoastBoatLanding { sector: number; name: string }

/**
 * Where the boat can put this player down, in the order to offer them: the
 * slip first, then the quay once it is open. Empty while the boat will not
 * sail. This is the same rule the crossing itself applies (api/player/travel.ts),
 * so a landing listed here is one the server will accept. Pure.
 */
export function coastBoatLandings(admission: CoastAdmission): CoastBoatLanding[] {
    const docks = [COAST_DOCK, ...(admission.secondDock ? [COAST_SECOND_DOCK] : [])];
    return docks
        .filter(dock => !coastEntryRefusal(admission, dock.sector))
        .map(dock => ({ sector: dock.sector, name: coastSite(dock.siteId)?.name ?? coastSectorName(dock.sector) ?? `Sector ${dock.sector}` }));
}

/**
 * A cached "yes" is kept this long. Admission never shrinks for an account, but
 * an account can be deleted or reset and its name taken again, and that new
 * player must not ride on the old one's answer for long.
 */
const ADMISSION_CACHE_MS = 5 * 60_000;
const admitted = new Map<string, { admission: CoastAdmission; at: number }>();

/** Forget what is cached. Tests use it; nothing in the game needs to. */
export function clearCoastAdmissionCache(): void {
    admitted.clear();
}

/**
 * Check a player against a coast sector, reading the save only when the cached
 * answer is stale or would refuse them.
 */
export async function coastEntryRefusalFor(playerName: string, sector: number, now: number = Date.now()): Promise<CoastRefusal | null> {
    const key = safeName(playerName);
    const cached = admitted.get(key);
    if (cached && now - cached.at < ADMISSION_CACHE_MS && !coastEntryRefusal(cached.admission, sector)) return null;
    const admission = coastAdmissionOf(await kv.get<Record<string, unknown>>(`save:${key}`));
    const refusal = coastEntryRefusal(admission, sector);
    if (admission.boat && admission.level >= COAST_MIN_LEVEL) admitted.set(key, { admission, at: now });
    else admitted.delete(key);
    return refusal;
}
