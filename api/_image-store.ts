import type { KvLike } from './_storage.js';
import {
    PER_IMAGE_PREFIX, categoryPrefixes, legacyBlobKey, legacyHashKey, legacyImageValue, perImageKey, scanCategoryIds,
} from './images.js';
import { assetMetaKey, contentHashOf, type AssetMeta } from './_asset-registry.js';

export { PER_IMAGE_PREFIX, categoryPrefixes, legacyBlobKey, legacyHashKey, scanCategoryIds };

/*
 * The shared image store's admin tools, one category at a time: a read-only
 * audit, and the rollback write-back.
 *
 * Every pre-split image is stored twice: as its own row, `shared:img:<id>`,
 * which GET /api/img serves first, and as a field of the category's legacy
 * rows, the hash `shared:imgfields:<cat>` and the frozen blob
 * `shared:images:<cat>`. Before the split (docs/SHARED_HASH_ROW_SPLIT_PLAN.md)
 * the manifest listed only the legacy rows, and every upload rewrote the whole
 * hash (9-16 MB for the big categories). The split stops writing those rows and
 * also lists ids by per-image key. The audit compares the two:
 *
 *   orphans          per-image rows the legacy rows do not list. Before the
 *                    split these needed a decision: an image lost to the old
 *                    parallel-publish race comes back, while a deleted image
 *                    whose row survived must be deleted properly. After it,
 *                    every new upload appears here too.
 *   missingPerImage  legacy ids with no per-image row. Only the legacy rows
 *                    serve them, so they block dropping those rows (Phase 3).
 *   differing        ids whose per-image bytes differ from the legacy bytes.
 *                    /api/img already serves the per-image ones.
 *   tombstones       empty legacy fields, which no manifest lists.
 *   duplicates       identical pictures under different ids. For avatars this is
 *                    a rough count of starter-preset copies.
 *
 * It only reads, and only by key: rows by key, and key lists by prefix (an
 * index range scan). Bytes are compared in Node. Postgres is never asked to
 * sort, group or aggregate image values: on 2026-10-13, five ad-hoc queries of
 * that shape wrote 10.9 GB of temp files on the 8 GB-capped production disk.
 * It never calls GET /api/img, which writes on a miss.
 */

const imgOwnerKey = (id: string) => `img-owner:${id}`;

/** Longest id list a report section returns. The counts are always exact. */
export const REPORT_LIST_CAP = 500;
/** Largest number of duplicate groups a report returns. */
const DUPLICATE_GROUP_CAP = 20;
/** Keys per batched read, so no single read carries more than ~25 images. */
const READ_CHUNK = 25;

export type OrphanDetail = {
    id: string;
    /** Length of the stored data URL, in characters. */
    chars: number;
    /** First-writer claim (`img-owner:<id>`), for player-created slots. */
    owner: string | null;
    /** From the asset registry (`asset:meta:<id>`), when it has a record. */
    uploadedBy: string | null;
    createdAt: number | null;
    updatedAt: number | null;
};

export type ImageStoreReport = {
    category: string;
    prefixes: string[] | 'all unknown prefixes';
    counts: {
        todayManifest: number;
        keyScan: number;
        orphans: number;
        missingPerImage: number;
        differing: number;
        tombstones: number;
        invalidPerImage: number;
    };
    /** Characters of image data held by each kind of row. */
    chars: { legacyHash: number; legacyBlob: number; perImage: number };
    orphans: OrphanDetail[];
    missingPerImage: string[];
    differing: Array<{ id: string; perImageChars: number; legacyChars: number }>;
    tombstones: string[];
    /** Per-image rows the key scan found whose value is not a non-empty string. */
    invalidPerImage: string[];
    duplicates: {
        distinctImages: number;
        groups: Array<{ contentHash: string; count: number; sampleIds: string[] }>;
    };
    readOnly: true;
};

/** The only storage calls an audit may make. None of them writes. */
export type AuditStore = Pick<KvLike, 'keys' | 'get' | 'mget' | 'hgetall'>;

export class ManifestUnavailableForAuditError extends Error {
    constructor() {
        super('image manifest could not be read');
        this.name = 'ManifestUnavailableForAuditError';
    }
}

type Values = Record<string, unknown>;

function asObject(value: unknown): Values {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Values : {};
}

const isImage = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const asNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function imageChars(values: Values): number {
    let total = 0;
    for (const value of Object.values(values)) if (typeof value === 'string') total += value.length;
    return total;
}

