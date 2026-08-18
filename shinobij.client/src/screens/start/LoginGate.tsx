import { useEffect, useState } from "react";
import { rememberedShinobi } from "../../lib/player-accounts";
import { loadPublicCapabilities } from "../../lib/live-capabilities";
import { startGoogleSignIn } from "../../lib/google-signin";

/*
 * The gate: the screen a returning player actually meets.
 *
 * The old version was a name field and a password field, which asked every
 * visitor to remember a credential before the game would show them anything.
 * The order here is deliberately the reverse — the shinobi this browser already
 * knows come first, then the two doors that need nothing typed at all, and the
 * password form last, because by then it is the least likely thing you need.
 */

const DISCORD_URL = "https://discord.gg/bCQGs8r6SK";

/** Google's mark, drawn inline: the CSP blocks their hosted button script. */
function GoogleMark() {
    return (
        <svg className="gate-google-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
            <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5.1-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z" />
            <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.6-3.9-12.3-9.1H4.3v5.7C7.9 41.1 15.4 46 24 46z" />
            <path fill="#FBBC05" d="M11.7 28.1c-.4-1.3-.7-2.7-.7-4.1s.2-2.8.7-4.1v-5.7H4.3C2.8 17.2 2 20.5 2 24s.8 6.8 2.3 9.8l7.4-5.7z" />
            <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.4 2 7.9 6.9 4.3 14.2l7.4 5.7c1.7-5.2 6.6-9.1 12.3-9.1z" />
        </svg>
    );
}

function IconUser() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
        </svg>
    );
}

function IconLock() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="10" width="16" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 1 1 8 0v3" />
        </svg>
    );
}

function IconEyeOpen() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

function IconEyeOff() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 3l18 18" />
            <path d="M10.6 5.2A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.6 4.5" />
            <path d="M6.2 6.7A17.4 17.4 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.2-.9" />
        </svg>
    );
}

export type LoginGateProps = {
    onLogin: (name: string, password: string) => void | Promise<void>;
    onAdmin: (prefilledPassword?: string) => void;
    /** One-click return for a shinobi this browser still holds a token for. */
    onContinueAs: (name: string) => void | Promise<void>;
    /** Open the character creator in guest mode — no password, play immediately. */
    onPlayAsGuest: () => void;
    onCreateAccount: () => void;
    initialName: string;
    notice: string;
};

