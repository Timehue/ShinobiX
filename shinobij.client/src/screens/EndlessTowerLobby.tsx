import { useEffect, useRef, useState } from "react";
import type { Character } from "../types/character";
import { endlessWaveReward } from "../lib/endless-tower";
import { endlessEntryCost } from "../lib/entry-fee";
import endlessTowerHero from "../assets/towers/endless-tower-hero.webp";

/**
 * Fire an action at most once per short window.
 *
 * Entering charges a ryo entry fee and banking commits the run's rewards, and both
 * were bare `onClick={handler}` — so a double-tap (easy on a phone) ran them twice.
 * The ref flips synchronously, unlike state, so both taps of a same-tick double-tap
 * cannot get through.
 *
 * The lock releases itself rather than latching on first use: these handlers normally
 * navigate away and unmount this screen, but if one fails to, a permanently disabled
 * button would leave the player stuck in the lobby with no way to start a run.
 */
const ACTION_LOCK_MS = 1500;

function useOneShotAction(): [boolean, (action: () => void) => void] {
    const lockedRef = useRef(false);
    const [locked, setLocked] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

    return [locked, (action: () => void) => {
        if (lockedRef.current) return;
        lockedRef.current = true;
        setLocked(true);
        timerRef.current = setTimeout(() => {
            lockedRef.current = false;
            setLocked(false);
        }, ACTION_LOCK_MS);
        action();
    }];
}

// ─── Endless Tower Lobby ──────────────────────────────────────────────────────
// Shows run state (current wave, banked rewards, best wave) and lets the player
// start a fresh run, resume the existing one, or retreat to bank rewards.
export function EndlessTowerLobby({
    character,
    onEnter,
    onBank,
    onBack,
}: {
    character: Character;
    onEnter: () => void;
    onBank: () => void;
    onBack: () => void;
}) {
    const [actionLocked, runOnce] = useOneShotAction();
    const run = character.endlessTowerRun;
    const inProgress = !!run && run.wave > 1;
    const nextWave = run?.wave ?? 1;
    const preview = endlessWaveReward(nextWave, character.level ?? 1);
    const entryCost = endlessEntryCost(character);
    return (
        <div className="card" style={{ maxWidth: 720, margin: "1rem auto", padding: 0, overflow: "hidden" }}>
            <div style={{ position: "relative" }}>
                <img src={endlessTowerHero} alt="" style={{ display: "block", width: "100%", height: 220, objectFit: "cover", objectPosition: "center 22%" }} />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,11,15,0) 30%, rgba(8,11,15,.94))" }} />
                <div style={{ position: "absolute", left: 22, right: 22, bottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--sj-spirit-bright)" }}>Celestial Tower · Solo Ascent</div>
                    <h1 style={{ margin: "2px 0 0" }}>Endless Tower</h1>
                </div>
            </div>
            <div style={{ padding: "1rem 1.4rem 1.4rem" }}>
            <p style={{ color: "var(--text-dim)", marginTop: 0 }}>
                Each wave is harder than the last. Every 5th floor is a milestone (×2 rewards); every 10th is a boss floor (×3).
                Banked rewards are lost if you die — retreat to bank what you've earned.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem", margin: "1rem 0" }}>
                <div className="card" style={{ padding: "0.8rem" }}>
                    <div style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>Best floor</div>
                    <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--gold)" }}>{character.endlessTowerBestWave ?? 0}</div>
                </div>
                <div className="card" style={{ padding: "0.8rem" }}>
                    <div style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>Lifetime clears</div>
                    <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--green-400)" }}>{character.totalEndlessTowerWins ?? 0}</div>
                </div>
            </div>
            {inProgress && run ? (
                <div className="card" style={{ padding: "0.9rem", background: "linear-gradient(#1a1a2e,#0a0a1a)", border: "1px solid var(--green-400)" }}>
                    <div style={{ color: "var(--green-400)", fontWeight: 700, marginBottom: "0.3rem" }}>Run in progress</div>
                    <div style={{ fontSize: "0.95rem" }}>Floor: <strong>{run.wave}</strong></div>
                    <div style={{ fontSize: "0.95rem" }}>Banked ryo: <strong style={{ color: "var(--gold)" }}>{run.bankedRyo.toLocaleString()}</strong></div>
                </div>
            ) : (
                <div style={{ color: "var(--text-dim)", fontStyle: "italic", padding: "0.6rem 0" }}>No active run.</div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: inProgress ? "1fr 1fr" : "1fr", gap: "0.6rem", marginTop: "1rem" }}>
                <button
                    className="ui-btn ui-btn--primary"
                    style={{ width: "100%", justifyContent: "center", padding: "0.8rem 1rem", fontWeight: 700 }}
                    disabled={actionLocked}
                    onClick={() => runOnce(onEnter)}
                >
                    {inProgress ? `Resume — Floor ${nextWave}` : `Enter Tower (Floor 1)${entryCost > 0 ? ` — ${entryCost.toLocaleString()} ryo` : " — free today"}`}
                </button>
                {inProgress && (
                    <button
                        className="ui-btn ui-btn--secondary"
                        style={{ width: "100%", justifyContent: "center", padding: "0.8rem 1rem", fontWeight: 700 }}
                        disabled={actionLocked}
                        onClick={() => runOnce(onBank)}
                    >
                        Retreat &amp; Bank
                    </button>
                )}
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "0.8rem" }}>
                Next reward preview: {preview.ryo.toLocaleString()} ryo{preview.isMilestone ? " (milestone!)" : ""}.
            </p>
            <button className="back-btn" style={{ marginTop: "0.6rem" }} onClick={onBack}>× Back to Central</button>
            </div>
        </div>
    );
}
