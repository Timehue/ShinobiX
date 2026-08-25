import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Character, BattleHistoryEntry } from "../types/character";
import type { SoloPveSession } from "../lib/solo-pve-api";
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

// AI fights render through MissionArenaFight — the SAME server-authoritative arena
// shell combat missions and story bosses use. The standalone transport submits
// versioned intent-only actions. MissionArenaFight portals itself
// to <body>, so the fight covers whatever screen the player launched from and no
// navigation is needed. App mounts THIS host eagerly so its request-bus listener is
// always live; the screen is code-split and warmed on the request, in parallel with
// the start round-trip, so it is resident by the time the session opens.
const MissionArenaFight = lazyWithRetry(() => import("../screens/MissionArenaFight").then((m) => ({ default: m.MissionArenaFight })));

type ActiveFight = {
    request: AiFightRequest;
    token: string;
    sessionId: string;
    session: SoloPveSession;
    originatingPlayerName: string;
    requestId: number;
    worldContext?: AiFightStart["worldContext"];
};

function requestForResumedWorldFight(started: AiFightStart, enemyAvatar?: string): AiFightRequest | null {
    const context = started.worldContext;
    if (!context) return null;
    return {
        opponentId: context.sourceId,
        opponentLevel: Number(started.session.enemy.character.level) || 1,
        battleKind: "world",
        opponentName: context.displayName,
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

function requestForResumedGenericFight(started: AiFightStart): AiFightRequest | null {
    if (!started.opponentId || !started.opponentName || !started.battleKind || started.worldContext) return null;
    return {
        opponentId: started.opponentId,
        opponentLevel: Math.max(1, Number(started.session.enemy.character.level) || 1),
        battleKind: started.battleKind,
        opponentName: started.opponentName,
        ...(typeof started.sector === "number" ? { sector: started.sector } : {}),
        ...(started.worldExploreRequestId ? { worldExploreRequestId: started.worldExploreRequestId } : {}),
        ...(started.dungeonRunToken ? { dungeonRunToken: started.dungeonRunToken } : {}),
        ...((started.battleKind === "raidAi" || started.battleKind === "explore") ? { returnScreen: "worldMap" }
            : started.battleKind === "dungeon" ? { returnScreen: "dungeon" } : {}),
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
    const sameOpponent = sealed.opponentId === requested.opponentId;
    return {
        ...sealed,
        // Navigation is client presentation. Enemy name/id/kind/sector are not:
        // explore authority may replace a locally suggested opponent.
        ...(requested.returnScreen ? { returnScreen: requested.returnScreen } : {}),
        ...((sameOpponent || started.battleKind === "dungeon") && requested.enemyAvatar ? { enemyAvatar: requested.enemyAvatar } : {}),
        // Settlement callbacks are presentation/continuation only and run after
        // the authoritative report. Preserve them across the initial identity
        // rebuild; enemy identity and rewards still come exclusively from the
        // sealed start/report responses.
        ...(requested.onResolved ? { onResolved: requested.onResolved } : {}),
    };
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
    onClose?: (returnScreen?: string) => void;
    /** Profile → Battles reflection log projected after server settlement. */
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
}) {
    const [fight, setFight] = useState<ActiveFight | null>(null);
    const [startFailure, setStartFailure] = useState<StartFailure | null>(null);
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
    const settleInFlightRef = useRef<Promise<AiFightSettleResult> | null>(null);
    const closeInFlightRef = useRef(false);
    const recoveryRetryTimerRef = useRef<number | null>(null);
    const [recoveryAttempt, setRecoveryAttempt] = useState(0);
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
            closeInFlightRef.current = false;
            if (recoveryRetryTimerRef.current !== null) window.clearTimeout(recoveryRetryTimerRef.current);
        };
    }, []);

    useLayoutEffect(() => {
        const nextPlayerKey = aiFightPlayerKey(playerName);
        if (activePlayerKeyRef.current === nextPlayerKey) return;
        activePlayerKeyRef.current = nextPlayerKey;
        startRequestIdRef.current += 1;
        startingRef.current = false;
        activeRef.current = false;
        settledRef.current = false;
        queuedWorldRequestRef.current = null;
        settleInFlightRef.current = null;
        closeInFlightRef.current = false;
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
        if (!originatingPlayerKey || startingRef.current || activeRef.current) return;
        startingRef.current = true;
        const requestId = ++startRequestIdRef.current;
        void resumeWorldAiFight(originatingPlayerName)
            .then(async (started) => {
                if (!mountedRef.current
                    || startRequestIdRef.current !== requestId
                    || activePlayerKeyRef.current !== originatingPlayerKey) return;
                if (started === null) {
                    // A 404 from the World pointer is normal. Probe the separate
                    // generic pointer so raids/explore/practice fights survive
                    // refresh without being misclassified as World encounters.
                    const generic = await resumeGenericAiFight(originatingPlayerName);
                    if (!generic
                        || !mountedRef.current
                        || startRequestIdRef.current !== requestId
                        || activePlayerKeyRef.current !== originatingPlayerKey) return;
                    const resumedRequest = requestForResumedGenericFight(generic);
                    if (!resumedRequest) throw new Error("The resumed AI encounter has no sealed request identity.");
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
                    if (!mountedRef.current
                        || startRequestIdRef.current !== requestId
                        || activePlayerKeyRef.current !== originatingPlayerKey) return;
                    clearWandererFightPending(originatingPlayerName);
                    setStartFailure(null);
                    latestOnSettled.current({
                        settled: true,
                        outcome: "win",
                        ryo: Number(recovered.reward.ryo) || 0,
                        capped: false,
                        replayed: recovered.replayed === true,
                        character: recovered.character,
                        _saveVersion: recovered._saveVersion,
                        fetchMissionsCredited: [],
                    });
                    window.setTimeout(() => alert("Recovered your sealed ambush reward from the Guild ledger."), 40);
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
                if (!mountedRef.current || activePlayerKeyRef.current !== originatingPlayerKey) return;
                if (recoveryRetryTimerRef.current !== null) window.clearTimeout(recoveryRetryTimerRef.current);
                recoveryRetryTimerRef.current = window.setTimeout(() => {
                    recoveryRetryTimerRef.current = null;
                    setRecoveryAttempt((attempt) => attempt + 1);
                }, 5_000);
            })
            .finally(() => {
                if (startRequestIdRef.current === requestId) startingRef.current = false;
            });
    }, [playerName, recoveryAttempt]);

    useEffect(() => {
        const subscribedPlayerKey = aiFightPlayerKey(playerName);
        if (!subscribedPlayerKey) return;
        return onAiFightRequest((request) => {
            const me = latestCharacter.current;
            if (!me) return;
            const originatingPlayerName = me.name;
            const originatingPlayerKey = aiFightPlayerKey(originatingPlayerName);
            // One fight at a time. A second request while a start is in flight —
            // or while a fight is already on screen — is dropped rather than
            // queued: two sealed encounters would mint two tokens for one
            // intended fight, and the second would silently replace the first,
            // leaving the abandoned run to be scored a forfeit.
            if (originatingPlayerKey !== subscribedPlayerKey
                || activePlayerKeyRef.current !== originatingPlayerKey) return;
            if (activeRef.current) {
                // A settled chain wave may schedule exactly one server-proved
                // successor. Hold it until the player closes the result card;
                // starting while the old overlay is live would replace its run.
                if (settledRef.current && request.worldEncounter) queuedWorldRequestRef.current = request;
                return;
            }
            if (startingRef.current) return;
            startingRef.current = true;
            const requestId = ++startRequestIdRef.current;
            settledRef.current = false;
            setStartFailure(null);
            void import("../screens/MissionArenaFight");
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
            })
                .then((started) => {
                    if (!mountedRef.current
                        || startRequestIdRef.current !== requestId
                        || activePlayerKeyRef.current !== originatingPlayerKey) return;
                    if ("pendingWorldChain" in started || "pendingWorldOutcome" in started) {
                        // The attempted launch met an older durable World handoff.
                        // Let the recovery effect consume that exact server object;
                        // never replace it with the newly clicked encounter.
                        setRecoveryAttempt((attempt) => attempt + 1);
                        return;
                    }
                    const sealedWorldMatchesRequest = !!started.worldContext
                        && request.worldEncounter?.kind === started.worldContext.kind
                        && request.worldEncounter.sourceId === started.worldContext.sourceId
                        && request.worldEncounter.sector === started.worldContext.sector;
                    const sealedRequest = started.worldContext
                        ? requestForResumedWorldFight(started, sealedWorldMatchesRequest ? request.enemyAvatar : undefined)
                        : requestForStartedGenericFight(started, request);
                    if (!sealedRequest) throw new Error("The combat server did not return a sealed encounter identity.");
                    acknowledgeExploreFightStart(originatingPlayerName, started, request.worldExploreRequestId);
                    acknowledgeRaidFightStart(originatingPlayerName, started, request.raidToken);
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
                    });
                })
                .catch((error) => {
                    if (!mountedRef.current
                        || startRequestIdRef.current !== requestId
                        || activePlayerKeyRef.current !== originatingPlayerKey) return;
                    if (request.worldEncounter) setRecoveryAttempt((attempt) => attempt + 1);
                    setStartFailure({
                        request,
                        message: String((error as Error)?.message ?? error),
                        originatingPlayerName,
                        requestId,
                    });
                })
                .finally(() => {
                    if (startRequestIdRef.current === requestId) startingRef.current = false;
                });
        });
    }, [playerName]);

    const activeStartFailure = startFailure
        && aiFightPlayerKey(startFailure.originatingPlayerName) === aiFightPlayerKey(playerName)
        ? startFailure
        : null;
    const activeFight = fight
        && aiFightPlayerKey(fight.originatingPlayerName) === aiFightPlayerKey(playerName)
        ? fight
        : null;

    if (activeStartFailure) {
        return (
            <div className="battle-ended-overlay" role="alert" aria-live="assertive">
                <div className="card battle-ended-card">
                    <h2>Fight unavailable</h2>
                    <p>{activeStartFailure.message}</p>
                    <button onClick={() => {
                        const retry = activeStartFailure.request;
                        setStartFailure((current) => current?.requestId === activeStartFailure.requestId ? null : current);
                        window.setTimeout(() => { requestAiFight(retry); }, 0);
                    }}>Retry</button>
                    <button onClick={() => {
                        const screen = activeStartFailure.request.returnScreen;
                        setStartFailure((current) => current?.requestId === activeStartFailure.requestId ? null : current);
                        onClose?.(screen);
                    }}>Return</button>
                </div>
            </div>
        );
    }
    if (!activeFight || !character) return null;
    const currentFight: ActiveFight = activeFight;
    const request = currentFight.request;
    const opponentName = request.opponentName ?? "the enemy";
    const originatingPlayerName = currentFight.originatingPlayerName;
    const originatingPlayerKey = aiFightPlayerKey(originatingPlayerName);

    // Redeem the sealed token and adopt its authoritative character/progression.
    // There is no client-supplied amount or locally inferred territory damage.
    async function settle(_runId: string, _settlingPlayer: string): Promise<AiFightSettleResult> {
        if (activePlayerKeyRef.current !== originatingPlayerKey) {
            throw new Error("This AI fight belongs to a previous account.");
        }
        if (settleInFlightRef.current) return settleInFlightRef.current;
        const scopeIsCurrent = () => mountedRef.current
            && activePlayerKeyRef.current === originatingPlayerKey;
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
            settledRef.current = true;
            if (scopeIsCurrent()) {
                latestOnSettled.current(settled);
                if (settled.worldContext && settled.outcome) {
                    stampWandererFightSettlement({ outcome: settled.outcome, worldContext: settled.worldContext, character: settled.character, _saveVersion: settled._saveVersion });
                }
                currentFight.request.onResolved?.(settled);
            }
            return settled;
        })();
        settleInFlightRef.current = inFlight;
        try {
            return await inFlight;
        } catch (error) {
            settledRef.current = false;
            throw error;
        } finally {
            if (settleInFlightRef.current === inFlight) settleInFlightRef.current = null;
        }
    }

    async function closeFight() {
        if (closeInFlightRef.current) return;
        const active = currentFight;
        const returnScreen = active?.request.returnScreen;
        // Leaving an UNSETTLED fight is a forfeit, not an escape. Without this a
        // player about to lose could close the screen and take no damage at all,
        // making every fight free to retry — strictly better than winning
        // carefully. The server scores it: an `active` session settles as a
        // forfeit and hospitalizes, exactly like a defeat.
        if (shouldSettleOnClose(!!active, settledRef.current) && active) {
            closeInFlightRef.current = true;
            try {
                await settle(active.sessionId, active.originatingPlayerName);
            } catch {
                closeInFlightRef.current = false;
                window.setTimeout(() => alert("The fight is still syncing with the combat server. Retry Return when the connection recovers."), 40);
                return;
            }
        }
        closeInFlightRef.current = false;
        activeRef.current = false;
        setFight((current) => current?.requestId === active?.requestId ? null : current);
        if (activePlayerKeyRef.current === originatingPlayerKey) onClose?.(returnScreen);
        const queued = queuedWorldRequestRef.current;
        queuedWorldRequestRef.current = null;
        if (queued && activePlayerKeyRef.current === originatingPlayerKey) {
            window.setTimeout(() => { requestAiFight(queued); }, 0);
        }
    }

    return (
        <Suspense fallback={null}>
            <MissionArenaFight
                character={character}
                runId={currentFight.sessionId}
                initialSession={soloPveSessionForArena(currentFight.session)}
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
                recordMode={currentFight.worldContext ? "World Encounter" : request.battleKind === "practice" ? "Practice" : "AI Fight"}
                enemyAvatarOverride={request.enemyAvatar}
                onExit={closeFight}
                renderResult={(ctx) => (
                    <AiFightResultCard
                        won={ctx.won}
                        draw={ctx.draw}
                        settleState={ctx.settleState}
                        settleResult={ctx.settleResult as AiFightSettleResult | null}
                        opponentName={opponentName}
                        worldEncounter={!!currentFight.worldContext}
                        onRetry={ctx.retry}
                        onExit={closeFight}
                    />
                )}
            />
        </Suspense>
    );
}

