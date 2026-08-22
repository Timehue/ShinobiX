import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { playGameSfx } from "../lib/game-audio";

type ElementId = "fire" | "water" | "wind" | "earth" | "lightning";
type AwakeningMode = "awakening" | "reroll";
type CinematicPhase = "revealing" | "leaving" | "done";

type ElementPresentation = {
    id: ElementId;
    label: string;
    art: string;
};

const ELEMENT_PRESENTATION: Record<ElementId, ElementPresentation> = {
    fire: { id: "fire", label: "Fire", art: "/assets/awakening-element-fire-v1.webp" },
    water: { id: "water", label: "Water", art: "/assets/awakening-element-water-v1.webp" },
    wind: { id: "wind", label: "Wind", art: "/assets/awakening-element-wind-v1.webp" },
    earth: { id: "earth", label: "Earth", art: "/assets/awakening-element-earth-v1.webp" },
    lightning: { id: "lightning", label: "Lightning", art: "/assets/awakening-element-lightning-v1.webp" },
};

const ELEMENT_AUDIO_RATE: Record<ElementId, number> = {
    fire: 0.96,
    water: 0.88,
    wind: 1.07,
    earth: 0.82,
    lightning: 1.14,
};

function randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

function resolveElements(elements: readonly string[]): ElementPresentation[] {
    const seen = new Set<ElementId>();
    return elements.flatMap((element) => {
        const key = element.trim().toLowerCase() as ElementId;
        const presentation = ELEMENT_PRESENTATION[key];
        if (!presentation || seen.has(key)) return [];
        seen.add(key);
        return [presentation];
    });
}

function buildParticlePlan(elements: readonly ElementPresentation[]) {
    if (!elements.length) return [];
    return Array.from({ length: 42 }, (_, index) => {
        const element = elements[index % elements.length];
        return {
            id: `${element.id}-${index}`,
            element: element.id,
            angle: randomBetween(0, 360),
            distance: randomBetween(110, 410),
            size: randomBetween(2, 8),
            delay: randomBetween(180, 1_300),
            duration: randomBetween(900, 1_900),
        };
    });
}

function styleVars(values: Record<string, string>): CSSProperties {
    return values as CSSProperties;
}

/**
 * Presentation-only reward reveal for a successful Awakening Stone response.
 * The elements come from the committed server character, so the cinematic can
 * never reveal a different nature than the save actually received.
 */
