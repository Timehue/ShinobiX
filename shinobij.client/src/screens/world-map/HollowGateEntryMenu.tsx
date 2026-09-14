import type { HollowGateEventConfig } from '../../types/character';

/** The map owns admission and overlay state; this leaf renders the gate choices. */
export function HollowGateEntryMenu({ hollowGateEventConfig, onEnterHollowGateEvent, onEnterHollowGate, onClose, onShowAttunement }: {
    hollowGateEventConfig?: HollowGateEventConfig | null;
    onEnterHollowGateEvent?: (config: HollowGateEventConfig) => void;
    onEnterHollowGate?: () => void;
    onClose: () => void;
    onShowAttunement: () => void;
}) {
    return (
                <div onClick={() => onClose()} style={{ position: "fixed", inset: 0, zIndex: 8999, background: "rgba(2,6,23,0.8)", display: "grid", placeItems: "center", padding: 16 }}>
                    <div onClick={(e) => e.stopPropagation()} style={{ background: "#160f2b", border: "1px solid #7c3aed", borderRadius: 12, padding: 20, maxWidth: 380, width: "100%", textAlign: "center" }}>
                        <h3 style={{ marginTop: 0, color: "#e9d5ff" }}>⛩ The Hollow Gate</h3>
                        <p style={{ color: "#c4b5fd", fontSize: 14 }}>The broken torii waits. Steel yourself, or attune to the shrine with the Hollow Shards you've torn from its depths.</p>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {hollowGateEventConfig?.active && (
                                <button
                                    onClick={() => { onClose(); onEnterHollowGateEvent?.(hollowGateEventConfig); }}
                                    style={{ padding: 8, borderRadius: 8, border: "1px solid #fbbf24", background: "linear-gradient(#b45309,#78350f)", color: "#fef3c7", fontWeight: 700, cursor: "pointer" }}
                                >
                                    ⭐ Event: {hollowGateEventConfig.label || "Event Gate"}
                                    <span style={{ display: "block", fontSize: 11, fontWeight: 400, color: "var(--gold-300)" }}>
                                        {Math.max(1, hollowGateEventConfig.maxFloor ?? 1)} floor{(hollowGateEventConfig.maxFloor ?? 1) === 1 ? "" : "s"}
                                        {hollowGateEventConfig.bossName ? ` · Boss: ${hollowGateEventConfig.bossName}` : ""}
                                        {(hollowGateEventConfig.keyCost ?? 1) === 0 ? " · Free entry" : " · 1 Key"}
                                    </span>
                                </button>
                            )}
                            <button onClick={() => { onClose(); onEnterHollowGate?.(); }} style={{ padding: 8, borderRadius: 8, border: "none", background: "linear-gradient(#7c3aed,#4c1d95)", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Enter the Shrine</button>
                            <button onClick={() => { onClose(); onShowAttunement(); }} style={{ padding: 8, borderRadius: 8, border: "1px solid #7c3aed", background: "transparent", color: "#e9d5ff", cursor: "pointer" }}>💎 Shrine Attunement</button>
                            <button onClick={() => onClose()} style={{ padding: 6, borderRadius: 8, border: "1px solid var(--slate-600)", background: "transparent", color: "var(--text-dim)", cursor: "pointer" }}>Cancel</button>
                        </div>
                    </div>
                </div>
            );
}
