import { createHash } from 'crypto';
import { kv } from './_storage.js';
import type { KvLike } from './_storage.js';

// ─── Asset metadata registry ──────────────────────────────────────────────────
//
// The image system stores raw blobs keyed by id (`shared:img:<id>`, plus the
// per-category hashes) with NO metadata — so there is no way to ask "which
// catalog entries are missing an image?", "are these two the same picture?", or
// "who uploaded this and when?". This registry WRAPS the existing image path
// (it never replaces it): every image write side-writes a small companion
// record under `asset:meta:<id>`, leaving the image storage and serving paths
// completely untouched.
//
// The write is best-effort and gated by DISABLE_ASSET_META=1 — a metadata hiccup
// can never fail or alter an image upload. Records are pointers/metadata only;
// the actual bytes stay where they already live (cPanel/KV).

const META_PREFIX = 'asset:meta:';
export function assetMetaKey(id: string): string { return `${META_PREFIX}${id}`; }
export { META_PREFIX as ASSET_META_PREFIX };

export type AssetType = 'icon' | 'portrait' | 'background' | 'animation' | 'static';

export interface AssetMeta {
    id: string;
    category: string;
    type: AssetType;
    format: string;        // png | jpeg | webp | gif | url | unknown
    bytes: number;         // decoded byte length (0 for external url)
    contentHash: string;   // sha256 of the decoded bytes (or url:<sha256> for links)
    createdBy: string;     // uploader slug, or 'admin' for password auth
    createdAt: number;
    updatedAt: number;
    hidden: boolean;
    tags: string[];
    frames?: number;       // animation frame count (not auto-detected yet)
    animSpeed?: number;    // animation speed (not auto-detected yet)
    sourceNote?: string;   // license / provenance note
}

// ── Pure helpers (no I/O) ─────────────────────────────────────────────────────

export function imageFormat(image: string): string {
    const m = /^data:image\/(png|jpe?g|webp|gif);base64,/i.exec(image);
    if (m) return m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
    if (/^https?:\/\//i.test(image)) return 'url';
    return 'unknown';
}

// Decoded byte length of a base64 data URL (0 for non-data URLs), computed
// without allocating the buffer. Mirrors images.ts base64DecodedByteLength.
export function decodedBytes(image: string): number {
    if (!/^data:[^,]*;base64,/i.test(image)) return 0;
    const comma = image.indexOf(',');
    const b64 = comma >= 0 ? image.slice(comma + 1) : image;
    if (b64.length === 0) return 0;
    const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.floor((b64.length * 3) / 4) - pad;
}

// Stable content hash for duplicate detection. For data URLs it hashes the
// DECODED bytes (so the same picture re-encoded byte-identically collides); for
// external links it hashes the trimmed URL with a `url:` marker.
export function contentHashOf(image: string): string {
    if (/^data:[^,]*;base64,/i.test(image)) {
        const comma = image.indexOf(',');
        const b64 = comma >= 0 ? image.slice(comma + 1) : image;
        try {
            return createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');
        } catch {
            return createHash('sha256').update(image).digest('hex');
        }
    }
    return 'url:' + createHash('sha256').update(image.trim()).digest('hex');
}

const PORTRAIT_CATS = new Set(['avatar', 'pet', 'ai', 'leader', 'bloodline']);
const ICON_CATS = new Set(['jutsu', 'item', 'card']);
const BACKGROUND_CATS = new Set(['event', 'shrine', 'landmark']);

export function assetTypeFor(category: string, id: string, format: string): AssetType {
    const prefix = id.split(':')[0]?.toLowerCase() ?? '';
    if (format === 'gif' || prefix === 'petsheet' || prefix === 'petlayers') return 'animation';
    if (ICON_CATS.has(category)) return 'icon';
    if (PORTRAIT_CATS.has(category)) return 'portrait';
    if (BACKGROUND_CATS.has(category)) return 'background';
    return 'static';
}

// Build a metadata record. Preserves identity/provenance fields from a prior
// record (createdAt/createdBy/hidden/tags/frames/animSpeed/sourceNote) and only
// refreshes the content-derived fields + updatedAt, so re-uploading an image
// keeps its curated metadata.
export function buildAssetMeta(params: {
    id: string;
    category: string;
    image: string;
    actor: string;
    now: number;
    prev?: AssetMeta | null;
}): AssetMeta {
    const { id, category, image, actor, now, prev } = params;
    const format = imageFormat(image);
    const meta: AssetMeta = {
        id,
        category,
        type: assetTypeFor(category, id, format),
        format,
        bytes: decodedBytes(image),
        contentHash: contentHashOf(image),
        createdBy: prev?.createdBy ?? actor,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        hidden: prev?.hidden ?? false,
        tags: prev?.tags ?? [],
    };
    if (prev?.frames !== undefined) meta.frames = prev.frames;
    if (prev?.animSpeed !== undefined) meta.animSpeed = prev.animSpeed;
    if (prev?.sourceNote !== undefined) meta.sourceNote = prev.sourceNote;
    return meta;
}

// Pure: group records by content hash and return only the collisions (>1 id).
export function findDuplicates(metas: AssetMeta[]): Array<{ contentHash: string; ids: string[] }> {
    const byHash = new Map<string, string[]>();
    for (const m of metas) {
        if (!m?.contentHash) continue;
        const arr = byHash.get(m.contentHash) ?? [];
        arr.push(m.id);
        byHash.set(m.contentHash, arr);
    }
    return [...byHash.entries()]
        .filter(([, ids]) => ids.length > 1)
        .map(([contentHash, ids]) => ({ contentHash, ids }));
}

// ── KV-touching wrappers (best-effort, injectable store for tests) ────────────

type AssetKv = Pick<KvLike, 'get' | 'set' | 'del' | 'keys' | 'mget'>;

function assetMetaDisabled(): boolean { return process.env.DISABLE_ASSET_META === '1'; }

export async function writeAssetMeta(
    params: { id: string; category: string; image: string; actor: string; now?: number },
    opts: { kv?: Pick<KvLike, 'get' | 'set'> } = {},
): Promise<void> {
    if (assetMetaDisabled()) return;
    const store = opts.kv ?? kv;
    const now = params.now ?? Date.now();
    try {
        const prev = await store.get<AssetMeta>(assetMetaKey(params.id));
        const meta = buildAssetMeta({ ...params, now, prev: prev ?? undefined });
        await store.set(assetMetaKey(params.id), meta);
    } catch {
        // best-effort — never break the image upload
    }
}

export async function deleteAssetMeta(
    id: string,
    opts: { kv?: Pick<KvLike, 'del'> } = {},
): Promise<void> {
    const store = opts.kv ?? kv;
    try {
        await store.del(assetMetaKey(id));
    } catch {
        // best-effort
    }
}

export async function listAssetMeta(
    opts: { kv?: AssetKv; limit?: number } = {},
): Promise<AssetMeta[]> {
    const store = opts.kv ?? kv;
    try {
        const keys = await store.keys(`${META_PREFIX}*`);
        if (!keys.length) return [];
        const capped = keys.slice(0, opts.limit ?? 5000);
        const vals = await store.mget<AssetMeta[]>(...capped);
        return vals.filter((v): v is AssetMeta => !!v && typeof v === 'object');
    } catch {
        return [];
    }
}
