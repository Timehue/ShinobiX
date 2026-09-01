import {
    useCallback,
    useEffect,
    useId,
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
import {
    duckVnScore,
    resolveVnScoreKey,
    startVnScore,
    stopVnScore,
} from "../lib/vn-cinematic-score";
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
type TextSize = "default" | "large" | "xlarge";
type Contrast = "standard" | "high";

function initialAutoRead(): boolean {
    if (typeof window === "undefined") return false;
    try {
        return window.localStorage.getItem("vnAutoRead.v1") === "1";
    } catch {
        return false;
    }
}

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

function initialTextSize(): TextSize {
    if (typeof window === "undefined") return "default";
    try {
        const saved = window.localStorage.getItem("vnTextSize.v1");
        if (saved === "large" || saved === "xlarge") return saved;
    } catch { /* private mode */ }
    return "default";
}

function nextTextSize(size: TextSize): TextSize {
    if (size === "default") return "large";
    if (size === "large") return "xlarge";
    return "default";
}

function titleForTextSize(size: TextSize): string {
    if (size === "large") return "Text size: Large";
    if (size === "xlarge") return "Text size: Extra large";
    return "Text size: Default";
}

function initialContrast(): Contrast {
    if (typeof window === "undefined") return "standard";
    try {
        return window.localStorage.getItem("vnContrast.v1") === "high" ? "high" : "standard";
    } catch {
        return "standard";
    }
}

const FOCUSABLE_SELECTOR = [
    "button:not([disabled])",
    "a[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");
}

