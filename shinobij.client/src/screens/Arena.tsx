/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect, react-hooks/immutability, react-hooks/purity */
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { getSocketAuth } from "../authFetch";
import type { Screen } from "../types/core";
import type { Character, PlayerRecord } from "../types/character";
import type { Jutsu, SavedBloodline } from "../types/combat";
import type { EnhancedClanData } from "../types/clan";
import type { Pet } from "../types/pet";
import type { PetArenaOpponent } from "../data/pet-arena-opponents";
import { BattleArenaLobby } from "../features/arena/components/BattleArenaLobby";
import { ArenaDistrictLobby } from "../features/arena/components/ArenaDistrictLobby";
import type { ArenaDistrictTab, BattleArenaLobbyTab } from "../features/arena/types";
import { getBloodlineMultiplier } from "../lib/combat-math";
import { enhanceClanData } from "../lib/clan-math";
import { fetchClanData } from "../lib/clan-api";
import { activeCarriedPets } from "../lib/entitlements";
import { availablePetBattleCount, isPetOnExpedition } from "../lib/pet";
import { publicEligiblePets } from "../lib/public-pet-roster";
import { accountKey } from "../lib/player-accounts";
import {
    playerRankedAuthorityFromQueueMatch,
    type PlayerRankedAuthority,
} from "../lib/player-ranked-authority";
import {
    createRankedQueueLifecycle,
    rankedChallengeSettlementDecision,
    type RankedChallengeSettlementTracking,
    type RankedQueueClientSession,
} from "../lib/ranked-queue-lifecycle";
import { publishedPracticeOpponentForLevel } from "../lib/creator-event-practice";
import { requestAiFight } from "../lib/ai-fight-request";
import { capabilityAdmissionAllowed } from "../lib/live-capability-admission";
import {
    useCapabilityMutationAvailability,
    useLiveCapabilities,
} from "../lib/live-capabilities-context";
import { requireServerSettlement } from "../lib/server-settlement-gate";
import { makeId } from "../lib/utils";
import {
    loadArenaActiveFights,
    loadArenaTournament,
    saveArenaTournament,
    savePendingClanPetBattle,
    type ArenaSpectatorFight,
    type ArenaTournament,
} from "../lib/world-state";
import {
    getPvpJutsuLoadout,
    isAdminAccountName,
    type DuelChallenge,
} from "../App";

type ArenaProps = {
    lobbyMode?: "battleArena" | "arenaDistrict";
    character: Character;
    updateCharacter: (character: Character) => void;
    savedBloodlines: SavedBloodline[];
    creatorJutsus: Jutsu[];
    playerRoster: PlayerRecord[];
    duelChallenges: DuelChallenge[];
    setDuelChallenges: Dispatch<SetStateAction<DuelChallenge[]>>;
    setScreen: (screen: Screen) => void;
    setPvpBattleId?: (id: string) => void;
    setPvpRole?: (role: "p1" | "p2") => void;
    setPendingPetBattleOpponent?: (opponent: PetArenaOpponent | null) => void;
    onAcceptChallenge: (challenge: DuelChallenge) => void;
    onDeclineChallenge: (challenge: DuelChallenge) => void;
    onAcceptPetChallenge?: (challenge: DuelChallenge) => void;
};

type RankedQueuePayload = {
    enabled?: unknown;
    inQueue?: unknown;
    queueSize?: unknown;
    match?: unknown;
    error?: unknown;
};

type PlayerChallengeOutcome = "sent" | "rejected" | "unknown" | "retired";

type PlayerChallengeResult = Readonly<{
    outcome: PlayerChallengeOutcome;
    challengeId?: string;
}>;

type TrackedRankedChallenge = RankedChallengeSettlementTracking & Readonly<{
    session: RankedQueueClientSession;
}>;

const RANKED_QUEUE_REQUEST_TIMEOUT_MS = 12_000;
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

/**
 * Battle Arena and Arena District are lobby surfaces only.
 *
 * Solo combat is admitted by requestAiFight and rendered by AiFightHost's
 * server-owned MissionArenaFight. Player combat is admitted by App's canonical
 * challenge handler and rendered by PvpBattleScreen. This component must never
 * grow a local HP/AP/turn reducer or restore a retired browser battle snapshot.
 */
