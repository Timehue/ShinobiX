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
    /** per-fight consumable budget {itemId: charges} — sealed weapons/potions left to use */
    itemCharges?: Record<string, number>;
    /** active jutsu cooldowns {jutsuId: turns left} */
    cooldowns?: Record<string, number>;
};

export type TowerFeature =
    | { kind: 'pylon'; tiles: number[]; element: string; weakenElement: string; percent: number; label?: string }
    | { kind: 'ward'; tiles: number[]; percent: number; label?: string }
    | { kind: 'hazard'; tiles: number[]; percent: number; label?: string };

export type TowerMap = {
    width: number;
    height: number;
    /** floor biome — drives the battlefield floor art */
    biome?: string;
    blockedTiles: number[];
    hazardTiles: number[];
    objectiveTiles: number[];
    /** positional battlefield features (pylons/wards/hazards) — drawn on the board */
    features?: TowerFeature[];
};

export type TowerObjectiveState = {
    kind: string;
    npcAlive?: boolean;
    reachedGoal?: boolean;
    completed: boolean;
    failed: boolean;
};

/** A persistent ground-effect zone (from a tile-placed EMPTY_GROUND jutsu). */
export type TowerGroundEffect = {
    id: string;
    owner: string;
    name: string;
    tiles: number[];
    rounds: number;
    tags: Array<{ name: string; percent?: number }>;
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
    /** active persistent ground-effect zones (drawn on the board) */
    groundEffects?: TowerGroundEffect[];
    /** wall-clock when the current human's turn began (co-op AFK countdown) */
    turnStartedAt?: number;
};

/** Mirrors the server TURN_AFK_MS — how long a player has before their turn auto-passes. */
export const TOWER_TURN_AFK_MS = 75_000;

export type TowerActionInput =
    | { type: 'move'; tile: number }
    | { type: 'attack'; targetId: string }
    | { type: 'jutsu'; jutsuId: string; targetId?: string; tile?: number }
    | { type: 'weapon'; targetId: string; itemId?: string }
    | { type: 'item'; itemId?: string }
    | { type: 'wait' };

export type TowerActionResponse = { applied: boolean; reason?: string; session: TowerSession };
export type TowerSettleResult = { paid: boolean; reason?: string; score?: number };
export type TowerSettleResponse = { runId: string; winner: TowerSession['winner']; results: Record<string, TowerSettleResult> };

export type TowerFloorMeta = {
    id: number;
    name: string;
    biome: string;
    objective: string;
    roundBudget: number;
    isBoss: boolean;
    milestone: string | null;
    map: { width: number; height: number };
};

/** The public floor-catalog metadata for the lobby picker. */
export async function fetchTowerFloors(): Promise<TowerFloorMeta[]> {
    const res = await fetch('/api/towers/floors');
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const data = await res.json() as { floors: TowerFloorMeta[] };
    return data.floors;
}

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

/** The active co-op run this player has been invited into (so an ally can join the host). */
export async function fetchMyRun(playerName: string): Promise<{ runId: string; session: TowerSession } | null> {
    const res = await fetch(`/api/towers/my-run?playerName=${encodeURIComponent(playerName)}`);
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({})) as { runId?: string | null; session?: TowerSession };
    return data.runId && data.session ? { runId: data.runId, session: data.session } : null;
}
