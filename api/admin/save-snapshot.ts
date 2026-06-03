import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { isFullAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';

/*
 * /api/admin/save-snapshot  — admin-only POST
 *
 * Recovery path for the "my character disappeared" support flow. The
 * normal save endpoint already prevents wholesale data loss (partial-
 * payload merge + lifetime counter floors + per-row locks), but if a
 * save *does* get corrupted by a future bug or admin mistake, we want
 * a way to roll it back.
 *
 * Three actions, all FULL-admin only (Admin 1, constant-time password compare
 * via isFullAdmin). Snapshot/restore can overwrite any player's live save, so
 * content admins (Admin 2) must NOT have access — this is a destructive
 * recovery tool, not a content-curation one:
 *
 *   { action: 'snapshot', playerName }     — copies save:<name> to
 *                                            save-snapshot:<name>:<ts>
 *                                            with 90-day TTL. Returns
 *                                            the snapshot key.
 *
 *   { action: 'list', playerName }         — lists existing snapshots
 *                                            for a player (key + ts +
 *                                            character level for quick
 *                                            triage).
 *
 *   { action: 'restore', snapshotKey,      — copies a snapshot back to
 *     playerName }                           save:<name>. The current
 *                                            live save is first snapshotted
 *                                            to save-snapshot:<name>:<ts>
 *                                            so the restore itself is
 *                                            reversible.
 *
 * Snapshots are stored under `save-snapshot:<name>:<ts>` with a 90-day
 * TTL. The server-reset endpoint deliberately doesn't touch this prefix
 * so admin recovery survives a reset.
 *
 * No automated daily snapshots (yet) — those would bloat KV without a
 * deduplication strategy. This endpoint is the manual safety valve for
 * support cases.
 */

const SNAPSHOT_PREFIX = 'save-snapshot:';
const SNAPSHOT_TTL_SECONDS = 90 * 24 * 60 * 60;

type SnapshotAction = 'snapshot' | 'list' | 'restore';

function snapshotKeyFor(playerName: string, ts: number): string {
    return `${SNAPSHOT_PREFIX}${playerName}:${ts}`;
}

function snapshotPrefixFor(playerName: string): string {
    return `${SNAPSHOT_PREFIX}${playerName}:`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    if (!isFullAdmin(req)) {
        return res.status(401).json({ error: 'Full admin authentication required.' });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const action = body.action as SnapshotAction | undefined;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid playerName.' });

        const saveKey = `save:${playerName}`;

        if (action === 'snapshot') {
            const live = await kv.get<Record<string, unknown>>(saveKey);
            if (!live) return res.status(404).json({ error: 'No live save for that player.' });
            const ts = Date.now();
            const key = snapshotKeyFor(playerName, ts);
            await kv.set(key, live, { ex: SNAPSHOT_TTL_SECONDS });
            return res.status(200).json({ ok: true, snapshotKey: key, ts });
        }

        if (action === 'list') {
            const keys = await kv.keys(`${snapshotPrefixFor(playerName)}*`);
            if (keys.length === 0) return res.status(200).json({ ok: true, snapshots: [] });
            // mget all snapshots in one round-trip; surface only metadata
            // (ts + character.level + character.name) so the response stays
            // small even for players with many snapshots.
            const values = await kv.mget<Record<string, unknown>[]>(...keys);
            const snapshots = keys.map((k, i) => {
                const v = values[i];
                const char = (v && typeof v === 'object' && 'character' in v)
                    ? (v.character as Record<string, unknown> | undefined)
                    : undefined;
                const tsRaw = k.slice(snapshotPrefixFor(playerName).length);
                return {
                    key: k,
                    ts: Number(tsRaw),
                    level: char?.level,
                    displayName: char?.name,
                };
            }).sort((a, b) => b.ts - a.ts);
            return res.status(200).json({ ok: true, snapshots });
        }

        if (action === 'restore') {
            const snapshotKey = typeof body.snapshotKey === 'string' ? body.snapshotKey.trim() : '';
            if (!snapshotKey.startsWith(snapshotPrefixFor(playerName))) {
                return res.status(400).json({ error: 'snapshotKey does not match playerName.' });
            }
            const snap = await kv.get<Record<string, unknown>>(snapshotKey);
            if (!snap) return res.status(404).json({ error: 'Snapshot not found or expired.' });

            // Age check. Snapshots have a 90-day TTL but restoring a 60-day-old
            // snapshot would silently erase weeks of progress. Require explicit
            // confirmation in the request body when the snapshot is older than
            // 7 days. The admin sees the snapshot age on the list and can pass
            // `confirmOldSnapshot: true` if they really mean it.
            const tsMatch = snapshotKey.match(/:(\d+)$/);
            const snapTs = tsMatch ? Number(tsMatch[1]) : 0;
            const ageMs = snapTs ? (Date.now() - snapTs) : 0;
            const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
            if (ageMs > SEVEN_DAYS_MS && body.confirmOldSnapshot !== true) {
                return res.status(400).json({
                    error: `Snapshot is ${Math.floor(ageMs / (24 * 60 * 60 * 1000))} days old. Pass confirmOldSnapshot: true to proceed.`,
                    ageMs,
                });
            }

            // Lock the live save while we (a) snapshot the current state,
            // then (b) overwrite with the requested snapshot. Both steps
            // happen under the same lock so a player autosave landing
            // mid-restore can't slip in between.
            await withKvLock(saveKey, async () => {
                const live = await kv.get<Record<string, unknown>>(saveKey);
                if (live) {
                    const preRestoreKey = snapshotKeyFor(playerName, Date.now());
                    await kv.set(preRestoreKey, live, { ex: SNAPSHOT_TTL_SECONDS });
                }
                await kv.set(saveKey, snap);
            });

            return res.status(200).json({ ok: true, restoredFrom: snapshotKey });
        }

        return res.status(400).json({ error: 'Invalid action.' });
    } catch (err) {
        console.error('[admin/save-snapshot]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
