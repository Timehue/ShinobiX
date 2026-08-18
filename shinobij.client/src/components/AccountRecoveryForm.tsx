/*
 * "Forgotten your password?" — redeeming a recovery code for a new one.
 *
 * The only unauthenticated form in the game that can set a credential, so the
 * copy has two jobs beyond collecting three fields.
 *
 * The first is not lying about coverage. A player who never generated a code
 * cannot be recovered by anything on this screen, and saying so immediately is
 * kinder than letting them try their name a dozen times first. The moderator
 * route stays visible for exactly that person.
 *
 * The second is not becoming an oracle. The server answers a wrong code, an
 * account with no code, and a name nobody has ever registered with one
 * identical response — the shinobi leaderboard is a public list of names worth
 * probing. This form must not undo that by rendering different messages, so it
 * shows whatever the server said and never adds its own interpretation of it.
 */
import { useState } from "react";
import { formatRecoveryCodeInput, looksLikeRecoveryCode, normalizeRecoveryCode } from "../lib/recovery-code";
import { PLAYER_PASSWORD_MAX_LENGTH, playerPasswordPolicyError } from "../lib/player-auth-policy";

export type AccountRecoveryFormProps = {
    /** Prefills the name field when we already know who was trying to sign in. */
    initialName?: string;
    /** Handed the name and new password on success, so the caller can sign in. */
    onRecovered: (name: string, password: string) => void | Promise<void>;
    onCancel: () => void;
    /** Where a player with no code is sent instead. */
    helpUrl: string;
};

type RecoverResponse = { ok?: boolean; error?: string; token?: string; recoveryCode?: string };

export function AccountRecoveryForm({ initialName = "", onRecovered, onCancel, helpUrl }: AccountRecoveryFormProps) {
    const [name, setName] = useState(initialName);
    const [code, setCode] = useState("");
    const [next, setNext] = useState("");
    const [confirm, setConfirm] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [replacement, setReplacement] = useState("");
    const [done, setDone] = useState(false);

    async function submit() {
        if (busy) return;
        setError("");
        if (name.trim().length < 2) return setError("Enter your shinobi name.");
        if (!looksLikeRecoveryCode(code)) {
            return setError("A recovery code is 20 characters, in four groups of five.");
        }
        const policyError = playerPasswordPolicyError(next);
        if (policyError) return setError(policyError);
        if (next !== confirm) return setError("New passwords do not match.");

        setBusy(true);
        try {
            const r = await fetch("/api/player-auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "recover",
                    name: name.trim(),
                    recoveryCode: normalizeRecoveryCode(code),
                    newPassword: next,
                }),
            });
            const data = (await r.json().catch(() => ({}))) as RecoverResponse;
            if (r.ok && data.ok) {
                // A fresh code comes back with the new password, so nobody
                // finishes recovery holding nothing. Show it before signing in.
                setReplacement(data.recoveryCode ?? "");
                setDone(true);
                return;
            }
            if (r.status === 429) {
                setError("Too many attempts — wait a few minutes and try again.");
                return;
            }
            // Echo the server verbatim. Anything cleverer risks distinguishing
            // "no such shinobi" from "wrong code", which is the whole point of
            // the single message on that side.
            setError(data.error || "Could not recover this account.");
        } catch {
            setError("Network error — please retry.");
        } finally {
            setBusy(false);
        }
    }

    if (done) {
        return (
            <div className="gate-recovery-form" role="group" aria-label="Account recovered">
                <p className="gate-section-label">Password reset</p>
                {replacement ? (
                    <>
                        <p className="start-hint">
                            Your password is set. Here is your <strong>new</strong> recovery code — the
                            one you just used is spent. Write this one down.
                        </p>
                        <output className="recovery-code-value">{replacement}</output>
                    </>
                ) : (
                    <p className="start-hint">
                        Your password is set. Generate a new recovery code from your profile — the one
                        you just used is spent.
                    </p>
                )}
                <button
                    className="start-primary-btn"
                    onClick={() => void onRecovered(name.trim(), next)}
                >
                    Enter Village
                </button>
            </div>
        );
    }

    return (
        <div className="gate-recovery-form">
            <p className="gate-section-label">Recover with a code</p>
            {error && <p className="start-hint gate-error" role="alert">{error}</p>}

            <label className="start-field">
                <span className="start-field-label">Name</span>
                <input
                    className="start-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your shinobi name"
                    autoComplete="username"
                />
            </label>

            <label className="start-field">
                <span className="start-field-label">Recovery code</span>
                <input
                    className="start-input recovery-code-input"
                    value={code}
                    onChange={(e) => setCode(formatRecoveryCodeInput(e.target.value))}
                    placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                    autoComplete="one-time-code"
                    spellCheck={false}
                    autoCapitalize="characters"
                />
            </label>

            <label className="start-field">
                <span className="start-field-label">New password</span>
                <input
                    className="start-input"
                    type="password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    maxLength={PLAYER_PASSWORD_MAX_LENGTH}
                    placeholder="New password"
                    autoComplete="new-password"
                />
            </label>

            <label className="start-field">
                <span className="start-field-label">Confirm password</span>
                <input
                    className="start-input"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    maxLength={PLAYER_PASSWORD_MAX_LENGTH}
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                    onKeyDown={(e) => e.key === "Enter" && void submit()}
                />
            </label>

            <button className="start-primary-btn" onClick={() => void submit()} disabled={busy}>
                {busy ? "Checking…" : "Reset password"}
            </button>
            <button type="button" className="landing-auth-secondary" onClick={onCancel} disabled={busy}>
                Back to sign in
            </button>

            <p className="start-hint landing-auth-help">
                No recovery code? Nothing here can verify it is your character, because accounts carry
                no email address. Ask a moderator on{" "}
                <a href={helpUrl} target="_blank" rel="noopener noreferrer">Discord</a> to verify you
                and reset it.
            </p>
        </div>
    );
}
