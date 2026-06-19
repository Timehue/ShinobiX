/*
 * Battle Towers — client API + session types.
 *
 * Thin typed wrappers over the server endpoints (api/towers/*). Auth headers are attached
 * automatically by the global authFetch interceptor, so these are plain fetch() calls; the
 * logged-in player's name is passed in the body and the server cross-validates it against
 * the auth headers. The session types mirror the server's TowerSession shape (the repo
 * duplicates server↔client combat types the same way for PvP).
 */

export type TowerSide = 'squad' | 'enemy' | 'npc';

export type TowerStatus = { name: string; rounds: number; kind?: 'positive' | 'negative'; percent?: number; amount?: number };

export type TowerActor = {
    id: string;
    side: TowerSide;
    name: string;
    ownerSlug: string | null;
    ai: boolean;
    hp: number;
    maxHp: number;
    chakra: number;
    maxChakra: number;
    stamina: number;
    maxStamina: number;
    shield: number;
    statuses: TowerStatus[];
    pos: number;
    character: Record<string, unknown>;
};

export type TowerMap = {
    width: number;
    height: number;
    blockedTiles: number[];
    hazardTiles: number[];
    objectiveTiles: number[];
};

export type TowerObjectiveState = {
    kind: string;
    npcAlive?: boolean;
    reachedGoal?: boolean;
    completed: boolean;
    failed: boolean;
};

export type TowerSession = {
    towerId: string;
    runId: string;
    floor: number;
    seed: number;
    partySize: number;
    map: TowerMap;
    actors: TowerActor[];
    turnQueue: string[];
    activeIndex: number;
    round: number;
    activeAp: number;
    actionsThisTurn: number;
    objectiveState: TowerObjectiveState;
    phaseState: { bossId?: string; pendingPhases: number[]; triggeredPhases: number[] };
    status: 'active' | 'done';
    winner: TowerSide | 'draw' | null;
    log: string[];
};

export type TowerActionInput =
    | { type: 'move'; tile: number }
    | { type: 'attack'; targetId: string }
    | { type: 'jutsu'; jutsuId: string; targetId: string }
    | { type: 'wait' };

export type TowerActionResponse = { applied: boolean; reason?: string; session: TowerSession };
export type TowerSettleResult = { paid: boolean; reason?: string; score?: number };
export type TowerSettleResponse = { runId: string; winner: TowerSession['winner']; results: Record<string, TowerSettleResult> };

async function postJson<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `Request failed (${res.status})`);
    }
    return res.json() as Promise<T>;
}

/** Begin a run: host + optional allies (slugs). Returns the runId + the initial session. */
export function startTowerRun(hostName: string, floor: number, allies: string[] = []): Promise<{ runId: string; session: TowerSession }> {
    return postJson('/api/towers/start', { hostName, floor, allies });
}

/** Submit one action for the human's actor on their turn. */
export function submitTowerAction(runId: string, playerName: string, action: TowerActionInput): Promise<TowerActionResponse> {
    return postJson('/api/towers/action', { runId, playerName, ...action });
}

/** Reconnect / poll the live session (gated to run members). */
export async function fetchTowerState(runId: string, playerName: string): Promise<TowerSession> {
    const res = await fetch(`/api/towers/state?runId=${encodeURIComponent(runId)}&playerName=${encodeURIComponent(playerName)}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `Request failed (${res.status})`);
    }
    const data = await res.json() as { session: TowerSession };
    return data.session;
}

/** Pay out a cleared floor to every squad member (idempotent; safe to call once on clear). */
export function settleTowerRun(runId: string, playerName: string): Promise<TowerSettleResponse> {
    return postJson('/api/towers/settle', { runId, playerName });
}
