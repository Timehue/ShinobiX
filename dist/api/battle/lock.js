"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
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
function lockKey(playerName) {
    return `battle-lock:${playerName}`;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    const body = typeof req.body === 'string'
        ? (() => { try {
            return JSON.parse(req.body);
        }
        catch {
            return {};
        } })()
        : (req.body ?? {});
    const action = String(body.action ?? '');
    const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
    // Lenient throttle on the boot/write actions; `resolve` is intentionally
    // NOT throttled — a blocked resolve would strand the player in a re-fight.
    if (action !== 'resolve') {
        const peekName = typeof body.playerName === 'string' ? body.playerName : undefined;
        if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'battle-lock', 10, 10_000, peekName))
            return;
    }
    if (!playerName)
        return res.status(400).json({ error: 'Invalid player name.' });
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && identity.name !== playerName) {
        return res.status(403).json({ error: 'Can only manage your own battle lock.' });
    }
    const key = lockKey(playerName);
    try {
        if (action === 'status') {
            const lock = await _storage_js_1.kv.get(key);
            return res.status(200).json({ ok: true, lock: lock ?? null });
        }
        if (action === 'start') {
            const battleId = String(body.battleId ?? '');
            const kind = String(body.kind ?? '');
            const screen = String(body.screen ?? '');
            if (!BATTLE_ID_RE.test(battleId) || !KIND_RE.test(kind) || !SCREEN_RE.test(screen)) {
                return res.status(400).json({ error: 'Invalid battle parameters.' });
            }
            let meta;
            if (body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)) {
                try {
                    if (JSON.stringify(body.meta).length <= MAX_META_BYTES) {
                        meta = body.meta;
                    }
                }
                catch { /* unserializable meta — drop it */ }
            }
            // Idempotent / non-clobbering: if a different unresolved battle is
            // already locked, hand it back so the client re-enters THAT fight
            // rather than letting a fresh start overwrite (and thereby escape) it.
            const existing = await _storage_js_1.kv.get(key);
            if (existing && existing.battleId !== battleId) {
                return res.status(200).json({ ok: true, lock: existing, alreadyLocked: true });
            }
            const lock = {
                battleId,
                kind,
                screen,
                startedAt: Date.now(),
                ...(meta ? { meta } : {}),
            };
            await _storage_js_1.kv.set(key, lock, { ex: LOCK_TTL_SECONDS });
            return res.status(200).json({ ok: true, lock });
        }
        if (action === 'resolve') {
            const battleId = String(body.battleId ?? '');
            const outcome = String(body.outcome ?? '');
            const existing = await _storage_js_1.kv.get(key);
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
                    await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                        const fresh = await _storage_js_1.kv.get(`save:${playerName}`);
                        const freshChar = fresh?.character;
                        if (freshChar) {
                            const updated = {
                                ...fresh,
                                character: { ...freshChar, hp: 0, hospitalized: true },
                            };
                            await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)(updated), fresh));
                        }
                        await _storage_js_1.kv.del(key).catch(() => undefined);
                    });
                }
                else {
                    await _storage_js_1.kv.del(key).catch(() => undefined);
                }
            }
            return res.status(200).json({ ok: true });
        }
        return res.status(400).json({ error: 'Unknown action.' });
    }
    catch (err) {
        console.error('[battle/lock]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
