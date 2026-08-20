/** The session-expiry re-auth prompt (verbatim drain from App.tsx).
 *
 * It exists to prevent the "refresh and lose levels" data loss: the player's
 * unsaved progress is still in memory, so they re-enter the password, App
 * mints a fresh token WITHOUT reloading, and the live state persists.
 *
 * "Log out instead" is deliberately NOT disabled while a verify is busy — an
 * escape hatch a busy flag can disable is no hatch at all (a hung verify used
 * to trap the player behind this modal with every control dead).
 */
export function SessionExpiredModal({ password, error, busy, onPasswordChange, onContinue, onLogout }: {
    password: string;
    error: string;
    busy: boolean;
    onPasswordChange: (value: string) => void;
    onContinue: () => void;
    onLogout: () => void;
}) {
    return (
        <div
            style={{
                position: "fixed", inset: 0, zIndex: 100000,
                display: "grid", placeItems: "center",
                background: "rgba(2, 6, 23, 0.82)", padding: "1rem",
            }}
        >
            <div
                style={{
                    background: "#0f172a", border: "1px solid #475569",
                    borderRadius: 12, padding: "1.5rem", maxWidth: 380, width: "100%",
                    boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
                }}
            >
                <h3 style={{ marginTop: 0, color: "#e2e8f0" }}>Session timed out</h3>
                <p style={{ color: "#cbd5e1", fontSize: "0.95rem" }}>
                    Your login session expired. Enter your password to keep playing —{" "}
                    <strong>your progress is safe and will be saved.</strong>
                </p>
                <input
                    type="password"
                    value={password}
                    onChange={(e) => onPasswordChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !busy) onContinue(); }}
                    placeholder="Password"
                    autoFocus
                    style={{
                        width: "100%", padding: "0.55rem 0.7rem", marginBottom: "0.5rem",
                        borderRadius: 8, border: "1px solid #475569",
                        background: "#1e293b", color: "#e2e8f0", boxSizing: "border-box",
                    }}
                />
                {error && (
                    <p style={{ color: "#f87171", fontSize: "0.85rem", margin: "0 0 0.5rem" }}>{error}</p>
                )}
                <button
                    onClick={() => { if (!busy) onContinue(); }}
                    disabled={busy}
                    style={{
                        width: "100%", padding: "0.6rem", borderRadius: 8, border: "none",
                        background: busy ? "#334155" : "linear-gradient(#15803d,#0a4019)",
                        color: "#fff", cursor: busy ? "default" : "pointer", fontWeight: 600,
                    }}
                >
                    {busy ? "Signing in…" : "Continue playing"}
                </button>
                <button
                    onClick={onLogout}
                    style={{
                        width: "100%", padding: "0.5rem", marginTop: "0.5rem",
                        borderRadius: 8, border: "1px solid #475569",
                        background: "transparent", color: "#94a3b8", cursor: "pointer",
                    }}
                >
                    Log out instead
                </button>
            </div>
        </div>
    );
}
