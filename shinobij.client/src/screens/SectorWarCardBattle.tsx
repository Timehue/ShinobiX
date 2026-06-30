import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { CardClashDuelScreen, type CardClashDuelConfig } from "./ClanWarTileCardDuel";

// Sector-war "Card" win-condition battle (Phase 6) — the interactive Shinobi Card
// Clash duel pointed at /api/village/sector-card. Reuses CardClashDuelScreen
// wholesale; the only differences from the clan-war duel are this config + autoJoin
// (sector battles have no separate accept step — the screen joins on entry).
const SECTOR_CARD_CONFIG: CardClashDuelConfig = {
    stashKey: "sectorWarCard.v1",
    endpoint: "/api/village/sector-card",
    title: "Sector War Card Battle",
    backScreen: "villageWarMap",
    backLabel: "← War Map",
    emptyTitle: "⚠ No active sector card battle",
    emptyNote: "The battle context was lost. Return to the War Map.",
    emptyBackLabel: "Back to War Map",
    awaitingNote: "⏳ Waiting for a defender to join the card battle…",
    forfeitConfirm: "Forfeit the card battle? The defender holds the sector.",
    doneNote: (_won, draw) => (draw ? "A draw — Sector Control HP is unchanged." : "Sector Control HP updated."),
    autoJoin: true,
};

export function SectorWarCardBattle({ character, setScreen }: { character: Character; setScreen: (s: Screen) => void }) {
    return <CardClashDuelScreen character={character} setScreen={setScreen} config={SECTOR_CARD_CONFIG} />;
}
