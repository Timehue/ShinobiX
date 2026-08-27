/*
 * Battle Towers — client API + session types.
 *
 * Thin typed wrappers over the server endpoints (api/towers/*). Auth headers are attached
 * automatically by the global authFetch interceptor, so these are plain fetch() calls; the
 * logged-in player's name is passed in the body and the server cross-validates it against
 * the auth headers. The session types mirror the server's TowerSession shape (the repo
 * duplicates server↔client combat types the same way for PvP).
 */
import type { Character } from '../types/character';

export type TowerSide = 'squad' | 'enemy' | 'npc';

export type TowerStatus = {
    name: string;
    /** Server-authored jutsu, weapon, zone, or Tower grid policy that created the status. */
    source?: string;
    rounds: number;
    activeRound?: number;
    inactiveRound?: number;
    kind?: 'positive' | 'negative';
    percent?: number;
    amount?: number;
    discipline?: 'Taijutsu' | 'Bukijutsu' | 'Genjutsu' | 'Ninjutsu';
};

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
    /** server-recorded consumables spent in this run */
    itemsUsed?: Record<string, number>;
    /** active jutsu cooldowns {jutsuId: turns left} */
    cooldowns?: Record<string, number>;
};

export type TowerFeature =
    | { kind: 'pylon'; tiles: number[]; element: string; weakenElement: string; percent: number; label?: string }
    | { kind: 'ward'; tiles: number[]; percent: number; label?: string }
    | { kind: 'hazard'; tiles: number[]; percent: number; label?: string };

/** A board object — a tile worth HOLDING. Fonts restore whoever stands on them at round
 *  end (any side, capped); shrines grant the holding team a capped damage bonus. */
export type TowerBoardObject =
    | { kind: 'font'; resource: 'hp' | 'chakra' | 'stamina'; percent: number; cap: number; tiles?: number[]; label?: string }
    | { kind: 'shrine'; percent: number; tiles?: number[]; label?: string };

export type TowerMap = {
    width: number;
    height: number;
    /** floor biome — drives the battlefield floor art */
    biome?: string;
    blockedTiles: number[];
    hazardTiles: number[];
    objectiveTiles: number[];
    /** board objects (fonts / shrines) with resolved tiles — drawn + tinted on the board */
    boardObjects?: TowerBoardObject[];
    /** dynamic hazards (geyser vents) with resolved tiles — drawn on the board; the tiles about
     *  to erupt also come through nextRoundHazardTiles (crimson telegraph) so they pulse a round ahead */
    dynamicHazards?: Array<{ kind: string; tiles: number[]; pct: number; everyRounds: number; firstRound?: number }>;
    /** positional battlefield features (pylons/wards/hazards) — drawn on the board */
    features?: TowerFeature[];
    /** Endless Spire telegraph: tiles that will burn at the END of the current round from
     *  ascension hazard keystones (exact deterministic hazards only). Painted as a danger
     *  overlay so the squad can pre-position; absent for story runs. */
    nextRoundHazardTiles?: number[];
    /** Closing-ring hazard (story boss finale): the safe zone shrinks toward centre each
     *  round; tiles outside it chip the squad at round end. Client re-derives the lethal
     *  tiles via towerClosingRingTiles (a byte-mirror of the server) to paint them ember. */
    closingRing?: { pct?: number; fromRound?: number; minRadius?: number };
};

