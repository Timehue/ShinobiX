import { useEffect, useState } from "react";
import type { Character, Profession } from "../App";

type Stage = "intro" | "choose" | "confirm";

type ProfessionInfo = {
    id: Profession;
    name: string;
    tagline: string;
    bullets: string[];
    accent: string;
    icon: string;
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
        icon: "🐾",
    },
    {
        id: "healer",
        name: "Healer",
        tagline: "Mend what war breaks.",
        bullets: [
            "Heal allies for XP (% HP restored)",
            "Faster per-target cooldown & shorter hospital timer with rank",
            "Rank 10: see & heal injured villagers anywhere in the world",
        ],
        accent: "#22d3ee",
        icon: "✚",
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
        icon: "⚔",
    },
];

const INTRO_LINES = [
    "The village elder eyes you carefully.",
    "\"You have grown stronger. Your skills have caught my attention — and the attention of the village. The time has come to choose your path.\"",
    "\"Three paths are open to a shinobi of your standing. The Pet Tamer walks with beasts and bends them to their will. The Healer mends what war breaks. The Vanguard leads the charge against our enemies.\"",
    "\"Choose wisely. Your choice will shape who you become.\"",
];

export function ProfessionPicker({
    character,
    onProfessionChosen,
    sharedImages = {},
}: {
    character: Character;
    onProfessionChosen: (profession: Profession) => void;
    sharedImages?: Record<string, string>;
}) {
    const backdropImage = sharedImages["profession:backdrop"];
    const elderImage = sharedImages["profession:elder-portrait"];
    const portraitFor = (id: Profession) => sharedImages[`profession:portrait-${id}`];
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
        background: backdropImage
            ? `linear-gradient(180deg, rgba(8,12,28,0.85), rgba(4,6,18,0.96)), url(${backdropImage}) center/cover no-repeat`
            : "linear-gradient(180deg, rgba(8,12,28,0.96), rgba(4,6,18,0.99))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
        padding: 16,
    };

    if (stage === "intro") {
        return (
            <div style={backdrop}>
                <div style={{
                    background: "linear-gradient(180deg, rgba(15,18,34,0.97), rgba(8,10,22,0.99))",
                    border: "2px solid rgba(168,85,247,0.5)",
                    borderRadius: 12,
                    padding: 28,
                    maxWidth: 680,
                    width: "100%",
                    color: "#e9d5ff",
                    boxShadow: "0 0 70px rgba(168,85,247,0.35)",
                }}>
                    <p className="act-label" style={{ color: "#a855f7", letterSpacing: 2, marginTop: 0 }}>
                        A CROSSROAD
                    </p>
                    <h2 style={{ margin: "0 0 16px", color: "#faf5ff" }}>The Elder Summons You</h2>
                    {elderImage && (
                        <img
                            src={elderImage}
                            alt="Village elder"
                            style={{ width: "100%", maxHeight: 280, objectFit: "cover", borderRadius: 8, marginBottom: 16 }}
                        />
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
                        {INTRO_LINES.map((line, i) => (
                            <p key={i} style={{ margin: 0, lineHeight: 1.6 }}>{line}</p>
                        ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button
                            onClick={() => setStage("choose")}
                            style={{
                                background: "linear-gradient(135deg,#7c3aed,#a855f7)",
                                borderColor: "#c4b5fd",
                                color: "#faf5ff",
                                padding: "10px 20px",
                                fontWeight: 600,
                            }}
                        >
                            Continue ▶
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (stage === "choose") {
        return (
            <div style={backdrop}>
                <div style={{
                    width: "100%",
                    maxWidth: 1100,
                    color: "#e9d5ff",
                }}>
                    <div style={{ textAlign: "center", marginBottom: 24 }}>
                        <p className="act-label" style={{ color: "#a855f7", letterSpacing: 3, margin: 0 }}>
                            CHOOSE YOUR PATH
                        </p>
                        <h2 style={{ margin: "8px 0 0", color: "#faf5ff", fontSize: 28 }}>
                            What kind of shinobi will you become?
                        </h2>
                        <p style={{ margin: "8px 0 0", color: "#a78bfa", fontSize: 13 }}>
                            This is a permanent decision.
                        </p>
                    </div>
                    <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                        gap: 16,
                    }}>
                        {PROFESSIONS.map((p) => {
                            const portrait = portraitFor(p.id);
                            return (
                                <button
                                    key={p.id}
                                    onClick={() => { setPending(p.id); setStage("confirm"); }}
                                    style={{
                                        background: "linear-gradient(180deg, rgba(15,18,34,0.97), rgba(8,10,22,0.99))",
                                        border: `2px solid ${p.accent}`,
                                        borderRadius: 12,
                                        padding: 24,
                                        textAlign: "left",
                                        cursor: "pointer",
                                        color: "#e9d5ff",
                                        transition: "transform 120ms, box-shadow 120ms",
                                        boxShadow: `0 0 20px ${p.accent}33`,
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 12,
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.transform = "translateY(-4px)";
                                        e.currentTarget.style.boxShadow = `0 0 36px ${p.accent}66`;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.transform = "";
                                        e.currentTarget.style.boxShadow = `0 0 20px ${p.accent}33`;
                                    }}
                                >
                                    {portrait && (
                                        <img
                                            src={portrait}
                                            alt={p.name}
                                            style={{ width: "100%", height: 180, objectFit: "cover", borderRadius: 8 }}
                                        />
                                    )}
                                    <div style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 12,
                                    }}>
                                        <span style={{
                                            fontSize: 36,
                                            color: p.accent,
                                            lineHeight: 1,
                                        }}>{p.icon}</span>
                                        <div>
                                            <h3 style={{ margin: 0, color: p.accent, fontSize: 22 }}>{p.name}</h3>
                                            <p style={{ margin: "2px 0 0", color: "#c4b5fd", fontStyle: "italic", fontSize: 13 }}>
                                                {p.tagline}
                                            </p>
                                        </div>
                                    </div>
                                    <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55, fontSize: 14 }}>
                                        {p.bullets.map((b) => <li key={b}>{b}</li>)}
                                    </ul>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    }

    // stage === "confirm"
    const info = PROFESSIONS.find(p => p.id === pending);
    // NOTE: the recovery effect for "confirm with no info" lives at
    // the top of this component (just below the useState calls) so
    // it doesn't violate the Rules of Hooks across the earlier
    // returns for "intro" and "choose".
    if (!info) return null;
    return (
        <div style={backdrop}>
            <div style={{
                background: "linear-gradient(180deg, rgba(15,18,34,0.98), rgba(8,10,22,0.99))",
                border: `2px solid ${info.accent}`,
                borderRadius: 12,
                padding: 28,
                maxWidth: 480,
                width: "100%",
                color: "#e9d5ff",
                boxShadow: `0 0 60px ${info.accent}66`,
                textAlign: "center",
            }}>
                <div style={{ fontSize: 56, color: info.accent, marginBottom: 8 }}>{info.icon}</div>
                <p className="act-label" style={{ color: info.accent, letterSpacing: 2, margin: 0 }}>
                    CONFIRM YOUR PATH
                </p>
                <h2 style={{ margin: "8px 0 12px", color: "#faf5ff" }}>
                    Become a {info.name}?
                </h2>
                <p style={{ margin: "0 0 20px", color: "#c4b5fd", lineHeight: 1.5 }}>
                    This is your <strong style={{ color: "#fda4af" }}>permanent</strong> profession.
                    You cannot change it later.
                </p>
                {error && (
                    <p style={{ margin: "0 0 12px", color: "#fda4af", fontSize: 13 }}>
                        {error}
                    </p>
                )}
                <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                    <button
                        onClick={() => { setPending(null); setStage("choose"); setError(null); }}
                        disabled={submitting}
                        style={{ padding: "10px 20px" }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => void commit()}
                        disabled={submitting}
                        style={{
                            background: `linear-gradient(135deg, ${info.accent}, ${info.accent}cc)`,
                            borderColor: info.accent,
                            color: "#0a0a1a",
                            padding: "10px 20px",
                            fontWeight: 700,
                        }}
                    >
                        {submitting ? "Confirming…" : "Yes, I'm sure"}
                    </button>
                </div>
            </div>
        </div>
    );
}
