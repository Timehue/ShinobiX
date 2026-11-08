import { useCallback, useState } from "react";
import type { BossFormView } from "../../../shared/boss-transformations";

function seenKey(sessionId: string): string {
    return `bossFormSeen.v1:${sessionId}`;
}

function readSeen(sessionId: string): number {
    try {
        return Number(window.sessionStorage.getItem(seenKey(sessionId))) || 0;
    } catch {
        return 0;
    }
}

export type BossFormReveal = {
    /** the form the screen should draw: the previous form until the cut-scene ends */
    shown: BossFormView | undefined;
    /** the transformation whose cut-scene has not played in this tab yet */
    pending: BossFormView | undefined;
    finish: () => void;
};

/**
 * Sequencing for a transformation: the cut-scene plays first, then the new
 * portrait, sprite, aura and phase appear. The server has already recorded the
 * transformation; this only remembers which scenes this tab has shown, so a
 * refresh neither replays one nor hides the form behind it.
 */
export function useBossFormReveal(sessionId: string, view: BossFormView | undefined): BossFormReveal {
    // Keyed by session, so a new fight re-reads what this tab has already watched.
    const [seen, setSeen] = useState(() => ({ sessionId, seq: readSeen(sessionId) }));
    const seenSeq = seen.sessionId === sessionId ? seen.seq : readSeen(sessionId);
    const pending = view && view.formName && view.seq > seenSeq ? view : undefined;
    const pendingSeq = pending?.seq;
    const finish = useCallback(() => {
        if (pendingSeq === undefined) return;
        try {
            window.sessionStorage.setItem(seenKey(sessionId), String(pendingSeq));
        } catch { /* private mode: the scene simply may replay */ }
        setSeen({ sessionId, seq: pendingSeq });
    }, [pendingSeq, sessionId]);
    return { shown: pending ? beforeTransformation(pending) : view, pending, finish };
}

/** What the boss looked like before the pending transformation (its earlier form, or its base). */
export function beforeTransformation(view: BossFormView): BossFormView {
    const previous = view.previous;
    if (!previous) return { seq: view.seq - 1, phase: 0, phaseCount: view.phaseCount };
    return {
        seq: view.seq - 1, phase: previous.phase, phaseCount: view.phaseCount,
        formName: previous.formName, aura: previous.aura,
        ...(previous.portrait ? { portrait: previous.portrait } : {}),
        ...(previous.sprite ? { sprite: previous.sprite } : {}),
    };
}
