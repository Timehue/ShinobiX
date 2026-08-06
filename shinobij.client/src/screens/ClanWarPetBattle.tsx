import { useCallback } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { runPetDuelCinematic, runPetPartyDuelCinematic } from "../lib/pet-duel-cinematic";
import { PetDuelReplayScreen, type PetDuelReplayView } from "../components/PetDuelReplayScreen";
import {
    submitClanWarPet,
    clanWarPetState,
    clanWarPetSideOf,
    CLAN_WAR_PET_DUEL,
    type ClanWarPetSession,
} from "../lib/clan-war-pet-api";

/*
 * Clan War "Pet" challenge screen (pet1v1 / pet2v2).
 *
 * Both sides field a pet; the server resolves the DETERMINISTIC duel and finalizes
 * the challenge itself (api/clan/war/pet.ts → api/_pet-sim, the parity-guarded
 * mirror of this very engine). This screen REPLAYS the same (pets, seed, pinned
 * params) so the fight it animates cannot disagree with the recorded outcome. No
 * win/loss is ever reported from here — /api/clan/war/report refuses
 * client-reported pet results outright.
 */

type Stash = {
    warId?: string;
    challengeId?: string;
    fromPlayer?: string;
    fromPlayer2?: string | null;
    acceptedPlayer?: string | null;
    acceptedPlayer2?: string | null;
};

export function ClanWarPetBattle({ character, setScreen }: { character: Character; setScreen: (s: Screen) => void }) {
    const stash: Stash = (() => {
        try { return JSON.parse(sessionStorage.getItem("clanWarChallenge.v1") ?? "{}") as Stash; } catch { return {}; }
    })();
    const warId = String(stash.warId ?? "");
    const challengeId = String(stash.challengeId ?? "");
    const mySide = clanWarPetSideOf(character.name, stash);
    const back = useCallback(() => setScreen("clan"), [setScreen]);

    return (
        <PetDuelReplayScreen<ClanWarPetSession>
            pets={character.pets}
            config={{
                title: "🐾 Clan War Pet Battle",
                intro: "Send a pet to fight for your clan. The battle is resolved by the server and replays here — no result is reported from your client.",
                missingText: "No clan-war pet battle selected.",
                backLabel: "← Back to Clan Hall",
                onBack: back,
                ready: !!warId && !!challengeId,
                submitLabel: "Send into battle",
                submitErrorText: "Could not send your pet into battle.",
                fetchState: async () => (await clanWarPetState(warId, challengeId)).session ?? null,
                submit: (petId) => submitClanWarPet(warId, challengeId, petId),
                // MUST mirror api/clan/war/_pet-duel.ts resolveClanWarPetDuel exactly —
                // this replay reproduces the winner the server already recorded.
                replay: (s): PetDuelReplayView | null => {
                    if (s.status !== "done" || !s.from.length || !s.to.length) return null;
                    const p = CLAN_WAR_PET_DUEL;
                    const result = s.mode === "pet2v2"
                        ? runPetPartyDuelCinematic(
                            s.from[0].pet, s.from[1]?.pet ?? null,
                            s.to[0].pet, s.to[1]?.pet ?? null,
                            s.seed, p.damageMult, p.hpMult, p.reviveOnce, p.applyItems, p.accuracy,
                        )
                        : runPetDuelCinematic(
                            s.from[0].pet, s.to[0].pet,
                            s.seed, p.damageMult, p.hpMult, p.reviveOnce, p.applyItems, p.accuracy, p.terrain,
                        );
                    return { playerPet: s.from[0].pet, enemyPet: s.to[0].pet, seed: s.seed, result };
                },
                banner: (s) => s.winner === "draw"
                    ? "The pet battle ended in a draw — no clan-war damage."
                    : mySide && s.winner === `${mySide}-wins`
                        ? "🏆 Your pets took the battle — the enemy clan takes damage!"
                        : mySide
                            ? "Your pets were defeated."
                            : `${s.winner === "from-wins" ? "The challenging clan" : "The defending clan"} took the battle.`,
                waiting: (s) => {
                    const mine = mySide === "to" ? s.to : s.from;
                    const needed = s.mode === "pet2v2" ? 2 : 1;
                    if (s.status === "done" || mine.length < needed) return null;
                    return {
                        headline: `⏳ Waiting for the opposing clan to send ${needed > 1 ? "their pets" : "their pet"}…`,
                        detail: `${mine.map((f) => f.pet?.name).filter(Boolean).join(" & ")} stands ready. The battle resolves on the server the moment they answer, then replays here.`,
                    };
                },
            }}
        />
    );
}