export type TowerObjectiveState = {
    kind: string;
    npcAlive?: boolean;
    reachedGoal?: boolean;
    /** Server-counted completed rounds for survive / timed hold objectives. */
    roundsSurvived?: number;
    /** Authoritative boss-barrier projection; includes delayed reinforcement waves. */
    addsRemaining?: number;
    bossUnlocked?: boolean;
    /** Authoritative break-objective projection (new wire names plus rollout aliases). */
    breakProgress?: number;
    breakGoal?: number;
    breakStagesCompleted?: number;
    breakStagesTotal?: number;
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

/** A sealed Endless Spire modifier (rendered as a pre-fight manifest chip). */
export type TowerModifier = { kind: string; value: number; label: string; variant?: string };

export type TowerFloorView = {
    id?: number;
    name?: string;
    chapter?: number;
    chapterTitle?: string | null;
    chapterSubtitle?: string | null;
    chapterSummary?: string | null;
    artKey?: string | null;
    briefing?: { situation: string; tactics: string[]; warnings: string[] } | null;
    objective?: string;
    roundBudget?: number;
    boss?: {
        targetMode?: 'lowest-hp' | 'squishiest' | 'support';
        strike?: { kind: 'nova' | 'volley' | 'slam'; pct: number; radius: number; everyRounds: number; firstRound?: number };
    };
};

export type TowerSession = {
    towerId: string;
    runId: string;
    floor: number;
    seed: number;
    partySize: number;
    map: TowerMap;
    actors: TowerActor[];
    /** Enemy pods sealed for a future round; never infer these from current board HP. */
    pendingEnemyWaves?: Array<{ round: number; actors: TowerActor[] }>;
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
    /** sealed encounter weather (combat missions): ±element outgoing-damage term + strip display */
    weather?: { positiveElement?: string; negativeElement?: string };
    /** the player's sealed active pet, summonable onto the field once via {type:'summon'};
     *  server-consumed on use, so its presence is what enables the Pet action */
    pendingCompanion?: { petId: string; name: string; hp: number; damage: number };
    // ── Endless Spire (sealed at entry; present only on ascension runs) ──────────
    ascensionTier?: number;
    spireBossId?: string;
    /** the hard round cap this floor (drives the round-clock HUD) */
    roundCap?: number;
    enrageCap?: number;
    dmgMult?: number;
    /** the sealed modifiers, rendered as manifest chips */
    modifierStack?: TowerModifier[];
    /** the boss's currently-primed telegraphed strike: the exact tiles that detonate at the
     *  END of `round` (painted violet, distinct from the crimson spire hazards) */
    bossStrike?: { tiles: number[]; round: number; pct: number; kind: string; label: string };
    /** Narrow client view of the run-sealed catalog truth used by tactical HUD copy. */
    sealedCatalogFloor?: TowerFloorView;
    /** Exact server-sealed rules for a non-catalog authoritative encounter. */
    encounterFloor?: TowerFloorView;
    /** Present only on the sealed level-80 world-crisis triad encounter. */
    worldCrisis80?: { crisisId: string; village: string; sourceId: string };
    /** Monotonic server action revision used by optional reconnect-safe commands. */
    actionVersion?: number;
    /**
     * Cosmetic combat VFX plates for the last resolved action or DoT tick
     * (api/towers/_engine.ts). Replaced wholesale each time, with `vfxSeq`
     * bumping so the screen can tell new plates from a re-poll of the same ones.
     * Display-only — never read back as combat authority.
     */
    vfx?: TowerVfxEvent[];
    vfxSeq?: number;
};

/** One VFX plate. `target` is an ACTOR ID on the board (the tower is n-actor,
 *  unlike PvP's fixed p1/p2); tile-anchored plates carry `tiles` instead. */
export type TowerVfxEvent = {
    key: string;
    target?: string;
    anchor: "caster" | "target" | "tile" | "area";
    tiles?: number[];
    persistent?: boolean;
};

/** Mirrors the server TURN_AFK_MS — how long a player has before their turn auto-passes. */
export const TOWER_TURN_AFK_MS = 75_000;

/** Endless Spire — number of ascension floors (mirrors the server SPIRE_MAX_TIER). */
export const SPIRE_MAX_TIER = 20;
/** Milestone floors (title/border unlocks). */
export const SPIRE_MILESTONE_FLOORS = [5, 10, 15, 20];

export type TowerActionInput =
    | { type: 'move'; tile: number }
    | { type: 'dash'; tile: number }
    | { type: 'attack'; targetId: string }
    | { type: 'jutsu'; jutsuId: string; targetId?: string; tile?: number }
    | { type: 'weapon'; targetId: string; itemId?: string }
    | { type: 'item'; itemId?: string }
    | { type: 'heal' }
    | { type: 'cleanse' }
    | { type: 'clear'; targetId: string }
    | { type: 'summon' }
    | { type: 'wait' }
    /** Public Tower Team Arena only; Story/Spire never render this command. */
    | { type: 'forfeit' };

/** The host's client-computed combat extras the SAVE doesn't persist (pvpItems + the
 *  equipment-derived passives) — sent to /start so the tower fighter matches PvP. */
export type TowerHostLoadout = {
    pvpItems: unknown[];
    bloodlineMult: number;
    armorFactor: number;
    armorRawDR: number;
    itemDamagePct: number;
    itemAbsorbPct: number;
    itemReflectPct: number;
    itemLifeStealPct: number;
    itemShield: number;
};

export type TowerActionResponse = {
    applied: boolean;
    reason?: string;
    session: TowerSession;
    currentVersion: number;
    /** Temporary rollout alias accepted defensively; the final endpoint uses currentVersion. */
    actionVersion?: number;
    replayed?: boolean;
};
export type TowerActionCommandMeta = { moveToken: string; expectedVersion?: number };
export type TowerSettleResult = { paid: boolean; reason?: string; score?: number };
export type TowerConsumedItemsResult = { consumed: boolean; reason?: string; used?: Record<string, number> };
export type TowerSettleResponse = {
    runId: string;
    winner: TowerSession['winner'];
    results: Record<string, TowerSettleResult>;
    consumables?: Record<string, TowerConsumedItemsResult>;
    character?: Character | null;
    _saveVersion?: number;
    /** Explicit endpoint confirmation that every receipt outcome is terminal. */
    settled: boolean;
};

export type TowerFloorMeta = {
    id: number;
    name: string;
    /** Public story-arc presentation authored by the same catalog as the encounter. */
    chapter?: number;
    chapterTitle?: string | null;
    chapterSubtitle?: string | null;
    chapterSummary?: string | null;
    /** Tower-local visual key. Resolution is fail-safe and never affects combat. */
    artKey?: string | null;
    /** Concise, server-authored pre-run intelligence for this exact encounter. */
    briefing?: {
        situation: string;
        tactics: string[];
        warnings: string[];
    } | null;
    biome: string;
    objective: string;
    roundBudget: number;
    isBoss: boolean;
    bossMechanic: string | null;
    bossTargetMode: 'lowest-hp' | 'squishiest' | 'support' | null;
    bossStrike: {
        kind: 'nova' | 'volley' | 'slam';
        everyRounds: number;
        firstRound: number;
        radius: number;
    } | null;
    closingRing: { fromRound: number; minRadius: number; percent: number } | null;
    dynamicHazards: Array<{ kind: string; everyRounds: number; firstRound: number; count: number }>;
    fieldRule: { kind: 'hazard' | 'debuff' | 'buff'; tag: string; percent?: number } | null;
    enemyCount: number;
    /** Additional enemies authored at boss HP gates; excluded from enemyCount because
     *  they are not present at encounter start. Older cached catalogs may omit it. */
    phaseReinforcementCount?: number;
    reinforcementWaves: number[];
    firstClearReward: {
        ryo: number;
        statPoints: number;
        fateShards: number;
        boneCharms: number;
        milestone: string | null;
    };
    milestone: string | null;
    map: { width: number; height: number };
};

export type TowerPartyBinding =
    | { mode: 'story'; floor: number }
    | { mode: 'spire'; ascensionTier: number };

export type TowerPartyMember = {
    slug: string;
    displayName: string;
    joinedAt: number;
    ready: boolean;
    /** Server-authored novice recruit. It has no player identity or rewards. */
    ai?: boolean;
    aiProfile?: 'story-recruit-v1';
};

export type TowerPartyView = {
    id: string;
    inviteCode: string;
    hostSlug: string;
    binding: TowerPartyBinding;
    status: 'forming' | 'launching' | 'active' | 'closed';
    members: TowerPartyMember[];
    invitedSlugs: string[];
    version: number;
    createdAt: number;
    updatedAt: number;
    expiresAt: number;
    launch?: {
        requestId: string;
        runId: string;
        seed: number;
        state: 'prepared' | 'active' | 'completed' | 'failed' | 'blocked';
        preparedAt: number;
        startCount?: number;
        errorCode?: string;
    };
    sizeRequirements: { min: number; max: number; required: number | null };
    allReady: boolean;
    canLaunch: boolean;
    liveMemberCount: number;
    aiMemberCount: number;
    aiPolicy: {
        allowed: boolean;
        max: number;
        profile: 'story-recruit-v1';
        progressionEligible: false;
    };
};

export type TowerPartyInvitationView = {
    partyId: string;
    inviteCode: string;
    hostSlug: string;
    hostDisplayName?: string;
    binding: TowerPartyBinding;
    memberCount: number;
    expiresAt: number;
};

export type TowerPartyEnvelope = {
    party: TowerPartyView | null;
    invitations: TowerPartyInvitationView[];
    replayed?: boolean;
};

export type TowerPartyMutation =
    | { action: 'create'; mode: 'story'; floor: number }
    | { action: 'create'; mode: 'spire'; ascensionTier: number }
    | { action: 'join'; inviteCode: string; expectedVersion?: number }
    | { action: 'accept' | 'decline' | 'leave' | 'ready' | 'unready'; partyId: string; expectedVersion: number }
    | { action: 'invite' | 'kick' | 'revoke-invite' | 'remove-ai'; partyId: string; target: string; expectedVersion: number }
    | { action: 'add-ai'; partyId: string; expectedVersion: number };

export type TowerPartyMutationRequest = TowerPartyMutation & { playerName: string; requestId: string };

export type TowerPartyLaunchRequest = {
    hostName: string;
    partyId: string;
    requestId: string;
    expectedVersion: number;
    hostLoadout?: TowerHostLoadout;
} & TowerPartyBinding;

export type TowerPartyStartResponse = {
    runId: string;
    partyId: string;
    party: TowerPartyView;
    session: TowerSession;
    chargedRyo: number;
    replayed: boolean;
    character?: Character;
    _saveVersion?: number;
};

export type TowerPartyMemberRequirement = {
    member: string;
    requiredFloor?: number;
    requiredLevel?: number;
};

export type TowerMyRunStatus = {
    runId: string | null;
    pvpMatchId?: string;
    session?: TowerSession;
    recoveryPending?: boolean;
    leaseReleased?: boolean;
};

/** Mirrors api/_utils.safeName for Tower owner/receipt keys. */
export function towerPlayerSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, 32);
}

