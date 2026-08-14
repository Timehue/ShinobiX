/**
 * Wire contract for World Map encounters that use the canonical solo-PvE
 * runtime. The request contains identity only; combat stats, hunt quality,
 * quest stage, chain order, and rewards are all reconstructed by the server.
 */
export const WORLD_AI_FIGHT_KINDS = [
    'wanderer',
    'wanderer-ambush',
    'patrol',
    'bounty-hunter',
    'hunt-pack',
    'hunt-target',
    'questbook-boss',
    'story-reckoning',
] as const;

export type WorldAiFightKind = typeof WORLD_AI_FIGHT_KINDS[number];

export type WorldAiFightRequest = {
    kind: WorldAiFightKind;
    /** Stable server-known identity: NPC, mission, epic, or story id. */
    sourceId: string;
    sector: number;
    /** Required after the first wave of a server-owned chain. */
    stage?: number;
    chainId?: string;
    /** Required when a hunt choice rolled a pack ambush. */
    decisionId?: string;
};

/** Token/session-sealed context echoed by start and settlement. */
export type WorldAiFightContext = {
    kind: WorldAiFightKind;
    sourceId: string;
    sector: number;
    stage: number;
    displayName: string;
    chainId?: string;
    missionId?: string;
    /** Server-owned Hunter contract nonce; stale fights cannot settle a reaccept. */
    huntRunId?: string;
    decisionId?: string;
    nextStage?: number;
    finalStage?: boolean;
    huntQuality?: number;
    huntOpening?: 'cornered' | 'even' | 'enraged';
    /** Server-only version of the quest/story seal; prevents pre-advance replay. */
    sealVersion?: string;
};

export type WorldAiFightActivePointer = {
    playerName: string;
    token: string;
    sessionId: string;
    context: WorldAiFightContext;
    createdAt: number;
};

/** Durable handoff between chained waves. It stays on the server-owned save
 * until the next wave settles, so a lost report response cannot lose chainId. */
export type WorldAiFightPendingChain = {
    request: WorldAiFightRequest & { stage: number; chainId: string };
    displayName: string;
    createdAt: number;
};

/** Durable post-combat handoff for a reward that is claimed by an existing
 * server endpoint. It survives a lost final-wave response or a tab crash. */
export type WorldAiFightPendingOutcome = {
    kind: 'wanderer-ambush-reward';
    claimId: string;
    chainId: string;
    sourceId: 'wanderer-ambush';
    sector: number;
    createdAt: number;
};

export function isWorldAiFightKind(value: unknown): value is WorldAiFightKind {
    return typeof value === 'string' && (WORLD_AI_FIGHT_KINDS as readonly string[]).includes(value);
}
