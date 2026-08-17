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
 * Validation mirrors the server: 8-128 chars with a letter and a number.
 */
import { useState } from "react";
import { setActiveToken, setActivePlayer } from "../authFetch";
import { PLAYER_PASSWORD_MAX_LENGTH, playerPasswordPolicyError } from "../lib/player-auth-policy";

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
        const policyError = playerPasswordPolicyError(next);
        if (policyError) return setMsg({ kind: "err", text: policyError });
        if (next !== confirm) return setMsg({ kind: "err", text: "New passwords do not match." });
        if (next === current) return setMsg({ kind: "err", text: "New password must differ from the current one." });

        setBusy(true);
        try {
            const r = await fetch("/api/player-auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                // A Google or guest account has no current password to send. The
                // server accepts the session token as proof of ownership in that
                // case, which turns this into "set your first password".
                body: JSON.stringify({
                    action: "change",
                    name: playerName,
                    ...(current ? { oldPassword: current } : {}),
                    newPassword: next,
                }),
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
                    aria-label="Current password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    placeholder="Current password (leave blank if you sign in with Google)"
                    autoComplete="current-password"
                />
                <input
                    type={show ? "text" : "password"}
                    aria-label="New password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    maxLength={PLAYER_PASSWORD_MAX_LENGTH}
                    placeholder="New password"
                    autoComplete="new-password"
                />
                <input
                    type={show ? "text" : "password"}
                    aria-label="Confirm new password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    maxLength={PLAYER_PASSWORD_MAX_LENGTH}
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                    onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
                />
            </div>
            <label className="change-password-show">
                <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords
            </label>
            {msg && (
                <p className="hint" style={{ color: msg.kind === "ok" ? "var(--green-400)" : "var(--red-400)", marginTop: 6 }}>
                    {msg.text}
                </p>
            )}
            <button disabled={busy || !current || !next || !confirm} onClick={() => void submit()}>
                {busy ? "Saving…" : "Update Password"}
            </button>
        </div>
    );
}
