/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import { getSocketAuth } from "../../../authFetch";
import type { Character } from "../../../types/character";
import { accountKey } from "../../../lib/player-accounts";
import {
    playerRankedAuthorityFromQueueMatch,
    type PlayerRankedAuthority,
} from "../../../lib/player-ranked-authority";
import {
    createRankedQueueLifecycle,
    type RankedQueueClientSession,
} from "../../../lib/ranked-queue-lifecycle";
import { capabilityAdmissionAllowed } from "../../../lib/live-capability-admission";
import {
    useCapabilityMutationAvailability,
    useLiveCapabilities,
} from "../../../lib/live-capabilities-context";
import { requireServerSettlement } from "../../../lib/server-settlement-gate";
import { rankedLevelEligible, RANKED_LEVEL_WARNING } from "../../../../../shared/ranked-eligibility";

/**
 * Ranked queue lifecycle for the Arena District lobby.
 *
 * Extracted verbatim from Arena.tsx, which had absorbed the whole join/poll/
 * match/settle lifecycle inline and grown past its lobby line budget. The
 * serialization guarantees live in lib/ranked-queue-lifecycle.ts; this hook owns
 * only the React wiring — owner binding, capability retirement, direct session
 * launch, the status read, the poll loop, and the two lobby actions.
 *
 * Effect dependency arrays are deliberately identical to the pre-extraction
 * versions. `launchRankedMatch` is passed per render and captured by the poll
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

export type RankedQueueMatch = Readonly<{
    opponent: string;
    initiator: boolean;
    battleId?: string;
}>;

/** Arena's direct, server-authoritative ranked session launcher. */
export type RankedMatchLauncher = (
    match: RankedQueueMatch,
    rankedAuthority: PlayerRankedAuthority,
    rankedSession: RankedQueueClientSession,
) => Promise<"started" | "rejected">;

export type UseRankedQueueOptions = Readonly<{
    character: Character;
    launchRankedMatch: RankedMatchLauncher;
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
     * mutations are allowed right now.
     */
    isRankedSessionCurrent: (session: RankedQueueClientSession) => boolean;
}>;

export const RANKED_QUEUE_REQUEST_TIMEOUT_MS = 12_000;
const RANKED_SESSION_LAUNCH_TIMEOUT_MS = 180_000;

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
    launchRankedMatch,
}: UseRankedQueueOptions): RankedQueueState {
    const rankedMutationAvailability = useCapabilityMutationAvailability();
    const { mutationAvailability } = useLiveCapabilities();
    const rankedMutationsAvailable = capabilityAdmissionAllowed(rankedMutationAvailability);
    const rankedQueueOwnerKey = accountKey(character.name);
    const [rankedQueueLifecycle] = useState(() => createRankedQueueLifecycle());
    const [playerRankedEnabled, setPlayerRankedEnabled] = useState(false);
    const [rankedQueueActive, setRankedQueueActive] = useState(false);
    const [rankedQueueSession, setRankedQueueSession] = useState<RankedQueueClientSession | null>(null);
    const [rankedQueueSize, setRankedQueueSize] = useState(0);

    function rankedMutationAllowedNow(): boolean {
        return capabilityAdmissionAllowed(mutationAvailability());
    }

    function clearRankedQueueUi() {
        setRankedQueueSession(null);
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
            // durable match mirror/admission while direct session creation is in flight.
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

    // Backstop for a direct ranked session publish that did not resolve. It
    // releases the consumed proof only after a conservative timeout, so the
    // initiator can safely recover an ambiguous publish without a duplicate.
    useEffect(() => {
        const session = rankedQueueSession;
        if (!session || session.phase !== "launching") return;
        const timeout = window.setTimeout(() => {
            const retired = rankedQueueLifecycle.retire(session);
            if (!retired) return;
            setRankedQueueSession((current) => current?.ownerKey === session.ownerKey
                && current.generation === session.generation ? null : current);
            setRankedQueueActive(false);
            setRankedQueueSize(0);
            void leaveRankedQueueOnServer(retired, true);
        }, RANKED_SESSION_LAUNCH_TIMEOUT_MS);
        return () => window.clearTimeout(timeout);
    }, [rankedQueueLifecycle, rankedQueueSession]);

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
                    const battleId = typeof match?.battleId === "string" && match.battleId.trim()
                        ? match.battleId.trim()
                        : undefined;
                    if (!rankedAuthority || !match || !opponentName || typeof match.initiator !== "boolean") {
                        retireAfterPollFailure(
                            "The ranked server returned an incomplete match proof. Rejoin the queue before starting a battle.",
                        );
                        return;
                    }

                    // Only the deterministic initiator can create the session.
                    // The responder stays in this queue lifecycle until the
                    // server reflects the authoritative battle id back to it.
                    if (!battleId && match.initiator !== true) {
                        scheduleNextPoll();
                        return;
                    }

                    const launchingSession = rankedQueueLifecycle.consumeMatch(session);
                    if (!launchingSession) return;
                    setRankedQueueSession(launchingSession);
                    setRankedQueueActive(false);
                    const outcome = await launchRankedMatch(
                        { opponent: opponentName, initiator: match.initiator, battleId },
                        rankedAuthority,
                        launchingSession,
                    );
                    if (outcome === "started") return;
                    const retired = rankedQueueLifecycle.retire(launchingSession);
                    if (retired) {
                        // A definitive failure proves no session was created, so
                        // the match admission can return to the queue service.
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
            alert("Your ranked match is already launching. The combat session will open automatically.");
            return;
        }
        if (!rankedLevelEligible(character.level)) {
            alert(RANKED_LEVEL_WARNING);
            return;
        }
        if (!requireServerSettlement("rankedPvp")) return;
        if (!playerRankedEnabled) {
            alert("Ranked PvP is not accepting new entries. An administrator can start or resume the current season.");
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
