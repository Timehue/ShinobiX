import { useState } from "react";
import { type AdminAccount, type AdminRole, type Screen } from "../App";
import { PLAYER_PASSWORD_MAX_LENGTH, playerPasswordPolicyError } from "../lib/player-auth-policy";
import { RecoveryCodeReveal } from "../components/RecoveryCodeCard";

export function AdminLogin({ onLogin, setScreen }: { onLogin: (account: AdminAccount, password: string, role: AdminRole, token: string | null) => void; setScreen: (screen: Screen) => void }) {
    // Require direct entry on this screen; never shuttle an admin password
    // through browser storage merely to avoid retyping it.
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    async function submit() {
        const pw = password.trim();
        if (!pw) return;
        setLoading(true);
        setError("");
        try {
            const res = await fetch('/api/admin-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pw }),
            });
            const data = await res.json() as {
                success: boolean;
                error?: string;
                account?: AdminAccount;
                role?: AdminRole;
                // Short-lived signed admin session token (Phase 4). Present only
                // when the server has ADMIN_SESSION_SECRET set; null otherwise, in
                // which case the client keeps using the password path.
                token?: string | null;
            };
            if (data.success) {
                // Trust the server's choice of account + role. ADMIN_PASSWORD
                // returns Admin 1 / full; ADMIN_CONTENT_PASSWORD returns
                // Admin 2 / content (restricted tabs). Fall back to the
                // legacy "Admin 1 / full" combo if the server is on an old
                // version that doesn't return these fields.
                onLogin(data.account ?? "Admin 1", pw, data.role ?? "full", data.token ?? null);
            } else {
                // Surface the server's specific error when present (e.g.
                // "Rate limited", "Account suspended"). Falls back to the
                // generic message for plain wrong-password 401s where
                // the server intentionally doesn't say more.
                setError(data.error ?? `Incorrect password.`);
                setPassword("");
            }
        } catch {
            setError("Could not reach server. Try again.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="card creator-card">
            <h2>Admin Login</h2>
            <label htmlFor="admin-login-pw">Password</label>
            <input
                id="admin-login-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="Enter admin password"
                disabled={loading}
            />
            {error && <p style={{ color: "var(--danger, #e55)", margin: "4px 0" }}>{error}</p>}
            <div className="menu">
                <button onClick={submit} disabled={loading || !password.trim()}>
                    {loading ? "Checking…" : "Login"}
                </button>
                <button onClick={() => setScreen("start")} disabled={loading}>Back</button>
            </div>
        </div>
    );
}

/*
 * Operator-assisted account recovery.
 *
 * Two tools, and the order they appear in is the order to reach for them.
 *
 * The default issues a RECOVERY CODE to relay to the player, who then sets
 * their own password. The operator never learns a working credential for
 * somebody else's shinobi, and nothing that ends up on the account has passed
 * through a Discord log. This is the right answer to "I forgot my password",
 * which is nearly every request.
 *
 * Setting a password directly is kept behind a disclosure, for the case the
 * code hand-off cannot serve: an account someone else is ALREADY in. There the
 * point is to make the attacker's known password stop working immediately
 * rather than whenever the player gets round to redeeming a code.
 */
export function AdminPasswordReset({ adminPw }: { adminPw: string }) {
    const [targetName, setTargetName] = useState("");
    const [newPw, setNewPw] = useState("");
    const [msg, setMsg] = useState("");
    const [issuedCode, setIssuedCode] = useState("");
    const [showDirectReset, setShowDirectReset] = useState(false);

    async function post(body: Record<string, unknown>, pending: string) {
        setMsg(pending);
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 15000);
        try {
            const res = await fetch('/api/player-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            return await res.json() as { ok: boolean; error?: string; recoveryCode?: string };
        } catch (error) {
            setMsg(error instanceof DOMException && error.name === "AbortError"
                ? "❌ Timed out. Check the API debug page and try again."
                : "❌ Network error.");
            return null;
        } finally {
            window.clearTimeout(timeoutId);
        }
    }

    async function issueCode() {
        if (!targetName.trim()) { setMsg("Enter a player name."); return; }
        if (!adminPw) { setMsg("❌ Admin password missing. Log out and back into admin."); return; }
        setIssuedCode("");
        const data = await post(
            { action: 'admin-recovery', name: targetName.trim().toLowerCase() },
            "Generating…",
        );
        if (!data) return;
        if (data.ok && data.recoveryCode) {
            setIssuedCode(data.recoveryCode);
            setMsg(`✅ Code generated for ${targetName.trim()}. Every existing session for that account has been signed out.`);
        } else {
            setMsg(`❌ ${data.error ?? "Failed."}`);
        }
    }

    async function directReset() {
        if (!targetName.trim() || !newPw.trim()) { setMsg("Enter a player name and new password."); return; }
        const policyError = playerPasswordPolicyError(newPw);
        if (policyError) { setMsg(policyError); return; }
        if (!adminPw) { setMsg("❌ Admin password missing. Log out and back into admin."); return; }
        setIssuedCode("");
        const data = await post(
            { action: 'adminreset', name: targetName.trim().toLowerCase(), newPassword: newPw },
            "Resetting…",
        );
        if (!data) return;
        setMsg(data.ok ? `✅ Password reset for ${targetName.trim()}. Tell them to change it.` : `❌ ${data.error ?? "Failed."}`);
        if (data.ok) { setTargetName(""); setNewPw(""); }
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p className="hint" style={{ margin: 0 }}>
                Generate a recovery code and send it to the player once you have verified who they are.
                They redeem it on the login screen and pick their own password — you never see it.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input aria-label="Player name" placeholder="Player name" value={targetName} onChange={e => setTargetName(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
                <button onClick={issueCode}>Generate recovery code</button>
            </div>

            {issuedCode && (
                <RecoveryCodeReveal
                    code={issuedCode}
                    warning="Send this to the player. It is shown once, works once, and expires the moment they use it."
                    onDone={() => setIssuedCode("")}
                />
            )}

            {msg && <p className="hint" style={{ color: msg.startsWith("✅") ? "var(--green-400)" : "var(--red-400)", margin: 0 }}>{msg}</p>}

            {!showDirectReset ? (
                <button
                    type="button"
                    className="recovery-code-dismiss"
                    style={{ alignSelf: "flex-start" }}
                    onClick={() => setShowDirectReset(true)}
                >
                    Set a password directly instead
                </button>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <p className="hint" style={{ margin: 0 }}>
                        For a COMPROMISED account only — this is the one case a code cannot fix, because the
                        attacker's password keeps working until it is overwritten. You will know the player's
                        password afterwards, so tell them to change it.
                    </p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input type="password" aria-label="New password" placeholder="New password (8-128, letter + number)" value={newPw} maxLength={PLAYER_PASSWORD_MAX_LENGTH} onChange={e => setNewPw(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                        <button onClick={directReset}>Reset password</button>
                        <button type="button" className="recovery-code-dismiss" onClick={() => { setShowDirectReset(false); setNewPw(""); }}>Cancel</button>
                    </div>
                </div>
            )}
        </div>
    );
}

export function AdminClearAuthLock({ adminPw }: { adminPw: string }) {
    const [targetName, setTargetName] = useState("");
    const [msg, setMsg] = useState("");

    async function submit() {
        if (!targetName.trim()) { setMsg("Enter a player name."); return; }
        if (!adminPw) { setMsg("❌ Admin password missing."); return; }
        setMsg("Clearing…");
        try {
            const res = await fetch('/api/player-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
                body: JSON.stringify({ action: 'delete', name: targetName.trim().toLowerCase() }),
            });
            const data = await res.json() as { ok: boolean; error?: string };
            setMsg(data.ok ? `✅ Auth lock cleared for ${targetName.trim()}. They can now create a fresh account.` : `❌ ${data.error ?? `Failed with HTTP ${res.status}.`}`);
            if (data.ok) setTargetName("");
        } catch {
            setMsg("❌ Network error.");
        }
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p className="hint" style={{ margin: 0 }}>Use when a player has a password record but no save data (stuck in "account exists" loop). Clears the auth lock so they can re-register with the same name.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input aria-label="Player name" placeholder="Player name" value={targetName} onChange={e => setTargetName(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
                <button onClick={submit}>Clear Auth Lock</button>
            </div>
            {msg && <p className="hint" style={{ color: msg.startsWith("✅") ? "var(--green-400)" : "var(--red-400)", margin: 0 }}>{msg}</p>}
        </div>
    );
}
