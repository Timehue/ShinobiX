// ─────────────────────────────────────────────────────────────────────────────
// pet-ladder-queue.ts — client for the pet ranked matchmaking queue
// (docs/pet-coliseum-player-control-plan.md §12).
//
// The queue endpoint (api/pvp/pet-ranked-queue.ts) already did the hard part:
// join/leave/poll, a level band that widens with wait time, and a DURABLE
// per-player match record so the side that polls second still learns it was
// matched. This is the thin client over it.
//
// Its whole job is to hand two live players to the lockstep duel. The endpoint's
// `initiator` flag decides who sends the challenge and who waits for it, which is
// what stops both sides challenging each other simultaneously.
// ─────────────────────────────────────────────────────────────────────────────
// installAuthFetch() patches the global fetch with the player's auth headers,
// so a plain fetch here is already authenticated.

export interface LadderQueueMatch {
    opponent: string;
    opponentElo: number;
    opponentLevel: number;
    /** Exactly one side of a pair gets this. That side sends the challenge. */
    initiator: boolean;
}

export interface LadderQueueState {
    inQueue: boolean;
    queueSize: number;
    match: LadderQueueMatch | null;
}

const EMPTY: LadderQueueState = { inQueue: false, queueSize: 0, match: null };

function parseMatch(raw: unknown): LadderQueueMatch | null {
    if (!raw || typeof raw !== "object") return null;
    const m = raw as Record<string, unknown>;
    if (typeof m.opponent !== "string" || !m.opponent) return null;
    return {
        opponent: m.opponent,
        opponentElo: Number(m.opponentElo) || 0,
        opponentLevel: Number(m.opponentLevel) || 1,
        initiator: m.initiator === true,
    };
}

async function post(body: Record<string, unknown>): Promise<LadderQueueState> {
    try {
        const res = await fetch("/api/pvp/pet-ranked-queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!res.ok) return EMPTY;
        const data = await res.json() as Record<string, unknown>;
        return {
            inQueue: data.inQueue === true,
            queueSize: Number(data.queueSize) || 0,
            match: parseMatch(data.match),
        };
    } catch {
        // A dropped poll is not a state change — the caller keeps its current
        // view and tries again on the next tick rather than falsely leaving.
        return EMPTY;
    }
}

export const joinPetLadderQueue = (name: string, level: number, elo: number) =>
    post({ name, level, elo, action: "join" });

export const pollPetLadderQueue = (name: string) => post({ name, action: "poll" });

export const leavePetLadderQueue = (name: string) => post({ name, action: "leave" });

/** How often to poll while queued. Matches the endpoint's 60 s staleness window
 *  with plenty of margin — an entry that stops polling is dropped from the pool. */
export const LADDER_POLL_MS = 2500;
