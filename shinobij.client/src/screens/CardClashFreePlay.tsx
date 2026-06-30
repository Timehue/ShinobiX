import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { CardClashDuelScreen, type CardClashDuelConfig } from "./ClanWarTileCardDuel";

// Free-play Shinobi Card Clash PvP — the interactive duel pointed at the open
// matchmaking match handler (/api/card-clash/match). Reuses CardClashDuelScreen
// wholesale; the only differences from the clan-war / sector-war duels are this
// config + autoJoin. The Card Hall "Free-Play PvP" queue stashes { matchId } under
// the stashKey and routes here, so the screen joins on entry (no accept step).
// Free-play is UNRANKED — the server pays no currency and changes no rating.
const FREEPLAY_CARD_CONFIG: CardClashDuelConfig = {
    stashKey: "cardClashFreePlay.v1",
    endpoint: "/api/card-clash/match",
    title: "Free-Play Duel",
    backScreen: "shinobiTiles",
    backLabel: "← Card Hall",
    emptyTitle: "⚠ No active card duel",
    emptyNote: "The match context was lost. Return to the Card Hall to queue again.",
    emptyBackLabel: "Back to Card Hall",
    awaitingNote: "⏳ Waiting for your opponent to join the duel…",
    forfeitConfirm: "Forfeit the duel? Your opponent takes the win.",
    doneNote: (won, draw) =>
        draw
            ? "A draw — free-play is unranked, just bragging rights."
            : won
                ? "Victory! (Free-play is unranked — no rewards, no penalty.)"
                : "Defeated. (Free-play is unranked — no rating lost.)",
    autoJoin: true,
};

export function CardClashFreePlay({ character, setScreen }: { character: Character; setScreen: (s: Screen) => void }) {
    return <CardClashDuelScreen character={character} setScreen={setScreen} config={FREEPLAY_CARD_CONFIG} />;
}
