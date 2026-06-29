/*
 * Pet evolution cutscene — the Digimon-style digivolution reveal (view).
 *
 * Cadence (owner-specified): the current pet starts to SPIN and washes to a
 * white glow → a big TUBE OF LIGHT rises around it → it keeps spinning (white
 * silhouette) inside the tube → the EVOLVED form cross-fades in (still spinning)
 * → the spin SLOWS DOWN → BOOM (white burst) → the new pet is revealed in colour.
 *
 * Driven by the pure timeline in lib/pet-evolution-cutscene.ts. The spin is ONE
 * continuous rotation that lands front-facing for the burst, so the flat sprite
 * is only edge-on while it is a glowing white silhouette (reads as energy). Both
 * forms render as two stacked layers — a full-COLOUR layer and a white-GLOW
 * silhouette layer — cross-faded by `whiteness`, sharing one spin transform.
 *
 * Implemented in CSS/3D-transforms (no react-three-fiber, no new deps). The
 * sprites MUST be clean transparent cutouts (PetYard feeds petPoseImage / the
 * /pet-evos art) — the silhouette filter would box an opaque-background image.
 *
 * Honors prefers-reduced-motion (jumps straight to the settled colour form).
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
    evolutionSpin,
    morphProgress,
    whiteness,
    tubeIntensity,
    tubeRise,
    tunnelIntensity,
    burstIntensity,
    morphScale,
} from "../lib/pet-evolution-cutscene";

const RAD2DEG = 180 / Math.PI;

function initials(name: string): string {
    return name.slice(0, 2).toUpperCase();
}

// White/cyan glowing SILHOUETTE of a transparent cutout (the energy form). Safe
// only because the cutscene is fed clean cutouts — an opaque-background image
// would box here. COLOUR layer is the normal sprite with a warm hero glow.
const SILHOUETTE_FILTER =
    "brightness(0) invert(1) drop-shadow(0 0 16px #a5f3fc) drop-shadow(0 0 40px #818cf8)";
const COLOR_GLOW_FILTER =
    "drop-shadow(0 0 26px rgba(250,204,21,0.7)) drop-shadow(0 0 64px rgba(167,139,250,0.55))";

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
    const oldShown = isOldFormVisible(phase.beat);
    const newShown = isNewFormVisible(phase.beat);
    const mp = morphProgress(phase);
    const white = whiteness(phase);
    const flash = burstIntensity(phase);
    const tunnel = tunnelIntensity(phase);
    const tube = tubeIntensity(phase);

    // One continuous spin + a slight grow, shared by both forms.
    const spinDeg = evolutionSpin(phase) * RAD2DEG;
    const scale = morphScale(phase);
    const spriteTransform = `rotateY(${spinDeg}deg) scale(${scale})`;

    // Cross-fade presence: old fades out across the morph, new fades in.
    const oldPresence = phase.beat === "morph" ? 1 - mp : 1;
    const newPresence = phase.beat === "morph" ? mp : 1;

    // The tube of light "comes up": slides into place as it brightens.
    const tubeTransform = `translateX(-50%) translateY(${(1 - tubeRise(phase)) * 42}%)`;

    const newSrc = newImage ?? oldImage;
    const handleSkip = () => { endedRef.current = true; setElapsed(EVOLUTION_TOTAL_MS); };

    const spriteInner = (src: string | undefined, name: string) =>
        src
            ? <img src={src} alt={name} className="pet-evo-sprite-img" draggable={false} />
            : <span className="pet-evo-sprite-initials">{initials(name)}</span>;

    // A form = two stacked layers (colour + white glow) sharing the spin transform.
    const formLayers = (src: string | undefined, name: string, presence: number) => presence <= 0 ? null : (
        <>
            <div className="pet-evo-sprite-wrap" style={{ transform: spriteTransform, filter: COLOR_GLOW_FILTER, opacity: presence * (1 - white) }}>
                {spriteInner(src, name)}
            </div>
            <div className="pet-evo-sprite-wrap" style={{ transform: spriteTransform, filter: SILHOUETTE_FILTER, opacity: presence * white }}>
                {spriteInner(src, name)}
            </div>
        </>
    );

    return (
        <div className="pet-evo-cutscene" role="dialog" aria-label={`${oldName} is evolving`} onClick={phase.done ? onClose : undefined}>
            <style>{CUTSCENE_CSS}</style>

            {/* Rushing data tunnel (backdrop) + the big TUBE OF LIGHT that rises and
                envelops the spinning pet — both intensities driven per-frame. */}
            <div className="pet-evo-tunnel" style={{ opacity: tunnel }} aria-hidden="true" />
            <div className="pet-evo-tube" style={{ opacity: tube, transform: tubeTransform }} aria-hidden="true" />

            {/* Stage */}
            <div className="pet-evo-stage">
                {oldShown && formLayers(oldImage, oldName, oldPresence)}
                {newShown && formLayers(newSrc, pet.name, newPresence)}
            </div>

            {/* White burst flash — the BOOM */}
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

