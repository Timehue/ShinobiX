/*
 * Self-service password change.
 *
 * Posts the existing `change` action to /api/player-auth, which verifies the
 * current password server-side, re-hashes with scrypt, and mints a fresh
 * session token. We then update the locally-stored credential. Self-contained —
 * it only needs the player's name (the current password is typed, never read
 * from storage, so this works in token-first mode where the plaintext password
 * isn't persisted).
 *
 * Validation mirrors the registration rules in CharacterCreator: 8+ chars with
 * at least one letter and one number.
 */
import { useState } from "react";
import { setActiveToken, setActivePlayer } from "../authFetch";

export function ChangePasswordCard({ playerName }: { playerName: string }) {
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [confirm, setConfirm] = useState("");
    const [show, setShow] = useState(false);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

    async function submit() {
        if (busy) return;
        setMsg(null);
        if (next.length < 8) return setMsg({ kind: "err", text: "New password must be at least 8 characters." });
        if (!/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) {
            return setMsg({ kind: "err", text: "New password must include at least one letter and one number." });
        }
        if (next !== confirm) return setMsg({ kind: "err", text: "New passwords do not match." });
        if (next === current) return setMsg({ kind: "err", text: "New password must differ from the current one." });

        setBusy(true);
        try {
            const r = await fetch("/api/player-auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "change", name: playerName, oldPassword: current, newPassword: next }),
            });
            const data = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; token?: string };
            if (r.ok && data.ok) {
                // Refresh the stored credential. With a token we stay token-first
                // (the helper drops any persisted password); without one
                // (SESSION_SECRET unset on the server) we persist the new password
                // so subsequent requests still authenticate.
                if (data.token) setActiveToken(data.token);
                else setActivePlayer(playerName, next);
                setMsg({ kind: "ok", text: "Password changed." });
                setCurrent(""); setNext(""); setConfirm("");
            } else {
                setMsg({ kind: "err", text: data.error || "Could not change password." });
            }
        } catch {
            setMsg({ kind: "err", text: "Network error — please retry." });
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="change-password-card">
            <h3>Change Password</h3>
            <div className="change-password-fields">
                <input
                    type={show ? "text" : "password"}
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    placeholder="Current password"
                    autoComplete="current-password"
                />
                <input
                    type={show ? "text" : "password"}
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    placeholder="New password"
                    autoComplete="new-password"
                />
                <input
                    type={show ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                    onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
                />
            </div>
            <label className="change-password-show">
                <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords
            </label>
            {msg && (
                <p className="hint" style={{ color: msg.kind === "ok" ? "#4ade80" : "#f87171", marginTop: 6 }}>
                    {msg.text}
                </p>
            )}
            <button disabled={busy || !current || !next || !confirm} onClick={() => void submit()}>
                {busy ? "Saving…" : "Update Password"}
            </button>
        </div>
    );
}
