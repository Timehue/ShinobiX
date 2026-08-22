/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
// Command-deck glyphs (game-icons.net, CC BY 3.0) — one per basic action.
import {
    GiCrossedSwords, GiBootPrints, GiHealing, GiMagicSwirl, GiWaterDrop, GiRun, GiSandsOfTime,
} from "react-icons/gi";
import "../styles/battle-skin.css";
import type { Biome, Screen, WeatherType } from "../types/core";
import type { Character, BattleHistoryEntry } from "../types/character";
import type { GameItem, Jutsu } from "../types/combat";
import { JUTSU_MAX_LEVEL } from "../constants/game";
import { CombatRoundTimer } from "../components/CombatRoundTimer";
import { CombatSideHud } from "../components/CombatSideHud";
import { FighterHpBadge } from "../components/FighterHpBadge";
import { BattlefieldActor } from "../components/BattlefieldActor";
import { JutsuEffectCards } from "../components/JutsuEffectCards";
import { BattleTabBar } from "../components/BattleTabBar";
import {
    CombatApPanel,
    CombatBoardStage,
    CombatCommandBar,
    CombatEnvironmentStrip,
    CombatHudHeader,
    CombatHudLayout,
    CombatHudMain,
    PlainCombatBattleLog,
} from "../components/CombatHudLayout";
import { CombatInstance } from "../components/CombatInstance";
import { ShinobiCombatShell } from "../components/ShinobiCombatShell";
import { CombatJutsuMeta } from "../components/CombatJutsuMeta";
import { CombatDetailPortal } from "../components/CombatDetailPortal";
import { activeBarrierTilesForDisplay, combatActionAvailability } from "../lib/combat-action-display";
import { biomeLabel, terrainEffects, weatherEffects } from "../data/world";
import { getJutsuMastery, scaleJutsuByLevel } from "../lib/jutsu-scaling";
import { normalizeEquipmentSlot } from "../lib/equipment";
import { hasAffordablePvpPaidAction } from "../lib/pvp-action-affordability";
import { normalizeJutsu } from "../lib/jutsu";
import { jutsuTargetingLabel } from "../lib/jutsu-effects";
import { normalizeTagName, statusMatchesName, tagMatchesName, pvpAffectsOpponent } from "../lib/tags";
import { realtimeAvailable, subscribeKvKey } from "../lib/realtime";
import { buildActionsFromPvpLog, makeBattleEntry } from "../lib/battle-log-history";
import { useBoardScale } from "../lib/use-board-scale";
import { useBattleTabs } from "../lib/use-battle-tabs";
import { hexLineTiles } from "../lib/hex-path";
import { jutsuImpactPreviewTiles } from "../lib/jutsu-impact-preview";
import { prefersLiteCombatFx } from "../lib/device-tier";
import { safeCombatVfxSpec, combatVfxAnchorKey, dedupeCombatVfx, type CombatVfxSpec } from "../lib/combat-vfx";
import { combatVfxAssetFor } from "../lib/combat-vfx-assets";
import {
    normalizeCharacter,
    playerLensDiscipline,
    type PvpGroundEffectState,
    type PvpSessionState,
} from "../App";
import { loadArenaActiveFights, saveArenaActiveFights, unregisterLocalFight, type ArenaSpectatorFight } from "../lib/world-state";
import type { PvpWinBaseSummary } from "../lib/progression";
import {
    beginPvpRewardCompletion,
    completePvpRewardCompletion,
    postPvpRewardCompletionAck,
    postPvpRewardClaim,
    shouldRunPvpRewardCompletion,
    type PvpRewardClaimConfirmed,
    type PvpRewardCompletionStorage,
    type PvpRewardContinuationContext,
} from "../lib/pvp-reward-claim";
import { settlementDeadlineMs } from "../lib/pvp-settlement-deadline";
import {
    abortableDelay,
    createPvpContinuationFence,
    decidePvpSessionRevision,
    fetchInitialPvpProjection,
    parsePvpSessionProjection,
    pvpRuntimeScopeKey,
    splitPvpMoveResponse,
} from "../lib/pvp-session-runtime";
import { fetchPendingPvpRecovery } from "../lib/pvp-pending-fetch";
import { earnedStatPoints } from "../lib/stats";
import { useSocialLock } from "../lib/account-status";

// Avatar travel animation. A fighter's marker steps through each hex on the line
// between its old and new cell (PATH_STEP_MS apart) and CSS-glides each hop, so
// Move / Dash / Flicker / Push / Pull read as crossing the board rather than
// teleporting. The glide is a touch longer than the step so hops overlap into a
// smooth continuous walk.
const PATH_STEP_MS = 130;
const ORB_PATH_TRANSITION = "left 180ms linear, top 180ms linear";
const PVP_MAX_ACTIONS = 5;
const PVP_REWARD_CLAIM_TIMEOUT_MS = 12_000;
/**
 * Ceiling on the whole completion phase (settlement callbacks + the ACK).
 *
 * Each stage gets its own PVP_REWARD_CLAIM_TIMEOUT_MS so a slow-but-progressing
 * settle is not punished for the sum of its parts — but four stages at 12s each
 * would leave a genuinely wedged completion sitting on "claiming" for ~48s with
 * exit disabled. Whichever limit is hit first wins, so healthy slow settles pass
 * and a hung one still surfaces Retry inside half a minute.
 */
const PVP_REWARD_COMPLETION_CEILING_MS = 30_000;

// XP retired: the HUD "power" dossier stat is total earned stat points
// (allocated above base + any unspent pool the combat snapshot carries).
function pvpEarnedPoints(character: unknown): number | undefined {
    if (!character || typeof character !== "object") return undefined;
    return earnedStatPoints(character as Pick<Character, "stats" | "unspentStats">);
}

/**
 * Tween a fighter's *displayed* tile from its previous cell to `targetPos` along
 * the hex line, returning the cell to draw the avatar at this frame. The real
 * (session) position still drives targeting/highlights — only the avatar marker
 * lags behind to animate the trip. `targetPos < 0` means "no session yet" (hold).
 * The first real value seeds without animating, and an oversized jump (state
 * resync / reconnect) snaps instead of crawling across the grid.
 */
function useWaypointPos(targetPos: number, width: number, height: number): number {
    const [displayPos, setDisplayPos] = useState(targetPos);
    const prevRef = useRef(targetPos);
    const seededRef = useRef(false);
    const timersRef = useRef<number[]>([]);
    useEffect(() => {
        timersRef.current.forEach(id => clearTimeout(id));
        timersRef.current = [];
        const to = targetPos;
        if (to < 0) return;
        if (!seededRef.current) { seededRef.current = true; prevRef.current = to; setDisplayPos(to); return; }
        const from = prevRef.current;
        prevRef.current = to;
        if (from < 0 || from === to) { setDisplayPos(to); return; }
        const path = hexLineTiles(from, to, width, height);
        if (path.length > 8) { setDisplayPos(to); return; }   // big resync — don't crawl
        path.slice(1).forEach((p, idx) => {                   // path[0] === from (already shown)
            timersRef.current.push(window.setTimeout(() => setDisplayPos(p), idx * PATH_STEP_MS));
        });
        return () => { timersRef.current.forEach(id => clearTimeout(id)); timersRef.current = []; };
    }, [targetPos, width, height]);
    return displayPos;
}

// Grid constants — exact match to arena. Module scope so the geometry helpers
// below can be defined ONCE for the module instead of being re-created on every
// render of the battle screen.
const gridWidth = 12;
const gridHeight = 10;
const HEX_W = 72;
const HEX_H = 42;
const X_STEP = HEX_W * 0.75;
const Y_STEP = HEX_H * 0.92;
const ORB = 52;
const GRID_LAYER_W = (gridWidth - 1) * X_STEP + HEX_W;
const GRID_LAYER_H = (gridHeight - 1) * Y_STEP + HEX_H * 1.5;

