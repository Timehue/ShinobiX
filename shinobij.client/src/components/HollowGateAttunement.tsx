/**
 * Hollow Gate — Shrine Attunement panel (Phase 3B). A between-runs modal for
 * spending banked Hollow Shards on permanent shrine upgrades. Buy logic is the
 * pure lib/hollow-gate-attunement; this is the UI. Hosted by WorldMap.
 */
import { useState } from "react";
import type { Character } from "../types/character";
import { ATTUNEMENT_NODES, attunementRank, attunementNextCost, buyAttunement, keyForgeUnlocked, forgeHollowGateKey, KEY_FORGE_COST } from "../lib/hollow-gate-attunement";

type Props = { character: Character; updateCharacter: (c: Character) => void; onClose: () => void };

export function HollowGateAttunement({ character, updateCharacter, onClose }: Props) {
    const [msg, setMsg] = useState("");
    const shards = character.hollowShards ?? 0;

    function buy(id: string) {
        const r = buyAttunement(character, id);
        if (!r.ok) { setMsg(r.reason); return; }
        updateCharacter(r.character);
        setMsg("");
    }

    function forge() {
        const r = forgeHollowGateKey(character);
        if (!r.ok) { setMsg(r.reason); return; }
        updateCharacter(r.character);
        setMsg("Forged a Hollow Gate Key.");
    }

    return (
        <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(2,6,23,0.82)", display: "grid", placeItems: "center", padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "#160f2b", border: "1px solid #7c3aed", borderRadius: 12, padding: 18, maxWidth: 520, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.6)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <h3 style={{ margin: 0, color: "#e9d5ff" }}>⛩ Shrine Attunement</h3>
                    <button onClick={onClose} style={{ background: "transparent", border: "1px solid #475569", color: "#cbd5e1", borderRadius: 6, padding: "2px 10px", cursor: "pointer" }}>✕</button>
                </div>
                <p style={{ margin: "0 0 6px", color: "#c4b5fd", fontSize: 14 }}>💎 Hollow Shards: <strong style={{ color: "#e9d5ff" }}>{shards}</strong> · spend on permanent shrine boons</p>
                {msg && <p style={{ color: "#fca5a5", fontSize: 13, margin: "0 0 6px" }}>{msg}</p>}
                {ATTUNEMENT_NODES.map((n) => {
                    const rank = attunementRank(character, n.id);
                    const cost = attunementNextCost(character, n.id);
                    const maxed = rank >= n.maxRank;
                    const canBuy = !n.comingSoon && cost != null && shards >= cost;
                    return (
                        <div key={n.id} style={{ border: "1px solid #332b4e", borderRadius: 8, padding: "8px 10px", marginBottom: 8, opacity: n.comingSoon ? 0.55 : 1, background: "rgba(46,16,84,0.25)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                <strong style={{ color: "#e9d5ff", fontSize: 14 }}>
                                    {n.label} <span style={{ fontSize: 12, color: "#a78bfa" }}>{rank}/{n.maxRank}</span>
                                </strong>
                                <button
                                    disabled={!canBuy}
                                    onClick={() => buy(n.id)}
                                    style={{
                                        padding: "4px 10px", borderRadius: 6, fontSize: 12, whiteSpace: "nowrap", cursor: canBuy ? "pointer" : "default",
                                        background: canBuy ? "linear-gradient(#3b2d6b,#241a45)" : "#181527",
                                        border: `1px solid ${canBuy ? "#7c3aed" : "#3a3450"}`,
                                        color: canBuy ? "#e9d5ff" : "#6b6486",
                                    }}
                                >
                                    {n.comingSoon ? "Coming soon" : maxed ? "Maxed" : `Attune · ${cost}💎`}
                                </button>
                            </div>
                            <div style={{ fontSize: 12, color: "#c4b5fd", marginTop: 3 }}>{n.desc}</div>
                        </div>
                    );
                })}
                {keyForgeUnlocked(character) && (
                    <button
                        onClick={forge}
                        disabled={shards < KEY_FORGE_COST}
                        style={{
                            marginTop: 4, width: "100%", padding: 9, borderRadius: 8, fontWeight: 600,
                            cursor: shards >= KEY_FORGE_COST ? "pointer" : "default",
                            background: shards >= KEY_FORGE_COST ? "linear-gradient(#7c5a1a,#4a3510)" : "#181527",
                            border: `1px solid ${shards >= KEY_FORGE_COST ? "#f59e0b" : "#3a3450"}`,
                            color: shards >= KEY_FORGE_COST ? "#fde68a" : "#6b6486",
                        }}
                    >
                        🗝 Forge a Hollow Gate Key · {KEY_FORGE_COST}💎
                    </button>
                )}
            </div>
        </div>
    );
}
