export type RankedQueuePhase = "joining" | "queued" | "launching";

export type RankedQueueClientSession = Readonly<{
    ownerKey: string;
    generation: number;
    phase: RankedQueuePhase;
}>;

export type RankedQueueWireResult<T> =
    | Readonly<{ status: "completed"; value: T }>
    | Readonly<{ status: "retired" }>
    | Readonly<{ status: "busy" }>;

export type RankedChallengeSettlementTracking = Readonly<{
    challengeId: string;
    observed: boolean;
    expiresAt: number;
}>;

export type RankedChallengeSettlementDecision =
    | "pending"
    | "observed"
    | "resolved"
    | "disappeared"
    | "expired";

/**
 * Reconcile one exact outgoing challenge without treating an unrelated inbox
 * mutation as settlement. A challenge first becomes observable by id; after
 * that, its disappearance means App consumed a resolution or pruned its TTL.
 * An explicit resolution or the conservative local deadline also settles it.
 */
export function rankedChallengeSettlementDecision(
    tracking: RankedChallengeSettlementTracking,
    challenges: ReadonlyArray<Readonly<{ id: string; accepted?: boolean; declined?: boolean }>>,
    now: number,
): RankedChallengeSettlementDecision {
    if (now >= tracking.expiresAt) return "expired";
    const exact = challenges.find((challenge) => challenge.id === tracking.challengeId);
    if (exact?.accepted === true || exact?.declined === true) return "resolved";
    if (exact) return tracking.observed ? "pending" : "observed";
    return tracking.observed ? "disappeared" : "pending";
}

type MutableRankedQueueSession = {
    ownerKey: string;
    generation: number;
    phase: RankedQueuePhase;
};

function normalizedOwnerKey(ownerKey: string): string {
    return ownerKey.trim().toLowerCase();
}

function snapshot(session: MutableRankedQueueSession): RankedQueueClientSession {
    return Object.freeze({ ...session });
}

/**
 * Client-only authority fence for the ranked queue.
 *
 * The server remains the queue, proof, and battle authority. This coordinator
 * only makes browser intent ordered and account-scoped: every attempt gets a
 * monotonically increasing generation, wire actions share one serial tail,
 * polls are single-flight, and one generation may consume at most one match.
 */
export function createRankedQueueLifecycle() {
    let boundOwnerKey = "";
    let nextGeneration = 0;
    let current: MutableRankedQueueSession | null = null;
    let wireTail: Promise<void> = Promise.resolve();
    const pollingGenerations = new Set<number>();

    const isCurrent = (session: RankedQueueClientSession): boolean => Boolean(
        current
        && current.ownerKey === session.ownerKey
        && current.generation === session.generation
        && current.phase === session.phase
        && boundOwnerKey === session.ownerKey,
    );

    const currentSession = (): RankedQueueClientSession | null => current ? snapshot(current) : null;

    const retire = (session?: RankedQueueClientSession): RankedQueueClientSession | null => {
        if (!current || (session && !isCurrent(session))) return null;
        const retired = snapshot(current);
        current = null;
        return retired;
    };

    const bindOwner = (ownerKey: string): RankedQueueClientSession | null => {
        const normalized = normalizedOwnerKey(ownerKey);
        if (boundOwnerKey === normalized) return null;
        const retired = current ? snapshot(current) : null;
        current = null;
        boundOwnerKey = normalized;
        return retired;
    };

    const beginJoin = (ownerKey: string): RankedQueueClientSession => {
        bindOwner(ownerKey);
        current = {
            ownerKey: boundOwnerKey,
            generation: ++nextGeneration,
            phase: "joining",
        };
        return snapshot(current);
    };

    const confirmJoined = (session: RankedQueueClientSession): RankedQueueClientSession | null => {
        if (!isCurrent(session) || current?.phase !== "joining") return null;
        current.phase = "queued";
        return snapshot(current);
    };

    const adoptQueued = (ownerKey: string): RankedQueueClientSession => {
        const joining = beginJoin(ownerKey);
        return confirmJoined(joining)!;
    };

    const consumeMatch = (session: RankedQueueClientSession): RankedQueueClientSession | null => {
        if (!isCurrent(session) || current?.phase !== "queued") return null;
        current.phase = "launching";
        return snapshot(current);
    };

    const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
        const scheduled = wireTail.then(task, task);
        wireTail = scheduled.then(() => undefined, () => undefined);
        return scheduled;
    };

    const run = <T>(
        session: RankedQueueClientSession,
        action: "join" | "poll",
        task: () => Promise<T>,
    ): Promise<RankedQueueWireResult<T>> => {
        const expectedPhase: RankedQueuePhase = action === "join" ? "joining" : "queued";
        if (!isCurrent(session) || current?.phase !== expectedPhase) {
            return Promise.resolve({ status: "retired" });
        }
        if (action === "poll") {
            if (pollingGenerations.has(session.generation)) return Promise.resolve({ status: "busy" });
            pollingGenerations.add(session.generation);
        }
        return enqueue(async () => {
            try {
                if (!isCurrent(session) || current?.phase !== expectedPhase) return { status: "retired" } as const;
                const value = await task();
                if (!isCurrent(session) || current?.phase !== expectedPhase) return { status: "retired" } as const;
                return { status: "completed", value } as const;
            } finally {
                if (action === "poll") pollingGenerations.delete(session.generation);
            }
        });
    };

    /** Queue cleanup behind every already-issued Join/Poll. The caller performs
     * the final live-auth/capability check immediately before its Leave POST. */
    const runCleanup = <T>(task: () => Promise<T>): Promise<T> => enqueue(task);

    const disposeOwner = (ownerKey: string): RankedQueueClientSession | null => {
        if (boundOwnerKey !== normalizedOwnerKey(ownerKey)) return null;
        const retired = retire();
        boundOwnerKey = "";
        return retired;
    };

    return Object.freeze({
        adoptQueued,
        beginJoin,
        bindOwner,
        confirmJoined,
        consumeMatch,
        currentSession,
        disposeOwner,
        isCurrent,
        retire,
        run,
        runCleanup,
    });
}
