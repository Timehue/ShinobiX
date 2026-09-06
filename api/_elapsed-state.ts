import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { mergePreservingImages, safeName } from './_utils.js';
import { hollowGateRunKey } from './hollow-gate/_run-token.js';
import { bumpSaveVersion, unversionedSettledRecord } from './save/_save-version.js';
import { remapLegacySector, sectorBiomeOf, WORLD_GEO_VERSION } from '../shared/sector-geo.js';
import { migrateCharacterOwnedPets } from './pet/_owned-pet.js';
import { settlePetBreedingSession } from './pet/_breeding-requirements.js';
import { settleCharacterPetHappiness } from './pet/_happiness.js';

const AURA_SPHERE_ITEM_ID = 'aura-sphere';
export const VITAL_REGEN_MS = 1000;
const BATTLE_LOCK_PREFIX = 'battle-lock:';

export type SaveRecord = Record<string, unknown>;
export type PendingTravel = { destinationSector: number; arrivalAt: number };
export type SettleResult<T extends SaveRecord = SaveRecord> = {
    record: T;
    changed: boolean;
    vitalsChanged: boolean;
    travelChanged: boolean;
    hollowGateRunCleared: boolean;
    /** The world-geo migration stamp advanced — a later read cannot re-derive it for free. */
    geoChanged: boolean;
};

function num(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function floorEpoch(value: unknown): number {
    const n = Math.floor(num(value, 0));
    return n > 0 ? n : 0;
}

function cloneRecord<T extends SaveRecord>(record: T): T {
    return { ...record } as T;
}

function cloneCharacter(character: Record<string, unknown>): Record<string, unknown> {
    return { ...character };
}

export function biomeForSettledSector(sector: number): string {
    return sectorBiomeOf(sector);
}

/**
 * One-time 2026-07 world renumbering (shared/sector-geo.ts). Records without
 * `worldGeoV` were written before the reorg and carry OLD sector numbers —
 * remap them exactly once, then stamp the version. Every save WRITE after the
 * reorg stamps `worldGeoV` (api/save/[name].ts), so only pre-reorg records
 * ever take this path. The rift seal migrates separately at parse time
 * (api/sector/_rift-quest.ts parseRiftQuestSeal — it also lives in its own KV
 * key, which this save-level pass cannot see).
 */
function migrateWorldGeo<T extends SaveRecord>(record: T): { record: T; changed: boolean } {
    if (num(record.worldGeoV, 0) >= WORLD_GEO_VERSION) return { record, changed: false };
    // Nothing sector-shaped to remap → leave the record untouched (keeps this a
    // true no-op for partial records; real saves always carry currentSector, and
    // every post-reorg WRITE stamps the version at the save POST).
    const charRaw = record.character;
    const charQuest = charRaw && typeof charRaw === 'object'
        ? (charRaw as Record<string, unknown>).activeRiftQuest
        : undefined;
    const charSectorPresent = charRaw && typeof charRaw === 'object'
        && Number.isFinite(Number((charRaw as Record<string, unknown>).currentSector));
    if (!Number.isFinite(Number(record.currentSector))
        && !pendingTravelFrom(record.pendingTravel)
        && !charQuest && !charSectorPresent) {
        return { record, changed: false };
    }
    const next = cloneRecord(record);
    const writable = next as Record<string, unknown>;
    writable.worldGeoV = WORLD_GEO_VERSION;
    const sector = Math.floor(num(record.currentSector, Number.NaN));
    if (Number.isFinite(sector)) {
        const remapped = remapLegacySector(sector);
        writable.currentSector = remapped;
        if (typeof record.currentBiome === 'string') writable.currentBiome = sectorBiomeOf(remapped);
    }
    const travel = pendingTravelFrom(record.pendingTravel);
    if (travel) {
        writable.pendingTravel = {
            ...(record.pendingTravel as Record<string, unknown>),
            destinationSector: remapLegacySector(travel.destinationSector),
        };
    }
    const char = record.character;
    if (char && typeof char === 'object') {
        const c = { ...(char as Record<string, unknown>) };
        let charChanged = false;
        const charSector = Math.floor(num(c.currentSector, Number.NaN));
        if (Number.isFinite(charSector)) {
            c.currentSector = remapLegacySector(charSector);
            charChanged = true;
        }
        const quest = c.activeRiftQuest;
        if (quest && typeof quest === 'object' && !Array.isArray(quest)) {
            const target = Math.floor(num((quest as Record<string, unknown>).targetSector, Number.NaN));
            if (Number.isFinite(target)) {
                c.activeRiftQuest = { ...(quest as Record<string, unknown>), targetSector: remapLegacySector(target) };
                charChanged = true;
            }
        }
        if (charChanged) writable.character = c;
    }
    return { record: next, changed: true };
}

function pendingTravelFrom(value: unknown): PendingTravel | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const destinationSector = Math.floor(num(raw.destinationSector ?? raw.sector, NaN));
    const arrivalAt = floorEpoch(raw.arrivalAt);
    if (!Number.isFinite(destinationSector) || destinationSector < 0 || destinationSector > 999 || !arrivalAt) return null;
    return { destinationSector, arrivalAt };
}