/* Rushing data tunnel: speed-lines + scrolling scan grid, masked to a vignette. */
.pet-evo-tunnel {
    position: absolute; inset: -10%; pointer-events: none; mix-blend-mode: screen;
    background:
        repeating-linear-gradient(90deg, rgba(165,243,252,0) 0 7px, rgba(165,243,252,0.16) 7px 8px, rgba(165,243,252,0) 8px 18px),
        repeating-linear-gradient(0deg, rgba(129,140,248,0) 0 22px, rgba(129,140,248,0.22) 22px 24px, rgba(129,140,248,0) 24px 46px);
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
    width: clamp(190px, 46vw, 340px); height: 116%;
    pointer-events: none; mix-blend-mode: screen;
    background:
        repeating-linear-gradient(0deg, rgba(236,240,255,0) 0 6px, rgba(236,240,255,0.6) 6px 9px, rgba(236,240,255,0) 9px 19px),
        linear-gradient(90deg, rgba(129,140,248,0) 0%, rgba(165,180,252,0.5) 16%, rgba(224,231,255,0.78) 50%, rgba(165,180,252,0.5) 84%, rgba(129,140,248,0) 100%);
    border-radius: 46% / 8%;
    filter: blur(2px) drop-shadow(0 0 44px #818cf8) drop-shadow(0 0 90px #6d28d9);
    -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 14%, #000 86%, transparent 100%);
    mask-image: linear-gradient(180deg, transparent 0%, #000 14%, #000 86%, transparent 100%);
    animation: pet-evo-tube-rush 520ms linear infinite;
}
@keyframes pet-evo-tube-rush { from { background-position: 0 0, 0 0; } to { background-position: 0 -19px, 0 0; } }

.pet-evo-stage {
    position: relative; width: min(62vw, 380px); height: min(62vw, 380px);
    display: grid; place-items: center; transform-style: preserve-3d;
}
.pet-evo-sprite-wrap {
    position: absolute; width: 100%; height: 100%;
    display: grid; place-items: center; transform-style: preserve-3d;
    will-change: transform, opacity, filter;
}
.pet-evo-sprite-img { max-width: 100%; max-height: 100%; object-fit: contain; }
.pet-evo-sprite-initials {
    font-size: clamp(48px, 14vw, 120px); font-weight: 800; color: #ede9fe;
    text-shadow: 0 0 24px #a78bfa;
}

.pet-evo-flash { position: absolute; inset: 0; background: #ffffff; pointer-events: none; mix-blend-mode: screen; }

.pet-evo-name {
    position: absolute; bottom: 13%; left: 0; right: 0; text-align: center;
    font-weight: 800; letter-spacing: 0.04em; padding: 0 16px; text-shadow: 0 2px 18px rgba(0,0,0,0.85);
}
.pet-evo-name-old {
    font-size: clamp(20px, 5vw, 34px); color: #c4b5fd;
    animation: pet-evo-name-pulse 900ms ease-in-out infinite;
}
@keyframes pet-evo-name-pulse { 0%, 100% { opacity: 0.78; } 50% { opacity: 1; } }
.pet-evo-name-new { font-size: clamp(24px, 6vw, 44px); color: #facc15; display: flex; flex-direction: column; gap: 4px; }
.pet-evo-name-new.slam { animation: pet-evo-slam 420ms cubic-bezier(.2,1.4,.4,1) both; }
@keyframes pet-evo-slam { from { transform: scale(2.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
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
@media (prefers-reduced-motion: reduce) {
    .pet-evo-cutscene, .pet-evo-tunnel, .pet-evo-tube, .pet-evo-name-old, .pet-evo-name-new.slam, .pet-evo-continue {
        animation: none !important;
    }
}
`;