/** Result presentation for the already token-settled canonical fight. */
function AiFightResultCard({
    won,
    draw,
    settleState,
    settleResult,
    opponentName,
    worldEncounter,
    onRetry,
    onExit,
}: {
    won: boolean;
    draw: boolean;
    settleState: "idle" | "pending" | "settled" | "failed";
    settleResult: AiFightSettleResult | null;
    opponentName: string;
    worldEncounter: boolean;
    onRetry: () => void;
    onExit: () => void;
}) {
    if (!won) {
        return (
            <div className="story-fight-complete" role="dialog" aria-label={draw ? "Fight drawn" : "Fight lost"}>
                <div className="story-fight-complete-card">
                    <p className="story-fight-complete-kicker">{draw ? "Stalemate" : "Defeated"}</p>
                    <h2>{opponentName}</h2>
                    <p className="story-fight-complete-boss">
                        {draw
                            ? "Neither side could finish it. No reward was earned."
                            : `${opponentName} stands over you. You are carried to the hospital — no reward was earned.`}
                    </p>
                    {settleState === "failed"
                        ? <button onClick={onRetry}>Retry</button>
                        : <button disabled={settleState === "pending"} onClick={onExit}>Return</button>}
                </div>
            </div>
        );
    }

    // WIN. Reward numbers come from the server's settle response — never a local
    // prediction, because the daily soft cap and a profession payout can both
    // change what is actually granted.
    const grantedNothing = settleResult && settleResult.outcome === "win" && settleResult.ryo <= 0;
    return (
        <div className="story-fight-complete" role="dialog" aria-label="Fight won">
            <div className="story-fight-complete-card">
                <p className="story-fight-complete-kicker">Victory</p>
                <h2>{opponentName} defeated.</h2>
                {settleState !== "settled" || !settleResult
                    ? (
                        <p className="story-fight-complete-rewards">
                            {settleState === "failed" ? "The reward could not be verified." : "Tallying rewards…"}
                        </p>
                    )
                    : !settleResult.settled
                        ? <p className="story-fight-complete-rewards">No reward was granted for this fight.</p>
                        : settleResult.replayed
                            ? <p className="story-fight-complete-rewards">This reward was already collected.</p>
                            : grantedNothing && !worldEncounter
                                // A practice bout pays nothing by design — say so
                                // plainly rather than showing a bare "+0 ryo".
                                ? <p className="story-fight-complete-rewards">Practice bout — no rewards.</p>
                                : grantedNothing
                                    ? <p className="story-fight-complete-rewards">Encounter cleared. Contract rewards remain available at their normal turn-in.</p>
                                    : (
                                    <p className="story-fight-complete-rewards">
                                        +{settleResult.ryo} ryo{settleResult.capped ? " (daily cap reached)" : ""}
                                        <span className="story-fight-complete-title">Stat points come from training, your dailies, and serious PvP.</span>
                                    </p>
                                    )}
                {settleState === "failed"
                    ? <button onClick={onRetry}>Retry</button>
                    : <button disabled={settleState === "pending"} onClick={onExit}>Continue</button>}
            </div>
        </div>
    );
}
