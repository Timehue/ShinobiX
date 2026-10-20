import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Character, BattleHistoryEntry } from "../types/character";
import type { SoloPveSession } from "../lib/solo-pve-api";
import { aiFightExitScreen } from "../lib/ai-fight-result";
import { beginAiFightClose, consumeCommittedAiFightClose, type AiFightCloseHandoff } from '../lib/ai-fight-close-handoff';
import type { SavedBloodline, Jutsu, GameItem } from "../types/combat";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import {
    recoverPendingWorldOutcome,
    resumeGenericAiFight,
    resumeWorldAiFight,
    startAiFight,
    type AiFightPendingWorldChain,
    type AiFightStart,
} from "../lib/ai-fight-api";
import { soloPveArenaTransport, soloPveSessionForArena } from "../lib/solo-pve-arena-adapter";
import { onAiFightRequest, requestAiFight, type AiFightRequest } from "../lib/ai-fight-request";
import {
    settleAiFight,
    shouldSettleOnClose,
    type AiFightSettleHooks,
    type AiFightSettleResult,
} from "../lib/ai-fight-settle";
import {
    clearWandererFightPending,
    ensureWandererFightPending,
    recoverWandererFightAvatar,
    stampWandererFightSettlement,
} from "../lib/wanderer-fight";
import { playerSlug } from "../lib/utils";
import { completeWorldRewardOperation, readPendingWorldRewards } from "../lib/world-reward-recovery";
import { completeAiRaidLaunch } from "../lib/ai-raid-api";
import { requestForResumedGenericFight, rememberCircuitCombatSession, forgetCircuitCombatSession } from '../lib/ai-fight-navigation';
import { adoptRequestedFightPresentation, sameAiFightIdentity, resumedEncounterNotice } from '../lib/ai-fight-identity';
import { namedPvePortrait, ordinaryPvePortrait } from '../lib/ordinary-pve-presentation';
import { aiFightRecoveryOwner, aiFightRecoveryPending, completeAiFightRecovery, aiFightRecoveryIsCurrent } from '../lib/ai-fight-recovery-presence';

// AI fights render through MissionArenaFight — the SAME server-authoritative arena
// shell combat missions and story bosses use. The standalone transport submits
// versioned intent-only actions. MissionArenaFight portals itself
// to <body>, so the fight covers whatever screen the player launched from and no
// navigation is needed. App mounts THIS host eagerly so its request-bus listener is
// always live; the screen is code-split and warmed on the request, in parallel with
// the start round-trip, so it is resident by the time the session opens.
const AiFightScreen = lazyWithRetry(() => import("../screens/AiFightScreen"));
const AiFightResultCard = lazyWithRetry(() => import('./AiFightResultCard'));
const CircuitCombatResult = lazyWithRetry(() => import('../features/dojo-circuit/CircuitCombatResult').then(m => ({ default: m.CircuitCombatResult })));

type ActiveFight = {
    request: AiFightRequest;
    token: string;
    sessionId: string;
    session: SoloPveSession;
    originatingPlayerName: string;
    requestId: number;
    worldContext?: AiFightStart["worldContext"];
    notice?: string;
};

function requestForResumedWorldFight(started: AiFightStart, enemyAvatar?: string): AiFightRequest | null {
    const context = started.worldContext;
    if (!context) return null;
    return {
        opponentId: context.sourceId,
        opponentLevel: Number(started.session.enemy.character.level) || 1,
        battleKind: "world",
        opponentName: context.displayName,
        ...(context.encounter ? { encounter: context.encounter } : {}),
        sector: context.sector,
        returnScreen: "worldMap",
        ...(enemyAvatar ? { enemyAvatar } : {}),
        worldEncounter: {
            kind: context.kind,
            sourceId: context.sourceId,
            sector: context.sector,
            stage: context.stage,
            ...(context.chainId ? { chainId: context.chainId } : {}),
            ...(context.decisionId ? { decisionId: context.decisionId } : {}),
            ...(context.encounter ? { encounterId: context.encounter.id } : {}),
        },
    };
}

