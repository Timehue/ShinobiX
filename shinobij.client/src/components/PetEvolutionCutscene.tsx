/*
 * Pet evolution cutscene — the Digimon-style reveal (view).
 *
 * A self-contained full-screen overlay driven by the pure timeline in
 * lib/pet-evolution-cutscene.ts. Beats: the old form charges & rises, a tube of
 * light + silhouette morph engulfs it, a white burst, then the NEW form is
 * revealed with its name and makes a full 360° hero spin before settling.
 *
 * Implemented in CSS/3D-transforms (NOT react-three-fiber): without generated
 * .glb models a "turntable" is a flat card-spin either way, and CSS rotateY
 * gives exactly that with zero new dependencies — so this builds and ships now.
 * A true volumetric .glb turntable can drop in later (scripts/gen-pet-3d.mjs +
 * the existing r3f/Bloom stack) without changing this component's contract.
 *
 * The evolution is already persisted server-side before this plays (see
 * api/pet/evolve.ts), so the cutscene is purely celebratory and always
 * skippable. Honors prefers-reduced-motion (jumps straight to the settled form).
 */
import { useEffect, useRef, useState } from "react";
import type { Pet } from "../types/pet";
import {
    EVOLUTION_TOTAL_MS,
    evolutionPhaseAt,
    isOldFormVisible,
    isNewFormVisible,
    showOldName,
    showNewName,
    turntableRotation,
    ascendRotation,
    burstIntensity,
} from "../lib/pet-evolution-cutscene";

const RAD2DEG = 180 / Math.PI;

function initials(name: string): string {
    return name.slice(0, 2).toUpperCase();
}

