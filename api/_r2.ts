/*
 * Cloudflare R2 helper (Stage 3 image serving — see docs/R2_IMAGE_MIGRATION_PLAN.md).
 *
 * Serves shared image BYTES from R2 object storage ($0 egress) instead of reading
 * them out of Postgres through the Express `/api/img` handler. This removes the
 * database round-trip from the hot image path — the root cause of random enemy
 * portraits blanking in PvE combat (a cold `/api/img` DB read 503-ing under load).
 *
 * FULLY GATED + INERT until configured. With the env vars unset, every export
 * here is a no-op / false, so the live game behaves EXACTLY as before (Postgres).
 *   - READ  redirect (api/img.ts)         → enabled by R2_PUBLIC_BASE
 *   - WRITE dual-write + backfill          → enabled by the four write creds below
 *
 * Recommended cutover order (mirrors the cPanel-retirement discipline):
 *   1. set the four write creds → deploy  (new uploads dual-write to R2)
 *   2. run POST /api/admin/migrate-images-to-r2 until it reports 0 failures
 *   3. set R2_PUBLIC_BASE → deploy         (reads redirect to R2, DB fallback stays)
 *
 * No AWS SDK dependency: R2 reads use the public bucket domain (no signing);
 * writes are signed here with a minimal AWS SigV4 implementation over node:crypto
 * + global fetch. Keeps the server bundle small and the lockfile untouched.
 */

import { createHash, createHmac } from 'node:crypto';

const REGION = 'auto';
const SERVICE = 's3';

function env(name: string): string | undefined {
    const v = process.env[name];
    return v && v.trim() ? v.trim() : undefined;
}

// Reads only need the public bucket base URL (unsigned GET/HEAD via Cloudflare).
export function r2ReadEnabled(): boolean {
    return !!env('R2_PUBLIC_BASE');
}

// Writes (dual-write on upload + backfill) need the S3 API creds.
function writeConfig(): { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string } | null {
    const accountId = env('R2_ACCOUNT_ID');
    const accessKeyId = env('R2_ACCESS_KEY_ID');
    const secretAccessKey = env('R2_SECRET_ACCESS_KEY');
    const bucket = env('R2_BUCKET');
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
    return { accountId, accessKeyId, secretAccessKey, bucket };
}

export function r2WriteEnabled(): boolean {
    return writeConfig() !== null;
}

// Map an image id ("<cat>:<key>") to an R2 object key. Colons → slashes so the
// object lays out as clean folders (ai/enemy-x, vn/<id>/page/0) and the public
// URL needs no escaping. Deterministic + collision-free (image ids never contain
// '/'), and only ever used forward (id→key), never reversed.
export function objectKeyForId(id: string): string {
    return id.replace(/:/g, '/');
}

// Public URL the browser hits for the bytes (Cloudflare-fronted, edge-cached).
export function r2PublicUrl(id: string, version?: string): string | null {
    const base = env('R2_PUBLIC_BASE');
    if (!base) return null;
    const path = objectKeyForId(id).split('/').map(encodeURIComponent).join('/');
    return `${base.replace(/\/+$/, '')}/${path}${version ? `?v=${encodeURIComponent(version)}` : ''}`;
}

// ── AWS SigV4 (single-part PUT), minimal + dependency-free ───────────────────
function sha256Hex(data: Buffer | string): string {
    return createHash('sha256').update(data).digest('hex');
}
function hmac(key: Buffer | string, data: string): Buffer {
    return createHmac('sha256', key).update(data, 'utf8').digest();
}
// AWS-flavoured percent-encoding: unreserved chars pass; everything else is
// %XX over UTF-8 bytes. `/` optionally preserved for path segments.
function s3UriEncode(str: string, encodeSlash = true): string {
    let out = '';
    for (const byte of Buffer.from(str, 'utf8')) {
        const ch = String.fromCharCode(byte);
        if (/[A-Za-z0-9\-_.~]/.test(ch)) out += ch;
        else if (ch === '/' && !encodeSlash) out += ch;
        else out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
    }
    return out;
}

/**
 * PUT one image's bytes to R2. Returns true on 2xx, false otherwise (best-effort;
 * callers never let a false fail the underlying operation — Postgres stays
 * authoritative). No-op returning false when write creds are absent.
 */
