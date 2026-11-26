/**
 * Hall Ladder, server side: the deck behind each duelist and the change a bout
 * makes to a fresh match. The ladder itself (order, bouts, the save record and
 * its reducers) lives in shared/hall-ladder-contract.ts.
 *
 * Every duelist plays a deck that is already tested as a legal 40-card list:
 * the Card Hall's easy deck for the apprentice, and an Echoes of War deck that
 * fits each later duelist's style.
 */
import type { ChronicleMatch } from "../../shared/chronicle-duel.js";
import type { HallLadderBout } from "../../shared/hall-ladder-contract.js";
import { CHRONICLE_AI_DECKS } from "./_ai-engine.js";
import { echoesEncounterById } from "./_echoes-catalog.js";

const DECK_SOURCE: Readonly<Record<string, string>> = Object.freeze({
    apprentice: "ai:easy",
    scrollkeeper: "echoes-2-vetta",
    swifthand: "echoes-3-aya",
    stonewall: "echoes-6-korin",
    hiddenmist: "echoes-8-eren",
    champion: "echoes-10-halden",
});

/** Board names for each duelist's deck. Server-only: the client never shows
 *  them before a duel, so they stay out of the browser bundle. */
export const HALL_LADDER_DECK_NAMES: Readonly<Record<string, string>> = Object.freeze({
    apprentice: "First Lessons",
    scrollkeeper: "Old Ledgers",
    swifthand: "Quick Feathers",
    stonewall: "Unbroken Line",
    hiddenmist: "Veiled Answers",
    champion: "Champion's Due",
});

/** The deck a ladder duelist plays, copied so a match can shuffle it. */
export function hallLadderOpponentDeck(duelistId: string): string[] | null {
    const source = DECK_SOURCE[duelistId];
    if (!source) return null;
    if (source.startsWith("ai:")) {
        const deck = (CHRONICLE_AI_DECKS as Record<string, readonly string[]>)[source.slice(3)];
        return deck ? [...deck] : null;
    }
    const echoes = echoesEncounterById(source);
    return echoes ? [...echoes.deck] : null;
}

/** Apply a bout's handicap before the first decision. The AI is always p2. */
export function applyHallLadderBout(state: ChronicleMatch, bout: HallLadderBout): void {
    if (bout.opponentLifeBonus <= 0) return;
    state.p2.lifePoints += bout.opponentLifeBonus;
    state.log = [
        ...state.log,
        `Full strength: ${state.p2.name} starts with ${bout.opponentLifeBonus.toLocaleString("en-US")} more Health.`,
    ];
}