async function towerJson<T>(res: Response): Promise<T> {
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
        throw new Error('The Battle Towers API is unavailable. Run the full game server instead of the client-only preview.');
    }
    try {
        return await res.json() as T;
    } catch {
        throw new Error('The Battle Towers server returned an unreadable response.');
    }
}

/** The public floor-catalog metadata for the lobby picker. */
export async function fetchTowerFloors(): Promise<TowerFloorMeta[]> {
    return withTowerFetch('/api/towers/floors', undefined, async res => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = await towerJson<{ floors: TowerFloorMeta[] }>(res);
        return data.floors;
    });
}

export class TowerTransportError extends Error {
    override readonly name = 'TowerTransportError';
}

/** Keep a dead connection from pinning Tower polling, actions, or settlement forever. */
export const TOWER_REQUEST_TIMEOUT_MS = 12_000;

/**
 * Compose a caller cancellation signal with a bounded request deadline. The timer and
 * external listener are always released, including when response-body parsing fails.
 */
export async function withTowerRequestDeadline<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    externalSignal?: AbortSignal,
    timeoutMs = TOWER_REQUEST_TIMEOUT_MS,
): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, Math.max(1, timeoutMs));
    try {
        return await operation(controller.signal);
    } catch (error) {
        if (timedOut) throw new TowerTransportError('The Tower request timed out. Check your connection and try again.');
        throw error;
    } finally {
        globalThis.clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', abortFromCaller);
    }
}

