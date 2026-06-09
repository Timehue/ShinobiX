/*
 * StarterPetSelect — the "choose your companion" onboarding beat. Shown as a
 * forced overlay (like ProfessionPicker) while character.onboardingStep ===
 * "starter", right after the Village Lore screen. The player picks 1 of 5
 * element-themed standard pets (data/starter-pets.ts); the choice is the
 * early "investment hook" and doubles as a Pet-Arena type-matchup identity.
 *
 * Stages mirror ProfessionPicker: intro → choose → confirm. Self-contained
 * inline styles (no CSS-class dependency); mobile-scrollable backdrop.
 */
import { useState } from "react";
import type { Character } from "../App";
import type { Pet } from "../types/pet";
import type { JutsuElement } from "../types/core";
import { STARTER_PETS, type StarterPetOption } from "../data/starter-pets";

const ELEMENT_ICON: Record<JutsuElement, string> = {
    Fire: "🔥", Water: "💧", Wind: "🌬️", Lightning: "⚡", Earth: "🪨", None: "·",
};

// Bar scales chosen to make the standard-band stat leans visible.
const STAT_MAX = { hp: 400, attack: 55, defense: 45, speed: 50 } as const;

function StatBar({ label, value, max, accent }: { label: string; value: number; max: number; accent: string }) {
    const pct = Math.max(4, Math.min(100, Math.round((value / max) * 100)));
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ width: 30, color: "#9ca3af" }}>{label}</span>
            <div style={{ flex: 1, height: 7, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: accent, borderRadius: 4 }} />
            </div>
            <span style={{ width: 30, textAlign: "right", color: "#e5e7eb" }}>{value}</span>
        </div>
    );
}

