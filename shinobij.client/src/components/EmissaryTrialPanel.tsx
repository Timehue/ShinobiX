/*
 * The trial-giver face of a Legacy Emissary (docs/legacy-assets.md §1): when
 * the player's accepted Legacy category is served by the emissary they're
 * talking to, this panel puts their trial IN the world — live objectives,
 * begin/complete, the emissary's own voice — instead of only in the Profile
 * tab. Self-contained: fetches status on mount, drives the same server-auth
 * trial endpoint the LegacyPanel uses.
 */
import { useEffect, useState } from "react";
import {
    fetchLegacyStatus, fetchLegacyDefinitions, trialStart, trialComplete,
    TRIAL_STAT_LABELS, type LegacyStatusView, type LegacyDefView,
} from "../lib/legacy";
import type { EmissaryDef } from "../lib/legacy-emissaries";
import { LegacyMoment, type LegacyMomentData } from "./LegacyMoment";

const KIND_NAMES: Record<string, string> = {
    awaken: "Trial of Awakening", bind: "Trial of Binding",
    prove: "Trial of Proving", mythic: "The Mythic Trial",
};
const STAGE_NAMES: Record<number, string> = {
    1: "Path Accepted", 2: "Awakened", 3: "Bound", 4: "Proven", 5: "Mythic",
};

export function EmissaryTrialPanel({ playerName, emissary, onStageUp }: {
    playerName: string;
    emissary: EmissaryDef;
    /** Fired with the granted title (if any) when a trial completes here. */
    onStageUp?: (newStage: number, grantedTitle: string | null) => void;
}) {
    // undefined = fetch in flight, null = failed/flag-off (render nothing).
    const [status, setStatus] = useState<LegacyStatusView | null | undefined>(undefined);
    const [defView, setDefView] = useState<LegacyDefView | null>(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const [moment, setMoment] = useState<LegacyMomentData | null>(null);

    useEffect(() => {
        let alive = true;
        void fetchLegacyStatus(playerName).then(s => {
            if (!alive) return;
            setStatus(s);
            if (s?.legacy) {
                void fetchLegacyDefinitions().then(d => {
                    if (alive && d) setDefView(d.legacies.find(l => l.id === s.legacy!.legacyId) ?? null);
                });
            }
        });
        return () => { alive = false; };
    }, [playerName]);

    // Reserve the section while the status fetch is pending so the dialog's
    // buttons don't shift under the player's thumb when it pops in. A FAILED
    // fetch (null — network error or flag off) hides the section instead of
    // showing a forever-loading line (final-gate finding).
    if (status === undefined) {
        return (
            <div style={{ borderTop: "1px solid rgba(192,132,252,.3)", marginTop: 10, paddingTop: 10 }}>
                <p style={{ fontSize: ".74rem", color: "#9aa3b2", fontStyle: "italic", margin: 0 }}>…the emissary consults the threads.</p>
            </div>
        );
    }
    if (!status?.legacy) return null;
    const served = !!status.legacyCategory && emissary.categories.includes(status.legacyCategory);
    if (!served) return null;

    const stage = status.legacy.stage;
    const trial = status.trial;

    async function begin() {
        setBusy(true);
        const r = await trialStart(playerName);
        setBusy(false);
        if (r?.ok && r.trial) {
            setStatus(s => s ? { ...s, trial: r.trial! } : s);
            setNote("“Then it begins. I will be watching — I am always watching.”");
        } else if (r?.reason === "busy") {
            // A trial already runs (started moments ago in the Profile tab) —
            // refresh so it renders here instead of a misleading refusal.
            const fresh = await fetchLegacyStatus(playerName);
            if (fresh) setStatus(fresh);
            setNote("“You already carry a trial, shinobi. Show me how you fare.”");
        } else if (r?.reason === "complete") {
            setNote("“Your path is already complete. Walk it proudly.”");
        } else {
            setNote("“Not yet. The moment is not ready for you.”");
        }
    }
    async function complete() {
        setBusy(true);
        const r = await trialComplete(playerName);
        setBusy(false);
        if (r?.ok && r.legacy) {
            setStatus(s => s ? { ...s, legacy: r.legacy!, trial: null } : s);
            // The emissary's own voice — the Sage's completion passage plays in
            // the LegacyMoment, so this line must not echo it.
            setNote(r.title ? `“Done, and witnessed. Wear it well: ${r.title}.”` : "“Done, and witnessed. The path remembers.”");
            if (defView) {
                setMoment({
                    mode: "stage-up",
                    stage: r.legacy.stage,
                    stageName: STAGE_NAMES[r.legacy.stage] ?? "Advanced",
                    legacyName: defView.name,
                    rarity: defView.rarity,
                    badge: defView.badge,
                    grantedTitle: r.title ?? null,
                    text: r.completion ?? "Your legacy deepens.",
                });
            }
            onStageUp?.(r.legacy.stage, r.title ?? null);
        } else if (r?.objectives) {
            setStatus(s => s?.trial ? { ...s, trial: { ...s.trial, objectives: r.objectives! } } : s);
            setNote("“Closer. But the trial is not finished with you.”");
        } else {
            setNote("“The threads are tangled — come back to me shortly.”");
        }
    }

    return (
        <div style={{ borderTop: "1px solid rgba(192,132,252,.3)", marginTop: 10, paddingTop: 10, textAlign: "left" }}>
            <p style={{ fontSize: ".76rem", fontStyle: "italic", color: "#c4b5fd", margin: "0 0 8px" }}>{emissary.trialLine}</p>
            {trial ? (
                <>
                    <p style={{ fontSize: ".78rem", fontWeight: 700, margin: "0 0 6px", color: "#e2e8f0" }}>
                        {KIND_NAMES[trial.kind] ?? "Legacy Trial"} — attempt {trial.attempt}
                    </p>
                    {trial.objectives.map(o => (
                        <div key={o.stat} style={{ display: "flex", justifyContent: "space-between", fontSize: ".73rem", color: o.done ? "#86efac" : "#cbd5e1", marginBottom: 3 }}>
                            <span>{o.done ? "✓ " : ""}{TRIAL_STAT_LABELS[o.stat] ?? o.stat}</span>
                            <span>{(o.progress ?? 0).toLocaleString()} / {o.delta.toLocaleString()}</span>
                        </div>
                    ))}
                    <button disabled={busy} onClick={() => void complete()} style={{ width: "100%", marginTop: 6 }}>
                        {trial.objectives.every(o => o.done) ? "Complete the trial here" : "Ask how you fare"}
                    </button>
                </>
            ) : stage < 5 ? (
                <button disabled={busy} onClick={() => void begin()} style={{ width: "100%" }}>
                    Ask for your next trial
                </button>
            ) : (
                <p style={{ fontSize: ".75rem", color: "#c084fc", margin: 0, fontStyle: "italic" }}>
                    “Stage V. There is nothing left I can test in you — only things left to witness.”
                </p>
            )}
            {note && <p style={{ fontSize: ".74rem", color: "#facc15", margin: "8px 0 0", fontStyle: "italic" }}>{note}</p>}
            {moment && <LegacyMoment moment={moment} onClose={() => setMoment(null)} />}
        </div>
    );
}
