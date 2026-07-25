// Verbatim-moved from App.tsx (which disables this rule file-wide); effect behavior unchanged.
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Character, Profession } from "../App";
import { GameIcon, type GameIconName } from "../components/icons/GameIcon";
import overviewArt from "../assets/professions/overview.webp";
import healerArt from "../assets/professions/healer.webp";
import vanguardArt from "../assets/professions/vanguard.webp";
import petTamerArt from "../assets/professions/pettamer.webp";
import "./ProfessionPicker.css";

type Stage = "intro" | "choose" | "confirm";

type ProfessionInfo = {
    id: Profession;
    name: string;
    tagline: string;
    bullets: string[];
    accent: string;
};

const PROFESSIONS: ProfessionInfo[] = [
    {
        id: "petTamer",
        name: "Pet Tamer",
        tagline: "Walk with beasts.",
        bullets: [
            "Pets +5–20% stronger in PvE",
            "Faster pet training",
            "Better expedition rewards",
        ],
        accent: "#84cc16",
    },
    {
        id: "healer",
        name: "Healer",
        tagline: "Mend what war breaks.",
        bullets: [
            "Heal allies for XP (% HP restored)",
            "Faster per-target heal cooldown with rank · instant free self-discharge",
            "Rank 10: see & heal injured villagers anywhere in the world",
        ],
        accent: "#22d3ee",
    },
    {
        id: "vanguard",
        name: "Vanguard",
        tagline: "Lead the charge.",
        bullets: [
            "Earn Honor Seals from PvP kills",
            "Raid enemy villages",
            "Discount jutsu training at Rank 8",
        ],
        accent: "#f97316",
    },
];

const PROFESSION_ICON: Record<Profession, GameIconName> = {
    healer: "hp",
    vanguard: "sword",
    petTamer: "paw",
};

// Bundled defaults so the ceremony always has art. `sharedImages` (admin-set,
// same keys as before) still wins when present — these are the fallback, not a
// replacement. Same four files the Professions overview screen imports, so Vite
// emits one shared copy rather than a second set.
const PROFESSION_ART: Record<Profession, string> = {
    healer: healerArt,
    vanguard: vanguardArt,
    petTamer: petTamerArt,
};

const INTRO_LINES = [
    "The village elder eyes you carefully.",
    "\"You have grown stronger. Your skills have caught my attention — and the attention of the village. The time has come to choose your path.\"",
    "\"Three paths are open to a shinobi of your standing. The Pet Tamer walks with beasts and bends them to their will. The Healer mends what war breaks. The Vanguard leads the charge against our enemies.\"",
    "\"Choose wisely. Your choice will shape who you become.\"",
];

// Ember drift field behind the choice — fixed, hand-tuned values so the motes
// don't march in lockstep. CSS disables the whole layer under .lite-fx and
// prefers-reduced-motion.
const EMBERS = [
    { left: "8%", dur: "17s", delay: "0s", drift: "40px" },
    { left: "19%", dur: "22s", delay: "5s", drift: "-26px" },
    { left: "31%", dur: "15s", delay: "9s", drift: "34px" },
    { left: "44%", dur: "24s", delay: "2s", drift: "-44px" },
    { left: "57%", dur: "19s", delay: "12s", drift: "28px" },
    { left: "68%", dur: "26s", delay: "7s", drift: "-32px" },
    { left: "79%", dur: "16s", delay: "15s", drift: "46px" },
    { left: "91%", dur: "21s", delay: "3s", drift: "-22px" },
];

function Embers() {
    return (
        <div className="pp-embers" aria-hidden="true">
            {EMBERS.map((e, i) => (
                <span
                    key={i}
                    className="pp-ember"
                    style={{
                        left: e.left,
                        ["--pp-dur" as string]: e.dur,
                        ["--pp-delay" as string]: e.delay,
                        ["--pp-drift" as string]: e.drift,
                    }}
                />
            ))}
        </div>
    );
}