function hasActiveHollowGateRun(character: Record<string, unknown>): boolean {
    const run = character.hollowGateRun;
    return Boolean(run && typeof run === 'object' && !(run as Record<string, unknown>).completed);
}

/** The server run token a persisted dive is bound to, if any. A run without one
 *  predates the server-authoritative loop; its liveness is unknowable from KV, so
 *  the self-heal below leaves it alone. */
export function hollowGateRunTokenOf(record: SaveRecord): string | null {
    const char = record.character;
    if (!char || typeof char !== 'object') return null;
    const run = (char as Record<string, unknown>).hollowGateRun;
    if (!run || typeof run !== 'object') return null;
    const token = (run as Record<string, unknown>).runToken;
    return typeof token === 'string' && token ? token : null;
}

function hasEquippedAuraSphere(character: Record<string, unknown>): boolean {
    const equipment = character.equipment;
    if (!equipment || typeof equipment !== 'object') return false;
    const eq = equipment as Record<string, unknown>;
    return eq.aura === AURA_SPHERE_ITEM_ID || eq.accessory === AURA_SPHERE_ITEM_ID;
}

/** Extra vitals per regen tick from an equipped Aura Sphere. Exported so the
 *  save sanitizer's vitals-gain cap (api/save/[name].ts) allows exactly the
 *  rate this file settles — the two must never drift apart. */
export function auraRegenBonus(character: Record<string, unknown>): number {
    if (!hasEquippedAuraSphere(character)) return 0;
    const level = Math.max(1, Math.floor(num(character.auraSphereLevel, 1)));
    if (level >= 300) return 5;
    if (level >= 150) return 2;
    if (level >= 100) return 2;
    if (level >= 1) return 1;
    return 0;
}

function canRegenVitals(character: Record<string, unknown>, battleLocked: boolean, now: number): boolean {
    if (battleLocked) return false;
    if (hasActiveHollowGateRun(character)) return false;
    if (character.hospitalized === true) return false;
    const hospitalizedUntil = floorEpoch(character.hospitalizedUntil);
    if (hospitalizedUntil && now < hospitalizedUntil) return false;
    return true;
}

function regenVital(character: Record<string, unknown>, key: 'hp' | 'chakra' | 'stamina', maxKey: 'maxHp' | 'maxChakra' | 'maxStamina', amount: number): number {
    const max = Math.max(0, Math.floor(num(character[maxKey], 0)));
    const current = Math.max(0, Math.floor(num(character[key], max)));
    return Math.min(max, current + amount);
}

/**
 * The regeneration cursor: the instant up to which idle recovery has been
 * credited. `_regenAt` is server-owned and carries the sub-second remainder
 * (`cursor + ticks * VITAL_REGEN_MS`, never `now`); a record that predates it
 * falls back to `_saveAt`, exactly the clock regen used before — so migration
 * grants nothing.
 */
export function regenCursorOf(record: SaveRecord): number {
    return floorEpoch(record._regenAt) || floorEpoch(record._saveAt);
}

export type VitalsRegenSettlement<T extends SaveRecord = SaveRecord> = {
    record: T;
    changed: boolean;
    /** Recovery was not eligible (battle lock, Hollow Gate run, hospital). */
    excluded: boolean;
    /** The cursor a follow-up write should carry to keep the remainder; 0 when the record has no clock yet. */
    cursor: number;
};

