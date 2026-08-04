import { useRef, useState } from "react";
import type { Character } from "../types/character";
import { gameToast } from "../components/GameToast";
import {
    mutateEndlessRun,
    startEndlessWave,
    type EndlessMutationResult,
    type EndlessWaveStartResult,
} from "./endless-api";

export type EndlessServerFight = EndlessWaveStartResult & { runToken: string };

type EndlessTowerActionsOptions = {
    character: Character | null;
    commitCharacter: (character: Character, version?: number) => void;
};

export function useEndlessTowerActions({ character, commitCharacter }: EndlessTowerActionsOptions) {
    const actionRef = useRef(false);
    const settlePromisesRef = useRef(new Map<string, Promise<EndlessMutationResult>>());
    const [endlessFight, setEndlessFight] = useState<EndlessServerFight | null>(null);

    async function openWave(playerName: string, runToken: string) {
        const started = await startEndlessWave(playerName, runToken);
        setEndlessFight({ ...started, runToken });
    }

    async function startEndlessBattle() {
        if (!character || actionRef.current) return;
        actionRef.current = true;
        try {
            const result = await mutateEndlessRun(character.name, "start");
            if (result.error || !result.character || !result.run?.runToken) {
                throw new Error(result.error || "The Endless Tower did not return an active run.");
            }
            commitCharacter(result.character, result._saveVersion);
            await openWave(character.name, result.run.runToken);
        } catch (error) {
            alert(error instanceof Error ? error.message : "The Endless Tower is unavailable.");
        } finally {
            actionRef.current = false;
        }
    }

    function settleEndlessFight(waveRunId: string, playerName: string): Promise<EndlessMutationResult> {
        const existing = settlePromisesRef.current.get(waveRunId);
        if (existing) return existing;
        const fight = endlessFight;
        if (!fight || fight.runId !== waveRunId) {
            return Promise.reject(new Error("The active Endless wave no longer matches this fight."));
        }
        const promise = mutateEndlessRun(playerName, "settle", {
            runToken: fight.runToken,
            waveRunId,
        }).then((result) => {
            if (result.error || !result.character || !result.outcome) {
                throw new Error(result.error || "The tower could not verify this wave.");
            }
            commitCharacter(result.character, result._saveVersion);
            if (result.outcome === "win") {
                const notices = [
                    result.milestone?.boneCharms ? `+${result.milestone.boneCharms} Bone Charms` : "",
                    result.milestone?.fateShards ? `+${result.milestone.fateShards} Fate Shards` : "",
                    fight.wave % 10 === 0 ? "33% HP heal · 50% chakra & stamina refill" : "",
                ].filter(Boolean);
                if (notices.length > 0) gameToast(`⭐ ${fight.wave}-Kill Milestone! ${notices.join(" · ")}.`);
            }
            return result;
        }).catch((error) => {
            settlePromisesRef.current.delete(waveRunId);
            throw error;
        });
        settlePromisesRef.current.set(waveRunId, promise);
        return promise;
    }

    async function nextEndlessWave() {
        if (!character || !endlessFight || actionRef.current) return;
        actionRef.current = true;
        try {
            await openWave(character.name, endlessFight.runToken);
        } catch (error) {
            alert(error instanceof Error ? error.message : "The next Endless wave could not start.");
        } finally {
            actionRef.current = false;
        }
    }

    async function bankEndlessRewards() {
        const runToken = endlessFight?.runToken ?? character?.endlessTowerRun?.runToken;
        if (!character || !runToken || actionRef.current) return;
        actionRef.current = true;
        try {
            const result = await mutateEndlessRun(character.name, "cashout", { runToken });
            if (result.error || !result.character) throw new Error(result.error || "The tower could not bank this run.");
            commitCharacter(result.character, result._saveVersion);
            setEndlessFight(null);
            gameToast(`Tower rewards banked${result.creditedRyo ? `: +${result.creditedRyo.toLocaleString()} ryo` : ""}.`);
        } catch (error) {
            alert(error instanceof Error ? error.message : "The tower could not bank this run.");
        } finally {
            actionRef.current = false;
        }
    }

    function closeEndlessFight() {
        setEndlessFight(null);
    }

    return {
        endlessFight,
        startEndlessBattle,
        settleEndlessFight,
        nextEndlessWave,
        bankEndlessRewards,
        closeEndlessFight,
    };
}