async function withTowerFetch<T>(
    url: string,
    init: RequestInit | undefined,
    read: (response: Response) => Promise<T>,
): Promise<T> {
    const externalSignal = init?.signal ?? undefined;
    return withTowerRequestDeadline(async signal => {
        let response: Response;
        try {
            response = await fetch(url, { ...init, signal });
        } catch (error) {
            if (externalSignal?.aborted) throw error;
            throw new TowerTransportError(error instanceof Error ? error.message : 'Network request failed.');
        }
        return read(response);
    }, externalSignal);
}

export class TowerPartyApiError extends Error {
    override readonly name = 'TowerPartyApiError';
    readonly status: number;
    readonly errorCode?: string;
    readonly party?: TowerPartyView | null;
    readonly members?: string[];
    readonly requiredTier?: number;
    readonly requiredFloor?: number;
    readonly requiredLevel?: number;
    readonly memberRequirements?: TowerPartyMemberRequirement[];

    constructor(
        message: string,
        status: number,
        errorCode?: string,
        party?: TowerPartyView | null,
        members?: string[],
        requiredTier?: number,
        requiredFloor?: number,
        requiredLevel?: number,
        memberRequirements?: TowerPartyMemberRequirement[],
    ) {
        super(message);
        this.status = status;
        this.errorCode = errorCode;
        this.party = party;
        this.members = members;
        this.requiredTier = requiredTier;
        this.requiredFloor = requiredFloor;
        this.requiredLevel = requiredLevel;
        this.memberRequirements = memberRequirements;
    }
}