/**
 * Credit the idle recovery that elapsed since the cursor. Pure.
 *
 * Why a cursor and not `_saveAt` (F13): `_saveAt` is the general mutation
 * timestamp — every server write and every autosave moves it — so a mutation
 * that landed without an owner read first silently discarded all the recovery
 * earned since the last settle, and each settle floored the elapsed seconds
 * and then reset the clock to `now`, dropping up to a second every time. The
 * cursor advances by whole ticks only, so equal elapsed time yields the same
 * recovery whether it is settled in one read or many.
 *
 * Exclusions read real state: a battle lock, an open Hollow Gate run, or an
 * admission. Recovery after a stay counts from `hospitalizedUntil`, never from
 * the admission.
 */
export function settleVitalsRegen<T extends SaveRecord>(
    record: T,
    opts: { now: number; battleLocked: boolean },
): VitalsRegenSettlement<T> {
    const now = Math.max(0, Math.floor(opts.now));
    const char = record.character && typeof record.character === 'object'
        ? record.character as Record<string, unknown>
        : null;
    const stored = regenCursorOf(record);
    if (!char) return { record, changed: false, excluded: false, cursor: stored };
    if (!canRegenVitals(char, Boolean(opts.battleLocked), now)) return { record, changed: false, excluded: true, cursor: stored };
    if (!stored) return { record, changed: false, excluded: false, cursor: 0 };
    const hospitalizedUntil = floorEpoch(char.hospitalizedUntil);
    const cursor = hospitalizedUntil > stored ? hospitalizedUntil : stored;
    const ticks = Math.floor(Math.max(0, now - cursor) / VITAL_REGEN_MS);
    if (ticks <= 0) return { record, changed: false, excluded: false, cursor };
    const nextCursor = cursor + ticks * VITAL_REGEN_MS;
    const amount = ticks * (1 + auraRegenBonus(char));
    const hp = regenVital(char, 'hp', 'maxHp', amount);
    const chakra = regenVital(char, 'chakra', 'maxChakra', amount);
    const stamina = regenVital(char, 'stamina', 'maxStamina', amount);
    if (hp === num(char.hp, hp) && chakra === num(char.chakra, chakra) && stamina === num(char.stamina, stamina)) {
        // Already full: nothing to write, but the cursor a caller carries forward
        // still advances — recovery is never banked while capped.
        return { record, changed: false, excluded: false, cursor: nextCursor };
    }
    const next = cloneRecord(record);
    const nextChar = cloneCharacter(char);
    nextChar.hp = hp;
    nextChar.chakra = chakra;
    nextChar.stamina = stamina;
    const writable = next as Record<string, unknown>;
    writable.character = nextChar;
    // `_saveAt` stays the write timestamp the autosave gain-cap anchors on;
    // `_regenAt` keeps the remainder.
    writable._saveAt = now;
    writable._regenAt = nextCursor;
    return { record: next, changed: true, excluded: false, cursor: nextCursor };
}

