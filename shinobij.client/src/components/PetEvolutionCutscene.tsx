/*
 * Pet evolution cutscene — the shinobi summoning reveal (view chrome).
 *
 * Cadence (owner-specified): the pet stands on the summoning seal in FULL COLOUR
 * and begins a slow turn → the white wash grows as the spin builds and a chakra
 * PILLAR OF LIGHT rises to envelop it → it spins fast as a white silhouette while
 * the EVOLVED form takes over inside the column → the spin decelerates and lands
 * facing the player → BOOM (shock-ring + smoke) → the pillar drops and the evolved
 * pet is revealed in colour, perfectly still.
 *
 * This file owns the DOM chrome only — backdrop, chakra pillar, flash, captions
 * and controls — all driven by the pure timeline in lib/pet-evolution-cutscene.ts.
 * The pets themselves are real rigged 3D models rendered by PetEvolutionStage3D.
 *
 * Honors prefers-reduced-motion (jumps straight to the settled colour form).
 */
import { useEffect, useRef, useState } from "react";
import type { Pet } from "../types/pet";
import {
    EVOLUTION_TOTAL_MS,
    evolutionPhaseAt,
    showOldName,
    showNewName,
    tubeIntensity,
    tubeRise,
    tunnelIntensity,
    burstIntensity,
} from "../lib/pet-evolution-cutscene";
import { PetEvolutionStage3D } from "./PetEvolutionStage3D";

