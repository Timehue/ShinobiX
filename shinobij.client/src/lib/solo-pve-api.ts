/*
 * Normal solo-PvE wire contract. This deliberately has no Tower imports: the
 * Arena client renders this state directly and sends intent-only actions with
 * optimistic session versions plus stable retry tokens.
 */

export type SoloPveStatus = {
    name: string;
    rounds: number;
    activeRound?: number;
    percent?: number;
    amount?: number;
    discipline?: string;
    kind: 'positive' | 'negative';
};

export type SoloPveFighter = {
    name: string;
    hp: number;
    maxHp: number;
    chakra: number;
    maxChakra: number;
    stamina: number;
    maxStamina: number;
    shield: number;
    statuses: SoloPveStatus[];
    character: Record<string, unknown>;
    pos: number;
};

export type SoloPveGroundEffect = {
    id: string;
    owner: 'p1' | 'p2';
    name: string;
    tiles: number[];
    rounds: number;
    tags: Array<{ name: string; percent?: number; amount?: number }>;
};

export type SoloPveSession = {
    runtime: 'solo-pve';
    schemaVersion: 1;
    sessionId: string;
    ownerSlug: string;
    encounter: {
        kind: string;
        id: string;
        sourceId?: string;
        level?: number;
        bindingId?: string;
        metadata?: Record<string, string | number | boolean | null>;
    };
    player: SoloPveFighter;
    enemy: SoloPveFighter;
    round: number;
    activeSide: 'player' | 'enemy';
    ap: { player: number; enemy: number };
    actionsThisTurn: number;
    cooldowns: { player: Record<string, number>; enemy: Record<string, number> };
    groundEffects: SoloPveGroundEffect[];
    itemCharges: Record<string, number>;
    itemsUsed: Record<string, number>;
    environment: {
        biome: string;
        weatherPositiveElement?: string;
        weatherNegativeElement?: string;
        blockedTiles: number[];
    };
    status: 'active' | 'done';
    winner: 'player' | 'enemy' | 'draw' | null;
    outcome: 'win' | 'loss' | 'fled' | 'draw' | null;
    settlementState: 'pending' | 'settled';
    log: string[];
    fx?: Array<{ target: string; amount: number; kind: 'damage' | 'heal' }>;
    fxSeq?: number;
    version: number;
    createdAt: number;
    lastActionAt: number;
    expiresAt: number;
};

export type SoloPveActionInput =
    | { type: 'move'; tile: number }
    | { type: 'basicAttack' }
    | { type: 'basicHeal' }
    | { type: 'clear' }
    | { type: 'cleanse' }
    | { type: 'jutsu'; jutsuId: string; tile?: number }
    | { type: 'weapon'; itemId: string }
    | { type: 'item'; itemId: string }
    | { type: 'wait' }
    | { type: 'flee' };

export type SoloPveActionResponse = {
    applied?: boolean;
    duplicate?: boolean;
    reason?: string;
    error?: string;
    session?: SoloPveSession;
};

async function json<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) throw new Error('The solo combat server is unavailable.');
    return response.json() as Promise<T>;
}
export async function fetchSoloPveState(sessionId: string, playerName: string): Promise<SoloPveSession> {
    const response = await fetch(`/api/solo-pve/state?sessionId=${encodeURIComponent(sessionId)}&playerName=${encodeURIComponent(playerName)}`);
    const body = await json<{ error?: string; session?: SoloPveSession }>(response);
    if (!response.ok || !body.session) throw new Error(body.error ?? `Request failed (${response.status})`);
    return body.session;
}

/**
 * Submit one stable intent. Reuse the SAME moveToken when retrying a failed
 * network request; create a new token only for a genuinely new player action.
 * A stale-version 409 intentionally returns the current session for recovery.
 */
export async function submitSoloPveAction(params: {
    sessionId: string;
    playerName: string;
    expectedVersion: number;
    moveToken: string;
    action: SoloPveActionInput;
}): Promise<SoloPveActionResponse> {
    const response = await fetch('/api/solo-pve/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sessionId: params.sessionId,
            playerName: params.playerName,
            expectedVersion: params.expectedVersion,
            moveToken: params.moveToken,
            ...params.action,
        }),
    });
    const body = await json<SoloPveActionResponse>(response);
    if (!response.ok && !body.session) throw new Error(body.error ?? `Request failed (${response.status})`);
    return body;
}
