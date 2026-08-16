/**
 * Presentation-only contract for the normal Arena shell.
 *
 * Combat runtimes adapt their authoritative state into this view model. The
 * renderer never imports a runtime client and never computes combat outcomes.
 */
export type ServerArenaSide = "squad" | "enemy" | "npc";

export type ServerArenaStatus = {
    name: string;
    source?: string;
    rounds: number;
    activeRound?: number;
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

/**
 * One server-authored combat VFX plate. The engine emits these alongside each
 * combat event; the client renders them and never reads them back as authority
 * (damage, statuses, and settlement all come from the session snapshot).
 *
 * `seq` is the emitting event's sequence number, so a screen can replay only the
 * plates it has not shown yet — one action can produce several events at once
 * (the player's action, then the enemy's whole turn), and the session carries a
 * rolling window of them rather than just the newest.
 */
export type ServerArenaVfxEvent = {
    seq: number;
    key: string;
    /** An actor id ("player" / "enemy" / "companion") or a board-anchored plate. */
    target: string;
    anchor: "caster" | "target" | "tile" | "area";
    tiles?: number[];
    persistent?: boolean;
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
    /** True after this fight's one sealed companion summon has been consumed. */
    companionUsed?: boolean;
    /** Rolling window of server-authored VFX plates (see ServerArenaVfxEvent). */
    vfx?: ServerArenaVfxEvent[];
    /** Highest event seq the session has produced; bumps when new VFX arrive. */
    vfxSeq?: number;
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
};
