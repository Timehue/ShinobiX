/*
 * Jutsu training QUEUE — lets a 2nd ryo training be lined up behind the active one
 * (ActiveJutsuTraining.next) so it auto-starts the instant the first completes.
 *
 *   • jutsuRyoTrainCap         — ryo-training ceiling = min(Hall cap 30, rank cap)
 *   • applyJutsuTrainingLevel  — grant a trained level (rank-capped, never downgrades)
 *   • useJutsuTrainingQueueRunner — global 1s watcher that promotes the queue
 *
 * Ryo for the queued level is paid up-front and its duration is locked at queue
 * time (Training.tsx), so promotion is a pure client-side state move — matching the
 * existing client-authoritative ryo-training flow (no server endpoint).
 */
import { useEffect, type Dispatch, type SetStateAction } from "react";
import { JUTSU_TRAINING_CAP, jutsuLevelCapForLevel } from "../constants/game";
import type { Character } from "../types/character";
import type { ActiveJutsuTraining } from "../types/combat";

// Ryo training (the Hall) tops out at level 30, but never above the player's rank
// jutsu cap — a Genin (cap 20) can't ryo-train a jutsu past 20 even though the Hall
// would otherwise allow 30. Keeps STORED mastery in step with what combat can use.
export function jutsuRyoTrainCap(level: number): number {
    return Math.min(JUTSU_TRAINING_CAP, jutsuLevelCapForLevel(level));
}

// Grant a trained jutsu level. Clamped to the ryo cap, and never DOWNGRADES a jutsu
// already above it (grandfathered saves from before the rank cap) — it only raises.
export function applyJutsuTrainingLevel(character: Character, jutsuId: string, level: number): Character {
    const cap = jutsuRyoTrainCap(Number(character.level) || 1);
    const existing = character.jutsuMastery?.length ? character.jutsuMastery : [];
    const current = existing.find((m) => m.jutsuId === jutsuId)?.level ?? 0;
    const next = Math.max(current, Math.min(cap, Math.floor(level)));
    return {
        ...character,
        jutsuMastery: [...existing.filter((m) => m.jutsuId !== jutsuId), { jutsuId, level: next, xp: 0 }],
    };
}

// Global watcher: when the active ryo training has a queued `.next` AND its timer
// is up, grant the finished level and promote the queue to active (ryo already
// paid, duration locked). Runs only while a queue exists, and re-checks once
// immediately so a reload AFTER the timer elapsed still advances. Idempotent: the
// granted level is clamped/non-downgrading and the promoted training carries no
// `.next`, so the effect goes inert until a new 2nd training is queued.
export function useJutsuTrainingQueueRunner(
    activeJutsuTraining: ActiveJutsuTraining | null,
    setActiveJutsuTraining: (t: ActiveJutsuTraining | null) => void,
    setCharacter: Dispatch<SetStateAction<Character | null>>,
): void {
    useEffect(() => {
        if (!activeJutsuTraining?.next) return;
        const advance = () => {
            const at = activeJutsuTraining;
            const q = at.next;
            if (!q || Date.now() < at.endsAt) return;
            setCharacter((prev) => (prev ? applyJutsuTrainingLevel(prev, at.jutsuId, at.toLevel) : prev));
            const now = Date.now();
            setActiveJutsuTraining({
                jutsuId: q.jutsuId,
                label: q.label,
                fromLevel: q.fromLevel,
                toLevel: q.toLevel,
                ryoCost: q.ryoCost,
                startedAt: now,
                endsAt: now + Math.max(0, q.durationMs),
                next: null,
            });
        };
        advance();
        const id = setInterval(advance, 1000);
        return () => clearInterval(id);
    }, [activeJutsuTraining, setActiveJutsuTraining, setCharacter]);
}
