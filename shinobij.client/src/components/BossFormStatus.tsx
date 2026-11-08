import "../styles/boss-forms.css";
import { lazy, Suspense, useState } from "react";
import type { BossFormView } from "../../../shared/boss-transformations";

const BossFormCutscene = lazy(() => import("./BossFormCutscene"));

/** Current phase, the form's mechanic, and a live charge-break meter. */
export function BossFormChip({ view }: { view: BossFormView | undefined }) {
    if (!view) return null;
    const phaseLabel = `Phase ${view.phase + 1}/${view.phaseCount + 1}`;
    const charging = view.charging;
    const breakPct = charging ? Math.min(100, Math.round((charging.damageTaken / Math.max(1, charging.breakAt)) * 100)) : 0;
    const remaining = charging ? Math.max(0, charging.breakAt - charging.damageTaken) : 0;
    return (
        <span className={`boss-form-chip${view.aura ? ` boss-form-chip--${view.aura}` : ""}`} role="status" aria-live="polite"
            title={charging ? `${charging.name} is charging. Deal ${remaining} more damage or stun to break it.`
                : view.mechanic ? `${view.mechanic.name}: ${view.mechanic.tell}` : view.nextAtHpPct !== undefined ? `Transforms at ${view.nextAtHpPct}% health` : undefined}>
            <strong>{phaseLabel}</strong>
            <span>{view.formName ?? (view.nextAtHpPct !== undefined ? `Transforms at ${view.nextAtHpPct}% HP` : "Base form")}</span>
            {charging && (
                <span className="boss-form-charge">
                    Break {charging.name}: {remaining} dmg or stun
                    <i style={{ width: `${breakPct}%` }} aria-hidden="true" />
                </span>
            )}
            {view.staggered && <span className="boss-form-stagger">Staggered</span>}
        </span>
    );
}

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

/**
 * Plays the transformation cut-scene once per transformation. The server records
 * the transformation itself; this only remembers which scenes this tab has shown,
 * so a refresh does not replay one the player already watched.
 */
export function BossFormCutsceneGate({
    sessionId, view, bossName, bossImage, playerName, playerImage, backdrop,
}: {
    sessionId: string;
    view: BossFormView | undefined;
    bossName: string;
    bossImage: string;
    playerName: string;
    playerImage: string;
    backdrop?: string;
}) {
    // Keyed by session, so a new fight re-reads what this tab has already watched.
    const [seen, setSeen] = useState(() => ({ sessionId, seq: readSeen(sessionId) }));
    const seenSeq = seen.sessionId === sessionId ? seen.seq : readSeen(sessionId);
    if (!view || view.seq <= seenSeq || !view.formName) return null;
    const done = () => {
        try {
            window.sessionStorage.setItem(seenKey(sessionId), String(view.seq));
        } catch { /* private mode: the scene simply may replay */ }
        setSeen({ sessionId, seq: view.seq });
    };
    return (
        <Suspense fallback={null}>
            <BossFormCutscene view={view} bossName={bossName} bossImage={view.portrait ?? bossImage}
                playerName={playerName} playerImage={playerImage} backdrop={backdrop} onDone={done} />
        </Suspense>
    );
}
