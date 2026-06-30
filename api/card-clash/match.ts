import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import {
    validateSubmittedDeck,
    validatePlays,
    resolveTurn,
    determineWinner,
    createMatch,
    dealOpening,
    shuffleDeck,
    pickRandomLocationIds,
    type ClashCard,
    type ClashSide,
    type ClashMatch,
    type ClashSideKey,
    type ClashPlay,
} from '../clan/war/_card-clash-engine.js';
import { canonicalClashStats, buildCreatorBaseMap } from '../clan/war/_card-catalog.js';

/*
 * /api/card-clash/match — POST only. FREE-PLAY Shinobi Card Clash PvP (the open
 * matchmaking counterpart to the clan-war / sector-war card duels).
 *
 * A faithful fork of api/village/sector-card.ts: two players play the same
 * server-authoritative 3-location / 6-turn card game, but instead of being
 * anchored to a sector-war contest it is anchored to a matchmaking PAIRING minted
 * by /api/card-clash/queue. The queue writes a shared `cc-pair:<matchId>` record
 * naming the two authorised players + their slots (p1 = lexicographically smaller
 * slug); this handler reads it to gate joins. Either player may open the session.
 *
 * UNRANKED: there is NO currency reward and NO rating change on finish — only the
 * winner is recorded — so two-account win-trading buys nothing. (A server-computed,
 * daily-capped reward could be added in the finalize step later if desired.)
 *
 * The pure engine + card catalog are reused unchanged from clan-war.
 *
 * Body: { action, matchId, ... }
 *   join         { defaultDeck: ClashCard[12] }   either paired player opens / joins
 *   submit-deck  { deck: ClashCard[12] }
 *   commit-turn  { plays: {handIndex,loc}[] }
 *   forfeit      {}
 *   state        {}                               (projected read, drives timeouts)
 */

const TURN_TIMEOUT_MS = 60_000;
const PICKING_TIMEOUT_MS = 30_000;
const SESSION_TTL_SEC = 2 * 60 * 60; // 2h hygiene — abandoned sessions self-clean

type ClashPair = { matchId: string; p1Name: string; p2Name: string; createdAt: number };

type FreePlaySession = {
    matchId: string;
    p1?: ClashSide;
    p2?: ClashSide;
    match: ClashMatch | null;
    status: 'awaiting-opponent' | 'picking' | 'active' | 'done';
    winner?: ClashSideKey | 'draw';
    coinFlip?: ClashSideKey;
    createdAt: number;
    updatedAt: number;
    turnDeadline?: number;
    pickingDeadline?: number;
};

function sessionKey(matchId: string): string {
    return `cc-freeplay:${matchId}`;
}
function pairKey(matchId: string): string {
    return `cc-pair:${matchId}`;
}
async function saveSession(s: FreePlaySession): Promise<void> {
    await kv.set(sessionKey(s.matchId), s, { ex: SESSION_TTL_SEC });
}
async function villageOf(playerName: string): Promise<string> {
    const save = await kv.get<{ character?: { village?: string } }>(`save:${playerName.toLowerCase()}`);
    return String(save?.character?.village ?? '').trim();
}

function freshSide(name: string, village: string, defaultDeck: ClashCard[]): ClashSide {
    return {
        name, clan: village, defaultDeck,
        deck: [], hand: [], chakra: 0, nextDiscount: 0,
        committed: false, pending: [], ready: false,
    };
}

// Verify every card id in the submitted deck is owned + canonicalize its stats
// from the server's source of truth (identical posture to clan-war/sector-card —
// IDs are the trust anchor; client-submitted stats are overridden).
async function resolveOwnedDeck(
    deck: ClashCard[], playerName: string, isAdmin: boolean,
): Promise<{ ok: true; deck: ClashCard[] } | { ok: false }> {
    const save = playerName ? await kv.get<Record<string, unknown>>(`save:${playerName.toLowerCase()}`) : null;
    const char = (save?.character ?? null) as Record<string, unknown> | null;
    if (!isAdmin && !char) return { ok: false };
    const owned = Array.isArray(char?.tileCards) ? (char!.tileCards as unknown[]) : [];
    const ownedIds = new Set<string>(owned.map((v) => String(v)));
    const creatorBase = buildCreatorBaseMap((save as Record<string, unknown> | null)?.creatorCards);
    const out: ClashCard[] = [];
    for (const card of deck) {
        if (!isAdmin && !ownedIds.has(card.id)) return { ok: false };
        const canon = canonicalClashStats(card.id, creatorBase);
        out.push(canon ? { ...card, ...canon } : card);
    }
    return { ok: true, deck: out };
}

