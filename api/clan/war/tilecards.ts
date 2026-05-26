import type { VercelRequest, VercelResponse } from '@vercel/node';
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

// POST /api/clan/war/tilecards
// Body: { action, warId, challengeId, ... }
//   action: 'join'         body: { defaultDeck: ServerTileCard[5] }
//   action: 'submit-deck'  body: { deck: ServerTileCard[5] }
//   action: 'move'         body: { pos: 0-8, cardId: string }
//   action: 'forfeit'      body: {}
//   action: 'state'        body: {}   (read the session)
//
// Flow:
//   1. Both clients call `join` with a fallback "default deck" (their
//      top 5 cards by stat sum). The session waits for p2 to join.
//   2. Once both have joined, status flips to 'picking' and a 30s
//      pickingDeadline is stamped. Each player picks their 5 cards
//      from their owned collection and locks in via `submit-deck`.
//   3. When BOTH players have submitted (or the 30s deadline
//      elapses), the server promotes any unsubmitted defaultDeck to
//      the live deck, runs a coin flip to pick who goes first, and
//      flips status to 'active'. The match begins.
//   4. Players take turns via `move`; server validates the move and
//      applies Triple-Triad-style capture rules.
//   5. Board full or both hands empty → status='done', winner set,
//      and applyFinalResult is called against the parent clan war
//      atomically so HP damage flows through the same path as PvP
//      and pet wins. No manual report ever fires.

const ELEMENT_COUNTERS: Record<string, string> = {
    Water: 'Fire', Fire: 'Wind', Wind: 'Earth', Earth: 'Lightning', Lightning: 'Water',
    Ice: 'Shadow', Shadow: 'Neutral', Neutral: 'None',
};

type ServerTileCard = {
    id: string;
    element: string;
    top: number;
    right: number;
    bottom: number;
    left: number;
};

type Cell = { cardId: string; owner: 'p1' | 'p2' } | null;

type TilecardsSide = {
    name: string;
    clan: string;
    // Default deck submitted at join time — used if the player runs
    // out of time during the picking phase.
    defaultDeck: ServerTileCard[];
    // Final deck (promoted from defaultDeck on timeout, or set
    // explicitly via submit-deck).
    deck?: ServerTileCard[];
    // Card IDs still in hand. Populated when status flips to active.
    handIds?: string[];
    // True after the player explicitly locked in via submit-deck.
    ready: boolean;
};

export type TilecardsCwSession = {
    warId: string;
    challengeId: string;
    p1: TilecardsSide;
    p2?: TilecardsSide;
    board: Cell[];
    turn: 'p1' | 'p2';
    status: 'awaiting-p2' | 'picking' | 'active' | 'done';
    winner?: 'p1' | 'p2' | 'draw';
    createdAt: number;
    updatedAt: number;
    turnDeadline?: number;
    pickingDeadline?: number;
    // Server-rolled coin flip result — stored once at the
    // picking→active transition so both clients can show the same
    // animation and the first-turn assignment is deterministic.
    coinFlip?: 'p1' | 'p2';
};

const TURN_TIMEOUT_MS = 60_000;
const PICKING_TIMEOUT_MS = 30_000;

function sessionKey(challengeId: string): string {
    return `cw-tilecards:${challengeId}`;
}

function validateDeck(deck: unknown): ServerTileCard[] | null {
    if (!Array.isArray(deck) || deck.length !== 5) return null;
    const cleaned: ServerTileCard[] = [];
    const seenIds = new Set<string>();
    for (const raw of deck) {
        if (typeof raw !== 'object' || raw === null) return null;
        const r = raw as Record<string, unknown>;
        const id = String(r.id ?? '');
        const element = String(r.element ?? '');
        if (!id || !element) return null;
        if (seenIds.has(id)) return null;
        seenIds.add(id);
        const t = Number(r.top), ri = Number(r.right), b = Number(r.bottom), l = Number(r.left);
        if (![t, ri, b, l].every(n => Number.isFinite(n) && n >= 1 && n <= 99)) return null;
        const sum = t + ri + b + l;
        if (sum < 60 || sum > 340) return null;
        cleaned.push({ id, element, top: t, right: ri, bottom: b, left: l });
    }
    return cleaned;
}

