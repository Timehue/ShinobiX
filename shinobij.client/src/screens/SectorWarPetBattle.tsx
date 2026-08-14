import { useCallback } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import type { Pet } from "../types/pet";
import { runDoctrineDuel, parseDoctrine } from "../lib/pet-duel-doctrine";
import { PetDuelReplayScreen, type PetDuelReplayView } from "../components/PetDuelReplayScreen";
import { joinSectorPet, sectorPetState } from "../lib/village-war-map";
import { activeCarriedPets } from "../lib/entitlements";

/*
 * Sector War "Pet" win-condition screen (Phase 7). The player sends a pet; the
 * attacker opens, a defender answers, and the server resolves a DETERMINISTIC pet
 * duel (api/village/sector-pet → api/_pet-sim, the ported engine). The outcome is
 * server-authoritative; this screen REPLAYS the same (pets, seed) so the fight you
 * watch is byte-identical to what the server recorded — it can never disagree on
 * who won. No win/loss is ever reported from here.
 *
 * The picker / submit / poll / replay shell is shared with the Clan War pet
 * challenge (components/PetDuelReplayScreen); only the wording, the endpoints and
 * the engine call below differ.
 */

type PetSession = {
    sectorWarId: string;
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    p1: { name: string; pet: Pet };
    p2?: { name: string; pet: Pet };
    status: "awaiting-defender" | "done";
    seed?: number;
    winner?: "p1" | "p2" | "draw";
    terrain?: string | null;   // sealed by the server → the replay applies the same home-ground element bonus
};

export function SectorWarPetBattle({ character, setScreen }: { character: Character; setScreen: (s: Screen) => void }) {
    const sectorWarId = (() => {
        try { return String((JSON.parse(sessionStorage.getItem("sectorWarPet.v1") ?? "{}") as { sectorWarId?: string }).sectorWarId ?? ""); } catch { return ""; }
    })();
    const back = useCallback(() => setScreen("villageWarMap"), [setScreen]);
    const me = character.name.toLowerCase();

    return (
        <PetDuelReplayScreen<PetSession>
            pets={activeCarriedPets(character)}
            config={{
                title: "🐾 Pet Duel — Sector War",
                intro: "Send a pet to fight for this sector. The duel resolves server-side and replays here.",
                missingText: "No pet duel selected.",
                backLabel: "← Back",
                onBack: back,
                ready: !!sectorWarId,
                submitLabel: "Send into battle",
                submitErrorText: "Could not start the pet duel.",
                fetchState: async () => ((await sectorPetState(character.name, sectorWarId)) as { session?: PetSession }).session ?? null,
                submit: (petId) => joinSectorPet(character.name, sectorWarId, petId) as Promise<{ session?: PetSession; error?: string }>,
                // MUST mirror api/village/sector-pet.ts exactly — both garrisons fight to
                // their own standing orders (plan §11), and this replay has to reproduce
                // the winner the server already recorded, byte for byte.
                replay: (s): PetDuelReplayView | null => {
                    if (s.status !== "done" || !s.p2 || s.seed == null) return null;
                    const result = runDoctrineDuel(
                        s.p1.pet, s.p2.pet, s.seed,
                        parseDoctrine(s.p1.pet.doctrine),
                        parseDoctrine(s.p2.pet.doctrine),
                        { applyItems: false, accuracy: false, terrain: s.terrain ?? null },
                    );
                    return { playerPet: s.p1.pet, enemyPet: s.p2.pet, seed: s.seed, result };
                },
                banner: (s) => {
                    const mine = me === s.p1.name.toLowerCase() ? "p1"
                        : s.p2 && me === s.p2.name.toLowerCase() ? "p2" : null;
                    return s.winner === "draw" ? "The pet duel ended in a draw — the sector holds."
                        : mine && s.winner === mine ? "🏆 Your pet won the sector duel!"
                        : mine ? "Your pet was defeated."
                        : `${s.winner === "p1" ? s.attackerVillage : s.defenderVillage} took the duel.`;
                },
                waiting: (s) => s.status === "awaiting-defender"
                    ? {
                        headline: "⏳ Waiting for a defender to answer with their pet…",
                        detail: `Your pet ${s.p1.pet?.name} stands ready.`,
                    }
                    : null,
            }}
        />
    );
}