function promoteSide(side: ClashSide): ClashSide {
    const chosen = side.ready && side.deck.length > 0 ? side.deck : side.defaultDeck;
    const shuffled = shuffleDeck(chosen);
    const { hand, rest } = dealOpening(shuffled);
    return { ...side, deck: rest, hand, chakra: 1, nextDiscount: 0, committed: false, pending: [] };
}

function startMatch(session: FreePlaySession, now: number): FreePlaySession {
    const p1 = session.p1 ? promoteSide(session.p1) : undefined;
    const p2 = session.p2 ? promoteSide(session.p2) : undefined;
    const coinFlip: ClashSideKey = Math.random() < 0.5 ? 'p1' : 'p2';
    return {
        ...session,
        p1, p2,
        match: createMatch(pickRandomLocationIds()),
        status: 'active',
        coinFlip,
        turnDeadline: now + TURN_TIMEOUT_MS,
        pickingDeadline: undefined,
        updatedAt: now,
    };
}

function resolveCommittedTurn(session: FreePlaySession, now: number): void {
    if (!session.match || !session.p1 || !session.p2) return;
    const { isFinal } = resolveTurn(session.match, session.p1, session.p2, session.coinFlip ?? 'p1');
    if (isFinal) {
        session.status = 'done';
        session.winner = determineWinner(session.match);
        session.turnDeadline = undefined;
    } else {
        session.turnDeadline = now + TURN_TIMEOUT_MS;
    }
    session.updatedAt = now;
}

// Free-play is unranked: finishing just persists the recorded winner. No currency,
// no rating — nothing to settle (deliberately, to remove any win-trading incentive).
async function persistAndMaybeFinalize(session: FreePlaySession): Promise<void> {
    await saveSession(session);
}