export async function putImage(
    id: string,
    body: { mime: string; buf: Buffer },
    opts?: { timeoutMs?: number },
): Promise<boolean> {
    return mutateImage('PUT', id, body, opts);
}

/** Remove the object as well as database references. A failed removal must
 * remain retryable, so callers must not claim success on false. */
export async function deleteImage(id: string, opts?: { timeoutMs?: number }): Promise<boolean> {
    return mutateImage('DELETE', id, { mime: 'application/octet-stream', buf: Buffer.alloc(0) }, opts);
}

async function mutateImage(
    method: 'PUT' | 'DELETE', id: string,
    body: { mime: string; buf: Buffer }, opts?: { timeoutMs?: number },
): Promise<boolean> {
    const cfg = writeConfig();
    if (!cfg) return false;

    const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
    const canonicalUri = '/' + s3UriEncode(cfg.bucket, false) + '/' + s3UriEncode(objectKeyForId(id), false);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body.buf);
    const contentType = body.mime || 'application/octet-stream';

    const canonicalHeaders =
        `content-type:${contentType}\n` +
        `host:${host}\n` +
        `x-amz-content-sha256:${payloadHash}\n` +
        `x-amz-date:${amzDate}\n`;
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

    const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

    const kDate = hmac('AWS4' + cfg.secretAccessKey, dateStamp);
    const kRegion = hmac(kDate, REGION);
    const kService = hmac(kRegion, SERVICE);
    const kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

    const authorization =
        `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    // Blob wrapper over a fresh ArrayBuffer: the fetch typings in this toolchain
    // exclude ArrayBufferView from BodyInit, and Buffer's backing store is typed
    // ArrayBufferLike (possibly SharedArrayBuffer). A plain ArrayBuffer copy is an
    // unambiguous BlobPart and streams the exact signed bytes.
    const ab = new ArrayBuffer(body.buf.byteLength);
    new Uint8Array(ab).set(body.buf);
    try {
        const res = await fetch(`https://${host}${canonicalUri}`, {
            method,
            headers: {
                'Authorization': authorization,
                'Content-Type': contentType,
                'x-amz-content-sha256': payloadHash,
                'x-amz-date': amzDate,
            },
            body: method === 'PUT' ? new Blob([ab], { type: contentType }) : undefined,
            signal: AbortSignal.timeout(opts?.timeoutMs ?? 15_000),
        });
        if (res.ok || (method === 'DELETE' && res.status === 404)) {
            for (const key of _confirmedInR2) if (key.startsWith(`${id}\0`)) _confirmedInR2.delete(key);
            return true;
        }
        console.error(`[r2] ${method} ${id} → ${res.status}`);
        return false;
    } catch (err) {
        console.error(`[r2] ${method} ${id} failed:`, err);
        return false;
    }
}

// Process-local cache of image generations confirmed present in R2. A new
// manifest version checks a fresh CDN URL; writes/deletes invalidate local hits.
// Same single-process invariant as onlineStore / _proc-cache (safe on Railway).
const _confirmedInR2 = new Set<string>();

/**
 * Does the bytes for `id` exist in R2? Unsigned HEAD to the public (Cloudflare)
 * URL — fast + edge-cached. Positive results use a bounded generation cache;
 * misses are NOT cached (so a just-dual-written / just-backfilled id converges on
 * the next request). Returns false when reads aren't enabled or on any error, so
 * the caller safely falls back to the existing Postgres path.
 */
export async function r2ObjectExists(id: string, opts?: { timeoutMs?: number; version?: string }): Promise<boolean> {
    const key = `${id}\0${opts?.version ?? ''}`;
    if (_confirmedInR2.has(key)) return true;
    const url = r2PublicUrl(id, opts?.version);
    if (!url) return false;
    try {
        const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(opts?.timeoutMs ?? 2_500) });
        if (res.ok) {
            if (_confirmedInR2.size >= 4096) _confirmedInR2.delete(_confirmedInR2.values().next().value!);
            _confirmedInR2.add(key);
            return true;
        }
        return false;
    } catch {
        return false;
    }
}
