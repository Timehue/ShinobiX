/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import { getSocketAuth } from "../../../authFetch";
import type { Character, PlayerRecord } from "../../../types/character";
import { accountKey } from "../../../lib/player-accounts";
import {
    playerRankedAuthorityFromQueueMatch,
    type PlayerRankedAuthority,
} from "../../../lib/player-ranked-authority";
import {
    createRankedQueueLifecycle,
    rankedChallengeSettlementDecision,
    type RankedChallengeSettlementTracking,
    type RankedQueueClientSession,
} from "../../../lib/ranked-queue-lifecycle";
import { capabilityAdmissionAllowed } from "../../../lib/live-capability-admission";
import {
    useCapabilityMutationAvailability,
    useLiveCapabilities,
} from "../../../lib/live-capabilities-context";
import { requireServerSettlement } from "../../../lib/server-settlement-gate";

/**
 * Ranked queue lifecycle for the Arena District lobby.
 *
 * Extracted verbatim from Arena.tsx, which had absorbed the whole join/poll/
 * match/settle lifecycle inline and grown past its lobby line budget. The
 * serialization guarantees live in lib/ranked-queue-lifecycle.ts; this hook owns
 * only the React wiring — owner binding, capability retirement, challenge
 * settlement tracking, the status read, the poll loop, and the two lobby actions.
 *
 * Effect dependency arrays are deliberately identical to the pre-extraction
 * versions. `challengePlayer` is passed per render and captured by the poll
 * effect exactly as it was when it lived in the component, so match launch
 * timing and closure semantics are unchanged.
 */

type RankedQueuePayload = {
    enabled?: unknown;
    inQueue?: unknown;
    queueSize?: unknown;
    match?: unknown;
    error?: unknown;
};

type TrackedRankedChallenge = RankedChallengeSettlementTracking & Readonly<{
    session: RankedQueueClientSession;
}>;

export type RankedChallengeOutcome = "sent" | "rejected" | "unknown" | "retired";

export type RankedChallengeResult = Readonly<{
    outcome: RankedChallengeOutcome;
    challengeId?: string;
}>;

/** Arena's canonical challenge sender, narrowed to the ranked launch call. */
export type RankedChallengeLauncher = (
    opponent: PlayerRecord,
    mode: "ranked",
    clanWarPoints: number,
    party: boolean,
    rankedAuthority: PlayerRankedAuthority,
    rankedSession: RankedQueueClientSession,
) => Promise<RankedChallengeResult>;

/**
 * Structural shape the settlement decision reads. Declared here rather than
 * importing DuelChallenge from App, which would make the hook depend on the
 * monolith it is helping drain.
 */
export type RankedSettlementChallenge = Readonly<{
    id: string;
    accepted?: boolean;
    declined?: boolean;
}>;

export type UseRankedQueueOptions = Readonly<{
    character: Character;
    duelChallenges: ReadonlyArray<RankedSettlementChallenge>;
    challengePlayer: RankedChallengeLauncher;
}>;

export type RankedQueueState = Readonly<{
    playerRankedEnabled: boolean;
    rankedQueueActive: boolean;
    rankedQueueSize: number;
    rankedMutationsAvailable: boolean;
    joinRankedQueue: () => Promise<void>;
    leaveRankedQueue: () => void;
    /**
     * True when `session` is still the live admission AND progress-changing
     * mutations are allowed right now. Arena's challenge sender gates the ranked
     * launch on this so a stale generation cannot spend a consumed match.
     */
    isRankedSessionCurrent: (session: RankedQueueClientSession) => boolean;
}>;

export const RANKED_QUEUE_REQUEST_TIMEOUT_MS = 12_000;
const RANKED_CHALLENGE_SETTLEMENT_TIMEOUT_MS = 180_000;

function rankedQueuePayload(value: unknown): RankedQueuePayload | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as RankedQueuePayload
        : null;
}

function parseRankedQueueSize(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : null;
}

