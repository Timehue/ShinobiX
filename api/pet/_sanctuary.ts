import { createHash } from 'node:crypto';
import { withKvLock } from '../_lock.js';
import { kv, type KvLike } from '../_storage.js';
import { safeName } from '../_utils.js';

export const PET_SANCTUARY_SCHEMA_VERSION = 1;
export const PET_SANCTUARY_PAGE_SIZE = 24;
export const PET_SANCTUARY_LIST_LIMIT = 24;
export const PET_SANCTUARY_LIST_MAX_LIMIT = 48;

export type PetSanctuarySource = 'wild' | 'bred' | 'roster';

export type PetSanctuaryIndexEntry = {
    token: string;
    petId: string;
    name: string;
    nickname?: string;
    element?: string;
    rarity?: string;
    level: number;
    origin?: string;
    trait?: string;
    paletteVariantId?: string;
    storedAt: number;
    source: PetSanctuarySource;
};

export type PetSanctuaryItem = {
    schemaVersion: typeof PET_SANCTUARY_SCHEMA_VERSION;
    pet: Record<string, unknown>;
    page: number;
    storedAt: number;
    source: PetSanctuarySource;
};

type PetSanctuaryPage = {
    schemaVersion: typeof PET_SANCTUARY_SCHEMA_VERSION;
    page: number;
    entries: PetSanctuaryIndexEntry[];
};

type PetSanctuaryMeta = {
    schemaVersion: typeof PET_SANCTUARY_SCHEMA_VERSION;
    total: number;
    lastPage: number;
    revision: number;
};

export type PetSanctuaryFilters = {
    search?: string;
    element?: string;
    rarity?: string;
    origin?: string;
};

export type ListPetSanctuaryOptions = PetSanctuaryFilters & {
    cursor?: string;
    limit?: number;
    excludePetIds?: Iterable<string>;
};

export type PetSanctuaryListResult = {
    items: PetSanctuaryItem[];
    total: number;
    nextCursor: string | null;
};

const emptyMeta = (): PetSanctuaryMeta => ({
    schemaVersion: PET_SANCTUARY_SCHEMA_VERSION,
    total: 0,
    lastPage: 0,
    revision: 0,
});

const sanctuaryPrefix = (playerName: string) => `pet-sanctuary:${safeName(playerName)}`;
export const petSanctuaryMetaKey = (playerName: string) => `${sanctuaryPrefix(playerName)}:meta`;
const petSanctuaryPageKey = (playerName: string, page: number) => `${sanctuaryPrefix(playerName)}:page:${page}`;

export function petSanctuaryToken(playerName: string, petId: string): string {
    return createHash('sha256')
        .update(`pet-sanctuary-v1:${safeName(playerName)}:${petId}`)
        .digest('hex');
}

const petSanctuaryItemKeyFromToken = (playerName: string, token: string) => `${sanctuaryPrefix(playerName)}:item:${token}`;
const petSanctuaryItemKey = (playerName: string, petId: string) => petSanctuaryItemKeyFromToken(playerName, petSanctuaryToken(playerName, petId));

