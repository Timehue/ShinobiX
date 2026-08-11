import type { VercelRequest, VercelResponse } from '../_vercel.js';
import crypto from 'node:crypto';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { LockContendedError, withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import {
    newLobby, codeFromBytes, openSeat, slotOf, findPlayerSlot, chooseOwnedPetRecords, snapshotPet,
    resolveMatch, startBlock, publicView, type Lobby, type Team,
} from './_lobby-core.js';
import { petCombatBusyReason } from '../pet/_pet-busy.js';
import { activeCarriedPets } from '../_entitlements.js';

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

const OPEN_LOBBY_LIFETIME_MS = 30 * 60_000;
const RUNNING_LOBBY_LIFETIME_MS = 20 * 60_000;
const ABSOLUTE_LOBBY_LIFETIME_MS = 45 * 60_000;
const lobbyKey = (code: string) => `arena:lobby:${code}`;
// New lobbies are always 8 characters. Accept legacy 4-character codes for
// bounded rolling-deploy recovery/mutation of already-open lobbies; no endpoint
// can mint one and every such lobby expires under the absolute lifetime below.
const CODE_RE = /^(?:[A-HJ-NP-Z2-9]{8}|[A-HJ-NP-Z2-9]{4})$/;
const normCode = (v: unknown) => String(v ?? '').trim().toUpperCase();
const asTeam = (v: unknown): Team | undefined => (v === 'blue' || v === 'red' ? v : undefined);

type LockOut = { status: number; body: Record<string, unknown> };

export function lobbyExpiresAt(lobby: Pick<Lobby, 'state' | 'createdAt' | 'startedAt'>): number {
    const absolute = lobby.createdAt + ABSOLUTE_LOBBY_LIFETIME_MS;
    if (lobby.state === 'running' && typeof lobby.startedAt === 'number') {
        return Math.min(absolute, lobby.startedAt + RUNNING_LOBBY_LIFETIME_MS);
    }
    return Math.min(absolute, lobby.createdAt + OPEN_LOBBY_LIFETIME_MS);
}

function lobbyTtlSeconds(lobby: Lobby, now = Date.now()): number {
    return Math.max(0, Math.ceil((lobbyExpiresAt(lobby) - now) / 1000));
}

async function persistLobby(key: string, lobby: Lobby, now = Date.now()): Promise<boolean> {
    const ex = lobbyTtlSeconds(lobby, now);
    if (ex <= 0) return false;
    await kv.set(key, lobby, { ex });
    return true;
}

function canReadRunningLobby(lobby: Lobby, playerName: string): boolean {
    return lobby.state !== 'running' || Boolean(findPlayerSlot(lobby, playerName));
}

async function mintLobby(host: string, now: number): Promise<{ code: string; lobby: Lobby } | null> {
    // nx create is atomic, so a collision just retries with a fresh code.
    for (let i = 0; i < 8; i++) {
        const code = codeFromBytes(crypto.randomBytes(8));
        const lobby = newLobby(code, host, now);
        const ok = await kv.set(lobbyKey(code), lobby, { ex: lobbyTtlSeconds(lobby, now), nx: true });
        if (ok) return { code, lobby };
    }
    return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    // Lobby state is private, mutable coordination state. Never let a CDN or
    // browser reuse a pre-start projection after another participant starts.
    res.setHeader('Cache-Control', 'no-store, private');
    if (req.method === 'OPTIONS') return res.status(200).end();

    // ── GET: read a lobby for the authed viewer ───────────────────────────────
    if (req.method === 'GET') {
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        const me = identity.admin ? safeName(String(req.query.name ?? '')) : identity.name;
        if (!me) return res.status(400).json({ error: 'Invalid player identity.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'arena-lobby-poll', 120, 60_000, me, { strict: true }))) return;
        const code = normCode(req.query.code);
        if (!CODE_RE.test(code)) return res.status(400).json({ error: 'Invalid lobby code.' });
        const lobby = await kv.get<Lobby>(lobbyKey(code));
        if (!lobby) return res.status(404).json({ error: 'Lobby not found or expired.' });
        if (lobbyTtlSeconds(lobby) <= 0) {
            await kv.del(lobbyKey(code)).catch(() => undefined);
            return res.status(404).json({ error: 'Lobby not found or expired.' });
        }
        if (!canReadRunningLobby(lobby, me)) return res.status(403).json({ error: 'Only match participants may recover a running lobby.' });
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

        const rate = action === 'create'
            ? { bucket: 'arena-lobby-create', limit: 4, windowMs: 10 * 60_000 }
            : action === 'poll'
                ? { bucket: 'arena-lobby-poll', limit: 120, windowMs: 60_000 }
                : action === 'join'
                    ? { bucket: 'arena-lobby-join', limit: 20, windowMs: 60_000 }
                    : { bucket: 'arena-lobby-mutate', limit: 30, windowMs: 60_000 };
        if (!identity.admin && !(await enforceRateLimitKv(req, res, rate.bucket, rate.limit, rate.windowMs, me, { strict: true }))) return;

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
            if (lobbyTtlSeconds(lobby, now) <= 0) {
                await kv.del(key).catch(() => undefined);
                return res.status(404).json({ error: 'Lobby not found or expired.' });
            }
            if (!canReadRunningLobby(lobby, me)) return res.status(403).json({ error: 'Only match participants may recover a running lobby.' });
            return res.status(200).json({ lobby: publicView(lobby, me) });
        }

        // pets — pre-load + snapshot the chosen pets from MY save BEFORE the lock
        // (the save doesn't change within this op), so the lock body stays fast.
        let preChosen: ReturnType<typeof snapshotPet>[] | null = null;
        if (action === 'pets') {
            const save = await kv.get<{ character?: { pets?: Array<Record<string, unknown>> } }>(`save:${me}`);
            const character = (save?.character ?? {}) as Record<string, unknown>;
            const owned = activeCarriedPets<Record<string, unknown>>(character);
            const selected = chooseOwnedPetRecords(owned, (body as { petIds?: unknown }).petIds);
            if (!selected) return res.status(400).json({ error: 'Pick exactly 2 pets that you own.' });
            if (selected.some((pet) => petCombatBusyReason(character, pet))) {
                return res.status(409).json({ error: 'A selected pet is busy with breeding, training, or an expedition.' });
            }
            preChosen = selected.map(snapshotPet);
        }

        const out = await withKvLock<LockOut>(key, async () => {
            const lobby = await kv.get<Lobby>(key);

            if (action === 'leave') {
                if (!lobby) return { status: 200, body: { ok: true } };
                // Once started, the lobby is a participant-authenticated match
                // recovery record. Leaving is only a presence/UI event: never
                // remove a seat or let a fast host destroy the sealed match
                // before a slower teammate reconnects. Natural running TTL
                // remains the sole lifecycle bound.
                if (lobby.state === 'running') {
                    if (!findPlayerSlot(lobby, me)) {
                        return { status: 403, body: { error: 'Only match participants may leave a running lobby.' } };
                    }
                    return {
                        status: 200,
                        body: { ok: true, safeToExit: true, sealedMatchRetained: true },
                    };
                }
                if (me === lobby.host) { await kv.del(key); return { status: 200, body: { ok: true, closed: true } }; }
                const s = findPlayerSlot(lobby, me);
                if (s) {
                    s.name = null; s.ready = false; s.pets = []; s.joinedAt = 0;
                    if (!await persistLobby(key, lobby, now)) await kv.del(key);
                }
                return { status: 200, body: { ok: true } };
            }

            if (!lobby) return { status: 404, body: { error: 'Lobby not found or expired.' } };
            if (lobbyTtlSeconds(lobby, now) <= 0) {
                await kv.del(key);
                return { status: 404, body: { error: 'Lobby not found or expired.' } };
            }

            if (action === 'join') {
                if (lobby.state !== 'lobby') return { status: 409, body: { error: 'Match already started.' } };
                if (findPlayerSlot(lobby, me)) return { status: 200, body: { lobby: publicView(lobby, me) } };
                const seat = openSeat(lobby, asTeam((body as { team?: string }).team));
                if (!seat) return { status: 409, body: { error: 'Lobby is full.' } };
                const s = slotOf(lobby, seat.team, seat.slot);
                s.name = me; s.joinedAt = now; s.ready = false; s.pets = [];
                if (!await persistLobby(key, lobby, now)) return { status: 404, body: { error: 'Lobby not found or expired.' } };
                return { status: 200, body: { lobby: publicView(lobby, me) } };
            }

            if (action === 'pets') {
                if (lobby.state !== 'lobby') return { status: 409, body: { error: 'Match already started.' } };
                const s = findPlayerSlot(lobby, me);
                if (!s) return { status: 403, body: { error: 'Join the lobby first.' } };
                s.pets = preChosen!; s.ready = true;
                if (!await persistLobby(key, lobby, now)) return { status: 404, body: { error: 'Lobby not found or expired.' } };
                return { status: 200, body: { lobby: publicView(lobby, me) } };
            }

            if (action === 'start') {
                const block = startBlock(lobby, me);
                if (block) return { status: 409, body: { error: block } };
                const occupied = lobby.slots.filter((slot) => slot.name);
                const stillReady = await Promise.all(occupied.map(async (slot) => {
                    const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${safeName(slot.name ?? '')}`);
                    const character = save?.character;
                    if (!character) return false;
                    const carried = activeCarriedPets<Record<string, unknown>>(character);
                    return slot.pets.every((snapshot) => {
                        const current = carried.find((pet) => String(pet.id ?? '') === snapshot.id);
                        return Boolean(current && !petCombatBusyReason(character, current));
                    });
                }));
                if (stillReady.some((ready) => !ready)) {
                    return { status: 409, body: { error: 'A selected pet became unavailable. Re-select combat-ready pets before starting.' } };
                }
                const seed = crypto.randomInt(1, 0x7fffffff);   // server-minted — neither client picks it
                lobby.seed = seed;
                lobby.match = resolveMatch(lobby, seed);
                lobby.state = 'running';
                lobby.startedAt = now;
                if (!await persistLobby(key, lobby, now)) return { status: 404, body: { error: 'Lobby not found or expired.' } };
                return { status: 200, body: { lobby: publicView(lobby, me) } };
            }

            return { status: 400, body: { error: 'Invalid action.' } };
        }, { failClosed: true });
        return res.status(out.status).json(out.body);
    } catch (err) {
        console.error('[arena/lobby]', err);
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'Lobby state is busy. Retry the same action.', retryAfterMs: 250 });
        }
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
