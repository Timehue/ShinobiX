import { useState } from "react";
import { type AdminAccount, type Screen } from "../App";

export function AdminLogin({ onLogin, setScreen }: { onLogin: (account: AdminAccount, password: string) => void; setScreen: (screen: Screen) => void }) {
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
            const data = await res.json() as { success: boolean; error?: string };
            if (data.success) {
                onLogin("Admin 1", pw);
            } else {
                setError("Incorrect password.");
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
            <label>Password</label>
            <input
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

export function AdminPasswordReset({ adminPw }: { adminPw: string }) {
    const [targetName, setTargetName] = useState("");
    const [newPw, setNewPw] = useState("");
    const [msg, setMsg] = useState("");

    async function submit() {
        if (!targetName.trim() || !newPw.trim()) { setMsg("Enter a player name and new password."); return; }
        if (newPw.length < 6) { setMsg("Password must be at least 6 characters."); return; }
        if (!adminPw) { setMsg("❌ Admin password missing. Log out and back into admin."); return; }
        setMsg("Resetting…");
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 15000);
        try {
            const res = await fetch('/api/player-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
                body: JSON.stringify({ action: 'adminreset', name: targetName.trim().toLowerCase(), newPassword: newPw }),
                signal: controller.signal,
            });
            const data = await res.json() as { ok: boolean; error?: string };
            setMsg(data.ok ? `✅ Password reset for ${targetName.trim()}.` : `❌ ${data.error ?? `Failed with HTTP ${res.status}.`}`);
            if (data.ok) { setTargetName(""); setNewPw(""); }
        } catch (error) {
            setMsg(error instanceof DOMException && error.name === "AbortError" ? "❌ Reset timed out. Check the API debug page and try again." : "❌ Network error.");
        } finally {
            window.clearTimeout(timeoutId);
        }
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p className="hint" style={{ margin: 0 }}>Set a new password for a player (e.g. for account recovery). The player's old password is not needed.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input placeholder="Player name" value={targetName} onChange={e => setTargetName(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
                <input type="password" placeholder="New password (min 6)" value={newPw} onChange={e => setNewPw(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                <button onClick={submit}>Reset</button>
            </div>
            {msg && <p className="hint" style={{ color: msg.startsWith("✅") ? "#4ade80" : "#f87171", margin: 0 }}>{msg}</p>}
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
                <input placeholder="Player name" value={targetName} onChange={e => setTargetName(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
                <button onClick={submit}>Clear Auth Lock</button>
            </div>
            {msg && <p className="hint" style={{ color: msg.startsWith("✅") ? "#4ade80" : "#f87171", margin: 0 }}>{msg}</p>}
        </div>
    );
}
