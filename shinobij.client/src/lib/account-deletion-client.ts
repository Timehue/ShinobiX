export const DELETE_ACCOUNT_ERRORS = {
    auth: "Your sign-in could not be verified. Sign in again and check Settings before retrying deletion.",
    waiting: "The deletion request is not ready. Open Settings to check the 24-hour waiting period.",
    network: "Couldn't confirm deletion with the server. Check your connection and retry to finish safely.",
    server: "The server could not fully delete this character. Try again in a moment to finish the deletion.",
} as const;

export type AccountDeletionResult =
    | { ok: true }
    | { ok: false; reason: "auth" | "server" | "network" | "waiting" };

export async function deleteServerAccount(accountName: string, password = ""): Promise<AccountDeletionResult> {
    const slug = accountName.toLowerCase();
    const passwordHeaders: Record<string, string> = password ? { "x-player-password": password } : {};
    const rejected = (response: Response) => response.status === 401 || response.status === 403;
    const settled = (response: Response) => response.ok || response.status === 404;
    try {
        // Delete the save before revoking the auth record. In the token path,
        // firing these requests in parallel allowed auth deletion to rotate the
        // session epoch while save deletion was still authenticating, producing
        // an intermittent 401 and leaving the character behind. A partial server
        // failure remains safely retryable: a missing save/auth record is settled.
        const saveRes = await fetch(`/api/save/${encodeURIComponent(slug)}`, {
            method: "DELETE",
            headers: passwordHeaders,
        });
        if (saveRes.status === 409) return { ok: false, reason: "waiting" };
        if (!settled(saveRes)) return { ok: false, reason: rejected(saveRes) ? "auth" : "server" };

        const authRes = await fetch("/api/player-auth", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...passwordHeaders },
            body: JSON.stringify({ action: "delete", name: slug, ...(password ? { password } : {}) }),
        });
        if (settled(authRes)) return { ok: true };
        return { ok: false, reason: rejected(authRes) ? "auth" : "server" };
    } catch {
        return { ok: false, reason: "network" };
    }
}
