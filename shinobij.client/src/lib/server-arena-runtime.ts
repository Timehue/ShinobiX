/**
 * Presentation-only contract for the normal Arena shell.
 *
 * Combat runtimes adapt their authoritative state into this view model. The
 * renderer never imports a runtime client and never computes combat outcomes.
 */
export type ServerArenaSide = "squad" | "enemy" | "npc";

export type ServerArenaStatus = {
    name: string;
    rounds: number;
    kind?: "positive" | "negative";
    percent?: number;
    amount?: number;
};

export type ServerArenaActor = {
    id: string;
    side: ServerArenaSide;
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
    statuses: ServerArenaStatus[];
    pos: number;
    character: Record<string, unknown>;
    itemCharges?: Record<string, number>;
    itemsUsed?: Record<string, number>;
    cooldowns?: Record<string, number>;
};

export type ServerArenaSession = {
    sessionId: string;
    /** Opaque runtime revision used only by the selected transport. */
    runtimeVersion?: number;
    map: { width: number; height: number; biome?: string; blockedTiles: number[] };
    actors: ServerArenaActor[];
    turnQueue: string[];
    activeIndex: number;
    round: number;
    activeAp: number;
    actionsThisTurn: number;
    status: "active" | "done";
    winner: ServerArenaSide | "draw" | null;
    log: string[];
    groundEffects?: Array<{
        id: string;
        owner: string;
        name: string;
        tiles: number[];
        rounds: number;
        tags: Array<{ name: string; percent?: number; amount?: number }>;
    }>;
    weather?: { positiveElement?: string; negativeElement?: string };
    pendingCompanion?: { petId: string; name: string; hp: number; damage: number };
};

export type ServerArenaAction =
    | { type: "move"; tile: number }
    | { type: "attack"; targetId: string }
    | { type: "jutsu"; jutsuId: string; targetId?: string; tile?: number }
    | { type: "weapon"; targetId: string; itemId?: string }
    | { type: "item"; itemId?: string }
    | { type: "heal" }
    | { type: "cleanse" }
    | { type: "clear"; targetId: string }
    | { type: "summon" }
    | { type: "flee" }
    | { type: "wait" };

export type ServerArenaActionResponse = { applied: boolean; reason?: string; session: ServerArenaSession };

export type ServerArenaTransport = {
    turnTimeoutMs: number;
    fetchState: (sessionId: string, playerName: string) => Promise<ServerArenaSession>;
    submitAction: (
        sessionId: string,
        playerName: string,
        current: ServerArenaSession,
        action: ServerArenaAction,
    ) => Promise<ServerArenaActionResponse>;
    /** Optional deterministic terminal abandon intent used before the shell unmounts. */
    forfeit?: (
        sessionId: string,
        playerName: string,
        current: ServerArenaSession,
    ) => Promise<ServerArenaActionResponse>;
};