export class TowerStateApiError extends Error {
    override readonly name = 'TowerStateApiError';
    readonly status: number;
    readonly errorCode?: 'run-publication-pending' | 'run-unavailable' | string;
    readonly leaseReleased?: boolean;

    constructor(message: string, status: number, errorCode?: string, leaseReleased?: boolean) {
        super(message);
        this.status = status;
        this.errorCode = errorCode;
        this.leaseReleased = leaseReleased;
    }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
    return withTowerFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }, async res => {
            if (!res.ok) {
                const err = await res.json().catch(() => ({})) as { error?: string };
                throw new Error(err.error || `Request failed (${res.status})`);
            }
            return towerJson<T>(res);
        });
}

async function towerPartyFetch<T>(url: string, init?: RequestInit): Promise<T> {
    return withTowerFetch(url, init, async res => {
        if (!res.ok) {
            const errorBody = await res.json().catch(() => ({})) as {
                error?: string;
                errorCode?: string;
                party?: TowerPartyView | null;
                members?: string[];
                requiredTier?: number;
                requiredFloor?: number;
                requiredLevel?: number;
                memberRequirements?: TowerPartyMemberRequirement[];
            };
            throw new TowerPartyApiError(
                errorBody.error || `Request failed (${res.status})`,
                res.status,
                errorBody.errorCode,
                errorBody.party,
                errorBody.members,
                errorBody.requiredTier,
                errorBody.requiredFloor,
                errorBody.requiredLevel,
                errorBody.memberRequirements,
            );
        }
        try {
            return await res.json() as T;
        } catch (error) {
            throw new TowerTransportError(error instanceof Error ? error.message : 'The Tower ready room response was lost.');
        }
    });
}

export type TowerPartyMutationTransport = (request: TowerPartyMutationRequest) => Promise<TowerPartyEnvelope>;
export type TowerPartyLaunchTransport = (request: TowerPartyLaunchRequest) => Promise<TowerPartyStartResponse>;

async function postTowerPartyMutation(request: TowerPartyMutationRequest): Promise<TowerPartyEnvelope> {
    return towerPartyFetch('/api/towers/party', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });
}