function requestForPendingWorldChain(
    recovered: AiFightPendingWorldChain,
    opponentLevel: number,
): AiFightRequest {
    const pending = recovered.pendingWorldChain;
    return {
        opponentId: pending.request.sourceId,
        opponentLevel: Math.max(1, opponentLevel),
        battleKind: "world",
        opponentName: pending.displayName,
        sector: pending.request.sector,
        returnScreen: "worldMap",
        // The durable server handoff is the authority. Relaunch it byte-for-byte;
        // never infer stage/chainId from a local kill counter or hunt marker.
        worldEncounter: pending.request,
    };
}

function acknowledgeExploreFightStart(playerName: string, started: AiFightStart, requestedId?: string): void {
    if (started.battleKind !== "explore") return;
    const exactId = started.worldExploreRequestId ?? requestedId;
    if (exactId) {
        completeWorldRewardOperation(playerName, exactId);
        return;
    }
    // Rolling-deploy compatibility for an active pointer created just before
    // the response began echoing its proof. One unresolved server-rolled tile
    // in the sealed sector can only be the active explore fight.
    if (typeof started.sector !== "number") return;
    const candidates = readPendingWorldRewards(playerName).filter((entry) =>
        entry.kind === "explore"
        && entry.sector === started.sector
        && entry.resolveOutcome === true);
    if (candidates.length === 1) completeWorldRewardOperation(playerName, candidates[0].id);
}

function acknowledgeRaidFightStart(playerName: string, started: AiFightStart, requestedToken?: string): void {
    if (started.battleKind !== "raidAi") return;
    const exactToken = started.raidToken ?? requestedToken;
    if (exactToken) completeAiRaidLaunch(playerName, exactToken);
}

function requestForStartedGenericFight(started: AiFightStart, requested: AiFightRequest): AiFightRequest | null {
    const sealed = requestForResumedGenericFight(started);
    if (!sealed) return null;
    return adoptRequestedFightPresentation(sealed, requested);
}

type StartFailure = {
    request: AiFightRequest;
    message: string;
    originatingPlayerName: string;
    requestId: number;
};

const aiFightPlayerKey = (name: string): string => playerSlug(name);

/*
 * The single host for sealed AI fights (api/missions/ai-fight-start), mounted once
 * in App. Every launch site that fights a CATALOG AI — hunts, apex, village guards,
 * wanderers, explore ambushes, sector raids, field/E-rank missions — emits one
 * request on lib/ai-fight-request and this host decides the screen:
 *
 *   sealed solo-PvE encounter → MissionArenaFight (server-resolved)
 *
 * Missing or unresolvable server profiles fail closed and are shown to the
 * player; this host never runs a rewarding client-resolved fight.
 *
 * The sealed start completes before MissionArenaFight mounts, so every rendered
 * fight already has its authoritative runId and initial session. Arena remains
 * a lobby and owns no combat-start effect or local fallback.
 */
