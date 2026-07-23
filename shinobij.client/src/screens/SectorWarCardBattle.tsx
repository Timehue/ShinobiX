import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { CardClashDuelScreen, type CardClashDuelConfig } from "./ClanWarTileCardDuel";

const SECTOR_CARD_CONFIG: CardClashDuelConfig = {
    stashKey: "sectorWarCard.v1",
    endpoint: "/api/village/sector-card",
    title: "Sector War Chronicle Showdown",
    backScreen: "villageWarMap",
    backLabel: "Back to War Map",
    emptyTitle: "No active sector showdown",
    emptyNote: "The battle context was lost. Return to the War Map.",
    emptyBackLabel: "Back to War Map",
    awaitingNote: "Waiting for the defending challenger to join.",
    forfeitConfirm: "Forfeit the showdown? The defender holds the sector.",
    doneNote: (_won, draw) => draw ? "Sector Control HP is unchanged after a technical draw." : "The server applied the Sector Control result once.",
    autoJoin: true,
};

export function SectorWarCardBattle({ character, setScreen, sharedImages = {} }: { character: Character; setScreen: (s: Screen) => void; sharedImages?: Record<string, string> }) {
    return <CardClashDuelScreen character={character} setScreen={setScreen} config={SECTOR_CARD_CONFIG} sharedImages={sharedImages} />;
}