async function readInChunks(store: AuditStore, keys: string[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for (let i = 0; i < keys.length; i += READ_CHUNK) {
        out.push(...await store.mget(...keys.slice(i, i + READ_CHUNK)));
    }
    return out;
}

/**
 * Audit one category. `todayManifest` returns the ids that
 * `GET /api/images?cat=<cat>&ids=1` lists today, or null when they could not
 * be read; an audit never runs on a partial manifest.
 */
export async function auditImageCategory(cat: string, deps: {
    store: AuditStore;
    todayManifest: (cat: string) => Promise<string[] | null>;
}): Promise<ImageStoreReport> {
    const { store } = deps;
    const today = await deps.todayManifest(cat);
    if (today === null) throw new ManifestUnavailableForAuditError();
    const scanned = await scanCategoryIds(cat, store);
    const hash = asObject(await store.hgetall<Values>(legacyHashKey(cat)));
    const blob = asObject(await store.get<Values>(legacyBlobKey(cat)));
    // Leader portraits uploaded before 'leader' existed were filed under 'misc'.
    // Today's leader manifest and /api/img both still read them from there.
    const misc = cat === 'leader' ? asObject(await store.hgetall<Values>(legacyHashKey('misc'))) : {};

    const listed = new Set(today);
    const hasRow = new Set(scanned);
    const ids = [...new Set([...today, ...scanned])].sort();
    const stored = await readInChunks(store, ids.map(perImageKey));
    const perImage = new Map(ids.map((id, index) => [id, stored[index]] as const));

    const orphanIds: string[] = [];
    const missingPerImage: string[] = [];
    const differing: ImageStoreReport['differing'] = [];
    const invalidPerImage: string[] = [];
    const byContent = new Map<string, string[]>();
    let perImageChars = 0;
    for (const id of ids) {
        const value = perImage.get(id);
        if (hasRow.has(id) && !listed.has(id)) orphanIds.push(id);
        if (!isImage(value)) {
            if (hasRow.has(id)) invalidPerImage.push(id);
            if (listed.has(id)) missingPerImage.push(id);
            continue;
        }
        perImageChars += value.length;
        const content = contentHashOf(value);
        const members = byContent.get(content);
        if (members) members.push(id); else byContent.set(content, [id]);
        const legacy = legacyImageValue(id, hash as Record<string, string>, blob as Record<string, string>, misc as Record<string, string>);
        if (legacy !== null && legacy !== value) differing.push({ id, perImageChars: value.length, legacyChars: legacy.length });
    }

    const orphanSample = orphanIds.slice(0, REPORT_LIST_CAP);
    const owners = await readInChunks(store, orphanSample.map(imgOwnerKey));
    const metas = await readInChunks(store, orphanSample.map(assetMetaKey));
    const orphans: OrphanDetail[] = orphanSample.map((id, index) => {
        const value = perImage.get(id);
        const meta = asObject(metas[index]) as Partial<AssetMeta>;
        const owner = owners[index];
        return {
            id,
            chars: typeof value === 'string' ? value.length : 0,
            owner: typeof owner === 'string' ? owner : null,
            uploadedBy: typeof meta.createdBy === 'string' ? meta.createdBy : null,
            createdAt: asNumber(meta.createdAt),
            updatedAt: asNumber(meta.updatedAt),
        };
    });

    const tombstones = [...new Set(
        [...Object.entries(hash), ...Object.entries(blob)].filter(([, value]) => !isImage(value)).map(([id]) => id),
    )].sort();
    const groups = [...byContent.entries()]
        .filter(([, members]) => members.length > 1)
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .slice(0, DUPLICATE_GROUP_CAP)
        .map(([contentHash, members]) => ({ contentHash: contentHash.slice(0, 20), count: members.length, sampleIds: members.slice(0, 5) }));

    return {
        category: cat,
        prefixes: categoryPrefixes(cat) ?? 'all unknown prefixes',
        counts: {
            todayManifest: today.length,
            keyScan: scanned.length,
            orphans: orphanIds.length,
            missingPerImage: missingPerImage.length,
            differing: differing.length,
            tombstones: tombstones.length,
            invalidPerImage: invalidPerImage.length,
        },
        chars: { legacyHash: imageChars(hash), legacyBlob: imageChars(blob), perImage: perImageChars },
        orphans,
        missingPerImage: missingPerImage.slice(0, REPORT_LIST_CAP),
        differing: differing.slice(0, REPORT_LIST_CAP),
        tombstones: tombstones.slice(0, REPORT_LIST_CAP),
        invalidPerImage: invalidPerImage.slice(0, REPORT_LIST_CAP),
        duplicates: { distinctImages: byContent.size, groups },
        readOnly: true,
    };
}

/** The storage calls a write-back makes: the audit's reads plus one hset. */
export type WriteBackStore = AuditStore & Pick<KvLike, 'hset'>;

export type WriteBackResult = {
    category: string;
    /** Ids whose bytes went into the legacy hash (capped list; the count is exact). */
    written: string[];
    writtenCount: number;
};

/**
 * Rollback (plan §3.8). Pre-split code lists and serves only the legacy rows, so
 * before reverting to it, copy into the category's legacy hash every image whose
 * bytes those rows lack: each per-image row the legacy rows do not hold (uploaded
 * since the split), or hold with other bytes (replaced since). It is ONE hset, so
 * the multi-MB row is rewritten once however many images it restores (the
 * 2026-09-19 lesson). Turn the rollback lever on first
 * (IMAGE_LEGACY_HASH_WRITE=1), so no upload can land after the copy without also
 * reaching the hash.
 */
export async function writeBackImageCategory(cat: string, deps: { store: WriteBackStore }): Promise<WriteBackResult> {
    const { store } = deps;
    const scanned = await scanCategoryIds(cat, store);
    const hash = asObject(await store.hgetall<Values>(legacyHashKey(cat)));
    const blob = asObject(await store.get<Values>(legacyBlobKey(cat)));
    const misc = cat === 'leader' ? asObject(await store.hgetall<Values>(legacyHashKey('misc'))) : {};
    const stored = await readInChunks(store, scanned.map(perImageKey));
    const fields: Record<string, string> = {};
    scanned.forEach((id, index) => {
        const value = stored[index];
        if (!isImage(value)) return;
        const legacy = legacyImageValue(id, hash as Record<string, string>, blob as Record<string, string>, misc as Record<string, string>);
        if (legacy !== value) fields[id] = value;
    });
    const written = Object.keys(fields).sort();
    if (written.length) await store.hset(legacyHashKey(cat), fields);
    return { category: cat, written: written.slice(0, REPORT_LIST_CAP), writtenCount: written.length };
}
