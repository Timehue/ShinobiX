import { useCallback } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { PetDuelReplayScreen } from "../components/PetDuelReplayScreen";
import { activeCarriedPets } from "../lib/entitlements";
import {
    submitClanWarPet,
    clanWarPetState,
    clanWarPetWatch,
    clanWarPetSideOf,
    type ClanWarPetSession,
} from "../lib/clan-war-pet-api";

/*
 * Clan War "Pet" challenge screen (pet1v1 / pet2v2).
 *
 * Both sides field a pet; the server resolves the duel on the SHOWDOWN engine
 * and finalizes the challenge itself (api/clan/war/pet.ts). The decided fight
 * is then WATCHED: the server re-derives its own event log and this screen
 * plays it through the same cinematic arena a live Showdown uses, so what you
 * watch cannot disagree with the recorded outcome. No win/loss is ever
 * reported from here — /api/clan/war/report refuses client-reported pet
 * results outright.
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
            pets={activeCarriedPets(character)}
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
                // The server owns the fight; this screen only plays its script.
                resolved: (s) => s.status === "done" && !!s.from.length && !!s.to.length,
                watch: () => clanWarPetWatch(warId, challengeId),
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
