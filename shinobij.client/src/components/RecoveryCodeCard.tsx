/*
 * Recovery code — the self-serve way back into a password account.
 *
 * ## Why this exists, and why it is a code
 *
 * Accounts here are keyed by the shinobi name and nothing else. Registration
 * never asks for an email and guest play asks for nothing at all, so "email me
 * a reset link" would cover almost nobody who needs it — the accounts that do
 * carry an address are the Google-linked ones, which already recover by signing
 * in with Google. Recovery for a nameless-but-for-a-slug account can only mean
 * presenting a secret you were given and kept.
 *
 * So this card's job is mostly honesty. It says plainly that the code is shown
 * once, that nothing else can let you back in, and that generating a new one
 * kills the old — rather than implying a safety net that does not exist.
 *
 * The server (`player-auth` action `recovery-issue`) requires proof you are
 * already inside the account, so this is never a way to obtain a credential for
 * somebody else's shinobi.
 */
import { useState } from "react";
import { formatRecoveryCode, normalizeRecoveryCode } from "../lib/recovery-code";

/**
 * The one-time reveal. Shared with ChangePasswordCard, which gets a code back
 * in the same response that sets a first password — the moment a guest claims
 * their character, and the moment their browser's resume credential stops
 * working.
 */
export function RecoveryCodeReveal({ code, onDone, warning }: {
    code: string;
    onDone?: () => void;
    /**
     * Overrides the player-facing line. The admin panel shows the same block to
     * somebody who is about to RELAY the code rather than keep it, and telling
     * them to write it down would be the wrong instruction — but the copy
     * button, the monospace rendering and the ambiguous-character alphabet all
     * matter more there, not less, so it is the same component either way.
     */
    warning?: string;
}) {
    const display = formatRecoveryCode(normalizeRecoveryCode(code) || code);
    // Remember WHICH code was copied rather than a bare flag. If a fresh code
    // replaces this one, the confirmation stops applying on its own — a "Copied"
    // label left over from the previous code would be a lie about the one the
    // player is now looking at.
    const [copiedCode, setCopiedCode] = useState("");
    const copied = copiedCode !== "" && copiedCode === display;

    async function copy() {
        try {
            await navigator.clipboard.writeText(display);
            setCopiedCode(display);
        } catch {
            // Clipboard permission denied, or an insecure context. The code is
            // on screen and selectable, so there is nothing to recover from.
            setCopiedCode("");
        }
    }

    return (
        <div className="recovery-code-reveal" role="group" aria-label="Your recovery code">
            <p className="recovery-code-warning">
                {warning ?? "Write this down now. It is shown once and never again."}
            </p>
            <output className="recovery-code-value">{display}</output>
            <div className="recovery-code-actions">
                <button type="button" onClick={() => void copy()}>
                    {copied ? "Copied" : "Copy"}
                </button>
                {onDone && (
                    <button type="button" className="recovery-code-dismiss" onClick={onDone}>
                        I have saved it
                    </button>
                )}
            </div>
        </div>
    );
}

type IssueResponse = { ok?: boolean; error?: string; recoveryCode?: string };

export function RecoveryCodeCard({ playerName }: { playerName: string }) {
    const [password, setPassword] = useState("");
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

    async function issue() {
        if (busy) return;
        setBusy(true);
        setMsg(null);
        try {
            const r = await fetch("/api/player-auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                // authFetch attaches the session token for us. The typed
                // password is the fallback for a server running without
                // SESSION_SECRET, where no token is ever minted — the same
                // fallback ChangePasswordCard relies on.
                body: JSON.stringify({
                    action: "recovery-issue",
                    name: playerName,
                    ...(password ? { password } : {}),
                }),
            });
            const data = (await r.json().catch(() => ({}))) as IssueResponse;
            if (r.ok && data.ok && data.recoveryCode) {
                setCode(data.recoveryCode);
                setPassword("");
                setConfirming(false);
            } else if (r.status === 401) {
                setMsg({
                    kind: "err",
                    text: "Enter your current password to generate a code.",
                });
            } else if (r.status === 429) {
                setMsg({ kind: "err", text: "Too many attempts — wait a few minutes and try again." });
            } else {
                setMsg({ kind: "err", text: data.error || "Could not generate a recovery code." });
            }
        } catch {
            setMsg({ kind: "err", text: "Network error — please retry." });
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="recovery-code-card">
            <h3>Recovery Code</h3>
            <p className="hint recovery-code-blurb">
                Your shinobi has no email attached, so this code is the only way back in if you
                forget your password. Generate one and keep it somewhere safe.
            </p>

            {code ? (
                <RecoveryCodeReveal code={code} onDone={() => setCode("")} />
            ) : (
                <>
                    <input
                        type="password"
                        aria-label="Current password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Current password (only if asked)"
                        autoComplete="current-password"
                    />
                    {confirming ? (
                        <div className="recovery-code-confirm">
                            <p className="hint">
                                Generating a new code <strong>cancels the old one</strong>. If you
                                still have the previous code written down, it will stop working.
                            </p>
                            <button disabled={busy} onClick={() => void issue()}>
                                {busy ? "Generating…" : "Yes, replace it"}
                            </button>
                            <button
                                type="button"
                                className="recovery-code-dismiss"
                                disabled={busy}
                                onClick={() => setConfirming(false)}
                            >
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <button disabled={busy} onClick={() => setConfirming(true)}>
                            Generate a recovery code
                        </button>
                    )}
                </>
            )}

            {msg && (
                <p
                    className="hint"
                    role={msg.kind === "err" ? "alert" : undefined}
                    style={{ color: msg.kind === "ok" ? "var(--green-400)" : "var(--red-400)", marginTop: 6 }}
                >
                    {msg.text}
                </p>
            )}
        </div>
    );
}