function adjPos(pos: number, dir: 'up' | 'down' | 'left' | 'right'): number | null {
    const r = Math.floor(pos / 3), c = pos % 3;
    if (dir === 'up' && r > 0) return pos - 3;
    if (dir === 'down' && r < 2) return pos + 3;
    if (dir === 'left' && c > 0) return pos - 1;
    if (dir === 'right' && c < 2) return pos + 1;
    return null;
}

function lookupCard(session: TilecardsCwSession, cardId: string): ServerTileCard | null {
    const p1Deck = session.p1.deck ?? session.p1.defaultDeck;
    const hit = p1Deck.find(c => c.id === cardId);
    if (hit) return hit;
    if (!session.p2) return null;
    const p2Deck = session.p2.deck ?? session.p2.defaultDeck;
    return p2Deck.find(c => c.id === cardId) ?? null;
}

function applyCaptures(session: TilecardsCwSession, board: Cell[], pos: number, placerOwner: 'p1' | 'p2'): Cell[] {
    const placed = board[pos];
    if (!placed) return board;
    const placedCard = lookupCard(session, placed.cardId);
    if (!placedCard) return board;
    const nb = [...board];
    const dirs: { atk: 'top' | 'right' | 'bottom' | 'left'; def: 'top' | 'right' | 'bottom' | 'left'; dir: 'up' | 'down' | 'left' | 'right' }[] = [
        { atk: 'top',    def: 'bottom', dir: 'up' },
        { atk: 'bottom', def: 'top',    dir: 'down' },
        { atk: 'left',   def: 'right',  dir: 'left' },
        { atk: 'right',  def: 'left',   dir: 'right' },
    ];
    const friendlyAdjacent = dirs.some(({ dir }) => {
        const ap = adjPos(pos, dir);
        if (ap === null) return false;
        const cell = nb[ap];
        if (!cell || cell.owner !== placerOwner) return false;
        const c = lookupCard(session, cell.cardId);
        return !!c && c.element === placedCard.element;
    });
    for (const { atk, def, dir } of dirs) {
        const ap = adjPos(pos, dir);
        if (ap === null) continue;
        const cell = nb[ap];
        if (!cell || cell.owner === placerOwner) continue;
        const opponentCard = lookupCard(session, cell.cardId);
        if (!opponentCard) continue;
        let atkVal = placedCard[atk];
        if (ELEMENT_COUNTERS[placedCard.element] === opponentCard.element) atkVal = Math.floor(atkVal * 1.2);
        if (friendlyAdjacent) atkVal = Math.floor(atkVal * 1.2);
        const defVal = opponentCard[def];
        if (atkVal >= defVal) {
            nb[ap] = { ...cell, owner: placerOwner };
        }
    }
    return nb;
}

function scoreBoard(board: Cell[]): { p1: number; p2: number } {
    let p1 = 0, p2 = 0;
    for (const cell of board) {
        if (!cell) continue;
        if (cell.owner === 'p1') p1++;
        else p2++;
    }
    return { p1, p2 };
}

function gameOver(session: TilecardsCwSession): { winner: 'p1' | 'p2' | 'draw' } | null {
    const boardFull = session.board.every(c => c !== null);
    const handsEmpty = (session.p1.handIds ?? []).length === 0 && (session.p2?.handIds ?? []).length === 0;
    if (!boardFull && !handsEmpty) return null;
    const { p1, p2 } = scoreBoard(session.board);
    if (p1 > p2) return { winner: 'p1' };
    if (p2 > p1) return { winner: 'p2' };
    return { winner: 'draw' };
}

function translateWinner(session: TilecardsCwSession, ch: { fromClan: string }, winner: 'p1' | 'p2' | 'draw'): ChallengeResult {
    if (winner === 'draw') return 'draw';
    const winnerSide = winner === 'p1' ? session.p1 : session.p2!;
    return winnerSide.clan === ch.fromClan ? 'from-wins' : 'to-wins';
}

