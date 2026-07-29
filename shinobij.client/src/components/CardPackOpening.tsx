/**
 * CardPackOpening — full-screen pack-ripping cinematic shown after a card-pack
 * purchase settles on the server. Pure presentation: by the time this mounts
 * the save already owns the cards (updateCharacter already ran), so closing
 * early, skipping, or refreshing loses nothing but the show.
 *
 * Flow: foil pack floats in → the player swipes across the perforation (or
 * taps the Tear Open fallback) → the strip flies off and the face-down stack
 * pops out → each tap flips a card with a rarity-scaled flourish → summary fan
 * with NEW badges and an "open another" shortcut.
 *
 * Styles live in ../styles/card-pack-opening.css, imported by Shop.tsx — the
 * screen chunk owns the CSS import; component modules must stay CSS-free so
 * node tests can import them. Portaled to <body> at z-index 1000000 per the
 * overlay pattern (the fixed nav/side rails paint over anything inside
 * <main>). Sounds use the shared, sample-based Chronicle mix.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { ChronicleCardView } from "./ChronicleCardView";
import type { ChronicleDisplayCard } from "../lib/chronicle-duel";
import type { CardPackType } from "../lib/card-pack";
import {
    RARITY_ACCENT,
    packArtUrl,
    packParticles,
    packTheme,
    planPackReveal,
    rarityTier,
    revealSfxForRarity,
} from "../lib/card-pack-reveal";
import { playChronicleSfx, primeChronicleSfx } from "../lib/chronicle-sfx";
import { isLowEndMobile } from "../lib/device-tier";

type Phase = "pack" | "tearing" | "reveal" | "summary";

const SPARKS_BY_TIER = [6, 9, 14, 20, 26];
const RARITY_CALLOUT: Record<number, string> = {
    0: "Common",
    1: "Rare",
    2: "Epic",
    3: "Legendary Pull",
    4: "Mythic Pull ✦",
};

export function CardPackOpening({
    packType,
    cards,
    cardsById,
    ownedBefore,
    onClose,
    onOpenAnother,
    openAnotherLabel,
    openAnotherDisabled,
}: {
    packType: CardPackType;
    /** Card ids in server order — the reveal re-sorts so the rarest flips last. */
    cards: string[];
    cardsById: Record<string, ChronicleDisplayCard>;
    /** Owned-copy counts BEFORE this pack was applied (drives the NEW badges). */
    ownedBefore: ReadonlyMap<string, number>;
    onClose: () => void;
    onOpenAnother?: () => void;
    openAnotherLabel?: string;
    openAnotherDisabled?: boolean;
}) {
    const theme = useMemo(() => packTheme(packType), [packType]);
    const plan = useMemo(
        () => planPackReveal(cards, (id) => cardsById[id]?.rarity, ownedBefore),
        [cards, cardsById, ownedBefore],
    );
    const [phase, setPhase] = useState<Phase>(plan.length ? "pack" : "summary");
    const [idx, setIdx] = useState(0);
    const [flipped, setFlipped] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [snapping, setSnapping] = useState(false);
    /** Index into `plan` of the summary card being read full-size, if any. */
    const [inspect, setInspect] = useState<number | null>(null);

    const reduceMotion = useMemo(
        () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
        [],
    );
    const lite = useMemo(() => isLowEndMobile(), []);

    useEffect(() => {
        primeChronicleSfx();
    }, []);

    // Pending timers — cleared on unmount so a fast close never fires stale
    // phase changes into an unmounted component.
    const timers = useRef<number[]>([]);
    useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
    const later = (fn: () => void, ms: number) => {
        timers.current.push(window.setTimeout(fn, ms));
    };

    // Lock body scroll while the cinematic is up (mirrors ui/Modal.tsx).
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, []);

    // Escape closes the card reader first, then skips to the summary, then
    // closes. The purchase is already settled, so skipping never loses cards.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            if (inspect !== null) setInspect(null);
            else if (phase === "summary") onClose();
            else setPhase("summary");
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [phase, onClose, inspect]);

    // A soft glint as the summary fans out — always downstream of a user tap,
    // so the AudioContext is already unlocked.
    useEffect(() => {
        if (phase === "summary" && plan.length > 0) playChronicleSfx("reveal-rare");
    }, [phase, plan.length]);

    // Vibration is motion feedback — skip it with prefers-reduced-motion.
    const buzz = (pattern: number | number[]) => {
        if (reduceMotion) return;
        try {
            navigator.vibrate?.(pattern);
        } catch {
            /* unsupported */
        }
    };

    // Focus the (non-interactive) overlay itself, NOT the Skip button: the
    // purchase click often comes from a keyboard Enter, and Enter repeats on
    // keydown — focusing a button here would let a held Enter skip the whole
    // cinematic before the player sees it.
    const overlayRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        overlayRef.current?.focus();
    }, []);

    // The chronicle card is designed at a fixed 252×353 px; scale the whole
    // stage so it fills phones and desktops alike without reflowing the card.
    const [scale, setScale] = useState(1);
    const [sumScale, setSumScale] = useState(0.45);
    useEffect(() => {
        const compute = () => {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            setScale(Math.max(0.55, Math.min(1.25, (vw * 0.82) / 252, (vh * 0.5) / 353)));
            const count = Math.max(1, plan.length);
            const cols = Math.min(count, vw > 880 ? 5 : 3);
            setSumScale(
                Math.max(0.32, Math.min(count <= 2 ? 0.62 : 0.5, (vw * 0.86) / (cols * 268))),
            );
        };
        compute();
        window.addEventListener("resize", compute);
        return () => window.removeEventListener("resize", compute);
    }, [plan.length]);

    // ------------------------------------------------------ tear gesture ---
    // Live drag positions are written straight to CSS vars on the foil node so
    // pointermove never re-renders the tree; React state only tracks the
    // coarse dragging/snapping flags for class toggles.
    const foilRef = useRef<HTMLDivElement | null>(null);
    const dragState = useRef<{ startX: number; lastX: number; active: boolean } | null>(null);

    const setTearVars = (x: number) => {
        const el = foilRef.current;
        if (!el) return;
        const w = el.offsetWidth || 280;
        el.style.setProperty("--tear-x", `${x}px`);
        el.style.setProperty("--tear-p", `${Math.min(1, Math.abs(x) / (w * 0.42))}`);
    };

    const completeTear = (dir: 1 | -1) => {
        foilRef.current?.style.setProperty("--tear-dir", `${dir}`);
        playChronicleSfx("pack-tear");
        buzz(20);
        setDragging(false);
        setPhase("tearing");
        // Functional update: if the player skips to the summary while the
        // tear animation plays, this queued advance must not yank them back.
        const advance = () => setPhase((p) => (p === "tearing" ? "reveal" : p));
        if (reduceMotion) {
            later(advance, 60);
            return;
        }
        later(() => playChronicleSfx("pack-pop"), 380);
        later(advance, 1050);
    };

    const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (phase !== "pack") return;
        dragState.current = { startX: event.clientX, lastX: 0, active: true };
        setDragging(true);
        setSnapping(false);
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            /* pointer already released — the move/up handlers still work */
        }
    };
    const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragState.current;
        if (!drag?.active) return;
        drag.lastX = event.clientX - drag.startX;
        setTearVars(drag.lastX);
    };
    const onPointerEnd = () => {
        const drag = dragState.current;
        if (!drag?.active) return;
        drag.active = false;
        const width = foilRef.current?.offsetWidth ?? 280;
        if (Math.abs(drag.lastX) > width * 0.42) {
            completeTear(drag.lastX < 0 ? -1 : 1);
        } else {
            setDragging(false);
            setSnapping(true);
            setTearVars(0);
        }
    };

    // ------------------------------------------------------- card reveal ---
    const current = plan[idx];
    const currentCard = current ? cardsById[current.id] : undefined;
    const tier = rarityTier(currentCard?.rarity);
    const accent = RARITY_ACCENT[currentCard?.rarity ?? ""] ?? "#cfd8e3";
    const sparkCount = Math.round(SPARKS_BY_TIER[tier] * (lite ? 0.5 : 1));
    const sparks = useMemo(
        () => packParticles(idx * 31 + plan.length * 7, sparkCount),
        [idx, plan.length, sparkCount],
    );

    // Brief lockout after a flip so an eager double-tap cannot dismiss a card
    // mid-rotation — the reveal should always land before it can be waved on.
    const flipLockRef = useRef(false);

    const onCardTap = () => {
        if (phase !== "reveal" || leaving || !current) return;
        if (!flipped) {
            setFlipped(true);
            flipLockRef.current = true;
            later(() => {
                flipLockRef.current = false;
            }, reduceMotion ? 0 : 450);
            playChronicleSfx("card-flip");
            buzz(8);
            const sting = revealSfxForRarity(currentCard?.rarity);
            const stingTier = rarityTier(currentCard?.rarity);
            if (sting)
                later(() => {
                    playChronicleSfx(sting);
                    if (stingTier >= 3) buzz(stingTier >= 4 ? [16, 60, 16, 60, 30] : [12, 60, 24]);
                }, reduceMotion ? 0 : 280);
            return;
        }
        if (flipLockRef.current) return;
        if (idx + 1 >= plan.length) {
            setPhase("summary");
            return;
        }
        if (reduceMotion) {
            setFlipped(false);
            setIdx((i) => i + 1);
            return;
        }
        setLeaving(true);
        later(() => {
            setLeaving(false);
            setFlipped(false);
            setIdx((i) => i + 1);
        }, 400);
    };

    const revealedCount = idx + (flipped ? 1 : 0);
    const showPack = phase === "pack" || phase === "tearing";
    const showStack = phase === "tearing" || phase === "reveal";

    const overlayVars = {
        "--pack-accent": theme.accent,
        "--pack-foil-a": theme.foilA,
        "--pack-foil-b": theme.foilB,
        "--pack-art": `url("${packArtUrl(packType)}")`,
        "--card-scale": scale,
        "--sum-scale": sumScale,
    } as CSSProperties;

    return createPortal(
        <div
            ref={overlayRef}
            tabIndex={-1}
            className={`pack-open-overlay${lite ? " lite" : ""}`}
            style={overlayVars}
            role="dialog"
            aria-modal="true"
            aria-label={`${theme.label} opening`}
        >
            <div className="pack-open-dust" aria-hidden="true" />
            {phase === "reveal" && flipped && tier >= 3 && (
                <div
                    key={`vignette-${idx}`}
                    className="pack-open-vignette pulse"
                    style={{ "--fx-accent": accent } as CSSProperties}
                    aria-hidden="true"
                />
            )}

            <div className="pack-open-topbar">
                <div className="pack-open-title">
                    {theme.label}
                    {phase === "reveal" && plan.length > 1 && (
                        <span className="pack-open-count">
                            {Math.min(revealedCount, plan.length)} / {plan.length}
                        </span>
                    )}
                </div>
                <button
                    type="button"
                    className="pack-open-skip"
                    onClick={() => (phase === "summary" ? onClose() : setPhase("summary"))}
                >
                    {phase === "summary" ? "Close ✕" : "Skip ▸▸"}
                </button>
            </div>

            {showPack && !lite && <div className="pack-open-backrays" aria-hidden="true" />}
            <div className={`pack-open-stage${phase === "tearing" ? " is-torn" : ""}`}>
                {showStack && (
                    <div className="pack-reveal">
                        <div className={`pack-reveal__stage${phase === "tearing" ? " rising" : ""}`}>
                            {plan.slice(idx, idx + 4).map((entry, depth) => {
                                const isTop = depth === 0 && phase === "reveal";
                                const flippedNow = isTop && flipped;
                                const card = cardsById[entry.id];
                                // Pocket-style anticipation: a big pull makes the
                                // face-down card itself glow before the flip.
                                const charged = isTop && !flipped && !leaving && tier >= 3;
                                return (
                                    <div
                                        key={`${idx + depth}-${entry.id}`}
                                        className={`pack-card${flippedNow ? " is-flipped" : ""}${isTop && leaving ? " is-leaving" : ""}${charged ? ` is-charged${tier >= 4 ? " is-charged-mythic" : ""}` : ""}`}
                                        data-depth={depth}
                                        style={{ zIndex: 4 - depth }}
                                    >
                                        {isTop ? (
                                            <button
                                                type="button"
                                                className="pack-card-hit"
                                                onClick={onCardTap}
                                                aria-label={
                                                    flippedNow
                                                        ? `${card?.name ?? entry.id} revealed — continue`
                                                        : "Flip the top card"
                                                }
                                            >
                                                <span className="pack-card__inner">
                                                    <span className="pack-card__face back">
                                                        <ChronicleCardView hidden />
                                                    </span>
                                                    <span className="pack-card__face front">
                                                        {card ? (
                                                            <ChronicleCardView card={card} />
                                                        ) : (
                                                            <span className="pack-card__missing">{entry.id}</span>
                                                        )}
                                                    </span>
                                                </span>
                                            </button>
                                        ) : (
                                            <span className="pack-card__inner">
                                                <span className="pack-card__face back">
                                                    <ChronicleCardView hidden />
                                                </span>
                                            </span>
                                        )}
                                        {flippedNow && entry.isNew && (
                                            <span className="pack-card__new" aria-hidden="true">
                                                NEW
                                            </span>
                                        )}
                                        {flippedNow && !reduceMotion && (
                                            <span
                                                key={`fx-${idx}`}
                                                className="pack-card__fx"
                                                style={{ "--fx-accent": accent } as CSSProperties}
                                                aria-hidden="true"
                                            >
                                                <span className="pack-fx__flash" />
                                                {tier >= 1 && <span className="pack-fx__ring" />}
                                                {tier >= 2 && (
                                                    <span
                                                        className={`pack-fx__rays${tier >= 4 ? " mythic" : ""}`}
                                                    />
                                                )}
                                                {sparks.map((p, i) => (
                                                    <span
                                                        key={i}
                                                        className="pack-fx__spark"
                                                        style={
                                                            {
                                                                "--dx": `${p.dx}px`,
                                                                "--dy": `${p.dy}px`,
                                                                "--pd": `${p.delay}ms`,
                                                                "--pt": `${p.duration}ms`,
                                                                "--ps": `${p.size}px`,
                                                            } as CSSProperties
                                                        }
                                                    />
                                                ))}
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                            {phase === "reveal" && flipped && !leaving && (
                                <div
                                    key={`rarity-${idx}`}
                                    className="pack-reveal__rarity"
                                    style={{ "--fx-accent": accent } as CSSProperties}
                                >
                                    {RARITY_CALLOUT[tier]}
                                </div>
                            )}
                        </div>
                        <div className="pack-reveal__hint">
                            {phase === "reveal" && !flipped && idx === 0 ? "Tap the card to reveal" : " "}
                        </div>
                        <div className="pack-reveal__dots" aria-hidden="true">
                            {plan.map((_, i) => (
                                <span key={i} className={i < revealedCount ? "done" : ""} />
                            ))}
                        </div>
                    </div>
                )}

                {showPack && (
                    <div className="pack-open-wrap">
                        <div
                            ref={foilRef}
                            className={`pack-foil${dragging ? " is-dragging" : ""}${snapping ? " is-snapping" : ""}`}
                            onPointerDown={onPointerDown}
                            onPointerMove={onPointerMove}
                            onPointerUp={onPointerEnd}
                            onPointerCancel={onPointerEnd}
                            aria-hidden="true"
                        >
                            <div className="pack-foil__body">
                                <div className="pack-foil__art" aria-hidden="true" />
                                <div className="pack-foil__wordmark">
                                    SHINOBI JOURNEY
                                    <small>CHRONICLE SHOWDOWN</small>
                                </div>
                                <div />
                                <div className="pack-foil__ribbon">
                                    {theme.label} · {plan.length} card{plan.length === 1 ? "" : "s"}
                                </div>
                                <div className="pack-foil__crimp" />
                            </div>
                            <div className="pack-foil__tearstrip">
                                <div className="pack-foil__crimp" />
                            </div>
                            <div className="pack-foil__tearline" />
                            <div className="pack-foil__sheen" />
                        </div>
                        {phase === "pack" && (
                            <>
                                <div className="pack-open-hint">Swipe across the seal to tear</div>
                                <button
                                    type="button"
                                    className="pack-open-tearbtn"
                                    onClick={() => completeTear(1)}
                                >
                                    ✂ Tear Open
                                </button>
                            </>
                        )}
                    </div>
                )}

                {phase === "summary" && (
                    <div className="pack-summary">
                        <div className="pack-summary__head">
                            <h2>Your Pull</h2>
                            <p>
                                {theme.label} — {plan.length} card{plan.length === 1 ? "" : "s"}
                            </p>
                        </div>
                        <div className="pack-summary__row">
                            {plan.map((entry, i) => {
                                const card = cardsById[entry.id];
                                const cardTier = rarityTier(card?.rarity);
                                return (
                                    <button
                                        key={`${i}-${entry.id}`}
                                        type="button"
                                        className={`pack-summary__card${cardTier >= 3 ? ` aura-${cardTier}` : ""}`}
                                        style={
                                            {
                                                "--i": i,
                                                "--fan": `${(i - (plan.length - 1) / 2) * 2.2}deg`,
                                            } as CSSProperties
                                        }
                                        onClick={() => setInspect(i)}
                                        aria-label={`Read ${card?.name ?? entry.id} full size`}
                                    >
                                        <span className="pack-summary__cardinner">
                                            {card ? (
                                                <ChronicleCardView card={card} />
                                            ) : (
                                                <span className="pack-card__missing">{entry.id}</span>
                                            )}
                                        </span>
                                        {entry.isNew && <span className="pack-card__new">NEW</span>}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="pack-summary__actions">
                            {onOpenAnother && (
                                <button
                                    type="button"
                                    className="pack-btn"
                                    disabled={openAnotherDisabled}
                                    onClick={onOpenAnother}
                                >
                                    {openAnotherLabel ?? "Open Another"}
                                </button>
                            )}
                            <button type="button" className="pack-btn primary" onClick={onClose}>
                                Done ✓
                            </button>
                        </div>
                        <p className="pack-summary__tip">Tap a card to read it full size</p>
                    </div>
                )}
            </div>

            {inspect !== null && plan[inspect] && (
                <div
                    className="pack-inspect"
                    role="dialog"
                    aria-label="Card reader"
                    onClick={() => setInspect(null)}
                >
                    <div className="pack-inspect__card">
                        {cardsById[plan[inspect].id] ? (
                            <ChronicleCardView card={cardsById[plan[inspect].id]} />
                        ) : (
                            <span className="pack-card__missing">{plan[inspect].id}</span>
                        )}
                    </div>
                    <div className="pack-inspect__codex">
                        <strong>{cardsById[plan[inspect].id]?.name ?? plan[inspect].id}</strong>
                        <span>
                            {(cardsById[plan[inspect].id]?.rarity ?? "common").toUpperCase()}
                            {plan[inspect].isNew ? " · NEW TO YOUR COLLECTION" : ""}
                        </span>
                        <small>Tap anywhere to close</small>
                    </div>
                </div>
            )}
        </div>,
        document.body,
    );
}
