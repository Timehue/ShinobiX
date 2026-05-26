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
//   action: 'init'     body: { deck: ServerTileCard[5] }
//   action: 'move'     body: { pos: 0-8, cardId: string }
//   action: 'forfeit'  body: {}
//   action: 'state'    body: {}   (GET-like read of the session)
//
// PvP-style turn-based tile card duel that runs entirely server-side.
// The server owns the game state, validates every move, applies the
// Triple-Triad-style capture rules, and — when the board fills or one
// side forfeits — calls applyFinalResult against the parent clan war
// so HP damage flows through the same path as PvP and pet wins.
//
// Players never call /api/clan/war/report for tile-card duels; the
// outcome is server-driven from move + state polls. No manual report
// path exists.

// ── Card data ────────────────────────────────────────────────────────
// Server-side card stats. Each session stores the player-supplied deck
// inline (with stats) so we don't need to mirror all 150 canonical
// cards here. Cheating via inflated stats is prevented by:
//   1. Each card's total stats are bounded (sum 60-340)
//   2. Each card stat is bounded (1-99)
//   3. Each player can submit at most 5 cards
//   4. Both clients see the OPPONENT's deck once init completes —
//      visible cheating would be obvious to the other player.
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
    deck: ServerTileCard[];   // 5 cards, exact stats stored on init
    handIds: string[];        // remaining card ids in hand
};

export type TilecardsCwSession = {
    warId: string;
    challengeId: string;
    p1: TilecardsSide;
    p2?: TilecardsSide;       // populated on second init call
    board: Cell[];             // 9 cells (3x3)
    turn: 'p1' | 'p2';
    status: 'awaiting-p2' | 'active' | 'done';
    winner?: 'p1' | 'p2' | 'draw';
    createdAt: number;
    updatedAt: number;
    turnDeadline?: number;     // ms epoch; auto-skip on stall (60s)
};

const TURN_TIMEOUT_MS = 60_000;

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
        if (seenIds.has(id)) return null;       // no duplicates
        seenIds.add(id);
        const t = Number(r.top), ri = Number(r.right), b = Number(r.bottom), l = Number(r.left);
        if (![t, ri, b, l].every(n => Number.isFinite(n) && n >= 1 && n <= 99)) return null;
        const sum = t + ri + b + l;
        if (sum < 60 || sum > 340) return null;  // anti-cheat bound
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
    const p1 = session.p1.deck.find(c => c.id === cardId);
    if (p1) return p1;
    if (!session.p2) return null;
    return session.p2.deck.find(c => c.id === cardId) ?? null;
}

// Apply Triple-Triad-style capture rules. Returns the new board.
// Adjacent ENEMY cards flip when the placer's matching edge >= the
// defender's opposing edge. Element-counter bonus: placer's attack
// edge is +20% vs a card whose element it counters. Friendly-element
// boost: +20% when a same-element friendly card is adjacent.
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
    // Friendly-element boost: any friendly same-element card adjacent
    // to the placement triggers it.
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
    // Game ends when board is full OR both hands are empty.
    const boardFull = session.board.every(c => c !== null);
    const p2 = session.p2;
    const handsEmpty = session.p1.handIds.length === 0 && (p2 ? p2.handIds.length === 0 : true);
    if (!boardFull && !handsEmpty) return null;
    const { p1, p2: p2Score } = scoreBoard(session.board);
    if (p1 > p2Score) return { winner: 'p1' };
    if (p2Score > p1) return { winner: 'p2' };
    return { winner: 'draw' };
}

// Translate p1/p2 winner to a ChallengeResult based on which side is
// the fromClan in the parent challenge.
function translateWinner(session: TilecardsCwSession, ch: { fromClan: string }, winner: 'p1' | 'p2' | 'draw'): ChallengeResult {
    if (winner === 'draw') return 'draw';
    const winnerSide = winner === 'p1' ? session.p1 : session.p2!;
    return winnerSide.clan === ch.fromClan ? 'from-wins' : 'to-wins';
}