export function PetEvolutionCutscene({
    pet,
    oldName,
    oldImage,
    newImage,
    onClose,
}: {
    pet: Pet;
    oldName: string;
    oldImage?: string;
    newImage?: string;
    onClose: () => void;
}) {
    // Reduced-motion is resolved in the initializer (jump straight to the
    // settled form) so the effect never has to setState synchronously.
    const [elapsed, setElapsed] = useState<number>(() => {
        try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? EVOLUTION_TOTAL_MS : 0; }
        catch { return 0; }
    });
    const endedRef = useRef(false);

    useEffect(() => {
        let reduced = false;
        try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { /* default: animate */ }
        if (reduced) { endedRef.current = true; return; } // initializer already settled elapsed at the end
        let raf = 0;
        let start = 0;
        const tick = (ts: number) => {
            if (endedRef.current) return;
            if (!start) start = ts;
            const e = ts - start;
            if (e >= EVOLUTION_TOTAL_MS) { endedRef.current = true; setElapsed(EVOLUTION_TOTAL_MS); return; }
            setElapsed(e);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, []);

    const phase = evolutionPhaseAt(elapsed);
    const oldShown = isOldFormVisible(phase.beat);
    const newShown = isNewFormVisible(phase.beat);
    const flash = burstIntensity(phase);

    // Old form: rises and slowly turns while it charges into the tube.
    const oldRiseY = phase.beat === "ascend" ? -phase.progress * 40
        : phase.beat === "tube" ? -40 - phase.progress * 30
        : 0;
    const oldRotDeg = ascendRotation(phase) * RAD2DEG;
    const oldGlow = phase.beat === "charge" ? 0.4 + phase.progress * 0.6 : 1;
    const silhouette = phase.beat === "tube";

    // New form: scales in on reveal, then the full hero turntable.
    const newRotDeg = turntableRotation(phase) * RAD2DEG;
    const newScale = phase.beat === "reveal" ? 0.6 + phase.progress * 0.4 : 1;

    const handleSkip = () => { endedRef.current = true; setElapsed(EVOLUTION_TOTAL_MS); };

    const spriteFor = (src: string | undefined, name: string, transform: string, extraStyle: React.CSSProperties) => (
        <div className="pet-evo-sprite-wrap" style={{ transform, ...extraStyle }}>
            {src
                ? <img src={src} alt={name} className="pet-evo-sprite-img" draggable={false} />
                : <span className="pet-evo-sprite-initials">{initials(name)}</span>}
        </div>
    );

    return (
        <div className="pet-evo-cutscene" role="dialog" aria-label={`${oldName} is evolving`} onClick={phase.done ? onClose : undefined}>
            <style>{CUTSCENE_CSS}</style>

            {/* Tube of light — vertical column of rushing streaks during the morph. */}
            <div
                className={`pet-evo-tube${(phase.beat === "tube" || phase.beat === "ascend") ? " on" : ""}`}
                style={{ opacity: phase.beat === "tube" ? 0.9 : phase.beat === "ascend" ? 0.35 : 0 }}
                aria-hidden="true"
            />

            {/* Stage */}
            <div className="pet-evo-stage">
                {oldShown && spriteFor(oldImage, oldName, `translateY(${oldRiseY}px) rotateY(${oldRotDeg}deg)`, {
                    filter: silhouette
                        ? "brightness(0) invert(1) drop-shadow(0 0 24px #c4b5fd)"
                        : `drop-shadow(0 0 ${12 + oldGlow * 24}px rgba(167,139,250,${0.5 + oldGlow * 0.4}))`,
                    opacity: phase.beat === "tube" ? 1 - phase.progress * 0.2 : 1,
                })}

                {newShown && spriteFor(newImage ?? oldImage, pet.name, `rotateY(${newRotDeg}deg) scale(${newScale})`, {
                    filter: "drop-shadow(0 0 28px rgba(250,204,21,0.7)) drop-shadow(0 0 60px rgba(167,139,250,0.5))",
                })}
            </div>

            {/* White burst flash */}
            <div className="pet-evo-flash" style={{ opacity: flash }} aria-hidden="true" />

            {/* Name captions */}
            {showOldName(phase.beat) && <div className="pet-evo-name pet-evo-name-old">{oldName}</div>}
            {showNewName(phase.beat) && (
                <div className={`pet-evo-name pet-evo-name-new${phase.beat === "reveal" ? " slam" : ""}`}>
                    <span className="pet-evo-evolved-tag">EVOLVED!</span>
                    {pet.name}
                    <span className="pet-evo-rarity">{pet.rarity}</span>
                </div>
            )}

            {/* Controls */}
            {!phase.done && <button className="pet-evo-skip" onClick={handleSkip}>Skip ⏭</button>}
            {phase.done && <button className="pet-evo-continue" onClick={onClose}>Continue</button>}
        </div>
    );
}

const CUTSCENE_CSS = `
.pet-evo-cutscene {
    position: fixed; inset: 0; z-index: 9999;
    display: grid; place-items: center;
    background: radial-gradient(circle at 50% 45%, #1b1140 0%, #0a0618 60%, #050309 100%);
    overflow: hidden; perspective: 900px;
    animation: pet-evo-fadein 400ms ease both;
}
@keyframes pet-evo-fadein { from { opacity: 0; } to { opacity: 1; } }
.pet-evo-stage {
    position: relative; width: min(60vw, 360px); height: min(60vw, 360px);
    display: grid; place-items: center; transform-style: preserve-3d;
}
.pet-evo-sprite-wrap {
    position: absolute; width: 100%; height: 100%;
    display: grid; place-items: center; transform-style: preserve-3d;
    transition: filter 80ms linear;
}
.pet-evo-sprite-img { max-width: 100%; max-height: 100%; object-fit: contain; image-rendering: auto; }
.pet-evo-sprite-initials {
    font-size: clamp(48px, 14vw, 120px); font-weight: 800; color: #ede9fe;
    text-shadow: 0 0 24px #a78bfa;
}
.pet-evo-tube {
    position: absolute; top: -10%; left: 50%; transform: translateX(-50%);
    width: clamp(120px, 26vw, 240px); height: 120%;
    background: repeating-linear-gradient(180deg,
        rgba(196,181,253,0.0) 0px, rgba(196,181,253,0.55) 6px,
        rgba(250,204,21,0.35) 12px, rgba(196,181,253,0.0) 26px);
    filter: blur(2px) drop-shadow(0 0 30px #a78bfa);
    mix-blend-mode: screen; border-radius: 50%;
    transition: opacity 120ms linear;
}
.pet-evo-tube.on { animation: pet-evo-tube-rush 480ms linear infinite; }
@keyframes pet-evo-tube-rush { from { background-position-y: 0; } to { background-position-y: -52px; } }
.pet-evo-flash {
    position: absolute; inset: 0; background: #ffffff; pointer-events: none;
    transition: opacity 60ms linear; mix-blend-mode: screen;
}
.pet-evo-name {
    position: absolute; bottom: 14%; left: 0; right: 0; text-align: center;
    font-weight: 800; letter-spacing: 0.04em; padding: 0 16px;
    text-shadow: 0 2px 18px rgba(0,0,0,0.8);
}
.pet-evo-name-old { font-size: clamp(20px, 5vw, 34px); color: #c4b5fd; }
.pet-evo-name-new {
    font-size: clamp(24px, 6vw, 44px); color: #facc15;
    display: flex; flex-direction: column; gap: 4px;
}
.pet-evo-name-new.slam { animation: pet-evo-slam 360ms cubic-bezier(.2,1.4,.4,1) both; }
@keyframes pet-evo-slam { from { transform: scale(2.2); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.pet-evo-evolved-tag { font-size: 0.5em; letter-spacing: 0.3em; color: #a78bfa; }
.pet-evo-rarity { font-size: 0.45em; text-transform: uppercase; color: #fde68a; opacity: 0.85; letter-spacing: 0.2em; }
.pet-evo-skip {
    position: absolute; top: 16px; right: 16px; z-index: 2;
    background: rgba(255,255,255,0.12); color: #e2e8f0; border: 1px solid rgba(255,255,255,0.2);
    border-radius: 8px; padding: 6px 12px; font-size: 0.85rem; cursor: pointer;
}
.pet-evo-continue {
    position: absolute; bottom: 6%; left: 50%; transform: translateX(-50%); z-index: 2;
    background: linear-gradient(180deg, #7c3aed, #5b21b6); color: #fff; border: none;
    border-radius: 10px; padding: 10px 28px; font-size: 1rem; font-weight: 700; cursor: pointer;
    box-shadow: 0 0 24px rgba(124,58,237,0.7);
    animation: pet-evo-fadein 300ms ease both;
}
`;
