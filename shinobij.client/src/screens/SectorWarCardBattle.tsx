import { useMemo } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { CardClashDuelScreen, type CardClashDuelConfig } from "./ClanWarTileCardDuel";
import { stashedContestBackScreen, stashedContestIsGarrison } from "../lib/sector-war-engagement";
import {
    SECTOR_CARD_FORFEIT_CONFIRM,
    SECTOR_CARD_GARRISON_FORFEIT_CONFIRM,
    sectorCardDoneNote,
    sectorCardGarrisonDoneNote,
    sectorCardWaitingNote,
    sectorTableBackLabel,
} from "../lib/sector-war-tables";

const SECTOR_CARD_CONFIG: CardClashDuelConfig = {
    stashKey: "sectorWarCard.v1",
    endpoint: "/api/village/sector-card",
    title: "Sector War Chronicle Showdown",
    backScreen: "villageWarMap",
    backLabel: "Back to War Map",
    emptyTitle: "No active sector showdown",
    emptyNote: "The battle context was lost. Return to the War Map.",
    emptyBackLabel: "Back to War Map",
    awaitingNote: "Waiting for the other side of the table.",
    // A defender may open the table before any attacker has: the server tells
    // each viewer which wait it is, and seats them the moment a seat opens.
    waitingNote: sectorCardWaitingNote,
    joinWhenSeatOpens: true,
    forfeitConfirm: SECTOR_CARD_FORFEIT_CONFIRM,
    doneNote: sectorCardDoneNote,
    autoJoin: true,
};

export function SectorWarCardBattle({ character, setScreen, sharedImages = {} }: { character: Character; setScreen: (s: Screen) => void; sharedImages?: Record<string, string> }) {
    // An entry from the world map records its return target beside the stash, so
    // the table sends the player back to the sector they opened it from rather
    // than a War Map they never visited — and says so on its buttons.
    // Garrison mode needs no separate screen: the stash carries `garrison` into
    // every request this screen already makes, and the server answers with the
    // same Chronicle projection. Only the wording changes.
    const config = useMemo(() => {
        const garrison = stashedContestIsGarrison(SECTOR_CARD_CONFIG.stashKey);
        const backScreen = stashedContestBackScreen(SECTOR_CARD_CONFIG.stashKey, SECTOR_CARD_CONFIG.backScreen);
        const backLabel = sectorTableBackLabel(backScreen);
        return {
            ...SECTOR_CARD_CONFIG,
            backScreen,
            backLabel,
            emptyBackLabel: backLabel,
            emptyNote: backScreen === "worldMap"
                ? "The battle context was lost. Return to the world map."
                : SECTOR_CARD_CONFIG.emptyNote,
            ...(garrison ? {
                title: "Sector War — Garrison Assault",
                awaitingNote: "Drawing the garrison's opening hand…",
                // The garrison is fought alone: there is no other seat to wait on.
                waitingNote: undefined,
                joinWhenSeatOpens: false,
                forfeitConfirm: SECTOR_CARD_GARRISON_FORFEIT_CONFIRM,
                doneNote: sectorCardGarrisonDoneNote,
            } : {}),
        };
    }, []);
    return <CardClashDuelScreen character={character} setScreen={setScreen} config={config} sharedImages={sharedImages} />;
}
