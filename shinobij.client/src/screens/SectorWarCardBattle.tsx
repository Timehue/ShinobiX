import { useMemo } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { CardClashDuelScreen, type CardClashDuelConfig } from "./ClanWarTileCardDuel";
import { stashedContestBackScreen, stashedContestIsGarrison } from "../lib/sector-war-engagement";

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
    forfeitConfirm: "Forfeit the showdown? Your side scores nothing for this fight.",
    doneNote: (won, draw) => draw ? "A technical draw scores nothing for either side." : won ? "The server scored this win for your side of the war." : "The server scored this win for the enemy side of the war.",
    autoJoin: true,
};

export function SectorWarCardBattle({ character, setScreen, sharedImages = {} }: { character: Character; setScreen: (s: Screen) => void; sharedImages?: Record<string, string> }) {
    // An entry from the world map records its return target beside the stash, so
    // the table sends the player back to the sector they opened it from rather
    // than a War Map they never visited.
    // Garrison mode needs no separate screen: the stash carries `garrison` into
    // every request this screen already makes, and the server answers with the
    // same Chronicle projection. Only the wording changes.
    const config = useMemo(() => {
        const garrison = stashedContestIsGarrison(SECTOR_CARD_CONFIG.stashKey);
        return {
            ...SECTOR_CARD_CONFIG,
            backScreen: stashedContestBackScreen(SECTOR_CARD_CONFIG.stashKey, SECTOR_CARD_CONFIG.backScreen),
            ...(garrison ? {
                title: "Sector War \u2014 Garrison Assault",
                awaitingNote: "Drawing the garrison's opening hand\u2026",
                forfeitConfirm: "Withdraw from the garrison? Your side scores nothing for this fight.",
                doneNote: (won: boolean, draw: boolean) => draw
                    ? "A technical draw scores nothing for either side."
                    : won
                        ? "You broke the garrison. The server scored it for your side at garrison weight."
                        : "The garrison held. The server scored this win for the defence.",
            } : {}),
        };
    }, []);
    return <CardClashDuelScreen character={character} setScreen={setScreen} config={config} sharedImages={sharedImages} />;
}
