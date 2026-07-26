/*
 * Fetch helpers for the durable battle log.
 *
 * Auth headers are attached by the global authFetch interceptor, so these are
 * plain fetch() calls. Every function returns a discriminated result rather than
 * throwing: a battle-log panel that blanks itself on a transient 500 is worse
 * than one that keeps showing what it already had, so callers can distinguish
 * "you are signed out", "not your battle", "no such battle" and "the network
 * blipped" and react differently.
 */
import type {
    BattleHistoryResponse,
    BattleHistorySummary,
    DurableActionReceipt,
    DurableBattleLogResponse,
} from "../types/battle-log";
import { isBattleHistorySummary, isDurableActionReceipt } from "../types/battle-log";

export type ApiFailureKind = "unauthorized" | "forbidden" | "not-found" | "network" | "server";

export interface ApiFailure {
    ok: false;
    kind: ApiFailureKind;
    /** Safe to render — never contains raw server internals. */
    message: string;
    status?: number;
}

export type ApiResult<T> = ({ ok: true } & T) | ApiFailure;

const MESSAGES: Record<ApiFailureKind, string> = {
    unauthorized: "Your session expired. Sign in again to view this battle.",
    forbidden: "Only the fighters in this battle can read its log.",
    "not-found": "That battle is no longer available. Records are kept for 90 days.",
    network: "Could not reach the server. Check your connection and retry.",
    server: "The server had trouble loading this battle. Try again in a moment.",
};

function failureFor(status: number): ApiFailure {
    const kind: ApiFailureKind =
        status === 401 ? "unauthorized"
            : status === 403 ? "forbidden"
                : status === 404 ? "not-found"
                    : "server";
    return { ok: false, kind, message: MESSAGES[kind], status };
}

// An aborted request is the caller replacing it (tab switch, new battle picked),
// NOT a failure to report. Callers check this before rendering an error.
export function isAbort(err: unknown): boolean {
    return err instanceof DOMException && err.name === "AbortError";
}

/**
 * The caller's own durable battle list, newest first.
 * `cursor` is the offset returned as `nextCursor` by the previous page.
 */
export async function fetchBattleHistory(
    opts: { limit?: number; cursor?: number; signal?: AbortSignal } = {},
): Promise<ApiResult<{ entries: BattleHistorySummary[]; nextCursor?: number }>> {
    const params = new URLSearchParams();
    if (opts.limit != null) params.set("limit", String(opts.limit));
    if (opts.cursor != null) params.set("cursor", String(opts.cursor));
    const qs = params.toString();
    try {
        const res = await fetch(`/api/pvp/combat-history${qs ? `?${qs}` : ""}`, { signal: opts.signal });
        if (!res.ok) return failureFor(res.status);
        const body = (await res.json()) as BattleHistoryResponse;
        // Drop malformed rows rather than letting one bad record break the list.
        const entries = Array.isArray(body?.entries) ? body.entries.filter(isBattleHistorySummary) : [];
        return { ok: true, entries, nextCursor: body?.nextCursor };
    } catch (err) {
        if (isAbort(err)) throw err;
        return { ok: false, kind: "network", message: MESSAGES.network };
    }
}

/** One battle's durable record: the receipt plus its per-action entries. */
export async function fetchBattleLog(
    battleId: string,
    opts: {
        limit?: number;
        beforeSeq?: number;
        actor?: "all" | "self" | "opponent";
        includeBasic?: boolean;
        signal?: AbortSignal;
    } = {},
): Promise<ApiResult<{
    battle: DurableBattleLogResponse["battle"];
    entries: DurableActionReceipt[];
    source: DurableBattleLogResponse["source"];
    nextCursor?: number;
    legacyLog?: string[];
}>> {
    const id = String(battleId ?? "").trim();
    if (!id) return { ok: false, kind: "not-found", message: MESSAGES["not-found"] };
    const params = new URLSearchParams({ id });
    if (opts.limit != null) params.set("limit", String(opts.limit));
    if (opts.beforeSeq != null) params.set("beforeSeq", String(opts.beforeSeq));
    if (opts.actor && opts.actor !== "all") params.set("actor", opts.actor);
    if (opts.includeBasic === false) params.set("includeBasic", "false");
    try {
        const res = await fetch(`/api/pvp/combat-log?${params.toString()}`, { signal: opts.signal });
        if (!res.ok) return failureFor(res.status);
        const body = (await res.json()) as DurableBattleLogResponse;
        const entries = Array.isArray(body?.entries) ? body.entries.filter(isDurableActionReceipt) : [];
        return {
            ok: true,
            battle: body?.battle ?? null,
            entries,
            source: body?.source === "legacy-final-log" ? "legacy-final-log" : "receipts",
            nextCursor: body?.nextCursor,
            legacyLog: Array.isArray(body?.legacyLog) ? body.legacyLog.map(String) : undefined,
        };
    } catch (err) {
        if (isAbort(err)) throw err;
        return { ok: false, kind: "network", message: MESSAGES.network };
    }
}

/**
 * Merge older entries into a list already on screen, keeping ascending seq and
 * dropping duplicates. Pagination overlaps by design (the cursor is the oldest
 * seq we hold), so a naive concat would render the boundary action twice.
 */
export function mergeOlderEntries(
    current: DurableActionReceipt[],
    older: DurableActionReceipt[],
): DurableActionReceipt[] {
    const seen = new Set(current.map((e) => e.seq));
    const merged = [...older.filter((e) => !seen.has(e.seq)), ...current];
    return merged.sort((a, b) => a.seq - b.seq);
}
