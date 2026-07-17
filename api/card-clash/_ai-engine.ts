/*
 * Server-authoritative Shinobi Card Clash — single-player (vs AI) engine.
 *
 * The "Play vs AI" match used to be resolved entirely on the client, which then
 * POSTed the winner to /api/card-clash/ai-settle for a Ryo payout — so a
 * fabricated `result:'player'` paid a win the player never earned (P1 audit).
 *
 * This module makes the SERVER run the match: it owns the shuffled decks, the
 * hidden AI hand, and every turn resolution, so the winner is computed here
 * (determineWinner) and the reward is paid from THAT — the client can no longer
 * assert an outcome. It is the single-player twin of the PvP session in
 * api/card-clash/match.ts and reuses the same pure engine
 * (api/clan/war/_card-clash-engine.ts) for validation, on-reveal effects, power,
 * and win determination.
 *
 * Turn model (faithful to the old client game, NOT the PvP simultaneous-commit):
 * the player plays cards one at a time — each revealed immediately with its
 * On-Reveal effect (`playOne`) — then ends the turn; the greedy AI then responds
 * (`aiTakeTurn`), and the turn advances (`advanceOrFinish`). The player is p1, the
 * AI is p2. The AI deck is generated server-side from the built-in catalog only
 * (never creator cards) so it can never field cards a player would need to own.
 */
import {
    applyOnReveal,
    clashCopyLimit,
    createMatch,
    dealOpening,
    determineWinner,
    locationBonus,
    locationSidePower,
    pickRandomLocationIds,
    shuffleDeck,
    CLASH_DECK_SIZE,
    CLASH_MAX_HAND,
    CLASH_MAX_LEGENDARY,
    CLASH_MAX_TURNS,
    CLASH_SLOTS,
    type ClashCard,
    type ClashLocationDef,
    type ClashMatch,
    type ClashPlayed,
    type ClashRarity,
    type ClashSide,
    type ClashSideKey,
} from '../clan/war/_card-clash-engine.js';
import { BUILTIN_CLASH } from '../clan/war/_card-catalog.js';

export type AiMatchResult = 'player' | 'opponent' | 'draw';

export interface AiMatchSession {
    matchId: string;
    playerName: string;
    createdAt: number;
    player: ClashSide;   // p1 (the human)
    ai: ClashSide;       // p2 (the server AI)
    match: ClashMatch;
    status: 'active' | 'done';
    winner?: AiMatchResult;
    settledAt?: number;
}

/** Per-viewer projection: full board (both sides revealed) + the player's own
 *  hand, but only COUNTS of the AI's hand/deck — its contents stay hidden. */
export interface AiMatchProjection {
    matchId: string;
    status: 'active' | 'done';
    turn: number;
    maxTurns: number;
    winner?: AiMatchResult;
    playerHand: ClashCard[];
    playerChakra: number;
    playerNextDiscount: number;
    playerDeckCount: number;
    opponentHandCount: number;
    opponentDeckCount: number;
    locations: Array<{ def: ClashLocationDef; player: ClashPlayed[]; opponent: ClashPlayed[] }>;
    log: string[];
}

const OPPONENT_KEY: ClashSideKey = 'p2';
const PLAYER_KEY: ClashSideKey = 'p1';

function effectiveCost(cost: number, discount: number): number {
    return Math.max(1, cost - discount);
}

// A log token the client localizes to the card's display name (the server only
// knows card ids; names live in the client bundle). See hydrateServerMatch.
function cardToken(id: string): string {
    return `{{card:${id}}}`;
}

// ── AI deck generation (server-side, built-in catalog only) ──────────────────
// Faithful port of shinobij.client/src/lib/card-clash.ts generateAiDeck +
// aiRarityWeights. Uses Math.random — the AI deck is a server secret, never
// replayed, so it needs no determinism contract.

type RarityWeights = Partial<Record<ClashRarity, number>>;

function aiRarityWeights(playerLevel: number): RarityWeights {
    if (playerLevel >= 50) return { common: 0.35, rare: 0.35, epic: 0.22, legendary: 0.08 };
    if (playerLevel >= 25) return { common: 0.45, rare: 0.4, epic: 0.15 };
    return { common: 0.6, rare: 0.4 };
}

function weightedRarity(weights: RarityWeights): ClashRarity {
    const entries = Object.entries(weights) as [ClashRarity, number][];
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let roll = Math.random() * total;
    for (const [rarity, w] of entries) {
        roll -= w;
        if (roll <= 0) return rarity;
    }
    return entries[0][0];
}

/** The built-in catalog as engine cards (id + canonical stats), for the AI only. */
function builtinCatalog(): ClashCard[] {
    return Object.entries(BUILTIN_CLASH).map(([id, stats]) => ({ id, ...stats }));
}