function text(value: unknown, max = 96): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function finiteWhole(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function indexEntry(playerName: string, pet: Record<string, unknown>, storedAt: number, source: PetSanctuarySource): PetSanctuaryIndexEntry {
    const petId = text(pet.id);
    return {
        token: petSanctuaryToken(playerName, petId),
        petId,
        name: text(pet.name) || text(pet.templateId) || 'Companion',
        ...(text(pet.nickname) ? { nickname: text(pet.nickname) } : {}),
        ...(text(pet.element, 32) ? { element: text(pet.element, 32).toLowerCase() } : {}),
        ...(text(pet.rarity, 32) ? { rarity: text(pet.rarity, 32).toLowerCase() } : {}),
        level: Math.max(1, finiteWhole(pet.level, 1)),
        ...(text(pet.origin, 32) ? { origin: text(pet.origin, 32).toLowerCase() } : {}),
        ...(text(pet.trait, 64) ? { trait: text(pet.trait, 64) } : {}),
        ...(text(pet.paletteVariantId, 64) ? { paletteVariantId: text(pet.paletteVariantId, 64) } : {}),
        storedAt,
        source,
    };
}

function normalizedMeta(value: PetSanctuaryMeta | null): PetSanctuaryMeta {
    if (!value || value.schemaVersion !== PET_SANCTUARY_SCHEMA_VERSION) return emptyMeta();
    return {
        schemaVersion: PET_SANCTUARY_SCHEMA_VERSION,
        total: finiteWhole(value.total),
        lastPage: finiteWhole(value.lastPage),
        revision: finiteWhole(value.revision),
    };
}

function normalizedPage(value: PetSanctuaryPage | null, page: number): PetSanctuaryPage {
    return {
        schemaVersion: PET_SANCTUARY_SCHEMA_VERSION,
        page,
        entries: Array.isArray(value?.entries)
            ? value.entries.filter((entry) => entry && typeof entry.petId === 'string' && typeof entry.token === 'string').slice(0, PET_SANCTUARY_PAGE_SIZE)
            : [],
    };
}

async function repairExistingItem(
    store: KvLike,
    playerName: string,
    existing: PetSanctuaryItem,
): Promise<PetSanctuaryItem> {
    const petId = text(existing.pet?.id);
    if (!petId) return existing;
    const metaKey = petSanctuaryMetaKey(playerName);
    const meta = normalizedMeta(await store.get<PetSanctuaryMeta>(metaKey));
    const pageNumber = Math.max(1, finiteWhole(existing.page, Math.max(1, meta.lastPage)));
    const pageKey = petSanctuaryPageKey(playerName, pageNumber);
    const page = normalizedPage(await store.get<PetSanctuaryPage>(pageKey), pageNumber);
    if (!page.entries.some((entry) => entry.petId === petId)) {
        page.entries.push(indexEntry(playerName, existing.pet, existing.storedAt, existing.source));
        await store.set(pageKey, page);
        await store.set(metaKey, {
            ...meta,
            total: meta.total + 1,
            lastPage: Math.max(meta.lastPage, pageNumber),
            revision: meta.revision + 1,
        } satisfies PetSanctuaryMeta);
    } else if (pageNumber > meta.lastPage) {
        await store.set(metaKey, { ...meta, lastPage: pageNumber, revision: meta.revision + 1 } satisfies PetSanctuaryMeta);
    }
    return existing;
}

/** Core storage primitive. Callers serialize it with the sanctuary meta lock. */
export async function storePetInSanctuaryCore(
    store: KvLike,
    playerNameRaw: string,
    pet: Record<string, unknown>,
    source: PetSanctuarySource,
    now = Date.now(),
): Promise<{ item: PetSanctuaryItem; replayed: boolean }> {
    const playerName = safeName(playerNameRaw);
    const petId = text(pet.id);
    if (!playerName || !petId) throw new Error('invalid-sanctuary-pet');
    const itemKey = petSanctuaryItemKey(playerName, petId);
    const existing = await store.get<PetSanctuaryItem>(itemKey);
    if (existing?.pet) return { item: await repairExistingItem(store, playerName, existing), replayed: true };

    const metaKey = petSanctuaryMetaKey(playerName);
    const meta = normalizedMeta(await store.get<PetSanctuaryMeta>(metaKey));
    let pageNumber = Math.max(1, meta.lastPage || 1);
    let page = normalizedPage(await store.get<PetSanctuaryPage>(petSanctuaryPageKey(playerName, pageNumber)), pageNumber);
    if (page.entries.length >= PET_SANCTUARY_PAGE_SIZE) {
        pageNumber += 1;
        page = normalizedPage(null, pageNumber);
    }

    const item: PetSanctuaryItem = {
        schemaVersion: PET_SANCTUARY_SCHEMA_VERSION,
        pet: structuredClone(pet),
        page: pageNumber,
        storedAt: Math.max(0, Math.floor(now)),
        source,
    };
    page.entries.push(indexEntry(playerName, pet, item.storedAt, source));

    // The item is written first. If a later write is interrupted, retrying the
    // same deterministic pet id repairs its page entry under the same lock.
    await store.set(itemKey, item);
    await store.set(petSanctuaryPageKey(playerName, pageNumber), page);
    await store.set(metaKey, {
        schemaVersion: PET_SANCTUARY_SCHEMA_VERSION,
        total: meta.total + 1,
        lastPage: Math.max(meta.lastPage, pageNumber),
        revision: meta.revision + 1,
    } satisfies PetSanctuaryMeta);
    return { item, replayed: false };
}

export async function getPetFromSanctuaryCore(store: KvLike, playerNameRaw: string, petId: string): Promise<PetSanctuaryItem | null> {
    const playerName = safeName(playerNameRaw);
    if (!playerName || !text(petId)) return null;
    return store.get<PetSanctuaryItem>(petSanctuaryItemKey(playerName, petId));
}

/** Core removal primitive. Callers serialize it with the sanctuary meta lock. */
export async function removePetFromSanctuaryCore(store: KvLike, playerNameRaw: string, petIdRaw: string): Promise<PetSanctuaryItem | null> {
    const playerName = safeName(playerNameRaw);
    const petId = text(petIdRaw);
    if (!playerName || !petId) return null;
    const itemKey = petSanctuaryItemKey(playerName, petId);
    const item = await store.get<PetSanctuaryItem>(itemKey);
    if (!item?.pet) return null;
    const pageNumber = Math.max(1, finiteWhole(item.page, 1));
    const pageKey = petSanctuaryPageKey(playerName, pageNumber);
    const page = normalizedPage(await store.get<PetSanctuaryPage>(pageKey), pageNumber);
    const nextEntries = page.entries.filter((entry) => entry.petId !== petId);
    const wasIndexed = nextEntries.length !== page.entries.length;
    if (wasIndexed) await store.set(pageKey, { ...page, entries: nextEntries } satisfies PetSanctuaryPage);
    await store.del(itemKey);
    if (wasIndexed) {
        const metaKey = petSanctuaryMetaKey(playerName);
        const meta = normalizedMeta(await store.get<PetSanctuaryMeta>(metaKey));
        let lastPage = meta.lastPage;
        // Keep pagination bounded after a player releases the newest habitats.
        // Empty historical pages inside the collection are harmless, but an
        // empty tail should never force every future list request to scan it.
        if (pageNumber === lastPage && nextEntries.length === 0) {
            while (lastPage > 0) {
                lastPage -= 1;
                if (lastPage === 0) break;
                const prior = normalizedPage(await store.get<PetSanctuaryPage>(petSanctuaryPageKey(playerName, lastPage)), lastPage);
                if (prior.entries.length) break;
            }
        }
        await store.set(metaKey, { ...meta, total: Math.max(0, meta.total - 1), lastPage, revision: meta.revision + 1 } satisfies PetSanctuaryMeta);
    }
    return item;
}

function cleanFilter(value: unknown): string {
    return text(value, 64).toLowerCase();
}

function matches(entry: PetSanctuaryIndexEntry, filters: PetSanctuaryFilters, excluded: Set<string>): boolean {
    if (excluded.has(entry.petId)) return false;
    const search = cleanFilter(filters.search);
    if (search) {
        const haystack = `${entry.name} ${entry.nickname ?? ''} ${entry.trait ?? ''} ${entry.element ?? ''}`.toLowerCase();
        if (!haystack.includes(search)) return false;
    }
    const element = cleanFilter(filters.element);
    if (element && element !== 'all' && entry.element !== element) return false;
    const rarity = cleanFilter(filters.rarity);
    if (rarity && rarity !== 'all' && entry.rarity !== rarity) return false;
    const origin = cleanFilter(filters.origin);
    if (origin && origin !== 'all' && entry.origin !== origin) return false;
    return true;
}

function parseCursor(cursor: unknown, lastPage: number): { page: number; offset: number } {
    const match = typeof cursor === 'string' ? /^(\d+):(\d+)$/.exec(cursor) : null;
    if (!match) return { page: lastPage, offset: 0 };
    return {
        page: Math.min(lastPage, Math.max(0, finiteWhole(match[1]))),
        offset: Math.min(PET_SANCTUARY_PAGE_SIZE, finiteWhole(match[2])),
    };
}

export async function listPetSanctuaryCore(
    store: KvLike,
    playerNameRaw: string,
    options: ListPetSanctuaryOptions = {},
): Promise<PetSanctuaryListResult> {
    const playerName = safeName(playerNameRaw);
    if (!playerName) return { items: [], total: 0, nextCursor: null };
    const meta = normalizedMeta(await store.get<PetSanctuaryMeta>(petSanctuaryMetaKey(playerName)));
    if (!meta.total || !meta.lastPage) return { items: [], total: 0, nextCursor: null };
    const limit = Math.max(1, Math.min(PET_SANCTUARY_LIST_MAX_LIMIT, finiteWhole(options.limit, PET_SANCTUARY_LIST_LIMIT)));
    const excluded = new Set(Array.from(options.excludePetIds ?? [], (id) => String(id)));
    let { page: pageNumber, offset } = parseCursor(options.cursor, meta.lastPage);
    const selected: PetSanctuaryIndexEntry[] = [];
    let nextCursor: string | null = null;

    while (pageNumber > 0 && selected.length < limit) {
        const page = normalizedPage(await store.get<PetSanctuaryPage>(petSanctuaryPageKey(playerName, pageNumber)), pageNumber);
        const newestFirst = [...page.entries].reverse();
        let index = offset;
        for (; index < newestFirst.length && selected.length < limit; index += 1) {
            const entry = newestFirst[index];
            if (matches(entry, options, excluded)) selected.push(entry);
        }
        if (selected.length >= limit) {
            nextCursor = index < newestFirst.length ? `${pageNumber}:${index}` : (pageNumber > 1 ? `${pageNumber - 1}:0` : null);
            break;
        }
        pageNumber -= 1;
        offset = 0;
    }

    const records = selected.length
        ? await store.mget<[PetSanctuaryItem]>(...selected.map((entry) => petSanctuaryItemKeyFromToken(playerName, entry.token)))
        : [];
    const items = records.filter((item): item is PetSanctuaryItem => Boolean(item?.pet));
    // `excludePetIds` hides the short-lived duplicate possible between the two
    // durable writes of a transfer. The authoritative stored count remains the
    // sanctuary meta total; carried ids that were never stored must not reduce it.
    return { items, total: meta.total, nextCursor };
}

export async function storePetInSanctuary(
    playerNameRaw: string,
    pet: Record<string, unknown>,
    source: PetSanctuarySource,
    now = Date.now(),
): Promise<{ item: PetSanctuaryItem; replayed: boolean }> {
    const playerName = safeName(playerNameRaw);
    if (!playerName) throw new Error('invalid-player-name');
    return withKvLock(petSanctuaryMetaKey(playerName), () => storePetInSanctuaryCore(kv, playerName, pet, source, now), { failClosed: true });
}

export async function getPetFromSanctuary(playerName: string, petId: string): Promise<PetSanctuaryItem | null> {
    return getPetFromSanctuaryCore(kv, playerName, petId);
}

export async function removePetFromSanctuary(playerNameRaw: string, petId: string): Promise<PetSanctuaryItem | null> {
    const playerName = safeName(playerNameRaw);
    if (!playerName) return null;
    return withKvLock(petSanctuaryMetaKey(playerName), () => removePetFromSanctuaryCore(kv, playerName, petId), { failClosed: true });
}

export async function listPetSanctuary(playerName: string, options: ListPetSanctuaryOptions = {}): Promise<PetSanctuaryListResult> {
    return listPetSanctuaryCore(kv, playerName, options);
}