export function CentralAwakeningCinematic({
    elements,
    mode,
    playerName,
    onFinished,
}: {
    elements: string[];
    mode: AwakeningMode;
    playerName?: string;
    onFinished: () => void;
}) {
    const reduceMotion = useMemo(
        () => typeof window !== "undefined"
            && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
        [],
    );
    const resolvedElements = useMemo(() => resolveElements(elements), [elements]);
    const primaryElement = resolvedElements[0]?.id;
    const particles = useMemo(() => buildParticlePlan(resolvedElements), [resolvedElements]);
    const [phase, setPhase] = useState<CinematicPhase>(reduceMotion ? "done" : "revealing");
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const onFinishedRef = useRef(onFinished);
    const timers = useRef<number[]>([]);

    useEffect(() => {
        onFinishedRef.current = onFinished;
    }, [onFinished]);

    const clearTimers = useCallback(() => {
        timers.current.forEach((timer) => window.clearTimeout(timer));
        timers.current = [];
    }, []);

    const complete = useCallback(() => {
        setPhase("done");
        onFinishedRef.current();
    }, []);

    const finish = useCallback(() => {
        if (phase === "done" || phase === "leaving") return;
        clearTimers();
        setPhase("leaving");
        timers.current.push(window.setTimeout(complete, 480));
    }, [clearTimers, complete, phase]);

    useEffect(() => {
        if (reduceMotion || !resolvedElements.length) {
            onFinishedRef.current();
            return;
        }
        if (!primaryElement) return;
        const audioRate = ELEMENT_AUDIO_RATE[primaryElement];
        playGameSfx("omen", { gain: 0.78, playbackRate: audioRate });
        timers.current.push(
            window.setTimeout(() => playGameSfx("reveal", { gain: 0.92, playbackRate: audioRate }), 620),
            window.setTimeout(() => playGameSfx("mythic", { gain: 0.88, playbackRate: audioRate }), 1_180),
            window.setTimeout(() => setPhase("leaving"), 3_450),
            window.setTimeout(complete, 3_980),
        );
        return clearTimers;
    }, [clearTimers, complete, primaryElement, reduceMotion, resolvedElements.length]);

    useEffect(() => {
        if (phase === "done") return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            finish();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [finish, phase]);

    const active = !reduceMotion && resolvedElements.length > 0 && phase !== "done";
    useEffect(() => {
        if (!active) return;
        const previousOverflow = document.body.style.overflow;
        previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        document.body.style.overflow = "hidden";
        overlayRef.current?.focus();
        return () => {
            document.body.style.overflow = previousOverflow;
            previousFocusRef.current?.focus();
        };
    }, [active]);

    if (!active || typeof document === "undefined") return null;

    const natureLabel = resolvedElements.map((element) => element.label).join(" · ");
    return createPortal(
        <div
            ref={overlayRef}
            className={`central-awakening-cinematic ${phase === "leaving" ? "is-leaving" : ""}`}
            data-mode={mode}
            data-element={primaryElement}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="central-awakening-title"
            aria-describedby="central-awakening-result"
        >
            <div className="central-awakening-backdrop" aria-hidden="true" />
            <div className="central-awakening-vignette" aria-hidden="true" />
            <div className="central-awakening-beam" aria-hidden="true" />

            <div className="central-awakening-stone" aria-hidden="true">
                <span className="central-awakening-stone__core" />
                <span className="central-awakening-stone__ring central-awakening-stone__ring--one" />
                <span className="central-awakening-stone__ring central-awakening-stone__ring--two" />
                <span className="central-awakening-stone__ring central-awakening-stone__ring--three" />
            </div>

            <div className="central-awakening-particles" aria-hidden="true">
                {particles.map((particle) => (
                    <i
                        className="central-awakening-particle"
                        data-element={particle.element}
                        key={particle.id}
                        style={styleVars({
                            "--awakening-angle": `${particle.angle.toFixed(1)}deg`,
                            "--awakening-distance": `${particle.distance.toFixed(1)}px`,
                            "--awakening-size": `${particle.size.toFixed(1)}px`,
                            "--awakening-delay": `${particle.delay.toFixed(0)}ms`,
                            "--awakening-duration": `${particle.duration.toFixed(0)}ms`,
                        })}
                    />
                ))}
            </div>

            <div className="central-awakening-sigils" data-count={resolvedElements.length} aria-hidden="true">
                {resolvedElements.map(({ id, art, label }, index) => (
                    <span
                        className="central-awakening-sigil"
                        data-element={id}
                        key={id}
                        style={styleVars({ "--awakening-sigil-delay": `${740 + index * 130}ms` })}
                    >
                        <img src={art} alt="" decoding="async" />
                        <small>{label}</small>
                    </span>
                ))}
            </div>

            <div className="central-awakening-title">
                <span className="central-awakening-kicker">
                    {mode === "reroll" ? "Chakra nature reforged" : "Chakra nature awakened"}
                </span>
                <h2 id="central-awakening-title">{resolvedElements.length === 1 ? `${natureLabel} Release` : "Elemental Convergence"}</h2>
                <div className="central-awakening-rule" aria-hidden="true"><span /></div>
                <p>{playerName ? `${playerName}'s new nature resonates.` : "A new nature resonates."}</p>
                <strong id="central-awakening-result">{natureLabel}</strong>
            </div>

            <button type="button" className="central-awakening-skip" onClick={finish}>
                Skip reveal
            </button>
        </div>,
        document.body,
    );
}
