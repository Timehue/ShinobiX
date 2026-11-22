/**
 * Wire contract for World Map encounters that use the canonical solo-PvE
 * runtime. The request contains identity only; combat stats, hunt quality,
 * quest stage, chain order, and rewards are all reconstructed by the server.
 */
import type { WorldCrisisVillage } from './world-crisis.js';
import type { OrdinaryPveEncounter } from './ordinary-pve-encounter.js';

// 'quest-line' is a drop or boss fight of a quest line (api/quests/_fight.ts);
// its sourceId is the quest id. 'coast-garrison' is a garrison fight for a land
// contest on the coast (api/coast/_land.ts); its sourceId is the contest id, and
// a win scores for the clan and pays nothing. 'coast-patrol' is one of the coast's
// daily patrols or beasts (api/coast/_patrols.ts); its sourceId is the patrol id, and
// it pays the ordinary purse. Keep comments out of the list itself: the
// runtime inventory test reads the kinds from this source by their quotes.
export const WORLD_AI_FIGHT_KINDS = [
    'wanderer',
    'wanderer-ambush',
    'patrol',
    'bounty-hunter',
    'hunt-pack',
    'hunt-target',
    'questbook-boss',
    'story-reckoning',
    'world-crisis',
    'quest-line',
    'coast-garrison',
    'coast-patrol',
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
    /** Optional preview identity. The server reconstructs it and rejects a
     * stale preview instead of silently starting a different opponent. */
    encounterId?: string;
};

/** Token/session-sealed context echoed by start and settlement. */
export type WorldAiFightContext = {
    kind: WorldAiFightKind;
    sourceId: string;
    sector: number;
    stage: number;
    displayName: string;
    encounter?: OrdinaryPveEncounter;
    chainId?: string;
    missionId?: string;
    /** Server-owned Hunter contract nonce; stale fights cannot settle a reaccept. */
    huntRunId?: string;
    decisionId?: string;
    nextStage?: number;
    finalStage?: boolean;
    huntQuality?: number;
    huntOpening?: 'cornered' | 'even' | 'enraged';
    huntFormation?: import('./hunt-combat.js').HuntFormation;
    /** Server-only version of the quest/story seal; prevents pre-advance replay. */
    sealVersion?: string;
    /** Server-derived home-village binding for a global outskirts defense. */
    crisisVillage?: WorldCrisisVillage;
    /**
     * A quest boss's Hold: the foe cannot fall until the named tool is used.
     * `charges` is how many the player held when the fight was sealed. `next`
     * lists the Holds that rise after it, in order, each with its own tool.
     */
    questHold?: { breakerItemId: string; name: string; charges: number; next?: Array<{ breakerItemId: string; name: string; charges: number }> };
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
