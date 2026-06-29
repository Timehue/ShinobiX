/*
 * Jutsu training QUEUE — lets a 2nd ryo training be lined up behind the active one
 * (ActiveJutsuTraining.next) so it auto-starts the instant the first completes.
 *
 *   • jutsuRyoTrainCap         — ryo-training ceiling = min(Hall cap 30, rank cap)
 *   • applyJutsuTrainingLevel  — grant a trained level (rank-capped, never downgrades)
 *   • advanceJutsuTrainingQueue — pure timeline-settler (grants + back-dated promote)
 *   • useJutsuTrainingQueueRunner — global 1s watcher that runs the settler
 *
 * Ryo for the queued level is paid up-front and its duration is locked at queue
 * time (Training.tsx), so promotion is a pure client-side state move — matching the
 * existing client-authoritative ryo-training flow (no server endpoint). Because the
 * timer only ticks while a client is open, promotion is BACK-DATED to when the
 * active run actually ended (not the login moment): offline time counts, so a
 * returning player collects everything they queued without re-logging just to
 * advance/claim it. See advanceJutsuTrainingQueue for the exact rules.
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

// Result of evaluating the queue at a point in time: the jutsu levels to grant
// (IN ORDER — the same jutsu can appear twice when both runs train it, so they
// must be applied left-to-right via the non-downgrading grant), and the resulting
// active training (the back-dated promotion, or null once everything has
// completed and the training slot is free again).
export type JutsuTrainingAdvance = {
    grants: Array<{ jutsuId: string; toLevel: number }>;
    active: ActiveJutsuTraining | null;
};

// Pure core of the runner. Walks the active training's REAL (absolute-timestamp)
// timeline as far as `now` has actually reached:
//   • A finished training grants its level.
//   • A queued `.next` is promoted BACK-DATED to when the active one truly ended
//     (startedAt = active.endsAt), NOT to `now`. This is the fix for the "queue
//     doesn't restart until login" bug: ryo training is client-authoritative, so
//     while the player is logged out nothing ticks — but the timestamps are saved,
//     so on the next login we credit the time that already passed instead of
//     restarting the 2nd training's countdown from the login moment (which wasted
//     the whole offline gap and forced yet another login to claim it).
//   • The promotion is flagged `autoClaim`, so if it has ALSO already elapsed
//     (a long absence) it is granted in this same pass and the slot is freed —
//     and if it is still mid-flight it will be auto-granted on a later tick/login
//     rather than requiring a manual claim.
// Idempotent: once everything is settled it returns no grants and a stable (or
// null) active. The loop fully resolves a multi-step gap in a single call; the
// queue is depth-1 so 2 iterations is the real max (the cap is just a backstop).
export function advanceJutsuTrainingQueue(
    active: ActiveJutsuTraining | null,
    now: number,
): JutsuTrainingAdvance {
    const grants: Array<{ jutsuId: string; toLevel: number }> = [];
    let cur: ActiveJutsuTraining | null = active;
    for (let i = 0; cur && i < 8; i++) {
        if (now < cur.endsAt) break; // not finished yet — nothing more has elapsed
        const q = cur.next;
        if (!q) {
            // A lone, finished, auto-claiming training (a promoted 2nd run): grant
            // it and free the slot. A non-autoClaim lone training is left untouched
            // — manually-started single trainings still claim by hand as before.
            if (cur.autoClaim) {
                grants.push({ jutsuId: cur.jutsuId, toLevel: cur.toLevel });
                cur = null;
            }
            break;
        }
        // Finished AND a queue exists: grant the finished level, then promote the
        // queued run back-dated to the instant the active one actually ended.
        grants.push({ jutsuId: cur.jutsuId, toLevel: cur.toLevel });
        const startedAt = cur.endsAt;
        cur = {
            jutsuId: q.jutsuId,
            label: q.label,
            fromLevel: q.fromLevel,
            toLevel: q.toLevel,
            ryoCost: q.ryoCost,
            startedAt,
            endsAt: startedAt + Math.max(0, q.durationMs),
            next: null,
            autoClaim: true,
        };
        // Loop: the promoted run may itself already be complete (long absence).
    }
    return { grants, active: cur };
}

// Global watcher: while the active ryo training has a queued `.next` OR is an
// auto-claiming promotion, settle the real timeline (grant finished levels,
// promote/finish the queue) every second and once immediately on mount — so a
// reload or login AFTER the timer(s) elapsed still advances. The (pure,
// unit-tested) decision lives in advanceJutsuTrainingQueue; grants are applied
// in order via the clamped non-downgrading helper, so this stays idempotent.
export function useJutsuTrainingQueueRunner(
    activeJutsuTraining: ActiveJutsuTraining | null,
    setActiveJutsuTraining: (t: ActiveJutsuTraining | null) => void,
    setCharacter: Dispatch<SetStateAction<Character | null>>,
): void {
    useEffect(() => {
        if (!activeJutsuTraining?.next && !activeJutsuTraining?.autoClaim) return;
        const advance = () => {
            const { grants, active } = advanceJutsuTrainingQueue(activeJutsuTraining, Date.now());
            if (!grants.length) return; // nothing finished yet — no state churn
            for (const g of grants) {
                setCharacter((prev) => (prev ? applyJutsuTrainingLevel(prev, g.jutsuId, g.toLevel) : prev));
            }
            setActiveJutsuTraining(active);
        };
        advance();
        const id = setInterval(advance, 1000);
        return () => clearInterval(id);
    }, [activeJutsuTraining, setActiveJutsuTraining, setCharacter]);
}