export function settleSaveRecord<T extends SaveRecord>(
    record: T,
    opts: { now?: number; battleLocked?: boolean; hollowGateRunExpired?: boolean } = {},
): SettleResult<T> {
    const now = Math.max(0, Math.floor(opts.now ?? Date.now()));
    const battleLocked = Boolean(opts.battleLocked);
    const geo = migrateWorldGeo(record);
    const base: T = geo.record;
    let next: T = base;
    let changed = geo.changed;
    let vitalsChanged = false;
    let travelChanged = false;
    let hollowGateRunCleared = false;

    let char = base.character && typeof base.character === 'object'
        ? base.character as Record<string, unknown>
        : null;

    // ─── Expired Hollow Gate run self-heal ────────────────────────────────────
    // The shrine is deliberately no-retreat (lib/screen-guards.ts) and the run
    // lives on the SAVE, so once the server token lapses the player is restored
    // into a gate where every action 409s — a permanent trap that previously
    // needed a manual Postgres edit to undo. Dropping the dead run here is the
    // backstop that frees them on the next read even if their client never
    // manages to post the clear.
    //
    // This grants nothing: an expired token can no longer settle, and the in-run
    // haul was never credited (the HG currencies are server-ledger fields that
    // sanitizeCharacterSave freezes for generic saves), so there is nothing to
    // pay out or claw back — only the dead run pointer goes away.
    //
    // `= undefined`, NEVER `delete`: settleSaveRecordForRead persists through
    // mergePreservingImages, which seeds from the STORED record and only
    // overrides keys present on the incoming one. A deleted key is absent, so the
    // stored run would be resurrected right back onto the save; an explicit
    // undefined is an own key that overrides, and JSON drops it on write.
    if (char && opts.hollowGateRunExpired && char.hollowGateRun != null) {
        next = changed ? next : cloneRecord(base);
        char = cloneCharacter(char);
        char.hollowGateRun = undefined;
        (next as Record<string, unknown>).character = char;
        changed = true;
        hollowGateRunCleared = true;
    }

    const travel = pendingTravelFrom(base.pendingTravel);
    if (travel && now >= travel.arrivalAt) {
        next = changed ? next : cloneRecord(base);
        const writable = next as Record<string, unknown>;
        writable.currentSector = travel.destinationSector;
        writable.currentBiome = biomeForSettledSector(travel.destinationSector);
        writable.pendingTravel = null;
        changed = true;
        travelChanged = true;
    } else if (!travel && base.pendingTravel != null) {
        next = changed ? next : cloneRecord(base);
        (next as Record<string, unknown>).pendingTravel = null;
        changed = true;
        travelChanged = true;
    }

    if (char) {
        // `next.character` is `char` on every path above (a cleared run assigns
        // its clone; otherwise next === base and char === base.character).
        const regen = settleVitalsRegen(next, { now, battleLocked });
        if (regen.changed) {
            next = regen.record;
            changed = true;
            vitalsChanged = true;
        }
    }

    return { record: next, changed, vitalsChanged, travelChanged, hollowGateRunCleared, geoChanged: geo.changed };
}

export async function battleLockFlagsForPlayers(names: string[]): Promise<Map<string, boolean>> {
    const slugs = [...new Set(names.map((name) => safeName(name)).filter(Boolean))];
    const flags = new Map<string, boolean>();
    if (!slugs.length) return flags;
    const locks = await kv.mget(...slugs.map((slug) => `${BATTLE_LOCK_PREFIX}${slug}`));
    slugs.forEach((slug, index) => flags.set(slug, Boolean(locks[index])));
    return flags;
}

/** True when a persisted dive names a server run token that KV no longer holds —
 *  i.e. the run was settled, lost, or its 24h TTL lapsed, and every endpoint will
 *  now 409 it as expired. Costs one KV read, and only for a save that is actually
 *  mid-dive: a player with no open run never pays for this probe. A token-less
 *  legacy run returns false (unknowable — left for the player to walk out of). */
export async function hollowGateRunExpiredFor<T extends SaveRecord>(slug: string, record: T): Promise<boolean> {
    const token = hollowGateRunTokenOf(record);
    if (!slug || !token) return false;
    try {
        return (await kv.get(hollowGateRunKey(slug, token))) == null;
    } catch {
        // Fail toward KEEPING the run: a KV blip is not evidence that a dive
        // expired, and this read must never be the thing that voids a live one
        // (or 500s the save GET of a player who is merely mid-dive).
        return false;
    }
}