export function AiFightHost({
    character,
    sharedImages,
    savedBloodlines,
    creatorJutsus,
    creatorItems,
    hooks,
    onSettled,
    onClose,
    onFightOpenChange,
    onRecordBattle,
}: {
    character: Character | null;
    sharedImages: Record<string, string>;
    /** The player's own catalogs — the SEALED session carries combat fields but NO
     *  art, so card thumbnails resolve from these by id. */
    savedBloodlines?: SavedBloodline[];
    creatorJutsus?: Jutsu[];
    creatorItems?: GameItem[];
    /** Exact server-proved mission ids mirrored into the current UI. */
    hooks?: AiFightSettleHooks;
    onSettled: (result: AiFightSettleResult) => void;
    onClose?: (returnScreen: string | undefined, playerKey: string, isCurrent: () => boolean) => void;
    /**
     * Fires when a sealed fight is engaged and again when it lets go. Mirrors
     * StoryBossFightHost: the fight is a body portal, so App's `screen` never
     * changes and screen-keyed guards would otherwise read "not in a battle" for
     * the whole fight — which is how an auto-triggered VN ends up painted over it.
     */
    onFightOpenChange?: (open: boolean) => void;
    /** Profile → Battles reflection log projected after server settlement. */
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
}) {
    const [fight, setFight] = useState<ActiveFight | null>(null);
    const [startFailure, setStartFailure] = useState<StartFailure | null>(null);
    // Render mirror of startingRef, so the host counts as engaged from the moment
    // it ACCEPTS a request rather than once the sealed session has come back.
    const [starting, setStarting] = useState(false);
    const startingRef = useRef(false);
    const startRequestIdRef = useRef(0);
    const mountedRef = useRef(false);
    // One settle per fight. The screen settles on resolve; closeFight settles an
    // ABANDONED fight (the server scores that a forfeit), and this stops the two
    // from both firing when the player closes an already-resolved result card.
    const settledRef = useRef(false);
    const playerName = character?.name ?? "";
    const activePlayerKeyRef = useRef(aiFightPlayerKey(playerName));
    // Read through a ref so the subscription does not resubscribe (and drop the
    // single-listener registration) every time a catalog prop changes identity.
    // Updated in an effect, not during render: a bus request always arrives from
    // a user interaction, i.e. after the commit that refreshed this.
    const latestCharacter = useRef(character);
    useLayoutEffect(() => { latestCharacter.current = character; });
    const latestOnSettled = useRef(onSettled);
    useLayoutEffect(() => { latestOnSettled.current = onSettled; });
    // `fight` itself is not readable from the bus callback (it closes over the
    // mount render), so mirror "a fight is on screen" into a ref.
    const activeRef = useRef(false);
    const queuedWorldRequestRef = useRef<AiFightRequest | null>(null);
    const [queuedOpponentName, setQueuedOpponentName] = useState<string | undefined>();
    const settleInFlightRef = useRef<Promise<AiFightSettleResult> | null>(null);
    const closingRequestIdRef = useRef<number | null>(null);
    const pendingCloseRef = useRef<(AiFightCloseHandoff & { queued?: AiFightRequest }) | null>(null);
    const recoveryRetryTimerRef = useRef<number | null>(null);
    const [recoveryAttempt, setRecoveryAttempt] = useState(0);
    const recoveryPlayerKey = aiFightPlayerKey(playerName);
    const [recoveryPresence, setRecoveryPresence] = useState({ playerKey: recoveryPlayerKey, completedScope: '' });
    const recoveryScope = recoveryPlayerKey ? `${recoveryPlayerKey}:${recoveryAttempt}` : '';
    // Claim recovery before passive story triggers, including the first account
    // render. An empty/failed probe releases this claim; retries get a new scope.
    const recoveryPending = aiFightRecoveryPending(recoveryPresence, recoveryPlayerKey, recoveryScope);
    const requestIsCurrent = useCallback((playerKey: string, requestId: number) => aiFightRecoveryIsCurrent(
        mountedRef.current, playerKey, requestId, activePlayerKeyRef.current, startRequestIdRef.current,
    ), []);
    useLayoutEffect(() => { activeRef.current = fight !== null; }, [fight]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            startRequestIdRef.current += 1;
            startingRef.current = false;
            activeRef.current = false;
            queuedWorldRequestRef.current = null;
            settleInFlightRef.current = null;
            closingRequestIdRef.current = null;
            pendingCloseRef.current = null;
            if (recoveryRetryTimerRef.current !== null) window.clearTimeout(recoveryRetryTimerRef.current);
        };
    }, []);

    useLayoutEffect(() => {
        const nextPlayerKey = aiFightPlayerKey(playerName);
        if (activePlayerKeyRef.current === nextPlayerKey) return;
        activePlayerKeyRef.current = nextPlayerKey;
        startRequestIdRef.current += 1;
        startingRef.current = false;
        setStarting(false);
        activeRef.current = false;
        settledRef.current = false;
        queuedWorldRequestRef.current = null;
        setQueuedOpponentName(undefined);
        settleInFlightRef.current = null;
        closingRequestIdRef.current = null;
        pendingCloseRef.current = null;
        if (recoveryRetryTimerRef.current !== null) window.clearTimeout(recoveryRetryTimerRef.current);
        recoveryRetryTimerRef.current = null;
        setRecoveryPresence((current) => aiFightRecoveryOwner(current, nextPlayerKey));
        setFight((current) => current
            && aiFightPlayerKey(current.originatingPlayerName) !== nextPlayerKey
            ? null
            : current);
        setStartFailure((current) => current
            && aiFightPlayerKey(current.originatingPlayerName) !== nextPlayerKey
            ? null
            : current);
    }, [playerName]);

    // Refresh recovery: the server holds exactly one active World Map pointer.
    // Reopen that same token/session; never mint a duplicate chain wave.
    useEffect(() => {
        const originatingPlayerName = playerName;
        const originatingPlayerKey = aiFightPlayerKey(originatingPlayerName);
        if (!originatingPlayerKey || !aiFightRecoveryPending(recoveryPresence, originatingPlayerKey, recoveryScope)) return;
        if (activeRef.current) { setRecoveryPresence((current) => completeAiFightRecovery(current, originatingPlayerKey, recoveryScope)); return; }
        if (startingRef.current) return; // The accepted start releases or adopts this claim when it settles.
        startingRef.current = true;
        const requestId = ++startRequestIdRef.current;
        void resumeWorldAiFight(originatingPlayerName)
            .then(async (started) => {
                if (!requestIsCurrent(originatingPlayerKey, requestId)) return;
                if (started === null) {
                    // A 404 from the World pointer is normal. Probe the separate
                    // generic pointer so raids/explore/practice fights survive
                    // refresh without being misclassified as World encounters.
                    const generic = await resumeGenericAiFight(originatingPlayerName);
                    if (!generic || !requestIsCurrent(originatingPlayerKey, requestId)) return;
                    const resumedRequest = requestForResumedGenericFight(generic, originatingPlayerName);
                    if (!resumedRequest) throw new Error("Your unfinished battle could not be identified. Reopen the encounter to try again.");
                    acknowledgeExploreFightStart(originatingPlayerName, generic);
                    acknowledgeRaidFightStart(originatingPlayerName, generic);
                    setStartFailure(null);
                    activeRef.current = true;
                    setFight({
                        request: resumedRequest,
                        token: generic.token,
                        sessionId: generic.sessionId,
                        session: generic.session,
                        originatingPlayerName,
                        requestId,
                    });
                    return;
                }
                if ("pendingWorldChain" in started) {
                    const pending = started.pendingWorldChain;
                    ensureWandererFightPending(originatingPlayerName, {
                        ...pending.request,
                        stage: pending.request.stage,
                        displayName: pending.displayName,
                    });
                    const recoveredRequest = requestForPendingWorldChain(
                        started,
                        Number(latestCharacter.current?.level) || 1,
                    );
                    // The request listener effect is mounted in this same commit.
                    // Queue one task so the resume probe releases startingRef first.
                    window.setTimeout(() => {
                        if (mountedRef.current
                            && activePlayerKeyRef.current === originatingPlayerKey
                            && !activeRef.current) requestAiFight(recoveredRequest);
                    }, 0);
                    setStartFailure(null);
                    return;
                }
                if ("pendingWorldOutcome" in started) {
                    const recovered = await recoverPendingWorldOutcome(originatingPlayerName, started.pendingWorldOutcome);
                    if (!requestIsCurrent(originatingPlayerKey, requestId)) return;
                    clearWandererFightPending(originatingPlayerName);
                    setStartFailure(null);
                    latestOnSettled.current({
                        settled: true,
                        outcome: "win",
                        ryo: Number(recovered.reward.ryo) || 0,
                        statPoints: 0,
                        capped: false,
                        replayed: recovered.replayed === true,
                        character: recovered.character,
                        _saveVersion: recovered._saveVersion,
                        fetchMissionsCredited: [],
                    });
                    window.setTimeout(() => alert("Your saved ambush reward has been recovered."), 40);
                    return;
                }
                if (!started.worldContext) return;
                const context = started.worldContext;
                const recoveredAvatar = recoverWandererFightAvatar(originatingPlayerName, context);
                const resumedRequest = requestForResumedWorldFight(started, recoveredAvatar);
                if (!resumedRequest) return;
                ensureWandererFightPending(originatingPlayerName, context, resumedRequest.enemyAvatar);
                setStartFailure(null);
                activeRef.current = true;
                setFight({
                    request: resumedRequest,
                    token: started.token,
                    sessionId: started.sessionId,
                    session: started.session,
                    originatingPlayerName,
                    requestId,
                    worldContext: context,
                });
            })
            .catch(() => {
                // A transient resume/claim failure must not orphan the pointer
                // until a full page reload. Retrying is idempotent at both APIs.
                if (!requestIsCurrent(originatingPlayerKey, requestId)) return;
                if (recoveryRetryTimerRef.current !== null) window.clearTimeout(recoveryRetryTimerRef.current);
                recoveryRetryTimerRef.current = window.setTimeout(() => {
                    recoveryRetryTimerRef.current = null;
                    setRecoveryAttempt((attempt) => attempt + 1);
                }, 5_000);
            })
            .finally(() => {
                if (!requestIsCurrent(originatingPlayerKey, requestId)) return;
                startingRef.current = false;
                setRecoveryPresence((current) => completeAiFightRecovery(current, originatingPlayerKey, recoveryScope));
            });
    }, [playerName, recoveryScope, recoveryPresence, starting, requestIsCurrent]);

    useEffect(() => {
        const subscribedPlayerKey = aiFightPlayerKey(playerName);
        if (!subscribedPlayerKey) return;
        return onAiFightRequest((request) => {
            const me = latestCharacter.current;
            if (!me) return false;
            const originatingPlayerName = me.name;
            const originatingPlayerKey = aiFightPlayerKey(originatingPlayerName);
            // One fight at a time. A second request while a start is in flight —
            // or while a fight is already on screen — is dropped rather than
            // queued: two sealed encounters would mint two tokens for one
            // intended fight, and the second would silently replace the first,
            // leaving the abandoned run to be scored a forfeit.
            if (originatingPlayerKey !== subscribedPlayerKey
                || activePlayerKeyRef.current !== originatingPlayerKey) return false;
            if (activeRef.current) {
                // A settled chain wave may schedule exactly one server-proved
                // successor. Hold it until the player closes the result card;
                // starting while the old overlay is live would replace its run.
                if (settledRef.current && request.worldEncounter) {
                    if (queuedWorldRequestRef.current && !sameAiFightIdentity(queuedWorldRequestRef.current, request)) return false;
                    queuedWorldRequestRef.current = request;
                    setQueuedOpponentName(request.opponentName ?? 'the next opponent');
                    return true;
                }
                return false;
            }
            if (startingRef.current) return false;
            startingRef.current = true;
            setStarting(true);
            const requestId = ++startRequestIdRef.current;
            settledRef.current = false;
            setStartFailure(null);
            // Warm-up only. A failed load resurfaces through the lazy MissionArenaFight
            // above (retries, then ErrorBoundary); it must not also escape unhandled here.
            void import("../screens/AiFightScreen").catch(() => {});
            startAiFight({
                playerName: originatingPlayerName,
                opponentId: request.opponentId,
                opponentLevel: request.opponentLevel,
                battleKind: request.battleKind,
                sector: request.sector,
                ...(request.worldExploreRequestId ? { worldExploreRequestId: request.worldExploreRequestId } : {}),
                ...(request.raidToken ? { raidToken: request.raidToken } : {}),
                ...(request.dungeonRunToken ? { dungeonRunToken: request.dungeonRunToken } : {}),
                ...(request.worldEncounter ? { worldEncounter: request.worldEncounter } : {}),
                ...(request.encounter ? { encounterId: request.encounter.id } : {}),
            })
                .then((started) => {
                    if (!requestIsCurrent(originatingPlayerKey, requestId)) return;
                    if ("pendingWorldChain" in started || "pendingWorldOutcome" in started) {
                        // The attempted launch met an older durable World handoff.
                        // Let the recovery effect consume that exact server object;
                        // never replace it with the newly clicked encounter.
                        setRecoveryAttempt((attempt) => attempt + 1);
                        return;
                    }
                    const sealedWorldRequest = started.worldContext ? requestForResumedWorldFight(started) : null;
                    const sealedRequest = sealedWorldRequest
                        ? adoptRequestedFightPresentation(sealedWorldRequest, request)
                        : requestForStartedGenericFight(started, request);
                    if (!sealedRequest) throw new Error("The battle could not be confirmed. Reopen the encounter to try again.");
                    if (sealedRequest.returnScreen === 'dojoCircuit' && started.battleKind === 'practice') rememberCircuitCombatSession(originatingPlayerName, started.sessionId);
                    const sameRequestedEncounter = sameAiFightIdentity(sealedRequest, request);
                    acknowledgeExploreFightStart(originatingPlayerName, started, sameRequestedEncounter ? request.worldExploreRequestId : undefined);
                    acknowledgeRaidFightStart(originatingPlayerName, started, sameRequestedEncounter ? request.raidToken : undefined);
                    if (started.worldContext) ensureWandererFightPending(originatingPlayerName, started.worldContext, sealedRequest.enemyAvatar);
                    // Do not arm the one-fight gate until the response has a
                    // complete sealed identity. A malformed rolling-deploy
                    // response must leave Retry able to submit a fresh request.
                    activeRef.current = true;
                    setFight({
                        request: sealedRequest,
                        token: started.token,
                        sessionId: started.sessionId,
                        session: started.session,
                        originatingPlayerName,
                        requestId,
                        ...(started.worldContext ? { worldContext: started.worldContext } : {}),
                        ...(started.resumed ? { notice: resumedEncounterNotice(sealedRequest, request) } : {}),
                    });
                })
                .catch((error) => {
                    if (!requestIsCurrent(originatingPlayerKey, requestId)) return;
                    if (request.worldEncounter) setRecoveryAttempt((attempt) => attempt + 1);
                    setStartFailure({
                        request,
                        message: String((error as Error)?.message ?? error),
                        originatingPlayerName,
                        requestId,
                    });
                })
                .finally(() => {
                    if (startRequestIdRef.current !== requestId) return;
                    startingRef.current = false;
                    setStarting(false);
                });
            return true;
        });
    }, [playerName, requestIsCurrent]);

    const activeStartFailure = startFailure
        && aiFightPlayerKey(startFailure.originatingPlayerName) === aiFightPlayerKey(playerName)
        ? startFailure
        : null;
    const activeFight = fight
        && aiFightPlayerKey(fight.originatingPlayerName) === aiFightPlayerKey(playerName)
        ? fight
        : null;

    // Announced from an effect, with a cleanup so an unmount mid-fight still closes
    // it out. The failure card counts too: it is a blocking overlay on the same
    // portal, and nothing else should be allowed to open on top of it.
    const open = starting || !!activeFight || !!activeStartFailure || recoveryPending;
    useLayoutEffect(() => {
        onFightOpenChange?.(open);
        return () => { if (open) onFightOpenChange?.(false); };
    }, [open, onFightOpenChange]);

    // Notify App only after the portal is gone and its presence was released.
    // App then commits its mission guard before following the return target.
    useEffect(() => {
        const closed = consumeCommittedAiFightClose(pendingCloseRef, {
            open, playerKey: activePlayerKeyRef.current, requestId: startRequestIdRef.current,
        });
        if (!closed) return;
        closingRequestIdRef.current = null;
        const isCurrent = () => requestIsCurrent(closed.playerKey, closed.requestId);
        onClose?.(closed.returnScreen, closed.playerKey, isCurrent);
        const queued = closed.queued;
        if (queued) window.setTimeout(() => {
            if (requestIsCurrent(closed.playerKey, closed.requestId)) requestAiFight(queued);
        }, 0);
    }, [open, onClose, playerName, startFailure, requestIsCurrent]);

    if (activeStartFailure) {
        return (
            <div className="battle-ended-overlay" role="alert" aria-live="assertive">
                <div className="card battle-ended-card">
                    <h2>Fight unavailable</h2>
                    <p>{activeStartFailure.message}</p>
                    <button onClick={() => {
                        const retry = activeStartFailure.request;
                        setStartFailure((current) => current?.requestId === activeStartFailure.requestId ? null : current);
                        window.setTimeout(() => {
                            if (requestIsCurrent(aiFightPlayerKey(activeStartFailure.originatingPlayerName), activeStartFailure.requestId)) requestAiFight(retry);
                        }, 0);
                    }}>Retry</button>
                    <button onClick={() => {
                        const screen = activeStartFailure.request.returnScreen;
                        pendingCloseRef.current = { playerKey: aiFightPlayerKey(activeStartFailure.originatingPlayerName), requestId: activeStartFailure.requestId, returnScreen: screen };
                        setStartFailure((current) => current?.requestId === activeStartFailure.requestId ? null : current);
                    }}>Return</button>
                </div>
            </div>
        );
    }
    if (!activeFight || !character) return null;
    const currentFight: ActiveFight = activeFight;
    const request = currentFight.request;
    const opponentName = currentFight.session.enemy.name || request.opponentName || "the enemy";
    const encounter = currentFight.worldContext?.encounter ?? request.encounter;
    const sealedAvatar = currentFight.session.enemy.character.avatarImage;
    const enemyAvatar = typeof sealedAvatar === 'string' && sealedAvatar ? sealedAvatar
        : encounter ? ordinaryPvePortrait(encounter) ?? request.enemyAvatar : namedPvePortrait(opponentName) ?? request.enemyAvatar;
    const originatingPlayerName = currentFight.originatingPlayerName;
    const originatingPlayerKey = aiFightPlayerKey(originatingPlayerName);

    // Redeem the sealed token and adopt its authoritative character/progression.
    // There is no client-supplied amount or locally inferred territory damage.
    async function settle(_runId: string, _settlingPlayer: string): Promise<AiFightSettleResult> {
        if (activePlayerKeyRef.current !== originatingPlayerKey) {
            throw new Error("This AI fight belongs to a previous account.");
        }
        if (settleInFlightRef.current) return settleInFlightRef.current;
        const scopeIsCurrent = () => requestIsCurrent(originatingPlayerKey, currentFight.requestId);
        const inFlight = (async () => {
            const settled = await settleAiFight({
                playerName: originatingPlayerName,
                token: currentFight.token,
                opponentId: currentFight.request.opponentId,
                battleKind: currentFight.request.battleKind,
                sector: currentFight.request.sector,
                hooks: {
                    onMissionRaidComplete: (sector, missionIds) => {
                        if (scopeIsCurrent()) hooks?.onMissionRaidComplete?.(sector, missionIds);
                    },
                },
            });
            if (scopeIsCurrent()) {
                settledRef.current = true;
                latestOnSettled.current(settled);
                if (settled.worldContext && settled.outcome) {
                    stampWandererFightSettlement({ outcome: settled.outcome, worldContext: settled.worldContext, character: settled.character, _saveVersion: settled._saveVersion });
                }
                currentFight.request.onResolved?.(settled);
            } else if (activePlayerKeyRef.current === originatingPlayerKey) {
                // The fight screen closed (or another fight began) while the reply was in
                // flight, but the rewards, and any gear drop, are already paid on the server.
                // Hand the reply to the App, which adopts it only if it is this account's
                // newest save. The fight specific steps above stay skipped.
                latestOnSettled.current(settled);
            }
            return settled;
        })();
        settleInFlightRef.current = inFlight;
        try {
            return await inFlight;
        } catch (error) {
            if (scopeIsCurrent()) settledRef.current = false;
            throw error;
        } finally {
            if (settleInFlightRef.current === inFlight) settleInFlightRef.current = null;
        }
    }

    async function closeFight() {
        if (!activeRef.current || !requestIsCurrent(originatingPlayerKey, currentFight.requestId)) return;
        if (!beginAiFightClose(closingRequestIdRef, currentFight.requestId)) return;
        const active = currentFight;
        let returnScreen = aiFightExitScreen(!!latestCharacter.current?.hospitalized, active?.request.returnScreen);
        // Leaving an UNSETTLED fight is a forfeit, not an escape. Without this a
        // player about to lose could close the screen and take no damage at all,
        // making every fight free to retry — strictly better than winning
        // carefully. The server applies the forfeit cost and carries the actual
        // remaining HP; only a zero-HP outcome causes hospital admission.
        if (shouldSettleOnClose(!!active, settledRef.current) && active) {
            try {
                const result = await settle(active.sessionId, active.originatingPlayerName);
                returnScreen = aiFightExitScreen(!!result.character?.hospitalized, active.request.returnScreen);
            } catch {
                if (!requestIsCurrent(originatingPlayerKey, active.requestId)) return;
                closingRequestIdRef.current = null;
                window.setTimeout(() => alert("The fight is still syncing with the combat server. Retry Return when the connection recovers."), 40);
                return;
            }
        }
        if (!requestIsCurrent(originatingPlayerKey, active.requestId)) return;
        activeRef.current = false;
        if (active) forgetCircuitCombatSession(active.originatingPlayerName, active.sessionId);
        pendingCloseRef.current = {
            playerKey: originatingPlayerKey, requestId: active.requestId, returnScreen,
            queued: queuedWorldRequestRef.current ?? undefined,
        };
        queuedWorldRequestRef.current = null;
        setQueuedOpponentName(undefined);
        setFight((current) => current?.requestId === active?.requestId ? null : current);
    }

    return (
        <Suspense fallback={null}>
            <AiFightScreen
                huntSession={currentFight.session}
                huntSettleFn={settle}
                enemyAvatar={enemyAvatar}
                character={character}
                runId={currentFight.sessionId}
                initialSession={soloPveSessionForArena(currentFight.session)}
                eventLabel={request.returnScreen === 'dojoCircuit' ? 'Dojo Circuit' : undefined}
                encounter={encounter}
                encounterNotice={currentFight.notice}
                transport={soloPveArenaTransport}
                sharedImages={sharedImages}
                savedBloodlines={savedBloodlines}
                creatorJutsus={creatorJutsus}
                creatorItems={creatorItems}
                settleFn={settle}
                // Settle on ANY resolution, not just a win: a defeat has to reach
                // the server or it costs the player nothing.
                settleOnAnyDone
                onRecordBattle={onRecordBattle}
                recordMode={request.returnScreen === 'dojoCircuit' ? 'Dojo Circuit' : currentFight.worldContext ? "World Encounter" : request.battleKind === "practice" ? "Practice" : "AI Fight"}
                enemyAvatarOverride={enemyAvatar}
                onExit={closeFight}
                renderResult={(ctx) => request.returnScreen === 'dojoCircuit' ? <Suspense fallback={null}><CircuitCombatResult playerName={character.name} won={ctx.won} draw={ctx.draw} settleState={ctx.settleState} onRetry={ctx.retry} onExit={closeFight} /></Suspense> : (
                    <Suspense fallback={null}><AiFightResultCard
                        won={ctx.won}
                        draw={ctx.draw}
                        settleState={ctx.settleState}
                        settleResult={ctx.settleResult as AiFightSettleResult | null}
                        opponentName={opponentName}
                        opponentLevel={Number(currentFight.session.enemy.character.level) || undefined}
                        enemyAvatar={enemyAvatar}
                        encounter={encounter}
                        queuedOpponentName={queuedOpponentName}
                        onExportLog={() => { void import('../lib/solo-battle-debug').then(({ downloadRecordedSoloBattleDebug }) => downloadRecordedSoloBattleDebug(currentFight.sessionId, currentFight.session.player.name)).catch(() => alert('Unable to load the battle log. Please retry export.')); }}
                        worldEncounter={!!currentFight.worldContext}
                        spar={!currentFight.worldContext && request.battleKind === "practice"}
                        onRetry={ctx.retry}
                        onExit={closeFight}
                    /></Suspense>
                )}
            />
        </Suspense>
    );
}
