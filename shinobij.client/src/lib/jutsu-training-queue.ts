import { useEffect, type Dispatch, type SetStateAction } from "react";
import { JUTSU_TRAINING_CAP, jutsuLevelCapForLevel } from "../constants/game";
import type { Character } from "../types/character";
import type { ActiveJutsuTraining } from "../types/combat";
import { mutateJutsuRyoTraining } from "./jutsu-ryo-api";
import { isServerSettlementReady } from "./server-settlement-gate";

export function jutsuRyoTrainCap(level: number): number {
    return Math.min(JUTSU_TRAINING_CAP, jutsuLevelCapForLevel(level));
}

export function applyJutsuTrainingLevel(character: Character, jutsuId: string, level: number): Character {
    const cap = jutsuRyoTrainCap(Number(character.level) || 1);
    const existing = character.jutsuMastery?.length ? character.jutsuMastery : [];
    const current = existing.find((mastery) => mastery.jutsuId === jutsuId)?.level ?? 0;
    const next = Math.max(current, Math.min(cap, Math.floor(level)));
    return {
        ...character,
        jutsuMastery: [...existing.filter((mastery) => mastery.jutsuId !== jutsuId), { jutsuId, level: next, xp: 0 }],
    };
}

export type JutsuTrainingAdvance = {
    grants: Array<{ jutsuId: string; toLevel: number }>;
    active: ActiveJutsuTraining | null;
};

// Kept as a pure compatibility helper for legacy-save tests. Shipped clients
// never apply these grants; the hook below asks the locked server mutation to
// promote and settle the queue.
export function advanceJutsuTrainingQueue(
    active: ActiveJutsuTraining | null,
    now: number,
): JutsuTrainingAdvance {
    const grants: Array<{ jutsuId: string; toLevel: number }> = [];
    let current: ActiveJutsuTraining | null = active;
    for (let step = 0; current && step < 8; step += 1) {
        if (now < current.endsAt) break;
        const queued = current.next;
        if (!queued) {
            if (current.autoClaim) {
                grants.push({ jutsuId: current.jutsuId, toLevel: current.toLevel });
                current = null;
            }
            break;
        }
        grants.push({ jutsuId: current.jutsuId, toLevel: current.toLevel });
        const startedAt = current.endsAt;
        current = {
            serverToken: queued.serverToken,
            jutsuId: queued.jutsuId,
            label: queued.label,
            fromLevel: queued.fromLevel,
            toLevel: queued.toLevel,
            ryoCost: queued.ryoCost,
            startedAt,
            endsAt: startedAt + Math.max(0, queued.durationMs),
            next: null,
            autoClaim: true,
        };
    }
    return { grants, active: current };
}

export function useJutsuTrainingQueueRunner(
    playerName: string,
    activeJutsuTraining: ActiveJutsuTraining | null,
    setActiveJutsuTraining: (training: ActiveJutsuTraining | null) => void,
    setCharacter: Dispatch<SetStateAction<Character | null>>,
): void {
    useEffect(() => {
        if (!isServerSettlementReady("timedJutsuTrainingQueue")) return;
        if (!activeJutsuTraining?.next && !activeJutsuTraining?.autoClaim) return;
        if (!playerName || !activeJutsuTraining.serverToken) return;
        let cancelled = false;
        let timer = 0;
        const reconcile = async () => {
            const result = await mutateJutsuRyoTraining(playerName, "advance", { serverToken: activeJutsuTraining.serverToken });
            if (cancelled) return;
            if (!result.character) {
                timer = window.setTimeout(() => { void reconcile(); }, 10_000);
                return;
            }
            setCharacter(result.character);
            setActiveJutsuTraining(result.activeJutsuTraining ?? null);
        };
        const delay = Math.max(250, activeJutsuTraining.endsAt - Date.now() + 250);
        timer = window.setTimeout(() => { void reconcile(); }, delay);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [playerName, activeJutsuTraining, setActiveJutsuTraining, setCharacter]);
}
