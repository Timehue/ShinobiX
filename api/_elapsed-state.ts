import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { mergePreservingImages, safeName } from './_utils.js';
import { bumpSaveVersion } from './save/_save-version.js';

const AURA_SPHERE_ITEM_ID = 'aura-sphere';
const VITAL_REGEN_MS = 1000;
const BATTLE_LOCK_PREFIX = 'battle-lock:';

export type SaveRecord = Record<string, unknown>;
export type PendingTravel = { destinationSector: number; arrivalAt: number };
export type SettleResult<T extends SaveRecord = SaveRecord> = {
    record: T;
    changed: boolean;
    vitalsChanged: boolean;
    travelChanged: boolean;
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
    if (sector === 99) return 'volcano';
    if (sector >= 56) return 'central';
    if (sector <= 20) return 'shadow';
    if (sector <= 35) return 'forest';
    if (sector <= 45) return 'volcano';
    return 'snow';
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

function hasEquippedAuraSphere(character: Record<string, unknown>): boolean {
    const equipment = character.equipment;
    if (!equipment || typeof equipment !== 'object') return false;
    const eq = equipment as Record<string, unknown>;
    return eq.aura === AURA_SPHERE_ITEM_ID || eq.accessory === AURA_SPHERE_ITEM_ID;
}

function auraRegenBonus(character: Record<string, unknown>): number {
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

export function settleSaveRecord<T extends SaveRecord>(
    record: T,
    opts: { now?: number; battleLocked?: boolean } = {},
): SettleResult<T> {
    const now = Math.max(0, Math.floor(opts.now ?? Date.now()));
    const battleLocked = Boolean(opts.battleLocked);
    let next: T = record;
    let changed = false;
    let vitalsChanged = false;
    let travelChanged = false;

    const char = record.character && typeof record.character === 'object'
        ? record.character as Record<string, unknown>
        : null;

    const travel = pendingTravelFrom(record.pendingTravel);
    if (travel && now >= travel.arrivalAt) {
        next = changed ? next : cloneRecord(record);
        const writable = next as Record<string, unknown>;
        writable.currentSector = travel.destinationSector;
        writable.currentBiome = biomeForSettledSector(travel.destinationSector);
        writable.pendingTravel = null;
        changed = true;
        travelChanged = true;
    } else if (!travel && record.pendingTravel != null) {
        next = changed ? next : cloneRecord(record);
        (next as Record<string, unknown>).pendingTravel = null;
        changed = true;
        travelChanged = true;
    }

    if (char && canRegenVitals(char, battleLocked, now)) {
        const saveAt = floorEpoch(record._saveAt);
        const elapsedMs = saveAt ? Math.max(0, now - saveAt) : 0;
        const ticks = Math.floor(elapsedMs / VITAL_REGEN_MS);
        if (ticks > 0) {
            const amount = ticks * (1 + auraRegenBonus(char));
            const hp = regenVital(char, 'hp', 'maxHp', amount);
            const chakra = regenVital(char, 'chakra', 'maxChakra', amount);
            const stamina = regenVital(char, 'stamina', 'maxStamina', amount);
            if (hp !== num(char.hp, hp) || chakra !== num(char.chakra, chakra) || stamina !== num(char.stamina, stamina)) {
                next = changed ? next : cloneRecord(record);
                const nextChar = cloneCharacter(char);
                nextChar.hp = hp;
                nextChar.chakra = chakra;
                nextChar.stamina = stamina;
                const writable = next as Record<string, unknown>;
                writable.character = nextChar;
                writable._saveAt = now;
                changed = true;
                vitalsChanged = true;
            }
        }
    }

    return { record: next, changed, vitalsChanged, travelChanged };
}

export async function battleLockFlagsForPlayers(names: string[]): Promise<Map<string, boolean>> {
    const slugs = [...new Set(names.map((name) => safeName(name)).filter(Boolean))];
    const flags = new Map<string, boolean>();
    if (!slugs.length) return flags;
    const locks = await kv.mget(...slugs.map((slug) => `${BATTLE_LOCK_PREFIX}${slug}`));
    slugs.forEach((slug, index) => flags.set(slug, Boolean(locks[index])));
    return flags;
}

export async function settleSaveRecordForRead<T extends SaveRecord>(
    playerName: string,
    record: T,
    opts: { persist?: boolean; now?: number } = {},
): Promise<SettleResult<T>> {
    const slug = safeName(playerName);
    if (!slug) return { record, changed: false, vitalsChanged: false, travelChanged: false };
    const now = Math.max(0, Math.floor(opts.now ?? Date.now()));
    const lockFlags = await battleLockFlagsForPlayers([slug]);
    const projected = settleSaveRecord(record, { now, battleLocked: lockFlags.get(slug) === true });
    if (!opts.persist || !projected.changed) return projected;

    const saveKey = `save:${slug}`;
    const persisted = await withKvLock<SettleResult<T>>(saveKey, async () => {
        const fresh = await kv.get<T>(saveKey);
        if (!fresh) return projected;
        const freshFlags = await battleLockFlagsForPlayers([slug]);
        const next = settleSaveRecord(fresh, { now, battleLocked: freshFlags.get(slug) === true });
        if (!next.changed) return next;
        const versioned = bumpSaveVersion(next.record);
        await kv.set(saveKey, mergePreservingImages(versioned, fresh));
        return { ...next, record: versioned };
    });
    return persisted;
}
