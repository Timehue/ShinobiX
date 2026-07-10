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
    buildCompanionIntroLines,
    buildPostGiftLines,
    resolveCinematicLine,
    type CinematicLine,
} from "./introCinematicScript";
import hollowGateArt from "../../assets/card-clash/loc/hollow-gate.webp";
// Bespoke gpt-image art (see project memory: generated via the owner's
// image pipeline): the seated white kitsune deity (transparent cutout) and
// the waterfall-shrine sanctuary backdrops for both orientations.
import shiranuiArt from "./assets/shiranui.webp";
import shiranuiBlink from "./assets/shiranui-blink.webp";
import shiranuiSpeak from "./assets/shiranui-speak.webp";
import shrineFallsLandscape from "./assets/shrine-falls-landscape.webp";
import shrineFallsPortrait from "./assets/shrine-falls-portrait.webp";
import { introCue, startIntroAmbience, stopIntroAmbience } from "./introCinematicSfx";
import { isAudioMuted, setAudioMuted, subscribeAudioMute } from "../../lib/pet-music";
import "./intro-cinematic.css";

const FOX_ART = shiranuiArt;

// Bar scales sized so no starter pegs a bar (Spark Pup's 58 ATK and Pebble
// Tortoise's 400 HP stay visibly distinct from the runners-up).
const STAT_MAX = { hp: 420, attack: 60, defense: 45, speed: 50 } as const;

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
    replay = false,
    onClose,
}: {
    character: Character;
    sharedImages?: Record<string, string>;
    onComplete?: (pet: Pet) => void;
    /** Replay mode (Story Hall): pure viewing — no grant, no step change; the
     *  white-out ends by calling onClose instead of onComplete. */
    replay?: boolean;
    onClose?: () => void;
}) {
    const [phase, setPhase] = useState<Phase>({ kind: "dialogue", stage: "pre", idx: 0 });
    const [chosen, setChosen] = useState<StarterPetOption | null>(null);
    // Typewriter progress is keyed to the line it belongs to, so switching lines
    // derives back to 0 without a reset-setState inside the effect body.
    const [typed, setTyped] = useState<{ text: string; count: number }>({ text: "", count: 0 });
    const typeTimerRef = useRef<number | null>(null);
    const completedRef = useRef(false);
    const lastCompleteRef = useRef(0);
    const reduced = prefersReducedMotion();
    const liteFx = isLowEndMobile();

    useBodyScrollLock(true);

    // Opening curtain: hold the first line until the title card peaks (summon)
    // or the village gets one clean beat on screen (companion). Reduced motion
    // starts immediately.
    const [curtainUp, setCurtainUp] = useState(reduced);
    useEffect(() => {
        if (curtainUp) return;
        const t = window.setTimeout(() => setCurtainUp(true), character.onboardingStep === "companionIntro" ? 900 : 2400);
        return () => window.clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Master-mute mirror for the in-cinematic sound toggle: the game's global
    // unmute button is buried under this overlay, so first-time players need
    // one here to opt in to the ambience at all.
    const [muted, setMuted] = useState(isAudioMuted);
    useEffect(() => subscribeAudioMute(() => setMuted(isAudioMuted())), []);


    // Companion mode — the beat AFTER the shrine cinematic's white-out
    // (onboardingStep === "companionIntro"): the granted pet stands over the
    // live village screen, speaks its own village intro, and hands off to the
    // tutorial. Same overlay component so App.tsx mounts exactly one gate.
    const companionMode = !replay && character.onboardingStep === "companionIntro";
    const companionPet = companionMode
        ? character.pets.find((p) => p.id === character.activePetId) ?? character.pets[0] ?? STARTER_PETS[0].pet
        : null;
    const companionLines = useMemo(
        () => (companionPet ? buildCompanionIntroLines(character.village, companionPet.name) : []),
        [companionPet, character.village],
    );

    const postLines = useMemo(() => buildPostGiftLines(character.village), [character.village]);
    const line: CinematicLine | null =
        phase.kind === "dialogue"
            ? (companionMode ? companionLines : phase.stage === "pre" ? PRE_GIFT_LINES : postLines)[phase.idx] ?? null
            : null;
    const fullText = line
        ? resolveCinematicLine(line.text, character.name, chosen?.pet.name ?? companionPet?.name ?? "")
        : "";

    // Typewriter: ~83 chars/s, tap-to-complete. Reduced-motion shows lines whole.
    useEffect(() => {
        if (!fullText || reduced || !curtainUp) return;
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
    }, [fullText, reduced, curtainUp]);
    const typedCount = !fullText || reduced
        ? fullText.length
        : !curtainUp ? 0 : typed.text === fullText ? typed.count : 0;
    const typingDone = typedCount >= fullText.length;

    // Mouth flap while the deity's words are being written (frame C alternates
    // with the base at speech cadence; a stale open-mouth flag is harmless
    // because the frame choice also requires foxTalking).
    const foxTalking = !companionMode && line?.speaker === "fox" && !typingDone;
    const [mouthOpen, setMouthOpen] = useState(false);
    useEffect(() => {
        if (!foxTalking || reduced) return;
        const id = window.setInterval(() => setMouthOpen((o) => !o), 150);
        return () => window.clearInterval(id);
    }, [foxTalking, reduced]);

    function completeLine() {
        if (typeTimerRef.current !== null) {
            window.clearInterval(typeTimerRef.current);
            typeTimerRef.current = null;
        }
        lastCompleteRef.current = Date.now();
        setTyped({ text: fullText, count: fullText.length });
    }

    // Shrine ambience bed for the summon beat (honours the global master mute;
    // audio is opt-in). The companion beat plays over the village, bed-free.
    // If the browser suspended the AudioContext (mount isn't a gesture), the
    // startIntroAmbience() retry inside advance() picks it up on first click.
    useEffect(() => {
        if (companionMode) return;
        startIntroAmbience();
        introCue("title");
        return () => stopIntroAmbience(600);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Warm the five pose cutouts (picker cards) + the speak/farewell frames
    // during the opening dialogue so none pop in on a cold cache.
    useEffect(() => {
        if (companionMode) return;
        [...STARTER_PETS.map((o) => petPoseImage(o.pet, sharedImages)), shiranuiSpeak, shiranuiBlink]
            .forEach((src) => { const img = new Image(); img.src = src; });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Beat cues keyed to the line being shown (once per line, not per keystroke).
    const lineKey = phase.kind === "dialogue" ? `${companionMode ? "c" : phase.stage}-${phase.idx}` : "";
    useEffect(() => {
        if (!lineKey || !line) return;
        if (line.rumble) {
            introCue("omen");
        } else if (!companionMode && phase.kind === "dialogue" && phase.stage === "pre"
            && line.speaker === "fox" && !line.label
            && PRE_GIFT_LINES[phase.idx - 1]?.label === "???") {
            introCue("reveal"); // Shiranui names itself
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lineKey]);

    // White-out choreography: fade to full white, hide the scene, fade the white
    // back out (revealing the village beneath), THEN complete exactly once.
    useEffect(() => {
        if (phase.kind !== "whiteout" || phase.revealing) return;
        introCue("whiteout");
        stopIntroAmbience(1400);
        const whiteInMs = reduced ? 250 : 1500;
        const revealMs = reduced ? 250 : 950;
        const t1 = window.setTimeout(() => setPhase({ kind: "whiteout", revealing: true }), whiteInMs);
        const t2 = window.setTimeout(() => {
            if (completedRef.current) return;
            completedRef.current = true;
            if (replay) { onClose?.(); return; }
            if (chosen) onComplete?.(chosen.pet);
        }, whiteInMs + revealMs);
        return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase.kind, reduced]);

    // Companion mode ends without a white-out — the tutorial UI pops in the
    // instant the overlay unmounts (the step flip is what removes it).
    function finishCompanion() {
        if (completedRef.current || !companionPet) return;
        completedRef.current = true;
        onComplete?.(companionPet);
    }

    function advance() {
        if (phase.kind !== "dialogue" || !curtainUp) return;
        // Gesture-unlocked audio start for browsers that suspended the context
        // at mount (no-op when muted or already running).
        startIntroAmbience();
        if (!typingDone) {
            completeLine();
            return;
        }
        // Double-tap grace: a force-completed line gets a beat to be read
        // before the same gesture can advance past it.
        if (Date.now() - lastCompleteRef.current < 250) return;
        const lines = companionMode ? companionLines : phase.stage === "pre" ? PRE_GIFT_LINES : postLines;
        if (phase.idx + 1 < lines.length) {
            introCue("advance");
            setPhase({ kind: "dialogue", stage: phase.stage, idx: phase.idx + 1 });
        } else if (companionMode) {
            finishCompanion();
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
        if (companionMode) finishCompanion();
        else if (phase.stage === "pre") setPhase({ kind: "choose" });
        else setPhase({ kind: "whiteout", revealing: false });
    }

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // Leave the keyboard to higher overlays (GameAlert sits above us)
            // and to focused controls (Enter on Skip must not also advance).
            if (e.defaultPrevented) return;
            if ((e.target as HTMLElement | null)?.closest?.("button, input, textarea, select")) return;
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") advance();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, typingDone, fullText, curtainUp]);

    const artFor = (o: StarterPetOption) => petPoseImage(o.pet, sharedImages);
    const revealing = phase.kind === "whiteout" && phase.revealing;
    const departing = phase.kind === "whiteout" && !phase.revealing;
    // Actors stay on stage while the white covers them — unmounting at the
    // whiteout's first frame made the deity blink out of the visible scene.
    const showActors = phase.kind === "dialogue" || departing;
    const inDialogue = phase.kind === "dialogue";
    const barsOn = inDialogue || departing;
    const rumbling = inDialogue && Boolean(line?.rumble);
    const foxFading = Boolean(line?.fading) || departing;
    // The deity materializes on its first spoken line ("???"), not during the
    // narrator establishing shots — the arrival IS the reveal.
    const foxOnStage = phase.kind !== "dialogue" || phase.stage === "post" || phase.idx >= 3;
    const showGiftPet = chosen != null && (departing || (phase.kind === "dialogue" && phase.stage === "post"));

    return createPortal(
        <div
            className={`icx-root ${companionMode ? "is-companion" : ""} ${revealing ? "is-revealing" : ""} ${rumbling && !reduced ? "is-rumbling" : ""}`}
            style={{
                "--icx-bg-landscape": `url(${shrineFallsLandscape})`,
                "--icx-bg-portrait": `url(${shrineFallsPortrait})`,
            } as React.CSSProperties}
            onClick={advance}
        >
            {!companionMode && <div className="icx-scene"><div className="icx-scene-art" /></div>}
            {!liteFx && !reduced && (
                <div className="icx-motes" aria-hidden="true">
                    {!companionMode && (
                        <>
                            <div className="icx-rays" />
                            <div className="icx-mist" />
                            <div className="icx-mist m2" />
                            {Array.from({ length: 6 }, (_, i) => <span key={`p${i}`} className="icx-petal" />)}
                        </>
                    )}
                    {/* Spirit motes rise in both beats — the companion carries a
                        little of the shrine's light into the village. */}
                    {Array.from({ length: companionMode ? 4 : 7 }, (_, i) => <span key={i} className="icx-mote" />)}
                </div>
            )}

            {/* Beat-driven color grade: violet omen during the Hollow Gate vision,
                pale elegy light while the fox's spirit gutters. */}
            {!companionMode && (
                <div className={`icx-grade ${line?.vision ? "is-omen" : ""} ${foxFading ? "is-elegy" : ""}`} aria-hidden="true" />
            )}

            {/* Cinema letterbox bars — dialogue + departure beats, slide away
                for the companion-choice UI. Hidden on small screens. */}
            <div className={`icx-letterbox top ${barsOn ? "is-on" : ""}`} aria-hidden="true" />
            <div className={`icx-letterbox bottom ${barsOn ? "is-on" : ""}`} aria-hidden="true" />

            {/* One-shot opening title card. */}
            {!companionMode && !reduced && (
                <div className="icx-title" aria-hidden="true">
                    <span className="icx-title-kicker">Beyond the Veil</span>
                    <span className="icx-title-main">The Awakening</span>
                </div>
            )}

            <div className={`icx-stagefill ${inDialogue && line?.speaker === "fox" ? "is-focus" : ""}`}>
                {showActors && companionMode && companionPet && (
                    <div className={`icx-companion-pet ${!typingDone ? "is-talking" : ""}`}>
                        <img
                            src={petPoseImage(companionPet, sharedImages)}
                            alt={companionPet.name}
                            onError={(e) => { e.currentTarget.style.display = "none"; }}
                        />
                    </div>
                )}
                {/* The deity keeps watch (dimmed) while the five spirits present
                    themselves on the choose/confirm screens. */}
                {!companionMode && (showActors || phase.kind === "choose" || phase.kind === "confirm") && foxOnStage && (
                    <div className={`icx-fox ${foxFading ? "is-fading" : ""} ${line?.speaker === "fox" && !typingDone ? "is-talking" : ""} ${phase.kind === "choose" || phase.kind === "confirm" ? "is-watching" : ""}`}>
                        {/* Frame priority: farewell holds eyes closed (static, no
                            swap) → mouth-flap while speaking → base. (Idle blinking
                            was removed — the swap read as a flicker.) */}
                        <img
                            src={foxFading ? shiranuiBlink : foxTalking && mouthOpen ? shiranuiSpeak : FOX_ART}
                            alt={`${FOX_NAME}, the ancient spirit fox`}
                        />
                    </div>
                )}
                {showActors && !companionMode && (
                    <>
                        <div className="icx-avatar">
                            {character.avatarImage ? (
                                <img src={character.avatarImage} alt="" />
                            ) : (
                                <span className="icx-avatar-initial">{(character.name || "?").charAt(0).toUpperCase()}</span>
                            )}
                            <span className="icx-avatar-name">{character.name}</span>
                        </div>
                        {showGiftPet && chosen && (
                            <div className={`icx-gift-pet ${inDialogue && phase.idx === 0 && !typingDone ? "is-talking" : ""}`}>
                                <img src={artFor(chosen)} alt={chosen.pet.name} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                            </div>
                        )}
                        {line?.vision && (
                            <div className="icx-vision">
                                <img src={hollowGateArt} alt="A vision of the Hollow Gate" />
                            </div>
                        )}
                    </>
                )}
            </div>

            {phase.kind === "dialogue" && line && curtainUp && (
                <div className="icx-dialogue" role="dialog" aria-live="polite">
                    {line.speaker === "fox" && <span className="icx-speaker">{line.label ?? FOX_NAME}</span>}
                    {/* The animated slice is aria-hidden; screen readers get the
                        whole line once instead of a re-announcement per tick. */}
                    <p
                        key={`${phase.stage}-${phase.idx}`}
                        className={`icx-line ${line.speaker === "narrator" ? "is-narrator" : ""}`}
                        aria-hidden="true"
                    >
                        {fullText.slice(0, typedCount)}
                    </p>
                    <span className="icx-sr">{fullText}</span>
                    {typingDone && !companionMode && phase.stage === "pre" && phase.idx === 0 && (
                        <span className="icx-tap-hint">Tap anywhere to continue</span>
                    )}
                    {typingDone && <span className="icx-advance">▼</span>}
                </div>
            )}

            {phase.kind === "dialogue" && (
                <>
                    <button
                        type="button"
                        className="icx-skip icx-sound"
                        aria-label={muted ? "Unmute game audio" : "Mute game audio"}
                        onClick={(e) => {
                            e.stopPropagation();
                            const nowMuted = !muted;
                            setAudioMuted(nowMuted);
                            if (!nowMuted && !companionMode) startIntroAmbience();
                        }}
                    >
                        {muted ? "🔇" : "🔊"}
                    </button>
                    <button type="button" className="icx-skip" onClick={(e) => { e.stopPropagation(); skip(); }}>
                        Skip ▸
                    </button>
                </>
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
                                    introCue("confirm");
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
