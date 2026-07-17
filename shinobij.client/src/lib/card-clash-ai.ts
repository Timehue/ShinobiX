/*
 * Client for the SERVER-AUTHORITATIVE "Play vs AI" Shinobi Card Clash match.
 *
 * The match is now run by the server (api/card-clash/ai-start + ai-move): the
 * server owns the shuffled decks, the hidden AI hand, and every turn resolution,
 * so the winner — and the Ryo reward — are computed server-side and can no longer
 * be asserted by the client. This module just:
 *   • starts a match (sends the chosen deck, gets the initial board projection),
 *   • sends each move (play / end-turn / retreat) and gets the new projection,
 *   • hydrates a server projection into the CardClashMatchState the board renders
 *     (enriching each card id with its display fields from the client catalog).
 * The old client-resolved engine (createCardClashMatch / playCard / endTurn) is no
 * longer on the reward path.
 */
import type { Character } from "../types/character";
import {
    CARD_CLASH_LOCATIONS,
    SHADOW_CLONE_CARD,
    type CardClashCard,
    type CardClashLocation,
    type CardClashMatchState,
    type CardClashPlayedCard,
    type CardClashResult,
    type CardClashSide,
} from "./card-clash";

// ── Wire shapes (mirror api/card-clash/_ai-engine.ts projection) ──────────────

export interface DeckCardPayload {
    id: string;
    element: string;
    rarity: string;
    cost: number;
    power: number;
    ability: string;
}

interface ServerHandCard {
    id: string;
    element: string;
    rarity: string;
    cost: number;
    power: number;
    ability: string;
}

interface ServerPlayedCard extends ServerHandCard {
    iid: string;
    owner: "p1" | "p2";
    basePower: number;
    currentPower: number;
    loc: number;
    protectedFromReduction?: boolean;
    isToken?: boolean;
}

interface ServerLocation {
    def: { id: string; name: string; description: string; effectType: string };
    player: ServerPlayedCard[];
    opponent: ServerPlayedCard[];
}

export interface AiMatchProjection {
    matchId: string;
    status: "active" | "done";
    turn: number;
    maxTurns: number;
    winner?: CardClashResult;
    playerHand: ServerHandCard[];
    playerChakra: number;
    playerNextDiscount: number;
    playerDeckCount: number;
    opponentHandCount: number;
    opponentDeckCount: number;
    locations: ServerLocation[];
    log: string[];
}

export interface CardClashAiStartResult {
    ok: boolean;
    error?: string;
    matchId?: string;
    session?: AiMatchProjection;
}

export type CardClashAiMoveAction = "play" | "end-turn" | "retreat" | "state";

export interface CardClashAiMoveResult {
    ok: boolean;
    error?: string;
    session?: AiMatchProjection;
    reward?: { result: CardClashResult; ryo: number; dailyBonus: boolean };
    character?: Character;
}

// ── Deck → server payload ────────────────────────────────────────────────────

/** Convert saved deck ids to the wire deck the server validates + canonicalizes.
 *  The server overrides these stats with its own canonical values (ids are the
 *  trust anchor); we send the client's derived stats so validation passes. */
export function toDeckPayload(ids: string[], clashById: Record<string, CardClashCard>): DeckCardPayload[] {
    return ids.map((id) => {
        const c = clashById[id];
        return c
            ? { id, element: c.element, rarity: c.rarity, cost: c.cost, power: c.power, ability: c.abilityType }
            : { id, element: "None", rarity: "common", cost: 1, power: 1, ability: "none" };
    });
}

// ── Network calls ────────────────────────────────────────────────────────────

export async function startCardClashAiMatch(
    playerName: string,
    deck: DeckCardPayload[],
    playerLevel: number,
): Promise<CardClashAiStartResult> {
    try {
        const res = await fetch("/api/card-clash/ai-start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, deck, playerLevel }),
        });
        const data = (await res.json().catch(() => ({}))) as CardClashAiStartResult;
        if (!res.ok || !data.ok || !data.matchId || !data.session) {
            return { ...data, ok: false, error: data.error || "Could not start a Card Clash match." };
        }
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: "Could not start a Card Clash match." };
    }
}

