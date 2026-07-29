import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { isLowEndMobile, prefersReducedMotion } from "../lib/device-tier";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import { isAudioMuted, setAudioMuted, subscribeAudioMute } from "../lib/pet-music";
import { playVnCue, startVnAmbience, stopVnAmbience } from "../lib/vn-cinematic-sfx";
import type { ResolvedVnPresentation } from "../lib/vn-presentation";

type Actor = {
    name: string;
    image: string;
    initials: string;
    hidden?: boolean;
    speaking?: boolean;
    player?: boolean;
};

type TextSpeed = "normal" | "fast" | "instant";

function initialTextSpeed(): TextSpeed {
    if (typeof window === "undefined") return "normal";
    try {
        const saved = window.localStorage.getItem("vnTextSpeed.v1");
        if (saved === "fast" || saved === "instant") return saved;
    } catch { /* private mode */ }
    return "normal";
}

function nextTextSpeed(speed: TextSpeed): TextSpeed {
    if (speed === "normal") return "fast";
    if (speed === "fast") return "instant";
    return "normal";
}

function titleForSpeed(speed: TextSpeed): string {
    if (speed === "normal") return "Text: Normal";
    if (speed === "fast") return "Text: Fast";
    return "Text: Instant";
}

function ActorPortrait({ actor }: { actor: Actor }) {
    const [failedSource, setFailedSource] = useState("");
    const showImage = Boolean(actor.image) && failedSource !== actor.image;

    return showImage
        ? <img src={actor.image} alt="" onError={() => setFailedSource(actor.image)} />
        : <span aria-hidden="true">{actor.initials}</span>;
}

function AudioIcon({ muted }: { muted: boolean }) {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
            <path d="M4 9v6h4l5 4V5L8 9H4Z" />
            {muted
                ? <path d="m17 9 4 6m0-6-4 6" />
                : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />}
        </svg>
    );
}

