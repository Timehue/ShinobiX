/*
 * The panel a guest sees instead of the tavern, the mail composer, or a chat
 * box. One component so all four surfaces say the same thing and offer the same
 * single way out: link a Google account.
 *
 * Purely presentational — the lock itself is enforced server-side in
 * `api/_guest-gate.ts`. Hiding this component would not open a single endpoint.
 *
 * Styles are inline rather than a new stylesheet: components in this project do
 * not import CSS (the node test runner cannot load it), and screens own their
 * classes. The tavern gossip strip beside it is written the same way.
 */
import { useEffect, useState } from "react";
import { startGoogleSignIn } from "../lib/google-signin";
import { SOCIAL_LOCK_BODY, SOCIAL_LOCK_TITLE } from "../lib/account-status";
import { loadPublicCapabilities } from "../lib/live-capabilities";
import { useBfcacheRestore } from "../lib/use-bfcache-restore";
import { GiPadlock } from "./icons/LightweightGameIcons";

export function GuestSocialLock({ what, compact = false }: { what: string; compact?: boolean }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    // Only offer the button when Google sign-in is actually configured. If it
    // is not, the guest has no way out at all, so say that plainly instead of
    // handing them a button that returns an error.
    const [googleAvailable, setGoogleAvailable] = useState<boolean | null>(null);

    useEffect(() => {
        let cancelled = false;
        void loadPublicCapabilities().then((capabilities) => {
            if (!cancelled) setGoogleAvailable(capabilities?.googleSignIn?.state === "available");
        });
        return () => { cancelled = true; };
    }, []);

    // Back from Google's consent page can restore this page from bfcache with
    // "Opening Google…" still stuck on; release the button on that restore.
    useBfcacheRestore(() => setBusy(false));

    async function link() {
        if (busy) return;
        setBusy(true);
        setError("");
        const failure = await startGoogleSignIn("link");
        // Success navigates away to Google, so only a failure lands back here.
        if (failure) { setError(failure); setBusy(false); }
    }

    return (
        <div
            role="status"
            style={{
                margin: compact ? "8px 0 0" : "12px 0",
                padding: compact ? "10px 12px" : "16px 18px",
                borderRadius: 10,
                border: "1px solid rgba(250, 204, 21, .28)",
                background: "rgba(250, 204, 21, .07)",
                color: "#e6dcc0",
                lineHeight: 1.5,
            }}
        >
            <h3 style={{ margin: "0 0 6px", fontSize: compact ? ".92rem" : "1.02rem", color: "#facc15" }}>
                <GiPadlock aria-hidden="true" /> {SOCIAL_LOCK_TITLE}
            </h3>
            <p style={{ margin: "0 0 10px", fontSize: compact ? ".8rem" : ".88rem" }}>
                {what} {SOCIAL_LOCK_BODY}
            </p>
            {error && <p className="hint" role="alert" style={{ color: "#f87171" }}>{error}</p>}
            {googleAvailable !== false && (
                <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void link()}
                    disabled={busy || googleAvailable === null}
                >
                    {busy ? "Opening Google…" : "Link Google account"}
                </button>
            )}
            {/* The password door lives on the Profile screen, which already owns
                the first-password form. Point at it rather than duplicating it,
                so there is one place a credential can be set. */}
            <p className="hint" style={{ margin: "8px 0 0" }}>
                {googleAvailable === false
                    ? "Google sign-in is unavailable right now — set a password under Profile → Password instead."
                    : "Prefer a password? Set one under Profile → Password. Either one unlocks these."}
            </p>
        </div>
    );
}
