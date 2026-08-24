/*
 * Ranked 2v2 — client transport.
 *
 * Pair, queue, fight, rate. The fight itself runs on the shared four-player
 * surfaces (tower-pvp-api.ts), so this file owns only the duo handshake, the
 * queue, and the ladder settle. Nothing here decides an outcome or a rating.
 */
import type { TowerPvpMatch } from "./tower-pvp-api";

export type Ranked2v2Member = {
    slug: string;
    displayName: string;
    rating: number;
    accepted: boolean;
};

export type Ranked2v2Duo = {
    id: string;
    members: Ranked2v2Member[];
    status: "forming" | "ready" | "queued" | "matched" | "closed";
    expiresAt: number;
    matchId?: string;
};

export type Ranked2v2Queue =
    | { state: "idle" }
    | { state: "queued"; position: number; waiting: number; rating: number }
    | { state: "matched"; matchId: string };

export type Ranked2v2State = {
    duo: Ranked2v2Duo | null;
    queue: Ranked2v2Queue;
    match: TowerPvpMatch | null;
};

export type Ranked2v2RatingLine = {
    slug: string;
    teamId: "amber" | "violet";
    outcome: "win" | "loss" | "draw";
    delta: number;
    newRating: number;
};

export type Ranked2v2Settlement = {
    settled: true;
    rating: Ranked2v2RatingLine[];
    mine: Ranked2v2RatingLine | null;
    duo: Ranked2v2Duo | null;
    match: TowerPvpMatch | null;
};

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch("/api/pvp/ranked-2v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(data.error ?? "Ranked 2v2 request failed."));
    return data;
}

export type Ranked2v2Action = "status" | "invite" | "accept" | "leave" | "queue" | "unqueue";

/**
 * Coerce a response into a state we can render.
 *
 * NEVER trust the body's shape. A proxy, an error page, or a preview build with
 * no API mounted all answer 200 with HTML, which parses to `{}` — adopting that
 * blanks `queue` and every later render throws. Falling back to a valid idle
 * state keeps the panel usable and lets the next poll recover.
 */
function normalize(raw: Record<string, unknown>): Ranked2v2State {
    const queue = raw.queue as Ranked2v2Queue | undefined;
    const validQueue = queue && typeof queue === "object" && typeof (queue as { state?: unknown }).state === "string";
    return {
        duo: (raw.duo as Ranked2v2Duo | null) ?? null,
        queue: validQueue ? queue : { state: "idle" },
        match: (raw.match as TowerPvpMatch | null) ?? null,
    };
}

export async function ranked2v2(
    action: Ranked2v2Action,
    playerName: string,
    extra: Record<string, unknown> = {},
): Promise<Ranked2v2State> {
    return normalize(await post({ action, playerName, ...extra }));
}

/**
 * Apply the ladder result. Exactly-once on the server via a durable per-match
 * receipt, so every member may call it and retries are free.
 *
 * Shaped as BattleTowerFight's `settleFn` (runId, playerName) — the runId IS the
 * match id — so the fight screen needs no ranked-specific branch.
 */
export function settleRanked2v2(playerName: string) {
    return async (_matchId: string, _caller: string): Promise<Ranked2v2Settlement> =>
        await post({ action: "settle", playerName }) as unknown as Ranked2v2Settlement;
}
