import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import {
    applyFinalResult,
    applyLazyClanWarExpiry,
    CLAN_WAR_REMATCH_COOLDOWN_SEC,
    clanWarCooldownKey,
    loadClanContext,
    type ChallengeResult,
    type ClanWar,
} from './_storage.js';
import {
    validateSubmittedDeck,
    deckCardIds,
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
} from './_card-clash-engine.js';

// POST /api/clan/war/tilecards
//
// The clan-war "tile card" duel is now Shinobi Card Clash — a server-authoritative
// 3-location / 6-turn card game (the old Triple-Triad tile-flip is retired). The
// match rules run on the server (see _card-clash-engine.ts) so clan-war HP damage
// stays authoritative; the client only stages plays and renders projected state.
//
// Body: { action, warId, challengeId, ... }
//   action: 'join'         body: { defaultDeck: ClashCard[12] }   (fallback deck)
//   action: 'submit-deck'  body: { deck: ClashCard[12] }          (lock in your deck)
//   action: 'commit-turn'  body: { plays: {handIndex,loc}[] }     (stage this turn)
//   action: 'forfeit'      body: {}
//   action: 'state'        body: {}                               (projected read)
//
// Flow:
//   1. Both clients `join` with a fallback default deck (auto-built top-12).
//   2. Both joined → status 'picking', 30s deadline. Each `submit-deck` (12 cards).
//   3. Both submitted (or 30s timeout) → coin flip (sets the per-turn reveal
//      order), 3 random locations, opening hands dealt, status 'active'.
//   4. Each turn BOTH players secretly `commit-turn` their staged plays. When
//      both have committed (or the turn deadline elapses) the server resolves the
//      turn — revealing simultaneously and applying On-Reveal effects.
//   5. After turn 6 → status 'done', winner via 2-of-3 locations, and
//      applyFinalResult flows clan-war HP damage through the same path as PvP/pet
//      wins. No manual report ever fires.
//
// Stat trust: canonical card stats live in the client bundle, so the client
// submits derived Clash stats; the server enforces ID OWNERSHIP here + hard stat
// bounds + deck limits in the engine (same posture as the old tile duel).
//
// Privacy: the stored session holds both sides' hands + staged plays so the
// server can resolve turns. Clients read via the PROJECTED `state` response which
// strips the opponent's hand contents and staged plays. (The client polls `state`
// and does not subscribe to the raw KV row.)

const TURN_TIMEOUT_MS = 60_000;
const PICKING_TIMEOUT_MS = 30_000;

type CwClashSession = {
    warId: string;
    challengeId: string;
    p1: ClashSide;
    p2?: ClashSide;
    match: ClashMatch | null;
    status: 'awaiting-p2' | 'picking' | 'active' | 'done';
    winner?: ClashSideKey | 'draw';
    coinFlip?: ClashSideKey;
    createdAt: number;
    updatedAt: number;
    turnDeadline?: number;
    pickingDeadline?: number;
};

function sessionKey(challengeId: string): string {
    return `cw-tilecards:${challengeId}`;
}

function freshSide(name: string, clan: string, defaultDeck: ClashCard[]): ClashSide {
    return {
        name, clan, defaultDeck,
        deck: [], hand: [], chakra: 0, nextDiscount: 0,
        committed: false, pending: [], ready: false,
    };
}

// Verify every distinct card id in the submitted deck is actually owned by the
// player (mirrors the old tile-duel ownership check — IDs are the trust anchor).
async function verifyDeckOwnership(deck: ClashCard[], playerName: string): Promise<boolean> {
    if (!playerName) return false;
    const save = await kv.get<Record<string, unknown>>(`save:${playerName.toLowerCase()}`);
    const char = (save?.character ?? null) as Record<string, unknown> | null;
    if (!char) return false;
    const owned = Array.isArray(char.tileCards) ? (char.tileCards as unknown[]) : [];
    const ownedIds = new Set<string>(owned.map((v) => String(v)));
    for (const id of deckCardIds(deck)) {
        if (!ownedIds.has(id)) return false;
    }
    return true;
}

function translateWinner(session: CwClashSession, ch: { fromClan: string }, winner: ClashSideKey | 'draw'): ChallengeResult {
    if (winner === 'draw') return 'draw';
    const winnerSide = winner === 'p1' ? session.p1 : session.p2!;
    return winnerSide.clan === ch.fromClan ? 'from-wins' : 'to-wins';
}

// Promote a side into the match: pick the chosen deck (or default if they never
// locked in), shuffle, deal the opening hand, set turn-1 chakra.
function promoteSide(side: ClashSide): ClashSide {
    const chosen = side.ready && side.deck.length > 0 ? side.deck : side.defaultDeck;
    const shuffled = shuffleDeck(chosen);
    const { hand, rest } = dealOpening(shuffled);
    return { ...side, deck: rest, hand, chakra: 1, nextDiscount: 0, committed: false, pending: [] };
}