export async function cardClashAiMove(
    matchId: string,
    action: CardClashAiMoveAction,
    extra: { handIndex?: number; locationIndex?: number } = {},
): Promise<CardClashAiMoveResult> {
    try {
        const res = await fetch("/api/card-clash/ai-move", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ matchId, action, ...extra }),
        });
        const data = (await res.json().catch(() => ({}))) as CardClashAiMoveResult;
        if (!res.ok || !data.ok) return { ...data, ok: false, error: data.error || "That move could not be resolved." };
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: "That move could not be resolved." };
    }
}

// ── Projection → CardClashMatchState (the board renderer's shape) ─────────────

function fallbackCard(c: ServerHandCard): CardClashCard {
    return {
        id: c.id, name: c.id, element: c.element as CardClashCard["element"],
        top: 0, right: 0, bottom: 0, left: 0,
        rarity: c.rarity as CardClashCard["rarity"], description: "",
        cost: c.cost, power: c.power, role: "fighter",
        abilityType: (c.ability || "none") as CardClashCard["abilityType"], abilityText: "",
    };
}

/** Replace {{card:<id>}} log tokens with the card's display name (the server only
 *  knows card ids; names live in the client catalog). */
function localizeLog(clashById: Record<string, CardClashCard>): (line: string) => string {
    return (line) => line.replace(/\{\{card:([^}]+)\}\}/g, (_m, id: string) => clashById[id]?.name ?? "a card");
}

/** Build the CardClashMatchState the board renders from a server projection. Card
 *  IDENTITY, board, hand, chakra, turn, and WINNER are the server's (authoritative);
 *  we only add cosmetic display fields (name/image/role/abilityText) from the
 *  catalog. Opponent hand/deck are counts only, so we pad placeholder arrays whose
 *  length is all the board reads. */
export function hydrateServerMatch(proj: AiMatchProjection, clashById: Record<string, CardClashCard>): CardClashMatchState {
    const hydrateCard = (c: ServerHandCard): CardClashCard => clashById[c.id] ?? fallbackCard(c);
    const hydratePlayed = (pc: ServerPlayedCard): CardClashPlayedCard => {
        const base = pc.isToken ? SHADOW_CLONE_CARD : (clashById[pc.id] ?? fallbackCard(pc));
        return {
            ...base,
            instanceId: pc.iid,
            owner: (pc.owner === "p1" ? "player" : "opponent") as CardClashSide,
            basePower: pc.basePower,
            currentPower: pc.currentPower,
            locationIndex: pc.loc,
            revealed: true,
            protectedFromReduction: pc.protectedFromReduction,
            isToken: pc.isToken,
        };
    };
    const filler = (n: number): CardClashCard[] => Array.from({ length: Math.max(0, n) }, () => SHADOW_CLONE_CARD);
    const loc = localizeLog(clashById);

    return {
        turn: proj.turn,
        maxTurns: 6,
        playerDeck: [],
        opponentDeck: filler(proj.opponentDeckCount),
        playerHand: proj.playerHand.map(hydrateCard),
        opponentHand: filler(proj.opponentHandCount),
        locations: proj.locations.map((l) => ({
            location: (CARD_CLASH_LOCATIONS.find((x) => x.id === l.def.id) ?? (l.def as CardClashLocation)),
            playerCards: l.player.map(hydratePlayed),
            opponentCards: l.opponent.map(hydratePlayed),
        })),
        playerChakra: proj.playerChakra,
        opponentChakra: proj.turn,
        playerNextCardDiscount: proj.playerNextDiscount,
        opponentNextCardDiscount: 0,
        status: proj.status === "done" ? "complete" : "playing",
        winner: proj.winner,
        log: proj.log.map(loc),
        instanceCounter: 0,
    };
}