// Promote a side's defaultDeck to its live deck if no submit-deck
// fired in time. Idempotent.
function promoteDefault(side: TilecardsSide): TilecardsSide {
    if (side.deck && side.handIds) return side;
    const deck = side.deck ?? side.defaultDeck;
    return { ...side, deck, handIds: deck.map(c => c.id), ready: true };
}

// Transition picking → active: promote any unsubmitted defaults,
// flip the coin, deal hands, stamp turn deadline.
function startMatch(session: TilecardsCwSession, now: number): TilecardsCwSession {
    const p1 = promoteDefault(session.p1);
    const p2 = session.p2 ? promoteDefault(session.p2) : undefined;
    const coinFlip: 'p1' | 'p2' = Math.random() < 0.5 ? 'p1' : 'p2';
    return {
        ...session,
        p1,
        p2,
        status: 'active',
        turn: coinFlip,
        coinFlip,
        turnDeadline: now + TURN_TIMEOUT_MS,
        pickingDeadline: undefined,
        updatedAt: now,
    };
}

async function persistAndMaybeFinalize(session: TilecardsCwSession): Promise<void> {
    await kv.set(sessionKey(session.challengeId), session);
    if (session.status !== 'done' || !session.winner) return;

    const warKey = `clan-war:${session.warId}`;
    await withKvLock(warKey, async () => {
        const fresh = await kv.get<ClanWar>(warKey);
        if (!fresh) return;
        const { war: war0 } = applyLazyClanWarExpiry(fresh);
        if (war0.endedAt) return;
        const ch = war0.pendingChallenges.find(c => c.id === session.challengeId);
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'cw-tilecards', 60, 60_000, identity.name))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const action = String(body?.action ?? '').toLowerCase();
        const warId = String(body?.warId ?? '').trim();
        const challengeId = String(body?.challengeId ?? '').trim();
        if (!warId || !challengeId) return res.status(400).json({ error: 'Missing warId or challengeId.' });

        const ctx = await loadClanContext(identity.admin ? '' : identity.name);
        const me = identity.admin ? String(body?.playerName ?? '') : (ctx.name || identity.name);

        // ── state read (handles picking + turn timeouts) ─────────────
        if (action === 'state') {
            const session = await kv.get<TilecardsCwSession>(sessionKey(challengeId));
            if (!session) return res.status(404).json({ error: 'No tile-card session yet.' });
            const now = Date.now();
            // Auto-start match: if picking deadline elapsed, promote
            // defaults and start.
            if (session.status === 'picking' && session.pickingDeadline && now > session.pickingDeadline) {
                await withKvLock(sessionKey(challengeId), async () => {
                    const fresh = await kv.get<TilecardsCwSession>(sessionKey(challengeId));
                    if (!fresh || fresh.status !== 'picking' || !fresh.pickingDeadline || now <= fresh.pickingDeadline) return;
                    const started = startMatch(fresh, now);
                    await kv.set(sessionKey(challengeId), started);
                });
                const refreshed = await kv.get<TilecardsCwSession>(sessionKey(challengeId));
                if (refreshed) return res.status(200).json({ session: refreshed });
            }
            // Auto-skip stalled turns.
            if (session.status === 'active' && session.turnDeadline && now > session.turnDeadline) {
                await withKvLock(sessionKey(challengeId), async () => {
                    const fresh = await kv.get<TilecardsCwSession>(sessionKey(challengeId));
                    if (!fresh || fresh.status !== 'active' || !fresh.turnDeadline || now <= fresh.turnDeadline) return;
                    const next: TilecardsCwSession = {
                        ...fresh,
                        turn: fresh.turn === 'p1' ? 'p2' : 'p1',
                        turnDeadline: now + TURN_TIMEOUT_MS,
                        updatedAt: now,
                    };
                    const over = gameOver(next);
                    if (over) {
                        next.status = 'done';
                        next.winner = over.winner;
                        next.turnDeadline = undefined;
                    }
                    await persistAndMaybeFinalize(next);
                });
                const refreshed = await kv.get<TilecardsCwSession>(sessionKey(challengeId));
                if (refreshed) return res.status(200).json({ session: refreshed });
            }
            return res.status(200).json({ session });
        }

        const result = await withKvLock(sessionKey(challengeId), async () => {
            const existing = await kv.get<TilecardsCwSession>(sessionKey(challengeId));

            // ── join ───────────────────────────────────────────────
            // Adds the caller to the session. Both players must call
            // this with their fallback "default deck" (top 5 by stat
            // sum). The default is used if the player runs out of time
            // during the 30s picking phase.
            if (action === 'join') {
                const warKey = `clan-war:${warId}`;
                const war = await kv.get<ClanWar>(warKey);
                if (!war) return { status: 404 as const, body: { error: 'War not found.' } };
                const ch = war.pendingChallenges.find(c => c.id === challengeId);
                if (!ch) return { status: 404 as const, body: { error: 'Challenge not found or already resolved.' } };
                if (ch.mode !== 'tilecards') return { status: 400 as const, body: { error: 'Challenge is not a tile-card duel.' } };
                if (ch.status !== 'accepted') return { status: 409 as const, body: { error: 'Challenge has not been accepted yet.' } };

                const meLower = me.toLowerCase();
                const onFromSide = (ch.fromPlayer ?? '').toLowerCase() === meLower
                    || (ch.fromPlayer2 ?? '').toLowerCase() === meLower;
                const onToSide = (ch.acceptedPlayer ?? '').toLowerCase() === meLower
                    || (ch.acceptedPlayer2 ?? '').toLowerCase() === meLower;
                if (!identity.admin && !onFromSide && !onToSide) {
                    return { status: 403 as const, body: { error: 'Only a participant can join the duel.' } };
                }
                const myClan = onFromSide ? ch.fromClan : (war.clans.find(c => c !== ch.fromClan) ?? '');

                const defaultDeck = validateDeck(body?.defaultDeck);
                if (!defaultDeck) return { status: 400 as const, body: { error: 'Invalid defaultDeck.' } };

                const now = Date.now();
                const newSide: TilecardsSide = { name: me, clan: myClan, defaultDeck, ready: false };

                if (!existing) {
                    const session: TilecardsCwSession = {
                        warId,
                        challengeId,
                        p1: newSide,
                        board: Array(9).fill(null) as Cell[],
                        turn: 'p1',
                        status: 'awaiting-p2',
                        createdAt: now,
                        updatedAt: now,
                    };
                    await kv.set(sessionKey(challengeId), session);
                    return { status: 200 as const, body: { session } };
                }
                // Idempotent re-join: same player calling again gets
                // the existing session back without resetting state.
                if (existing.p1.name.toLowerCase() === meLower
                    || (existing.p2 && existing.p2.name.toLowerCase() === meLower)) {
                    return { status: 200 as const, body: { session: existing } };
                }
                // Second player joins → enter picking phase with 30s
                // deadline. Coin flip happens at the picking→active
                // transition.
                if (existing.status !== 'awaiting-p2') {
                    return { status: 409 as const, body: { error: 'Session is no longer accepting joiners.' } };
                }
                if (existing.p1.clan === myClan) {
                    return { status: 403 as const, body: { error: 'A duelist from your own clan is already in this session.' } };
                }
                const session: TilecardsCwSession = {
                    ...existing,
                    p2: newSide,
                    status: 'picking',
                    pickingDeadline: now + PICKING_TIMEOUT_MS,
                    updatedAt: now,
                };
                await kv.set(sessionKey(challengeId), session);
                return { status: 200 as const, body: { session } };
            }

            if (!existing) return { status: 404 as const, body: { error: 'No tile-card session yet — call join first.' } };

            const meLower = me.toLowerCase();
            const isP1 = existing.p1.name.toLowerCase() === meLower;
            const isP2 = !!existing.p2 && existing.p2.name.toLowerCase() === meLower;
            if (!identity.admin && !isP1 && !isP2) {
                return { status: 403 as const, body: { error: 'Only the two duelists can act on this session.' } };
            }
            const mySide: 'p1' | 'p2' = identity.admin ? (String(body?.side ?? 'p1') as 'p1' | 'p2') : (isP1 ? 'p1' : 'p2');

            // ── submit-deck (lock in your 5 cards) ─────────────────
            if (action === 'submit-deck') {
                if (existing.status !== 'picking') return { status: 409 as const, body: { error: 'Deck-picking phase is closed.' } };
                const deck = validateDeck(body?.deck);
                if (!deck) return { status: 400 as const, body: { error: 'Invalid deck: must be exactly 5 cards with stats 1-99 each and total 60-340.' } };

                const now = Date.now();
                const updatedSide: TilecardsSide = {
                    ...(mySide === 'p1' ? existing.p1 : existing.p2!),
                    deck,
                    handIds: deck.map(c => c.id),
                    ready: true,
                };
                let next: TilecardsCwSession = {
                    ...existing,
                    p1: mySide === 'p1' ? updatedSide : existing.p1,
                    p2: mySide === 'p2' ? updatedSide : existing.p2,
                    updatedAt: now,
                };
                // If both sides are now ready, start the match early.
                if (next.p1.ready && next.p2?.ready) {
                    next = startMatch(next, now);
                }
                await kv.set(sessionKey(challengeId), next);
                return { status: 200 as const, body: { session: next } };
            }

            // ── move ───────────────────────────────────────────────
            if (action === 'move') {
                if (existing.status !== 'active') return { status: 409 as const, body: { error: 'Duel is not active.' } };
                if (existing.turn !== mySide) return { status: 409 as const, body: { error: "Not your turn." } };

                const pos = Number(body?.pos);
                const cardId = String(body?.cardId ?? '');
                if (!Number.isInteger(pos) || pos < 0 || pos > 8) return { status: 400 as const, body: { error: 'Invalid position.' } };
                if (existing.board[pos] !== null) return { status: 409 as const, body: { error: 'That cell is already occupied.' } };

                const sideRec = mySide === 'p1' ? existing.p1 : existing.p2!;
                const hand = sideRec.handIds ?? [];
                if (!hand.includes(cardId)) return { status: 400 as const, body: { error: 'You do not have that card in your hand.' } };

                const placed: Cell = { cardId, owner: mySide };
                const newBoard = [...existing.board];
                newBoard[pos] = placed;
                const afterCaptures = applyCaptures(existing, newBoard, pos, mySide);
                const newHand = hand.filter(id => id !== cardId);

                const now = Date.now();
                let next: TilecardsCwSession = {
                    ...existing,
                    board: afterCaptures,
                    p1: mySide === 'p1' ? { ...existing.p1, handIds: newHand } : existing.p1,
                    p2: mySide === 'p2' ? { ...existing.p2!, handIds: newHand } : existing.p2,
                    turn: mySide === 'p1' ? 'p2' : 'p1',
                    turnDeadline: now + TURN_TIMEOUT_MS,
                    updatedAt: now,
                };
                const over = gameOver(next);
                if (over) {
                    next = { ...next, status: 'done', winner: over.winner, turnDeadline: undefined };
                }
                await persistAndMaybeFinalize(next);
                return { status: 200 as const, body: { session: next } };
            }

            // ── forfeit ────────────────────────────────────────────
            if (action === 'forfeit') {
                if (existing.status === 'done') {
                    return { status: 409 as const, body: { error: 'Duel already over.' } };
                }
                const winner: 'p1' | 'p2' = mySide === 'p1' ? 'p2' : 'p1';
                const now = Date.now();
                const next: TilecardsCwSession = {
                    ...existing,
                    status: 'done',
                    winner,
                    turnDeadline: undefined,
                    pickingDeadline: undefined,
                    updatedAt: now,
                };
                await persistAndMaybeFinalize(next);
                return { status: 200 as const, body: { session: next } };
            }

            return { status: 400 as const, body: { error: `Unknown action: ${action}` } };
        });

        return res.status(result.status).json(result.body);
    } catch (err) {
        console.error('[clan/war/tilecards]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
