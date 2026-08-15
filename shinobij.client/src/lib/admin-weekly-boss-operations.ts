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
    boss?: { spawnId?: string; bossName?: string; aiId?: string };
};

export type AdminWeeklyBossResetAttempt = Readonly<{
    expectedSpawnId: string | null;
    requestedSpawnId: string;
}>;

type AdminWeeklyBossResetStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type AdminWeeklyBossResetState = {
    load: () => AdminWeeklyBossResetAttempt | null;
    retain: (attempt: AdminWeeklyBossResetAttempt) => void;
    clear: (requestedSpawnId: string) => void;
};

const WEEKLY_BOSS_RESET_STORAGE_KEY = "admin.weeklyBossReset.pending.v1";
const WEEKLY_BOSS_RESET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function browserSessionStorage(): AdminWeeklyBossResetStorage | null {
    try {
        return typeof sessionStorage === "undefined" ? null : sessionStorage;
    } catch {
        return null;
    }
}

function parseResetAttempt(value: unknown): AdminWeeklyBossResetAttempt | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const attempt = value as Partial<AdminWeeklyBossResetAttempt>;
    const expectedSpawnId = attempt.expectedSpawnId === null
        ? null
        : (typeof attempt.expectedSpawnId === "string" && attempt.expectedSpawnId.trim() && attempt.expectedSpawnId.trim().length <= 128
            ? attempt.expectedSpawnId.trim()
            : undefined);
    const requestedSpawnId = typeof attempt.requestedSpawnId === "string"
        ? attempt.requestedSpawnId.trim().toLowerCase()
        : "";
    if (expectedSpawnId === undefined || !WEEKLY_BOSS_RESET_ID_PATTERN.test(requestedSpawnId)) return null;
    return { expectedSpawnId, requestedSpawnId };
}

export function createAdminWeeklyBossResetState(
    storage: AdminWeeklyBossResetStorage | null = browserSessionStorage(),
): AdminWeeklyBossResetState {
    let volatileAttempt: AdminWeeklyBossResetAttempt | null = null;
    const load = (): AdminWeeklyBossResetAttempt | null => {
        try {
            const stored = storage?.getItem(WEEKLY_BOSS_RESET_STORAGE_KEY);
            if (stored) {
                const parsed = parseResetAttempt(JSON.parse(stored));
                if (parsed) {
                    volatileAttempt = parsed;
                    return parsed;
                }
                storage?.removeItem(WEEKLY_BOSS_RESET_STORAGE_KEY);
            }
        } catch {
            // The in-memory copy still makes same-mount retries exact when
            // browser storage is disabled or corrupt.
        }
        return volatileAttempt;
    };
    return {
        load,
        retain(attempt) {
            volatileAttempt = attempt;
            try { storage?.setItem(WEEKLY_BOSS_RESET_STORAGE_KEY, JSON.stringify(attempt)); } catch { /* volatile fallback */ }
        },
        clear(requestedSpawnId) {
            const current = load();
            if (current?.requestedSpawnId !== requestedSpawnId) return;
            volatileAttempt = null;
            try { storage?.removeItem(WEEKLY_BOSS_RESET_STORAGE_KEY); } catch { /* already cleared in memory */ }
        },
    };
}

const defaultAdminWeeklyBossResetState = createAdminWeeklyBossResetState();

function mintWeeklyBossResetId(): string {
    const requestedSpawnId = globalThis.crypto?.randomUUID?.().toLowerCase() ?? "";
    if (!WEEKLY_BOSS_RESET_ID_PATTERN.test(requestedSpawnId)) {
        throw new Error("This browser cannot create a secure Weekly Boss reset identity.");
    }
    return requestedSpawnId;
}

