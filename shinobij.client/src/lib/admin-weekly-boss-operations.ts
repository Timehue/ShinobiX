export type AdminWeeklyBossResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: string };

export type AdminWeeklyBossFetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export type AdminWeeklyBossOperationContext = Readonly<{
    adminCredential: string;
    adminRole: "full" | "content";
}>;

export type AdminWeeklyBossOperationToken = Readonly<AdminWeeklyBossOperationContext & {
    epoch: number;
}>;

export type AdminWeeklyBossOperationFence = {
    activate: () => void;
    dispose: () => void;
    syncContext: (next: AdminWeeklyBossOperationContext) => boolean;
    begin: () => AdminWeeklyBossOperationToken | null;
    isCurrent: (token: AdminWeeklyBossOperationToken) => boolean;
    finish: (token: AdminWeeklyBossOperationToken) => boolean;
};

export function createAdminWeeklyBossOperationFence(
    initialContext: AdminWeeklyBossOperationContext,
): AdminWeeklyBossOperationFence {
    let context = { ...initialContext };
    let epoch = 0;
    let activeEpoch: number | null = null;
    let disposed = false;

    const isCurrent = (token: AdminWeeklyBossOperationToken): boolean =>
        !disposed
        && context.adminRole === "full"
        && activeEpoch === token.epoch
        && epoch === token.epoch
        && context.adminCredential === token.adminCredential
        && context.adminRole === token.adminRole;

    return {
        activate() {
            disposed = false;
        },
        dispose() {
            disposed = true;
            activeEpoch = null;
            epoch += 1;
        },
        syncContext(next) {
            if (
                context.adminCredential === next.adminCredential
                && context.adminRole === next.adminRole
            ) return false;
            context = { ...next };
            activeEpoch = null;
            epoch += 1;
            return true;
        },
        begin() {
            if (disposed || context.adminRole !== "full" || activeEpoch !== null) return null;
            epoch += 1;
            activeEpoch = epoch;
            return { ...context, epoch };
        },
        isCurrent,
        finish(token) {
            if (!isCurrent(token)) return false;
            activeEpoch = null;
            return true;
        },
    };
}

type JsonRecord = Record<string, unknown>;

function errorMessage(data: unknown, status: number): string {
    if (data && typeof data === "object" && !Array.isArray(data)) {
        const message = (data as JsonRecord).error;
        if (typeof message === "string" && message.trim()) return message;
    }
    return `HTTP ${status}`;
}

async function postFullAdminOperation<T>(
    fetcher: AdminWeeklyBossFetch,
    url: string,
    adminCredential: string,
    body: JsonRecord,
): Promise<AdminWeeklyBossResult<T>> {
    try {
        const response = await fetcher(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-admin-password": adminCredential,
            },
            body: JSON.stringify(body),
        });
        let data: unknown = {};
        try { data = await response.json(); } catch { /* status remains authoritative */ }
        if (!response.ok) return { ok: false, error: errorMessage(data, response.status) };
        return { ok: true, data: data as T };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error && error.message ? error.message : "Network error",
        };
    }
}

export async function persistAdminWeeklyBossOverride(
    fetcher: AdminWeeklyBossFetch,
    adminCredential: string,
    aiId: string | null,
    commit: (committedAiId: string) => void,
): Promise<AdminWeeklyBossResult<{ ok?: boolean }>> {
    const result = await postFullAdminOperation<{ ok?: boolean }>(
        fetcher,
        "/api/game-state",
        adminCredential,
        { kind: "weeklyBossOverride", aiId },
    );
    if (result.ok) commit(aiId ?? "");
    return result;
}

export type SpawnedWeeklyBoss = {
    boss?: { bossName?: string; aiId?: string };
};

export function spawnAdminWeeklyBoss(
    fetcher: AdminWeeklyBossFetch,
    adminCredential: string,
): Promise<AdminWeeklyBossResult<SpawnedWeeklyBoss>> {
    return postFullAdminOperation<SpawnedWeeklyBoss>(
        fetcher,
        "/api/weekly-boss",
        adminCredential,
        { kind: "reset" },
    );
}