export function PetEvolutionCutscene({
    pet,
    oldName,
    oldVisualId,
    oldImage,
    newImage,
    onClose,
}: {
    pet: Pet;
    oldName: string;
    oldVisualId: string;
    oldImage?: string;
    newImage?: string;
    onClose: () => void;
}) {
    const [elapsed, setElapsed] = useState<number>(() => {
        try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? EVOLUTION_TOTAL_MS : 0; }
        catch { return 0; }
    });
    const endedRef = useRef(false);

    useEffect(() => {
        let reduced = false;
        try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { /* default: animate */ }
        if (reduced) { endedRef.current = true; return; }
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
    const flash = burstIntensity(phase);
    const tunnel = tunnelIntensity(phase);
    const tube = tubeIntensity(phase);
    const reduced = typeof window !== "undefined" && !!window.matchMedia
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // The tube of light "comes up": slides into place as it brightens.
    const tubeTransform = `translateX(-50%) translateY(${(1 - tubeRise(phase)) * 42}%)`;

    const handleSkip = () => { endedRef.current = true; setElapsed(EVOLUTION_TOTAL_MS); };

    return (
        <div className="pet-evo-cutscene" role="dialog" aria-label={`${oldName} is evolving`} onClick={phase.done ? onClose : undefined}>
            <style>{CUTSCENE_CSS}</style>

            {/* Rushing data tunnel (backdrop) + the big TUBE OF LIGHT that rises and
                envelops the spinning pet — both intensities driven per-frame. */}
            <div className="pet-evo-tunnel" style={{ opacity: tunnel }} aria-hidden="true" />
            <div className="pet-evo-tube" style={{ opacity: tube, transform: tubeTransform }} aria-hidden="true" />

            {/* Stage */}
            <div className="pet-evo-stage">
                <PetEvolutionStage3D
                    phase={phase}
                    pet={pet}
                    oldVisualId={oldVisualId}
                    element={pet.element}
                    oldImage={oldImage}
                    newImage={newImage ?? oldImage}
                    reduced={reduced}
                />
            </div>

            {/* White burst flash — the BOOM. Capped below a full white-out so the
                3D shock-ring + starburst punch through it instead of being washed. */}
            <div className="pet-evo-flash" style={{ opacity: flash * 0.72 }} aria-hidden="true" />

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
    background: radial-gradient(circle at 50% 46%, #0b1a3a 0%, #060c1c 58%, #03060e 100%);
    overflow: hidden; perspective: 900px;
    animation: pet-evo-fadein 400ms ease both;
}
@keyframes pet-evo-fadein { from { opacity: 0; } to { opacity: 1; } }

/* Rushing data tunnel: speed-lines + scrolling scan grid, masked to a vignette. */
.pet-evo-tunnel {
    position: absolute; inset: -10%; pointer-events: none; mix-blend-mode: screen;
    background:
        repeating-linear-gradient(90deg, rgba(191,216,255,0) 0 13px, rgba(191,216,255,0.09) 13px 14px, rgba(191,216,255,0) 14px 30px);
    -webkit-mask-image: radial-gradient(circle at 50% 50%, #000 8%, rgba(0,0,0,0.35) 55%, transparent 82%);
    mask-image: radial-gradient(circle at 50% 50%, #000 8%, rgba(0,0,0,0.35) 55%, transparent 82%);
    animation: pet-evo-tunnel-rush 640ms linear infinite, pet-evo-tunnel-pulse 1100ms ease-in-out infinite;
}
@keyframes pet-evo-tunnel-rush { from { background-position: 0 0, 0 0; } to { background-position: 0 0, 0 -46px; } }
@keyframes pet-evo-tunnel-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }

/* The big TUBE OF LIGHT — a tall bright column of energy with white light streaks
   rushing UP inside it, a strong glow halo, and faded caps so it reads as a pillar
   the pet is enveloped in. Position/opacity driven per-frame (it rises into place). */
.pet-evo-tube {
    position: absolute; top: -8%; left: 50%;
    /* Wide enough to ENVELOP the pet — a quadruped's tail and haunches spread far
       past its shoulders, and a column narrower than the silhouette reads as the
       pet standing beside the light rather than inside it. */
    width: clamp(320px, 78vw, 660px); height: 116%;
    pointer-events: none; mix-blend-mode: screen;
    background:
        repeating-linear-gradient(0deg, rgba(236,244,255,0) 0 6px, rgba(236,244,255,0.6) 6px 9px, rgba(236,244,255,0) 9px 19px),
        linear-gradient(90deg, rgba(91,140,255,0) 0%, rgba(127,176,255,0.5) 16%, rgba(224,238,255,0.8) 50%, rgba(127,176,255,0.5) 84%, rgba(91,140,255,0) 100%);
    border-radius: 46% / 8%;
    filter: blur(2px) drop-shadow(0 0 44px #5b8cff) drop-shadow(0 0 90px #1e40af);
    -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 14%, #000 86%, transparent 100%);
    mask-image: linear-gradient(180deg, transparent 0%, #000 14%, #000 86%, transparent 100%);
    animation: pet-evo-tube-rush 520ms linear infinite;
}
@keyframes pet-evo-tube-rush { from { background-position: 0 0, 0 0; } to { background-position: 0 -19px, 0 0; } }

/* Full-bleed so the 3D Tron grid floor fills the frame (the camera frames the
   grounded pet at screen centre) instead of being boxed into a small square. */
.pet-evo-stage {
    position: absolute; inset: 0; width: 100%; height: 100%;
    display: grid; place-items: center; transform-style: preserve-3d;
}

.pet-evo-flash { position: absolute; inset: 0; background: #ffffff; pointer-events: none; mix-blend-mode: screen; }

.pet-evo-name {
    position: absolute; bottom: 13%; left: 0; right: 0; text-align: center;
    font-weight: 800; letter-spacing: 0.04em; padding: 0 16px; text-shadow: 0 2px 18px rgba(0,0,0,0.85);
}
.pet-evo-name-old {
    font-size: clamp(20px, 5vw, 34px); color: #a8c7ff;
    animation: pet-evo-name-pulse 900ms ease-in-out infinite;
}
@keyframes pet-evo-name-pulse { 0%, 100% { opacity: 0.78; } 50% { opacity: 1; } }
.pet-evo-name-new { font-size: clamp(24px, 6vw, 44px); color: var(--gold); display: flex; flex-direction: column; gap: 4px; }
.pet-evo-name-new.slam { animation: pet-evo-slam 420ms cubic-bezier(.2,1.4,.4,1) both; }
@keyframes pet-evo-slam { from { transform: scale(2.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.pet-evo-evolved-tag { font-size: 0.5em; letter-spacing: 0.3em; color: #8ab4ff; }
.pet-evo-rarity { font-size: 0.45em; text-transform: uppercase; color: var(--gold-300); opacity: 0.85; letter-spacing: 0.2em; }

.pet-evo-skip {
    position: absolute; top: 16px; right: 16px; z-index: 2;
    background: rgba(255,255,255,0.12); color: var(--slate-200); border: 1px solid rgba(255,255,255,0.2);
    border-radius: 8px; padding: 6px 12px; font-size: 0.85rem; cursor: pointer;
}
.pet-evo-continue {
    position: absolute; bottom: 6%; left: 50%; transform: translateX(-50%); z-index: 2;
    background: linear-gradient(180deg, #2563eb, #1e40af); color: #fff; border: none;
    border-radius: 10px; padding: 10px 28px; font-size: 1rem; font-weight: 700; cursor: pointer;
    box-shadow: 0 0 24px rgba(37,99,235,0.7);
    animation: pet-evo-fadein 300ms ease both;
}
@media (prefers-reduced-motion: reduce) {
    .pet-evo-cutscene, .pet-evo-tunnel, .pet-evo-tube, .pet-evo-name-old, .pet-evo-name-new.slam, .pet-evo-continue {
        animation: none !important;
    }
}
`;
