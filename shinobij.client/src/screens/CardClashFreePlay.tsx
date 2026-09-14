import type { Character } from "../types/character";
import { rememberedCircuitTrial } from '../features/dojo-circuit/client';
import type { Screen } from "../types/core";
import { CardClashDuelScreen, type CardClashDuelConfig } from "./ClanWarTileCardDuel";

const FREEPLAY_CARD_CONFIG: CardClashDuelConfig = {
    stashKey: "cardClashFreePlay.v1",
    endpoint: "/api/card-clash/match",
    title: "Free-Play Chronicle Showdown",
    backScreen: "shinobiTiles",
    backLabel: "Back to Card Hall",
    emptyTitle: "No active Chronicle showdown",
    emptyNote: "The match context was lost. Return to the Card Hall to queue again.",
    emptyBackLabel: "Back to Card Hall",
    awaitingNote: "Waiting for your opponent to join the showdown.",
    forfeitConfirm: "Forfeit the showdown? Your opponent takes the win.",
    doneNote: (won, draw) => draw
        ? "Technical draw. Free play is unranked."
        : won ? "Victory. Free play has no rewards or rating changes." : "Defeat. No rating was lost.",
    autoJoin: true,
};

export function CardClashFreePlay({ character, setScreen, sharedImages = {} }: { character: Character; setScreen: (s: Screen) => void; sharedImages?: Record<string, string> }) {
    return <CardClashDuelScreen character={character} setScreen={setScreen} config={rememberedCircuitTrial(character.name) === 'cards' ? CIRCUIT_CARD_CONFIG : FREEPLAY_CARD_CONFIG} sharedImages={sharedImages} />;
}
const CIRCUIT_CARD_CONFIG: CardClashDuelConfig = { ...FREEPLAY_CARD_CONFIG, title: 'Dojo Circuit · Card Clash', eventLabel: 'CIRCUIT', backScreen: 'dojoCircuit', backLabel: 'Return to Circuit',
    doneNote: (won, draw) => draw ? 'A drawn trial. No seal is awarded.' : won ? 'Return to the Circuit to view your seal. A completed duel with meaningful play from both sides qualifies; early forfeits do not.' : 'The trial remains open. Try again when you are ready.' };