export function LoginGate({
    onLogin, onAdmin, onContinueAs, onPlayAsGuest, onCreateAccount, initialName, notice,
}: LoginGateProps) {
    const [loginName, setLoginName] = useState(initialName);
    const [loginPassword, setLoginPassword] = useState("");
    const [showLoginPw, setShowLoginPw] = useState(false);
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    // A pre-filled name means a session restore failed, so open straight on the
    // form that can fix it rather than hiding it behind a disclosure.
    const [showPasswordForm, setShowPasswordForm] = useState(Boolean(initialName));
    const [googleReady, setGoogleReady] = useState(false);
    const [guestReady, setGuestReady] = useState(false);

    // Shinobi this browser can return to in one click, plus a guest character if
    // one lives here. The guest is flagged rather than hidden: it is a character
    // the player made, so it belongs in the list — but it is the impermanent
    // one, and saying so here is the last chance to mention that before they
    // commit more time to it.
    const [remembered] = useState(rememberedShinobi);

    // Ask the server which doors are actually open rather than rendering a
    // button whose only possible answer is a 503.
    useEffect(() => {
        let cancelled = false;
        void loadPublicCapabilities().then((capabilities) => {
            if (cancelled || !capabilities) return;
            setGoogleReady(capabilities.googleSignIn?.state === "available");
            setGuestReady(capabilities.guestPlay?.state === "available");
        });
        return () => { cancelled = true; };
    }, []);

    // Only "Admin 2" / "admin2" auto-routes to the admin login from the player
    // form. Admin 1 is intentionally NOT detected here — it flows through
    // logging in as Rill then the in-game Admin button, gating Admin 1 behind
    // both passwords.
    function isAdminTwo(raw: string): boolean {
        return raw.trim().toLowerCase().replace(/\s+/g, "") === "admin2";
    }

    async function submitLogin() {
        setError("");
        if (loginName.trim().length < 2) { setError("Enter your shinobi name."); return; }
        if (!loginPassword) { setError("Enter your password."); return; }
        if (isAdminTwo(loginName)) { onAdmin(loginPassword); return; }

        setStatus("Entering…");
        try {
            await onLogin(loginName.trim(), loginPassword);
        } finally {
            setStatus("");
        }
    }

    async function beginGoogle() {
        setError("");
        setStatus("Opening Google…");
        const failure = await startGoogleSignIn("login");
        // On success the browser is already navigating away, so only a failure
        // ever gets back here.
        if (failure) { setError(failure); setStatus(""); }
    }

    return (
        <div className="landing-auth-card landing-login-card start-card login-gate">
            <div className="landing-login-head">
                <div className="landing-login-art">
                    <img src="/login-shinobi-legacy.webp" alt="" aria-hidden="true" />
                    <div className="landing-login-art-copy">
                        <p className="landing-kicker">Village Gates</p>
                        <h2 className="start-card-title landing-login-art-title">Enter the Village</h2>
                    </div>
                </div>
            </div>

            {notice && <p className="start-hint landing-auth-notice">{notice}</p>}
            {error && <p className="start-hint gate-error" role="alert">{error}</p>}

            <div className="landing-auth-body">
                {remembered.length > 0 && (
                    <div className="gate-remembered">
                        <p className="gate-section-label">Continue as</p>
                        {remembered.map(({ name, guest }) => (
                            <button
                                key={name}
                                type="button"
                                className="gate-account-chip"
                                // The visible label is just the name; spell the
                                // action out for screen readers, since a bare
                                // name gives no clue what pressing it does.
                                aria-label={`Continue as ${name}${guest ? " (guest character)" : ""}`}
                                disabled={Boolean(status)}
                                onClick={() => { setError(""); void onContinueAs(name); }}
                            >
                                {/* The player's initial, not a shared icon. Three
                                    identical crests read as an unfinished list;
                                    a letter distinguishes them using the only
                                    thing this browser actually knows offline —
                                    the saved blob deliberately keeps no portrait. */}
                                <span className="gate-account-avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
                                <span className="gate-account-name">{name}</span>
                                {guest && <span className="gate-account-tag">Guest</span>}
                                <span className="gate-account-go" aria-hidden="true">›</span>
                            </button>
                        ))}
                    </div>
                )}

                {(googleReady || guestReady) && (
                    <div className="gate-doors">
                        {remembered.length > 0 && <p className="gate-section-label">Or start fresh</p>}
                        {googleReady && (
                            <button
                                type="button"
                                className="gate-google-btn"
                                onClick={() => void beginGoogle()}
                                disabled={Boolean(status)}
                            >
                                <GoogleMark />
                                <span>Sign in with Google</span>
                            </button>
                        )}
                        {guestReady && (<>
                            <button
                                type="button"
                                className="gate-guest-btn"
                                onClick={() => { setError(""); onPlayAsGuest(); }}
                                disabled={Boolean(status)}
                            >
                                Play as a guest
                            </button>
                            {/* Say what a guest cannot do BEFORE the choice. A
                                player who finds the tavern shut after hours of
                                play reads it as the game breaking; the same
                                rule, known up front, reads as a fair trade. */}
                            <p className="hint gate-guest-note">
                                Jump straight in — the tavern and messages stay closed until you add
                                a Google account or a password, which you can do any time from Profile.
                            </p>
                        </>)}
                    </div>
                )}

                {!showPasswordForm ? (
                    <button
                        type="button"
                        className="landing-auth-secondary gate-password-toggle"
                        onClick={() => setShowPasswordForm(true)}
                    >
                        Use a name and password
                    </button>
                ) : (
                    <div className="gate-password-form">
                        <label className="start-field">
                            <span className="start-field-label">
                                <span className="start-field-icon"><IconUser /></span>
                                Name
                            </span>
                            <input
                                className="start-input"
                                value={loginName}
                                onChange={(e) => setLoginName(e.target.value)}
                                placeholder="Enter existing shinobi name"
                                autoComplete="username"
                            />
                        </label>

                        <label className="start-field">
                            <span className="start-field-label">
                                <span className="start-field-icon"><IconLock /></span>
                                Password
                            </span>
                            <span className="start-input-wrap">
                                <input
                                    className="start-input has-toggle"
                                    type={showLoginPw ? "text" : "password"}
                                    value={loginPassword}
                                    onChange={(e) => setLoginPassword(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && void submitLogin()}
                                    placeholder="Enter your password"
                                    autoComplete="current-password"
                                />
                                <button
                                    type="button"
                                    className="start-eye-btn"
                                    onClick={() => setShowLoginPw((s) => !s)}
                                    aria-label={showLoginPw ? "Hide password" : "Show password"}
                                >
                                    {showLoginPw ? <IconEyeOff /> : <IconEyeOpen />}
                                </button>
                            </span>
                        </label>

                        <button
                            className="start-primary-btn landing-login-primary"
                            onClick={() => void submitLogin()}
                            disabled={Boolean(status)}
                        >
                            {status || "Enter Village"}
                        </button>
                    </div>
                )}

                <button type="button" className="landing-auth-secondary" onClick={onCreateAccount}>
                    Create a New Shinobi
                </button>

                {/* Password recovery is still moderator-only for password accounts:
                    they carry no email or other ownership signal. Google accounts
                    do not need this at all, which is most of why it exists now. */}
                <p className="start-hint landing-auth-help">
                    Forgotten your password? Ask a moderator on{" "}
                    <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">Discord</a>{" "}
                    to verify your character and reset it.
                </p>
            </div>
        </div>
    );
}
