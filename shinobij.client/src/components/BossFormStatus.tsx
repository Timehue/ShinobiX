import "../styles/boss-forms.css";
import { lazy, Suspense } from "react";
import type { BossFormView } from "../../../shared/boss-transformations";
import type { BossFormReveal } from "../lib/boss-form-reveal";

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
                    Break: {remaining}
                    <i style={{ width: `${breakPct}%` }} aria-hidden="true" />
                </span>
            )}
            {view.staggered && <span className="boss-form-stagger">Staggered</span>}
        </span>
    );
}

/** Plays the pending transformation's cut-scene: the old art first, then the new form. */
export function BossFormCutsceneGate({
    reveal, active, bossName, bossImage, playerName, playerImage, backdrop,
}: {
    reveal: BossFormReveal;
    /** false once the fight has ended: the result screen owns the stage then */
    active: boolean;
    bossName: string;
    /** the art the boss is drawn with before the transformation */
    bossImage: string;
    playerName: string;
    playerImage: string;
    backdrop?: string;
}) {
    const view = reveal.pending;
    if (!view || !active) return null;
    return (
        <Suspense fallback={null}>
            <BossFormCutscene key={view.seq} view={view} bossName={bossName} beforeImage={bossImage} afterImage={view.portrait ?? bossImage}
                playerName={playerName} playerImage={playerImage} backdrop={backdrop} onDone={reveal.finish} />
        </Suspense>
    );
}
