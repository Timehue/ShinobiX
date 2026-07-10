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
import hollowGateArt from "../../assets/card-clash/loc/hollow-gate.webp";
// Bespoke gpt-image art (see project memory: generated via the owner's
// image pipeline): the seated white kitsune deity (transparent cutout) and
// the waterfall-shrine sanctuary backdrops for both orientations.
import shiranuiArt from "./assets/shiranui.webp";
import shrineFallsLandscape from "./assets/shrine-falls-landscape.webp";
import shrineFallsPortrait from "./assets/shrine-falls-portrait.webp";
import "./intro-cinematic.css";

const FOX_ART = shiranuiArt;

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
        <div className="icx-statbar">
            <span>{label}</span>
            <div className="icx-statbar-track"><div className="icx-statbar-fill" style={{ width: `${pct}%` }} /></div>
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
    const inDialogue = phase.kind === "dialogue";
    const rumbling = inDialogue && Boolean(line?.rumble);

    return createPortal(
        <div
            className={`icx-root ${revealing ? "is-revealing" : ""} ${rumbling && !reduced ? "is-rumbling" : ""}`}
            style={{
                "--icx-bg-landscape": `url(${shrineFallsLandscape})`,
                "--icx-bg-portrait": `url(${shrineFallsPortrait})`,
            } as React.CSSProperties}
            onClick={advance}
        >
            <div className="icx-scene"><div className="icx-scene-art" /></div>
            {!liteFx && !reduced && (
                <div className="icx-motes" aria-hidden="true">
                    <div className="icx-rays" />
                    <div className="icx-mist" />
                    <div className="icx-mist m2" />
                    {Array.from({ length: 7 }, (_, i) => <span key={i} className="icx-mote" />)}
                    {Array.from({ length: 6 }, (_, i) => <span key={`p${i}`} className="icx-petal" />)}
                </div>
            )}

            {/* Beat-driven color grade: violet omen during the Hollow Gate vision,
                pale elegy light while the fox's spirit gutters. */}
            <div className={`icx-grade ${line?.vision ? "is-omen" : ""} ${line?.fading ? "is-elegy" : ""}`} aria-hidden="true" />

            {/* Cinema letterbox bars — dialogue beats only, slide away for the
                companion choice UI. Hidden on small screens (they eat space). */}
            <div className={`icx-letterbox top ${inDialogue ? "is-on" : ""}`} aria-hidden="true" />
            <div className={`icx-letterbox bottom ${inDialogue ? "is-on" : ""}`} aria-hidden="true" />

            {/* One-shot opening title card. */}
            {!reduced && (
                <div className="icx-title" aria-hidden="true">
                    <span className="icx-title-kicker">Beyond the Veil</span>
                    <span className="icx-title-main">The Awakening</span>
                </div>
            )}

            <div className={`icx-stagefill ${inDialogue && line?.speaker === "fox" ? "is-focus" : ""}`}>
                {showActors && (
                    <>
                        <div className={`icx-fox ${line?.fading ? "is-fading" : ""} ${line?.speaker === "fox" && !typingDone ? "is-talking" : ""}`}>
                            <img src={FOX_ART} alt={`${FOX_NAME}, the ancient spirit fox`} />
                        </div>
                        <div className="icx-avatar">
                            {character.avatarImage ? (
                                <img src={character.avatarImage} alt="" />
                            ) : (
                                <span className="icx-avatar-initial">{(character.name || "?").charAt(0).toUpperCase()}</span>
                            )}
                            <span className="icx-avatar-name">{character.name}</span>
                        </div>
                        {line?.vision && (
                            <div className="icx-vision">
                                <img src={hollowGateArt} alt="A vision of the Hollow Gate" />
                            </div>
                        )}
                    </>
                )}
            </div>

            {phase.kind === "dialogue" && line && (
                <div className="icx-dialogue" role="dialog" aria-live="polite">
                    {line.speaker === "fox" && <span className="icx-speaker">{line.label ?? FOX_NAME}</span>}
                    <p
                        key={`${phase.stage}-${phase.idx}`}
                        className={`icx-line ${line.speaker === "narrator" ? "is-narrator" : ""}`}
                    >
                        {fullText.slice(0, typedCount)}
                    </p>
                    {typingDone && <span className="icx-advance">▼</span>}
                </div>
            )}

            {phase.kind === "dialogue" && (
                <button type="button" className="icx-skip" onClick={(e) => { e.stopPropagation(); skip(); }}>
                    Skip ▸
                </button>
            )}

            {phase.kind === "choose" && (
                <div className="icx-choose" onClick={(e) => e.stopPropagation()}>
                    <div>
                        <p className="icx-choose-kicker">The Fox's Gift</p>
                        <h2 className="icx-choose-title">Choose Your Companion</h2>
                        <p className="icx-choose-sub">
                            One spirit for each nature. Each beats one element and is weak to
                            another: 🔥 → 🌬️ → ⚡ → 🪨 → 💧 → 🔥
                        </p>
                    </div>
                    <div className="icx-pet-grid">
                        {STARTER_PETS.map((o) => {
                            const art = artFor(o);
                            return (
                                <button
                                    key={o.pet.id}
                                    type="button"
                                    className="icx-pet-card"
                                    style={{ "--icx-accent": o.accent } as React.CSSProperties}
                                    onClick={() => setPhase({ kind: "confirm", option: o })}
                                >
                                    <span className="icx-pet-art">
                                        {art ? (
                                            <img src={art} alt={o.pet.name} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                                        ) : (
                                            <span className="icx-pet-emoji">{o.icon}</span>
                                        )}
                                    </span>
                                    <span>
                                        <p className="icx-pet-name">{o.pet.name}</p>
                                        <p className="icx-pet-role">{o.icon} {o.element} · {o.role}</p>
                                    </span>
                                    <span className="icx-pet-chips">
                                        <span className="icx-chip-good">Strong vs {o.strongVs}</span>
                                        <span className="icx-chip-bad">Weak vs {o.weakVs}</span>
                                    </span>
                                    <p className="icx-pet-blurb">{o.blurb}</p>
                                    <span>
                                        <MiniStatBar label="HP" value={o.pet.hp} max={STAT_MAX.hp} />
                                        <MiniStatBar label="ATK" value={o.pet.attack} max={STAT_MAX.attack} />
                                        <MiniStatBar label="DEF" value={o.pet.defense} max={STAT_MAX.defense} />
                                        <MiniStatBar label="SPD" value={o.pet.speed} max={STAT_MAX.speed} />
                                    </span>
                                    <p className="icx-pet-trait">★ {o.traitEffect}</p>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {phase.kind === "confirm" && (
                <div className="icx-choose" onClick={(e) => e.stopPropagation()}>
                    <div className="icx-confirm" style={{ "--icx-accent": phase.option.accent } as React.CSSProperties}>
                        <span className="icx-pet-art">
                            {artFor(phase.option) ? (
                                <img src={artFor(phase.option)} alt={phase.option.pet.name} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                            ) : (
                                <span className="icx-pet-emoji">{phase.option.icon}</span>
                            )}
                        </span>
                        <p className="icx-choose-kicker">Your First Companion</p>
                        <h2>Walk with {phase.option.pet.name}?</h2>
                        <p>
                            {phase.option.icon} {phase.option.element} · {phase.option.role}.{" "}
                            {phase.option.pet.description}
                        </p>
                        <div className="icx-confirm-actions">
                            <button type="button" className="icx-btn-ghost" onClick={() => setPhase({ kind: "choose" })}>
                                Back
                            </button>
                            <button
                                type="button"
                                className="icx-btn-take"
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

            <div className={`icx-whiteout ${phase.kind === "whiteout" ? "is-on" : ""} ${revealing ? "is-revealing" : ""}`} />
        </div>,
        document.body,
    );
}
