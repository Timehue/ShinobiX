import { useCallback } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import type { Pet } from "../types/pet";
import { PetDuelReplayScreen } from "../components/PetDuelReplayScreen";
import type { ShowdownReplayScript } from "../../../shared/pet-showdown-contract";
import { garrisonSectorPet, joinSectorPet, sectorPetState, sectorPetWatch } from "../lib/village-war-map";
import { stashedContestBackScreen, stashedContestIsGarrison, stashedOpenBattleId } from "../lib/sector-war-engagement";
import { useOpenSectorBattleGeneration } from "../lib/use-open-sector-battle";
import { activeCarriedPets } from "../lib/entitlements";
import {
    SECTOR_PET_OPEN_BATTLE_STATUS,
    sectorPetBanner,
    sectorPetNextDuelLabel,
    sectorPetWaiting,
    type SectorWarResult,
} from "../lib/sector-war-tables";

/*
 * Sector War "Pet" win-condition screen (Phase 7). At the war's table the player
 * sends a pet; the attacker opens, a defender answers, and the server resolves a
 * DETERMINISTIC pet duel (api/village/sector-pet → api/_pet-sim, the ported
 * engine). An attack on an enemy standing in the sector is an open-world battle
 * instead (an `engageId` in the stash): both sealed teams fought the moment it
 * was started, and this screen only shows it. Either way the outcome is
 * server-authoritative; this screen REPLAYS the same (pets, seed) so the fight you
 * watch is byte-identical to what the server recorded — it can never disagree on
 * who won. No win/loss is ever reported from here.
 *
 * The picker / submit / poll / replay shell is shared with the Clan War pet
 * challenge (components/PetDuelReplayScreen); only the wording, the endpoints and
 * the engine call below differ.
 */

/** A session as the server projects it to THIS viewer (api/village/sector-pet.ts
 *  projectPetSession): the opener's pet is present only for the opener until
 *  the duel resolves, and `viewerSide` / `canAnswer` say which seat is ours. */
type PetSession = {
    sectorWarId: string;
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    p1: { name: string; pet?: Pet };
    p2?: { name: string; pet?: Pet };
    status: "awaiting-defender" | "done";
    seed?: number;
    winner?: "p1" | "p2" | "draw";
    terrain?: string | null;   // sealed by the server → the replay applies the same home-ground element bonus
    garrison?: boolean;
    viewerSide?: "p1" | "p2" | null;
    canAnswer?: boolean;
    warResult?: SectorWarResult;
};

type SectorWarPetBattleProps = { character: Character; setScreen: (s: Screen) => void };

export function SectorWarPetBattle(props: SectorWarPetBattleProps) {
    // A new open battle for a player already on this screen remounts the battle,
    // so it shows the one they were just drawn into, not the one before it.
    const generation = useOpenSectorBattleGeneration("sectorWarPet.v1");
    return <SectorWarPetBattleView key={generation} {...props} />;
}

function SectorWarPetBattleView({ character, setScreen }: SectorWarPetBattleProps) {
    const sectorWarId = (() => {
        try { return String((JSON.parse(sessionStorage.getItem("sectorWarPet.v1") ?? "{}") as { sectorWarId?: string }).sectorWarId ?? ""); } catch { return ""; }
    })();
    // A duel opened from the world map returns to the world map; the War Map's
    // own launch records no return target and keeps the historical default.
    const backScreen = stashedContestBackScreen("sectorWarPet.v1", "villageWarMap");
    // Garrison mode: no defender ever answered, so the defending village's
    // sealed team holds the sector instead. Resolves in the same one call.
    const garrison = stashedContestIsGarrison("sectorWarPet.v1");
    // An open-world battle: one side attacked the other in the sector, and both
    // sealed teams fought then and there. There is nothing to pick, only the
    // battle to watch, and no next duel at a table this player never sat at.
    const engageId = stashedOpenBattleId("sectorWarPet.v1");
    const back = useCallback(() => setScreen(backScreen), [setScreen, backScreen]);
    const me = character.name;

    return (
        <PetDuelReplayScreen<PetSession>
            pets={activeCarriedPets(character)}
            config={{
                title: engageId ? "Pet Battle — Sector War" : "Pet Duel — Sector War",
                intro: "Send a pet to fight for this sector. The duel resolves server-side and replays here.",
                missingText: "No pet duel selected.",
                backLabel: "← Back",
                onBack: back,
                ready: !!sectorWarId,
                submitLabel: "Send into battle",
                submitErrorText: "Could not start the pet duel.",
                fetchState: async () => ((await sectorPetState(character.name, sectorWarId, garrison, engageId)) as { session?: PetSession }).session ?? null,
                submit: (petId) => (garrison
                    ? garrisonSectorPet(character.name, sectorWarId, petId)
                    : joinSectorPet(character.name, sectorWarId, petId)) as Promise<{ session?: PetSession; error?: string }>,
                // The server re-derives the decided fight into a script; this
                // screen only plays it. The sector's terrain arrives as the
                // arena's standing weather, so the home ground is on screen.
                resolved: (s) => s.status === "done" && !!s.p2 && s.seed != null,
                watch: async () => {
                    const r = await sectorPetWatch(character.name, sectorWarId, garrison, engageId) as { script?: ShowdownReplayScript };
                    return r.script ?? null;
                },
                banner: (s) => sectorPetBanner(s, me),
                // Only the attacker who opened the duel waits on it; a defender
                // gets the picker and answers. Everyone used to get the waiting card.
                waiting: (s) => sectorPetWaiting(s, me),
                // A decided duel is not the end of the table.
                nextDuel: (s) => (engageId ? null : sectorPetNextDuelLabel(s, garrison)),
                ...(engageId ? { pickerless: SECTOR_PET_OPEN_BATTLE_STATUS } : {}),
            }}
        />
    );
}
