import { useRef } from "react";
import type { Character } from "../types/character";
import { gameToast } from "../components/GameToast";
import { mutateEndlessRun } from "./endless-api";

type EndlessTowerActionsOptions = {
    character: Character | null;
    commitCharacter: (character: Character, version?: number) => void;
    prepareOpponent: (wave: number) => string;
    enterBattle: (wave: number, opponentId: string) => void;
    advanceBattle: (wave: number, opponentId: string) => void;
    closeBattle: () => void;
};

export function useEndlessTowerActions({
    character,
    commitCharacter,
    prepareOpponent,
    enterBattle,
    advanceBattle,
    closeBattle,
}: EndlessTowerActionsOptions) {
    const actionRef = useRef(false);

    async function startEndlessBattle() {
        if (!character || actionRef.current) return;
        actionRef.current = true;
        try {
            const result = await mutateEndlessRun(character.name, "start");
            if (result.error || !result.character || !result.run) {
                throw new Error(result.error || "The Endless Tower did not return an active run.");
            }
            commitCharacter(result.character, result._saveVersion);
            const wave = Math.max(1, result.run.wave);
            enterBattle(wave, prepareOpponent(wave));
        } catch (error) {
            alert(error instanceof Error ? error.message : "The Endless Tower is unavailable.");
        } finally {
            actionRef.current = false;
        }
    }

    async function handleEndlessWin(
        currentWave: number,
        aiFightToken: string,
        vitals: { hp: number; chakra: number; stamina: number },
    ) {
        const runToken = character?.endlessTowerRun?.runToken;
        if (!character || !runToken || !aiFightToken || actionRef.current) {
            if (!aiFightToken) alert("The fight proof is still being prepared. Try Next Wave again.");
            return;
        }
        actionRef.current = true;
        try {
            const result = await mutateEndlessRun(character.name, "win", {
                runToken,
                aiFightToken,
                wave: currentWave,
                ...vitals,
            });
            if (result.error || !result.character || !result.run) {
                throw new Error(result.error || "The tower could not verify this victory.");
            }
            commitCharacter(result.character, result._saveVersion);
            const milestoneNotices = [
                result.milestone?.boneCharms ? `+${result.milestone.boneCharms} Bone Charms` : "",
                result.milestone?.fateShards ? `+${result.milestone.fateShards} Fate Shards` : "",
                currentWave % 10 === 0 ? "33% HP heal · 50% chakra & stamina refill" : "",
            ].filter(Boolean);
            if (milestoneNotices.length > 0) {
                gameToast(`⭐ ${currentWave}-Kill Milestone! ${milestoneNotices.join(" · ")}.`);
            }
            const nextWave = Math.max(currentWave + 1, result.run.wave);
            advanceBattle(nextWave, prepareOpponent(nextWave));
        } catch (error) {
            alert(error instanceof Error ? error.message : "The tower could not verify this victory.");
            throw error;
        } finally {
            actionRef.current = false;
        }
    }

    async function endEndlessBattle() {
        const runToken = character?.endlessTowerRun?.runToken;
        if (!character || !runToken || actionRef.current) return;
        actionRef.current = true;
        try {
            const result = await mutateEndlessRun(character.name, "abandon", { runToken, death: true });
            if (result.error || !result.character) {
                throw new Error(result.error || "The tower defeat could not be settled.");
            }
            commitCharacter(result.character, result._saveVersion);
            closeBattle();
        } catch (error) {
            alert(error instanceof Error ? error.message : "The tower defeat could not be settled.");
            throw error;
        } finally {
            actionRef.current = false;
        }
    }

    async function bankEndlessRewards() {
        const runToken = character?.endlessTowerRun?.runToken;
        if (!character || !runToken || actionRef.current) return;
        actionRef.current = true;
        try {
            const result = await mutateEndlessRun(character.name, "cashout", { runToken });
            if (result.error || !result.character) {
                throw new Error(result.error || "The tower could not bank this run.");
            }
            commitCharacter(result.character, result._saveVersion);
            closeBattle();
            gameToast(`Tower rewards banked${result.creditedRyo ? `: +${result.creditedRyo.toLocaleString()} ryo` : ""}.`);
        } catch (error) {
            alert(error instanceof Error ? error.message : "The tower could not bank this run.");
        } finally {
            actionRef.current = false;
        }
    }

    return { startEndlessBattle, handleEndlessWin, endEndlessBattle, bankEndlessRewards };
}
