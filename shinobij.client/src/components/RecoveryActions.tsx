import { recoverToStart, recoverToVillage, resetLocalSaveAndReload } from "../lib/recovery";

type RecoveryActionsProps = {
    compact?: boolean;
};

const buttonBase = {
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 13,
    borderRadius: 10,
    padding: "10px 14px",
} as const;

export function RecoveryActions({ compact = false }: RecoveryActionsProps) {
    return (
        <>
        <div
            style={{
                display: "flex",
                flexDirection: compact ? "column" : "row",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: 10,
            }}
        >
            <button
                type="button"
                onClick={recoverToVillage}
                style={{
                    ...buttonBase,
                    background: "linear-gradient(180deg, var(--gold), #eab308)",
                    color: "#1a1306",
                    border: "none",
                }}
            >
                Return to Village
            </button>
            <button
                type="button"
                onClick={recoverToStart}
                style={{
                    ...buttonBase,
                    background: "#162033",
                    color: "var(--slate-200)",
                    border: "1px solid rgba(148,163,184,0.45)",
                }}
            >
                Return to Start
            </button>
        </div>
        <details style={{ width: "100%", marginTop: 6, color: "#94a3b8", fontSize: 12, textAlign: "center" }}>
            <summary style={{ cursor: "pointer", display: "inline-block", padding: "4px 8px" }}>Advanced recovery options</summary>
            <p style={{ maxWidth: 390, margin: "8px auto", lineHeight: 1.45 }}>Reset Local Save clears this device’s cached session data. Your server save is not deleted.</p>
            <button
                type="button"
                onClick={resetLocalSaveAndReload}
                style={{ ...buttonBase, background: "#3b1116", color: "#fecdd3", border: "1px solid rgba(248,113,113,0.55)" }}
            >
                Reset Local Save…
            </button>
        </details>
        </>
    );
}