// Persist + (if the game just ended) apply HP damage to the parent
// war via applyFinalResult. Wraps the war record in withKvLock to
// keep the report path atomic.
async function persistAndMaybeFinalize(session: TilecardsCwSession): Promise<void> {
    await kv.set(sessionKey(session.challengeId), session);
    if (session.status !== 'done' || !session.winner) return;

    const warKey = `clan-war:${session.warId}`;
    await withKvLock(warKey, async () => {
        const fresh = await kv.get<ClanWar>(warKey);
        if (!fresh) return;
        const { war: war0 } = applyLazyClanWarExpiry(fresh);
        if (war0.endedAt) return; // war already over; skip damage
        const ch = war0.pendingChallenges.find(c => c.id === session.challengeId);
        if (!ch || ch.status !== 'accepted') return; // already resolved another way
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

        // ── state read ─────────────────────────────────────────────
        if (action === 'state') {
            const session = await kv.get<TilecardsCwSession>(sessionKey(challengeId));
            if (!session) return res.status(404).json({ error: 'No tile-card session yet.' });
            // Auto-skip stalled turns: if the active side's deadline has
            // passed, they forfeit the turn (pass without placing).
            if (session.status === 'active' && session.turnDeadline && Date.now() > session.turnDeadline) {
                await withKvLock(sessionKey(challengeId), async () => {
                    const fresh = await kv.get<TilecardsCwSession>(sessionKey(challengeId));
                    if (!fresh || fresh.status !== 'active' || !fresh.turnDeadline || Date.now() <= fresh.turnDeadline) return;
                    // Switch turn, refresh deadline. If the other side
                    // also has an empty hand, end the game.
                    const next: TilecardsCwSession = {
                        ...fresh,
                        turn: fresh.turn === 'p1' ? 'p2' : 'p1',
                        turnDeadline: Date.now() + TURN_TIMEOUT_MS,
                        updatedAt: Date.now(),
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

        // All write paths are locked.
        const result = await withKvLock(sessionKey(challengeId), async () => {
            const existing = await kv.get<TilecardsCwSession>(sessionKey(challengeId));

            // ── init ───────────────────────────────────────────────
            if (action === 'init') {
                // Validate the challenge first.
                const warKey = `clan-war:${warId}`;
                const war = await kv.get<ClanWar>(warKey);
                if (!war) return { status: 404 as const, body: { error: 'War not found.' } };
                const ch = war.pendingChallenges.find(c => c.id === challengeId);
                if (!ch) return { status: 404 as const, body: { error: 'Challenge not found or already resolved.' } };
                if (ch.mode !== 'tilecards') return { status: 400 as const, body: { error: 'Challenge is not a tile-card duel.' } };
                if (ch.status !== 'accepted') return { status: 409 as const, body: { error: 'Challenge has not been accepted yet.' } };

                // Identify which side the caller is on.
                const meLower = me.toLowerCase();
                const onFromSide = (ch.fromPlayer ?? '').toLowerCase() === meLower
                    || (ch.fromPlayer2 ?? '').toLowerCase() === meLower;
                const onToSide = (ch.acceptedPlayer ?? '').toLowerCase() === meLower
                    || (ch.acceptedPlayer2 ?? '').toLowerCase() === meLower;
                if (!identity.admin && !onFromSide && !onToSide) {
                    return { status: 403 as const, body: { error: 'Only a participant can join the duel.' } };
                }
                const myClan = onFromSide ? ch.fromClan : (war.clans.find(c => c !== ch.fromClan) ?? '');

                const deck = validateDeck(body?.deck);
                if (!deck) return { status: 400 as const, body: { error: 'Invalid deck: must be exactly 5 cards with stats 1-99 each and total 60-340.' } };

                const now = Date.now();
                const side: TilecardsSide = {
                    name: me,
                    clan: myClan,
                    deck,
                    handIds: deck.map(c => c.id),
                };

                if (!existing) {
                    // First initializer becomes p1; session waits for p2.
                    const session: TilecardsCwSession = {
                        warId,
                        challengeId,
                        p1: side,
                        board: Array(9).fill(null) as Cell[],
                        turn: 'p1', // overwritten when p2 joins
                        status: 'awaiting-p2',
                        createdAt: now,
                        updatedAt: now,
                    };
                    await kv.set(sessionKey(challengeId), session);
                    return { status: 200 as const, body: { session } };
                }

                // Same player re-initing: idempotent (they get their stored side back).
                if (existing.p1.name.toLowerCase() === meLower) {
                    return { status: 200 as const, body: { session: existing } };
                }
                if (existing.p2 && existing.p2.name.toLowerCase() === meLower) {
                    return { status: 200 as const, body: { session: existing } };
                }

                // Second initializer: must be on the OPPOSITE clan from p1.
                if (existing.status !== 'awaiting-p2') {
                    return { status: 409 as const, body: { error: 'Session is no longer accepting joiners.' } };
                }
                if (existing.p1.clan === myClan) {
                    return { status: 403 as const, body: { error: 'A duel partner from your own clan is already initialized; wait for the opposing side.' } };
                }
                // Deterministic first turn: lexicographically smaller name goes first.
                const firstTurn: 'p1' | 'p2' = existing.p1.name.toLowerCase() < me.toLowerCase() ? 'p1' : 'p2';
                const session: TilecardsCwSession = {
                    ...existing,
                    p2: side,
                    status: 'active',
                    turn: firstTurn,
                    turnDeadline: now + TURN_TIMEOUT_MS,
                    updatedAt: now,
                };
                await kv.set(sessionKey(challengeId), session);
                return { status: 200 as const, body: { session } };
            }

            if (!existing) return { status: 404 as const, body: { error: 'No tile-card session yet — call init first.' } };

            // Identify which side the caller is on.
            const meLower = me.toLowerCase();
            const isP1 = existing.p1.name.toLowerCase() === meLower;
            const isP2 = !!existing.p2 && existing.p2.name.toLowerCase() === meLower;
            if (!identity.admin && !isP1 && !isP2) {
                return { status: 403 as const, body: { error: 'Only the two duelists can act on this session.' } };
            }
            const mySide: 'p1' | 'p2' = identity.admin ? (String(body?.side ?? 'p1') as 'p1' | 'p2') : (isP1 ? 'p1' : 'p2');

            // ── move ───────────────────────────────────────────────
            if (action === 'move') {
                if (existing.status !== 'active') return { status: 409 as const, body: { error: 'Duel is not active.' } };
                if (existing.turn !== mySide) return { status: 409 as const, body: { error: "Not your turn." } };

                const pos = Number(body?.pos);
                const cardId = String(body?.cardId ?? '');
                if (!Number.isInteger(pos) || pos < 0 || pos > 8) return { status: 400 as const, body: { error: 'Invalid position.' } };
                if (existing.board[pos] !== null) return { status: 409 as const, body: { error: 'That cell is already occupied.' } };

                const sideRec = mySide === 'p1' ? existing.p1 : existing.p2!;
                if (!sideRec.handIds.includes(cardId)) return { status: 400 as const, body: { error: 'You do not have that card in your hand.' } };

                // Place + apply captures.
                const placed: Cell = { cardId, owner: mySide };
                const newBoard = [...existing.board];
                newBoard[pos] = placed;
                const afterCaptures = applyCaptures(existing, newBoard, pos, mySide);
                const newHand = sideRec.handIds.filter(id => id !== cardId);

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
                if (existing.status !== 'active' && existing.status !== 'awaiting-p2') {
                    return { status: 409 as const, body: { error: 'Duel is not active.' } };
                }
                const winner: 'p1' | 'p2' = mySide === 'p1' ? 'p2' : 'p1';
                const now = Date.now();
                const next: TilecardsCwSession = {
                    ...existing,
                    status: 'done',
                    winner,
                    turnDeadline: undefined,
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
