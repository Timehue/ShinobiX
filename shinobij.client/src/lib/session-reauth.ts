// The guest resume comes in as a parameter (App passes guest-play's
// resumeGuestFor). Importing guest-play here split it out of the entry into its
// own startup chunk, and the startup graph has well under 1 KB of budget left.
type ResumeGuest = (name: string, matches: (a: string, b: string) => boolean) => Promise<{ name: string; token?: string } | null>;

export type ReauthOutcome =
    | { status: "ok"; token?: string }
    | { status: "refused"; message: string };

export const GOOGLE_REAUTH_MESSAGE =
    "This character signs in with Google, so it has no password to enter here. Choose Log out instead, then sign in with Google. Progress since your last save will be lost.";

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/*
 * The credential half of the session-expired prompt (App.tsx reauthKeepState).
 *
 * The prompt only sent `verify` with a password. A Google or guest account has
 * none: the server answers `{ ok: false, passwordless: true }`, and the prompt
 * said "Incorrect password" until the player gave up and logged out, losing the
 * unsaved progress the prompt exists to protect. A guest is now resumed from
 * this browser's own credential with no typing, and a Google account is told
 * plainly what will work. A ban (403) no longer reads as a wrong password.
 */
export async function reauthenticate(
    name: string,
    password: string,
    fetcher: (input: string, init: RequestInit) => Promise<Response>,
    resumeGuest: ResumeGuest,
): Promise<ReauthOutcome> {
    const guest = await resumeGuest(name, sameName);
    if (guest) return { status: "ok", token: guest.token };

    const res = await fetcher("/api/player-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", name: name.toLowerCase(), password }),
    });
    const data = await res.json().catch(() => null) as { ok?: boolean; token?: string; passwordless?: boolean; error?: string } | null;
    if (res.ok && data?.ok) return { status: "ok", token: data.token };
    if (data?.passwordless) return { status: "refused", message: GOOGLE_REAUTH_MESSAGE };
    if (res.status === 403) return { status: "refused", message: data?.error || "This account cannot sign in right now." };
    return { status: "refused", message: "Incorrect password. Try again." };
}