/** Build a legal 12-card AI deck from the built-in catalog (never creator cards),
 *  honouring the same copy / legendary-cap rules as a player deck. */
export function generateAiServerDeck(playerLevel: number): ClashCard[] {
    const catalog = builtinCatalog();
    const weights = aiRarityWeights(playerLevel);
    const allowed = new Set(Object.keys(weights));
    const byRarity: Record<string, ClashCard[]> = {};
    for (const c of catalog) {
        if (!allowed.has(c.rarity)) continue;
        (byRarity[c.rarity] ??= []).push(c);
    }

    const deck: ClashCard[] = [];
    const counts: Record<string, number> = {};
    let legendaryCount = 0;
    let safety = 0;
    while (deck.length < CLASH_DECK_SIZE && safety < 500) {
        safety++;
        const rarity = weightedRarity(weights);
        const pool = byRarity[rarity];
        if (!pool || pool.length === 0) continue;
        const card = pool[Math.floor(Math.random() * pool.length)];
        if (card.rarity === 'legendary' && legendaryCount >= CLASH_MAX_LEGENDARY) continue;
        if ((counts[card.id] ?? 0) >= clashCopyLimit(card.rarity)) continue;
        deck.push(card);
        counts[card.id] = (counts[card.id] ?? 0) + 1;
        if (card.rarity === 'legendary') legendaryCount++;
    }

    // Backfill from commons/rares if weighting starved the deck.
    if (deck.length < CLASH_DECK_SIZE) {
        const filler = catalog.filter((c) => c.rarity === 'common' || c.rarity === 'rare');
        let i = 0;
        while (deck.length < CLASH_DECK_SIZE && filler.length > 0) {
            const card = filler[i % filler.length];
            if ((counts[card.id] ?? 0) < clashCopyLimit(card.rarity)) {
                deck.push(card);
                counts[card.id] = (counts[card.id] ?? 0) + 1;
            } else if (i > filler.length * 3) {
                break;
            }
            i++;
        }
    }
    return shuffleDeck(deck);
}

// ── Session setup ────────────────────────────────────────────────────────────

function freshSide(deck: ClashCard[]): ClashSide {
    const shuffled = shuffleDeck(deck);
    const { hand, rest } = dealOpening(shuffled);
    return {
        name: '', clan: '', defaultDeck: [], deck: rest, hand,
        chakra: 1, nextDiscount: 0, committed: false, pending: [], ready: true,
    };
}

/** Create a fresh server AI match: player deck already ownership-resolved by the
 *  caller, AI deck generated here. Deals opening hands, picks 3 locations. */
export function createAiMatch(matchId: string, playerName: string, playerDeck: ClashCard[], playerLevel: number, now: number): AiMatchSession {
    return {
        matchId,
        playerName,
        createdAt: now,
        player: freshSide(playerDeck),
        ai: freshSide(generateAiServerDeck(playerLevel)),
        match: createMatch(pickRandomLocationIds()),
        status: 'active',
    };
}

// ── Single play (immediate reveal + On-Reveal) ───────────────────────────────

/** Play one hand card for a side: validate (chakra / slot / index), spend chakra,
 *  place it revealed, and apply its On-Reveal. Mutates. Mirrors the client
 *  playCard's per-card reveal semantics. */
export function playOne(
    session: AiMatchSession,
    sideKey: ClashSideKey,
    handIndex: number,
    loc: number,
): { ok: true } | { ok: false; error: string } {
    if (session.status !== 'active') return { ok: false, error: 'The match is over.' };
    const side = sideKey === PLAYER_KEY ? session.player : session.ai;
    const match = session.match;
    if (!Number.isInteger(handIndex) || handIndex < 0 || handIndex >= side.hand.length)
        return { ok: false, error: 'That card is not in hand.' };
    if (!Number.isInteger(loc) || loc < 0 || loc >= match.locations.length)
        return { ok: false, error: 'No such location.' };
    if (match.locations[loc][sideKey].length >= CLASH_SLOTS)
        return { ok: false, error: 'That location is full (max 4 cards).' };

    const card = side.hand[handIndex];
    const cost = effectiveCost(card.cost, side.nextDiscount);
    if (cost > side.chakra) return { ok: false, error: 'Not enough Chakra.' };

    side.hand.splice(handIndex, 1);
    side.chakra -= cost;
    side.nextDiscount = 0;

    const played: ClashPlayed = {
        ...card,
        iid: `iid-${match.iidCounter++}`,
        owner: sideKey,
        basePower: card.power,
        currentPower: card.power,
        loc,
    };
    match.locations[loc][sideKey].push(played);
    match.log.push(`${sideKey === PLAYER_KEY ? '🟦 You play' : '🟥 Opponent plays'} ${cardToken(card.id)} at ${match.locations[loc].def.name}.`);
    applyOnReveal(match, side, sideKey, played);
    return { ok: true };
}