// Grid helpers — exact match to arena. Pure functions of a tile index, hoisted to
// module scope so they have STABLE identity across renders; a per-render
// redefinition defeats any memo or child component that closes over them.
function pvpXY(pos: number) { return { x: pos % gridWidth, y: Math.floor(pos / gridWidth) }; }
function pvpPosFromXY(x: number, y: number): number {
    if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return -1;
    return y * gridWidth + x;
}
function pvpAxial(pos: number) { const { x, y } = pvpXY(pos); return { q: x, r: y - ((x - (x & 1)) / 2) }; }
function pvpDist(a: number, b: number): number {
    const A = pvpAxial(a); const B = pvpAxial(b);
    return (Math.abs(A.q - B.q) + Math.abs(A.q + A.r - B.q - B.r) + Math.abs(A.r - B.r)) / 2;
}
function pvpHexNeighbors(pos: number): number[] {
    const { x, y } = pvpXY(pos);
    const even = x % 2 === 0;
    const deltas = even
        ? [[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[0,1]]
        : [[1,1],[1,0],[0,-1],[-1,0],[-1,1],[0,1]];
    return deltas.map(([dx, dy]) => pvpPosFromXY(x + dx!, y + dy!)).filter(n => n >= 0);
}
function pvpTileCenter(pos: number) {
    const { x, y } = pvpXY(pos);
    return {
        x: x * X_STEP + HEX_W / 2,
        y: y * Y_STEP + (x % 2 === 1 ? HEX_H / 2 : 0) + HEX_H / 2,
    };
}

// Idle chat/spectator polls re-fetch an identical payload every few seconds.
// Returning the PREVIOUS array when nothing changed lets React bail out of the
// re-render entirely (same reference), so an idle battle stops re-rendering the
// board. Deep-compares via JSON, so a genuine update is never dropped.
function sameListJson(a: unknown[], b: unknown[]): boolean {
    return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

export function PvpBattleScreen({
    character,
    accountSessionEpoch,
    isAccountSessionCurrent = () => true,
    battleId,
    role,
    setScreen,
    equippedJutsu,
    equippedItems,
    currentBiome,
    currentWeather,
    currentSector,
    sharedImages,
    seedSession,
    isSpar = false,
    battleMode = "standard",
    onWin,
    onLoss,
    onCompletionConfirmed,
    onExit,
    onViewBattleRecord,
    onRecordBattle,
    onRewardClaim,
}: {
    character: Character;
    /** App-owned login/save epoch; changes even when the same account reauthenticates. */
    accountSessionEpoch: number;
    /** Render-synchronous parent fence checked again before local completion + ACK. */
    isAccountSessionCurrent?: () => boolean;
    battleId: string;
    role: "p1" | "p2";
    setScreen: (s: Screen) => void;
    equippedJutsu: Jutsu[];
    equippedItems: GameItem[];
    currentBiome: Biome;
    currentWeather: WeatherType;
    currentSector: number;
    sharedImages: Record<string, string>;
    // Pre-fetched session payload supplied by the call site that just
    // created the fight. When present and matching battleId, the grid
    // renders on first paint and the initial GET in the fetch-loop
    // useEffect below short-circuits. Refresh / resume paths leave this
    // null so the GET still runs.
    seedSession?: PvpSessionState | null;
    isSpar?: boolean;
    battleMode?: string;
    onWin?: (opponentName: string, opponent?: Character, serverRating?: { field: string; value: number; delta: number }, serverBase?: PvpWinBaseSummary, claim?: PvpRewardClaimConfirmed, context?: PvpRewardContinuationContext) => void | Promise<void>;
    onLoss?: (opponent?: Character, serverRating?: { field: string; value: number; delta: number }, claim?: PvpRewardClaimConfirmed, context?: PvpRewardContinuationContext) => void | Promise<void>;
    /** Adopt the claim's versioned snapshot/progression on both first response and replay. */
    onRewardClaim?: (claim: PvpRewardClaimConfirmed, context?: PvpRewardContinuationContext) => void | Promise<void>;
    /** Fires only after durable App continuations and the server ACK confirm. */
    onCompletionConfirmed?: () => void;
    onExit?: (target: Screen) => void;
    /** Opens the durable read-only record for a finished battle. */
    onViewBattleRecord?: (battleId: string) => void;
    onRecordBattle?: (entry: BattleHistoryEntry, continuation: PvpRewardContinuationContext) => Promise<void>;
}) {
    // Grid constants (gridWidth/gridHeight/HEX_*/X_STEP/Y_STEP/ORB/GRID_LAYER_*)
    // are defined once at module scope above — in scope here.

    // Lazy initializer covers the case where the parent already has the
    // seed in state at mount time (e.g. accept-challenge flow that awaits
    // the POST before navigating). The optimistic-navigation flow mounts
    // before the POST resolves, so the seedSyncRef effect below also
    // handles the seed arriving via a later re-render.
    const [session, setSession] = useState<PvpSessionState | null>(() => {
        if (!seedSession) return null;
        const parsed = parsePvpSessionProjection(seedSession, battleId);
        return parsed.kind === "session" ? parsed.session : null;
    });
    const serverPlayerRanked = session?.playerRankedAuthorityVersion === 2 || session?.ranked === true;
    const realPvpItemsDisabled = (session?.pvpConsumableAuthorityVersion === 1
        && session.realFighters?.[role] === true)
        || session?.playerRankedAuthorityVersion === 2;
    const effectiveIsSpar = isSpar && !serverPlayerRanked;
    const effectiveBattleMode = serverPlayerRanked ? "ranked" : battleMode;
    // Tracks the battleId we've already seeded so a later Realtime/move
    // update on the same fight doesn't get clobbered by a re-apply of the
    // (now-stale) initial seed.
    const seededBattleIdRef = useRef<string | null>(session ? battleId : null);
    useEffect(() => {
        if (!seedSession) return;
        const parsed = parsePvpSessionProjection(seedSession, battleId);
        if (parsed.kind !== "session") return;
        if (seededBattleIdRef.current === battleId) return;
        seededBattleIdRef.current = battleId;
        setSession(current => acceptRevision(current, parsed.session));
        // A stable create can finish after the initial bounded GET exhausted.
        // The late authoritative seed must restart transports, not merely paint
        // a board whose earlier fetch effect already stopped.
        setSessionLoadFailure("");
        setSessionExitCheck("unchecked");
        setConnectionState("reconnecting");
        setSessionRetryKey(key => key + 1);
    }, [seedSession, battleId]);
    const [submitting, setSubmitting] = useState(false);
    const submitInFlightRef = useRef(false);
    const [selectedActionId, setSelectedActionId] = useState<"move" | undefined>(undefined);
    const [pendingJutsuId, setPendingJutsuId] = useState("");
    const [pendingJutsuDirect, setPendingJutsuDirect] = useState<Jutsu | null>(null);
    const [pendingBasicAttack, setPendingBasicAttack] = useState(false);
    const [pendingWeaponId, setPendingWeaponId] = useState("");
    const [inspectedJutsuId, setInspectedJutsuId] = useState("");
    const [moveFeedback, setMoveFeedback] = useState("");
    // Mobile Actions|Battle Log tabs (+ unread badge on the log). Desktop shows both.
    const battleLogLines = session && moveFeedback
        ? [...session.log, `⚠️ ${moveFeedback}`]
        : (session?.log ?? []);
    const battleTabs = useBattleTabs(battleLogLines.length);
    const [inspectedWeaponId, setInspectedWeaponId] = useState("");
    const [hoveredPvpTile, setHoveredPvpTile] = useState<number | null>(null);
    // Auto-fit board scale + manual zoom — shared hook (see lib/use-board-scale).
    const { battlefieldRef, battlefieldCallbackRef, boardContainerSize, effectiveScale } = useBoardScale(GRID_LAYER_W, GRID_LAYER_H);
    const [pvpRoundTimerKey, setPvpRoundTimerKey] = useState(0);
    // When the round timer hits 0 we queue an auto-wait. If the player has
    // an action in flight at that moment (submitting === true), the wait
    // can't fire immediately — a separate effect watches `submitting` and
    // fires the queued wait once it clears. Without this, the timer would
    // hit 0, clearInterval, the wait would silently bail, and the player's
    // turn would never end.
    const [pvpPendingAutoWait, setPvpPendingAutoWait] = useState(false);
    const [pvpPrefightCountdown, setPvpPrefightCountdown] = useState<number | null>(null);
    const [pvpPrefightFirstActor, setPvpPrefightFirstActor] = useState<"p1" | "p2" | null>(null);
    // Connection state for the live-update channel (Realtime → SSE → poll
    // fallback chain). "connected" stays in place during normal play;
    // "reconnecting" fires when the WebSocket drops or SSE errors, so
    // players see a visible pill instead of staring at a frozen board
    // wondering whether to refresh. The fetch/subscribe effect flips
    // this on Realtime status callbacks and SSE error/open events.
    const [connectionState, setConnectionState] = useState<"connected" | "reconnecting">("connected");
    // Weak phones / desktops skip the dash-trail flourish (the only animation-heavy
    // PvP cosmetic); the floating ±damage numbers below are kept as the impact cue.
    const liteFx = prefersLiteCombatFx();
    const [pvpMotionFx, setPvpMotionFx] = useState<PvpMotionFx[]>([]);
    // Latest combat-hotkey handlers, read by a stable keydown listener (below).
    // Updated each render so it never goes stale and stays a top-level hook.
    const combatHotkeyRef = useRef<{ active: boolean; actions: Record<string, () => void> } | null>(null);
    const pvpSessionFirstLoadRef = useRef(false);
    const pvpRewardRef = useRef(false);
    const rewardClaimAbortRef = useRef<AbortController | null>(null);
    const exitCheckAbortRef = useRef<AbortController | null>(null);
    const [pvpRewardClaimState, setPvpRewardClaimState] = useState<"idle" | "claiming" | "failed" | "confirmed">("idle");
    const [pvpRewardClaimError, setPvpRewardClaimError] = useState("");
    const [pvpRewardNotice, setPvpRewardNotice] = useState("");
    const [sessionLoadFailure, setSessionLoadFailure] = useState("");
    const [sessionRetryKey, setSessionRetryKey] = useState(0);
    const [sessionExitCheck, setSessionExitCheck] = useState<"unchecked" | "checking" | "safe">("unchecked");
    const revisionConflictRetryRef = useRef(false);
    const previousPvpPositionsRef = useRef<{ p1: number; p2: number } | null>(null);
    // Live HP-delta floating numbers (RTX-1): make an opponent's offense legible
    // in real time instead of only as a silently-dropping HP bar.
    const [pvpHitFx, setPvpHitFx] = useState<PvpHitFx[]>([]);
    const [pvpCombatVfx, setPvpCombatVfx] = useState<PvpCombatVfx[]>([]);
    const previousPvpHpRef = useRef<{ p1: number; p2: number } | null>(null);
    // Last server fx batch already rendered (see the hit-fx effect). `undefined`
    // until the first session is observed, so a reload / spectator join never
    // replays the latest batch.
    const lastFxSeqRef = useRef<number | undefined>(undefined);
    const lastVfxSeqRef = useRef<number | undefined>(undefined);
    const hasObservedVfxSessionRef = useRef(false);

    const runtimeScopeKey = pvpRuntimeScopeKey(character.name, accountSessionEpoch, battleId, role);
    const continuationFenceRef = useRef(createPvpContinuationFence());
    useLayoutEffect(() => {
        continuationFenceRef.current.activate(runtimeScopeKey);
        return () => {
            rewardClaimAbortRef.current?.abort();
            rewardClaimAbortRef.current = null;
            exitCheckAbortRef.current?.abort();
            exitCheckAbortRef.current = null;
            pvpRewardRef.current = false;
            continuationFenceRef.current.invalidate();
        };
    }, [runtimeScopeKey]);

    function markSessionUnavailable(message: string, isCurrent: () => boolean): void {
        if (!isCurrent()) return;
        setSession(null);
        setSessionLoadFailure(message);
        setConnectionState("reconnecting");
    }

    function acceptRevision(current: PvpSessionState | null, incoming: PvpSessionState) {
        const decision = decidePvpSessionRevision(current, incoming);
        if (decision === "accept") {
            revisionConflictRetryRef.current = false;
            return incoming;
        }
        if (decision === "conflict" && !revisionConflictRetryRef.current) {
            revisionConflictRetryRef.current = true;
            queueMicrotask(() => setSessionRetryKey(key => key + 1));
        }
        return current;
    }

    function applySessionProjection(raw: unknown, isCurrent: () => boolean) {
        const parsed = parsePvpSessionProjection(raw, battleId);
        if (!isCurrent()) return parsed;
        if (parsed.kind === "terminal") {
            markSessionUnavailable(parsed.message, isCurrent);
            return parsed;
        }
        if (parsed.kind === "session") {
            setSession(current => acceptRevision(current, parsed.session));
        }
        return parsed;
    }

    async function verifyPendingSessionBeforeExit(): Promise<void> {
        const internalScopeIsCurrent = continuationFenceRef.current.capture();
        const isCurrentScope = () => internalScopeIsCurrent() && isAccountSessionCurrent();
        exitCheckAbortRef.current?.abort();
        const exitAbort = new AbortController();
        exitCheckAbortRef.current = exitAbort;
        setSessionExitCheck("checking");
        try {
            const pending = await fetchPendingPvpRecovery(fetch, character.name, {
                signal: AbortSignal.any([exitAbort.signal, AbortSignal.timeout(8_000)]),
            });
            if (!isCurrentScope()) return;
            if (!pending) {
                // The authenticated server index proved this account has no
                // live or incomplete PvP obligation. Only now is destructive
                // navigation allowed from the unavailable-session screen.
                setSessionExitCheck("safe");
                return;
            }
            if (pending.battleId !== battleId || pending.role !== role) {
                setSessionExitCheck("unchecked");
                setSessionLoadFailure("Another PvP settlement is still pending for this account. Reopen it before leaving.");
                return;
            }
            setSession(current => acceptRevision(current, pending.session));
            setSessionLoadFailure("");
            setConnectionState("connected");
            setSessionExitCheck("unchecked");
            // Restart live transports after the earlier terminal/failure path
            // stopped them; the recovered authoritative row remains visible.
            setSessionRetryKey(value => value + 1);
        } catch {
            if (!isCurrentScope()) return;
            setSessionExitCheck("unchecked");
            setSessionLoadFailure("Could not verify the pending battle yet. Retry when the connection returns.");
        } finally {
            if (exitCheckAbortRef.current === exitAbort) exitCheckAbortRef.current = null;
        }
    }

    const exitBattle = (target: Screen) => {
        if (onExit) onExit(target);
        else setScreen(target);
    };

    // Grid helpers (pvpXY / pvpPosFromXY / pvpAxial / pvpDist / pvpHexNeighbors /
    // pvpTileCenter) are defined once at module scope above — in scope here.

    // Board scale, zoom, and the battlefield callback-ref are now provided by
    // the shared useBoardScale hook destructured above.

    useEffect(() => {
        let active = true;
        const internalScopeIsCurrent = continuationFenceRef.current.capture();
        const isCurrentScope = () => internalScopeIsCurrent() && isAccountSessionCurrent();
        const transportAbort = new AbortController();
        const parsedSeed = seedSession ? parsePvpSessionProjection(seedSession, battleId) : null;
        let hasLoadedSession = parsedSeed?.kind === "session";
        let streamFailures = 0;
        let es: EventSource | null = null;
        let pollTimer: number | null = null;
        let unsubscribeRealtime: (() => void) | null = null;
        // Set once we've escalated from Realtime to the SSE/poll fallback, so
        // the channel-error path and the no-payload watchdog can't start SSE
        // twice. (#11)
        let fallbackStarted = false;
        // Watchdog: if the Realtime subscription comes up but never delivers a
        // payload within this window, we assume it's silently dead (e.g.
        // kv_store not in the supabase_realtime publication, #13) and fall back
        // to SSE so the board still updates. Canceled on the first real push.
        let firstPayloadTimer: number | null = null;
        const REALTIME_PAYLOAD_WATCHDOG_MS = 10_000;
        const MAX_MISSING_SESSION_ATTEMPTS = 5;
        setSessionLoadFailure("");
        setSessionExitCheck("unchecked");

        function stopLiveTransports(): void {
            active = false;
            transportAbort.abort();
            if (unsubscribeRealtime) { try { unsubscribeRealtime(); } catch { /* noop */ } unsubscribeRealtime = null; }
            if (es) { try { es.close(); } catch { /* noop */ } es = null; }
            if (pollTimer !== null) { window.clearTimeout(pollTimer); pollTimer = null; }
            if (firstPayloadTimer !== null) { window.clearTimeout(firstPayloadTimer); firstPayloadTimer = null; }
        }

        function endSession(message: string): void {
            markSessionUnavailable(message, isCurrentScope);
            stopLiveTransports();
        }

        function acceptSession(raw: unknown): PvpSessionState | null {
            const parsed = applySessionProjection(raw, isCurrentScope);
            if (parsed.kind === "terminal") {
                stopLiveTransports();
                return null;
            }
            if (parsed.kind !== "session") return null;
            hasLoadedSession = true;
            streamFailures = 0;
            if (active && isCurrentScope()) {
                setSessionLoadFailure("");
            }
            return parsed.session;
        }

        // Tier 0 fetch — even with Realtime/SSE pushing changes, we
        // need an initial snapshot since subscriptions only fire on
        // NEW writes. Without this the screen would render blank
        // until the first move.
        async function fetchInitial(): Promise<PvpSessionState | null> {
            const initial = await fetchInitialPvpProjection({
                battleId,
                fetchSession: (input, init) => fetch(input, init),
                signal: transportAbort.signal,
                isActive: () => active && isCurrentScope(),
                attempts: MAX_MISSING_SESSION_ATTEMPTS,
            });
            if (initial.kind === "aborted") return null;
            if (initial.kind === "session") return acceptSession(initial.session);
            if (initial.kind === "terminal" || initial.kind === "missing") {
                endSession(initial.message);
                return null;
            }
            if (!initial.seedMayRemainVisible || !hasLoadedSession) {
                endSession(initial.message);
            } else if (active && isCurrentScope()) {
                // A transient authority outage may keep the already-validated
                // seed visible, but it is explicitly degraded until live GET or
                // push traffic resumes.
                setConnectionState("reconnecting");
            }
            return null;
        }

        // Long-poll fallback used when neither Realtime nor SSE is
        // available (very old browser or both failed).
        async function pollFallback() {
            let misses = 0;
            while (active) {
                if (document.visibilityState === "hidden") {
                    try { await abortableDelay(2_000, transportAbort.signal); } catch { break; }
                    continue;
                }
                try {
                    const res = await fetch(`/api/pvp/session?id=${encodeURIComponent(battleId)}`, {
                        signal: transportAbort.signal,
                    });
                    if (res.ok) {
                        const data = acceptSession(await res.json());
                        if (!data) {
                            misses += 1;
                        } else {
                            misses = 0;
                            if (data.status === "done") break;
                        }
                    } else if (res.status === 404 || res.status === 409) {
                        endSession(
                            res.status === 409
                                ? "This ranked battle ended as a no-contest."
                                : "The battle session is unavailable or expired.",
                        );
                        break;
                    } else misses += 1;
                } catch { misses += 1; }
                if (misses >= MAX_MISSING_SESSION_ATTEMPTS) {
                    endSession("The battle session is unavailable or expired.");
                    break;
                }
                try { await abortableDelay(1_000, transportAbort.signal); } catch { break; }
            }
        }

        // SSE fallback. Server pushes `session` events every ~100ms
        // when the KV record changes. Used when Realtime isn't
        // configured (env vars missing) or fails.
        function startStream() {
            if (!active) return;
            if (typeof EventSource === "undefined") {
                void pollFallback();
                return;
            }
            try {
                es = new EventSource(`/api/pvp/stream?id=${encodeURIComponent(battleId)}`);
                es.addEventListener("session", (e) => {
                    if (!active || !isCurrentScope()) return;
                    // Any message arriving means the channel is healthy.
                    setConnectionState("connected");
                    try {
                        const parsed = acceptSession(JSON.parse((e as MessageEvent).data));
                        if (!parsed) setConnectionState("reconnecting");
                    } catch { setConnectionState("reconnecting"); }
                });
                es.addEventListener("open", () => {
                    if (active) setConnectionState("connected");
                });
                es.addEventListener("end", (event) => {
                    es?.close();
                    es = null;
                    let message = "The battle session is unavailable or expired.";
                    try {
                        const reason = JSON.parse((event as MessageEvent).data) as { reason?: string };
                        if (reason.reason === "session-done") return;
                        if (reason.reason === "ranked-no-contest") message = "This ranked battle ended as a no-contest.";
                    } catch { /* default terminal copy */ }
                    endSession(message);
                });
                es.onerror = () => {
                    es?.close();
                    es = null;
                    if (!active) return;
                    streamFailures += 1;
                    if (!hasLoadedSession && streamFailures >= MAX_MISSING_SESSION_ATTEMPTS) {
                        setSessionLoadFailure("The battle session is unavailable or expired.");
                        return;
                    }
                    // Surface the gap so players see "reconnecting…" rather
                    // than a frozen board.
                    setConnectionState("reconnecting");
                    pollTimer = window.setTimeout(() => {
                        if (!active) return;
                        startStream();
                    }, 1500);
                };
            } catch {
                if (active) setConnectionState("reconnecting");
                void pollFallback();
            }
        }

        // Escalate from a degraded/silent Realtime channel to the SSE (then
        // poll) fallback. Tears down the Realtime subscription so SSE is the
        // sole transport — no double setSession, no competing auto-retries.
        // Idempotent via fallbackStarted. (#11)
        function escalateToStreamFallback() {
            if (!active || fallbackStarted) return;
            fallbackStarted = true;
            if (firstPayloadTimer !== null) { window.clearTimeout(firstPayloadTimer); firstPayloadTimer = null; }
            if (unsubscribeRealtime) { try { unsubscribeRealtime(); } catch { /* noop */ } unsubscribeRealtime = null; }
            setConnectionState("reconnecting");
            startStream();
        }

        // Primary path: Supabase Realtime. Subscribes directly to the
        // kv_store row for this battle — Supabase pushes the new
        // session JSON via WebSocket the moment Postgres commits the
        // write. Latency: ~30-80ms vs. ~100ms for SSE vs. up to 1s
        // for old polling.
        if (realtimeAvailable()) {
            unsubscribeRealtime = subscribeKvKey<unknown>(
                `pvp:${battleId}`,
                (next) => {
                    if (!active || fallbackStarted) return;
                    // A real push proves the channel is healthy: cancel the
                    // no-payload watchdog and clear any "reconnecting" state.
                    if (firstPayloadTimer !== null) { window.clearTimeout(firstPayloadTimer); firstPayloadTimer = null; }
                    setConnectionState("connected");
                    const parsed = acceptSession(next);
                    if (!parsed && active) escalateToStreamFallback();
                },
                (status) => {
                    if (!active || fallbackStarted) return;
                    if (status === "SUBSCRIBED") setConnectionState("connected");
                    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
                        // Don't trust Supabase's auto-retry alone — if the
                        // channel can't recover the board would freeze on
                        // "reconnecting…" forever. Fall back to SSE (then poll),
                        // which is independent of the Realtime publication.
                        escalateToStreamFallback();
                    }
                },
            );
            // Arm the silent-failure watchdog. If no payload arrives in the
            // window (subscription "up" but the row isn't published, #13),
            // switch to SSE. A genuinely quiet battle just gets SSE as its
            // transport — harmless (same data, ~100ms).
            firstPayloadTimer = window.setTimeout(() => {
                escalateToStreamFallback();
            }, REALTIME_PAYLOAD_WATCHDOG_MS);
        }
        // A seed is first-paint data, not current authority. Always perform one
        // GET (with bounded 404 retries): Realtime emits writes but does not
        // replay a deletion/tombstone that happened before subscription.
        void fetchInitial();
        // If Realtime didn't initialize (env vars missing or client
        // construct failed), fall back to SSE. We don't run both —
        // they'd both setSession with the same data, wasting cycles.
        if (!unsubscribeRealtime) {
            startStream();
        }

        return () => {
            stopLiveTransports();
        };
    }, [battleId, runtimeScopeKey, sessionRetryKey]);

    // A fighter is reward-eligible only after this authenticated handshake.
    // It is idempotent server-side and retries a few times for navigation races.
    useEffect(() => {
        if (!session || session.status !== "active" || session.joined?.[role] === true) return;
        const fighter = role === "p1" ? session.p1 : session.p2;
        if (fighter.name.trim().toLowerCase() !== character.name.trim().toLowerCase()) return;
        let cancelled = false;
        const isCurrentScope = continuationFenceRef.current.capture();
        const joinAbort = new AbortController();
        void (async () => {
            for (let attempt = 0; !cancelled && isCurrentScope() && attempt < 4; attempt += 1) {
                if (attempt > 0) {
                    try { await abortableDelay(400 * attempt, joinAbort.signal); } catch { return; }
                }
                if (cancelled || !isCurrentScope()) return;
                try {
                    const res = await fetch("/api/pvp/move", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            battleId,
                            role,
                            action: "join",
                            moveToken: `join-${battleId}-${role}`,
                        }),
                        signal: AbortSignal.any([joinAbort.signal, AbortSignal.timeout(8_000)]),
                    });
                    if (res.ok) {
                        const parsed = applySessionProjection(await res.json(), isCurrentScope);
                        if (parsed.kind === "session") return;
                    }
                } catch { /* retry */ }
            }
        })();
        return () => { cancelled = true; joinAbort.abort(); };
    }, [battleId, role, runtimeScopeKey, session?.status, session?.joined?.p1, session?.joined?.p2, session?.p1.name, session?.p2.name]);

    // Desktop combat hotkeys — A=Attack M=Move H=Heal C=Clear X=Cleanse
    // F=Flee W/Space=End turn Esc=Deselect. Reads the latest handlers via a ref
    // so this stays a stable top-level hook. Ignores keypresses while typing
    // (battle chat) and only fires on the local player's turn; AP/cooldown
    // affordability is enforced server-side.
    useEffect(() => {
        function onCombatKey(e: KeyboardEvent) {
            const state = combatHotkeyRef.current;
            if (!state || !state.active || e.ctrlKey || e.metaKey || e.altKey) return;
            const el = document.activeElement as HTMLElement | null;
            if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
            const fn = state.actions[e.key.toLowerCase()];
            if (fn) { e.preventDefault(); fn(); }
        }
        window.addEventListener("keydown", onCombatKey);
        return () => window.removeEventListener("keydown", onCombatKey);
    }, []);

    useEffect(() => {
        if (!session) return;
        // Track positions regardless (so re-enabling never slingshots), but on weak
        // devices skip building the dash-trail FX + its timers entirely.
        const previous = previousPvpPositionsRef.current;
        const current = { p1: session.p1.pos, p2: session.p2.pos };
        if (!previous || liteFx) {
            previousPvpPositionsRef.current = current;
            return;
        }
        const nextFx: PvpMotionFx[] = [];
        if (previous.p1 !== current.p1) nextFx.push({ id: `p1-${Date.now()}-${current.p1}`, fighter: "p1", from: previous.p1, to: current.p1 });
        if (previous.p2 !== current.p2) nextFx.push({ id: `p2-${Date.now()}-${current.p2}`, fighter: "p2", from: previous.p2, to: current.p2 });
        previousPvpPositionsRef.current = current;
        if (!nextFx.length) return;
        setPvpMotionFx((existing) => [...existing, ...nextFx].slice(-6));
        const timeout = window.setTimeout(() => {
            setPvpMotionFx((existing) => existing.filter((fx) => !nextFx.some((added) => added.id === fx.id)));
        }, 620);
        return () => window.clearTimeout(timeout);
    }, [session?.p1.pos, session?.p2.pos]);

    // Float a damage (red) / heal (green) number over a fighter for each resolved
    // hit. The server now supplies the TRUE per-hit amounts (session.fx, the same
    // numbers written to the combat log) with a monotonic session.fxSeq, so a
    // killing blow reads the real damage — not the post-clamp HP remainder — and
    // simultaneous hits (reflect + recoil, absorb-heal + damage, a multi-tick DoT)
    // each float separately instead of collapsing into one net delta. Purely
    // additive overlay — touches no combat logic.
    const spawnHitFx = (nextFx: PvpHitFx[]) => {
        if (!nextFx.length) return undefined;
        setPvpHitFx((existing) => [...existing, ...nextFx].slice(-8));
        const timeout = window.setTimeout(() => {
            setPvpHitFx((existing) => existing.filter((fx) => !nextFx.some((added) => added.id === fx.id)));
        }, 1100);
        return () => window.clearTimeout(timeout);
    };
    useEffect(() => {
        if (!session) return;
        const seq = session.fxSeq;
        if (seq != null) {
            const last = lastFxSeqRef.current;
            // A baseline set by an earlier frame (fallback pre-damage, or a prior
            // server batch) means we've been watching this fight from the start —
            // so the first server batch is a REAL hit to render. No baseline yet +
            // no prior seq = a cold mount / spectator join straight into an
            // already-progressed session; skip that batch so it isn't replayed.
            const watchedFromStart = previousPvpHpRef.current != null;
            lastFxSeqRef.current = seq;
            previousPvpHpRef.current = { p1: session.p1.hp, p2: session.p2.hp };
            if (seq === last) return;
            if (last === undefined && !watchedFromStart) return;
            const events = session.fx ?? [];
            return spawnHitFx(events.map((ev, i) => ({
                id: `${ev.target}-fx-${seq}-${i}`, fighter: ev.target, amount: ev.amount, kind: ev.kind,
            })));
        }
        // Legacy fallback for a pre-deploy in-flight session with no fxSeq: derive
        // the popup from the HP delta (the old behaviour — collapses/understates on
        // overkill, but only for sessions started before this shipped).
        const previous = previousPvpHpRef.current;
        const current = { p1: session.p1.hp, p2: session.p2.hp };
        if (!previous) { previousPvpHpRef.current = current; return; }
        const nextFx: PvpHitFx[] = [];
        (["p1", "p2"] as const).forEach((f) => {
            const delta = current[f] - previous[f];
            if (delta === 0) return;
            nextFx.push({ id: `${f}-hp-${Date.now()}-${current[f]}`, fighter: f, amount: Math.abs(delta), kind: delta < 0 ? "damage" : "heal" });
        });
        previousPvpHpRef.current = current;
        return spawnHitFx(nextFx);
    }, [session?.fxSeq, session?.p1.hp, session?.p2.hp]);

    const spawnCombatVfx = (nextFx: PvpCombatVfx[]) => {
        if (!nextFx.length) return undefined;
        setPvpCombatVfx((existing) => [...existing, ...nextFx].slice(liteFx ? -6 : -14));
        const lifetime = Math.max(...nextFx.map((fx) => fx.spec.durationMs), 900);
        const timeout = window.setTimeout(() => {
            setPvpCombatVfx((existing) => existing.filter((fx) => !nextFx.some((added) => added.id === fx.id)));
        }, lifetime + 80);
        return () => window.clearTimeout(timeout);
    };
    useEffect(() => {
        if (!session) return;
        const watchedFromStart = hasObservedVfxSessionRef.current;
        hasObservedVfxSessionRef.current = true;
        const seq = session.vfxSeq;
        if (seq == null) return;
        const last = lastVfxSeqRef.current;
        lastVfxSeqRef.current = seq;
        if (seq === last) return;
        if (last === undefined && !watchedFromStart) return;
        const events = session.vfx ?? [];
        const mapped = events.map((ev, i) => {
            const spec = safeCombatVfxSpec({
                key: ev.key,
                target: ev.anchor,
                intensity: ev.intensity,
                durationMs: ev.durationMs,
                persistent: ev.persistent,
                maxParticles: liteFx ? Math.min(4, ev.maxParticles ?? 0) : ev.maxParticles,
                tiles: ev.tiles,
            });
            return { id: `${ev.target}-vfx-${seq}-${i}`, target: ev.target, spec };
        });
        // Collapse plates that would land on the same spot. One action can stack
        // two VFX on a single fighter — a hit plus its shield/reflect reaction, a
        // weapon plus its tag effect, several DoTs ticking at once, or a movement
        // flourish plus a spend-cloud on the tile the caster just moved onto —
        // which reads as one oversized, blurry double. Key each plate by the tile
        // it actually renders on (mirroring combatVfxCenters: a fighter-anchored
        // plate resolves to that fighter's current tile), then keep only the first
        // (primary) per tile. Effects on genuinely different tiles still both show.
        return spawnCombatVfx(dedupeCombatVfx(mapped, (fx) =>
            combatVfxAnchorKey(fx.spec, fx.target === "p1" ? session.p1.pos : session.p2.pos)));
    }, [session?.vfxSeq, session?.p1.pos, session?.p2.pos]);

    // Prefight countdown — fires once when the session first loads
    // (skipped for spectators, who join mid-fight). Shows the "VS"
    // splash + coin-flip result before either player can act.
    //
    // Originally 10s to cover slow load-in + read-the-coin-flip time.
    // With the seedSession path (attacker renders the grid on first
    // paint, no GET) and the Realtime challenge push (defender lands
    // on pvpBattle within ~30-80ms of the attack POST), both players
    // are visually ready essentially at session-create time. 5s is
    // ample to read "X goes first!" and gives a noticeably snappier
    // start without sacrificing readability.
    useEffect(() => {
        if (!session || pvpSessionFirstLoadRef.current) return;
        pvpSessionFirstLoadRef.current = true;
        if (amSpectator) return;
        setPvpPrefightFirstActor(session.activePlayer);
        let count = 5;
        setPvpPrefightCountdown(count);
        const iv = setInterval(() => {
            count -= 1;
            setPvpPrefightCountdown(count > 0 ? count : null);
            if (count <= 0) clearInterval(iv);
        }, 1000);
        return () => clearInterval(iv);
    }, [!!session]);

    async function claimResolvedPvpReward(): Promise<void> {
        const resolvedSession = session;
        if (resolvedSession?.status !== "done" || pvpRewardRef.current) return;
        const roleFighter = role === "p1" ? resolvedSession.p1 : resolvedSession.p2;
        const isParticipant = roleFighter.name.trim().toLowerCase() === character.name.trim().toLowerCase();
        const iWonNow = isParticipant && ((resolvedSession.winner === "p1" && role === "p1")
            || (resolvedSession.winner === "p2" && role === "p2"));
        const iLostNow = isParticipant && !!resolvedSession.winner && resolvedSession.winner !== "draw" && !iWonNow;
        const isDrawNow = resolvedSession.winner === "draw" && isParticipant;
        if (!iWonNow && !iLostNow && !isDrawNow) return;

        // This ref is an in-flight/confirmed guard only. A failed request clears
        // it so the visible Retry button can submit the exact same claim again.
        pvpRewardRef.current = true;
        setPvpRewardClaimState("claiming");
        setPvpRewardClaimError("");

        const outcome: "win" | "loss" | "draw" = isDrawNow ? "draw" : iWonNow ? "win" : "loss";
        const claimRequest = { playerName: character.name, battleId, outcome };
        let completionStorage: PvpRewardCompletionStorage | null = null;
        try { completionStorage = window.localStorage; } catch { /* private/storage-disabled browser */ }
        // Persist intent before the request. If the server commits but the
        // response is lost (abort, refresh, account-scope replacement), the
        // next authoritative alreadyClaimed response replays these callbacks.
        beginPvpRewardCompletion(completionStorage, claimRequest);
        const internalScopeIsCurrent = continuationFenceRef.current.capture();
        const isCurrentScope = () => internalScopeIsCurrent() && isAccountSessionCurrent();
        const claimAbort = new AbortController();
        rewardClaimAbortRef.current?.abort();
        rewardClaimAbortRef.current = claimAbort;
        // Keep the request bounded. This abort can race a committed server
        // receipt, which is why the durable pending marker above must precede
        // it: an alreadyClaimed retry then repairs the skipped callbacks.
        const claimTimeout = window.setTimeout(() => claimAbort.abort(), PVP_REWARD_CLAIM_TIMEOUT_MS);
        const result = await postPvpRewardClaim(fetch, claimRequest, { signal: claimAbort.signal });
        window.clearTimeout(claimTimeout);
        if (rewardClaimAbortRef.current === claimAbort) rewardClaimAbortRef.current = null;
        if (!isCurrentScope()) return;
        if (result.status === "retry") {
            pvpRewardRef.current = false;
            setPvpRewardClaimState("failed");
            setPvpRewardClaimError(result.message);
            return;
        }

        setPvpRewardNotice(isDrawNow
            ? "Draw confirmed — terminal battle effects are settled."
            : (!result.rewardAuthorized || effectiveIsSpar)
            ? "Spar complete — no progression rewards."
            : result.rating
                ? `Server-settled rating: ${result.rating.delta >= 0 ? "+" : ""}${result.rating.delta}.${result.base ? " Combat rewards credited." : ""}`
                : result.base
                    ? "Combat rewards settled by the server."
                    : "Official result verified; no generic payout for this mode.");
        const runCompletion = shouldRunPvpRewardCompletion(
            completionStorage,
            claimRequest,
            result.completionPending,
        );
        const completionAbort = new AbortController();
        rewardClaimAbortRef.current?.abort();
        rewardClaimAbortRef.current = completionAbort;
        // PER-STAGE deadline, not one budget shared by the whole phase. The
        // completion runs up to three settlement callbacks and then the ACK, each
        // its own round trip; a single 12s wall across all four turned a slow but
        // healthy mobile settle into a spurious "settlement failed". Re-arming
        // between stages keeps the liveness guarantee (nothing may hang longer
        // than PVP_REWARD_CLAIM_TIMEOUT_MS) without punishing progress.
        const completionStartedAt = Date.now();
        const armDeadline = () => window.setTimeout(
            () => completionAbort.abort(),
            settlementDeadlineMs({
                startedAt: completionStartedAt,
                now: Date.now(),
                perStageMs: PVP_REWARD_CLAIM_TIMEOUT_MS,
                ceilingMs: PVP_REWARD_COMPLETION_CEILING_MS,
            }),
        );
        let completionTimeout = armDeadline();
        const renewDeadline = () => {
            if (completionAbort.signal.aborted) return;
            window.clearTimeout(completionTimeout);
            completionTimeout = armDeadline();
        };
        const continuationContext: PvpRewardContinuationContext = {
            signal: completionAbort.signal,
            isCurrentScope,
        };
        // The parent settlement callbacks receive the abort signal but are not
        // guaranteed to honor it, and a hung one would pin "claiming" — with
        // exit disabled — forever. Race each awaited callback against the same
        // completion abort so the timeout above always lands in the catch and
        // re-enables the visible Retry path.
        const abortBarrier = new Promise<never>((_, reject) => {
            const failSettlement = () => reject(new Error("settlement-timeout"));
            if (completionAbort.signal.aborted) failSettlement();
            else completionAbort.signal.addEventListener("abort", failSettlement, { once: true });
        });
        abortBarrier.catch(() => { /* observed through the races below */ });
        const bounded = <T,>(callback: T | Promise<T> | undefined): Promise<T | undefined> =>
            Promise.race([Promise.resolve(callback), abortBarrier]).then((value) => {
                renewDeadline();
                return value;
            });
        try {
            // Always adopt an authoritative replay snapshot. Outcome callbacks
            // are awaited before completion ACK, including lost-ACK repair.
            await bounded(onRewardClaim?.(result, continuationContext));
            if (!isCurrentScope()) return;
            if (runCompletion) {
                const oppFighter = role === "p1" ? resolvedSession.p2 : resolvedSession.p1;
                const opponent = normalizeCharacter(oppFighter.character as Character);
                // Unsanctioned sessions confirm with no reward authority. Do not
                // let their callbacks mutate missions, bounties, wars, or ranking.
                if (result.rewardAuthorized || effectiveIsSpar) {
                    if (iWonNow) await bounded(onWin?.(oppFighter.name, opponent, result.rating, result.base, result, continuationContext));
                    else if (iLostNow) await bounded(onLoss?.(opponent, result.rating, result, continuationContext));
                }
                if (!isCurrentScope()) return;
                if (!effectiveIsSpar && onRecordBattle) {
                    const meFighter = role === "p1" ? resolvedSession.p1 : resolvedSession.p2;
                    const { actions, rounds } = buildActionsFromPvpLog(resolvedSession.log ?? [], meFighter.name, oppFighter.name);
                    await bounded(onRecordBattle(makeBattleEntry({
                        id: `pvp-${battleId}`,
                        ts: Number(resolvedSession.endedAt ?? Date.now()),
                        mode: effectiveBattleMode === "ranked" ? "Ranked" : "PvP",
                        opponent: oppFighter.name,
                        outcome: isDrawNow ? "draw" : iWonNow ? "win" : "loss",
                        rounds,
                        self: meFighter.name,
                        actions,
                    }), continuationContext));
                }
                if (!isCurrentScope()) return;
                completePvpRewardCompletion(completionStorage, claimRequest);
            }

            // The server keeps this exact account+battle+outcome continuation
            // pending until every Promise-returning App settlement callback has
            // completed. The shared AbortSignal fences account replacement and
            // unmount through those remote continuations as well as this ACK.
            if (result.completionPending) {
                const ack = await postPvpRewardCompletionAck(fetch, claimRequest, { signal: completionAbort.signal });
                if (!isCurrentScope()) return;
                if (ack.status === "retry") {
                    pvpRewardRef.current = false;
                    setPvpRewardClaimState("failed");
                    setPvpRewardClaimError(ack.message);
                    return;
                }
            }
            if (!isCurrentScope()) return;
            setPvpRewardClaimState("confirmed");
            onCompletionConfirmed?.();
        } catch {
            if (!isCurrentScope()) return;
            // Keep the marker for a later retry/remount if a parent completion
            // callback throws before its idempotent settlements finish.
            pvpRewardRef.current = false;
            setPvpRewardClaimState("failed");
            setPvpRewardClaimError("Battle settlement callbacks did not finish. Please retry.");
        } finally {
            window.clearTimeout(completionTimeout);
            if (rewardClaimAbortRef.current === completionAbort) rewardClaimAbortRef.current = null;
        }
    }

    // Apply completion rewards/penalties only after the authoritative claim
    // endpoint explicitly confirms success. Network/non-2xx failures leave both
    // the callback and local replay latch untouched and surface a retry control.
    useEffect(() => {
        if (session?.status !== "done") return;
        const roleFighter = role === "p1" ? session.p1 : session.p2;
        const isParticipant = roleFighter.name.trim().toLowerCase() === character.name.trim().toLowerCase();
        const iWonNow = isParticipant && ((session.winner === "p1" && role === "p1") || (session.winner === "p2" && role === "p2"));
        const iLostNow = isParticipant && !!session.winner && session.winner !== "draw" && !iWonNow;
        const isDrawNow = session.winner === "draw" && isParticipant;
        if (!iWonNow && !iLostNow && !isDrawNow) {
            // No attributable outcome (spectator, or a defensive-gap "done"
            // session with no winner). There is nothing to claim, so mark the
            // claim confirmed — the done-overlay's exit buttons are disabled
            // for participants until it is, and leaving it "idle" here made
            // them permanently dead for a winner-less session.
            setPvpRewardClaimState("confirmed");
            onCompletionConfirmed?.();
            return;
        }
        if (pvpRewardRef.current) return;
        void claimResolvedPvpReward();
    }, [session?.status, session?.winner]);

    // Auto-pass is derived only from the current authoritative snapshot. This
    // deliberately excludes target/range legality, which remains owned by the
    // board and server, but includes every deterministic paid-action gate.
    const pvpSnapshotFighter = session ? (role === "p1" ? session.p1 : session.p2) : null;
    const pvpSnapshotCooldowns = session ? (role === "p1" ? session.cooldowns.p1 : session.cooldowns.p2) : {};
    const pvpSnapshotJutsu = pvpSnapshotFighter && Array.isArray(pvpSnapshotFighter.character?.jutsu)
        ? pvpSnapshotFighter.character.jutsu as Jutsu[]
        : equippedJutsu;
    const pvpSnapshotItems = pvpSnapshotFighter && Array.isArray(pvpSnapshotFighter.character?.pvpItems)
        ? pvpSnapshotFighter.character.pvpItems as GameItem[]
        : equippedItems;
    const pvpSnapshotCharges = session
        ? (session as { itemCharges?: Record<"p1" | "p2", Record<string, number>> }).itemCharges?.[role]
        : undefined;
    const pvpHasAffordablePaidAction = Boolean(session && pvpSnapshotFighter && hasAffordablePvpPaidAction({
        statuses: pvpSnapshotFighter.statuses,
        round: session.round,
        availableAp: role === "p1" ? session.ap.p1 : session.ap.p2,
        availableChakra: pvpSnapshotFighter.chakra,
        availableStamina: pvpSnapshotFighter.stamina,
        cooldowns: pvpSnapshotCooldowns,
        actionsThisTurn: session.actionsThisTurn,
        jutsu: pvpSnapshotJutsu,
        items: pvpSnapshotItems,
        itemCharges: pvpSnapshotCharges,
        rankedItemsDisabled: realPvpItemsDisabled,
    }));
    useEffect(() => {
        if (!session || session.status === "done" || session.activePlayer !== role || submitting || pvpPrefightCountdown !== null) return;
        if (!pvpHasAffordablePaidAction) {
            const t = setTimeout(() => submitAction("wait"), 500);
            return () => clearTimeout(t);
        }
    }, [session?.status, session?.activePlayer, role, pvpHasAffordablePaidAction, submitting, pvpPrefightCountdown]);

    // Per-turn round timer — auto-passes turn at 0. The countdown itself now
    // lives in <CombatRoundTimer> (rendered below) so its 1s tick re-renders
    // only that small element instead of the whole ~120-tile board — the board
    // rebuild every second was the main cause of mobile combat stutter. This
    // effect just clears any queued auto-wait at the start of each of my turns /
    // after I act, exactly as the old timer effect did on every reset.
    const pvpIsMyTurn = session?.activePlayer === role;
    const pvpDone = session?.status === "done";
    useEffect(() => {
        setPvpPendingAutoWait(false);
    }, [!!session, pvpDone, pvpPrefightCountdown, pvpIsMyTurn, pvpRoundTimerKey]);

    // Auto-wait queue — fires the wait action whenever the queue is set AND
    // no other action is currently in flight. Re-checks on every submitting
    // change so a queued wait isn't lost when the player's last action finishes.
    useEffect(() => {
        if (!pvpPendingAutoWait) return;
        if (submitting) return;          // wait for in-flight action to finish
        if (!pvpIsMyTurn || pvpDone) {   // turn already passed or fight ended — drop the queue
            setPvpPendingAutoWait(false);
            return;
        }
        setPvpPendingAutoWait(false);
        // auto: true marks this as a timer-fired wait so the server counts it
        // toward the AFK skip counter (vs a manual Wait click).
        submitAction("wait", undefined, undefined, undefined, { auto: true });
    }, [pvpPendingAutoWait, submitting, pvpIsMyTurn, pvpDone]);

    // Auto-claim a forfeit win when the opponent goes AFK (audit #4). The
    // present fighter shouldn't have to notice and manually click "claim win" —
    // mirror the server's claim-afk-win conditions (opponent skipped 2 rounds,
    // or 90s with no contact for the crashed-tab case) and submit it
    // automatically, so an abandoned fight resolves by attrition on its own. The
    // server re-validates the exact same gate, so a slightly-early client fire is
    // harmlessly rejected and simply retried on the next poll. Only the WAITING
    // fighter fires this (never a spectator, never on my own turn).
    useEffect(() => {
        if (!session || session.status === "done" || pvpPrefightCountdown !== null) return;
        const myName = character.name.trim().toLowerCase();
        const amFighter = myName === session.p1.name.trim().toLowerCase()
            || myName === session.p2.name.trim().toLowerCase();
        if (!amFighter || session.activePlayer === role || submitting) return;
        const oppRole = role === "p1" ? "p2" : "p1";
        const oppSkips = session.consecAutoWait?.[oppRole] ?? 0;
        const lastMove = Number(session.lastMoveAt ?? session.createdAt ?? 0);
        const stale = lastMove > 0 && Date.now() - lastMove >= 90_000;
        if (oppSkips < 2 && !stale) return;
        const t = setTimeout(
            () => submitAction("claim-afk-win", undefined, undefined, undefined, { allowWhenNotMyTurn: true }),
            1500,
        );
        return () => clearTimeout(t);
    }, [session?.activePlayer, session?.consecAutoWait, session?.lastMoveAt, session?.status, submitting, role, pvpPrefightCountdown]);

    /* ── Register ALL PvP fights on spectator board ── */
    useEffect(() => {
        if (!session) return;
        const fight: ArenaSpectatorFight = {
            id: `pvp-${battleId}`,
            title: `${session.p1.name} vs ${session.p2.name}`,
            mode: effectiveBattleMode === "ranked" ? "Ranked" : effectiveBattleMode === "clanWar1v1" ? "Clan War" : effectiveIsSpar ? "Spar" : "PvP",
            startedAt: Date.now(),
            fighters: [session.p1.name, session.p2.name],
            battleId,
            biome: currentBiome,
        };
        const next = [fight, ...loadArenaActiveFights().filter(f => f.id !== fight.id)];
        saveArenaActiveFights(next);
        return () => {
            unregisterLocalFight(fight.id);
            const remaining = loadArenaActiveFights().filter(f => f.id !== fight.id);
            saveArenaActiveFights(remaining);
        };
    }, [!!session, battleId]);  

    /* ── Battle chat state ── */
    type BattleChatMsg = { author: string; text: string; ts: number; role: "fighter" | "spectator" };
    const [battleChatMessages, setBattleChatMessages] = useState<BattleChatMsg[]>([]);
    const [battleChatInput, setBattleChatInput] = useState("");
    // Battle chat is free text shown to an opponent and every spectator, so it
    // carries the same guest lock as the tavern. The layout is deliberately
    // untouched — the input row stays, disabled, rather than being swapped for
    // a panel, because the combat layout matrix measures this row.
    //
    // `loading` counts as locked here: this sender appends optimistically, so
    // sending before the answer is in would leave a ghost line in the log that
    // the server rejected.
    const { locked: guestChatLocked, loading: guestChatLockLoading } = useSocialLock(character.name);
    const battleChatLocked = guestChatLocked || guestChatLockLoading;
    // Below lg (1180px) the chat renders as a fixed 220px overlay that covers
    // ~60% of a phone screen over the combat HUD, so start it COLLAPSED there;
    // on desktop (in-grid column) start it open. Players can still toggle it.
    const [battleChatVisible, setBattleChatVisible] = useState(false);
    const battleChatRef = useRef<HTMLDivElement>(null);

    /* Poll battle chat every 3s (paused when tab hidden) */
    useEffect(() => {
        if (!battleId) return;
        let active = true;
        const poll = () => {
            if (document.visibilityState === "hidden") return;
            fetch(`/api/pvp/chat?id=${encodeURIComponent(battleId)}`)
                .then(r => r.json())
                .then(msgs => { if (active && Array.isArray(msgs)) setBattleChatMessages(prev => sameListJson(prev, msgs) ? prev : msgs); })
                .catch(() => {});
        };
        poll();
        const iv = setInterval(poll, 3000);
        // Catch up immediately when the tab is refocused (the poll early-returns
        // while hidden, so without this the chat is stale for up to one interval).
        const onVisible = () => { if (document.visibilityState !== "hidden") poll(); };
        document.addEventListener("visibilitychange", onVisible);
        return () => { active = false; clearInterval(iv); document.removeEventListener("visibilitychange", onVisible); };
    }, [battleId]);

    /* Auto-scroll chat */
    useEffect(() => {
        if (battleChatRef.current) battleChatRef.current.scrollTop = battleChatRef.current.scrollHeight;
    }, [battleChatMessages]);

    function sendBattleChat() {
        const text = battleChatInput.trim();
        if (!text || !battleId) return;
        // Belt and braces: the input is disabled while locked, but this appends
        // optimistically, so never let a rejected line reach the log.
        if (battleChatLocked) return;
        setBattleChatInput("");
        const chatRole = amSpectator ? "spectator" : "fighter";
        // Optimistic local append so message shows immediately
        const optimisticMsg = { author: character.name, text, ts: Date.now(), role: chatRole as "fighter" | "spectator" };
        setBattleChatMessages(prev => [...prev, optimisticMsg]);
        fetch(`/api/pvp/chat?id=${encodeURIComponent(battleId)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ author: character.name, text, role: chatRole }),
        })
            .then(r => {
                if (!r.ok) { console.warn("[battle-chat] POST failed:", r.status); return null; }
                return r.json();
            })
            .then(msgs => { if (Array.isArray(msgs)) setBattleChatMessages(msgs); })
            .catch(err => console.warn("[battle-chat] POST error:", err));
    }

    /* ── Spectator list state ── */
    type SpectatorEntry = { name: string; joinedAt: number };
    const [spectatorList, setSpectatorList] = useState<SpectatorEntry[]>([]);

    useEffect(() => {
        if (!battleId) return;
        let active = true;
        const poll = () => {
            if (document.visibilityState === "hidden") return;
            fetch(`/api/pvp/spectate?id=${encodeURIComponent(battleId)}`)
                .then(r => r.json())
                .then(specs => { if (active && Array.isArray(specs)) setSpectatorList(prev => sameListJson(prev, specs) ? prev : specs); })
                .catch(() => {});
        };
        poll();
        const iv = setInterval(poll, 5000);
        const onVisible = () => { if (document.visibilityState !== "hidden") poll(); };
        document.addEventListener("visibilitychange", onVisible);
        return () => { active = false; clearInterval(iv); document.removeEventListener("visibilitychange", onVisible); };
    }, [battleId]);

    /* Spectator presence heartbeat. The server prunes any spectator whose last
       ping is older than 30s (STALE_MS), so without a re-ping the "Watching:"
       list silently empties mid-fight and refresh-restored spectators never
       appear at all (the Arena board POSTs 'join' only once, on entry). Re-POST
       'join' on mount + every 20s WHILE watching, paused while hidden so a
       backgrounded tab doesn't keep a phantom watcher alive. Mirrors the Arena
       join exactly; if the POST isn't authed it's a harmless swallowed no-op. */
    const amSpectatorLive = !!session
        && character.name.trim().toLowerCase() !== session.p1.name.trim().toLowerCase()
        && character.name.trim().toLowerCase() !== session.p2.name.trim().toLowerCase();
    useEffect(() => {
        if (!battleId || !amSpectatorLive) return;
        const beat = () => {
            if (document.visibilityState === "hidden") return;
            fetch(`/api/pvp/spectate?id=${encodeURIComponent(battleId)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: character.name, action: "join" }),
            }).catch(() => {});
        };
        beat();
        const iv = setInterval(beat, 20_000);
        return () => clearInterval(iv);
    }, [battleId, amSpectatorLive, character.name]);

    // Avatar travel tween — must run unconditionally (above the early return) to
    // keep hook order stable. -1 while the session is still loading.
    const p1AnimPos = useWaypointPos(session ? session.p1.pos : -1, gridWidth, gridHeight);
    const p2AnimPos = useWaypointPos(session ? session.p2.pos : -1, gridWidth, gridHeight);

    // ── Targeting-overlay tiles — hoisted above the guard for the same reason as
    //    the log memos (hooks can't follow the early return). Keyed on
    //    pendingJutsuDirect: it's the armed jutsu, ALWAYS set together with
    //    pendingJutsuId (armPendingPvpJutsu / clearPendingPvpJutsu), and a jutsu's
    //    targeting props (range/method/target/tags) are static per sealed session,
    //    so it is equivalent to the below-guard pendingJutsu for targeting.
    //    boardMyPos/boardOppPos equal the below-guard myPos/oppPos when session is
    //    non-null (the only time the board renders). The pure predicates here are
    //    the single definitions (also used below the guard). exhaustive-deps is off
    //    file-wide (line 1); render-stable grid helpers are omitted — hand-verified.
    const pvpIsMoveJutsu = (jutsu: Jutsu | null | undefined) => Boolean(jutsu?.tags?.some(tag => tagMatchesName(tag.name, "Move")));
    const pvpIsGroundTargetJutsu = (jutsu: Jutsu | null | undefined) => Boolean(jutsu && (jutsu.target === "EMPTY_GROUND" || pvpIsMoveJutsu(jutsu)));
    // Self-target = not a ground/Move jutsu AND (declares SELF or touches no
    // opponent). Mirrors api/pvp/move.ts (selfTarget / affectsOpponent).
    const pvpIsSelfTargetJutsu = (jutsu: Jutsu | null | undefined) =>
        Boolean(jutsu) && !pvpIsGroundTargetJutsu(jutsu) && (jutsu!.target === "SELF" || !pvpAffectsOpponent(jutsu!));
    const boardMyPos = session ? (role === "p1" ? session.p1.pos : session.p2.pos) : -1;
    const boardOppPos = session ? (role === "p1" ? session.p2.pos : session.p1.pos) : -1;
    const jutsuRange = pendingJutsuDirect ? Math.max(1, Number(pendingJutsuDirect.range) || 1) : 0;
    const allTiles = useMemo(() => Array.from({ length: gridWidth * gridHeight }, (_, i) => i), [gridWidth, gridHeight]);
    const pvpBarrierTiles = useMemo(
        () => session
            ? activeBarrierTilesForDisplay([...session.p1.statuses, ...session.p2.statuses], session.round, gridWidth * gridHeight)
            : new Set<number>(),
        [session?.p1.statuses, session?.p2.statuses, session?.round, gridWidth, gridHeight],
    );
    const moveAdjacentTiles = useMemo(() => new Set(selectedActionId === "move" ? pvpHexNeighbors(boardMyPos).filter(t => t !== boardOppPos && !pvpBarrierTiles.has(t)) : []), [selectedActionId, boardMyPos, boardOppPos, pvpBarrierTiles]);
    // Range glow + opponent click-target are for jutsu that reach the enemy. A
    // self/buff jutsu only ever targets the caster's own tile (selfTargetTile
    // below), so exclude it here — otherwise the enemy hex would light up and a
    // click on the enemy would fire a self-buff at the wrong tile.
    const jutsuRangeTiles = useMemo(() => new Set(pendingJutsuDirect && !pvpIsSelfTargetJutsu(pendingJutsuDirect) ? allTiles.filter(t => t !== boardMyPos && pvpDist(boardMyPos, t) <= jutsuRange) : []), [pendingJutsuDirect, boardMyPos, jutsuRange, allTiles]);
    const groundJutsuTiles = useMemo(() => new Set(pvpIsGroundTargetJutsu(pendingJutsuDirect) ? allTiles.filter(t => t !== boardMyPos && t !== boardOppPos && !pvpBarrierTiles.has(t) && pvpDist(boardMyPos, t) <= jutsuRange) : []), [pendingJutsuDirect, boardMyPos, boardOppPos, jutsuRange, allTiles, pvpBarrierTiles]);
    // Hover-reactive by design: only THIS Set recomputes as the cursor moves over a
    // ground target's range; the rest of the board stays memoized.
    const groundJutsuAffectedTiles = useMemo(() => {
        if (pendingJutsuDirect && pvpIsGroundTargetJutsu(pendingJutsuDirect) && hoveredPvpTile !== null && groundJutsuTiles.has(hoveredPvpTile)) {
            const impact = jutsuImpactPreviewTiles(pendingJutsuDirect.method, hoveredPvpTile, allTiles, pvpDist, pvpHexNeighbors);
            // A pure movement jutsu has no damage area; its hovered destination is
            // still the impact/landing marker and must stand out from reachable range.
            if (impact.size === 0) impact.add(hoveredPvpTile);
            return impact;
        }
        return new Set<number>();
    }, [pendingJutsuDirect, hoveredPvpTile, groundJutsuTiles, allTiles]);
    // Opponent-targeted area methods (especially AOE_BURST) — show their impact
    // area whenever the enemy is in range.
    const opponentJutsuAffectedTiles = useMemo(() => pendingJutsuDirect && !pvpIsGroundTargetJutsu(pendingJutsuDirect) && !pvpIsSelfTargetJutsu(pendingJutsuDirect) && jutsuRangeTiles.has(boardOppPos)
        ? jutsuImpactPreviewTiles(pendingJutsuDirect.method, boardOppPos, allTiles, pvpDist, pvpHexNeighbors, true)
        : new Set<number>(),
        [pendingJutsuDirect, boardOppPos, jutsuRangeTiles, allTiles]);

    if (!session) return (
        <CombatInstance className={`arena-bg-${currentBiome}${currentSector === 99 ? " arena-bg-deathsgate" : ""}`}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
                <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
                    <h2>PvP Battle</h2>
                    <p style={{ color: sessionLoadFailure ? "#fca5a5" : "var(--text-dim)" }}>
                        {sessionLoadFailure || "Connecting to battle session..."}
                    </p>
                    {sessionLoadFailure && (
                        <div className="menu">
                            <button type="button" onClick={() => {
                                setSessionLoadFailure("");
                                setSessionRetryKey(value => value + 1);
                            }}>Retry Connection</button>
                            {sessionExitCheck === "safe" ? (
                                <button type="button" onClick={() => exitBattle(currentSector > 0 ? "worldMap" : "village")}>Return Safely</button>
                            ) : (
                                <button type="button" disabled={sessionExitCheck === "checking"} onClick={() => void verifyPendingSessionBeforeExit()}>
                                    {sessionExitCheck === "checking" ? "Checking Battle Status..." : "Verify Exit Safety"}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </CombatInstance>
    );

    const me = role === "p1" ? session.p1 : session.p2;
    const opp = role === "p1" ? session.p2 : session.p1;
    // Spectator detection: character name doesn't match either fighter
    const amSpectator = character.name.trim().toLowerCase() !== session.p1.name.trim().toLowerCase()
        && character.name.trim().toLowerCase() !== session.p2.name.trim().toLowerCase();
    const myPos = me.pos;
    const oppPos = opp.pos;
    // Animated avatar cells (lag behind myPos/oppPos to walk the hex path).
    const myPathPos = role === "p1" ? p1AnimPos : p2AnimPos;
    const oppPathPos = role === "p1" ? p2AnimPos : p1AnimPos;
    const myAp = role === "p1" ? session.ap.p1 : session.ap.p2;
    const oppAp = role === "p1" ? session.ap.p2 : session.ap.p1;
    const myCooldowns = role === "p1" ? session.cooldowns.p1 : session.cooldowns.p2;
    const isMyTurn = amSpectator ? false : session.activePlayer === role;
    const done = session.status === "done";
    const iWon = (session.winner === "p1" && role === "p1") || (session.winner === "p2" && role === "p2");
    const isDraw = session.winner === "draw";
    // Environment comes from the SEALED session (what the server actually used
    // for terrain/weather math), not the live world props — so the displayed
    // terrain/weather always matches server-resolved damage. Ranked seals
    // 'central' / no weather; legacy sessions (pre-seal) fall back to props.
    const arenaBiome: Biome = (session.biome && terrainEffects[session.biome]) ? session.biome : currentBiome;
    const weatherSealed = session.weatherPositiveElement !== undefined || session.weatherNegativeElement !== undefined;
    const weatherPosEl = weatherSealed ? (session.weatherPositiveElement ?? "") : weatherEffects[currentWeather].positiveElement;
    const weatherNegEl = weatherSealed ? (session.weatherNegativeElement ?? "") : weatherEffects[currentWeather].negativeElement;
    const weatherName = (weatherSealed && !weatherPosEl && !weatherNegEl) ? "Clear Skies" : weatherEffects[currentWeather].name;
    const sessionEquippedJutsuRaw = Array.isArray(me.character?.jutsu)
        ? (me.character.jutsu as Jutsu[]).map((raw) => {
            // normalizeJutsu rebuilds a fixed shape and DROPS bloodlineRank, so the
            // sealed session's rank (S/A on bloodline + legacy jutsu) was lost here —
            // effectiveTagPercent then displayed capped tags at the global 30 cap
            // instead of 35/40. Re-attach the sealed rank so the inspect panel shows
            // the same percents the server actually resolves.
            const jutsu = normalizeJutsu(raw);
            return {
                ...jutsu,
                ...(raw.bloodlineRank ? { bloodlineRank: raw.bloodlineRank } : {}),
                image: jutsu.image || sharedImages['jutsu:' + jutsu.id] || "",
            };
        })
        : equippedJutsu;
    // Show my own action bar in my saved loadout order (the slot order set via
    // the Profile loadout arrows). Display-only: jutsu are still acted on by id,
    // so this never touches AP costs, targeting, or move resolution. Spectators
    // keep the session's sealed order (it isn't their loadout).
    const sessionEquippedJutsu = amSpectator
        ? sessionEquippedJutsuRaw
        : [...sessionEquippedJutsuRaw].sort((a, b) => {
            const ia = character.equippedJutsuIds.indexOf(a.id);
            const ib = character.equippedJutsuIds.indexOf(b.id);
            return (ia < 0 ? Number.MAX_SAFE_INTEGER : ia) - (ib < 0 ? Number.MAX_SAFE_INTEGER : ib);
        });
    const sessionEquippedItems = Array.isArray(me.character?.pvpItems)
        ? (me.character.pvpItems as GameItem[]).map(item => ({
            ...item,
            image: item.image || sharedImages['item:' + item.id] || "",
        }))
        : equippedItems;
    function clearPendingPvpJutsu() {
        setPendingJutsuId("");
        setPendingJutsuDirect(null);
    }

    function clearSubmittedPvpJutsu(jutsuId: string) {
        setPendingJutsuId(current => current === jutsuId ? "" : current);
        setPendingJutsuDirect(current => current?.id === jutsuId ? null : current);
    }

    function armPendingPvpJutsu(jutsu: Jutsu) {
        setPendingJutsuId(jutsu.id);
        setPendingJutsuDirect(jutsu);
    }

    const latestPendingJutsu = sessionEquippedJutsu.find(j => j.id === pendingJutsuId) ?? null;
    const pendingJutsu = latestPendingJutsu ?? pendingJutsuDirect;
    const inspectedJutsu = sessionEquippedJutsu.find(j => j.id === inspectedJutsuId) ?? null;
    // pvpIsMoveJutsu / pvpIsGroundTargetJutsu / pvpIsSelfTargetJutsu are defined
    // once above the `if (!session)` guard (targeting-overlay block) and in scope here.
    const pvpGroundEffectClass = (jutsu: Jutsu | null | undefined, tileUse: "target" | "affected") => {
        if (!jutsu) return "";
        const tagNames = new Set((jutsu.tags ?? []).map(tag => normalizeTagName(tag.name)));
        const element = jutsu.element;
        if (tileUse === "target" && tagNames.has("Move")) return " ground-effect-move";
        if (tagNames.has("Poison") || tagNames.has("Drain") || tagNames.has("Siphon")) return " ground-effect-poison";
        if (tagNames.has("Ignition") || element === "Fire") return " ground-effect-fire";
        if (tagNames.has("Stun") || tagNames.has("Lag") || tagNames.has("Overclock") || element === "Lightning") return " ground-effect-lightning";
        if (tagNames.has("Shield") || tagNames.has("Barrier") || tagNames.has("Absorb") || tagNames.has("Reflect") || tagNames.has("Decrease Damage Taken")) return " ground-effect-guard";
        if (element === "Water") return " ground-effect-water";
        if (element === "Earth") return " ground-effect-earth";
        if (element === "Wind") return " ground-effect-wind";
        return " ground-effect-force";
    };
    const pvpGroundZoneClass = (effect: PvpGroundEffectState | undefined) => {
        if (!effect) return "";
        const tagNames = new Set((effect.tags ?? []).map(tag => normalizeTagName(tag.name)));
        // A large footprint (> the 7-hex Instant-Effect zone) is an AOE_SPIRAL
        // nova — give it an extra pulsing treatment so the shockwave reads.
        const nova = (effect.tiles?.length ?? 0) >= 8 ? " ground-effect-nova" : "";
        if (tagNames.has("Poison")) return " ground-effect-poison" + nova;
        if (tagNames.has("Recoil")) return " ground-effect-fire" + nova;
        if (tagNames.has("Decrease Damage Given")) return " ground-effect-lightning" + nova;
        return " ground-effect-force" + nova;
    };

    // allTiles / jutsuRange / the range + AOE Sets are memoized once above the
    // `if (!session)` guard (targeting-overlay block) and in scope here.
    // Self/buff jutsu: the affected area is the caster's own tile. When such a
    // jutsu is armed we light up that tile as the click target so every jutsu
    // uses the same arm-then-click-target flow (self / opponent / ground).
    const selfTargetTile = pendingJutsu && pvpIsSelfTargetJutsu(pendingJutsu) ? myPos : -1;
    const activeGroundEffects = session.groundEffects ?? [];
    const pvpEquippedWeapons = sessionEquippedItems.filter(item => { const s = normalizeEquipmentSlot(item.slot); return s === "hand"; });
    const pvpEquippedThrown = sessionEquippedItems.filter(item => { const s = normalizeEquipmentSlot(item.slot); return s === "thrown"; });
    const pvpEquippedConsumables = sessionEquippedItems.filter(item => { const s = normalizeEquipmentSlot(item.slot); return s === "item" || s === "potion"; });
    // Server-sealed per-fight charges for this fighter's throwables/consumables/
    // potion (api/pvp/session.ts). null = not a tracked consumable (reusable gear
    // or a legacy session) → always available; a number is the uses remaining.
    // Read via a local cast so the App.tsx PvpSessionState type (at the App.size
    // ratchet ceiling) needn't grow two fields for a display-only read.
    const myItemCharges = (session as { itemCharges?: Record<'p1' | 'p2', Record<string, number>> }).itemCharges?.[role] ?? {};
    const pvpItemChargesLeft = (id?: string): number | null => (id && id in myItemCharges) ? myItemCharges[id] : null;
    // pendingWeaponId is set by clicking either a hand weapon OR a thrown
    // weapon card (both call setPendingWeaponId). The lookup has to span
    // both lists or thrown items would have pendingWeapon === null,
    // collapsing pvpWeaponRange to 0 and hiding the range glow entirely.
    const pendingWeapon = [...pvpEquippedWeapons, ...pvpEquippedThrown].find(w => w.id === pendingWeaponId) ?? null;
    const pvpWeaponRange = pendingWeapon ? (pendingWeapon.weaponRange ?? (normalizeEquipmentSlot(pendingWeapon.slot) === "thrown" ? 4 : 1)) : 0;
    const weaponRangeTilesSet = new Set(pendingWeapon ? allTiles.filter(t => t !== myPos && pvpDist(myPos, t) <= pvpWeaponRange) : []);
    const basicAttackRangeTiles = new Set(pendingBasicAttack ? allTiles.filter(t => t !== myPos && pvpDist(myPos, t) <= 1) : []);

    const pvpActionAvailability = (
        baseAp: number,
        options: {
            chakraCost?: number;
            staminaCost?: number;
            cooldownRemaining?: number;
            element?: string;
            apModifierMode?: "stack" | "first-active";
        } = {},
    ) => combatActionAvailability({
        statuses: me.statuses,
        round: session.round,
        apModifierMode: "first-active",
        baseAp,
        availableAp: myAp,
        availableChakra: me.chakra,
        availableStamina: me.stamina,
        actionsThisTurn: session.actionsThisTurn,
        maxActions: PVP_MAX_ACTIONS,
        ...options,
    });
    const pvpAdjustedApCost = (base: number) => pvpActionAvailability(base).apCost;
    const pvpJutsuActionAvailability = (
        baseAp: number,
        options: {
            chakraCost?: number;
            staminaCost?: number;
            cooldownRemaining?: number;
            element?: string;
        } = {},
    ) => pvpActionAvailability(baseAp, { ...options, apModifierMode: "stack" });
    const pvpAdjustedJutsuApCost = (base: number) => pvpJutsuActionAvailability(base).apCost;
    const basicAttackAvailability = pvpActionAvailability(40, { staminaCost: 10 });
    const moveAvailability = pvpActionAvailability(30);
    const healAvailability = pvpActionAvailability(60, { chakraCost: 10, cooldownRemaining: myCooldowns.basicHeal ?? 0 });
    const clearAvailability = pvpActionAvailability(60, { cooldownRemaining: myCooldowns.clear ?? 0 });
    const cleanseAvailability = pvpActionAvailability(60, { cooldownRemaining: myCooldowns.cleanse ?? 0 });
    const fleeAvailability = pvpActionAvailability(100);

    async function submitAction(pvpAction: string, pvpTile?: number, pvpJutsuId?: string, pvpItem?: GameItem, opts?: { auto?: boolean; allowWhenNotMyTurn?: boolean }) {
        if (submitInFlightRef.current || done) return;
        if (!isMyTurn && !opts?.allowWhenNotMyTurn) return;
        const isCurrentScope = continuationFenceRef.current.capture();
        submitInFlightRef.current = true;
        setSubmitting(true);
        // Hard timeout on the move request. Without this a hung/stalled fetch
        // (slow server, a non-JSON error page that never finishes, a dropped
        // connection) leaves `submitting` stuck true forever — and because the
        // round-timer auto-wait is gated on `!submitting`, the turn freezes until
        // the 90s AFK claim. Aborting after 12s always clears `submitting` (via
        // finally), which re-arms the queued auto-wait so the turn advances.
        const moveAbort = new AbortController();
        const moveTimeout = setTimeout(() => moveAbort.abort(), 12000);
        try {
            // Per-move idempotency token. If this request retries (network
            // blip, double-tap), the server's recentMoveTokens check
            // short-circuits the second arrival without re-applying.
            const moveToken = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : `mt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            // Biome + weather are NOT sent here — the server intentionally
            // ignores them on every move (it would be a trust-the-client hole)
            // and reads from the sealed session instead. Sealing happens at
            // /api/pvp/session POST via pvpSessionEnvironment().
            const body: Record<string, unknown> = {
                battleId, role, action: pvpAction,
                moveToken,
            };
            if (opts?.auto) body.auto = true;
            if (pvpTile !== undefined) body.tile = pvpTile;
            if (pvpJutsuId) body.jutsuId = pvpJutsuId;
            if (pvpItem) {
                body.itemId = pvpItem.id;
                body.itemName = pvpItem.name;
                body.itemData = {
                    effectPower: pvpItem.weaponEp ?? 15,
                    type: "Bukijutsu",
                    weaponElement: pvpItem.weaponElement ?? "",
                    weaponRange: pvpItem.weaponRange ?? (normalizeEquipmentSlot(pvpItem.slot) === "thrown" ? 4 : 1),
                    ap: pvpItem.apCost ?? (pvpAction === "item" ? 35 : 40),
                    tags: pvpItem.weaponTags ?? [],
                    weaponEffect: pvpItem.weaponEffect,
                    weaponEffectValue: pvpItem.weaponEffectValue ?? 0,
                };
            }
            const res = await fetch("/api/pvp/move", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: moveAbort.signal,
            });
            if (res.ok) {
                const moveEnvelope = splitPvpMoveResponse(await res.json());
                const parsed = parsePvpSessionProjection(moveEnvelope.projection, battleId);
                if (!isCurrentScope()) return;
                if (parsed.kind === "terminal") {
                    markSessionUnavailable(parsed.message, isCurrentScope);
                    return;
                }
                if (parsed.kind !== "session") {
                    setMoveFeedback(parsed.message);
                    return;
                }
                const data = parsed.session;
                // Structured soft-reject: the action did NOT apply (still my turn,
                // session unchanged on the server). Surface the reason once — the
                // server may have also logged it (message paths), so de-dup on the
                // last line — and KEEP the pending selection so the player can
                // adjust without re-arming. Don't reset the round timer.
                if (moveEnvelope.rejected) {
                    const reason = moveEnvelope.rejected.reason;
                    setMoveFeedback(reason);
                    setSession(current => {
                        const decision = decidePvpSessionRevision(current, data);
                        if (decision === "stale" || decision === "foreign" || decision === "conflict") {
                            if (decision === "conflict") acceptRevision(current, data);
                            return current;
                        }
                        return decision === "accept" ? data : current;
                    });
                    return;
                }
                setMoveFeedback("");
                setSession(current => acceptRevision(current, data));
                // Clear only the technique this response actually applied. A
                // late response must never erase a different technique armed
                // after it was submitted.
                if (pvpAction === "jutsu" && pvpJutsuId) clearSubmittedPvpJutsu(pvpJutsuId);
                setPvpRoundTimerKey(k => k + 1);
                if (data.activePlayer !== role) {
                    clearPendingPvpJutsu(); setSelectedActionId(undefined);
                    setPendingBasicAttack(false); setPendingWeaponId("");
                }
            } else {
                // Server rejected the move (400/409/429/etc.). Previously
                // this was silently swallowed — the UI looked frozen until
                // the round timer expired. Now: surface the error in the
                // combat log while retaining the pending jutsu so the player
                // can retry or choose a different legal target.
                const errData = await res.json().catch(() => ({} as Record<string, unknown>));
                const errMsg = typeof errData?.error === "string" ? errData.error : `Server rejected move (${res.status})`;
                if (isCurrentScope()) {
                    if (res.status === 409) {
                        markSessionUnavailable("This ranked battle ended as a no-contest.", isCurrentScope);
                        return;
                    }
                    if (res.status === 404) {
                        markSessionUnavailable("The battle session is unavailable or expired.", isCurrentScope);
                        return;
                    }
                    console.warn("[pvp/move]", res.status, errMsg);
                    setMoveFeedback(errMsg);
                    setSelectedActionId(undefined);
                    setPendingBasicAttack(false);
                    setPendingWeaponId("");
                }
            }
        } catch (err) {
            // Network error or 12s timeout. Leave selections so the player can
            // retry; surface a timeout so a stalled turn doesn't look silently
            // frozen. The round-timer auto-wait re-fires once `submitting` clears.
            if (isCurrentScope() && (err as { name?: string } | null)?.name === "AbortError") {
                setMoveFeedback("Move timed out — try again or your turn will auto-pass.");
            }
        }
        finally {
            clearTimeout(moveTimeout);
            submitInFlightRef.current = false;
            if (isCurrentScope()) setSubmitting(false);
        }
    }

    function handleTileClick(tileIdx: number) {
        if (!isMyTurn || submitting || done) return;
        if (selectedActionId === "move" && moveAdjacentTiles.has(tileIdx)) {
            setSelectedActionId(undefined); submitAction("move", tileIdx); return;
        }
        if (pendingJutsuId && pendingJutsu && pvpIsSelfTargetJutsu(pendingJutsu) && tileIdx === myPos) {
            const jId = pendingJutsuId;
            submitAction("jutsu", undefined, jId); return;
        }
        if (pendingJutsuId && pendingJutsu && pvpIsGroundTargetJutsu(pendingJutsu) && groundJutsuTiles.has(tileIdx)) {
            const jId = pendingJutsuId;
            submitAction("jutsu", tileIdx, jId); return;
        }
        if (pendingJutsuId && jutsuRangeTiles.has(tileIdx) && tileIdx === oppPos) {
            const jId = pendingJutsuId;
            submitAction("jutsu", tileIdx, jId); return;
        }
        if (pendingBasicAttack && basicAttackRangeTiles.has(tileIdx) && tileIdx === oppPos) {
            setPendingBasicAttack(false);
            submitAction("basicAttack"); return;
        }
        if (pendingWeapon && weaponRangeTilesSet.has(tileIdx) && tileIdx === oppPos) {
            const w = pendingWeapon; setPendingWeaponId("");
            submitAction("weapon", tileIdx, undefined, w); return;
        }
    }

    function selectJutsu(jutsu: Jutsu) {
        if (!isMyTurn || submitting || done) return;
        setInspectedJutsuId(""); setSelectedActionId(undefined);
        setPendingBasicAttack(false); setPendingWeaponId("");
        // Uniform two-step flow for EVERY jutsu: clicking the card only ARMS it
        // and highlights the affected hexes — the cast doesn't fire until the
        // player clicks the actual target tile (handleTileClick): their own tile
        // for a self/buff jutsu, the opponent for a damage/debuff jutsu, or a
        // ground tile for an EMPTY_GROUND / Move jutsu. The self/ground/opponent
        // classification mirrors the server's targeting gate (api/pvp/move.ts via
        // the shared pvpAffectsOpponent contract), so the click always resolves to
        // what the server applies. Arming is a card highlight only — it never
        // writes to the battle log.
        armPendingPvpJutsu(jutsu);
    }

    const fallbackIcon = (j: Jutsu) =>
        j.type === "Taijutsu" ? "👊" : j.type === "Bukijutsu" ? "⚔" : j.type === "Genjutsu" ? "👁" : "🌀";
    const pvpWardKey = (fighter: { shield: number; statuses: Array<{ name: string }> }) => {
        if (fighter.shield > 0 || fighter.statuses.some(st => statusMatchesName(st, "Shield") || statusMatchesName(st, "Barrier"))) return "shield";
        if (fighter.statuses.some(st => statusMatchesName(st, "Reflect"))) return "reflect";
        if (fighter.statuses.some(st => statusMatchesName(st, "Absorb"))) return "absorb";
        return "";
    };
    const combatVfxCenters = (fx: PvpCombatVfx) => {
        const tiles = (fx.spec.tiles ?? [])
            .filter(tile => tile >= 0 && tile < gridWidth * gridHeight)
            .slice(0, liteFx ? 7 : 14);
        if (tiles.length) return tiles.map(pvpTileCenter);
        const fighter = fx.target === "p1" ? session.p1 : session.p2;
        return [pvpTileCenter(fighter.pos)];
    };
    const renderCombatVfx = (fx: PvpCombatVfx) => {
        const centers = combatVfxCenters(fx);
        const avg = centers.reduce((acc, c) => ({ x: acc.x + c.x, y: acc.y + c.y }), { x: 0, y: 0 });
        const center = { x: avg.x / centers.length, y: avg.y / centers.length };
        const asset = combatVfxAssetFor(fx.spec.key);
        const baseClass = `pvp-combat-vfx pvp-vfx-${fx.spec.key} pvp-vfx-${fx.spec.intensity} pvp-vfx-has-asset pvp-vfx-plane-${asset.plane}${liteFx ? " pvp-vfx-lite" : ""}`;
        const styleFor = (point: { x: number; y: number }, scale = 1) => ({
            left: `${point.x}px`,
            top: `${point.y}px`,
            "--vfx-duration": `${fx.spec.durationMs}ms`,
            "--vfx-scale": scale,
            "--vfx-asset-scale": asset.assetScale,
            "--vfx-asset-lift": `${asset.liftPx}px`,
            "--vfx-asset-opacity": asset.opacity,
        } as React.CSSProperties);
        return (
            <div key={fx.id} className="pvp-combat-vfx-group" aria-hidden="true">
                {centers.length > 1 && centers.map((point, idx) => (
                    <span key={`${fx.id}-tile-${idx}`} className={`${baseClass} pvp-combat-vfx-tile`} style={styleFor(point, 0.72)}>
                        <i className="pvp-vfx-ring" />
                    </span>
                ))}
                <span className={`${baseClass} pvp-combat-vfx-burst`} style={styleFor(center, fx.spec.intensity === "finisher" ? 1.45 : fx.spec.intensity === "heavy" ? 1.18 : 1)}>
                    <i className="pvp-vfx-art">
                        <img className={`pvp-vfx-asset pvp-vfx-asset-${asset.plane}`} src={asset.url} alt="" draggable={false} />
                    </i>
                    <i className="pvp-vfx-ring" />
                    <i className="pvp-vfx-core" />
                    <i className="pvp-vfx-cut" />
                    {!liteFx && <i className="pvp-vfx-sparks" />}
                </span>
            </div>
        );
    };
    const myAvatar = (me.character?.avatarImage as string) || sharedImages['avatar:' + me.name.toLowerCase()] || "";
    const oppAvatar = (opp.character?.avatarImage as string) || sharedImages['avatar:' + opp.name.toLowerCase()] || "";

    // Combat hotkey wiring for this render (read by the keydown listener above).
    combatHotkeyRef.current = {
        active: isMyTurn && !submitting && !done && !amSpectator,
        actions: {
            a: () => { if (basicAttackAvailability.affordable) { clearPendingPvpJutsu(); setPendingWeaponId(""); setSelectedActionId(undefined); setPendingBasicAttack(v => !v); } },
            m: () => { if (moveAvailability.affordable) { clearPendingPvpJutsu(); setPendingBasicAttack(false); setPendingWeaponId(""); setSelectedActionId(v => v === "move" ? undefined : "move"); } },
            h: () => { if (healAvailability.affordable) void submitAction("basicHeal"); },
            c: () => { if (clearAvailability.affordable) void submitAction("clear"); },
            x: () => { if (cleanseAvailability.affordable) void submitAction("cleanse"); },
            f: () => { if (fleeAvailability.affordable) void submitAction("flee"); },
            w: () => void submitAction("wait"),
            " ": () => void submitAction("wait"),
            escape: () => { clearPendingPvpJutsu(); setPendingBasicAttack(false); setPendingWeaponId(""); setSelectedActionId(undefined); },
        },
    };

    return (
        <ShinobiCombatShell mode="pvp" className={`pvp-battle-layout arena-bg-${arenaBiome}${currentSector === 99 ? " arena-bg-deathsgate" : ""}`}>
            {connectionState === "reconnecting" && (
                <div className="pvp-reconnecting-pill" role="status" aria-live="polite">
                    <span className="pvp-reconnecting-dot" />
                    Reconnecting…
                </div>
            )}
            {pvpPrefightCountdown !== null && (
                <div className="pvp-countdown-overlay">
                    <div className="pvp-countdown-box">
                        <div className="pvp-countdown-vs">
                            <span className="pvp-countdown-name">{me.name}</span>
                            <span className="pvp-countdown-badge">VS</span>
                            <span className="pvp-countdown-name">{opp.name}</span>
                        </div>
                        {pvpPrefightFirstActor && (
                            <div className={`pvp-coinflip-result${pvpPrefightFirstActor === role ? " coinflip-win" : " coinflip-lose"}`}>
                                {pvpPrefightFirstActor === role ? `${me.name} goes first!` : `${opp.name} goes first!`}
                            </div>
                        )}
                        <div className="pvp-countdown-number">{pvpPrefightCountdown}</div>
                        <p className="pvp-countdown-label">Battle begins in…</p>
                    </div>
                </div>
            )}
            <CombatHudLayout>
                {/* In-grid player HUD — visible on non-xl, hidden on xl via CSS */}
                <CombatSideHud
                    name={`${me.name} (You)`}
                    avatar={myAvatar || "🥷"}
                    hp={me.hp} maxHp={me.maxHp}
                    chakra={me.chakra} maxChakra={me.maxChakra}
                    stamina={me.stamina} maxStamina={me.maxStamina}
                    shield={me.shield}
                    village={(me.character?.village as string) || ""}
                    turn={session.round}
                    statuses={me.statuses}
                    isActive={isMyTurn && !done}
                    level={me.character?.level as number | undefined}
                    power={pvpEarnedPoints(me.character)}
                />

                <CombatHudMain activeTab={battleTabs.tab}>
                    <CombatHudHeader
                        title={biomeLabel(arenaBiome)}
                        subtitle={<>Round {session.round} | PvP Duel</>}
                    />

                    <CombatEnvironmentStrip>
                        <span className="twp-strip-biome">{biomeLabel(arenaBiome)}</span>
                        <span className="twp-strip-sep">·</span>
                        <span className="twp-strip-label">Terrain</span>
                        <span className="twp-strip-value">{terrainEffects[arenaBiome].description}</span>
                        {terrainEffects[arenaBiome].playerBuff && (
                            <span className="twp-buff twp-positive">🔺 {terrainEffects[arenaBiome].playerBuff}</span>
                        )}
                        <span className="twp-strip-sep">·</span>
                        <span className="twp-strip-label">Weather</span>
                        <span className="twp-strip-value">{weatherName}</span>
                        {weatherPosEl && (
                            <span className="twp-buff twp-positive">🔺 {weatherPosEl} +5%</span>
                        )}
                        {weatherNegEl && (
                            <span className="twp-buff twp-negative">🔻 {weatherNegEl} -2%</span>
                        )}
                    </CombatEnvironmentStrip>

                    <CombatApPanel>
                        <div>
                            <strong>{me.name} AP</strong>
                            <div className="hud-bar ap-display-bar"><span style={{ width: `${myAp}%` }} /></div>
                            <small>{myAp}/100 | {isMyTurn ? "Active" : "Waiting"}</small>
                        </div>
                        {isMyTurn && !done ? (
                            <CombatRoundTimer
                                active={isMyTurn && !done && pvpPrefightCountdown === null}
                                resetSignal={pvpRoundTimerKey}
                                onExpire={() => setPvpPendingAutoWait(true)}
                            />
                        ) : (
                            <div className="round-timer-display round-timer-inactive">
                                <div className="round-timer-ring">
                                    <span className="round-timer-num">—</span>
                                </div>
                                <small>{done ? "—" : `${opp.name}'s Turn`}</small>
                            </div>
                        )}
                        <div>
                            <strong>{opp.name} AP</strong>
                            <div className="hud-bar enemy-ap-display-bar"><span style={{ width: `${oppAp}%` }} /></div>
                            <small>{oppAp}/100 | {!isMyTurn ? "Active" : "Waiting"}</small>
                        </div>
                    </CombatApPanel>


                    <CombatBoardStage>
                    <div className={`hex-battlefield hex-${arenaBiome}${currentSector === 99 ? " hex-deathsgate" : ""}`}
                        ref={battlefieldCallbackRef}>
                        <div style={(() => {
                            const scaledW = GRID_LAYER_W * effectiveScale;
                            const scaledH = GRID_LAYER_H * effectiveScale;
                            const cW = boardContainerSize.w || (battlefieldRef.current?.clientWidth ?? scaledW);
                            const cH = boardContainerSize.h || (battlefieldRef.current?.clientHeight ?? scaledH);
                            return {
                                position: "absolute" as const,
                                left: `${Math.max(0, (cW - scaledW) / 2)}px`,
                                top: `${Math.max(0, (cH - scaledH) / 2)}px`,
                                width: `${scaledW}px`,
                                height: `${scaledH}px`,
                                overflow: "hidden",
                            };
                        })()}>
                            <div className="hex-grid-layer" style={{
                                position: "absolute" as const,
                                width: `${GRID_LAYER_W}px`,
                                height: `${GRID_LAYER_H}px`,
                                transform: `scale(${effectiveScale})`,
                                transformOrigin: "top left",
                                left: "0", top: "0",
                            }}>
                                {(() => {
                                    const orbForPos = (animPos: number, isOpp: boolean, imgSrc: string, altName: string, fighter: { shield: number; statuses: Array<{ name: string }> }) => {
                                        const pos = animPos >= 0 ? animPos : (isOpp ? oppPos : myPos);
                                        const row = Math.floor(pos / gridWidth);
                                        const col = pos % gridWidth;
                                        const ox = col * X_STEP + HEX_W / 2 - ORB / 2;
                                        const oy = row * Y_STEP + (col % 2 === 1 ? HEX_H / 2 : 0) + HEX_H * 0.85 - ORB;
                                        const ward = pvpWardKey(fighter);
                                        return (
                                            // Walk the hex path between cells instead of snapping (Move / Dash /
                                            // Flicker / Push / Pull / ground relocation) so units read as travelling,
                                            // not teleporting. Stable key => same DOM node => CSS transitions each
                                            // hop. Always rendered (emoji fallback when there's no avatar image) so
                                            // emoji-only fighters travel too rather than blinking tile-to-tile.
                                            <BattlefieldActor key={isOpp ? "opp-orb" : "me-orb"}
                                                side={isOpp ? "enemy" : "player"}
                                                label={altName}
                                                portrait={imgSrc}
                                                fallback={altName.slice(0, 2).toUpperCase()}
                                                style={{ position: "absolute", left: ox, top: oy, width: ORB, height: ORB, zIndex: 10, pointerEvents: "none", transition: ORB_PATH_TRANSITION }}>
                                                {ward && <span className={`pvp-guard-aura pvp-guard-${ward}`} aria-hidden="true" />}
                                            </BattlefieldActor>
                                        );
                                    };
                                    // Always-visible per-fighter HP bar floating above each orb
                                    // (shared FighterHpBadge). Same resolved pos + x/y math as the
                                    // orb so the bar sits over the token and glides with it.
                                    const hpBadgeFor = (animPos: number, isOpp: boolean, hp: number, maxHp: number) => {
                                        const pos = animPos >= 0 ? animPos : (isOpp ? oppPos : myPos);
                                        const row = Math.floor(pos / gridWidth);
                                        const col = pos % gridWidth;
                                        const bx = col * X_STEP + HEX_W / 2 - ORB / 2;
                                        const by = row * Y_STEP + (col % 2 === 1 ? HEX_H / 2 : 0) + HEX_H * 0.85 - ORB - 16;
                                        return (
                                            <FighterHpBadge
                                                key={isOpp ? "opp-hp-badge" : "me-hp-badge"}
                                                left={bx}
                                                top={by}
                                                width={ORB}
                                                hp={hp}
                                                maxHp={maxHp}
                                                side={isOpp ? "enemy" : "player"}
                                            />
                                        );
                                    };
                                    return (
                                        <>
                                            {orbForPos(myPathPos, false, myAvatar, me.name, me)}
                                            {orbForPos(oppPathPos, true, oppAvatar, opp.name, opp)}
                                            {hpBadgeFor(myPathPos, false, me.hp, me.maxHp)}
                                            {hpBadgeFor(oppPathPos, true, opp.hp, opp.maxHp)}
                                        </>
                                    );
                                })()}

                                {pvpMotionFx.map((fx) => {
                                    const from = pvpTileCenter(fx.from);
                                    const to = pvpTileCenter(fx.to);
                                    const dx = to.x - from.x;
                                    const dy = to.y - from.y;
                                    const length = Math.max(18, Math.hypot(dx, dy));
                                    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                                    const isEnemyFx = fx.fighter !== role;
                                    return (
                                        <div key={fx.id} className={`pvp-dash-fx${isEnemyFx ? " enemy-dash-fx" : ""}`} aria-hidden="true">
                                            <span
                                                className="pvp-dash-trail"
                                                style={{
                                                    left: `${from.x}px`,
                                                    top: `${from.y}px`,
                                                    width: `${length}px`,
                                                    transform: `rotate(${angle}deg)`,
                                                }}
                                            />
                                            <span
                                                className="pvp-dash-ghost"
                                                style={{
                                                    left: `${from.x - ORB / 2}px`,
                                                    top: `${from.y - ORB / 2}px`,
                                                    "--dash-x": `${dx}px`,
                                                    "--dash-y": `${dy}px`,
                                                } as React.CSSProperties}
                                            />
                                            <span
                                                className="pvp-dash-impact"
                                                style={{ left: `${to.x - 24}px`, top: `${to.y - 24}px` }}
                                            />
                                        </div>
                                    );
                                })}

                                {pvpCombatVfx.map(renderCombatVfx)}

                                {pvpHitFx.map((fx) => {
                                    const center = pvpTileCenter(fx.fighter === "p1" ? session.p1.pos : session.p2.pos);
                                    return (
                                        <span
                                            key={fx.id}
                                            className={`pvp-hit-fx pvp-hit-${fx.kind}`}
                                            style={{ left: `${center.x}px`, top: `${Math.max(center.y - ORB / 2, 16)}px` }}
                                            aria-hidden="true"
                                        >
                                            {fx.kind === "damage" ? "−" : "+"}{fx.amount}
                                        </span>
                                    );
                                })}

                                {Array.from({ length: gridHeight }).map((_, row) =>
                                    Array.from({ length: gridWidth }).map((_, col) => {
                                        const i = row * gridWidth + col;
                                        const tx = col * X_STEP;
                                        const ty = row * Y_STEP + (col % 2 === 1 ? HEX_H / 2 : 0);
                                        const isMyTile = i === myPos;
                                        const isOppTile = i === oppPos;
                                        const isBarrier = pvpBarrierTiles.has(i);
                                        const canMove = moveAdjacentTiles.has(i) ||
                                            Boolean(pendingJutsu && pvpIsMoveJutsu(pendingJutsu) && groundJutsuTiles.has(i));
                                        const isJutsuRange = !isBarrier && (jutsuRangeTiles.has(i) || weaponRangeTilesSet.has(i) || basicAttackRangeTiles.has(i));
                                        const isGroundTarget = groundJutsuTiles.has(i);
                                        const isGroundAffected = groundJutsuAffectedTiles.has(i) || opponentJutsuAffectedTiles.has(i);
                                        const activeGroundEffect = activeGroundEffects.find(effect => effect.tiles.includes(i));
                                        const isActiveGroundEffect = Boolean(activeGroundEffect);
                                        const groundEffectClass = (isGroundTarget || isGroundAffected)
                                            ? pvpGroundEffectClass(pendingJutsu, isGroundAffected ? "affected" : "target")
                                            : isActiveGroundEffect
                                                ? pvpGroundZoneClass(activeGroundEffect)
                                            : "";
                                        const isPendingTarget = (!!pendingJutsuId && i === oppPos && jutsuRangeTiles.has(i)) ||
                                            (!!pendingWeapon && i === oppPos && weaponRangeTilesSet.has(i)) ||
                                            (pendingBasicAttack && i === oppPos && basicAttackRangeTiles.has(i));
                                        const isSelfTarget = i === selfTargetTile;
                                        const tileOccupant = isBarrier ? "Barrier wall, impassable" : isMyTile ? "your position" : isOppTile ? `${opp.name} position` : "empty";
                                        const tilePurpose = isPendingTarget || isSelfTarget
                                            ? "target"
                                            : isGroundTarget
                                                ? "ground target"
                                                : canMove
                                                    ? "move target"
                                                    : isJutsuRange
                                                        ? "in range"
                                                        : null;
                                        const tileLabel = `Tile ${i + 1}, row ${row + 1}, column ${col + 1}: ${tileOccupant}${tilePurpose ? `, ${tilePurpose}` : ""}`;
                                        return (
                                            <button
                                                key={i}
                                                className={`hex-tile${isMyTile ? " hex-player" : ""}${isOppTile ? " hex-enemy" : ""}${isBarrier ? " combat-barrier-tile" : ""}${canMove ? " dash-target-tile" : ""}${isJutsuRange ? " jutsu-range-tile" : ""}${(isGroundAffected || isActiveGroundEffect) ? " ground-affected-tile" : ""}${isGroundTarget ? " ground-target-tile" : ""}${groundEffectClass}${isPendingTarget ? " jutsu-target-tile" : ""}${isSelfTarget ? " jutsu-self-target-tile" : ""}`}
                                                aria-label={tileLabel}
                                                style={{ left: `${tx}px`, top: `${ty}px`, width: `${HEX_W}px`, height: `${HEX_H}px` }}
                                                // Only a ground-target jutsu consumes hoveredPvpTile (impact
                                                // preview). Skip the setState otherwise so dragging the cursor
                                                // across the board doesn't re-render the screen per tile.
                                                onMouseEnter={() => { if (pvpIsGroundTargetJutsu(pendingJutsu)) setHoveredPvpTile(i); }}
                                                onMouseLeave={() => { if (hoveredPvpTile !== null) setHoveredPvpTile(null); }}
                                                onClick={() => handleTileClick(i)}
                                            >
                                                {isBarrier ? <span className="combat-barrier-marker" aria-hidden="true">WALL</span> : null}
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>
                    </CombatBoardStage>

                    <BattleTabBar tab={battleTabs.tab} setTab={battleTabs.setTab} unread={battleTabs.unread} />

                    {/* Action bar stays visible on the opponent's turn so the player
                        can review their kit and plan. Individual action controls use
                        the native disabled state; inspect/help controls remain usable. */}
                    {!done && !amSpectator && (
                        <CombatCommandBar style={isMyTurn ? undefined : { opacity: 0.55 }}>
                            <button className={pendingBasicAttack ? "selected-action" : ""}
                                onClick={() => { clearPendingPvpJutsu(); setPendingWeaponId(""); setSelectedActionId(undefined); setPendingBasicAttack(v => !v); }}
                                disabled={!isMyTurn || submitting || !basicAttackAvailability.affordable}>
                                <i className="cmd-icon" aria-hidden="true"><GiCrossedSwords /></i><span>Attack</span><small>{basicAttackAvailability.apCost} AP | 10 SP | R1</small>
                            </button>
                            <button className={selectedActionId === "move" ? "selected-action" : ""}
                                onClick={() => { clearPendingPvpJutsu(); setPendingBasicAttack(false); setPendingWeaponId(""); setSelectedActionId(v => v === "move" ? undefined : "move"); }}
                                disabled={!isMyTurn || submitting || !moveAvailability.affordable}>
                                <i className="cmd-icon" aria-hidden="true"><GiBootPrints /></i><span>Move</span><small>{moveAvailability.apCost} AP / tile</small>
                            </button>
                            <button onClick={() => submitAction("basicHeal")}
                                disabled={!isMyTurn || submitting || !healAvailability.affordable}>
                                <i className="cmd-icon" aria-hidden="true"><GiHealing /></i><span>Heal</span><small>{healAvailability.apCost} AP | 10 CP | CD {myCooldowns.basicHeal ?? 0}</small>
                            </button>
                            <button onClick={() => submitAction("clear")}
                                disabled={!isMyTurn || submitting || !clearAvailability.affordable}>
                                <i className="cmd-icon" aria-hidden="true"><GiMagicSwirl /></i><span>Clear</span><small>{clearAvailability.apCost} AP | CD {myCooldowns.clear ?? 0}</small>
                            </button>
                            <button onClick={() => submitAction("cleanse")}
                                disabled={!isMyTurn || submitting || !cleanseAvailability.affordable}>
                                <i className="cmd-icon" aria-hidden="true"><GiWaterDrop /></i><span>Cleanse</span><small>{cleanseAvailability.apCost} AP | CD {myCooldowns.cleanse ?? 0}</small>
                            </button>
                            <button onClick={() => submitAction("flee")} disabled={!isMyTurn || submitting || !fleeAvailability.affordable}>
                                <i className="cmd-icon" aria-hidden="true"><GiRun /></i><span>Flee</span><small>{fleeAvailability.apCost} AP | 50%</small>
                            </button>
                            <button onClick={() => submitAction("wait")} disabled={!isMyTurn || submitting}>
                                <i className="cmd-icon" aria-hidden="true"><GiSandsOfTime /></i><span>Wait</span><small>End turn</small>
                            </button>
                        </CombatCommandBar>
                    )}
                    <div className="jutsu-layout-card combat-jutsu-bar">
                        {done ? (
                            <div className="battle-ended-overlay" style={{ position: "relative", inset: "unset", background: "none" }}>
                                <div className="card battle-ended-card">
                                    <h2 className={isDraw ? "" : amSpectator ? "" : iWon ? "battle-result-win" : session.fleedBy === role ? "battle-result-fled" : "battle-result-loss"}>
                                        {isDraw ? "Draw" : amSpectator ? "Battle Over" : iWon ? "Victory" : session.fleedBy === role ? "Escaped" : "💥 Defeated"}
                                    </h2>
                                    <p style={{ color: "var(--text-dim)", fontSize: "0.9rem", margin: "0.4rem 0 0.8rem" }}>
                                        {isDraw ? "The duel ended with equal honor."
                                            : amSpectator ? `${session.winner === "p1" ? session.p1.name : session.winner === "p2" ? session.p2.name : "Nobody"} wins the duel!`
                                            : iWon ? `${me.name} wins the duel!`
                                            : session.fleedBy === role ? `${me.name} fled the battle.`
                                            : `${opp.name} wins the duel.`}
                                    </p>
                                    {!amSpectator && pvpRewardClaimState === "claiming" && (
                                        <p role="status" style={{ color: "#fcd34d", fontSize: "0.82rem", margin: "0 0 0.8rem" }}>
                                            Verifying battle settlement with the server…
                                        </p>
                                    )}
                                    {!amSpectator && pvpRewardClaimState === "failed" && (
                                        <div role="alert" style={{ margin: "0 0 0.8rem", padding: "0.65rem", border: "1px solid #f97316", borderRadius: 8, background: "rgba(124,45,18,0.25)" }}>
                                            <p style={{ color: "#fed7aa", fontSize: "0.82rem", margin: "0 0 0.55rem" }}>
                                                Battle settlement is still pending. {pvpRewardClaimError}
                                            </p>
                                            <button type="button" onClick={() => { void claimResolvedPvpReward(); }}>
                                                Retry Battle Settlement
                                            </button>
                                        </div>
                                    )}
                                    {!amSpectator && pvpRewardClaimState === "confirmed" && pvpRewardNotice && (
                                        <p style={{ color: "#ffd700", fontSize: "0.85rem", margin: "0 0 0.8rem" }}>
                                            {pvpRewardNotice}
                                        </p>
                                    )}
                                    <div className="menu">
                                        {/* Handoff to the DURABLE record. The live log above stays the
                                            low-latency source during the fight; this reads the server
                                            receipts once, on demand — we never poll them per move. */}
                                        {onViewBattleRecord && !amSpectator && (
                                            <button
                                                onClick={() => onViewBattleRecord(session.battleId)}
                                                disabled={pvpRewardClaimState !== "confirmed"}
                                            >View Full Battle Record</button>
                                        )}
                                        <button onClick={() => exitBattle("village")} disabled={!amSpectator && pvpRewardClaimState !== "confirmed"}>Return to Village</button>
                                        <button onClick={() => exitBattle("worldMap")} disabled={!amSpectator && pvpRewardClaimState !== "confirmed"}>World Map</button>
                                    </div>
                                </div>
                            </div>
                        ) : amSpectator ? (
                            <p style={{ textAlign: "center", color: "#a78bfa", padding: "0.75rem", fontSize: "0.85em", margin: 0 }}>
                                👁 Spectating — {session.activePlayer === "p1" ? session.p1.name : session.p2.name}'s turn (Round {session.round})
                            </p>
                        ) : (
                            <div style={isMyTurn ? { display: "contents" } : { opacity: 0.6 }}>
                                {/* Cast/use controls are natively disabled while waiting, but
                                     detail buttons stay interactive for planning. */}
                                {sessionEquippedJutsu.length === 0 && pvpEquippedWeapons.length === 0 && pvpEquippedThrown.length === 0 && pvpEquippedConsumables.length === 0 ? (
                                    <div className="summary-box">No equipped jutsus or items. Equip from Profile.</div>
                                ) : (
                                    <div className="combat-equipped-jutsu-grid">
                                        {/* ── Jutsu cards ── */}
                                        {sessionEquippedJutsu.map(j => {
                                            const cooldownRemaining = myCooldowns[j.id] ?? 0;
                                            const availability = pvpJutsuActionAvailability(j.ap ?? 40, {
                                                chakraCost: j.chakraCost ?? 0,
                                                staminaCost: j.staminaCost ?? 0,
                                                cooldownRemaining,
                                                element: j.element,
                                            });
                                            const onCooldown = availability.onCooldown;
                                            const isArmed = pendingJutsuId === j.id;
                                            const title = [
                                                j.name,
                                                `${availability.apCost} AP`,
                                                `Range ${j.range}`,
                                                availability.chakraCost > 0 ? `${availability.chakraCost} CP` : "",
                                                availability.staminaCost > 0 ? `${availability.staminaCost} SP` : "",
                                                availability.sealed ? "Elementally sealed" : "",
                                                onCooldown ? `CD ${cooldownRemaining}` : "",
                                            ].filter(Boolean).join(" | ");
                                            return (
                                                <div key={j.id} className={`combat-jutsu-card-wrap${isArmed ? " selected-action" : ""}`}>
                                                    {onCooldown && <span className="combat-cd-badge" title={`${cooldownRemaining} turn(s) until ready`}>{cooldownRemaining}</span>}
                                                    <button
                                                        type="button"
                                                        className={`combat-jutsu-button${isArmed ? " selected-action" : ""}${onCooldown ? " jutsu-on-cooldown" : ""}`}
                                                        title={title}
                                                        onClick={() => !onCooldown && selectJutsu(j)}
                                                        disabled={!isMyTurn || submitting || !availability.affordable}
                                                    >
                                                        <span className="combat-jutsu-thumb">
                                                            <strong className="combat-jutsu-fallback-icon">{fallbackIcon(j)}</strong>
                                                            {j.image && <img src={j.image} alt={j.name} />}
                                                        </span>
                                                        <span className="combat-jutsu-name">{j.name}</span>
                                                        {/* "CD 0" is noise on every card; an ACTIVE cooldown already
                                                            shows as the corner pip. Dropping it keeps the cost line
                                                            inside the card without truncating. */}
                                                        <CombatJutsuMeta
                                                            character={character}
                                                            jutsu={j}
                                                            statuses={me.statuses}
                                                            round={session.round}
                                                            activeCooldown={cooldownRemaining}
                                                            sealedResourceCosts={{
                                                                chakraCost: j.chakraCost ?? 0,
                                                                staminaCost: j.staminaCost ?? 0,
                                                            }}
                                                        />
                                                    </button>
                                                    <button type="button" className="combat-jutsu-help"
                                                        id={`pvp-combat-detail-trigger-jutsu-${j.id}`}
                                                        aria-haspopup="dialog"
                                                        aria-controls={`pvp-combat-detail-jutsu-${j.id}`}
                                                        aria-expanded={inspectedJutsuId === j.id}
                                                        onClick={() => {
                                                            setInspectedWeaponId("");
                                                            setInspectedJutsuId(inspectedJutsuId === j.id ? "" : j.id);
                                                        }}
                                                        title={`View ${j.name} details`}>ℹ️</button>
                                                </div>
                                            );
                                        })}

                                        {/* ── Weapon cards (green) ── */}
                                        {pvpEquippedWeapons.map(item => {
                                            const slot = normalizeEquipmentSlot(item.slot);
                                            const wRange = item.weaponRange ?? (slot === "thrown" ? 4 : 1);
                                            const isArmed = pendingWeaponId === item.id;
                                            // Named (hand) weapons honour their CD server-side — grey
                                            // out + show the remaining turns, matching the jutsu cards.
                                            const wCd = myCooldowns[item.id] ?? 0;
                                            const availability = pvpActionAvailability(item.apCost ?? 40, { cooldownRemaining: wCd });
                                            const apCost = availability.apCost;
                                            const onCooldown = availability.onCooldown;
                                            return (
                                                <div className={`combat-jutsu-card-wrap combat-item-card-wrap combat-weapon-card${isArmed ? " selected-action" : ""}${onCooldown ? " jutsu-on-cooldown" : ""}`} key={item.id}>
                                                    {onCooldown && <span className="combat-cd-badge" title={`${wCd} turn(s) until ready`}>{wCd}</span>}
                                                    <button
                                                        type="button"
                                                        className={`combat-jutsu-button combat-item-button rarity-${item.rarity}${isArmed ? " selected-action" : ""}${onCooldown ? " jutsu-on-cooldown" : ""}`}
                                                        title={onCooldown ? `${item.name} cooldown: ${wCd} turn(s)` : `${item.name} | ${apCost} AP | Range ${wRange}`}
                                                        onClick={() => { if (onCooldown) return; setInspectedJutsuId(""); setInspectedWeaponId(""); clearPendingPvpJutsu(); setSelectedActionId(undefined); setPendingBasicAttack(false); setPendingWeaponId(v => v === item.id ? "" : item.id); }}
                                                        disabled={!isMyTurn || submitting || !availability.affordable}>
                                                        <span className="combat-jutsu-thumb combat-item-thumb">
                                                            {item.image ? <img src={item.image} alt={item.name} /> : <strong>🗡</strong>}
                                                        </span>
                                                        <span className="combat-jutsu-name">{item.name}</span>
                                                        <span className="combat-jutsu-info">{apCost} AP | R{wRange}{onCooldown ? ` | CD ${wCd}` : ""}</span>
                                                    </button>
                                                    <button type="button" className="combat-jutsu-help"
                                                        id={`pvp-combat-detail-trigger-item-${item.id}`}
                                                        aria-haspopup="dialog"
                                                        aria-controls={`pvp-combat-detail-item-${item.id}`}
                                                        aria-expanded={inspectedWeaponId === item.id}
                                                        onClick={() => {
                                                            setInspectedJutsuId("");
                                                            setInspectedWeaponId(inspectedWeaponId === item.id ? "" : item.id);
                                                        }}
                                                        title={`View ${item.name} details`}>ℹ️</button>
                                                </div>
                                            );
                                        })}

                                        {/* ── Thrown weapon cards (green) ── */}
                                        {realPvpItemsDisabled
                                            && (pvpEquippedThrown.length > 0 || pvpEquippedConsumables.length > 0)
                                            && <p className="combat-action-hint">Consumables and thrown weapons are disabled for real fighters in server-authoritative PvP.</p>}
                                        {pvpEquippedThrown.map(item => {
                                            const wRange = item.weaponRange ?? 4;
                                            const isArmed = pendingWeaponId === item.id;
                                            const chargesLeft = pvpItemChargesLeft(item.id);
                                            const depleted = chargesLeft != null && chargesLeft <= 0;
                                            const countSuffix = chargesLeft != null ? ` ×${chargesLeft}` : "";
                                            // Thrown weapons also honour their CD server-side — grey
                                            // out + show the remaining turns like the jutsu cards.
                                            const wCd = myCooldowns[item.id] ?? 0;
                                            const availability = pvpActionAvailability(item.apCost ?? 40, { cooldownRemaining: wCd });
                                            const apCost = availability.apCost;
                                            const onCooldown = availability.onCooldown;
                                            return (
                                                <div className={`combat-jutsu-card-wrap combat-item-card-wrap combat-weapon-card${isArmed ? " selected-action" : ""}${onCooldown ? " jutsu-on-cooldown" : ""}`} key={item.id}>
                                                    {onCooldown && <span className="combat-cd-badge" title={`${wCd} turn(s) until ready`}>{wCd}</span>}
                                                    <button
                                                        type="button"
                                                        className={`combat-jutsu-button combat-item-button rarity-${item.rarity}${isArmed ? " selected-action" : ""}${onCooldown ? " jutsu-on-cooldown" : ""}`}
                                                        title={realPvpItemsDisabled ? "Disabled for real fighters in PvP" : depleted ? `${item.name} — none left this battle` : onCooldown ? `${item.name} cooldown: ${wCd} turn(s)` : `${item.name} | ${apCost} AP | Range ${wRange} | Thrown`}
                                                        onClick={() => { if (onCooldown || realPvpItemsDisabled) return; setInspectedJutsuId(""); setInspectedWeaponId(""); clearPendingPvpJutsu(); setSelectedActionId(undefined); setPendingBasicAttack(false); setPendingWeaponId(v => v === item.id ? "" : item.id); }}
                                                        disabled={!isMyTurn || realPvpItemsDisabled || submitting || depleted || !availability.affordable}>
                                                        <span className="combat-jutsu-thumb combat-item-thumb">
                                                            {item.image ? <img src={item.image} alt={item.name} /> : <strong>🎯</strong>}
                                                        </span>
                                                        <span className="combat-jutsu-name">{item.name}</span>
                                                        <span className="combat-jutsu-info">Thrown · {apCost} AP | R{wRange}{countSuffix}{onCooldown ? ` | CD ${wCd}` : ""}</span>
                                                    </button>
                                                    <button type="button" className="combat-jutsu-help"
                                                        id={`pvp-combat-detail-trigger-item-${item.id}`}
                                                        aria-haspopup="dialog"
                                                        aria-controls={`pvp-combat-detail-item-${item.id}`}
                                                        aria-expanded={inspectedWeaponId === item.id}
                                                        onClick={() => {
                                                            setInspectedJutsuId("");
                                                            setInspectedWeaponId(inspectedWeaponId === item.id ? "" : item.id);
                                                        }}
                                                        title={`View ${item.name} details`}>ℹ️</button>
                                                </div>
                                            );
                                        })}

                                        {/* ── Consumable cards (red) ── */}
                                        {pvpEquippedConsumables.map(item => {
                                            const chargesLeft = pvpItemChargesLeft(item.id);
                                            const depleted = chargesLeft != null && chargesLeft <= 0;
                                            const countSuffix = chargesLeft != null ? ` ×${chargesLeft}` : "";
                                            // Combat items (pills / smoke bomb) honour their CD
                                            // server-side — grey out + show the remaining turns like
                                            // the weapon cards. Restore-only potions carry no CD, so
                                            // wCd stays 0 and they never grey for this reason.
                                            const wCd = myCooldowns[item.id] ?? 0;
                                            const availability = pvpActionAvailability(item.apCost ?? 35, { cooldownRemaining: wCd });
                                            const apCost = availability.apCost;
                                            const onCooldown = availability.onCooldown;
                                            return (
                                                <div className={`combat-jutsu-card-wrap combat-item-card-wrap combat-consumable-card${onCooldown ? " jutsu-on-cooldown" : ""}`} key={item.id}>
                                                    {onCooldown && <span className="combat-cd-badge" title={`${wCd} turn(s) until ready`}>{wCd}</span>}
                                                    <button
                                                        type="button"
                                                        className={`combat-jutsu-button combat-item-button rarity-${item.rarity}${onCooldown ? " jutsu-on-cooldown" : ""}`}
                                                        title={realPvpItemsDisabled ? "Disabled for real fighters in PvP" : depleted ? `${item.name} — none left this battle` : onCooldown ? `${item.name} cooldown: ${wCd} turn(s)` : `${item.name} | ${apCost} AP | Use`}
                                                        onClick={() => { if (onCooldown || realPvpItemsDisabled) return; setInspectedJutsuId(""); clearPendingPvpJutsu(); setPendingBasicAttack(false); setPendingWeaponId(""); submitAction("item", undefined, undefined, item); }}
                                                        disabled={!isMyTurn || realPvpItemsDisabled || submitting || depleted || !availability.affordable}>
                                                        <span className="combat-jutsu-thumb combat-item-thumb">
                                                            {item.image ? <img src={item.image} alt={item.name} /> : <strong>🧪</strong>}
                                                        </span>
                                                        <span className="combat-jutsu-name">{item.name}</span>
                                                        <span className="combat-jutsu-info">{apCost} AP | Use{countSuffix}{onCooldown ? ` | CD ${wCd}` : ""}</span>
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                {inspectedWeaponId && (() => {
                                    const w = [...pvpEquippedWeapons, ...pvpEquippedThrown]
                                        .find(x => x.id === inspectedWeaponId);
                                    if (!w) return null;
                                    const slot = normalizeEquipmentSlot(w.slot);
                                    const wRange = w.weaponRange ?? (slot === "thrown" ? 4 : 1);
                                    return (
                                        <CombatDetailPortal
                                            id={`pvp-combat-detail-item-${w.id}`}
                                            labelId={`pvp-combat-detail-label-item-${w.id}`}
                                            triggerId={`pvp-combat-detail-trigger-item-${w.id}`}
                                            onClose={() => setInspectedWeaponId("")}
                                        >
                                            <div className="combat-jutsu-detail-header">
                                                <div><strong id={`pvp-combat-detail-label-item-${w.id}`}>{w.name}</strong><small>{slot === "thrown" ? "Thrown" : "Melee"}</small></div>
                                                <button type="button" data-combat-detail-close aria-label="Close combat details" onClick={() => setInspectedWeaponId("")}>x</button>
                                            </div>
                                            <div className="combat-jutsu-detail-grid">
                                                <span><strong>Type:</strong> Bukijutsu</span>
                                                <span><strong>Rarity:</strong> {w.rarity}</span>
                                                <span><strong>AP Cost:</strong> {pvpAdjustedApCost(w.apCost ?? 40)}</span>
                                                <span><strong>Range:</strong> {wRange}</span>
                                                <span><strong>Effect Power:</strong> {w.weaponEp ?? 15}</span>
                                                {w.weaponCooldown != null && w.weaponCooldown > 0 && <span><strong>Cooldown:</strong> {w.weaponCooldown} round(s)</span>}
                                                {w.weaponEffect && <span><strong>Effect:</strong> {w.weaponEffect}</span>}
                                            </div>
                                            {w.description && <p className="combat-jutsu-detail-desc">{w.description}</p>}
                                        </CombatDetailPortal>
                                    );
                                })()}
                                {inspectedJutsu && (() => {
                                    const mastery = getJutsuMastery(character, inspectedJutsu.id);
                                    const scaled = scaleJutsuByLevel(inspectedJutsu, mastery.level);
                                    return (
                                        <CombatDetailPortal
                                            id={`pvp-combat-detail-jutsu-${inspectedJutsu.id}`}
                                            labelId={`pvp-combat-detail-label-jutsu-${inspectedJutsu.id}`}
                                            triggerId={`pvp-combat-detail-trigger-jutsu-${inspectedJutsu.id}`}
                                            onClose={() => setInspectedJutsuId("")}
                                        >
                                            <div className="combat-jutsu-detail-header">
                                                <div><strong id={`pvp-combat-detail-label-jutsu-${inspectedJutsu.id}`}>{inspectedJutsu.name}</strong><small>Level {mastery.level} / {JUTSU_MAX_LEVEL}</small></div>
                                                <button type="button" data-combat-detail-close aria-label="Close combat details" onClick={() => setInspectedJutsuId("")}>x</button>
                                            </div>
                                            <div className="combat-jutsu-detail-grid">
                                                <span><strong>Type:</strong> {inspectedJutsu.type}</span>
                                                <span><strong>Element:</strong> {inspectedJutsu.element}</span>
                                                <span><strong>AP:</strong> {pvpAdjustedJutsuApCost(inspectedJutsu.ap ?? 40)}</span>
                                                <span><strong>Range:</strong> {inspectedJutsu.range}</span>
                                                <span><strong>Effect Power:</strong> {scaled.scaledEffectPower}</span>
                                                <span><strong>Cooldown:</strong> {inspectedJutsu.cooldown}</span>
                                                <span><strong>Chakra Cost:</strong> {Math.max(0, Number(inspectedJutsu.chakraCost) || 0)}</span>
                                                <span><strong>Stamina Cost:</strong> {Math.max(0, Number(inspectedJutsu.staminaCost) || 0)}</span>
                                            </div>
                                            {(() => { const t = jutsuTargetingLabel(inspectedJutsu); return <p className="combat-jutsu-detail-desc"><strong style={{ color: "var(--purple-400)" }}>🎯 {t.short}:</strong> {t.detail}</p>; })()}
                                            {inspectedJutsu.description && <p className="combat-jutsu-detail-desc">{inspectedJutsu.description}</p>}
                                            <div className="combat-jutsu-effects-list">
                                                <JutsuEffectCards jutsu={inspectedJutsu} scaledEffectPower={scaled.scaledEffectPower} masteryLevel={mastery.level} lensDiscipline={playerLensDiscipline(character)} />
                                            </div>
                                        </CombatDetailPortal>
                                    );
                                })()}
                            </div>
                        )}
                    </div>

                    <PlainCombatBattleLog
                        lines={battleLogLines}
                        turnLabel={isMyTurn ? "Your Turn" : `${opp.name}'s Turn`}
                    />

                    {/* Whose-turn banner — pinned to the board panel's bottom-right
                        corner (absolute, so it takes no grid row). Purely a readout
                        of the session's active role; it drives nothing. */}
                    {!done && (
                        <div className={`combat-turn-banner${isMyTurn ? " ctb-player" : " ctb-enemy"}`} aria-hidden="true">
                            <span className="ctb-name">{isMyTurn ? me.name : opp.name}</span>
                            <span className="ctb-suffix">'s Turn</span>
                        </div>
                    )}
                </CombatHudMain>

                {/* ── Battle chat (in-grid, between battlefield and enemy HUD) ── */}
                <div className={`battle-chat-panel battle-chat-col${battleChatVisible ? "" : " battle-chat-hidden"}`}>
                    <div className="battle-side-header">
                        <span>Chat{spectatorList.length > 0 ? ` · 👁 ${spectatorList.length}` : ""}</span>
                        <button className="battle-chat-toggle" onClick={() => setBattleChatVisible(v => !v)} title={battleChatVisible ? "Hide chat" : "Show chat"}>
                            {battleChatVisible ? "−" : "+"}
                        </button>
                    </div>
                    {battleChatVisible && (
                        <>
                            {spectatorList.length > 0 && (
                                <div className="battle-chat-spectators">
                                    <span className="battle-chat-spectator-label">Watching:</span> {spectatorList.map(s => s.name).join(", ")}
                                </div>
                            )}
                            <div className="battle-chat-messages" ref={battleChatRef}>
                                {battleChatMessages.length === 0 ? (
                                    <p className="battle-chat-empty">No messages yet.</p>
                                ) : battleChatMessages.map((msg, i) => (
                                    <div key={i} className={`battle-chat-msg ${msg.role === "fighter" ? "chat-fighter" : "chat-spectator"}`}>
                                        <strong>{msg.author}</strong>
                                        <span>{msg.text}</span>
                                    </div>
                                ))}
                            </div>
                            <form className="battle-chat-input-row" onSubmit={e => { e.preventDefault(); sendBattleChat(); }}>
                                <input
                                    type="text"
                                    value={battleChatInput}
                                    onChange={e => setBattleChatInput(e.target.value)}
                                    placeholder={battleChatLocked
                                        ? "Link a Google account to chat"
                                        : amSpectator ? "Chat as spectator…" : "Type a message…"}
                                    maxLength={200}
                                    disabled={battleChatLocked}
                                />
                                <button type="submit" disabled={battleChatLocked || !battleChatInput.trim()}>Send</button>
                            </form>
                        </>
                    )}
                </div>

                <CombatSideHud
                    name={opp.name}
                    avatar={oppAvatar || "EN"}
                    hp={opp.hp} maxHp={opp.maxHp}
                    chakra={opp.chakra} maxChakra={opp.maxChakra}
                    stamina={opp.stamina} maxStamina={opp.maxStamina}
                    shield={opp.shield}
                    village={(opp.character?.village as string) || ""}
                    turn={session.round}
                    statuses={opp.statuses}
                    isActive={!isMyTurn && !done}
                    level={opp.character?.level as number | undefined}
                    power={pvpEarnedPoints(opp.character)}
                />
            </CombatHudLayout>

            {/* Spectator list is now shown inside the chat panel header */}
        </ShinobiCombatShell>
    );
}

type PvpMotionFx = {
    id: string;
    fighter: "p1" | "p2";
    from: number;
    to: number;
};

type PvpHitFx = {
    id: string;
    fighter: "p1" | "p2";
    amount: number;
    kind: "damage" | "heal";
};

type PvpCombatVfx = {
    id: string;
    target: "p1" | "p2";
    spec: CombatVfxSpec;
};
