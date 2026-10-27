/**
 * Keeper's Path: a single-player Chronicle run (Card Hall).
 *
 * Three acts. Each act is a seeded branching map of three rows and ends in
 * that act's Keeper. The player picks one node per row: a Fight, a harder
 * Elite, or a Shrine that grants a boon with no fight. Boons are rule
 * modifiers for the rest of the run. Two Resolve: a loss costs one and the
 * node may be fought again; losing both ends the run.
 *
 * The run lives in the save (`character.keeperPath`), server-owned, so a fight
 * settles in the same write as its Resolve, its node and any payout. These
 * reducers are pure and shared, so the screen can explain exactly what the
 * server will do without being trusted to do it.
 */

export const KEEPER_PATH_ACTS = 3;
export const KEEPER_PATH_ROWS = 3;
export const KEEPER_PATH_RESOLVE = 2;
/** Chronicle Points for a completed run, paid at most once per UTC day. */
export const KEEPER_PATH_CHRONICLE_POINTS = 60;

export type KeeperNodeKind = "fight" | "elite" | "shrine" | "boss";
export type KeeperDifficulty = "easy" | "medium" | "hard";

export type KeeperOpponent = {
    /** An Echoes of War encounter id, or `ai:<difficulty>` for a Card Hall deck. */
    key: string;
    name: string;
    title: string;
    deckName: string;
    difficulty: KeeperDifficulty;
};

export type KeeperNode = {
    id: string;
    act: number;
    /** 0..KEEPER_PATH_ROWS-1 for the map rows; KEEPER_PATH_ROWS for the boss. */
    row: number;
    index: number;
    kind: KeeperNodeKind;
    opponent?: KeeperOpponent;
    /** Nodes of the next row this node leads to. A boss leads to the next act's first row. */
    links: string[];
};

export type KeeperBoonId = "reserve" | "insight" | "pressure" | "vanguard";

export const KEEPER_BOONS: Readonly<Record<KeeperBoonId, { name: string; text: string; max: number }>> = Object.freeze({
    reserve: { name: "Deep Reserve", text: "Start every duel with 1,000 more life.", max: 3 },
    insight: { name: "Foresight", text: "Draw one more card in your opening hand.", max: 2 },
    pressure: { name: "Worn Keeper", text: "Every Keeper starts with 1,000 less life.", max: 3 },
    vanguard: { name: "Vanguard", text: "Your strongest Monster starts in your opening hand.", max: 1 },
});
export const KEEPER_BOON_IDS = Object.keys(KEEPER_BOONS) as KeeperBoonId[];

export type KeeperRun = {
    runId: string;
    seed: number;
    nodes: KeeperNode[];
    /** The last node cleared, or null before the first. */
    position: string | null;
    /** The node chosen and not yet won, or null. */
    current: string | null;
    resolve: number;
    boons: Partial<Record<KeeperBoonId, number>>;
    /** Three boons to choose from, after a Shrine or an Elite. */
    boonOffer: KeeperBoonId[] | null;
    status: "active" | "won" | "lost";
    /** The player's validated deck, sealed when the run started. */
    deck: string[];
    wins: number;
    battleProofs: string[];
    startedAt: number;
};

export type KeeperPathRecord = {
    clears: number;
    /** Most fights won in one run. */
    best: number;
    /** UTC day (YYYY-MM-DD) a completed run last paid Chronicle Points. */
    paidDay?: string;
    run: KeeperRun | null;
};

export type KeeperRunModifiers = {
    playerLifeBonus: number;
    keeperLifePenalty: number;
    extraOpeningCards: number;
    vanguard: boolean;
};

export function keeperRunModifiers(boons: KeeperRun["boons"]): KeeperRunModifiers {
    const count = (id: KeeperBoonId) => Math.max(0, Math.min(KEEPER_BOONS[id].max, Math.floor(Number(boons[id]) || 0)));
    return {
        playerLifeBonus: count("reserve") * 1_000,
        keeperLifePenalty: count("pressure") * 1_000,
        extraOpeningCards: count("insight"),
        vanguard: count("vanguard") > 0,
    };
}

export function emptyKeeperPath(): KeeperPathRecord {
    return { clears: 0, best: 0, run: null };
}

/** Read a stored record defensively. The stored copy is server-owned. */
export function keeperPathOf(character: Record<string, unknown>): KeeperPathRecord {
    const raw = character.keeperPath;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyKeeperPath();
    const source = raw as Record<string, unknown>;
    const run = source.run && typeof source.run === "object" && !Array.isArray(source.run)
        && typeof (source.run as KeeperRun).runId === "string" && Array.isArray((source.run as KeeperRun).nodes)
        ? source.run as KeeperRun
        : null;
    return {
        clears: Math.max(0, Math.floor(Number(source.clears) || 0)),
        best: Math.max(0, Math.floor(Number(source.best) || 0)),
        ...(typeof source.paidDay === "string" ? { paidDay: source.paidDay } : {}),
        run,
    };
}

export function keeperNode(run: KeeperRun, id: string | null | undefined): KeeperNode | null {
    return id ? run.nodes.find((node) => node.id === id) ?? null : null;
}

