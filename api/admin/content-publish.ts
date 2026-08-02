import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, parseJsonBody, mergePreservingImages } from '../_utils.js';
import { isAdmin, isFullAdmin } from '../_auth.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { adminSaveTargetAllowed, stripForgedItems, isAdminContentSlot } from '../save/[name].js';
import {
    CONTENT_FIELDS,
    contentKey,
    isContentField,
    publishContent,
    readContentRecord,
    ContentVersionConflictError,
    __resetContentCache,
} from '../_content-store.js';

/*
 * /api/admin/content-publish — the guarded home for admin-authored content.
 *
 * Replaces `POST /api/save/<slot>?signal=1` as the way to publish shared game
 * content. That path takes no lock and runs no version check, so two admin
 * tabs race and a stale one silently reverts newer content (Phase 0
 * shared-content audit, finding 4). This endpoint:
 *
 *   1. requires admin auth (content admins = the admin1/admin2 slots);
 *   2. serializes each field through withKvLock(content:<field>) failClosed;
 *   3. enforces an optimistic-concurrency baseVersion — a stale editor gets a
 *      409 telling it to reload, instead of overwriting the newer content;
 *   4. strips personal forged gear (that rule belongs to every publish path);
 *   5. MIRRORS the result into the admin slot, so every existing reader — the
 *      server catalogs and every live client, which still hydrate from
 *      save:admin1 / save:admin2 — keeps working with no migration.
 *
 * GET  → { ok, fields: { <field>: { version, updatedAt, updatedBy } } }
 *        (editors read this first and echo the versions back on publish)
 * POST → { slot?, fields: { <field>: value }, baseVersions?: { <field>: n } }
 *        → { ok, published: { <field>: version }, conflicts?: [...] }
 */

const DEFAULT_SLOT = 'admin1';

function pickSlot(raw: unknown): string {
    const slot = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return isAdminContentSlot(slot) ? slot : DEFAULT_SLOT;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Admin-only. Admin 2 is the content role, so full admin is not required —
    // the same rule the admin save path applies to the two content slots.
    const anyAdmin = isAdmin(req);
    const fullAdmin = isFullAdmin(req);
    if (!anyAdmin) return res.status(401).json({ error: 'Admin authentication required.' });

    if (req.method === 'GET') {
        try {
            const records = await Promise.all(CONTENT_FIELDS.map((field) => readContentRecord(field)));
            const fields: Record<string, { version: number; updatedAt: number; updatedBy: string }> = {};
            for (const record of records) {
                if (record) fields[record.field] = { version: record.version, updatedAt: record.updatedAt, updatedBy: record.updatedBy };
            }
            return res.status(200).json({ ok: true, fields });
        } catch (err) {
            console.error('[admin/content-publish GET]', safeLogValue(err));
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    if (req.method !== 'POST') return res.status(405).end();

    try {
        const parsed = parseJsonBody(req.body);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const body = (parsed.body ?? {}) as Record<string, unknown>;

        const slot = pickSlot(body.slot);
        if (!adminSaveTargetAllowed(slot, fullAdmin, anyAdmin)) {
            return res.status(403).json({ error: 'Not allowed to publish to that slot.' });
        }

        const rawFields = body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)
            ? body.fields as Record<string, unknown>
            : null;
        if (!rawFields) return res.status(400).json({ error: 'Missing fields.' });
        const requested = Object.keys(rawFields).filter(isContentField);
        if (requested.length === 0) return res.status(400).json({ error: 'No publishable content fields supplied.' });

        const baseVersions = body.baseVersions && typeof body.baseVersions === 'object' && !Array.isArray(body.baseVersions)
            ? body.baseVersions as Record<string, unknown>
            : {};
        const actor = fullAdmin ? 'admin:full' : 'admin:content';

        const published: Record<string, number> = {};
        const conflicts: Array<{ field: string; storedVersion: number; baseVersion: number }> = [];

        for (const field of requested) {
            // Personal forged gear is never shared content, on ANY publish path.
            const value = field === 'creatorItems' ? stripForgedItems(rawFields[field]) : rawFields[field];
            const rawBase = Number(baseVersions[field]);
            const baseVersion = Number.isFinite(rawBase) ? rawBase : undefined;
            try {
                // Lock the shared resource (content:<field>), not the actor's
                // save — the contended thing is the field itself.
                const record = await withKvLock(contentKey(field), async () =>
                    publishContent(field, value, { actor, baseVersion }),
                { failClosed: true });
                published[field] = record.version;
            } catch (err) {
                if (err instanceof ContentVersionConflictError) {
                    conflicts.push({ field, storedVersion: err.storedVersion, baseVersion: err.baseVersion });
                    continue;
                }
                if (err instanceof LockContendedError) {
                    conflicts.push({ field, storedVersion: -1, baseVersion: baseVersion ?? -1 });
                    continue;
                }
                throw err;
            }
        }
        __resetContentCache();

        // Compatibility mirror: the admin slots stay the source every existing
        // reader uses until the cutover (docs/runbooks/shared-content-cutover.md).
        // Only the fields that actually published are mirrored, under the slot's
        // own save lock so a concurrent admin save can't interleave.
        let mirrored = false;
        if (Object.keys(published).length > 0) {
            const saveKey = `save:${slot}`;
            try {
                await withKvLock(saveKey, async () => {
                    const existing = await kv.get<Record<string, unknown>>(saveKey);
                    if (!existing) return;
                    const patch: Record<string, unknown> = {};
                    for (const field of Object.keys(published)) {
                        patch[field] = field === 'creatorItems' ? stripForgedItems(rawFields[field]) : rawFields[field];
                    }
                    const next = bumpSaveVersion({ ...existing, ...patch });
                    await kv.set(saveKey, mergePreservingImages(next, existing));
                    mirrored = true;
                }, { failClosed: true });
            } catch (err) {
                // The canonical write already committed; a failed mirror only
                // means legacy readers lag until the next publish.
                console.error('[admin/content-publish] slot mirror failed', safeLogValue(slot), safeLogValue(err));
            }
        }

        const status = conflicts.length > 0 && Object.keys(published).length === 0 ? 409 : 200;
        return res.status(status).json({
            ok: conflicts.length === 0,
            slot,
            published,
            mirrored,
            ...(conflicts.length > 0
                ? { conflicts, error: 'Someone else published newer content for those fields. Reload before saving.' }
                : {}),
        });
    } catch (err) {
        console.error('[admin/content-publish]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