export function StarterPetSelect({
    character,
    onChoose,
    sharedImages = {},
}: {
    character: Character;
    onChoose: (pet: Pet) => void;
    sharedImages?: Record<string, string>;
}) {
    // Stage is derived, not a separate machine: intro (until "started"), then
    // confirm when a valid pendingId is set, else choose. Deriving the stage
    // means an invalid pendingId falls through to "choose" with no setState-in-
    // effect recovery needed.
    const [started, setStarted] = useState(false);
    const [pendingId, setPendingId] = useState<string | null>(null);
    const pending = pendingId ? STARTER_PETS.find((o) => o.pet.id === pendingId) ?? null : null;

    const backdrop: React.CSSProperties = {
        position: "fixed",
        inset: 0,
        background: "linear-gradient(180deg, rgba(8,12,28,0.96), rgba(4,6,18,0.99))",
        overflowY: "auto",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        zIndex: 1100,
        padding: "16px 16px max(16px, env(safe-area-inset-bottom, 16px))",
    };

    const artFor = (o: StarterPetOption) => o.pet.image || sharedImages[`pet:${o.pet.id}`];

    if (!started) {
        return (
            <div style={backdrop}>
                <div style={{
                    background: "linear-gradient(180deg, rgba(15,18,34,0.97), rgba(8,10,22,0.99))",
                    border: "2px solid rgba(56,189,248,0.5)",
                    borderRadius: 12,
                    padding: 28,
                    maxWidth: 620,
                    width: "100%",
                    color: "#e0f2fe",
                    boxShadow: "0 0 70px rgba(56,189,248,0.3)",
                    textAlign: "center",
                }}>
                    <p className="act-label" style={{ color: "#38bdf8", letterSpacing: 2, marginTop: 0 }}>
                        A BOND BEGINS
                    </p>
                    <h2 style={{ margin: "0 0 12px", color: "#f0f9ff" }}>Choose Your Companion</h2>
                    <p style={{ margin: "0 0 8px", lineHeight: 1.6 }}>
                        Welcome to {character.village}, {character.name}. Before you set out, a
                        young spirit-beast has come looking for a partner.
                    </p>
                    <p style={{ margin: "0 0 20px", lineHeight: 1.6, color: "#bae6fd" }}>
                        Five wait at the Pet Yard — one for each element. Pick the one that
                        suits your style. <strong>You can befriend more later</strong> out in the world.
                    </p>
                    <button
                        onClick={() => setStarted(true)}
                        style={{
                            background: "linear-gradient(135deg,#0284c7,#38bdf8)",
                            borderColor: "#7dd3fc",
                            color: "#f0f9ff",
                            padding: "10px 22px",
                            fontWeight: 600,
                        }}
                    >
                        Meet them ▶
                    </button>
                </div>
            </div>
        );
    }

    if (!pending) {
        return (
            <div style={backdrop}>
                <div style={{ width: "100%", maxWidth: 1150, color: "#e5e7eb" }}>
                    <div style={{ textAlign: "center", marginBottom: 20 }}>
                        <p className="act-label" style={{ color: "#38bdf8", letterSpacing: 3, margin: 0 }}>
                            CHOOSE YOUR COMPANION
                        </p>
                        <h2 style={{ margin: "8px 0 0", color: "#f8fafc", fontSize: 26 }}>
                            One for each element
                        </h2>
                        <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: 13 }}>
                            Each beats one element and is weak to another: 🔥 → 🌬️ → ⚡ → 🪨 → 💧 → 🔥
                        </p>
                    </div>
                    <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                        gap: 14,
                    }}>
                        {STARTER_PETS.map((o) => {
                            const art = artFor(o);
                            return (
                                <button
                                    key={o.pet.id}
                                    onClick={() => setPendingId(o.pet.id)}
                                    style={{
                                        background: "linear-gradient(180deg, rgba(15,18,34,0.97), rgba(8,10,22,0.99))",
                                        border: `2px solid ${o.accent}`,
                                        borderRadius: 12,
                                        padding: 18,
                                        textAlign: "left",
                                        cursor: "pointer",
                                        color: "#e5e7eb",
                                        transition: "transform 120ms, box-shadow 120ms",
                                        boxShadow: `0 0 20px ${o.accent}33`,
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 10,
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.transform = "translateY(-4px)";
                                        e.currentTarget.style.boxShadow = `0 0 36px ${o.accent}66`;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.transform = "";
                                        e.currentTarget.style.boxShadow = `0 0 20px ${o.accent}33`;
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                        {art ? (
                                            <img
                                                src={art}
                                                alt={o.pet.name}
                                                style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", border: `2px solid ${o.accent}` }}
                                                onError={(e) => { e.currentTarget.style.display = "none"; }}
                                            />
                                        ) : (
                                            <span style={{ fontSize: 40, lineHeight: 1 }}>{o.icon}</span>
                                        )}
                                        <div>
                                            <h3 style={{ margin: 0, color: o.accent, fontSize: 19 }}>{o.pet.name}</h3>
                                            <p style={{ margin: "2px 0 0", color: "#cbd5e1", fontSize: 12 }}>
                                                {o.icon} {o.element} · {o.role}
                                            </p>
                                        </div>
                                    </div>

                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11 }}>
                                        <span style={{ background: "rgba(34,197,94,0.15)", color: "#86efac", borderRadius: 6, padding: "2px 7px" }}>
                                            Strong vs {ELEMENT_ICON[o.strongVs]} {o.strongVs}
                                        </span>
                                        <span style={{ background: "rgba(239,68,68,0.15)", color: "#fca5a5", borderRadius: 6, padding: "2px 7px" }}>
                                            Weak vs {ELEMENT_ICON[o.weakVs]} {o.weakVs}
                                        </span>
                                    </div>

                                    <p style={{ margin: 0, fontSize: 12.5, color: "#cbd5e1", lineHeight: 1.45, minHeight: 34 }}>
                                        {o.blurb}
                                    </p>

                                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                        <StatBar label="HP" value={o.pet.hp} max={STAT_MAX.hp} accent={o.accent} />
                                        <StatBar label="ATK" value={o.pet.attack} max={STAT_MAX.attack} accent={o.accent} />
                                        <StatBar label="DEF" value={o.pet.defense} max={STAT_MAX.defense} accent={o.accent} />
                                        <StatBar label="SPD" value={o.pet.speed} max={STAT_MAX.speed} accent={o.accent} />
                                    </div>

                                    <p style={{ margin: 0, fontSize: 11.5, color: "#fcd34d", lineHeight: 1.4 }}>
                                        ★ {o.traitEffect}
                                    </p>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    }

    // Confirm stage — pending is non-null here (the !pending branch returned above).
    const option = pending;
    return (
        <div style={backdrop}>
            <div style={{
                background: "linear-gradient(180deg, rgba(15,18,34,0.98), rgba(8,10,22,0.99))",
                border: `2px solid ${option.accent}`,
                borderRadius: 12,
                padding: 28,
                maxWidth: 460,
                width: "100%",
                color: "#e5e7eb",
                boxShadow: `0 0 60px ${option.accent}66`,
                textAlign: "center",
            }}>
                <div style={{ fontSize: 52, marginBottom: 6 }}>{option.icon}</div>
                <p className="act-label" style={{ color: option.accent, letterSpacing: 2, margin: 0 }}>
                    YOUR FIRST COMPANION
                </p>
                <h2 style={{ margin: "8px 0 6px", color: "#f8fafc" }}>
                    Take {option.pet.name}?
                </h2>
                <p style={{ margin: "0 0 18px", color: "#cbd5e1", lineHeight: 1.5 }}>
                    {option.icon} {option.element} · {option.role}. {option.pet.description}
                </p>
                <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                    <button
                        onClick={() => setPendingId(null)}
                        style={{ padding: "10px 20px" }}
                    >
                        Back
                    </button>
                    <button
                        onClick={() => onChoose(option.pet)}
                        style={{
                            background: `linear-gradient(135deg, ${option.accent}, ${option.accent}cc)`,
                            borderColor: option.accent,
                            color: "#0a0a1a",
                            padding: "10px 20px",
                            fontWeight: 700,
                        }}
                    >
                        Take {option.pet.name}
                    </button>
                </div>
            </div>
        </div>
    );
}