export function Arena({
    lobbyMode = "battleArena",
    character,
    updateCharacter,
    savedBloodlines,
    creatorJutsus,
    playerRoster,
    duelChallenges,
    setDuelChallenges,
    setScreen,
    setPvpBattleId,
    setPvpRole,
    setPendingPetBattleOpponent,
    onAcceptChallenge,
    onDeclineChallenge,
    onAcceptPetChallenge,
}: ArenaProps) {
    const rankedMutationAvailability = useCapabilityMutationAvailability();
    const { mutationAvailability } = useLiveCapabilities();
    const rankedMutationsAvailable = capabilityAdmissionAllowed(rankedMutationAvailability);
    const rankedQueueOwnerKey = accountKey(character.name);
    const [rankedQueueLifecycle] = useState(() => createRankedQueueLifecycle());
    const [aiLevel, setAiLevel] = useState(character.level);
    const [sparSearch, setSparSearch] = useState("");
    const [activeArenaTab, setActiveArenaTab] = useState<ArenaDistrictTab>("ranked");
    const [battleArenaTab, setBattleArenaTab] = useState<BattleArenaLobbyTab>("spar");
    const [playerRankedEnabled, setPlayerRankedEnabled] = useState(false);
    const [rankedQueueActive, setRankedQueueActive] = useState(false);
    const [rankedQueueSession, setRankedQueueSession] = useState<RankedQueueClientSession | null>(null);
    const [trackedRankedChallenge, setTrackedRankedChallenge] = useState<TrackedRankedChallenge | null>(null);
    const [rankedQueueSize, setRankedQueueSize] = useState(0);
    const [arenaTournament, setArenaTournament] = useState<ArenaTournament | null>(() => loadArenaTournament());
    const [spectatorFights, setSpectatorFights] = useState<ArenaSpectatorFight[]>(() => loadArenaActiveFights());
    const [opponentClanData, setOpponentClanData] = useState<EnhancedClanData | null>(null);

    const combatEligiblePets = activeCarriedPets<Pet>(character);
    const incomingChallenges = duelChallenges.filter((challenge) =>
        !challenge.accepted &&
        !challenge.declined &&
        challenge.toName.toLowerCase() === character.name.toLowerCase()
    );

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

    useEffect(() => {
        const refreshArenaState = () => {
            setArenaTournament(loadArenaTournament());
            setSpectatorFights(loadArenaActiveFights());
        };
        refreshArenaState();
        const id = window.setInterval(refreshArenaState, 5000);
        return () => window.clearInterval(id);
    }, []);

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
                    let challengeResult: PlayerChallengeResult = { outcome: "sent" };
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

    useEffect(() => {
        let active = true;
        if (!character.clan) {
            setOpponentClanData(null);
            return () => { active = false; };
        }
        fetchClanData(character.clan)
            .then(async (data) => {
                const activeWar = data ? enhanceClanData(data).activeWar : undefined;
                if (!activeWar?.opponentClan) return null;
                return fetchClanData(activeWar.opponentClan);
            })
            .then((data) => {
                if (active) setOpponentClanData(data ? enhanceClanData(data) : null);
            })
            .catch(() => {
                if (active) setOpponentClanData(null);
            });
        return () => { active = false; };
    }, [character.clan]);

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

    function beginAiBattle() {
        if (!requestAiFight({
            opponentId: publishedPracticeOpponentForLevel(aiLevel),
            opponentLevel: aiLevel,
            battleKind: "practice",
            returnScreen: "arena",
        })) {
            alert("The sealed practice arena is unavailable. No fight was started.");
        }
    }

    async function challengePlayer(
        opponent: PlayerRecord,
        mode: DuelChallenge["mode"] = "standard",
        clanWarPoints = 0,
        party = false,
        rankedAuthority?: PlayerRankedAuthority,
        rankedSession?: RankedQueueClientSession,
    ): Promise<PlayerChallengeResult> {
        if (mode === "ranked" && !rankedAuthority) {
            alert("A current server-ranked match proof is required. Rejoin the ranked queue.");
            return { outcome: "rejected" };
        }
        const rankedChallengeCurrent = () => mode !== "ranked" || Boolean(
            rankedSession
            && rankedQueueLifecycle.isCurrent(rankedSession)
            && rankedMutationAllowedNow(),
        );
        if (!rankedChallengeCurrent()) {
            alert("That ranked queue session is no longer current. Rejoin the queue.");
            return { outcome: "retired" };
        }
        const isPetMode = mode === "clanWarPet" || mode === "rankedPet";
        const availablePetCount = availablePetBattleCount(combatEligiblePets);
        if (isPetMode && availablePetCount < 1) {
            alert("You need a pet that is not on an expedition before sending a pet battle challenge.");
            return { outcome: "rejected" };
        }
        if (party && availablePetCount < 2) {
            alert("A 2v2 pet battle needs two pets not away on an expedition.");
            return { outcome: "rejected" };
        }
        const knownPetTarget = isPetMode
            ? playerRoster.find((player) => player.name.toLowerCase() === opponent.name.toLowerCase())
            : undefined;
        if (knownPetTarget && availablePetBattleCount(publicEligiblePets(knownPetTarget)) < (party ? 2 : 1)) {
            alert(`${opponent.name} does not have a pet available for battle.`);
            return { outcome: "rejected" };
        }

        const challengePet = isPetMode
            ? combatEligiblePets.find((pet) => pet.id === character.activePetId && !isPetOnExpedition(pet))
                ?? combatEligiblePets.find((pet) => !isPetOnExpedition(pet))
            : undefined;
        const petBattleSeed = isPetMode ? Date.now() + Math.floor(Math.random() * 100000) : undefined;
        const partyPetIds: [string, string] | null = party && challengePet
            ? (() => {
                const reserve = combatEligiblePets
                    .filter((pet) => !isPetOnExpedition(pet) && pet.id !== challengePet.id)
                    .sort((left, right) => (right.level ?? 0) - (left.level ?? 0))[0];
                return reserve ? [challengePet.id, reserve.id] : null;
            })()
            : null;
        let petRankedToken: string | undefined;
        if (mode === "rankedPet") {
            try {
                const response = await fetch("/api/pet/ranked-start", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ opponentName: opponent.name, petId: challengePet?.id, seed: petBattleSeed }),
                });
                if (response.ok) {
                    petRankedToken = ((await response.json()) as { matchToken?: string }).matchToken;
                }
            } catch { /* The existing local rating estimate remains the display fallback. */ }
        }

        const challenge: DuelChallenge = {
            id: makeId(),
            fromName: character.name,
            toName: opponent.name,
            challenger: { ...character, pets: combatEligiblePets },
            challengerJutsus: getPvpJutsuLoadout(savedBloodlines, creatorJutsus, character),
            challengerBloodlineMult: getBloodlineMultiplier(character, savedBloodlines),
            challengerPetId: challengePet?.id,
            petBattleSeed,
            challengerPetRating: mode === "rankedPet" ? (character.petRankedRating ?? 1000) : undefined,
            petRankedToken,
            createdAt: Date.now(),
            mode,
            ...(mode === "ranked" ? rankedAuthority : {}),
            clanWarPoints,
            ...(partyPetIds ? { petParty: true, challengerPetIds: partyPetIds } : {}),
        };
        const result = (outcome: PlayerChallengeOutcome): PlayerChallengeResult => ({
            outcome,
            challengeId: challenge.id,
        });
        try {
            if (!rankedChallengeCurrent()) return result("retired");
            const response = await fetch("/api/player/challenge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ targetName: opponent.name, challenge }),
                ...(mode === "ranked" ? { signal: AbortSignal.timeout(RANKED_QUEUE_REQUEST_TIMEOUT_MS) } : {}),
            });
            if (!rankedChallengeCurrent()) return result("retired");
            if (!response.ok) {
                const data = await response.json().catch(() => ({} as { error?: string }));
                if (!rankedChallengeCurrent()) return result("retired");
                // The API may persist the authoritative record before a later
                // enqueue/kick failure produces 5xx. Only an application-level
                // 4xx proves this challenge was rejected before its commit.
                const definitiveRejection = response.status >= 400 && response.status < 500;
                if (mode === "ranked" && !definitiveRejection) {
                    alert("Ranked challenge delivery could not be confirmed. It may still arrive; matchmaking will unlock when it settles or expires.");
                } else {
                    alert(data?.error ?? `${opponent.name} is not reachable live right now. Challenge was not sent.`);
                }
                return result(definitiveRejection ? "rejected" : "unknown");
            }
            setDuelChallenges((current) => [
                ...current.filter((candidate) => !(
                    candidate.fromName === character.name &&
                    !candidate.accepted &&
                    !candidate.declined &&
                    !candidate.battleId
                )),
                challenge,
            ]);
            alert(`${mode === "ranked" ? "Ranked challenge" : mode === "rankedPet" ? "Ranked pet challenge" : mode === "clanWarPet" ? (partyPetIds ? "2v2 pet challenge" : "Pet challenge") : "Challenge"} sent to ${opponent.name}.`);
            return result("sent");
        } catch {
            if (!rankedChallengeCurrent()) return result("retired");
            if (mode === "ranked") {
                alert("Ranked challenge delivery could not be confirmed. It may still arrive; matchmaking will unlock when it settles or expires.");
            } else {
                alert(`${opponent.name} is not reachable live right now. Challenge was not sent.`);
            }
            return result("unknown");
        }
    }

    function startTournament() {
        const participants = [character.name, ...playerRoster.map((player) => player.name)]
            .filter((name, index, names) => names.indexOf(name) === index);
        const tournament: ArenaTournament = {
            id: `tourney-${Date.now()}`,
            name: "Weekly Arena Tournament",
            createdBy: character.name,
            startsAt: Date.now(),
            endsAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
            matchDeadline: Date.now() + 24 * 60 * 60 * 1000,
            participants,
            advancedPlayers: [],
        };
        saveArenaTournament(tournament);
        setArenaTournament(tournament);
    }

    function advanceTournamentPlayer(playerName: string) {
        if (!arenaTournament) return;
        const next = {
            ...arenaTournament,
            advancedPlayers: [...arenaTournament.advancedPlayers, playerName]
                .filter((name, index, names) => names.indexOf(name) === index),
        };
        saveArenaTournament(next);
        setArenaTournament(next);
    }

    function clearTournament() {
        saveArenaTournament(null);
        setArenaTournament(null);
    }

    const availablePetCount = availablePetBattleCount(combatEligiblePets);
    const sparOpponents = sparSearch.trim()
        ? playerRoster.filter((player) =>
            player.name !== character.name &&
            player.name.toLowerCase().includes(sparSearch.trim().toLowerCase())
        )
        : [];

    if (lobbyMode === "battleArena") {
        const incomingSpars = incomingChallenges.filter((challenge) =>
            !challenge.clanWarPoints &&
            challenge.mode !== "ranked" &&
            challenge.mode !== "clanWarPet" &&
            !challenge.sectorAttack
        );
        const incomingPetSpars = incomingChallenges.filter((challenge) =>
            challenge.mode === "clanWarPet" && !challenge.clanWarPoints
        );
        return (
            <BattleArenaLobby
                character={character}
                updateCharacter={updateCharacter}
                playerRoster={playerRoster}
                activeTab={battleArenaTab}
                aiLevel={aiLevel}
                sparSearch={sparSearch}
                sparOpponents={sparOpponents}
                incomingSpars={incomingSpars}
                incomingPetSpars={incomingPetSpars}
                availablePetCount={availablePetCount}
                onBack={() => setScreen("village")}
                onTabChange={setBattleArenaTab}
                onAiLevelChange={setAiLevel}
                onBeginAiBattle={beginAiBattle}
                onSparSearchChange={setSparSearch}
                onSendDirectSpar={(name) => {
                    if (!name || name === character.name) return;
                    const stub = {
                        name,
                        level: 1,
                        village: "",
                        specialty: "Ninjutsu",
                        character: { ...character, name } as Character,
                        currentSector: 0,
                        lastSeenAt: Date.now(),
                    } as PlayerRecord;
                    void challengePlayer(stub);
                }}
                onChallengePlayer={(...args) => { void challengePlayer(...args); }}
                onAcceptChallenge={onAcceptChallenge}
                onDeclineChallenge={onDeclineChallenge}
                onAcceptPetChallenge={onAcceptPetChallenge}
                onOpenPetArena={() => setScreen("petArena")}
                onOpenCardHall={() => setScreen("shinobiTiles")}
            />
        );
    }

    const clanWarOpponents = opponentClanData
        ? opponentClanData.members
            .map((member) => playerRoster.find((player) => player.name === member.name))
            .filter((player): player is PlayerRecord => Boolean(player))
        : [];
    const incomingClanWarChallenges = incomingChallenges.filter((challenge) => Boolean(challenge.clanWarPoints));
    const activeSpectatorFights = spectatorFights.filter((fight) => fight.battleId);
    const pendingSpectatorChallenges = duelChallenges.filter((challenge) =>
        !challenge.accepted &&
        !challenge.declined &&
        (Boolean(challenge.clanWarPoints) || challenge.mode === "ranked")
    );
    const tournamentRemaining = arenaTournament ? Math.max(0, arenaTournament.endsAt - Date.now()) : 0;
    const matchRemaining = arenaTournament ? Math.max(0, arenaTournament.matchDeadline - Date.now()) : 0;

    const acceptDistrictChallenge = (challenge: DuelChallenge) => {
        if (challenge.mode !== "clanWarPet") {
            onAcceptChallenge(challenge);
            return;
        }
        const challengerPet = challenge.challenger.pets.find((pet) =>
            pet.id === challenge.challengerPetId && !isPetOnExpedition(pet)
        ) ?? challenge.challenger.pets.find((pet) => !isPetOnExpedition(pet));
        const responderPet = combatEligiblePets.find((pet) =>
            pet.id === character.activePetId && !isPetOnExpedition(pet)
        ) ?? combatEligiblePets.find((pet) => !isPetOnExpedition(pet));
        if (!challengerPet || !responderPet) {
            alert("Both players need a pet before this pet battle can start.");
            return;
        }
        savePendingClanPetBattle({
            clanName: character.clan,
            points: challenge.clanWarPoints ?? 25,
            opponentName: challenge.fromName,
            createdAt: Date.now(),
        });
        setDuelChallenges((current) => current.filter((candidate) => candidate.id !== challenge.id));
        fetch("/api/player/challenge", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                targetName: challenge.toName,
                fromName: challenge.fromName,
                challengeId: challenge.id,
            }),
        }).catch(() => {});
        fetch("/api/player/challenge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                targetName: challenge.fromName,
                challenge: {
                    ...challenge,
                    accepted: true,
                    fromName: character.name,
                    toName: challenge.fromName,
                    responderPetId: responderPet.id,
                    responderPet,
                },
            }),
        }).catch(() => {});
        setPendingPetBattleOpponent?.({
            owner: challenge.fromName,
            pet: challengerPet,
            battleSeed: challenge.petBattleSeed,
        });
        setScreen("petArena");
    };

    const spectateFight = (fight: ArenaSpectatorFight) => {
        if (!fight.battleId || !setPvpBattleId || !setPvpRole) {
            alert(`Spectating ${fight.title}. Live replay streams will use this fight feed.`);
            return;
        }
        fetch(`/api/pvp/spectate?id=${encodeURIComponent(fight.battleId)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: character.name, action: "join" }),
        }).catch(() => {});
        setPvpBattleId(fight.battleId);
        setPvpRole("p1");
        setScreen("pvpBattle");
    };

    return (
        <ArenaDistrictLobby
            character={character}
            activeTab={activeArenaTab}
            hasAvailablePet={combatEligiblePets.some((pet) => !isPetOnExpedition(pet))}
            availablePetCount={availablePetCount}
            opponentClanData={opponentClanData}
            clanWarOpponents={clanWarOpponents}
            incomingClanWarChallenges={incomingClanWarChallenges}
            arenaTournament={arenaTournament}
            tournamentRemaining={tournamentRemaining}
            matchRemaining={matchRemaining}
            isAdminTournamentManager={isAdminAccountName(character.name)}
            playerRankedEnabled={playerRankedEnabled && rankedMutationsAvailable}
            rankedQueueActive={rankedQueueActive}
            rankedQueueSize={rankedQueueSize}
            spectatorFights={activeSpectatorFights}
            pendingSpectatorChallenges={pendingSpectatorChallenges}
            onBack={() => setScreen("centralHub")}
            onTabChange={setActiveArenaTab}
            onChallengePlayer={(...args) => { void challengePlayer(...args); }}
            onAcceptDistrictChallenge={acceptDistrictChallenge}
            onDeclineChallenge={onDeclineChallenge}
            onAdvanceTournamentPlayer={advanceTournamentPlayer}
            onClearTournament={clearTournament}
            onStartTournament={startTournament}
            onJoinRankedQueue={joinRankedQueue}
            onLeaveRankedQueue={leaveRankedQueue}
            onRefreshFights={() => setSpectatorFights(loadArenaActiveFights())}
            onSpectateFight={spectateFight}
            onViewPendingChallenge={() => alert("This fight has not started yet.")}
            onOpenPetLadder={(mode) => {
                sessionStorage.setItem("petLadder.mode", mode);
                setScreen("petLadder");
            }}
        />
    );
}
