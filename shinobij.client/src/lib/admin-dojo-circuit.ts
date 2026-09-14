export type AdminDojoCircuitFetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export type AdminDojoCircuitResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: string };

function errorMessage(data: unknown, status: number): string {
    if (data && typeof data === "object" && !Array.isArray(data)) {
        const message = (data as Record<string, unknown>).error;
        if (typeof message === "string" && message.trim()) return message;
    }
    return `HTTP ${status}`;
}

/**
 * Persist the global Dojo Circuit switch. The local cache deliberately moves
 * only after the full-admin write succeeds, so a rejected/failed toggle can
 * never make the admin screen claim that the public event changed.
 */
export async function persistAdminDojoCircuitEnabled(
    fetcher: AdminDojoCircuitFetch,
    adminCredential: string,
    enabled: boolean,
    commit: (enabled: boolean) => void,
): Promise<AdminDojoCircuitResult<{ enabled?: boolean }>> {
    try {
        const response = await fetcher("/api/game-state", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-admin-password": adminCredential,
            },
            body: JSON.stringify({ kind: "dojoCircuitEnabled", enabled }),
        });
        let data: unknown = {};
        try { data = await response.json(); } catch { /* status remains authoritative */ }
        if (!response.ok) return { ok: false, error: errorMessage(data, response.status) };
        commit(enabled);
        return { ok: true, data: data as { enabled?: boolean } };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error && error.message ? error.message : "Network error",
        };
    }
}