export async function settleSaveRecordForRead<T extends SaveRecord>(
    playerName: string,
    record: T,
    opts: { persist?: boolean; now?: number } = {},
): Promise<SettleResult<T>> {
    const slug = safeName(playerName);
    if (!slug) return { record, changed: false, vitalsChanged: false, travelChanged: false, hollowGateRunCleared: false, geoChanged: false };
    const now = Math.max(0, Math.floor(opts.now ?? Date.now()));
    const [lockFlags, hollowGateRunExpired] = await Promise.all([
        battleLockFlagsForPlayers([slug]),
        hollowGateRunExpiredFor(slug, record),
    ]);
    let projected = settleSaveRecord(record, { now, battleLocked: lockFlags.get(slug) === true, hollowGateRunExpired });
    if (opts.persist && projected.record.character && typeof projected.record.character === 'object') {
        const migrated = migrateCharacterOwnedPets(slug, projected.record.character as Record<string, unknown>);
        const breeding = settlePetBreedingSession(migrated.character, now);
        // Pet bond decay ticks here — the owner's own save read is the once-a-day
        // seam that durably applies it (shared/pet-happiness.ts). It is
        // deliberately owner-only: a foreign profile read must never write.
        const bond = settleCharacterPetHappiness(breeding.character, now);
        if (migrated.changed || breeding.changed || bond.changed) {
            projected = {
                ...projected,
                record: { ...projected.record, character: bond.character },
                changed: true,
            };
        }
    }
    if (!opts.persist || !projected.changed) return projected;

    const saveKey = `save:${slug}`;
    const persisted = await withKvLock<SettleResult<T>>(saveKey, async () => {
        let petStateChanged = false;
        const fresh = await kv.get<T>(saveKey);
        if (!fresh) return projected;
        // Re-probe under the lock against the FRESH record: the run token it names
        // may differ from the one we read outside the lock (a dive that just
        // started, or a fresh run minted between the two reads). Re-deriving the
        // flag here keeps a live run from being cleared by a stale observation.
        const [freshFlags, freshExpired] = await Promise.all([
            battleLockFlagsForPlayers([slug]),
            hollowGateRunExpiredFor(slug, fresh),
        ]);
        let next = settleSaveRecord(fresh, { now, battleLocked: freshFlags.get(slug) === true, hollowGateRunExpired: freshExpired });
        if (next.record.character && typeof next.record.character === 'object') {
            const migrated = migrateCharacterOwnedPets(slug, next.record.character as Record<string, unknown>);
            const breeding = settlePetBreedingSession(migrated.character, now);
            const bond = settleCharacterPetHappiness(breeding.character, now);
            if (migrated.changed || breeding.changed || bond.changed) {
                next = { ...next, record: { ...next.record, character: bond.character }, changed: true };
                petStateChanged = true;
            }
        }
        if (!next.changed) return next;

        // WRITE always; PUBLISH A VERSION only for a settle a later read could
        // not recompute for itself. These are two different questions, and
        // conflating them is what has broken this function twice.
        //
        // The write is unconditional because server-authoritative admissions
        // (`training/start.ts`, the Weekly Boss, combat starts) read the raw
        // `save:` row under their own lock and debit from exactly what they find
        // there. If an owner GET only projected regeneration, those mutations
        // would keep seeing pre-regeneration stamina/HP forever and could refuse
        // an action the player's own authoritative read had just shown as ready.
        // `api/save/_elapsed-vital-consumers.test.ts` pins that end-to-end.
        //
        // The BUMP is what must not happen for a projection-only settle. Vitals
        // regen is re-derived from `_saveAt` on every read, so it tells the
        // owner's open client nothing it cannot compute itself — but bumping
        // declared that client's base version stale. With VITAL_REGEN_MS = 1s
        // that fired on essentially every owner read below full vitals, so the
        // next autosave echoed a stale `_baseSaveVersion`, took a 409, and the
        // conflict recovery captured a "device draft" for a divergence that never
        // existed. Travel arrival, an expired Hollow Gate run, the geo migration
        // and pet breeding/bond decay DO carry state no reader can re-derive, so
        // they still publish a version the client is required to adopt.
        //
        // ⛔ History: this guard was added in `d453f9257`, then silently dropped
        // by the merge `d9ef64aa9` ("integrate upstream save recovery into Phase
        // 2"), which put the 409 loop straight back into production. `git log -S`
        // does not surface a loss inside a merge. The four discriminators below
        // exist for nothing else — if they ever go unread again, this regressed.
        const durable = next.travelChanged || next.hollowGateRunCleared || next.geoChanged || petStateChanged;
        // A projection-only settle already carries `_saveAt = now` (set by the
        // vitals branch of settleSaveRecord), so the next read still measures
        // elapsed time from this write even though the version stands still.
        // A durable settle touches no vital, so it carries the regen cursor the
        // settle computed (or the stored one) instead of fencing it to now.
        const settled = durable
            ? bumpSaveVersion(next.record, { regenAt: regenCursorOf(next.record) || undefined })
            : unversionedSettledRecord(next.record);
        await kv.set(saveKey, mergePreservingImages(settled, fresh));
        return { ...next, record: settled };
    });
    return persisted;
}