// picking → active: promote both sides, pick locations, coin flip, deal.
function startMatch(session: CwClashSession, now: number): CwClashSession {
    const p1 = promoteSide(session.p1);
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

// Resolve a turn once both sides have committed (or were forced by timeout).
// Mutates the session in place and finalises the clan war if the match ends.
function resolveCommittedTurn(session: CwClashSession, now: number): void {
    if (!session.match || !session.p2) return;
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

async function persistAndMaybeFinalize(session: CwClashSession): Promise<void> {
    await kv.set(sessionKey(session.challengeId), session);
    if (session.status !== 'done' || !session.winner) return;

    const warKey = `clan-war:${session.warId}`;
    await withKvLock(warKey, async () => {
        const fresh = await kv.get<ClanWar>(warKey);
        if (!fresh) return;
        const { war: war0 } = applyLazyClanWarExpiry(fresh);
        if (war0.endedAt) return;
        const ch = war0.pendingChallenges.find((c) => c.id === session.challengeId);
        if (!ch || ch.status !== 'accepted') return;
        const result = translateWinner(session, ch, session.winner!);
        const now = Date.now();
        const { war: next, warJustEnded } = applyFinalResult(war0, ch, result, now);
        await kv.set(warKey, next);
        if (warJustEnded) {
            await kv.set(clanWarCooldownKey(next.clans[0], next.clans[1]), now, { ex: CLAN_WAR_REMATCH_COOLDOWN_SEC });
        }
    });
}

// ── Per-viewer projection — strips the opponent's hand contents + staged plays ──

function projectSide(side: ClashSide) {
    return {
        name: side.name, clan: side.clan, ready: side.ready,
        committed: side.committed, chakra: side.chakra,
        nextDiscount: side.nextDiscount, handCount: side.hand.length, deckCount: side.deck.length,
    };
}

function projectFor(session: CwClashSession, viewer: ClashSideKey | null) {
    const base = {
        warId: session.warId, challengeId: session.challengeId,
        status: session.status, winner: session.winner, coinFlip: session.coinFlip,
        turnDeadline: session.turnDeadline, pickingDeadline: session.pickingDeadline,
        match: session.match,
        turn: session.match?.turn ?? 0,
    };
    const youKey: ClashSideKey | null = viewer;
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
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'cw-tilecards', 90, 60_000, identity.name))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const action = String(body?.action ?? '').toLowerCase();
        const warId = String(body?.warId ?? '').trim();
        const challengeId = String(body?.challengeId ?? '').trim();
        if (!warId || !challengeId) return res.status(400).json({ error: 'Missing warId or challengeId.' });

        const ctx = await loadClanContext(identity.admin ? '' : identity.name);
        const me = identity.admin ? String(body?.playerName ?? '') : (ctx.name || identity.name);

        function viewerKey(session: CwClashSession): ClashSideKey | null {
            const meLower = me.toLowerCase();
            if (session.p1.name.toLowerCase() === meLower) return 'p1';
            if (session.p2 && session.p2.name.toLowerCase() === meLower) return 'p2';
            return null;
        }

        // ── state read (handles picking + turn timeouts, returns projection) ──
        if (action === 'state') {
            const session = await kv.get<CwClashSession>(sessionKey(challengeId));
            if (!session) return res.status(404).json({ error: 'No duel session yet.' });
            const now = Date.now();

            // Auto-start once the picking deadline elapses.
            if (session.status === 'picking' && session.pickingDeadline && now > session.pickingDeadline) {
                await withKvLock(sessionKey(challengeId), async () => {
                    const fresh = await kv.get<CwClashSession>(sessionKey(challengeId));
                    if (!fresh || fresh.status !== 'picking' || !fresh.pickingDeadline || now <= fresh.pickingDeadline) return;
                    await kv.set(sessionKey(challengeId), startMatch(fresh, now));
                });
            }
            // Force-resolve a stalled turn: uncommitted side(s) pass.
            else if (session.status === 'active' && session.turnDeadline && now > session.turnDeadline) {
                await withKvLock(sessionKey(challengeId), async () => {
                    const fresh = await kv.get<CwClashSession>(sessionKey(challengeId));
                    if (!fresh || fresh.status !== 'active' || !fresh.turnDeadline || now <= fresh.turnDeadline || !fresh.p2) return;
                    if (!fresh.p1.committed) { fresh.p1.pending = []; fresh.p1.committed = true; }
                    if (!fresh.p2.committed) { fresh.p2.pending = []; fresh.p2.committed = true; }
                    resolveCommittedTurn(fresh, now);
                    await persistAndMaybeFinalize(fresh);
                });
            }

            const latest = (await kv.get<CwClashSession>(sessionKey(challengeId))) ?? session;
            return res.status(200).json({ session: projectFor(latest, viewerKey(latest)) });
        }

        const result = await withKvLock(sessionKey(challengeId), async () => {
            const existing = await kv.get<CwClashSession>(sessionKey(challengeId));

            // ── join ───────────────────────────────────────────────
            if (action === 'join') {
                const warKey = `clan-war:${warId}`;
                const war = await kv.get<ClanWar>(warKey);
                if (!war) return { status: 404 as const, body: { error: 'War not found.' } };
                const ch = war.pendingChallenges.find((c) => c.id === challengeId);
                if (!ch) return { status: 404 as const, body: { error: 'Challenge not found or already resolved.' } };
                if (ch.mode !== 'tilecards') return { status: 400 as const, body: { error: 'Challenge is not a card duel.' } };
                if (ch.status !== 'accepted') return { status: 409 as const, body: { error: 'Challenge has not been accepted yet.' } };

                const meLower = me.toLowerCase();
                const onFromSide = (ch.fromPlayer ?? '').toLowerCase() === meLower || (ch.fromPlayer2 ?? '').toLowerCase() === meLower;
                const onToSide = (ch.acceptedPlayer ?? '').toLowerCase() === meLower || (ch.acceptedPlayer2 ?? '').toLowerCase() === meLower;
                if (!identity.admin && !onFromSide && !onToSide) {
                    return { status: 403 as const, body: { error: 'Only a participant can join the duel.' } };
                }
                const myClan = onFromSide ? ch.fromClan : (war.clans.find((c) => c !== ch.fromClan) ?? '');

                const validated = validateSubmittedDeck(body?.defaultDeck);
                if (!validated.ok) return { status: 400 as const, body: { error: `Invalid default deck: ${validated.error}` } };
                if (!identity.admin && !(await verifyDeckOwnership(validated.deck, me))) {
                    return { status: 403 as const, body: { error: 'Default deck contains cards you do not own.' } };
                }

                const now = Date.now();
                const newSide = freshSide(me, myClan, validated.deck);

                if (!existing) {
                    const session: CwClashSession = {
                        warId, challengeId, p1: newSide, match: null,
                        status: 'awaiting-p2', createdAt: now, updatedAt: now,
                    };
                    await kv.set(sessionKey(challengeId), session);
                    return { status: 200 as const, body: { session: projectFor(session, 'p1') } };
                }
                // Idempotent re-join.
                if (existing.p1.name.toLowerCase() === meLower || (existing.p2 && existing.p2.name.toLowerCase() === meLower)) {
                    return { status: 200 as const, body: { session: projectFor(existing, viewerKey(existing)) } };
                }
                if (existing.status !== 'awaiting-p2') {
                    return { status: 409 as const, body: { error: 'Session is no longer accepting joiners.' } };
                }
                if (existing.p1.clan === myClan) {
                    return { status: 403 as const, body: { error: 'A duelist from your own clan is already in this session.' } };
                }
                const session: CwClashSession = {
                    ...existing, p2: newSide, status: 'picking',
                    pickingDeadline: now + PICKING_TIMEOUT_MS, updatedAt: now,
                };
                await kv.set(sessionKey(challengeId), session);
                return { status: 200 as const, body: { session: projectFor(session, 'p2') } };
            }

            if (!existing) return { status: 404 as const, body: { error: 'No duel session yet — call join first.' } };

            const meLower = me.toLowerCase();
            const isP1 = existing.p1.name.toLowerCase() === meLower;
            const isP2 = !!existing.p2 && existing.p2.name.toLowerCase() === meLower;
            if (!identity.admin && !isP1 && !isP2) {
                return { status: 403 as const, body: { error: 'Only the two duelists can act on this session.' } };
            }
            const mySide: ClashSideKey = identity.admin ? (String(body?.side ?? 'p1') as ClashSideKey) : (isP1 ? 'p1' : 'p2');

            // ── submit-deck ─────────────────────────────────────────
            if (action === 'submit-deck') {
                if (existing.status !== 'picking') return { status: 409 as const, body: { error: 'Deck-picking phase is closed.' } };
                const validated = validateSubmittedDeck(body?.deck);
                if (!validated.ok) return { status: 400 as const, body: { error: `Invalid deck: ${validated.error}` } };
                if (!identity.admin && !(await verifyDeckOwnership(validated.deck, me))) {
                    return { status: 403 as const, body: { error: 'Deck contains cards you do not own.' } };
                }

                const now = Date.now();
                const target = mySide === 'p1' ? existing.p1 : existing.p2!;
                const updatedSide: ClashSide = { ...target, deck: validated.deck, ready: true };
                let next: CwClashSession = {
                    ...existing,
                    p1: mySide === 'p1' ? updatedSide : existing.p1,
                    p2: mySide === 'p2' ? updatedSide : existing.p2,
                    updatedAt: now,
                };
                if (next.p1.ready && next.p2?.ready) next = startMatch(next, now);
                await kv.set(sessionKey(challengeId), next);
                return { status: 200 as const, body: { session: projectFor(next, mySide) } };
            }

            // ── commit-turn ─────────────────────────────────────────
            if (action === 'commit-turn') {
                if (existing.status !== 'active' || !existing.match || !existing.p2) {
                    return { status: 409 as const, body: { error: 'Duel is not active.' } };
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
                if (existing.status === 'done') return { status: 409 as const, body: { error: 'Duel already over.' } };
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
        console.error('[clan/war/tilecards]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