// ── Per-viewer projection — strips the opponent's hand contents + staged plays ──
function projectSide(side: ClashSide) {
    return {
        name: side.name, clan: side.clan, ready: side.ready,
        committed: side.committed, chakra: side.chakra,
        nextDiscount: side.nextDiscount, handCount: side.hand.length, deckCount: side.deck.length,
    };
}
function projectFor(session: FreePlaySession, viewer: ClashSideKey | null) {
    const base = {
        matchId: session.matchId,
        status: session.status, winner: session.winner, coinFlip: session.coinFlip,
        turnDeadline: session.turnDeadline, pickingDeadline: session.pickingDeadline,
        match: session.match, turn: session.match?.turn ?? 0,
    };
    const youKey = viewer;
    const oppKey: ClashSideKey | null = viewer === 'p1' ? 'p2' : viewer === 'p2' ? 'p1' : null;
    const youSide = youKey === 'p1' ? session.p1 : youKey === 'p2' ? session.p2 : null;
    const oppSide = oppKey === 'p1' ? session.p1 : oppKey === 'p2' ? session.p2 : null;
    return {
        ...base,
        side: youKey,
        you: youSide
            ? {
                  side: youKey, name: youSide.name, clan: youSide.clan, ready: youSide.ready,
                  committed: youSide.committed, chakra: youSide.chakra, nextDiscount: youSide.nextDiscount,
                  hand: youSide.hand, pending: youSide.pending, deckCount: youSide.deck.length,
              }
            : null,
        opponent: oppSide ? projectSide(oppSide) : null,
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'card-clash-match', 90, 60_000, identity.name))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const action = String(body?.action ?? '').toLowerCase();
        const matchId = String(body?.matchId ?? '').trim();
        if (!matchId) return res.status(400).json({ error: 'Missing matchId.' });

        const me = identity.admin ? String(body?.playerName ?? '') : identity.name;
        const mySlug = safeName(me);
        function viewerKey(session: FreePlaySession): ClashSideKey | null {
            if (session.p1 && safeName(session.p1.name) === mySlug) return 'p1';
            if (session.p2 && safeName(session.p2.name) === mySlug) return 'p2';
            return null;
        }
        // The matchmaking pairing names the two authorised players + their slots.
        const pair = await kv.get<ClashPair>(pairKey(matchId));

        // ── state read (handles picking + turn timeouts, returns projection) ──
        if (action === 'state') {
            const session = await kv.get<FreePlaySession>(sessionKey(matchId));
            if (!session) return res.status(404).json({ error: 'No card duel session yet.' });
            const now = Date.now();

            if (session.status === 'picking' && session.pickingDeadline && now > session.pickingDeadline) {
                await withKvLock(sessionKey(matchId), async () => {
                    const fresh = await kv.get<FreePlaySession>(sessionKey(matchId));
                    if (!fresh || fresh.status !== 'picking' || !fresh.pickingDeadline || now <= fresh.pickingDeadline) return;
                    await saveSession(startMatch(fresh, now));
                });
            } else if (session.status === 'active' && session.turnDeadline && now > session.turnDeadline) {
                await withKvLock(sessionKey(matchId), async () => {
                    const fresh = await kv.get<FreePlaySession>(sessionKey(matchId));
                    if (!fresh || fresh.status !== 'active' || !fresh.turnDeadline || now <= fresh.turnDeadline || !fresh.p1 || !fresh.p2) return;
                    if (!fresh.p1.committed) { fresh.p1.pending = []; fresh.p1.committed = true; }
                    if (!fresh.p2.committed) { fresh.p2.pending = []; fresh.p2.committed = true; }
                    resolveCommittedTurn(fresh, now);
                    await persistAndMaybeFinalize(fresh);
                });
            }

            const latest = (await kv.get<FreePlaySession>(sessionKey(matchId))) ?? session;
            return res.status(200).json({ session: projectFor(latest, viewerKey(latest)) });
        }

        // Resolve which slot the caller owns from the pairing (admins may pass side).
        const mySide: ClashSideKey | null = identity.admin
            ? (String(body?.side ?? 'p1') as ClashSideKey)
            : pair && pair.p1Name === mySlug ? 'p1'
            : pair && pair.p2Name === mySlug ? 'p2'
            : null;
        if (!mySide) return res.status(403).json({ error: 'You are not a participant in this match.' });

        const result = await withKvLock(sessionKey(matchId), async () => {
            const existing = await kv.get<FreePlaySession>(sessionKey(matchId));

            // ── join (either paired player opens their slot; both filled → picking) ──
            if (action === 'join') {
                const validated = validateSubmittedDeck(body?.defaultDeck);
                if (!validated.ok) return { status: 400 as const, body: { error: `Invalid default deck: ${validated.error}` } };
                const resolved = await resolveOwnedDeck(validated.deck, me, identity.admin);
                if (!resolved.ok) return { status: 403 as const, body: { error: 'Default deck contains cards you do not own.' } };

                const now = Date.now();
                const newSide = freshSide(me, identity.admin ? '' : await villageOf(me), resolved.deck);

                if (!existing || existing.status === 'done') {
                    const session: FreePlaySession = {
                        matchId,
                        p1: mySide === 'p1' ? newSide : undefined,
                        p2: mySide === 'p2' ? newSide : undefined,
                        match: null, status: 'awaiting-opponent', createdAt: now, updatedAt: now,
                    };
                    await saveSession(session);
                    return { status: 200 as const, body: { session: projectFor(session, mySide) } };
                }
                // Idempotent re-join (already in my slot).
                if ((mySide === 'p1' && existing.p1) || (mySide === 'p2' && existing.p2)) {
                    return { status: 200 as const, body: { session: projectFor(existing, mySide) } };
                }
                if (existing.status !== 'awaiting-opponent') {
                    return { status: 409 as const, body: { error: 'Card battle is no longer accepting a joiner.' } };
                }
                const session: FreePlaySession = {
                    ...existing,
                    p1: mySide === 'p1' ? newSide : existing.p1,
                    p2: mySide === 'p2' ? newSide : existing.p2,
                    status: 'picking',
                    pickingDeadline: now + PICKING_TIMEOUT_MS, updatedAt: now,
                };
                await saveSession(session);
                return { status: 200 as const, body: { session: projectFor(session, mySide) } };
            }

            if (!existing) return { status: 404 as const, body: { error: 'No card duel session yet — call join first.' } };

            // ── submit-deck ─────────────────────────────────────────
            if (action === 'submit-deck') {
                if (existing.status !== 'picking') return { status: 409 as const, body: { error: 'Deck-picking phase is closed.' } };
                const validated = validateSubmittedDeck(body?.deck);
                if (!validated.ok) return { status: 400 as const, body: { error: `Invalid deck: ${validated.error}` } };
                const resolvedDeck = await resolveOwnedDeck(validated.deck, me, identity.admin);
                if (!resolvedDeck.ok) return { status: 403 as const, body: { error: 'Deck contains cards you do not own.' } };

                const now = Date.now();
                const target = mySide === 'p1' ? existing.p1 : existing.p2;
                if (!target) return { status: 409 as const, body: { error: 'Your side is not seated yet.' } };
                const updatedSide: ClashSide = { ...target, deck: resolvedDeck.deck, ready: true };
                let next: FreePlaySession = {
                    ...existing,
                    p1: mySide === 'p1' ? updatedSide : existing.p1,
                    p2: mySide === 'p2' ? updatedSide : existing.p2,
                    updatedAt: now,
                };
                if (next.p1?.ready && next.p2?.ready) next = startMatch(next, now);
                await saveSession(next);
                return { status: 200 as const, body: { session: projectFor(next, mySide) } };
            }

            // ── commit-turn ─────────────────────────────────────────
            if (action === 'commit-turn') {
                if (existing.status !== 'active' || !existing.match || !existing.p1 || !existing.p2) {
                    return { status: 409 as const, body: { error: 'Card duel is not active.' } };
                }
                const side = mySide === 'p1' ? existing.p1 : existing.p2;
                if (side.committed) return { status: 409 as const, body: { error: 'You already committed this turn.' } };

                const rawPlays = Array.isArray(body?.plays) ? body.plays : [];
                const plays: ClashPlay[] = rawPlays.map((p: unknown) => {
                    const o = (p ?? {}) as Record<string, unknown>;
                    return { handIndex: Number(o.handIndex), loc: Number(o.loc) };
                });
                const check = validatePlays(existing.match, side, mySide, plays);
                if (!check.ok) return { status: 400 as const, body: { error: check.error } };

                const now = Date.now();
                side.pending = plays;
                side.committed = true;
                if (existing.p1.committed && existing.p2.committed) {
                    resolveCommittedTurn(existing, now);
                }
                existing.updatedAt = now;
                await persistAndMaybeFinalize(existing);
                return { status: 200 as const, body: { session: projectFor(existing, mySide) } };
            }

            // ── forfeit ─────────────────────────────────────────────
            if (action === 'forfeit') {
                if (existing.status === 'done') return { status: 409 as const, body: { error: 'Card duel already over.' } };
                const now = Date.now();
                existing.status = 'done';
                existing.winner = mySide === 'p1' ? 'p2' : 'p1';
                existing.turnDeadline = undefined;
                existing.pickingDeadline = undefined;
                existing.updatedAt = now;
                await persistAndMaybeFinalize(existing);
                return { status: 200 as const, body: { session: projectFor(existing, mySide) } };
            }

            return { status: 400 as const, body: { error: `Unknown action: ${action}` } };
        });

        return res.status(result.status).json(result.body);
    } catch (err) {
        console.error('[card-clash/match]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
