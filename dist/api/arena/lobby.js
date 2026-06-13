"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = __importDefault(require("node:crypto"));
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _lock_js_1 = require("../_lock.js");
const _lobby_core_js_1 = require("./_lobby-core.js");
/*
 * Co-op Tactical Pet Arena lobby — server-authoritative coordinator for the
 * deterministic 4v4 replay (see api/arena/_lobby-core.ts for the model). One
 * POST endpoint with an `action`, mirroring api/pvp/pet-ranked-queue.ts:
 *   create  host opens a lobby           → { code, lobby }
 *   join    {code, team?}                 → { lobby }
 *   pets    {code, petIds:[a,b]}          → { lobby }   (ownership-validated)
 *   start   {code}  host only             → { lobby }   (seals seed + rosters)
 *   leave   {code}                        → { ok }
 *   poll    {code}  (read-only)           → { lobby }
 * GET ?code=XXXX also returns the lobby for the authed viewer.
 *
 * NO rewards are paid here — arena is preview. The seal in lobby.match is the
 * hook a future reward path would recompute from (never a client result).
 */
const LOBBY_TTL = 30 * 60; // 30-minute lobby lifetime (KV TTL)
const lobbyKey = (code) => `arena:lobby:${code}`;
const CODE_RE = /^[A-Z0-9]{4}$/;
const normCode = (v) => String(v ?? '').trim().toUpperCase();
const asTeam = (v) => (v === 'blue' || v === 'red' ? v : undefined);
async function mintLobby(host, now) {
    // nx create is atomic, so a collision just retries with a fresh code.
    for (let i = 0; i < 8; i++) {
        const code = (0, _lobby_core_js_1.codeFromBytes)(node_crypto_1.default.randomBytes(8));
        const lobby = (0, _lobby_core_js_1.newLobby)(code, host, now);
        const ok = await _storage_js_1.kv.set(lobbyKey(code), lobby, { ex: LOBBY_TTL, nx: true });
        if (ok)
            return { code, lobby };
    }
    return null;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    // ── GET: read a lobby for the authed viewer ───────────────────────────────
    if (req.method === 'GET') {
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        const me = identity.admin ? (0, _utils_js_1.safeName)(String(req.query.name ?? '')) : identity.name;
        const code = normCode(req.query.code);
        if (!CODE_RE.test(code))
            return res.status(400).json({ error: 'Invalid lobby code.' });
        const lobby = await _storage_js_1.kv.get(lobbyKey(code));
        if (!lobby)
            return res.status(404).json({ error: 'Lobby not found or expired.' });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ lobby: (0, _lobby_core_js_1.publicView)(lobby, me) });
    }
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name, action } = (body ?? {});
        if (!name || !action)
            return res.status(400).json({ error: 'Missing name or action.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, name);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== (0, _utils_js_1.safeName)(name)) {
            return res.status(403).json({ error: 'Cannot act as another player.' });
        }
        const me = identity.admin ? (0, _utils_js_1.safeName)(name) : identity.name;
        const now = Date.now();
        // create — no existing key to lock; nx mint is atomic.
        if (action === 'create') {
            const minted = await mintLobby(me, now);
            if (!minted)
                return res.status(500).json({ error: 'Could not open a lobby. Try again.' });
            return res.status(200).json({ code: minted.code, lobby: (0, _lobby_core_js_1.publicView)(minted.lobby, me) });
        }
        const code = normCode(body.code);
        if (!CODE_RE.test(code))
            return res.status(400).json({ error: 'Invalid lobby code.' });
        const key = lobbyKey(code);
        // poll — lock-free read.
        if (action === 'poll') {
            const lobby = await _storage_js_1.kv.get(key);
            if (!lobby)
                return res.status(404).json({ error: 'Lobby not found or expired.' });
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ lobby: (0, _lobby_core_js_1.publicView)(lobby, me) });
        }
        // pets — pre-load + snapshot the chosen pets from MY save BEFORE the lock
        // (the save doesn't change within this op), so the lock body stays fast.
        let preChosen = null;
        if (action === 'pets') {
            const save = await _storage_js_1.kv.get(`save:${me}`);
            const owned = Array.isArray(save?.character?.pets) ? save.character.pets : [];
            preChosen = (0, _lobby_core_js_1.chooseOwnedPets)(owned, body.petIds);
            if (!preChosen)
                return res.status(400).json({ error: 'Pick exactly 2 pets that you own.' });
        }
        const out = await (0, _lock_js_1.withKvLock)(key, async () => {
            const lobby = await _storage_js_1.kv.get(key);
            if (action === 'leave') {
                if (!lobby)
                    return { status: 200, body: { ok: true } };
                if (me === lobby.host) {
                    await _storage_js_1.kv.del(key);
                    return { status: 200, body: { ok: true, closed: true } };
                }
                const s = (0, _lobby_core_js_1.findPlayerSlot)(lobby, me);
                if (s) {
                    s.name = null;
                    s.ready = false;
                    s.pets = [];
                    s.joinedAt = 0;
                    await _storage_js_1.kv.set(key, lobby, { ex: LOBBY_TTL });
                }
                return { status: 200, body: { ok: true } };
            }
            if (!lobby)
                return { status: 404, body: { error: 'Lobby not found or expired.' } };
            if (action === 'join') {
                if (lobby.state !== 'lobby')
                    return { status: 409, body: { error: 'Match already started.' } };
                if ((0, _lobby_core_js_1.findPlayerSlot)(lobby, me))
                    return { status: 200, body: { lobby: (0, _lobby_core_js_1.publicView)(lobby, me) } };
                const seat = (0, _lobby_core_js_1.openSeat)(lobby, asTeam(body.team));
                if (!seat)
                    return { status: 409, body: { error: 'Lobby is full.' } };
                const s = (0, _lobby_core_js_1.slotOf)(lobby, seat.team, seat.slot);
                s.name = me;
                s.joinedAt = now;
                s.ready = false;
                s.pets = [];
                await _storage_js_1.kv.set(key, lobby, { ex: LOBBY_TTL });
                return { status: 200, body: { lobby: (0, _lobby_core_js_1.publicView)(lobby, me) } };
            }
            if (action === 'pets') {
                if (lobby.state !== 'lobby')
                    return { status: 409, body: { error: 'Match already started.' } };
                const s = (0, _lobby_core_js_1.findPlayerSlot)(lobby, me);
                if (!s)
                    return { status: 403, body: { error: 'Join the lobby first.' } };
                s.pets = preChosen;
                s.ready = true;
                await _storage_js_1.kv.set(key, lobby, { ex: LOBBY_TTL });
                return { status: 200, body: { lobby: (0, _lobby_core_js_1.publicView)(lobby, me) } };
            }
            if (action === 'start') {
                const block = (0, _lobby_core_js_1.startBlock)(lobby, me);
                if (block)
                    return { status: 409, body: { error: block } };
                const seed = node_crypto_1.default.randomInt(1, 0x7fffffff); // server-minted — neither client picks it
                lobby.seed = seed;
                lobby.match = (0, _lobby_core_js_1.resolveMatch)(lobby, seed);
                lobby.state = 'running';
                lobby.startedAt = now;
                await _storage_js_1.kv.set(key, lobby, { ex: LOBBY_TTL });
                return { status: 200, body: { lobby: (0, _lobby_core_js_1.publicView)(lobby, me) } };
            }
            return { status: 400, body: { error: 'Invalid action.' } };
        });
        return res.status(out.status).json(out.body);
    }
    catch (err) {
        console.error('[arena/lobby]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
