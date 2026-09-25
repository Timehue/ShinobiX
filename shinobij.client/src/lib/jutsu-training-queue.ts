import { useEffect, useRef } from "react";
import { JUTSU_TRAINING_CAP, jutsuLevelCapForLevel } from "../constants/game";
import type { Character, VersionedCharacterCommit } from "../types/character";
import type { ActiveJutsuTraining } from "../types/combat";
import { mutateJutsuRyoTraining } from "./jutsu-ryo-api";
import { isServerSettlementReady } from "./server-settlement-gate";
import { serverNow } from "./server-clock";

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
    commitCharacter: VersionedCharacterCommit,
): void {
    // App's commitVersionedCharacter is a new function every render. With it in
    // the deps, each re-render cancelled a due lesson's request, dropped the
    // reply, reset the backoff and asked again, spending the jutsu-ryo budget.
    const commitRef = useRef(commitCharacter);
    useEffect(() => { commitRef.current = commitCharacter; }, [commitCharacter]);
    useEffect(() => {
        if (!isServerSettlementReady("timedJutsuTrainingQueue")) return;
        if (!activeJutsuTraining?.next && !activeJutsuTraining?.autoClaim) return;
        if (!playerName || !activeJutsuTraining.serverToken) return;
        let cancelled = false;
        let timer = 0;
        let failures = 0;
        const reconcile = async () => {
            const result = await mutateJutsuRyoTraining(playerName, "advance", { serverToken: activeJutsuTraining.serverToken });
            if (cancelled) return;
            if (!result.character) {
                // Back off 10s → 20s → 40s → 60s cap. A flat 10s retry against a
                // queue the server keeps refusing spent most of the 20/min jutsu-ryo
                // budget the Training screen's own buttons share; the cap stays
                // short so a due lesson settles within a minute of a deploy ending.
                const delay = Math.min(60_000, 10_000 * 2 ** failures);
                failures += 1;
                timer = window.setTimeout(() => { void reconcile(); }, delay);
                return;
            }
            if (!commitRef.current(result.character, result._saveVersion)) return;
            setActiveJutsuTraining(result.activeJutsuTraining ?? null);
        };
        // The first heartbeat may correct the clock after this effect mounts.
        // Re-check locally while waiting; only ask the server once the lesson
        // is due. A device clock change cannot advance or delay the queue.
        const waitUntilDue = () => {
            if (cancelled) return;
            const remaining = activeJutsuTraining.endsAt - serverNow();
            if (remaining <= 0) { void reconcile(); return; }
            timer = window.setTimeout(waitUntilDue, Math.min(1000, remaining + 50));
        };
        timer = window.setTimeout(waitUntilDue, 250);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [playerName, activeJutsuTraining, setActiveJutsuTraining]);
}
