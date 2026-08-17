// Guest play: a real account with a real save and no owner yet.
//
// The one thing a guest needs that a password account does not is a way back in
// after their 24h session token lapses. That is the resume credential — an
// opaque server-issued key, stored here, redeemable for a fresh token. It is
// NOT a password: it is random, single-account, server-revocable, expires on
// its own after two weeks of silence, and is thrown away the moment the account
// gains a real owner.

const GUEST_RESUME_STORAGE = "shinobix:guestResume";
const GUEST_NAME_STORAGE = "shinobix:guestName";

/**
 * How a brand-new shinobi is being claimed. The character creator collects the
 * same village / bloodline / avatar / name either way; only this differs, and it
 * decides which `player-auth` action the registration becomes.
 */
export type SignupCredential =
    | { mode: "password"; password: string }
    | { mode: "google"; signupTicket: string; nonce: string }
    | { mode: "guest" };

/** The `player-auth` request body for a given signup credential. */
export function signupRequestBody(name: string, credential: SignupCredential): Record<string, unknown> {
    const base = { name: name.trim().toLowerCase() };
    switch (credential.mode) {
        case "google":
            return { ...base, action: "register-google", signupTicket: credential.signupTicket, nonce: credential.nonce };
        case "guest":
            return { ...base, action: "guest" };
        default:
            return { ...base, action: "register", password: credential.password };
    }
}

export type GuestSession = { name: string; resume: string };

export function loadGuestSession(): GuestSession | null {
    try {
        const resume = localStorage.getItem(GUEST_RESUME_STORAGE) ?? "";
        const name = localStorage.getItem(GUEST_NAME_STORAGE) ?? "";
        return resume && name ? { name, resume } : null;
    } catch {
        return null;
    }
}

export function rememberGuestSession(session: GuestSession | null): void {
    try {
        if (!session) {
            localStorage.removeItem(GUEST_RESUME_STORAGE);
            localStorage.removeItem(GUEST_NAME_STORAGE);
            return;
        }
        localStorage.setItem(GUEST_RESUME_STORAGE, session.resume);
        localStorage.setItem(GUEST_NAME_STORAGE, session.name);
    } catch { /* private mode — the guest simply cannot be resumed later */ }
}

export type GuestResumeResult =
    | { status: "resumed"; name: string; token?: string }
    | { status: "gone" }
    | { status: "failed" };

/**
 * Trade a stored resume credential for a fresh session token.
 *
 * "gone" means the character is genuinely unavailable — swept for inactivity,
 * deleted, or since claimed with Google — and the local credential is dropped
 * so the player is not offered a door that no longer opens. A network failure
 * is "failed" and keeps the credential, because a flaky connection must never
 * cost someone their character.
 */
/**
 * Forget the local guest credential once that character has a real owner.
 *
 * Only for the matching name: another guest character in this browser must keep
 * its own way back in. The server-side key self-heals on next use either way,
 * but leaving this behind would keep listing a claimed character as a guest.
 */
export function clearGuestSessionFor(name: string, matches: (a: string, b: string) => boolean): void {
    const guest = loadGuestSession();
    if (guest && matches(guest.name, name)) rememberGuestSession(null);
}

/**
 * Resume the stored guest character, but only if it is the account being asked
 * for. Returns the fresh credentials, or null when this browser holds no guest
 * for that name (or the server will not revive it).
 */
export async function resumeGuestFor(
    name: string,
    matches: (a: string, b: string) => boolean,
): Promise<{ name: string; token?: string } | null> {
    const guest = loadGuestSession();
    if (!guest || !matches(guest.name, name)) return null;
    const resumed = await resumeGuestSession(guest);
    return resumed.status === "resumed" ? { name: resumed.name, token: resumed.token } : null;
}

export async function resumeGuestSession(session: GuestSession): Promise<GuestResumeResult> {
    try {
        const response = await fetch("/api/player-auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "guest-resume", name: session.name, guestResume: session.resume }),
        });
        const data = await response.json().catch(() => null) as { name?: string; token?: string } | null;
        if (response.status === 410 || response.status === 409) {
            rememberGuestSession(null);
            return { status: "gone" };
        }
        if (!response.ok || !data?.name) return { status: "failed" };
        return { status: "resumed", name: data.name, token: data.token };
    } catch {
        return { status: "failed" };
    }
}
