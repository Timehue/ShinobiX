import type { Character } from "../types/character";
import { playerSlug } from "./utils";

export type FieldMissionRun = { missionId: string; runId: string; acceptedAt: number };
export type FieldTrailResult = {
    ok: boolean;
    state?: FieldMissionRun | null;
    acceptedMissionIds?: string[];
    missionProgress?: Record<string, number>;
    replayed?: boolean;
    migrated?: boolean;
    reason?: string;
    character?: Character;
    _saveVersion?: number;
    error?: string;
};

type PendingStateRead = { promise: Promise<FieldTrailResult>; controller: AbortController; consumers: number };
const stateReadsInFlight = new Map<string, PendingStateRead>();
export const FIELD_TRAIL_STATE_INVALIDATED_EVENT = "shinobi:field-trail-state-invalidated";

function fieldTrailReadKey(playerName: string, missionId: string): string {
    return JSON.stringify([playerSlug(playerName), missionId]);
}

/** Drop a pending state read after progress changes so the next screen read is fresh. */
export function invalidateFieldTrailStateReads(playerName: string, missionId?: string): void {
    const owner = playerSlug(playerName);
    if (!owner) return;
    if (missionId) {
        const key = fieldTrailReadKey(playerName, missionId);
        stateReadsInFlight.get(key)?.controller.abort();
        stateReadsInFlight.delete(key);
        return;
    }
    for (const key of stateReadsInFlight.keys()) {
        try {
            const [keyOwner] = JSON.parse(key) as [string];
            if (keyOwner === owner) {
                stateReadsInFlight.get(key)?.controller.abort();
                stateReadsInFlight.delete(key);
            }
        } catch { /* keys are created locally; ignore an impossible malformed key */ }
    }
}

/** Announce an authoritative progress or lifecycle change to any open mission board. */
export function notifyFieldTrailStateChanged(playerName: string, missionId: string): void {
    const playerKey = playerSlug(playerName);
    if (!playerKey || !missionId) return;
    invalidateFieldTrailStateReads(playerName, missionId);
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(FIELD_TRAIL_STATE_INVALIDATED_EVENT, { detail: { playerKey, missionId } }));
    }
}

export async function postFieldTrail(params: {
    playerName: string;
    missionId: string;
    action: "accept" | "state" | "abandon";
}, signal?: AbortSignal): Promise<FieldTrailResult> {
    if (params.action === "state") {
        const key = fieldTrailReadKey(params.playerName, params.missionId);
        let pending = stateReadsInFlight.get(key);
        if (!pending) {
            const controller = new AbortController();
            pending = { controller, consumers: 0, promise: performFieldTrailRequest(params, controller.signal) };
            stateReadsInFlight.set(key, pending);
            const entry = pending;
            void entry.promise.then(() => {
                if (stateReadsInFlight.get(key) === entry) stateReadsInFlight.delete(key);
            }, () => {
                if (stateReadsInFlight.get(key) === entry) stateReadsInFlight.delete(key);
            });
        }
        return joinStateRead(key, pending, signal);
    }
    return performFieldTrailRequest(params, signal);
}

function joinStateRead(key: string, pending: PendingStateRead, signal?: AbortSignal): Promise<FieldTrailResult> {
    if (signal?.aborted) return Promise.reject(new DOMException("Field mission read cancelled.", "AbortError"));
    pending.consumers += 1;
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (value: FieldTrailResult | unknown, failed: boolean) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener("abort", onAbort);
            pending.controller.signal.removeEventListener("abort", onAbort);
            pending.consumers -= 1;
            if (pending.consumers === 0 && stateReadsInFlight.get(key) === pending) {
                stateReadsInFlight.delete(key);
                if (failed) pending.controller.abort();
            }
            if (failed) reject(value);
            else resolve(value as FieldTrailResult);
        };
        const onAbort = () => finish(new DOMException("Field mission read cancelled.", "AbortError"), true);
        signal?.addEventListener("abort", onAbort, { once: true });
        pending.controller.signal.addEventListener("abort", onAbort, { once: true });
        void pending.promise.then(value => finish(value, false), error => finish(error, true));
    });
}

async function performFieldTrailRequest(params: {
    playerName: string;
    missionId: string;
    action: "accept" | "state" | "abandon";
}, signal?: AbortSignal): Promise<FieldTrailResult> {
    try {
        const response = await fetch("/api/missions/field-trail", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
            signal,
        });
        const data = await response.json().catch(() => null) as FieldTrailResult | null;
        if (!response.ok || data?.ok !== true) {
            return {
                ...(data ?? {}),
                ok: false,
                error: data?.error ?? "The Mission Hall could not verify this contract.",
            };
        }
        if (params.action !== "state") notifyFieldTrailStateChanged(params.playerName, params.missionId);
        return data;
    } catch (error) {
        if (signal?.aborted) throw error;
        return { ok: false, error: "The Mission Hall is unreachable." };
    }
}