async function loadWeeklyBossResetExpectation(
    fetcher: AdminWeeklyBossFetch,
    adminCredential: string,
): Promise<AdminWeeklyBossResult<string | null>> {
    try {
        const response = await fetcher("/api/weekly-boss", {
            method: "GET",
            cache: "no-store",
            headers: { "x-admin-password": adminCredential },
        });
        let data: unknown = {};
        try { data = await response.json(); } catch { /* handled as malformed below */ }
        if (!response.ok) return { ok: false, error: errorMessage(data, response.status) };
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            return { ok: false, error: "Weekly Boss state response was malformed." };
        }
        const boss = (data as JsonRecord).boss;
        if (boss === null) return { ok: true, data: null };
        if (!boss || typeof boss !== "object" || Array.isArray(boss)) {
            return { ok: false, error: "Weekly Boss spawn identity was missing." };
        }
        const spawnId = (boss as JsonRecord).spawnId;
        if (typeof spawnId !== "string" || !spawnId.trim() || spawnId.trim().length > 128) {
            return { ok: false, error: "Weekly Boss spawn identity was missing." };
        }
        return { ok: true, data: spawnId.trim() };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error && error.message ? error.message : "Network error",
        };
    }
}

export async function spawnAdminWeeklyBoss(
    fetcher: AdminWeeklyBossFetch,
    adminCredential: string,
    resetState: AdminWeeklyBossResetState = defaultAdminWeeklyBossResetState,
    requestIdFactory: () => string = mintWeeklyBossResetId,
): Promise<AdminWeeklyBossResult<SpawnedWeeklyBoss>> {
    let attempt = resetState.load();
    if (!attempt) {
        const expectation = await loadWeeklyBossResetExpectation(fetcher, adminCredential);
        if (!expectation.ok) return expectation;
        try {
            attempt = parseResetAttempt({
                expectedSpawnId: expectation.data,
                requestedSpawnId: requestIdFactory(),
            });
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Could not create a Weekly Boss reset identity." };
        }
        if (!attempt) return { ok: false, error: "Could not create a valid Weekly Boss reset identity." };
        // Persist before the mutating request. A reload or response loss must
        // resend this exact predecessor/request pair, never mint a second boss.
        resetState.retain(attempt);
    }

    let response: Awaited<ReturnType<AdminWeeklyBossFetch>>;
    try {
        response = await fetcher("/api/weekly-boss", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-admin-password": adminCredential,
            },
            body: JSON.stringify({ kind: "reset", ...attempt }),
        });
    } catch (error) {
        const message = error instanceof Error && error.message ? error.message : "Network error";
        return { ok: false, error: `${message}. Retry Spawn Now to recover this same reset request.` };
    }

    let data: unknown = null;
    try { data = await response.json(); } catch { /* an unreadable 2xx remains uncertain */ }
    if (!response.ok) {
        // Client errors are authoritative non-commits (a same-request replay is
        // returned as 200 by the server), except lock/distribution contention:
        // another exact call may already have committed this request while its
        // herald still holds the generation lock. Those 409s remain uncertain.
        const responseCode = data && typeof data === "object" && !Array.isArray(data)
            && typeof (data as JsonRecord).code === "string"
            ? String((data as JsonRecord).code)
            : "";
        const retryableConflict = response.status === 409 && (
            responseCode === "weekly-boss-reset-in-progress"
            || responseCode === "weekly-boss-reset-distribution-in-progress"
            || responseCode === "weekly-boss-reset-distribution-pending"
        );
        if (response.status >= 400 && response.status < 500 && !retryableConflict) {
            resetState.clear(attempt.requestedSpawnId);
        }
        const suffix = response.status >= 500 || retryableConflict
            ? " Retry Spawn Now to recover this same reset request."
            : "";
        return { ok: false, error: `${errorMessage(data, response.status)}${suffix}` };
    }
    const boss = data && typeof data === "object" && !Array.isArray(data)
        ? (data as JsonRecord).boss
        : null;
    const returnedSpawnId = boss && typeof boss === "object" && !Array.isArray(boss)
        && typeof (boss as JsonRecord).spawnId === "string"
        ? String((boss as JsonRecord).spawnId).trim().toLowerCase()
        : "";
    if (returnedSpawnId !== attempt.requestedSpawnId) {
        return { ok: false, error: "Weekly Boss reset response was inconclusive. Retry Spawn Now to recover this same reset request." };
    }
    resetState.clear(attempt.requestedSpawnId);
    return { ok: true, data: data as SpawnedWeeklyBoss };
}
