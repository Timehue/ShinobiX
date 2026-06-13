import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import {
    newLobby, codeFromBytes, openSeat, slotOf, findPlayerSlot, chooseOwnedPets,
    resolveMatch, startBlock, publicView, type Lobby, type Team,
} from './_lobby-core.js';

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

const LOBBY_TTL = 30 * 60;                 // 30-minute lobby lifetime (KV TTL)
const lobbyKey = (code: string) => `arena:lobby:${code}`;
const CODE_RE = /^[A-Z0-9]{4}$/;
const normCode = (v: unknown) => String(v ?? '').trim().toUpperCase();
const asTeam = (v: unknown): Team | undefined => (v === 'blue' || v === 'red' ? v : undefined);

type LockOut = { status: number; body: Record<string, unknown> };

async function mintLobby(host: string, now: number): Promise<{ code: string; lobby: Lobby } | null> {
    // nx create is atomic, so a collision just retries with a fresh code.
    for (let i = 0; i < 8; i++) {
        const code = codeFromBytes(crypto.randomBytes(8));
        const lobby = newLobby(code, host, now);
        const ok = await kv.set(lobbyKey(code), lobby, { ex: LOBBY_TTL, nx: true });
        if (ok) return { code, lobby };
    }
    return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // ── GET: read a lobby for the authed viewer ───────────────────────────────
    if (req.method === 'GET') {
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        const me = identity.admin ? safeName(String(req.query.name ?? '')) : identity.name;
        const code = normCode(req.query.code);
        if (!CODE_RE.test(code)) return res.status(400).json({ error: 'Invalid lobby code.' });
        const lobby = await kv.get<Lobby>(lobbyKey(code));
        if (!lobby) return res.status(404).json({ error: 'Lobby not found or expired.' });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ lobby: publicView(lobby, me) });
    }

    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name, action } = (body ?? {}) as { name?: string; action?: string };
        if (!name || !action) return res.status(400).json({ error: 'Missing name or action.' });

        const identity = await authedPlayerOrAdmin(req, name);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== safeName(name)) {
            return res.status(403).json({ error: 'Cannot act as another player.' });
        }
        const me = identity.admin ? safeName(name) : identity.name;
        const now = Date.now();

        // create — no existing key to lock; nx mint is atomic.
        if (action === 'create') {
            const minted = await mintLobby(me, now);
            if (!minted) return res.status(500).json({ error: 'Could not open a lobby. Try again.' });
            return res.status(200).json({ code: minted.code, lobby: publicView(minted.lobby, me) });
        }

        const code = normCode((body as { code?: string }).code);
        if (!CODE_RE.test(code)) return res.status(400).json({ error: 'Invalid lobby code.' });
        const key = lobbyKey(code);

        // poll — lock-free read.
        if (action === 'poll') {
            const lobby = await kv.get<Lobby>(key);
            if (!lobby) return res.status(404).json({ error: 'Lobby not found or expired.' });
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ lobby: publicView(lobby, me) });
        }

        // pets — pre-load + snapshot the chosen pets from MY save BEFORE the lock
        // (the save doesn't change within this op), so the lock body stays fast.
        let preChosen: ReturnType<typeof chooseOwnedPets> = null;
        if (action === 'pets') {
            const save = await kv.get<{ character?: { pets?: Array<Record<string, unknown>> } }>(`save:${me}`);
            const owned = Array.isArray(save?.character?.pets) ? save!.character!.pets! : [];
            preChosen = chooseOwnedPets(owned, (body as { petIds?: unknown }).petIds);
            if (!preChosen) return res.status(400).json({ error: 'Pick exactly 2 pets that you own.' });
        }

        const out = await withKvLock<LockOut>(key, async () => {
            const lobby = await kv.get<Lobby>(key);

            if (action === 'leave') {
                if (!lobby) return { status: 200, body: { ok: true } };
                if (me === lobby.host) { await kv.del(key); return { status: 200, body: { ok: true, closed: true } }; }
                const s = findPlayerSlot(lobby, me);
                if (s) { s.name = null; s.ready = false; s.pets = []; s.joinedAt = 0; await kv.set(key, lobby, { ex: LOBBY_TTL }); }
                return { status: 200, body: { ok: true } };
            }

            if (!lobby) return { status: 404, body: { error: 'Lobby not found or expired.' } };

            if (action === 'join') {
                if (lobby.state !== 'lobby') return { status: 409, body: { error: 'Match already started.' } };
                if (findPlayerSlot(lobby, me)) return { status: 200, body: { lobby: publicView(lobby, me) } };
                const seat = openSeat(lobby, asTeam((body as { team?: string }).team));
                if (!seat) return { status: 409, body: { error: 'Lobby is full.' } };
                const s = slotOf(lobby, seat.team, seat.slot);
                s.name = me; s.joinedAt = now; s.ready = false; s.pets = [];
                await kv.set(key, lobby, { ex: LOBBY_TTL });
                return { status: 200, body: { lobby: publicView(lobby, me) } };
            }

            if (action === 'pets') {
                if (lobby.state !== 'lobby') return { status: 409, body: { error: 'Match already started.' } };
                const s = findPlayerSlot(lobby, me);
                if (!s) return { status: 403, body: { error: 'Join the lobby first.' } };
                s.pets = preChosen!; s.ready = true;
                await kv.set(key, lobby, { ex: LOBBY_TTL });
                return { status: 200, body: { lobby: publicView(lobby, me) } };
            }

            if (action === 'start') {
                const block = startBlock(lobby, me);
                if (block) return { status: 409, body: { error: block } };
                const seed = crypto.randomInt(1, 0x7fffffff);   // server-minted — neither client picks it
                lobby.seed = seed;
                lobby.match = resolveMatch(lobby, seed);
                lobby.state = 'running';
                lobby.startedAt = now;
                await kv.set(key, lobby, { ex: LOBBY_TTL });
                return { status: 200, body: { lobby: publicView(lobby, me) } };
            }

            return { status: 400, body: { error: 'Invalid action.' } };
        });
        return res.status(out.status).json(out.body);
    } catch (err) {
        console.error('[arena/lobby]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