export function ProfessionPicker({
    character,
    onProfessionChosen,
    sharedImages = {},
}: {
    character: Character;
    onProfessionChosen: (profession: Profession) => void;
    sharedImages?: Record<string, string>;
}) {
    const backdropImage = sharedImages["profession:backdrop"] ?? overviewArt;
    // Falls back to the crossroad vista, which is a scene plate rather than a
    // portrait — so it stays decorative unless an admin sets a real elder image.
    const sharedElder = sharedImages["profession:elder-portrait"];
    const elderImage = sharedElder ?? overviewArt;
    const portraitFor = (id: Profession) => sharedImages[`profession:portrait-${id}`] ?? PROFESSION_ART[id];
    const [stage, setStage] = useState<Stage>("intro");
    const [pending, setPending] = useState<Profession | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Recovery effect for "stage=confirm but pending was cleared somehow":
    // bounce back to the choose screen. Previously this lived inside the
    // confirm render branch as a direct setStage() call, which React warns
    // about (setState during render) and can loop. Lives here at the top
    // level so it doesn't violate the Rules of Hooks across the early
    // returns for "intro" / "choose" / "confirm".
    useEffect(() => {
        if (stage === "confirm" && !PROFESSIONS.some(p => p.id === pending)) {
            setStage("choose");
        }
    }, [stage, pending]);

    async function commit() {
        if (!pending || submitting) return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch("/api/profession/choose", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    playerName: character.name,
                    profession: pending,
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setError(data.error ?? `Server error (${res.status})`);
                setSubmitting(false);
                return;
            }
            // onProfessionChosen updates character.profession on the parent,
            // which causes the overlay-condition in App.tsx to flip false and
            // unmount this component. No setScreen redirect — the player stays
            // on whatever screen they were on.
            onProfessionChosen(pending);
        } catch {
            setError("Network error. Try again.");
            setSubmitting(false);
        }
    }

    const backdrop: React.CSSProperties = {
        position: "fixed",
        inset: 0,
        background: "#04060a",
        // Allow scrolling when the inner card is taller than the viewport
        // (was the mobile cut-off cause — fixed + alignItems:center clips
        // anything past the viewport edges with no way to scroll).
        overflowY: "auto",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        // Sit above ALL chrome: the fixed side rails (999999) and the mobile
        // bottom nav (1000). Kept 1 below GameAlert (1000001) so a queued
        // notice can still cover this. Mounted inline in <main.center-game>,
        // this fixed overlay was trapped in that subtree's stacking context
        // and the bottom nav painted over it — clipping the last card in
        // portrait. The createPortal(..., document.body) below escapes that
        // context; this z-index makes it win at the root (mirrors GameAlert).
        zIndex: 1000000,
        padding: "16px 16px max(16px, env(safe-area-inset-bottom, 16px))",
    };

    // The establishing shot + veil + embers, shared by all three stages so the
    // scene never cuts to a different backdrop mid-ceremony.
    const scene = (
        <>
            <div className="pp-bg" style={{ ["--pp-bg-image" as string]: `url(${backdropImage})` }} aria-hidden="true" />
            <div className="pp-bg-veil" aria-hidden="true" />
            <Embers />
        </>
    );

    if (stage === "intro") {
        return createPortal(
            <div className="pp-root" style={backdrop}>
                {scene}
                <div className="pp-scroll">
                    <p className="pp-kicker">A Crossroad</p>
                    <h2 className="pp-scroll-title">The Elder Summons You</h2>
                    {elderImage && (
                        <div className="pp-elder-art">
                            <img
                                src={elderImage}
                                alt={sharedElder ? "Village elder" : ""}
                                onError={(e) => { e.currentTarget.style.display = "none"; }}
                            />
                        </div>
                    )}
                    <div className="pp-lines">
                        {INTRO_LINES.map((line, i) => (
                            <p
                                key={i}
                                className={`pp-line${line.startsWith("\"") ? " pp-line-speech" : ""}`}
                                style={{ ["--pp-i" as string]: i }}
                            >
                                {line}
                            </p>
                        ))}
                    </div>
                    <div className="pp-actions pp-actions-end">
                        <button
                            type="button"
                            className="pp-btn pp-btn-seal"
                            style={{ ["--pp-accent" as string]: "#caa04a" }}
                            onClick={() => setStage("choose")}
                        >
                            Continue ▸
                        </button>
                    </div>
                </div>
            </div>,
            document.body,
        );
    }

    if (stage === "choose") {
        return createPortal(
            <div className="pp-root" style={backdrop}>
                {scene}
                <div className="pp-shell">
                    <header className="pp-head">
                        <p className="pp-kicker">Choose your path</p>
                        <h2 className="pp-title">What kind of shinobi will you become?</h2>
                        <div className="pp-warn-band">
                            <p className="pp-warn">
                                <span className="pp-warn-mark" aria-hidden="true" />
                                This is a permanent decision
                            </p>
                        </div>
                    </header>
                    <div className="pp-choices">
                        {PROFESSIONS.map((p, i) => {
                            const portrait = portraitFor(p.id);
                            return (
                                <article
                                    key={p.id}
                                    className="pp-card"
                                    style={{ ["--pp-accent" as string]: p.accent, ["--pp-i" as string]: i }}
                                >
                                    <div className="pp-card-art">
                                        {portrait && (
                                            <img
                                                src={portrait}
                                                alt=""
                                                onError={(e) => { e.currentTarget.style.display = "none"; }}
                                            />
                                        )}
                                        <div className="pp-card-head">
                                            <span className="pp-emblem" aria-hidden="true">
                                                <GameIcon name={PROFESSION_ICON[p.id]} size={28} />
                                            </span>
                                            <div>
                                                <h3 className="pp-card-name">{p.name}</h3>
                                                <span className="pp-card-tag">{p.tagline}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="pp-card-body">
                                        <ul className="pp-perks">
                                            {p.bullets.map((b) => <li key={b}>{b}</li>)}
                                        </ul>
                                    </div>
                                    {/* Stretched-link CTA: the whole plate is clickable, but the
                                        focus ring and accessible name stay on this one control. */}
                                    <button
                                        type="button"
                                        className="pp-card-cta"
                                        onClick={() => { setPending(p.id); setStage("confirm"); }}
                                    >
                                        <span>Walk the {p.name}'s path</span>
                                        <span className="pp-cta-arrow" aria-hidden="true">▸</span>
                                    </button>
                                    <span className="pp-sheen" aria-hidden="true" />
                                    <span className="pp-corner pp-corner-tl" aria-hidden="true" />
                                    <span className="pp-corner pp-corner-tr" aria-hidden="true" />
                                    <span className="pp-corner pp-corner-bl" aria-hidden="true" />
                                    <span className="pp-corner pp-corner-br" aria-hidden="true" />
                                </article>
                            );
                        })}
                    </div>
                </div>
            </div>,
            document.body,
        );
    }

    // stage === "confirm"
    const info = PROFESSIONS.find(p => p.id === pending);
    // NOTE: the recovery effect for "confirm with no info" lives at
    // the top of this component (just below the useState calls) so
    // it doesn't violate the Rules of Hooks across the earlier
    // returns for "intro" and "choose".
    if (!info) return null;
    const confirmArt = portraitFor(info.id);
    return createPortal(
        <div className="pp-root" style={backdrop}>
            {scene}
            <div className="pp-confirm" style={{ ["--pp-accent" as string]: info.accent }}>
                {confirmArt && (
                    <div className="pp-confirm-art">
                        <img
                            src={confirmArt}
                            alt=""
                            onError={(e) => { e.currentTarget.style.display = "none"; }}
                        />
                    </div>
                )}
                <div className="pp-confirm-inner">
                    <span className="pp-emblem" aria-hidden="true">
                        <GameIcon name={PROFESSION_ICON[info.id]} size={32} />
                    </span>
                    <p className="pp-kicker">Confirm your path</p>
                    <h2 className="pp-confirm-title">Become a {info.name}?</h2>
                    <p className="pp-confirm-copy">
                        This is your <span className="pp-permanent">permanent</span> profession.
                        You cannot change it later.
                    </p>
                    {error && (
                        <p className="pp-error" role="alert">
                            {error}
                        </p>
                    )}
                    <div className="pp-actions">
                        <button
                            type="button"
                            className="pp-btn pp-btn-ghost"
                            onClick={() => { setPending(null); setStage("choose"); setError(null); }}
                            disabled={submitting}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="pp-btn pp-btn-seal"
                            onClick={() => void commit()}
                            disabled={submitting}
                        >
                            {submitting ? "Confirming…" : "Yes, I'm sure"}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
