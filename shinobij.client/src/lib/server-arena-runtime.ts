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
    inactiveRound?: number;
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

/**
 * One server-authored board relocation, projected for cosmetic replay only.
 * A Solo PvE enemy can spend several actions moving during one server turn;
 * retaining every event keeps those adjacent steps from collapsing into one
 * apparent teleport when the final session snapshot reaches the client.
 */
export type ServerArenaMovementEvent = {
    seq: number;
    actorId: string;
    from: number;
    to: number;
};

/** A fighter's presentation-relevant change in one resolved event: a floating
 *  number over its tile. Derived from server snapshots, never from the client. */
export type ServerArenaHitEvent = {
    /** Actor id ("player" / "enemy" / "companion"). */
    target: string;
    amount: number;
    kind: "damage" | "heal" | "shield" | "status";
    /** Pre-formatted text (a status name, "+12 guard"); the screen falls back to ±amount. */
    label?: string;
};

/**
 * One resolved combat event as a PRESENTATION beat. A single server round-trip
 * commonly resolves the player's action and the enemy's whole multi-action
 * reply; the screen lays these beats out on one timeline (see
 * lib/combat-presentation arenaBeatSchedule) so each plate, number and hit
 * reaction lands in the order it happened instead of all on one frame.
 * Cosmetic only — never read back as combat authority.
 */
export type ServerArenaBeat = {
    seq: number;
    /** Acting actor id. */
    actorId: string;
    /** Targeted actor id, or null for a tile / self-only action. */
    targetId: string | null;
    action: string;
    /** True when the event only relocated its actor (a walk step). */
    movement: boolean;
    /** Board tile of every actor present AFTER the event, for aiming reactions. */
    positions: Record<string, number>;
    /** Max HP per actor after the event (heavy-hit threshold). */
    maxHp: Record<string, number>;
    hits: ServerArenaHitEvent[];
    /** Actor ids whose HP reached 0 in this event. */
    downed: string[];
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
    /** Rolling server-authored movement trail for presentation-only replay. */
    movements?: ServerArenaMovementEvent[];
    /** Highest combat event seq observed by the movement projection. */
    movementSeq?: number;
    /** Rolling window of resolved events as presentation beats (see ServerArenaBeat). */
    beats?: ServerArenaBeat[];
    /** Highest event seq the beat projection has produced. */
    beatSeq?: number;
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