export function useRankedQueue({
    character,
    duelChallenges,
    challengePlayer,
}: UseRankedQueueOptions): RankedQueueState {
    const rankedMutationAvailability = useCapabilityMutationAvailability();
    const { mutationAvailability } = useLiveCapabilities();
    const rankedMutationsAvailable = capabilityAdmissionAllowed(rankedMutationAvailability);
    const rankedQueueOwnerKey = accountKey(character.name);
    const [rankedQueueLifecycle] = useState(() => createRankedQueueLifecycle());
    const [playerRankedEnabled, setPlayerRankedEnabled] = useState(false);
    const [rankedQueueActive, setRankedQueueActive] = useState(false);
    const [rankedQueueSession, setRankedQueueSession] = useState<RankedQueueClientSession | null>(null);
    const [trackedRankedChallenge, setTrackedRankedChallenge] = useState<TrackedRankedChallenge | null>(null);
    const [rankedQueueSize, setRankedQueueSize] = useState(0);

    function rankedMutationAllowedNow(): boolean {
        return capabilityAdmissionAllowed(mutationAvailability());
    }

    function clearRankedQueueUi() {
        setRankedQueueSession(null);
        setTrackedRankedChallenge(null);
        setRankedQueueActive(false);
        setRankedQueueSize(0);
    }

    function retireRankedQueueUi(session?: RankedQueueClientSession): RankedQueueClientSession | null {
        const retired = rankedQueueLifecycle.retire(session);
        if (retired || !session) clearRankedQueueUi();
        return retired;
    }

    function leaveRankedQueueOnServer(
        owner: Pick<RankedQueueClientSession, "ownerKey"> & Partial<Pick<RankedQueueClientSession, "phase">>,
        releaseConsumedMatch = false,
    ): Promise<void> {
        return rankedQueueLifecycle.runCleanup(async () => {
            // A consumed match is no longer queue work. Leave would delete its
            // durable match mirror/admission while a challenge is in flight.
            if (owner.phase === "launching" && !releaseConsumedMatch) return;
            const authName = getSocketAuth().name;
            if (!authName || accountKey(authName) !== owner.ownerKey || !rankedMutationAllowedNow()) return;
            try {
                await fetch("/api/pvp/ranked-queue", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: authName, action: "leave" }),
                    signal: AbortSignal.timeout(RANKED_QUEUE_REQUEST_TIMEOUT_MS),
                });
            } catch {
                // The server expires abandoned entries; cleanup is best-effort.
            }
        });
    }

    useEffect(() => {
        const retired = rankedQueueLifecycle.bindOwner(rankedQueueOwnerKey);
        clearRankedQueueUi();
        if (retired) void leaveRankedQueueOnServer(retired);
        return () => {
            const disposed = rankedQueueLifecycle.disposeOwner(rankedQueueOwnerKey);
            if (disposed) void leaveRankedQueueOnServer(disposed);
        };
    }, [rankedQueueLifecycle, rankedQueueOwnerKey]);

    useEffect(() => {
        if (rankedMutationsAvailable) return;
        retireRankedQueueUi();
        setPlayerRankedEnabled(false);
    }, [rankedMutationsAvailable, rankedQueueLifecycle]);

    useEffect(() => {
        const tracked = trackedRankedChallenge;
        if (!tracked) return;
        const sameTracking = (candidate: TrackedRankedChallenge | null) => Boolean(
            candidate
            && candidate.challengeId === tracked.challengeId
            && candidate.session.ownerKey === tracked.session.ownerKey
            && candidate.session.generation === tracked.session.generation,
        );
        const clearTracking = () => {
            setTrackedRankedChallenge((current) => sameTracking(current) ? null : current);
        };
        const retireTracked = (releaseExpiredProof: boolean) => {
            const retired = rankedQueueLifecycle.retire(tracked.session);
            clearTracking();
            if (!retired) return;
            setRankedQueueSession((current) => current?.ownerKey === tracked.session.ownerKey
                && current.generation === tracked.session.generation ? null : current);
            setRankedQueueActive(false);
            setRankedQueueSize(0);
            if (releaseExpiredProof) void leaveRankedQueueOnServer(retired, true);
        };

        if (!rankedQueueLifecycle.isCurrent(tracked.session)) {
            clearTracking();
            return;
        }
        const decision = rankedChallengeSettlementDecision(tracked, duelChallenges, Date.now());
        if (decision === "observed") {
            setTrackedRankedChallenge((current) => sameTracking(current)
                ? { ...current!, observed: true }
                : current);
            return;
        }
        if (decision === "resolved" || decision === "disappeared") {
            // Decline already releases the server admission; disappearance is
            // App consuming that resolution or pruning its authoritative TTL.
            retireTracked(false);
            return;
        }
        if (decision === "expired") {
            retireTracked(true);
            return;
        }

        const timeout = window.setTimeout(
            () => retireTracked(true),
            Math.max(0, tracked.expiresAt - Date.now()),
        );
        return () => window.clearTimeout(timeout);
    }, [duelChallenges, rankedQueueLifecycle, trackedRankedChallenge]);

    // Backstop for a "launching" session with NO tracked challenge to settle:
    // the responder never sends one (the initiator's challenge arrives — or
    // doesn't), and an initiator whose send came back transport-unknown
    // without a challengeId can't be tracked either. The tracked path above
    // gets the 180s settlement expiry; without this twin, those sessions sat
    // in "launching" forever and Queue Up refused ("already launching") until
    // the Arena screen unmounted. Same expiry, same release semantics. While
    // the initiator's send is in flight the timer arms briefly and is cleared
    // the moment tracking lands — the overlap is harmless because retire()
    // no-ops on anything but the exact live generation.
    useEffect(() => {
        const session = rankedQueueSession;
        if (!session || session.phase !== "launching" || trackedRankedChallenge) return;
        const timeout = window.setTimeout(() => {
            const retired = rankedQueueLifecycle.retire(session);
            if (!retired) return;
            setRankedQueueSession((current) => current?.ownerKey === session.ownerKey
                && current.generation === session.generation ? null : current);
            setRankedQueueActive(false);
            setRankedQueueSize(0);
            void leaveRankedQueueOnServer(retired, true);
        }, RANKED_CHALLENGE_SETTLEMENT_TIMEOUT_MS);
        return () => window.clearTimeout(timeout);
    }, [rankedQueueLifecycle, rankedQueueSession, trackedRankedChallenge]);

    useEffect(() => {
        if (!rankedMutationsAvailable) return;
        let active = true;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), RANKED_QUEUE_REQUEST_TIMEOUT_MS);
        const observedGeneration = rankedQueueLifecycle.currentSession()?.generation ?? null;
        const statusStillCurrent = () => active
            && (rankedQueueLifecycle.currentSession()?.generation ?? null) === observedGeneration;

        void (async () => {
            try {
                const response = await fetch(
                    `/api/pvp/ranked-queue?name=${encodeURIComponent(character.name)}`,
                    { cache: "no-store", signal: controller.signal },
                );
                const data = rankedQueuePayload(await response.json().catch(() => null));
                if (!statusStillCurrent()) return;
                const size = parseRankedQueueSize(data?.queueSize);
                if (!response.ok || !data || typeof data.enabled !== "boolean"
                    || typeof data.inQueue !== "boolean" || size === null) {
                    retireRankedQueueUi();
                    setPlayerRankedEnabled(false);
                    return;
                }

                setPlayerRankedEnabled(data.enabled);
                setRankedQueueSize(data.enabled ? size : 0);
                if (!data.enabled || !data.inQueue) {
                    retireRankedQueueUi();
                    return;
                }

                const queued = rankedQueueLifecycle.adoptQueued(rankedQueueOwnerKey);
                setRankedQueueSession(queued);
                setRankedQueueActive(true);
            } catch {
                if (!statusStillCurrent()) return;
                retireRankedQueueUi();
                setPlayerRankedEnabled(false);
            } finally {
                window.clearTimeout(timeout);
            }
        })();

        return () => {
            active = false;
            controller.abort();
            window.clearTimeout(timeout);
        };
    }, [character.name, rankedMutationsAvailable, rankedQueueLifecycle, rankedQueueOwnerKey]);

    useEffect(() => {
        const session = rankedQueueSession;
        if (!rankedQueueActive || session?.phase !== "queued" || !rankedMutationsAvailable) return;
        let stopped = false;
        let timeout: number | undefined;

        const scheduleNextPoll = () => {
            if (!stopped && rankedQueueLifecycle.isCurrent(session)) {
                timeout = window.setTimeout(() => { void poll(); }, 3000);
            }
        };
        const retireAfterPollFailure = (message: string, disable = false) => {
            const retired = retireRankedQueueUi(session);
            if (!retired) return;
            if (disable) setPlayerRankedEnabled(false);
            alert(message);
            void leaveRankedQueueOnServer(retired);
        };
        const poll = async () => {
            if (stopped || !rankedQueueLifecycle.isCurrent(session)) return;
            if (document.visibilityState === "hidden") {
                scheduleNextPoll();
                return;
            }
            if (!rankedMutationAllowedNow()) {
                retireRankedQueueUi(session);
                setPlayerRankedEnabled(false);
                return;
            }

            try {
                const result = await rankedQueueLifecycle.run(session, "poll", async () => {
                    if (!rankedMutationAllowedNow()) throw new Error("ranked-mutations-unavailable");
                    const response = await fetch("/api/pvp/ranked-queue", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            name: character.name,
                            level: character.level,
                            elo: character.rankedRating ?? 1000,
                            action: "poll",
                        }),
                        signal: AbortSignal.timeout(RANKED_QUEUE_REQUEST_TIMEOUT_MS),
                    });
                    const data = rankedQueuePayload(await response.json().catch(() => null));
                    return { response, data };
                });
                if (result.status === "busy") {
                    scheduleNextPoll();
                    return;
                }
                if (result.status === "retired") return;
                if (!rankedMutationAllowedNow()) {
                    retireRankedQueueUi(session);
                    setPlayerRankedEnabled(false);
                    return;
                }

                const { response, data } = result.value;
                const size = parseRankedQueueSize(data?.queueSize);
                if (!response.ok || !data || typeof data.enabled !== "boolean"
                    || typeof data.inQueue !== "boolean" || size === null) {
                    const message = typeof data?.error === "string"
                        ? data.error
                        : "The ranked queue returned an incomplete response. Rejoin to continue searching.";
                    retireAfterPollFailure(message, data?.enabled === false);
                    return;
                }
                if (!data.enabled) {
                    retireAfterPollFailure(
                        typeof data.error === "string"
                            ? data.error
                            : "Ranked matchmaking is temporarily unavailable. Rejoin when the rollout resumes.",
                        true,
                    );
                    return;
                }

                setRankedQueueSize(size);
                if (data.match !== null && data.match !== undefined) {
                    const rankedAuthority = playerRankedAuthorityFromQueueMatch(data.match);
                    const match = data.match && typeof data.match === "object" && !Array.isArray(data.match)
                        ? data.match as Record<string, unknown>
                        : null;
                    const opponentName = typeof match?.opponent === "string" ? match.opponent.trim() : "";
                    if (!rankedAuthority || !match || !opponentName || typeof match.initiator !== "boolean") {
                        retireAfterPollFailure(
                            "The ranked server returned an incomplete match proof. Rejoin the queue before starting a battle.",
                        );
                        return;
                    }

                    const launchingSession = rankedQueueLifecycle.consumeMatch(session);
                    if (!launchingSession) return;
                    setRankedQueueSession(launchingSession);
                    setRankedQueueActive(false);
                    let challengeResult: RankedChallengeResult = { outcome: "sent" };
                    if (match.initiator === true) {
                        const stub = {
                            name: opponentName,
                            level: typeof match.opponentLevel === "number" ? match.opponentLevel : 1,
                            village: "",
                            specialty: "Ninjutsu",
                            character: {
                                ...character,
                                name: opponentName,
                                rankedRating: typeof match.opponentElo === "number" ? match.opponentElo : 1000,
                            } as Character,
                            currentSector: 0,
                            lastSeenAt: Date.now(),
                        } as PlayerRecord;
                        challengeResult = await challengePlayer(stub, "ranked", 0, false, rankedAuthority, launchingSession);
                        if ((challengeResult.outcome === "sent" || challengeResult.outcome === "unknown")
                            && challengeResult.challengeId) {
                            setTrackedRankedChallenge({
                                session: launchingSession,
                                challengeId: challengeResult.challengeId,
                                observed: false,
                                expiresAt: Date.now() + RANKED_CHALLENGE_SETTLEMENT_TIMEOUT_MS,
                            });
                        }
                    }
                    // Success/transport-unknown and responder outcomes remain
                    // launching until the durable challenge settles or this
                    // owner/capability is invalidated. That prevents Queue Up
                    // from consuming the same server admission a second time.
                    if (challengeResult.outcome !== "rejected") return;
                    const retired = rankedQueueLifecycle.retire(launchingSession);
                    if (retired) {
                        // A definitive 4xx proves no durable challenge was created, so
                        // this admission can be released. Success and transport-
                        // unknown outcomes must preserve the proof for acceptance.
                        void leaveRankedQueueOnServer(retired, true);
                    }
                    setRankedQueueSession((current) => current?.ownerKey === launchingSession.ownerKey
                        && current.generation === launchingSession.generation ? null : current);
                    return;
                }

                if (!data.inQueue) {
                    retireAfterPollFailure("You are no longer in the ranked queue. Queue up again to keep searching.");
                    return;
                }
                scheduleNextPoll();
            } catch {
                if (!rankedMutationAllowedNow()) {
                    const retired = retireRankedQueueUi(session);
                    if (retired) {
                        setPlayerRankedEnabled(false);
                        alert("Ranked matchmaking is unavailable while progress-changing actions are paused.");
                    }
                    return;
                }
                retireAfterPollFailure("Couldn't reach the ranked queue. Rejoin to continue searching.");
            }
        };

        void poll();
        return () => {
            stopped = true;
            if (timeout !== undefined) window.clearTimeout(timeout);
        };
    }, [rankedMutationsAvailable, rankedQueueActive, rankedQueueLifecycle, rankedQueueSession]);

    async function joinRankedQueue() {
        if (rankedQueueLifecycle.currentSession()?.phase === "launching") {
            alert("Your ranked match is already launching. Wait for its challenge to settle.");
            return;
        }
        if (!requireServerSettlement("rankedPvp")) return;
        if (!playerRankedEnabled) {
            alert("Ranked PvP is temporarily unavailable while the v2 authority rollout completes.");
            return;
        }
        if (!rankedMutationsAvailable || !rankedMutationAllowedNow()) {
            alert("Ranked matchmaking is unavailable while progress-changing actions are paused.");
            return;
        }

        const joiningSession = rankedQueueLifecycle.beginJoin(rankedQueueOwnerKey);
        setRankedQueueSession(joiningSession);
        setRankedQueueActive(true);
        try {
            const result = await rankedQueueLifecycle.run(joiningSession, "join", async () => {
                if (!rankedMutationAllowedNow()) throw new Error("ranked-mutations-unavailable");
                const response = await fetch("/api/pvp/ranked-queue", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: character.name,
                        level: character.level,
                        elo: character.rankedRating ?? 1000,
                        action: "join",
                    }),
                    signal: AbortSignal.timeout(RANKED_QUEUE_REQUEST_TIMEOUT_MS),
                });
                const data = rankedQueuePayload(await response.json().catch(() => null));
                return { response, data };
            });
            if (result.status !== "completed") return;

            const { response, data } = result.value;
            const size = parseRankedQueueSize(data?.queueSize);
            if (!response.ok || !data || data.enabled !== true || data.inQueue !== true || size === null) {
                const retired = retireRankedQueueUi(joiningSession);
                if (data?.enabled === false) setPlayerRankedEnabled(false);
                alert(typeof data?.error === "string"
                    ? data.error
                    : "The ranked queue did not confirm your entry. Please try again.");
                if (retired) void leaveRankedQueueOnServer(retired);
                return;
            }
            if (!rankedMutationAllowedNow()) {
                retireRankedQueueUi(joiningSession);
                setPlayerRankedEnabled(false);
                return;
            }

            const queuedSession = rankedQueueLifecycle.confirmJoined(joiningSession);
            if (!queuedSession) return;
            setRankedQueueSession(queuedSession);
            setRankedQueueSize(size);
        } catch {
            if (!rankedQueueLifecycle.isCurrent(joiningSession)) return;
            const retired = retireRankedQueueUi(joiningSession);
            const mutationsAvailable = rankedMutationAllowedNow();
            if (!mutationsAvailable) setPlayerRankedEnabled(false);
            alert(mutationsAvailable
                ? "Couldn't reach the ranked queue. Please try again."
                : "Ranked matchmaking is unavailable while progress-changing actions are paused.");
            if (retired) void leaveRankedQueueOnServer(retired);
        }
    }

    function leaveRankedQueue() {
        const retired = rankedQueueLifecycle.retire();
        clearRankedQueueUi();
        void leaveRankedQueueOnServer(retired ?? { ownerKey: rankedQueueOwnerKey });
    }

    return {
        playerRankedEnabled,
        rankedQueueActive,
        rankedQueueSize,
        rankedMutationsAvailable,
        joinRankedQueue,
        leaveRankedQueue,
        isRankedSessionCurrent: (session: RankedQueueClientSession) =>
            rankedQueueLifecycle.isCurrent(session) && rankedMutationAllowedNow(),
    };
}