function ActorPortrait({ actor }: { actor: Actor }) {
    const [failedSource, setFailedSource] = useState("");
    const [aspect, setAspect] = useState<"tall" | "square" | "wide">("tall");
    const showImage = Boolean(actor.image) && failedSource !== actor.image;

    return showImage
        ? (
            <img
                src={actor.image}
                alt=""
                className={`cvn-avatar-${aspect}`}
                onLoad={(event) => {
                    const { naturalWidth, naturalHeight } = event.currentTarget;
                    const ratio = naturalHeight > 0 ? naturalWidth / naturalHeight : 0;
                    setAspect(ratio >= 1.18 ? "wide" : ratio >= .78 ? "square" : "tall");
                }}
                onError={() => setFailedSource(actor.image)}
            />
        )
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

function SettingsIcon() {
    return (
        <svg className="cvn-settings-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
            <path d="M12 8.1a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8Z" />
            <path d="m19.4 13.5 1.4 1.1-1.9 3.3-1.7-.7a8 8 0 0 1-1.7 1l-.2 1.8h-3.8l-.2-1.8a8 8 0 0 1-1.7-1l-1.7.7L6 14.6l1.4-1.1a8.6 8.6 0 0 1 0-2L6 10.4l1.9-3.3 1.7.7a8 8 0 0 1 1.7-1l.2-1.8h3.8l.2 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.9 3.3-1.4 1.1a8.6 8.6 0 0 1 0 2Z" />
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
    const [textSize, setTextSize] = useState<TextSize>(initialTextSize);
    const [contrast, setContrast] = useState<Contrast>(initialContrast);
    const [autoRead, setAutoRead] = useState(initialAutoRead);
    const textKey = `${eventId}:${pageIndex}:${lineIndex}:${spoken}`;
    const [typed, setTyped] = useState<{ key: string; count: number }>({ key: "", count: 0 });
    const [muted, setMuted] = useState(isAudioMuted);
    const [settingsOpenKey, setSettingsOpenKey] = useState("");
    const cuePlayedRef = useRef("");
    const lastCompleteRef = useRef(0);
    const rootRef = useRef<HTMLDivElement>(null);
    const settingsMenuId = useId();
    const immersive = surface === "immersive";
    const settingsKey = `${eventId}:${pageIndex}`;
    const settingsOpen = settingsOpenKey === settingsKey;
    const scoreKey = useMemo(() => resolveVnScoreKey(eventId, eventLabel), [eventId, eventLabel]);

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
        duckVnScore(effectiveCue);
        playVnCue(effectiveCue);
    }, [cueKey, effectiveCue]);

    useEffect(() => {
        startVnAmbience(presentation.ambience);
        startVnScore(scoreKey);
        fireCue();
    }, [fireCue, presentation.ambience, scoreKey]);

    useEffect(() => () => {
        stopVnAmbience(700);
        stopVnScore(900);
    }, []);

    const completeTyping = useCallback(() => {
        lastCompleteRef.current = Date.now();
        setTyped({ key: textKey, count: spoken.length });
    }, [spoken.length, textKey]);

    const cycleTextSpeed = useCallback(() => {
        setSpeed((current) => {
            const next = nextTextSpeed(current);
            try { window.localStorage.setItem("vnTextSpeed.v1", next); } catch { /* private mode */ }
            return next;
        });
    }, []);

    const cycleTextSize = useCallback(() => {
        setTextSize((current) => {
            const next = nextTextSize(current);
            try { window.localStorage.setItem("vnTextSize.v1", next); } catch { /* private mode */ }
            return next;
        });
    }, []);

    const toggleContrast = useCallback(() => {
        setContrast((current) => {
            const next = current === "standard" ? "high" : "standard";
            try { window.localStorage.setItem("vnContrast.v1", next); } catch { /* private mode */ }
            return next;
        });
    }, []);

    const toggleAutoRead = useCallback(() => {
        setAutoRead((current) => {
            const next = !current;
            try { window.localStorage.setItem("vnAutoRead.v1", next ? "1" : "0"); } catch { /* private mode */ }
            return next;
        });
    }, []);

    const advance = useCallback(() => {
        startVnAmbience(presentation.ambience);
        startVnScore(scoreKey);
        fireCue();
        if (!typingDone) {
            completeTyping();
            return;
        }
        if (!allowStageAdvance || Date.now() - lastCompleteRef.current < 240) return;
        onAdvance();
    }, [allowStageAdvance, completeTyping, fireCue, onAdvance, presentation.ambience, scoreKey, typingDone]);

    useEffect(() => {
        if (!autoRead || !typingDone || !allowStageAdvance || settingsOpen) return;
        const readingDelay = Math.min(6_800, Math.max(2_600, 1_400 + spoken.length * 32));
        const timer = window.setTimeout(() => {
            if (!document.hidden) advance();
        }, readingDelay);
        return () => window.clearTimeout(timer);
    }, [advance, allowStageAdvance, autoRead, settingsOpen, spoken.length, textKey, typingDone]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            const root = rootRef.current;
            if (!immersive && root && !root.contains(document.activeElement)) return;
            if (event.key === "Tab" && immersive) {
                if (!root) return;
                const focusable = focusableElements(root);
                if (!focusable.length) {
                    event.preventDefault();
                    root.focus();
                    return;
                }
                const active = document.activeElement;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (active === root || !(active instanceof Node) || !root.contains(active)) {
                    event.preventDefault();
                    (event.shiftKey ? last : first).focus();
                    return;
                }
                if (event.shiftKey && active === first) {
                    event.preventDefault();
                    last.focus();
                    return;
                }
                if (!event.shiftKey && active === last) {
                    event.preventDefault();
                    first.focus();
                }
                return;
            }
            if ((event.target as HTMLElement | null)?.closest?.("button, input, textarea, select")) return;
            if (event.key === "Escape") {
                event.preventDefault();
                if (settingsOpen) {
                    setSettingsOpenKey("");
                    return;
                }
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
    }, [advance, immersive, onCancel, settingsOpen]);

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
        `text-${textSize}`,
        `contrast-${contrast}`,
        !left.hidden ? "has-left-actor" : "",
        !right.hidden ? "has-right-actor" : "",
        presentation.titleCard && pageIndex === 0 ? "has-title-card" : "",
        eventId.toLowerCase().includes("moonshadow") ? "is-moonshadow" : "",
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
                rootRef.current?.focus({ preventScroll: true });
                const target = event.target as HTMLElement;
                if (settingsOpen && !target.closest(".cvn-settings-wrap")) {
                    setSettingsOpenKey("");
                    return;
                }
                if (target.closest("button, input, textarea, select, a")) return;
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
                        className="cvn-quiet-control cvn-desktop-setting"
                        onClick={cycleTextSpeed}
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
                            if (nextMuted) {
                                stopVnAmbience(250);
                                stopVnScore(250);
                            }
                            else {
                                startVnAmbience(presentation.ambience);
                                startVnScore(scoreKey);
                                fireCue();
                            }
                        }}
                    >
                        <AudioIcon muted={muted} />
                    </button>
                    {onUseClassicReader && (
                        <button
                            type="button"
                            className="cvn-quiet-control cvn-mode-control cvn-desktop-setting"
                            title="Use the lightweight classic visual-novel reader"
                            onClick={onUseClassicReader}
                        >
                            Classic
                        </button>
                    )}
                    <div className="cvn-settings-wrap">
                        <button
                            type="button"
                            className="cvn-icon-control cvn-settings-toggle"
                            aria-label="Visual novel settings"
                            aria-expanded={settingsOpen}
                            aria-controls={settingsMenuId}
                            onClick={() => {
                                setSettingsOpenKey((openKey) => openKey === settingsKey ? "" : settingsKey);
                            }}
                        >
                            <SettingsIcon />
                        </button>
                        {settingsOpen && (
                            <div id={settingsMenuId} className="cvn-settings-menu" role="group" aria-label="Reading settings">
                                <span className="cvn-settings-progress">
                                    Page {pageIndex + 1}/{pageCount} · Line {lineIndex + 1}/{lineCount}
                                </span>
                                <button type="button" onClick={cycleTextSpeed}>
                                    {titleForSpeed(speed)}
                                </button>
                                <button type="button" onClick={cycleTextSize}>
                                    {titleForTextSize(textSize)}
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={contrast === "high"}
                                    onClick={toggleContrast}
                                >
                                    Contrast: {contrast === "high" ? "High" : "Standard"}
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={autoRead}
                                    onClick={toggleAutoRead}
                                >
                                    Auto-read: {autoRead ? "On" : "Off"}
                                </button>
                                {onUseClassicReader && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSettingsOpenKey("");
                                            onUseClassicReader();
                                        }}
                                    >
                                        Classic reader
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
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
                <p className="cvn-dialogue-scene">{scene}</p>
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
                    {autoRead && typingDone && allowStageAdvance && (
                        <button
                            type="button"
                            className="cvn-auto-status"
                            title="Turn auto-read off"
                            onClick={toggleAutoRead}
                        >
                            Auto
                        </button>
                    )}
                    {!typingDone && <span className="cvn-tap-hint">Tap to reveal the line</span>}
                </div>
            </section>
        </div>
    );

    if (immersive && typeof document !== "undefined") return createPortal(content, document.body);
    return content;
}
