/*
 * Link a Google account to the shinobi you are already signed in as.
 *
 * This is the same OAuth flow the login screen uses, started in `link` mode so
 * the request carries auth headers and the server seals the target account into
 * the signed state. It matters most for guest characters: linking is what turns
 * one from a browser-bound character into an account with a real owner and a
 * way back in from any device.
 *
 * A password account types its password to link or unlink. A Google link
 * survives every password change, so the server will not let a session token
 * alone (one left on a shared computer, say) open that door or close it.
 */
import { useEffect, useState } from "react";
import { setActiveToken } from "../authFetch";
import { refreshAccountStatus, useAccountStatus } from "../lib/account-status";
import { startGoogleSignIn } from "../lib/google-signin";
import { loadGuestSession } from "../lib/guest-play";
import { loadPublicCapabilities } from "../lib/live-capabilities";
import { useLiveCapabilities } from "../lib/live-capabilities-context";
import { PLAYER_PASSWORD_MAX_LENGTH } from "../lib/player-auth-policy";
import { useBfcacheRestore } from "../lib/use-bfcache-restore";

export function GoogleLinkCard({ playerName }: { playerName: string }) {
    // Follows the live capability store, so a first check that failed does not
    // hide linking until a reload; the last known answer holds during a failing refresh.
    const { snapshot: capabilitySnapshot } = useLiveCapabilities();
    const available = capabilitySnapshot.capabilities?.googleSignIn?.state === "available";
    const status = useAccountStatus();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [password, setPassword] = useState("");
    // Set when the server asks for the password even though the account status
    // had not arrived yet (or was stale), so the field appears on demand.
    const [passwordAsked, setPasswordAsked] = useState(false);
    // A guest is the player this card is really for, so say so directly rather
    // than offering the same neutral copy to someone who already has a password.
    const [isGuest] = useState(() => loadGuestSession()?.name.toLowerCase() === playerName.toLowerCase());

    // Warm a cold store; a fresh lease is reused, and the answer arrives above.
    useEffect(() => {
        void loadPublicCapabilities();
    }, []);

    // Back from Google's consent page can restore this page from bfcache with
    // "Opening Google…" still stuck on; release the button on that restore.
    useBfcacheRestore(() => setBusy(false));

    const needsPassword = status?.hasPassword === true || passwordAsked;
    const passwordField = needsPassword && (
        <input
            type="password"
            aria-label="Current password"
            value={password}
            maxLength={PLAYER_PASSWORD_MAX_LENGTH}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
        />
    );

    async function unlink() {
        if (busy) return;
        if (!password) { setError("Enter your current password to unlink Google."); return; }
        setBusy(true);
        setError("");
        try {
            const r = await fetch("/api/player-auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "google-unlink", name: playerName, password }),
            });
            const data = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; token?: string };
            if (r.ok && data.ok) {
                // Unlinking rotates the session, so take the replacement token
                // or the very next request from this device would be refused.
                if (data.token) setActiveToken(data.token);
                setPassword("");
                await refreshAccountStatus();
            } else {
                setError(r.status === 429 ? "Too many attempts. Wait a few minutes and try again." : data.error || "Could not unlink Google.");
            }
        } catch {
            setError("Network error. Please retry.");
        } finally {
            setBusy(false);
        }
    }

    if (status?.google) {
        return (
            <div className="google-link-card">
                <h3>Google sign-in</h3>
                <p className="hint">
                    {status.hasPassword
                        ? "A Google account is linked. Unlink it if it is not yours, or if you no longer use it."
                        : "A Google account is linked, and it is your only way to sign in. Set a password below before unlinking it."}
                </p>
                {error && <p className="hint google-link-error" role="alert">{error}</p>}
                {status.hasPassword && (
                    <>
                        {passwordField}
                        <button type="button" className="secondary-button" onClick={() => void unlink()} disabled={busy}>
                            {busy ? "Unlinking…" : "Unlink Google account"}
                        </button>
                    </>
                )}
            </div>
        );
    }

    if (!available) return <div className="google-link-card"><h3>Google sign-in</h3><p className="hint">Google account linking is currently unavailable. You can still use a password and recovery code.</p></div>;

    async function link() {
        if (busy) return;
        if (needsPassword && !password) { setError("Enter your current password to link Google."); return; }
        setBusy(true);
        setError("");
        const failure = await startGoogleSignIn("link", needsPassword ? password : undefined);
        // Success navigates away, so only a failure ever lands back here.
        if (failure) {
            if (/password/i.test(failure)) setPasswordAsked(true);
            setError(failure);
            setBusy(false);
        }
    }

    return (
        <div className="google-link-card">
            <h3>Google sign-in</h3>
            <p className="hint">
                {isGuest
                    ? "This character currently lives only in this browser, and is released after two weeks without playing. Link a Google account to keep it for good, sign in from anywhere, and unlock the tavern and messages. Setting a password does the same."
                    : "Link a Google account to sign in without typing a password, and to get back in if you ever forget it."}
            </p>
            {error && <p className="hint google-link-error" role="alert">{error}</p>}
            {passwordField}
            <button type="button" className="secondary-button" onClick={() => void link()} disabled={busy}>
                {busy ? "Opening Google…" : "Link Google account"}
            </button>
        </div>
    );
}