/** The nodes the player may choose next. None while a node is in progress or a boon is on offer. */
export function keeperReachableNodes(run: KeeperRun): KeeperNode[] {
    if (run.status !== "active" || run.current || run.boonOffer) return [];
    const from = keeperNode(run, run.position);
    if (!from) return run.nodes.filter((node) => node.act === 0 && node.row === 0);
    return from.links.map((id) => keeperNode(run, id)).filter((node): node is KeeperNode => !!node);
}

/** Three boons for a Shrine or an Elite, seeded by the run and the node so a reload offers the same three. */
export function keeperBoonOffer(run: KeeperRun, nodeId: string): KeeperBoonId[] {
    const open = KEEPER_BOON_IDS.filter((id) => (run.boons[id] ?? 0) < KEEPER_BOONS[id].max);
    let state = (run.seed ^ hashString(nodeId)) >>> 0;
    const next = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pool = [...open];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 3);
}

export function hashString(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return hash >>> 0;
}

type Outcome = { record: KeeperPathRecord; changed: boolean };
const unchanged = (record: KeeperPathRecord): Outcome => ({ record, changed: false });

/** Choose the next node. A Shrine is cleared at once and offers its boons; any other node waits for its fight. */
export function chooseKeeperNode(record: KeeperPathRecord, nodeId: string): Outcome {
    const run = record.run;
    if (!run || !keeperReachableNodes(run).some((node) => node.id === nodeId)) return unchanged(record);
    const node = keeperNode(run, nodeId)!;
    if (node.kind === "shrine") {
        return { record: { ...record, run: { ...run, position: node.id, current: null, boonOffer: keeperBoonOffer(run, node.id) } }, changed: true };
    }
    return { record: { ...record, run: { ...run, current: node.id } }, changed: true };
}

export function chooseKeeperBoon(record: KeeperPathRecord, boonId: string): Outcome {
    const run = record.run;
    if (!run?.boonOffer || !run.boonOffer.includes(boonId as KeeperBoonId)) return unchanged(record);
    const id = boonId as KeeperBoonId;
    const boons = { ...run.boons, [id]: Math.min(KEEPER_BOONS[id].max, (run.boons[id] ?? 0) + 1) };
    return { record: { ...record, run: { ...run, boons, boonOffer: null } }, changed: true };
}

export function abandonKeeperRun(record: KeeperPathRecord): Outcome {
    const run = record.run;
    if (!run || run.status !== "active") return unchanged(record);
    return { record: { ...record, best: Math.max(record.best, run.wins), run: { ...run, status: "lost", current: null, boonOffer: null } }, changed: true };
}

/**
 * Settle one fight. A win clears the node (an Elite also offers boons and
 * restores one Resolve; the last Keeper completes the run). A loss costs one
 * Resolve and leaves the node to fight again; at zero the run ends. A draw
 * changes nothing. The proof makes a retried settlement a no-op.
 */
export function settleKeeperFight(
    record: KeeperPathRecord,
    runId: string,
    nodeId: string,
    result: "win" | "loss" | "draw",
    proofId: string,
    now: number,
): Outcome & { finished: boolean; chroniclePoints: number; firstClear: boolean } {
    const none = { ...unchanged(record), finished: false, chroniclePoints: 0, firstClear: false };
    const run = record.run;
    const proof = String(proofId).slice(0, 120);
    if (!run || run.runId !== runId || run.status !== "active" || run.current !== nodeId || !proof || run.battleProofs.includes(proof)) return none;
    const node = keeperNode(run, nodeId);
    if (!node) return none;
    const battleProofs = [...run.battleProofs, proof].slice(-16);
    if (result === "draw") return { ...none, record: { ...record, run: { ...run, battleProofs } }, changed: true };
    if (result === "loss") {
        const resolve = run.resolve - 1;
        const lost = resolve <= 0;
        return {
            ...none,
            record: {
                ...record,
                best: lost ? Math.max(record.best, run.wins) : record.best,
                run: { ...run, resolve: Math.max(0, resolve), status: lost ? "lost" : "active", current: lost ? null : run.current, battleProofs },
            },
            changed: true,
        };
    }
    const wins = run.wins + 1;
    const finished = node.kind === "boss" && node.act === KEEPER_PATH_ACTS - 1;
    const day = new Date(now).toISOString().slice(0, 10);
    const pays = finished && record.paidDay !== day;
    const nextRun: KeeperRun = {
        ...run,
        wins,
        position: node.id,
        current: null,
        battleProofs,
        status: finished ? "won" : "active",
        resolve: node.kind === "elite" ? Math.min(KEEPER_PATH_RESOLVE, run.resolve + 1) : run.resolve,
        boonOffer: node.kind === "elite" && !finished ? keeperBoonOffer(run, node.id) : null,
    };
    return {
        record: {
            clears: record.clears + (finished ? 1 : 0),
            best: Math.max(record.best, wins),
            ...(pays ? { paidDay: day } : record.paidDay ? { paidDay: record.paidDay } : {}),
            run: nextRun,
        },
        changed: true,
        finished,
        chroniclePoints: pays ? KEEPER_PATH_CHRONICLE_POINTS : 0,
        firstClear: finished && record.clears === 0,
    };
}
