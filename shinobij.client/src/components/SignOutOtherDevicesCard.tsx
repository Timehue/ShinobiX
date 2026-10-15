/*
 * Sign out every other device.
 *
 * A session stays alive for as long as it keeps being used, so a sign-in left on
 * a shared or lost computer never lapses on its own. This revokes every session
 * at once (the server rotates the account's session epoch) and hands THIS
 * device a fresh token, so the player pressing the button stays signed in.
 */
import { useState } from "react";
import { setActiveToken } from "../authFetch";

export function SignOutOtherDevicesCard({ playerName }: { playerName: string }) {
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

    async function signOutOthers() {
        if (busy) return;
        setBusy(true);
        setMsg(null);
        try {
            const r = await fetch("/api/player-auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "logout-others", name: playerName }),
            });
            const data = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; token?: string };
            if (r.ok && data.ok) {
                if (data.token) setActiveToken(data.token);
                setMsg({ kind: "ok", text: "Every other device has been signed out." });
            } else if (r.status === 429) {
                setMsg({ kind: "err", text: "Too many attempts. Wait a few minutes and try again." });
            } else {
                setMsg({ kind: "err", text: data.error || "Could not sign out other devices." });
            }
        } catch {
            setMsg({ kind: "err", text: "Network error. Please retry." });
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="sign-out-devices-card">
            <h3>Other devices</h3>
            <p className="hint">Signed in somewhere you no longer use? Sign out everywhere except here.</p>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void signOutOthers()}>
                {busy ? "Signing out…" : "Sign out other devices"}
            </button>
            {msg && (
                <p
                    className="hint"
                    role={msg.kind === "err" ? "alert" : "status"}
                    style={{ color: msg.kind === "ok" ? "var(--green-400)" : "var(--red-400)", marginTop: 6 }}
                >
                    {msg.text}
                </p>
            )}
        </div>
    );
}
