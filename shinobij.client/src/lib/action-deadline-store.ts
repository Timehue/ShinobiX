import { playerSlug } from "./utils";

const actionDeadlines = new Map<string, number>();
const listeners = new Set<() => void>();

export function raidStartActionScope(playerName: string): string {
    return `raid-start:${playerSlug(playerName)}`;
}

export function missionClaimActionScope(playerName: string): string {
    return `mission-claim:${playerSlug(playerName)}`;
}

export function getActionDeadline(scope: string): number {
    return actionDeadlines.get(scope) ?? 0;
}

export function remainingActionDeadline(scope: string, now: number): number {
    return Math.max(0, getActionDeadline(scope) - now);
}

/** Keep the original server deadline while it is active; retries never extend it. */
export function startActionDeadline(scope: string, retryAfterMs: number, now = Date.now()): number {
    if (!scope || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return getActionDeadline(scope);
    const current = getActionDeadline(scope);
    const next = now + Math.ceil(retryAfterMs);
    if (current > now) {
        if (next <= current) return current;
        actionDeadlines.set(scope, next);
        listeners.forEach((listener) => listener());
        return next;
    }
    for (const [key, deadline] of actionDeadlines) {
        if (deadline <= now) actionDeadlines.delete(key);
    }
    actionDeadlines.set(scope, next);
    listeners.forEach((listener) => listener());
    return next;
}

export function subscribeActionDeadlines(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
