/*
 * Legacy panel (Profile tab) — the player's identity path at a glance:
 * accepted legacy + stage, the active trial with live objective progress,
 * and a deliberately VAGUE "strongest paths" reading (bucketed tiers from
 * the server — never raw counters or thresholds; the mystery rule).
 */
import { useCallback, useEffect, useState } from "react";
import type { Character } from "../types/character";
import {
    fetchLegacyStatus, fetchLegacyDefinitions, trialStart, trialComplete,
    isLegacyEnabled, RARITY_COLORS, RARITY_LABELS, TRIAL_STAT_LABELS,
    type LegacyStatusView, type LegacyDefView, type LegacyRarity,
} from "../lib/legacy";
import { PlayerNameplate } from "../components/PlayerNameplate";

const CODEX_RARITY_ORDER: LegacyRarity[] = ["mythic", "legendary", "rare", "basic"];

const STAGE_NAMES: Record<number, string> = {
    1: "Path Accepted", 2: "Awakened", 3: "Bound", 4: "Proven", 5: "Mythic",
};
const TRIAL_NAMES: Record<string, string> = {
    awaken: "Trial of Awakening", bind: "Trial of Binding",
    prove: "Trial of Proving", mythic: "The Mythic Trial",
};

export function LegacyPanel({ character, onLegacyChanged }: {
    character: Character;
    onLegacyChanged?: () => void;
}) {
    const enabled = isLegacyEnabled();
    const [status, setStatus] = useState<LegacyStatusView | null>(null);
    const [defs, setDefs] = useState<Map<string, LegacyDefView> | null>(null);
    const [busy, setBusy] = useState(false);
    // Flag-off mounts have nothing to load; they render the null branch below.
    const [loaded, setLoaded] = useState(!enabled);

    const reload = useCallback(() => {
        void fetchLegacyStatus(character.name).then((s) => { setStatus(s); setLoaded(true); });
    }, [character.name]);

    useEffect(() => {
        if (!enabled) return;
        reload();
        void fetchLegacyDefinitions().then((d) => {
            if (d) setDefs(new Map(d.legacies.map((l) => [l.id, l])));
        });
    }, [enabled, reload]);

    if (!isLegacyEnabled()) return null;
    if (!loaded) return <p style={{ color: "#9aa3b2", fontSize: ".8rem" }}>Reading the threads of your path…</p>;
    if (!status) {
        return <p style={{ color: "#9aa3b2", fontSize: ".8rem" }}>The world of Legacies has not awakened yet.</p>;
    }

    const def = status.legacy ? defs?.get(status.legacy.legacyId) ?? null : null;
    const rarityColor = def ? RARITY_COLORS[def.rarity] : "#9aa3b2";

    async function handleTrial(action: "start" | "complete") {
        if (busy) return;
        setBusy(true);
        if (action === "start") {
            await trialStart(character.name);
        } else {
            const result = await trialComplete(character.name);
            if (result?.ok) {
                alert(result.title
                    ? `Your trial is complete. The title "${result.title}" is yours.`
                    : "Your trial is complete. Your legacy deepens.");
                onLegacyChanged?.();
            } else if (result?.reason === "incomplete") {
                alert("The trial is not finished yet — the objectives below still wait.");
            }
        }
        setBusy(false);
        reload();
    }

    return (
        <div style={{ display: "grid", gap: 12 }}>
            {/* ── Nameplate (handoff badge row) ───────────────────────── */}
            <PlayerNameplate
                name={character.name}
                level={character.level}
                customTitle={character.customTitle}
                customTitleStyle={character.customTitleStyle}
                customTitleIcon={character.customTitleIcon}
                legacyTitle={status.legacy?.titles?.[status.legacy.titles.length - 1] ?? null}
                legacyRarity={def?.rarity ?? null}
                village={character.village}
            />

            {/* ── Accepted legacy ─────────────────────────────────────── */}
            {status.legacy && def ? (
                <div className="card" style={{ padding: 14, border: `1px solid ${rarityColor}55` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            {def.badge && (
                                // Aura class lives on a wrapper span, not the <img>:
                                // browsers don't render ::before/::after on replaced
                                // elements, so the S4/S5 halo layer would be dropped.
                                <span
                                    className={status.legacy.stage >= 2 ? `legacy-aura-s${status.legacy.stage}` : undefined}
                                    style={{ width: 44, height: 44, borderRadius: 8, display: "inline-block", flexShrink: 0 }}
                                >
                                    <img
                                        src={`/badges/legacy-${def.badge}.png`} alt=""
                                        style={{ width: "100%", height: "100%", borderRadius: 8, display: "block" }}
                                        onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
                                    />
                                </span>
                            )}
                            <h3 style={{ margin: 0, color: rarityColor }}>{def.name}</h3>
                        </div>
                        <span style={{ fontSize: ".72rem", color: rarityColor }}>{RARITY_LABELS[def.rarity]}</span>
                    </div>
                    <p style={{ margin: "6px 0", fontStyle: "italic", fontSize: ".8rem", color: "#cbd5e1" }}>{def.flavor}</p>
                    <p style={{ margin: 0, fontSize: ".78rem", color: "#9aa3b2" }}>
                        Stage {status.legacy.stage} — <b style={{ color: "#e2e8f0" }}>{STAGE_NAMES[status.legacy.stage]}</b>
                        {status.legacy.titles.length > 0 && <> · Titles: <b style={{ color: "#e2e8f0" }}>{status.legacy.titles.join(", ")}</b></>}
                    </p>
                    <p style={{ margin: "6px 0 0", fontSize: ".7rem", color: "#6b7280" }}>
                        Your path is sealed forever. Trials may be retried, but a legacy is never exchanged.
                    </p>
                </div>
            ) : (
                <div className="card" style={{ padding: 14 }}>
                    <h3 style={{ margin: "0 0 6px" }}>Your Path Is Unwritten</h3>
                    {status.minLevelReached ? (
                        <p style={{ margin: 0, fontSize: ".8rem", color: "#cbd5e1" }}>
                            You have come far enough for a Legacy. A <b style={{ color: "#c084fc" }}>Wandering Sage</b> watches
                            shinobi like you — keep playing, and he will find you on the world map.
                            {status.offer && <> He is <b>waiting in sector {status.offer.sector}</b> right now.</>}
                        </p>
                    ) : (
                        <p style={{ margin: 0, fontSize: ".8rem", color: "#cbd5e1" }}>
                            Legacies reveal themselves at level 50. Until then, every battle, mission, and
                            discovery is quietly shaping which paths will open to you.
                        </p>
                    )}
                </div>
            )}

            {/* ── Active trial ────────────────────────────────────────── */}
            {status.trial && (
                <div className="card" style={{ padding: 14 }}>
                    <h4 style={{ margin: "0 0 8px" }}>
                        {TRIAL_NAMES[status.trial.kind] ?? "Legacy Trial"}
                        <span style={{ fontSize: ".7rem", color: "#9aa3b2", marginLeft: 8 }}>attempt {status.trial.attempt}</span>
                    </h4>
                    {status.trial.objectives.map((o) => (
                        <div key={o.stat} style={{ marginBottom: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".75rem", color: o.done ? "#86efac" : "#cbd5e1" }}>
                                <span>{o.done ? "✓ " : ""}{TRIAL_STAT_LABELS[o.stat] ?? o.stat}</span>
                                <span>{o.progress.toLocaleString()} / {o.delta.toLocaleString()}</span>
                            </div>
                            <div style={{ height: 6, borderRadius: 3, background: "rgba(148,163,184,.15)", overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${Math.min(100, (o.progress / Math.max(1, o.delta)) * 100)}%`, background: o.done ? "#4ade80" : "#c084fc" }} />
                            </div>
                        </div>
                    ))}
                    <button disabled={busy} onClick={() => void handleTrial("complete")} style={{ width: "100%", marginTop: 4 }}>
                        {status.trial.objectives.every((o) => o.done) ? "Complete the Trial" : "Check Progress"}
                    </button>
                </div>
            )}
            {!status.trial && status.legacy && status.legacy.stage < 5 && (
                <button disabled={busy} onClick={() => void handleTrial("start")} style={{ width: "100%" }}>
                    {(() => {
                        // "Trial of Awakening" → "Begin the Trial of Awakening",
                        // but "The Mythic Trial" → "Begin the Mythic Trial" (no
                        // doubled article).
                        const name = TRIAL_NAMES[["", "awaken", "bind", "prove", "mythic"][status.legacy.stage] ?? "awaken"] ?? "Trial";
                        return name.startsWith("The ") ? `Begin ${name.replace(/^The /, "the ")}` : `Begin the ${name}`;
                    })()}
                </button>
            )}
            {status.legacy && status.legacy.stage === 5 && (
                <p style={{ margin: 0, fontSize: ".78rem", color: "#c084fc", textAlign: "center", fontStyle: "italic" }}>
                    Stage V — Mythic. Your legacy stands complete in the Hall of Legends.
                </p>
            )}

            {/* ── Strongest paths (vague, rumor-tier) ─────────────────── */}
            {status.strongest.length > 0 && !status.legacy && (
                <div className="card" style={{ padding: 14 }}>
                    <h4 style={{ margin: "0 0 6px" }}>Whispers About Your Path</h4>
                    {status.strongest.map((s) => (
                        <p key={s.category} style={{ margin: "2px 0", fontSize: ".78rem", color: "#cbd5e1", fontStyle: "italic" }}>
                            Your <b style={{ textTransform: "capitalize" }}>{s.category}</b> path is <b style={{ color: "#c084fc" }}>{s.tier}</b>.
                        </p>
                    ))}
                    {status.minLevelReached && (
                        <p style={{ margin: "6px 0 0", fontSize: ".72rem", color: "#6b7280" }}>
                            {Object.values(status.eligibleCounts).reduce((a, b) => a + b, 0)} legacies would answer you today.
                        </p>
                    )}
                </div>
            )}

            {/* ── The Legacy Codex — all 100 paths, browsable ─────────── */}
            {defs && defs.size > 0 && (
                <div className="card" style={{ padding: 14 }}>
                    <h4 style={{ margin: "0 0 4px" }}>The Legacy Codex</h4>
                    <p style={{ margin: "0 0 8px", fontSize: ".72rem", color: "#6b7280" }}>
                        Every path the world remembers. What opens them stays a mystery — the life
                        you live is the key. {defs.size} legacies recorded.
                    </p>
                    {CODEX_RARITY_ORDER.map((rarity) => {
                        const group = [...defs.values()].filter((d) => d.rarity === rarity);
                        if (group.length === 0) return null;
                        return (
                            <details key={rarity} style={{ marginBottom: 6 }}>
                                <summary style={{ cursor: "pointer", color: RARITY_COLORS[rarity], fontWeight: 700, fontSize: ".82rem" }}>
                                    {RARITY_LABELS[rarity]} — {group.length}
                                </summary>
                                <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                                    {group.map((d) => (
                                        <div key={d.id} style={{ borderLeft: `3px solid ${RARITY_COLORS[rarity]}55`, paddingLeft: 8 }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                                <b style={{ fontSize: ".8rem", color: status.legacy?.legacyId === d.id ? RARITY_COLORS[rarity] : "#e2e8f0", display: "flex", alignItems: "center", gap: 6 }}>
                                                    {d.badge && (
                                                        <img
                                                            src={`/badges/legacy-${d.badge}.png`} alt=""
                                                            style={{ width: 24, height: 24, borderRadius: 5 }}
                                                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                                        />
                                                    )}
                                                    {status.legacy?.legacyId === d.id ? "★ " : ""}{d.name}
                                                </b>
                                                <span style={{ fontSize: ".68rem", color: "#9aa3b2" }}>
                                                    {d.category}{d.villageAffinity ? ` · favored by ${d.villageAffinity}` : ""}
                                                </span>
                                            </div>
                                            <p style={{ margin: "2px 0 0", fontSize: ".74rem", color: "#9aa3b2", fontStyle: "italic" }}>{d.flavor}</p>
                                            <p style={{ margin: "2px 0 0", fontSize: ".68rem", color: "#6b7280" }}>Title: {d.title}</p>
                                        </div>
                                    ))}
                                </div>
                            </details>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