// ── Greedy AI turn (port of client aiTakeTurn) ───────────────────────────────

/** The AI plays greedily: repeatedly the affordable card with the best
 *  power-per-chakra, at the location where it helps most (prefers where it is
 *  losing + the location bonus). Mutates until it can make no more legal play. */
export function aiTakeTurn(session: AiMatchSession): void {
    const match = session.match;
    const ai = session.ai;
    let safety = 0;
    while (safety < 24) {
        safety++;
        const discount = ai.nextDiscount;

        let bestHandIndex = -1;
        let bestCardScore = -Infinity;
        for (let i = 0; i < ai.hand.length; i++) {
            const c = ai.hand[i];
            const cost = effectiveCost(c.cost, discount);
            if (cost > ai.chakra) continue;
            const ratio = c.power / cost + c.power * 0.01;
            if (ratio > bestCardScore) {
                bestCardScore = ratio;
                bestHandIndex = i;
            }
        }
        if (bestHandIndex === -1) break;
        const card = ai.hand[bestHandIndex];

        let bestLoc = -1;
        let bestLocScore = -Infinity;
        for (let li = 0; li < match.locations.length; li++) {
            const location = match.locations[li];
            if (location[OPPONENT_KEY].length >= CLASH_SLOTS) continue;
            const deficit = locationSidePower(location, PLAYER_KEY) - locationSidePower(location, OPPONENT_KEY);
            const marginal = card.power + locationBonus(card, location.def);
            const score = deficit + marginal;
            if (score > bestLocScore) {
                bestLocScore = score;
                bestLoc = li;
            }
        }
        if (bestLoc === -1) break;

        const res = playOne(session, OPPONENT_KEY, bestHandIndex, bestLoc);
        if (!res.ok) break;
    }
}

// ── Turn advance / finish ────────────────────────────────────────────────────

function drawOne(side: ClashSide): void {
    if (side.deck.length > 0 && side.hand.length < CLASH_MAX_HAND) side.hand.push(side.deck.shift()!);
}

/** After the AI has responded: finish the match at turn 6 (compute the winner),
 *  else advance a turn (chakra rises, both draw). Mutates + sets status/winner. */
export function advanceOrFinish(session: AiMatchSession): void {
    const match = session.match;
    if (match.turn >= CLASH_MAX_TURNS) {
        const w = determineWinner(match);
        session.winner = w === 'p1' ? 'player' : w === 'p2' ? 'opponent' : 'draw';
        session.status = 'done';
        match.log.push(
            session.winner === 'player' ? '🏆 You win the clash!'
                : session.winner === 'opponent' ? '💀 You lose the clash.'
                    : '🤝 The clash ends in a draw.',
        );
        return;
    }
    match.turn += 1;
    session.player.chakra = match.turn;
    session.ai.chakra = match.turn;
    drawOne(session.player);
    drawOne(session.ai);
    match.log.push(`— Turn ${match.turn} —`);
}

/** Resolve the player's End-Turn: the AI responds, then advance or finish. */
export function endTurn(session: AiMatchSession): void {
    if (session.status !== 'active') return;
    aiTakeTurn(session);
    advanceOrFinish(session);
}

/** Whether the match has finished. A plain predicate (not a type guard) so
 *  callers can re-check status AFTER a mutating call without TS wrongly narrowing
 *  `status` to a single literal across the mutation. */
export function isDone(session: AiMatchSession): boolean {
    return session.status === 'done';
}

/** Player concedes → immediate opponent win. Mutates + sets status/winner. */
export function forfeit(session: AiMatchSession): void {
    if (session.status !== 'active') return;
    session.status = 'done';
    session.winner = 'opponent';
    session.match.log.push('🏳️ You retreat. The clash is forfeit.');
}

// ── Projection ───────────────────────────────────────────────────────────────

export function projectAiMatch(session: AiMatchSession): AiMatchProjection {
    return {
        matchId: session.matchId,
        status: session.status,
        turn: session.match.turn,
        maxTurns: CLASH_MAX_TURNS,
        winner: session.winner,
        playerHand: session.player.hand,
        playerChakra: session.player.chakra,
        playerNextDiscount: session.player.nextDiscount,
        playerDeckCount: session.player.deck.length,
        opponentHandCount: session.ai.hand.length,
        opponentDeckCount: session.ai.deck.length,
        locations: session.match.locations.map((l) => ({ def: l.def, player: l.p1, opponent: l.p2 })),
        log: session.match.log,
    };
}
