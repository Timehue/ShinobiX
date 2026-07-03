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
                    background: "linear-gradient(180deg, #facc15, #eab308)",
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
                    color: "#e2e8f0",
                    border: "1px solid rgba(148,163,184,0.45)",
                }}
            >
                Return to Start
            </button>
            <button
                type="button"
                onClick={resetLocalSaveAndReload}
                style={{
                    ...buttonBase,
                    background: "#3b1116",
                    color: "#fecdd3",
                    border: "1px solid rgba(248,113,113,0.55)",
                }}
            >
                Reset Local Save
            </button>
        </div>
    );
}
