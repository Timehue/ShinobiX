import { useEffect, useState } from "react";
import { loadQuestLines, type QuestLinesList } from "./quest-lines-api";

/**
 * The player's quest lines, read once when a map opens (level 75 or higher).
 * A quest panel that reads the list again hands the newer copy to the setter.
 */
export function useQuestLines(playerName: string, enabled: boolean) {
    const [list, setList] = useState<QuestLinesList | null>(null);
    useEffect(() => {
        if (!enabled) return;
        let live = true;
        void loadQuestLines(playerName).then(next => { if (live && next) setList(next); });
        return () => { live = false; };
    }, [playerName, enabled]);
    return [list, setList] as const;
}

/**
 * The boat to the Unmapped Coast, as one more landmark on the home atlas: on the
 * water off the Stormveil piers. It is moored from level 75 and sails once the
 * first quest line is done. Drawing it decides nothing; the server decides the
 * crossing (api/_coast-admission.ts).
 */
export const BOAT_LANDMARK = { name: "The Shuttered Boat", type: "boat", biome: "central" as const, x: 6, y: 90, art: "/coast-map/boats/shuttered-boat-home-v1.webp" };

/** What a player is told when they try the boat before it will sail. */
export function mooredBoatToast() {
    return { id: Date.now(), kicker: "The shuttered boat", text: "Her hatches are shut, and nobody on the pier will say why. A Wandering Sage may have noticed more." };
}

/**
 * True while the Wandering Sage carries a quest the player has not taken (The Shuttered Boat). He has no
 * counter: until it is taken he stands in the home map's field sectors and offers it himself, beside his
 * Legacy offer when that is waiting too.
 */
export function coastSageWaiting(list: QuestLinesList | null): boolean {
    return !!list?.lines.some(line => line.state === "open" && line.giver === "wandering-sage");
}

/** True when a quest has something to do in this sector: a step, a remake, or an offer. */
export function questStepHere(list: QuestLinesList | null, sector: number | null): boolean {
    if (!list || sector === null) return false;
    return list.lines.some(line =>
        (line.state === "active" && (line.stage?.place?.sector === sector || line.remake?.place?.sector === sector))
        || (line.state === "open" && line.offerAt?.sector === sector));
}
