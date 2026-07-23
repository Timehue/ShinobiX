import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { CardClashDuelScreen, type CardClashDuelConfig } from "./ClanWarTileCardDuel";

const FREEPLAY_CARD_CONFIG: CardClashDuelConfig = {
    stashKey: "cardClashFreePlay.v1",
    endpoint: "/api/card-clash/match",
    title: "Free-Play Chronicle Duel",
    backScreen: "shinobiTiles",
    backLabel: "Back to Card Hall",
    emptyTitle: "No active Chronicle duel",
    emptyNote: "The match context was lost. Return to the Card Hall to queue again.",
    emptyBackLabel: "Back to Card Hall",
    awaitingNote: "Waiting for your opponent to join the duel.",
    forfeitConfirm: "Forfeit the duel? Your opponent takes the win.",
    doneNote: (won, draw) => draw
        ? "Technical draw. Free play is unranked."
        : won ? "Victory. Free play has no rewards or rating changes." : "Defeat. No rating was lost.",
    autoJoin: true,
};

export function CardClashFreePlay({ character, setScreen, sharedImages = {} }: { character: Character; setScreen: (s: Screen) => void; sharedImages?: Record<string, string> }) {
    return <CardClashDuelScreen character={character} setScreen={setScreen} config={FREEPLAY_CARD_CONFIG} sharedImages={sharedImages} />;
}
