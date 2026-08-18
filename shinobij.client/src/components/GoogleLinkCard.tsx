/*
 * Link a Google account to the shinobi you are already signed in as.
 *
 * This is the same OAuth flow the login screen uses, started in `link` mode so
 * the request carries auth headers and the server seals the target account into
 * the signed state. It matters most for guest characters: linking is what turns
 * one from a browser-bound character into an account with a real owner and a
 * way back in from any device.
 */
import { useEffect, useState } from "react";
import { startGoogleSignIn } from "../lib/google-signin";
import { loadGuestSession } from "../lib/guest-play";
import { loadPublicCapabilities } from "../lib/live-capabilities";

export function GoogleLinkCard({ playerName }: { playerName: string }) {
    const [available, setAvailable] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    // A guest is the player this card is really for, so say so directly rather
    // than offering the same neutral copy to someone who already has a password.
    const [isGuest] = useState(() => loadGuestSession()?.name.toLowerCase() === playerName.toLowerCase());

    useEffect(() => {
        let cancelled = false;
        void loadPublicCapabilities().then((capabilities) => {
            if (!cancelled) setAvailable(capabilities?.googleSignIn?.state === "available");
        });
        return () => { cancelled = true; };
    }, []);

    if (!available) return null;

    async function link() {
        if (busy) return;
        setBusy(true);
        setError("");
        const failure = await startGoogleSignIn("link");
        // Success navigates away, so only a failure ever lands back here.
        if (failure) { setError(failure); setBusy(false); }
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
            <button type="button" className="secondary-button" onClick={() => void link()} disabled={busy}>
                {busy ? "Opening Google…" : "Link Google account"}
            </button>
        </div>
    );
}