async function postTowerPartyLaunch(request: TowerPartyLaunchRequest): Promise<TowerPartyStartResponse> {
    return towerPartyFetch('/api/towers/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });
}

async function retryLostTowerResponseOnce<TRequest, TResponse>(
    request: TRequest,
    transport: (request: TRequest) => Promise<TResponse>,
): Promise<TResponse> {
    try {
        return await transport(request);
    } catch (error) {
        if (!(error instanceof TowerTransportError)) throw error;
        return transport(request);
    }
}

/** Private authenticated ready-room status; the server only returns member/invited rooms. */
export function fetchTowerParty(playerName: string, partyId?: string, signal?: AbortSignal): Promise<TowerPartyEnvelope> {
    const query = new URLSearchParams({ playerName });
    if (partyId) query.set('partyId', partyId);
    return towerPartyFetch(`/api/towers/party?${query.toString()}`, { signal });
}

export function mutateTowerPartyWithLostResponseRetry(
    playerName: string,
    mutation: TowerPartyMutation,
    transport: TowerPartyMutationTransport = postTowerPartyMutation,
): Promise<TowerPartyEnvelope> {
    const request = { playerName, requestId: createTowerPartyRequestId(), ...mutation } as TowerPartyMutationRequest;
    return retryLostTowerResponseOnce(request, transport);
}

export function launchTowerPartyWithLostResponseRetry(
    hostName: string,
    party: TowerPartyView,
    hostLoadout?: TowerHostLoadout,
    transport: TowerPartyLaunchTransport = postTowerPartyLaunch,
): Promise<TowerPartyStartResponse> {
    const request = {
        hostName,
        partyId: party.id,
        requestId: createTowerPartyRequestId(),
        expectedVersion: party.version,
        ...party.binding,
        ...(hostLoadout ? { hostLoadout } : {}),
    } as TowerPartyLaunchRequest;
    return retryLostTowerResponseOnce(request, transport);
}

/** Start a host-only Story run. AI teammates are added only through the Story Ready Room. */
export function startTowerRun(hostName: string, floor: number, hostLoadout?: TowerHostLoadout): Promise<{ runId: string; session: TowerSession; character?: Character; chargedRyo?: number; _saveVersion?: number }> {
    return postJson('/api/towers/start', { hostName, floor, hostLoadout });
}

/** Admin/dev compatibility only. Regular Spire progression requires an exact-four live ready room. */
export function startSpireRun(hostName: string, ascensionTier: number, hostLoadout?: TowerHostLoadout): Promise<{ runId: string; session: TowerSession }> {
    return postJson('/api/towers/start', { hostName, mode: 'spire', ascensionTier, hostLoadout });
}

/** Confirm membership and refresh the server-sealed session on entry. The join route is
 *  deliberately read-only: every actor was sealed from its own save at /start, and `loadout`
 *  remains in the body only for older-server compatibility. Best-effort failures stay soft. */
export async function joinTowerRun(runId: string, playerName: string, loadout: TowerHostLoadout): Promise<TowerSession | null> {
    try {
        const data = await postJson<{ session?: TowerSession }>('/api/towers/join', { runId, playerName, loadout });
        return data.session ?? null;
    } catch {
        return null;
    }
}

/** Submit one action for the human's actor on their turn. Metadata is optional for legacy callers. */
export function submitTowerAction(runId: string, playerName: string, action: TowerActionInput, metadata?: TowerActionCommandMeta): Promise<TowerActionResponse> {
    return withTowerFetch('/api/towers/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, playerName, ...action, ...metadata }),
    }, async res => {
        if (res.ok) return towerJson<TowerActionResponse>(res);
        const errorBody = await res.json().catch(() => ({})) as {
            error?: string;
            errorCode?: string;
            reason?: string;
            session?: TowerSession;
            currentVersion?: number;
        };
        // Conflicts can carry the authoritative session (for example, another member
        // caused this client's idle turn to auto-pass). Adopt it like a rejected action.
        if (errorBody.session) {
            return {
                applied: false,
                reason: errorBody.reason ?? errorBody.errorCode ?? (res.status === 409 ? 'stale-version' : undefined),
                session: errorBody.session,
                currentVersion: errorBody.currentVersion ?? errorBody.session.actionVersion ?? 0,
            };
        }
        throw new Error(errorBody.error || `Request failed (${res.status})`);
    });
}

function createTowerClientToken(prefix: 'tower' | 'party'): string {
    const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    return `${prefix}_${randomId}`.slice(0, 80);
}

export function createTowerMoveToken(): string {
    return createTowerClientToken('tower');
}

