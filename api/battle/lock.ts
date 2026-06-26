import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';

/*
 * /api/battle/lock  — POST only, multiplexed by `action`
 *
 * A server-side "you are in a fight" marker so a player cannot escape a PvE
 * battle by refreshing (or by clearing localStorage and refreshing). The lock
 * lives in KV under `battle-lock:<player>`, written ONLY here — it is NOT part
 * of the client-writable save body, so the normal /api/save POST can't clear it.
 *
 * Decision (resume-only, no loss-on-abandon): this endpoint does NOT pay
 * rewards or apply penalties. The PvE battle outcome stays client-resolved
 * exactly as today (a loss still hospitalizes client-side). The lock's sole job
 * is anti-escape: on the next load the client reads the lock via `status` and
 * forces re-entry into the same fight. Honest disconnects are never punished —
 * they just resume.
 *
 * Actions (POST body `{ action, playerName, ... }`):
 *   - start   { battleId, kind, screen, meta? } → set the lock (idempotent; if a
 *               DIFFERENT unresolved battle is already locked, returns THAT one
 *               instead of overwriting, so a cheater can't supersede a losing
 *               fight with a trivial new one).
 *   - resolve { battleId }                       → clear the lock iff battleId
 *               matches (called on win / loss / flee). Never rate-limited so a
 *               lock always clears.
 *   - status  {}                                 → read the current lock (called
 *               on boot to decide whether to force re-entry).
 *
 * The lock self-heals via a 6h TTL so a truly abandoned fight (player gone for
 * hours) can't trap the account forever.
 */

export type BattleLock = {
    battleId: string;
    kind: string;     // e.g. "arena" | "endlessTower" | "weeklyBoss" | "dungeon" | …
    screen: string;   // the Screen value to force re-entry into
    startedAt: number;
    meta?: Record<string, unknown>; // optional encounter params for reconstruct-on-load
};

// 1h — matches the client ArenaBattlePersister TTL so the lock and the
// resumable state expire TOGETHER. If the lock outlived the resumable state
// there'd be a window where a refresh finds a lock but no resume state and
// wrongly counts a loss; aligning the TTLs closes that window.
const LOCK_TTL_SECONDS = 60 * 60;
const BATTLE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const KIND_RE = /^[A-Za-z0-9:_-]{1,40}$/;
const SCREEN_RE = /^[A-Za-z0-9_]{1,40}$/;
// Cap on the serialized meta blob so a client can't stuff the lock record.
const MAX_META_BYTES = 2048;

function lockKey(playerName: string): string {
    return `battle-lock:${playerName}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const body = typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
        : (req.body ?? {});

    const action = String(body.action ?? '');
    const playerName = safeName(String(body.playerName ?? ''));

    // Lenient throttle on the boot/write actions; `resolve` is intentionally
    // NOT throttled — a blocked resolve would strand the player in a re-fight.
    if (action !== 'resolve') {
        const peekName = typeof body.playerName === 'string' ? body.playerName : undefined;
        if (!enforceRateLimit(req, res, 'battle-lock', 10, 10_000, peekName)) return;
    }

    if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

    const identity = await authedPlayerOrAdmin(req, playerName);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && identity.name !== playerName) {
        return res.status(403).json({ error: 'Can only manage your own battle lock.' });
    }

    const key = lockKey(playerName);

    try {
        if (action === 'status') {
            const lock = await kv.get<BattleLock>(key);
            return res.status(200).json({ ok: true, lock: lock ?? null });
        }

        if (action === 'start') {
            const battleId = String(body.battleId ?? '');
            const kind = String(body.kind ?? '');
            const screen = String(body.screen ?? '');
            if (!BATTLE_ID_RE.test(battleId) || !KIND_RE.test(kind) || !SCREEN_RE.test(screen)) {
                return res.status(400).json({ error: 'Invalid battle parameters.' });
            }
            let meta: Record<string, unknown> | undefined;
            if (body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)) {
                try {
                    if (JSON.stringify(body.meta).length <= MAX_META_BYTES) {
                        meta = body.meta as Record<string, unknown>;
                    }
                } catch { /* unserializable meta — drop it */ }
            }

            // Idempotent / non-clobbering: if a different unresolved battle is
            // already locked, hand it back so the client re-enters THAT fight
            // rather than letting a fresh start overwrite (and thereby escape) it.
            const existing = await kv.get<BattleLock>(key);
            if (existing && existing.battleId !== battleId) {
                return res.status(200).json({ ok: true, lock: existing, alreadyLocked: true });
            }

            const lock: BattleLock = {
                battleId,
                kind,
                screen,
                startedAt: Date.now(),
                ...(meta ? { meta } : {}),
            };
            await kv.set(key, lock, { ex: LOCK_TTL_SECONDS });
            return res.status(200).json({ ok: true, lock });
        }

        if (action === 'resolve') {
            const battleId = String(body.battleId ?? '');
            const outcome = String(body.outcome ?? '');
            const existing = await kv.get<BattleLock>(key);
            // Only the matching battleId clears the lock. A mismatch is a stale
            // / replayed report → no-op success (don't clear someone else's
            // freshly-started fight).
            if (existing && existing.battleId === battleId) {
                if (outcome === 'loss') {
                    // Cleared-state defeat: the client returned to a locked fight
                    // with NO recoverable resume state (localStorage was wiped),
                    // so per design it counts as a loss. Apply the defeat
                    // server-side under the save lock and delete the lock in the
                    // SAME critical section, so the loss is atomic with the unlock
                    // and can't be dodged by a fast double-refresh. (Normal in-
                    // session wins/losses are still applied client-side and just
                    // pass no outcome here — this branch is only the boot-time
                    // cleared-state fallback.) A PvE defeat is simply hp:0 +
                    // hospitalized; the hospital timer is client-side.
                    await withKvLock(`save:${playerName}`, async () => {
                        const fresh = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                        const freshChar = fresh?.character as Record<string, unknown> | undefined;
                        if (freshChar) {
                            const updated = {
                                ...fresh,
                                character: { ...freshChar, hp: 0, hospitalized: true },
                            };
                            await kv.set(`save:${playerName}`, mergePreservingImages(bumpSaveVersion(updated), fresh));
                        }
                        await kv.del(key).catch(() => undefined);
                    });
                } else {
                    await kv.del(key).catch(() => undefined);
                }
            }
            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        console.error('[battle/lock]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
