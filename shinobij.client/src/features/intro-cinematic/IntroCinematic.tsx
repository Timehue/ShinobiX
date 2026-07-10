/*
 * IntroCinematic — the "summoned by the spirit fox" opening that plays once
 * for brand-new accounts, right after the character creator's "Enter the
 * World". It replaces BOTH of the old first-session beats:
 *   - the VillageLoreScreen wall of text (screen === "villageLore", retired) —
 *     the fox now speaks two lines of village lore instead, and
 *   - the StarterPetSelect overlay (onboardingStep === "starter", retired) —
 *     the fox gifts the companion mid-cinematic.
 *
 * Forced overlay, not a screen: gated in App.tsx on the PERSISTED
 * character.onboardingStep ("academyIntro" | "starter"), so it survives a
 * refresh mid-cinematic and never shows for veterans (normalizeOnboardingStep
 * maps legacy/absent steps to "done"). Portaled to document.body at z-index
 * 1000000 per the app's overlay ladder.
 *
 * Sequence: awakening/warning dialogue → companion choice → confirm → post-gift
 * dialogue (village lore + farewell) → white-out. The white-out fades to full
 * white, hides the scene, then fades back out revealing the village screen
 * already rendered beneath — and only THEN calls onComplete(pet), which grants
 * the pet and advances onboardingStep to "training" (unmounting the overlay,
 * which is by then fully transparent).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Character } from "../../App";
import type { Pet } from "../../types/pet";
import { STARTER_PETS, type StarterPetOption } from "../../data/starter-pets";
import { petPoseImage } from "../../lib/pet-battle-anim";
import { isLowEndMobile, prefersReducedMotion } from "../../lib/device-tier";
import { useBodyScrollLock } from "../../lib/useBodyScrollLock";
import {
    FOX_NAME,
    PRE_GIFT_LINES,
    buildPostGiftLines,
    resolveCinematicLine,
    type CinematicLine,
} from "./introCinematicScript";
import riverShrineBg from "../../assets/card-clash/loc/river-shrine.webp";
import waterfallBg from "../../assets/sectors/water.webp";
import hollowGateArt from "../../assets/card-clash/loc/hollow-gate.webp";
import "./intro-cinematic.css";

// The Eclipse Kitsune idle pose (bundled, transparent cutout) — restyled into
// the white spirit fox via the .ic-fox CSS filter. Same ?v as pet-battle-anim's
// idlePoseUrl so it shares the browser cache with the coliseum.
const FOX_ART = "/pet-poses/mythic-0-idle.webp?v=2";

// Bar scales matching the old StarterPetSelect so the standard-band stat leans
// stay visible at a glance.
const STAT_MAX = { hp: 400, attack: 55, defense: 45, speed: 50 } as const;

type Phase =
    | { kind: "dialogue"; stage: "pre" | "post"; idx: number }
    | { kind: "choose" }
    | { kind: "confirm"; option: StarterPetOption }
    | { kind: "whiteout"; revealing: boolean };

function MiniStatBar({ label, value, max }: { label: string; value: number; max: number }) {
    const pct = Math.max(4, Math.min(100, Math.round((value / max) * 100)));
    return (
        <div className="ic-statbar">
            <span>{label}</span>
            <div className="ic-statbar-track"><div className="ic-statbar-fill" style={{ width: `${pct}%` }} /></div>
            <span>{value}</span>
        </div>
    );
}

export function IntroCinematic({
    character,
    sharedImages = {},
    onComplete,
}: {
    character: Character;
    sharedImages?: Record<string, string>;
    onComplete: (pet: Pet) => void;
}) {
    const [phase, setPhase] = useState<Phase>({ kind: "dialogue", stage: "pre", idx: 0 });
    const [chosen, setChosen] = useState<StarterPetOption | null>(null);
    // Typewriter progress is keyed to the line it belongs to, so switching lines
    // derives back to 0 without a reset-setState inside the effect body.
    const [typed, setTyped] = useState<{ text: string; count: number }>({ text: "", count: 0 });
    const typeTimerRef = useRef<number | null>(null);
    const completedRef = useRef(false);
    const reduced = prefersReducedMotion();
    const liteFx = isLowEndMobile();

    useBodyScrollLock(true);

    const postLines = useMemo(() => buildPostGiftLines(character.village), [character.village]);
    const line: CinematicLine | null =
        phase.kind === "dialogue"
            ? (phase.stage === "pre" ? PRE_GIFT_LINES : postLines)[phase.idx] ?? null
            : null;
    const fullText = line
        ? resolveCinematicLine(line.text, character.name, chosen?.pet.name ?? "")
        : "";

    // Typewriter: ~83 chars/s, tap-to-complete. Reduced-motion shows lines whole.
    useEffect(() => {
        if (!fullText || reduced) return;
        let c = 0;
        const id = window.setInterval(() => {
            c = Math.min(fullText.length, c + 2);
            setTyped({ text: fullText, count: c });
            if (c >= fullText.length) {
                window.clearInterval(id);
                if (typeTimerRef.current === id) typeTimerRef.current = null;
            }
        }, 24);
        typeTimerRef.current = id;
        return () => {
            window.clearInterval(id);
            if (typeTimerRef.current === id) typeTimerRef.current = null;
        };
    }, [fullText, reduced]);
    const typedCount = !fullText || reduced
        ? fullText.length
        : typed.text === fullText ? typed.count : 0;
    const typingDone = typedCount >= fullText.length;

    function completeLine() {
        if (typeTimerRef.current !== null) {
            window.clearInterval(typeTimerRef.current);
            typeTimerRef.current = null;
        }
        setTyped({ text: fullText, count: fullText.length });
    }

    // White-out choreography: fade to full white, hide the scene, fade the white
    // back out (revealing the village beneath), THEN complete exactly once.
    useEffect(() => {
        if (phase.kind !== "whiteout" || phase.revealing) return;
        const whiteInMs = reduced ? 250 : 1500;
        const revealMs = reduced ? 250 : 950;
        const t1 = window.setTimeout(() => setPhase({ kind: "whiteout", revealing: true }), whiteInMs);
        const t2 = window.setTimeout(() => {
            if (completedRef.current || !chosen) return;
            completedRef.current = true;
            onComplete(chosen.pet);
        }, whiteInMs + revealMs);
        return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase.kind, reduced]);

    function advance() {
        if (phase.kind !== "dialogue") return;
        if (!typingDone) {
            completeLine();
            return;
        }
        const lines = phase.stage === "pre" ? PRE_GIFT_LINES : postLines;
        if (phase.idx + 1 < lines.length) {
            setPhase({ kind: "dialogue", stage: phase.stage, idx: phase.idx + 1 });
        } else if (phase.stage === "pre") {
            setPhase({ kind: "choose" });
        } else {
            setPhase({ kind: "whiteout", revealing: false });
        }
    }

    // The gift is not skippable (the companion doubles as the tutorial guide),
    // so Skip fast-forwards to the choice, then from the choice to the exit.
    function skip() {
        if (phase.kind !== "dialogue") return;
        if (phase.stage === "pre") setPhase({ kind: "choose" });
        else setPhase({ kind: "whiteout", revealing: false });
    }

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") advance();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, typingDone, fullText]);

    const artFor = (o: StarterPetOption) => petPoseImage(o.pet, sharedImages);
    const revealing = phase.kind === "whiteout" && phase.revealing;
    const showActors = phase.kind === "dialogue";

    return createPortal(
        <div
            className={`ic-root ${revealing ? "is-revealing" : ""}`}
            style={{
                "--ic-bg-landscape": `url(${waterfallBg})`,
                "--ic-bg-portrait": `url(${riverShrineBg})`,
            } as React.CSSProperties}
            onClick={advance}
        >
            <div className="ic-scene" />
            {!liteFx && !reduced && (
                <div className="ic-motes" aria-hidden="true">
                    {Array.from({ length: 7 }, (_, i) => <span key={i} className="ic-mote" />)}
                </div>
            )}

            <div className="ic-stagefill">
                {showActors && (
                    <>
                        <div className={`ic-fox ${line?.fading ? "is-fading" : ""}`}>
                            <img src={FOX_ART} alt={`${FOX_NAME}, the ancient spirit fox`} />
                        </div>
                        <div className="ic-avatar">
                            {character.avatarImage ? (
                                <img src={character.avatarImage} alt="" />
                            ) : (
                                <span className="ic-avatar-initial">{(character.name || "?").charAt(0).toUpperCase()}</span>
                            )}
                            <span className="ic-avatar-name">{character.name}</span>
                        </div>
                        {line?.vision && (
                            <div className="ic-vision">
                                <img src={hollowGateArt} alt="A vision of the Hollow Gate" />
                            </div>
                        )}
                    </>
                )}
            </div>

            {phase.kind === "dialogue" && line && (
                <div className="ic-dialogue" role="dialog" aria-live="polite">
                    {line.speaker === "fox" && <span className="ic-speaker">{line.label ?? FOX_NAME}</span>}
                    <p className={`ic-line ${line.speaker === "narrator" ? "is-narrator" : ""}`}>
                        {fullText.slice(0, typedCount)}
                    </p>
                    {typingDone && <span className="ic-advance">▼</span>}
                </div>
            )}

            {phase.kind === "dialogue" && (
                <button type="button" className="ic-skip" onClick={(e) => { e.stopPropagation(); skip(); }}>
                    Skip ▸
                </button>
            )}

            {phase.kind === "choose" && (
                <div className="ic-choose" onClick={(e) => e.stopPropagation()}>
                    <div>
                        <p className="ic-choose-kicker">The Fox's Gift</p>
                        <h2 className="ic-choose-title">Choose Your Companion</h2>
                        <p className="ic-choose-sub">
                            One spirit for each nature. Each beats one element and is weak to
                            another: 🔥 → 🌬️ → ⚡ → 🪨 → 💧 → 🔥
                        </p>
                    </div>
                    <div className="ic-pet-grid">
                        {STARTER_PETS.map((o) => {
                            const art = artFor(o);
                            return (
                                <button
                                    key={o.pet.id}
                                    type="button"
                                    className="ic-pet-card"
                                    style={{ "--ic-accent": o.accent } as React.CSSProperties}
                                    onClick={() => setPhase({ kind: "confirm", option: o })}
                                >
                                    <span className="ic-pet-art">
                                        {art ? (
                                            <img src={art} alt={o.pet.name} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                                        ) : (
                                            <span className="ic-pet-emoji">{o.icon}</span>
                                        )}
                                    </span>
                                    <span>
                                        <p className="ic-pet-name">{o.pet.name}</p>
                                        <p className="ic-pet-role">{o.icon} {o.element} · {o.role}</p>
                                    </span>
                                    <span className="ic-pet-chips">
                                        <span className="ic-chip-good">Strong vs {o.strongVs}</span>
                                        <span className="ic-chip-bad">Weak vs {o.weakVs}</span>
                                    </span>
                                    <p className="ic-pet-blurb">{o.blurb}</p>
                                    <span>
                                        <MiniStatBar label="HP" value={o.pet.hp} max={STAT_MAX.hp} />
                                        <MiniStatBar label="ATK" value={o.pet.attack} max={STAT_MAX.attack} />
                                        <MiniStatBar label="DEF" value={o.pet.defense} max={STAT_MAX.defense} />
                                        <MiniStatBar label="SPD" value={o.pet.speed} max={STAT_MAX.speed} />
                                    </span>
                                    <p className="ic-pet-trait">★ {o.traitEffect}</p>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {phase.kind === "confirm" && (
                <div className="ic-choose" onClick={(e) => e.stopPropagation()}>
                    <div className="ic-confirm" style={{ "--ic-accent": phase.option.accent } as React.CSSProperties}>
                        <span className="ic-pet-art">
                            {artFor(phase.option) ? (
                                <img src={artFor(phase.option)} alt={phase.option.pet.name} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                            ) : (
                                <span className="ic-pet-emoji">{phase.option.icon}</span>
                            )}
                        </span>
                        <p className="ic-choose-kicker">Your First Companion</p>
                        <h2>Walk with {phase.option.pet.name}?</h2>
                        <p>
                            {phase.option.icon} {phase.option.element} · {phase.option.role}.{" "}
                            {phase.option.pet.description}
                        </p>
                        <div className="ic-confirm-actions">
                            <button type="button" className="ic-btn-ghost" onClick={() => setPhase({ kind: "choose" })}>
                                Back
                            </button>
                            <button
                                type="button"
                                className="ic-btn-take"
                                onClick={() => {
                                    setChosen(phase.option);
                                    setPhase({ kind: "dialogue", stage: "post", idx: 0 });
                                }}
                            >
                                Take {phase.option.pet.name}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className={`ic-whiteout ${phase.kind === "whiteout" ? "is-on" : ""} ${revealing ? "is-revealing" : ""}`} />
        </div>,
        document.body,
    );
}