export function CinematicVisualNovelStage({
    eventId,
    eventLabel,
    pageTitle,
    scene,
    speaker,
    spoken,
    pageIndex,
    pageCount,
    lineIndex,
    lineCount,
    left,
    right,
    presentation,
    surface = "immersive",
    allowStageAdvance,
    decisionPoint = false,
    onUseClassicReader,
    onAdvance,
    onCancel,
    renderFooter,
}: {
    eventId: string;
    eventLabel: string;
    pageTitle: string;
    scene: string;
    speaker: string;
    spoken: string;
    pageIndex: number;
    pageCount: number;
    lineIndex: number;
    lineCount: number;
    left: Actor;
    right: Actor;
    presentation: ResolvedVnPresentation;
    surface?: "immersive" | "preview";
    allowStageAdvance: boolean;
    decisionPoint?: boolean;
    onUseClassicReader?: () => void;
    onAdvance: () => void;
    onCancel: () => void;
    renderFooter: (typingDone: boolean) => ReactNode;
}) {
    const reduced = prefersReducedMotion();
    const liteFx = isLowEndMobile();
    const [speed, setSpeed] = useState<TextSpeed>(initialTextSpeed);
    const textKey = `${eventId}:${pageIndex}:${lineIndex}:${spoken}`;
    const [typed, setTyped] = useState<{ key: string; count: number }>({ key: "", count: 0 });
    const [muted, setMuted] = useState(isAudioMuted);
    const cuePlayedRef = useRef("");
    const lastCompleteRef = useRef(0);
    const rootRef = useRef<HTMLDivElement>(null);
    const immersive = surface === "immersive";

    useBodyScrollLock(immersive);

    useEffect(() => subscribeAudioMute(() => setMuted(isAudioMuted())), []);
    useEffect(() => {
        if (!immersive) return;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const animationFrame = window.requestAnimationFrame(() => rootRef.current?.focus());
        return () => {
            window.cancelAnimationFrame(animationFrame);
            previousFocus?.focus();
        };
    }, [immersive]);

    const instant = reduced || speed === "instant";
    const typedCount = instant
        ? spoken.length
        : typed.key === textKey
            ? typed.count
            : 0;
    const typingDone = typedCount >= spoken.length;
    const displayed = instant ? spoken : spoken.slice(0, typedCount);

    useEffect(() => {
        if (!spoken || instant) return;
        const increment = speed === "fast" ? 3 : 2;
        const interval = speed === "fast" ? 14 : 23;
        let count = 0;
        const id = window.setInterval(() => {
            count = Math.min(spoken.length, count + increment);
            setTyped({ key: textKey, count });
            if (count >= spoken.length) window.clearInterval(id);
        }, interval);
        return () => window.clearInterval(id);
    }, [instant, speed, spoken, textKey]);

    const effectiveCue = decisionPoint && typingDone ? "decision" : presentation.cue;
    const cueKey = `${eventId}:${pageIndex}:${lineIndex}:${effectiveCue}`;
    const fireCue = useCallback(() => {
        if (effectiveCue === "none" || isAudioMuted() || cuePlayedRef.current === cueKey) return;
        cuePlayedRef.current = cueKey;
        playVnCue(effectiveCue);
    }, [cueKey, effectiveCue]);

    useEffect(() => {
        startVnAmbience(presentation.ambience);
        fireCue();
    }, [fireCue, presentation.ambience]);

    useEffect(() => () => stopVnAmbience(700), []);

    const completeTyping = useCallback(() => {
        lastCompleteRef.current = Date.now();
        setTyped({ key: textKey, count: spoken.length });
    }, [spoken.length, textKey]);

    const advance = useCallback(() => {
        startVnAmbience(presentation.ambience);
        fireCue();
        if (!typingDone) {
            completeTyping();
            return;
        }
        if (!allowStageAdvance || Date.now() - lastCompleteRef.current < 240) return;
        onAdvance();
    }, [allowStageAdvance, completeTyping, fireCue, onAdvance, presentation.ambience, typingDone]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            if ((event.target as HTMLElement | null)?.closest?.("button, input, textarea, select")) return;
            if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
                return;
            }
            if (event.key === "Enter" || event.key === " " || event.key === "ArrowRight") {
                event.preventDefault();
                advance();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [advance, onCancel]);

    const actorClass = (side: "left" | "right", actor: Actor) => [
        "cvn-actor",
        `is-${side}`,
        actor.speaking ? "is-speaking" : "is-listening",
        actor.player ? "is-player" : "",
        `enters-${presentation.actorEntrance}`,
    ].filter(Boolean).join(" ");

    const rootClass = [
        "cvn-root",
        immersive ? "is-immersive" : "is-preview",
        presentation.premium ? "is-premium" : "is-automatic",
        `tone-${presentation.tone}`,
        `shot-${presentation.shot}`,
        `focus-${presentation.focus}`,
        `transition-${presentation.transition}`,
        `impact-${presentation.impact}`,
        reduced ? "is-reduced" : "",
        liteFx ? "is-lite" : "",
    ].filter(Boolean).join(" ");

    const rootStyle = useMemo(() => ({
        "--cvn-background": presentation.backgroundImage ? `url("${presentation.backgroundImage}")` : "none",
        "--cvn-background-position": presentation.backgroundPosition,
    } as CSSProperties), [presentation.backgroundImage, presentation.backgroundPosition]);

    const atmosphere = !reduced && !liteFx && presentation.atmosphere !== "none";
    const content = (
        <div
            ref={rootRef}
            className={rootClass}
            style={rootStyle}
            role="dialog"
            tabIndex={-1}
            aria-modal={immersive ? "true" : undefined}
            aria-label={`${pageTitle} visual novel scene`}
            onPointerDown={(event) => {
                if ((event.target as HTMLElement).closest("button, input, textarea, select, a")) return;
                advance();
            }}
        >
            <div className={`cvn-backdrop motion-${presentation.backgroundMotion}`} aria-hidden="true" />
            <div className="cvn-depth-haze" aria-hidden="true" />
            {atmosphere && (
                <div className={`cvn-atmosphere atmosphere-${presentation.atmosphere}`} aria-hidden="true">
                    {Array.from({ length: 14 }, (_, index) => (
                        <i key={index} />
                    ))}
                </div>
            )}
            <div className="cvn-color-grade" aria-hidden="true" />
            <div className="cvn-vignette" aria-hidden="true" />
            <div className="cvn-letterbox is-top" aria-hidden="true" />
            <div className="cvn-letterbox is-bottom" aria-hidden="true" />

            <header className="cvn-topbar">
                <div className="cvn-chapter-mark">
                    <span>{eventLabel}</span>
                    <strong>{pageTitle}</strong>
                </div>
                <div className="cvn-top-actions">
                    <span className="cvn-progress" aria-label={`Page ${pageIndex + 1} of ${pageCount}, line ${lineIndex + 1} of ${lineCount}`}>
                        {String(pageIndex + 1).padStart(2, "0")} / {String(pageCount).padStart(2, "0")}
                    </span>
                    <button
                        type="button"
                        className="cvn-quiet-control"
                        onClick={() => {
                            const next = nextTextSpeed(speed);
                            setSpeed(next);
                            try { window.localStorage.setItem("vnTextSpeed.v1", next); } catch { /* private mode */ }
                        }}
                    >
                        {titleForSpeed(speed)}
                    </button>
                    <button
                        type="button"
                        className="cvn-icon-control"
                        aria-label={muted ? "Unmute game audio" : "Mute game audio"}
                        title={muted ? "Unmute game audio" : "Mute game audio"}
                        onClick={() => {
                            const nextMuted = !muted;
                            setAudioMuted(nextMuted);
                            setMuted(nextMuted);
                            if (nextMuted) stopVnAmbience(250);
                            else {
                                startVnAmbience(presentation.ambience);
                                fireCue();
                            }
                        }}
                    >
                        <AudioIcon muted={muted} />
                    </button>
                    {onUseClassicReader && (
                        <button
                            type="button"
                            className="cvn-quiet-control"
                            title="Use the lightweight classic visual-novel reader"
                            onClick={onUseClassicReader}
                        >
                            Classic
                        </button>
                    )}
                    <button type="button" className="cvn-skip" onClick={onCancel}>Skip</button>
                </div>
            </header>

            {presentation.titleCard && pageIndex === 0 && (
                <div className="cvn-title-card" aria-hidden="true">
                    <span>{eventLabel}</span>
                    <strong>{pageTitle}</strong>
                </div>
            )}

            <main className="cvn-stage">
                {!left.hidden && (
                    <figure className={actorClass("left", left)}>
                        <ActorPortrait actor={left} />
                        <figcaption>{left.name.toLowerCase() === "player" ? "You" : left.name}</figcaption>
                    </figure>
                )}
                {!right.hidden && (
                    <figure className={actorClass("right", right)}>
                        <ActorPortrait actor={right} />
                        <figcaption>{right.name.toLowerCase() === "player" ? "You" : right.name}</figcaption>
                    </figure>
                )}
                <p className="cvn-scene-caption">{scene}</p>
            </main>

            <section className="cvn-dialogue-shell">
                <span className="cvn-sr-only" aria-live="polite" aria-atomic="true">
                    {speaker}: {spoken}
                </span>
                <div className="cvn-speaker">{speaker}</div>
                <p className="cvn-dialogue-text">
                    {displayed}
                    {!typingDone && <span className="cvn-caret" aria-hidden="true" />}
                </p>
                <div className="cvn-dialogue-footer">
                    {renderFooter(typingDone)}
                    {!typingDone && <span className="cvn-tap-hint">Tap to reveal the line</span>}
                </div>
            </section>
        </div>
    );

    if (immersive && typeof document !== "undefined") return createPortal(content, document.body);
    return content;
}