export function createTowerPartyRequestId(): string {
    return createTowerClientToken('party');
}

/**
 * Retry exactly once only when fetch lost the response. The metadata object is
 * created once, so the replay can never accidentally mint a second move token.
 */
export async function submitTowerActionWithLostResponseRetry(
    runId: string,
    playerName: string,
    action: TowerActionInput,
    expectedVersion?: number,
    request: typeof submitTowerAction = submitTowerAction,
): Promise<TowerActionResponse> {
    const metadata: TowerActionCommandMeta = {
        moveToken: createTowerMoveToken(),
        ...(Number.isSafeInteger(expectedVersion) ? { expectedVersion } : {}),
    };
    try {
        return await request(runId, playerName, action, metadata);
    } catch (error) {
        if (!(error instanceof TowerTransportError)) throw error;
        return request(runId, playerName, action, metadata);
    }
}

/** Reconnect / poll the live session (gated to run members). */
export async function fetchTowerState(runId: string, playerName: string, signal?: AbortSignal): Promise<TowerSession> {
    return withTowerFetch(`/api/towers/state?runId=${encodeURIComponent(runId)}&playerName=${encodeURIComponent(playerName)}`, { signal }, async res => {
        if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { error?: string; errorCode?: string; leaseReleased?: boolean };
            throw new TowerStateApiError(err.error || `Request failed (${res.status})`, res.status, err.errorCode, err.leaseReleased);
        }
        const data = await towerJson<{ session: TowerSession }>(res);
        return data.session;
    });
}

/** Settle a completed run. Rewards pay only on squad clears; recorded consumables
 *  and throwables are finalized for any completed run. Idempotent. */
export function settleTowerRun(runId: string, playerName: string): Promise<TowerSettleResponse> {
    return postJson('/api/towers/settle', { runId, playerName });
}

/** Full lease-recovery projection, including a run that is still being republished. */
export async function fetchMyRunStatus(playerName: string): Promise<TowerMyRunStatus | null> {
    return withTowerFetch(`/api/towers/my-run?playerName=${encodeURIComponent(playerName)}`, undefined, async res => {
        if (!res.ok) return null;
        const data = await res.json().catch(() => ({})) as TowerMyRunStatus;
        if (data.runId || data.pvpMatchId || data.recoveryPending || data.leaseReleased) return data;
        return null;
    });
}

/** Backward-compatible active run helper for consumers that require a published session. */
export async function fetchMyRun(playerName: string): Promise<{ runId: string; session: TowerSession } | null> {
    const status = await fetchMyRunStatus(playerName);
    return status?.runId && status.session ? { runId: status.runId, session: status.session } : null;
}

// ─── Endless Spire — weekly leaderboard (best tier cleared this week) ─────────
export type SpireLeaderboardRow = { rank: number; name: string; tier: number; village?: string; level?: number };
export type SpireWeeklyAffix = { id: string; name: string; blurb: string; icon: string };
export type SpireLeaderboard = { weekKey: string; total: number; weekEndsAt?: number; affix?: SpireWeeklyAffix; leaderboard: SpireLeaderboardRow[] };

/** Public weekly Spire board + this week's Blessing. Best-effort — a failure yields an empty board. */
export async function fetchSpireLeaderboard(top = 25): Promise<SpireLeaderboard> {
    try {
        return await withTowerFetch(`/api/towers/spire-leaderboard?top=${top}`, undefined, async res => {
            if (!res.ok) return { weekKey: '', total: 0, leaderboard: [] };
            const data = await res.json().catch(() => ({})) as Partial<SpireLeaderboard>;
            return {
                weekKey: data.weekKey ?? '', total: data.total ?? 0,
                weekEndsAt: typeof data.weekEndsAt === 'number' ? data.weekEndsAt : undefined,
                affix: data.affix && typeof data.affix === 'object' ? data.affix : undefined,
                leaderboard: Array.isArray(data.leaderboard) ? data.leaderboard : [],
            };
        });
    } catch {
        return { weekKey: '', total: 0, leaderboard: [] };
    }
}
