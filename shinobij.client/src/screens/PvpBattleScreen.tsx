/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Biome, Screen, WeatherType } from "../types/core";
import type { Character } from "../types/character";
import type { GameItem, Jutsu } from "../types/combat";
import { JUTSU_MAX_LEVEL } from "../constants/game";
import { BattleLogLine } from "../components/BattleLogLine";
import { CombatRoundTimer } from "../components/CombatRoundTimer";
import { CombatSideHud } from "../components/CombatSideHud";
import { JutsuEffectCards } from "../components/JutsuEffectCards";
import { BattleTabBar } from "../components/BattleTabBar";
import { biomeLabel, terrainEffects, weatherEffects } from "../data/world";
import { formatJutsuResourcePercent, getJutsuMastery, scaleJutsuByLevel } from "../lib/jutsu-scaling";
import { normalizeEquipmentSlot } from "../lib/equipment";
import { minActionCost } from "../lib/combat-affordability";
import { interpolateFlavor } from "../lib/battle-log-format";
import { normalizeJutsu } from "../lib/jutsu";
import { normalizeTagName, statusMatchesName, tagMatchesName, pvpAffectsOpponent } from "../lib/tags";
import { realtimeAvailable, subscribeKvKey } from "../lib/realtime";
import { useBoardScale } from "../lib/use-board-scale";
import { useBattleTabs } from "../lib/use-battle-tabs";
import { hexLineTiles } from "../lib/hex-path";
import { prefersLiteCombatFx } from "../lib/device-tier";
import {
    normalizeCharacter,
    playerLensDiscipline,
    type PvpGroundEffectState,
    type PvpSessionState,
} from "../App";
import { loadArenaActiveFights, saveArenaActiveFights, unregisterLocalFight, type ArenaSpectatorFight } from "../lib/world-state";
import type { PvpWinBaseSummary } from "../lib/progression";

// AOE_SPIRAL ground-nova footprint radius for the aiming preview. MUST match
// SPIRAL_RADIUS in api/pvp/move.ts so the highlighted hexes equal what the
// server actually zones.
const PVP_SPIRAL_RADIUS = 2;

// Avatar travel animation. A fighter's marker steps through each hex on the line
// between its old and new cell (PATH_STEP_MS apart) and CSS-glides each hop, so
// Move / Dash / Flicker / Push / Pull read as crossing the board rather than
// teleporting. The glide is a touch longer than the step so hops overlap into a
// smooth continuous walk.
const PATH_STEP_MS = 130;
const ORB_PATH_TRANSITION = "left 180ms linear, top 180ms linear";

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

export function PvpBattleScreen({
    character,
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
}: {
    character: Character;
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
    onWin?: (opponentName: string, opponent?: Character, serverRating?: { field: string; value: number; delta: number }, serverBase?: PvpWinBaseSummary) => void;
    onLoss?: (opponent?: Character, serverRating?: { field: string; value: number; delta: number }) => void;
}) {
    // Grid constants — exact match to arena
    const gridWidth = 12;
    const gridHeight = 10;
    const HEX_W = 72;
    const HEX_H = 42;
    const X_STEP = HEX_W * 0.75;
    const Y_STEP = HEX_H * 0.92;
    const ORB = 52;
    const GRID_LAYER_W = (gridWidth - 1) * X_STEP + HEX_W;
    const GRID_LAYER_H = (gridHeight - 1) * Y_STEP + HEX_H * 1.5;

    // Lazy initializer covers the case where the parent already has the
    // seed in state at mount time (e.g. accept-challenge flow that awaits
    // the POST before navigating). The optimistic-navigation flow mounts
    // before the POST resolves, so the seedSyncRef effect below also
    // handles the seed arriving via a later re-render.
    const [session, setSession] = useState<PvpSessionState | null>(() => (
        seedSession && seedSession.battleId === battleId ? seedSession : null
    ));
    // Tracks the battleId we've already seeded so a later Realtime/move
    // update on the same fight doesn't get clobbered by a re-apply of the
    // (now-stale) initial seed.
    const seededBattleIdRef = useRef<string | null>(
        seedSession && seedSession.battleId === battleId ? battleId : null,
    );
    useEffect(() => {
        if (!seedSession || seedSession.battleId !== battleId) return;
        if (seededBattleIdRef.current === battleId) return;
        seededBattleIdRef.current = battleId;
        setSession(seedSession);
    }, [seedSession, battleId]);
    const [submitting, setSubmitting] = useState(false);
    const [selectedActionId, setSelectedActionId] = useState<"move" | undefined>(undefined);
    const [pendingJutsuId, setPendingJutsuId] = useState("");
    const [pendingJutsuDirect, setPendingJutsuDirect] = useState<Jutsu | null>(null);
    const [pendingBasicAttack, setPendingBasicAttack] = useState(false);
    const [pendingWeaponId, setPendingWeaponId] = useState("");
    const [inspectedJutsuId, setInspectedJutsuId] = useState("");
    // Mobile Actions|Battle Log tabs (+ unread badge on the log). Desktop shows both.
    const battleTabs = useBattleTabs(session?.log?.length ?? 0);
    const [inspectedWeaponId, setInspectedWeaponId] = useState("");
    const [hoveredPvpTile, setHoveredPvpTile] = useState<number | null>(null);
    // Auto-fit board scale + manual zoom — shared hook (see lib/use-board-scale).
    const { battlefieldRef, battlefieldCallbackRef, boardContainerSize, userScaleOffset, setUserScaleOffset, effectiveScale } = useBoardScale(GRID_LAYER_W, GRID_LAYER_H);
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
    const logRef = useRef<HTMLDivElement>(null);
    // Battle-log round accordion overrides (default-open = latest two rounds).
    const [logRoundOverrides, setLogRoundOverrides] = useState<Record<number, boolean>>({});
    // Latest combat-hotkey handlers, read by a stable keydown listener (below).
    // Updated each render so it never goes stale and stays a top-level hook.
    const combatHotkeyRef = useRef<{ active: boolean; actions: Record<string, () => void> } | null>(null);
    const pvpSessionFirstLoadRef = useRef(false);
    const pvpRewardRef = useRef(false);
    const previousPvpPositionsRef = useRef<{ p1: number; p2: number } | null>(null);
    // Live HP-delta floating numbers (RTX-1): make an opponent's offense legible
    // in real time instead of only as a silently-dropping HP bar.
    const [pvpHitFx, setPvpHitFx] = useState<PvpHitFx[]>([]);
    const previousPvpHpRef = useRef<{ p1: number; p2: number } | null>(null);

    // Grid helpers — exact match to arena
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

    // Board scale, zoom, and the battlefield callback-ref are now provided by
    // the shared useBoardScale hook destructured above.

    useEffect(() => {
        let active = true;
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

        // Tier 0 fetch — even with Realtime/SSE pushing changes, we
        // need an initial snapshot since subscriptions only fire on
        // NEW writes. Without this the screen would render blank
        // until the first move.
        async function fetchInitial(): Promise<PvpSessionState | null> {
            try {
                const res = await fetch(`/api/pvp/session?id=${encodeURIComponent(battleId)}`);
                if (res.ok) {
                    const data = await res.json() as PvpSessionState;
                    if (active) setSession(data);
                    return data;
                }
            } catch { /* ignore */ }
            return null;
        }

        // Long-poll fallback used when neither Realtime nor SSE is
        // available (very old browser or both failed).
        async function pollFallback() {
            while (active) {
                if (document.visibilityState === "hidden") {
                    await new Promise<void>(r => setTimeout(r, 2000));
                    continue;
                }
                try {
                    const res = await fetch(`/api/pvp/session?id=${encodeURIComponent(battleId)}`);
                    if (res.ok) {
                        const data = await res.json() as PvpSessionState;
                        setSession(data);
                        if (data.status === "done") break;
                    }
                } catch { /* ignore */ }
                await new Promise<void>(r => setTimeout(r, 1000));
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
                    if (!active) return;
                    // Any message arriving means the channel is healthy.
                    setConnectionState("connected");
                    try {
                        const data = JSON.parse((e as MessageEvent).data) as PvpSessionState;
                        setSession(data);
                    } catch { /* ignore malformed chunk */ }
                });
                es.addEventListener("open", () => {
                    if (active) setConnectionState("connected");
                });
                es.addEventListener("end", () => {
                    es?.close();
                    es = null;
                });
                es.onerror = () => {
                    es?.close();
                    es = null;
                    if (!active) return;
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
            unsubscribeRealtime = subscribeKvKey<PvpSessionState>(
                `pvp:${battleId}`,
                (next) => {
                    if (!active || fallbackStarted) return;
                    // A real push proves the channel is healthy: cancel the
                    // no-payload watchdog and clear any "reconnecting" state.
                    if (firstPayloadTimer !== null) { window.clearTimeout(firstPayloadTimer); firstPayloadTimer = null; }
                    setConnectionState("connected");
                    setSession(next);
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
        // Skip the initial GET when the parent has a matching seed —
        // checked off the seedSession prop directly (not local state)
        // because the seedSync effect that copies the seed into state
        // races with this effect on the same battleId change, and the
        // prop is the authoritative signal of "we already have it."
        // Realtime / SSE still attaches above so any move that lands
        // between session creation and mount arrives via push.
        if (!seedSession || seedSession.battleId !== battleId) {
            void fetchInitial();
        }
        // If Realtime didn't initialize (env vars missing or client
        // construct failed), fall back to SSE. We don't run both —
        // they'd both setSession with the same data, wasting cycles.
        if (!unsubscribeRealtime) {
            startStream();
        }

        return () => {
            active = false;
            if (unsubscribeRealtime) { try { unsubscribeRealtime(); } catch { /* noop */ } unsubscribeRealtime = null; }
            if (es) { try { es.close(); } catch { /* noop */ } es = null; }
            if (pollTimer !== null) { window.clearTimeout(pollTimer); pollTimer = null; }
            if (firstPayloadTimer !== null) { window.clearTimeout(firstPayloadTimer); firstPayloadTimer = null; }
        };
    }, [battleId]);

    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [session?.log?.length]);

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

    // Float a damage (red) / heal (green) number over a fighter whenever their HP
    // changes between session updates. Mirrors the motion-FX diff above: a per-HP
    // ref dedups so each transition fires exactly once, the list is capped and
    // auto-expired. Purely additive overlay — touches no combat logic.
    useEffect(() => {
        if (!session) return;
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
        if (!nextFx.length) return;
        setPvpHitFx((existing) => [...existing, ...nextFx].slice(-8));
        const timeout = window.setTimeout(() => {
            setPvpHitFx((existing) => existing.filter((fx) => !nextFx.some((added) => added.id === fx.id)));
        }, 1100);
        return () => window.clearTimeout(timeout);
    }, [session?.p1.hp, session?.p2.hp]);

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

    // Apply completion rewards/penalties once per client when the shared fight ends.
    // Refresh-resilience: the in-memory pvpRewardRef resets on every mount,
    // and a refresh while session.status === 'done' would re-fire this
    // effect and double-apply ryo / XP / monthlyPvpKills / ranked rating /
    // village-war PvP delta / sector raid damage. We gate with both
    //   • localStorage `pvp:rewarded:<battleId>` (instant, no network), and
    //   • a server-side NX flag via /api/pvp/claim-rewards (authoritative —
    //     covers cross-device refreshes and intentional localStorage clears).
    // Server-side Vanguard seals/profession XP are already idempotent via
    // _vanguard-rewards.ts; this fix covers everything the client applies.
    useEffect(() => {
        if (session?.status !== "done") return;
        const iWonNow = (session.winner === "p1" && role === "p1") || (session.winner === "p2" && role === "p2");
        const iLostNow = session.winner && session.winner !== "draw" && !iWonNow;
        if ((!iWonNow && !iLostNow) || pvpRewardRef.current) return;
        const localKey = `pvp:rewarded:${battleId}`;
        if (typeof window !== "undefined") {
            try {
                if (window.localStorage.getItem(localKey)) {
                    pvpRewardRef.current = true;
                    return;
                }
            } catch { /* private-mode localStorage can throw — fall through */ }
        }
        // Mark in-memory immediately so a fast re-render can't slip past
        // while the server claim POST is in flight.
        pvpRewardRef.current = true;
        const oppFighter = role === "p1" ? session.p2 : session.p1;
        const opponent = normalizeCharacter(oppFighter.character as Character);
        const outcome: "win" | "loss" = iWonNow ? "win" : "loss";
        (async () => {
            let alreadyClaimed = false;
            // Server-credited ranked rating (audit #7 / Stage 3). For a ranked
            // session, claim-rewards computes + persists the rating change and
            // returns it here; we forward it to onWin/onLoss so they display the
            // authoritative value rather than recomputing the delta locally.
            // Absent (casual fight, or 503/offline) → callbacks fall back to the
            // local delta, so nothing regresses during the rollout window.
            let serverRating: { field: string; value: number; delta: number } | undefined;
            // Server-credited base ryo/XP (audit #3). When present, the win
            // handler applies these authoritative (already repeat-decayed)
            // values instead of recomputing locally — so the decay sticks.
            let serverBase: PvpWinBaseSummary | undefined;
            try {
                const r = await fetch("/api/pvp/claim-rewards", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ playerName: character.name, battleId, outcome }),
                });
                if (r.ok) {
                    const data = await r.json() as { alreadyClaimed?: boolean; rating?: { field: string; value: number; delta: number }; base?: PvpWinBaseSummary };
                    alreadyClaimed = !!data.alreadyClaimed;
                    serverRating = data.rating;
                    serverBase = data.base;
                }
            } catch {
                // Network failure → treat as first claim (fail open). One
                // duplicate during an outage is better than denying a real
                // winner. localStorage still prevents re-fire on this tab.
            }
            try { window.localStorage.setItem(localKey, "1"); } catch { /* storage quota — non-fatal */ }
            if (alreadyClaimed) return;
            if (iWonNow) onWin?.(oppFighter.name, opponent, serverRating, serverBase);
            else onLoss?.(opponent, serverRating);
        })();
    }, [session?.status, session?.winner]);

    // Auto-pass when my turn starts but I can't afford the cheapest action
    const pvpMyAp = session ? (role === "p1" ? session.ap.p1 : session.ap.p2) : 100;
    useEffect(() => {
        if (!session || session.status === "done" || session.activePlayer !== role) return;
        if (pvpMyAp < pvpMinActionCost()) {
            const t = setTimeout(() => submitAction("wait"), 500);
            return () => clearTimeout(t);
        }
    }, [session?.activePlayer, pvpMyAp]);  

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
            mode: battleMode === "ranked" ? "Ranked" : battleMode === "clanWar1v1" ? "Clan War" : isSpar ? "Spar" : "PvP",
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
    // Below lg (1180px) the chat renders as a fixed 220px overlay that covers
    // ~60% of a phone screen over the combat HUD, so start it COLLAPSED there;
    // on desktop (in-grid column) start it open. Players can still toggle it.
    const [battleChatVisible, setBattleChatVisible] = useState(() => typeof window !== "undefined" ? window.innerWidth >= 1180 : true);
    const battleChatRef = useRef<HTMLDivElement>(null);

    /* Poll battle chat every 3s (paused when tab hidden) */
    useEffect(() => {
        if (!battleId) return;
        let active = true;
        const poll = () => {
            if (document.visibilityState === "hidden") return;
            fetch(`/api/pvp/chat?id=${encodeURIComponent(battleId)}`)
                .then(r => r.json())
                .then(msgs => { if (active && Array.isArray(msgs)) setBattleChatMessages(msgs); })
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
                .then(specs => { if (active && Array.isArray(specs)) setSpectatorList(specs); })
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

    if (!session) return (
        <div className={`arena-fullscreen arena-bg-${currentBiome}${currentSector === 99 ? " arena-bg-deathsgate" : ""}`}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
                <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
                    <h2>PvP Battle</h2>
                    <p style={{ color: "#94a3b8" }}>Connecting to battle session...</p>
                </div>
            </div>
        </div>
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
        ? (me.character.jutsu as Jutsu[]).map(normalizeJutsu).map(jutsu => ({
            ...jutsu,
            image: jutsu.image || sharedImages['jutsu:' + jutsu.id] || "",
        }))
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

    function armPendingPvpJutsu(jutsu: Jutsu) {
        setPendingJutsuId(jutsu.id);
        setPendingJutsuDirect(jutsu);
    }

    const latestPendingJutsu = sessionEquippedJutsu.find(j => j.id === pendingJutsuId) ?? null;
    const pendingJutsu = latestPendingJutsu ?? pendingJutsuDirect;
    const inspectedJutsu = sessionEquippedJutsu.find(j => j.id === inspectedJutsuId) ?? null;
    const pvpIsMoveJutsu = (jutsu: Jutsu | null | undefined) => Boolean(jutsu?.tags?.some(tag => tagMatchesName(tag.name, "Move")));
    const pvpIsGroundTargetJutsu = (jutsu: Jutsu | null | undefined) => Boolean(jutsu && (jutsu.target === "EMPTY_GROUND" || pvpIsMoveJutsu(jutsu)));
    // A jutsu is self-targeted (cast on the caster) when it isn't a ground/Move
    // jutsu AND it either declares SELF or touches no opponent (no damage + no
    // opponent-affecting tag). Mirrors the server's targeting gate in
    // api/pvp/move.ts (selfTarget / affectsOpponent) so a click on the caster's
    // own tile resolves to exactly what the server applies.
    const pvpIsSelfTargetJutsu = (jutsu: Jutsu | null | undefined) =>
        Boolean(jutsu) && !pvpIsGroundTargetJutsu(jutsu) && (jutsu!.target === "SELF" || !pvpAffectsOpponent(jutsu!));
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

    const allTiles = Array.from({ length: gridWidth * gridHeight }, (_, i) => i);
    const moveAdjacentTiles = new Set(selectedActionId === "move" ? pvpHexNeighbors(myPos).filter(t => t !== oppPos) : []);
    const jutsuRange = pendingJutsu ? Math.max(1, Number(pendingJutsu.range) || 1) : 0;
    // Range glow + opponent click-target are for jutsu that reach the enemy. A
    // self/buff jutsu only ever targets the caster's own tile (selfTargetTile
    // below), so exclude it here — otherwise the enemy hex would light up and a
    // click on the enemy would fire a self-buff at the wrong tile.
    const jutsuRangeTiles = new Set(pendingJutsu && !pvpIsSelfTargetJutsu(pendingJutsu) ? allTiles.filter(t => t !== myPos && pvpDist(myPos, t) <= jutsuRange) : []);
    const groundJutsuTiles = new Set(pvpIsGroundTargetJutsu(pendingJutsu) ? allTiles.filter(t => t !== myPos && t !== oppPos && pvpDist(myPos, t) <= jutsuRange) : []);
    const groundJutsuAffectedTiles = new Set(
        pendingJutsu && pvpIsGroundTargetJutsu(pendingJutsu)
            ? hoveredPvpTile !== null
                ? pendingJutsu.method === "AOE_SPIRAL"
                    ? allTiles.filter(t => pvpDist(hoveredPvpTile, t) <= PVP_SPIRAL_RADIUS)
                    : pendingJutsu.method === "INSTANT_EFFECT"
                        ? [hoveredPvpTile, ...pvpHexNeighbors(hoveredPvpTile)]
                        : pendingJutsu.method === "AOE_CIRCLE"
                            ? pvpHexNeighbors(hoveredPvpTile)
                            : [hoveredPvpTile]
                : []
            : []
    );
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

    function pvpAdjustedApCost(base: number) {
        const lag = me.statuses.find(s => statusMatchesName(s, "Lag"));
        const overclock = me.statuses.find(s => statusMatchesName(s, "Overclock"));
        let cost = base;
        if (lag) cost = Math.ceil(cost * (1 + ((lag.percent ?? 20) / 100)));
        if (overclock) cost = Math.floor(cost * (1 - ((overclock.percent ?? 20) / 100)));
        return Math.max(1, cost);
    }

    function pvpMinActionCost() {
        // Every action cost MUST flow through pvpAdjustedApCost so the
        // client's "can I afford anything?" check agrees with the server's
        // adjustedCost in api/pvp/move.ts. Under Lag (+50% AP cost), the
        // bare 40 / j.ap / i.apCost numbers don't match what the server
        // will actually charge — leading to "send move, server rejects,
        // UI looks frozen" before the round timer fires auto-wait.
        const costs = [
            pvpAdjustedApCost(30), // move / dash
            pvpAdjustedApCost(40), // basic attack
            ...sessionEquippedJutsu.map(j => pvpAdjustedApCost(j.ap ?? 40)),
            ...pvpEquippedWeapons.map(i => pvpAdjustedApCost(i.apCost ?? 40)),
            // Thrown weapons (slot 'thrown', AP 20) go through the same weapon
            // action — they were missing here, so the turn auto-passed with 20 AP
            // left even though a 20-AP throwable was still usable. Depleted
            // consumables/throwables (0 sealed charges left) are excluded so an
            // empty supply doesn't keep a dead turn alive.
            ...pvpEquippedThrown.filter(i => (pvpItemChargesLeft(i.id) ?? 1) > 0).map(i => pvpAdjustedApCost(i.apCost ?? 40)),
            ...pvpEquippedConsumables.filter(i => (pvpItemChargesLeft(i.id) ?? 1) > 0).map(i => pvpAdjustedApCost(i.apCost ?? 35)),
        ];
        // Fold via the shared reducer (lib/combat-affordability) — keep the PvE
        // twin (pveMinActionCost in Arena) in sync when adding actions.
        return minActionCost(costs);
    }

    const pvpLogRounds = (() => {
        const groups: { round: number; entries: string[] }[] = [];
        let current: { round: number; entries: string[] } | null = null;
        for (const line of session.log) {
            const m = line.match(/^--- Round (\d+) ---$/);
            if (m) {
                current = { round: parseInt(m[1]!), entries: [] };
                groups.push(current);
            } else {
                if (!current) { current = { round: 1, entries: [] }; groups.push(current); }
                current.entries.push(line);
            }
        }
        return groups;
    })();

    async function submitAction(pvpAction: string, pvpTile?: number, pvpJutsuId?: string, pvpItem?: GameItem, opts?: { auto?: boolean; allowWhenNotMyTurn?: boolean }) {
        if (submitting || done) return;
        if (!isMyTurn && !opts?.allowWhenNotMyTurn) return;
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
                const data = await res.json() as PvpSessionState;
                // Structured soft-reject: the action did NOT apply (still my turn,
                // session unchanged on the server). Surface the reason once — the
                // server may have also logged it (message paths), so de-dup on the
                // last line — and KEEP the pending selection so the player can
                // adjust without re-arming. Don't reset the round timer.
                if (data.rejected) {
                    const reason = data.rejected.reason;
                    const last = data.log[data.log.length - 1] ?? "";
                    const log = last.includes(reason) ? data.log : [...data.log, `⚠️ ${reason}`].slice(-60);
                    setSession({ ...data, log });
                    return;
                }
                setSession(data);
                setPvpRoundTimerKey(k => k + 1);
                if (data.activePlayer !== role) {
                    clearPendingPvpJutsu(); setSelectedActionId(undefined);
                    setPendingBasicAttack(false); setPendingWeaponId("");
                } else if (data.status !== "done") {
                    // Still my turn — check if I can afford anything
                    const newAp = role === "p1" ? data.ap.p1 : data.ap.p2;
                    if (newAp < pvpMinActionCost()) {
                        setTimeout(() => submitAction("wait"), 500);
                    }
                }
            } else {
                // Server rejected the move (400/409/429/etc.). Previously
                // this was silently swallowed — the UI looked frozen until
                // the round timer expired. Now: surface the error in the
                // combat log AND clear pending selections so the player
                // can pick a different action immediately.
                const errData = await res.json().catch(() => ({} as Record<string, unknown>));
                const errMsg = typeof errData?.error === "string" ? errData.error : `Server rejected move (${res.status})`;
                console.warn("[pvp/move]", res.status, errMsg);
                setSession(prev => prev ? { ...prev, log: [...prev.log, `⚠️ ${errMsg}`].slice(-60) } : prev);
                clearPendingPvpJutsu();
                setSelectedActionId(undefined);
                setPendingBasicAttack(false);
                setPendingWeaponId("");
            }
        } catch (err) {
            // Network error or 12s timeout. Leave selections so the player can
            // retry; surface a timeout so a stalled turn doesn't look silently
            // frozen. The round-timer auto-wait re-fires once `submitting` clears.
            if ((err as { name?: string } | null)?.name === "AbortError") {
                setSession(prev => prev ? { ...prev, log: [...prev.log, "⚠️ Move timed out — try again or your turn will auto-pass."].slice(-60) } : prev);
            }
        }
        finally { clearTimeout(moveTimeout); setSubmitting(false); }
    }

    function handleTileClick(tileIdx: number) {
        if (!isMyTurn || submitting || done) return;
        if (selectedActionId === "move" && moveAdjacentTiles.has(tileIdx)) {
            setSelectedActionId(undefined); submitAction("move", tileIdx); return;
        }
        if (pendingJutsuId && pendingJutsu && pvpIsSelfTargetJutsu(pendingJutsu) && tileIdx === myPos) {
            const jId = pendingJutsuId; clearPendingPvpJutsu();
            submitAction("jutsu", undefined, jId); return;
        }
        if (pendingJutsuId && pendingJutsu && pvpIsGroundTargetJutsu(pendingJutsu) && groundJutsuTiles.has(tileIdx)) {
            const jId = pendingJutsuId; clearPendingPvpJutsu();
            submitAction("jutsu", tileIdx, jId); return;
        }
        if (pendingJutsuId && jutsuRangeTiles.has(tileIdx) && tileIdx === oppPos) {
            const jId = pendingJutsuId; clearPendingPvpJutsu();
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
    const myAvatar = (me.character?.avatarImage as string) || sharedImages['avatar:' + me.name.toLowerCase()] || "";
    const oppAvatar = (opp.character?.avatarImage as string) || sharedImages['avatar:' + opp.name.toLowerCase()] || "";

    // Combat hotkey wiring for this render (read by the keydown listener above).
    combatHotkeyRef.current = {
        active: isMyTurn && !submitting && !done && !amSpectator,
        actions: {
            a: () => { clearPendingPvpJutsu(); setPendingWeaponId(""); setSelectedActionId(undefined); setPendingBasicAttack(v => !v); },
            m: () => { clearPendingPvpJutsu(); setPendingBasicAttack(false); setPendingWeaponId(""); setSelectedActionId(v => v === "move" ? undefined : "move"); },
            h: () => void submitAction("basicHeal"),
            c: () => void submitAction("clear"),
            x: () => void submitAction("cleanse"),
            f: () => void submitAction("flee"),
            w: () => void submitAction("wait"),
            " ": () => void submitAction("wait"),
            escape: () => { clearPendingPvpJutsu(); setPendingBasicAttack(false); setPendingWeaponId(""); setSelectedActionId(undefined); },
        },
    };

    return (
        <div className={`arena-fullscreen pvp-battle-layout arena-bg-${arenaBiome}${currentSector === 99 ? " arena-bg-deathsgate" : ""}`}>
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
            {/* Portal player HUD to left sidebar on xl viewport */}
            {(() => {
                const portalTarget = document.getElementById("battle-hud-portal");
                return portalTarget ? createPortal(
                    <div className="battle-hud-sidebar">
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
                        />
                    </div>,
                    portalTarget
                ) : null;
            })()}
            <div className="combat-layout">
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
                />

                <main className={`combat-main-area bt-${battleTabs.tab}`}>
                    <div className="arena-top-panel">
                        <div className="arena-title-panel">
                            <h2>{biomeLabel(arenaBiome)}</h2>
                            <p>Round {session.round} | PvP Duel</p>
                        </div>
                    </div>

                    <div className="twp-strip">
                        <span className="twp-strip-biome">{biomeLabel(arenaBiome)}</span>
                        <span className="twp-strip-sep">·</span>
                        <span className="twp-strip-label">Terrain</span>
                        <span className="twp-strip-value">{terrainEffects[arenaBiome].description}</span>
                        {terrainEffects[arenaBiome].playerBuff && (
                            <span className="twp-buff twp-positive">{terrainEffects[arenaBiome].playerBuff}</span>
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
                    </div>

                    <div className="dual-ap-panel">
                        <div>
                            <strong>{me.name} AP</strong>
                            <div className="hud-bar ap-display-bar"><span style={{ width: `${myAp}%` }} /></div>
                            <small>{myAp}/100 | {isMyTurn ? `Active: ${session.actionsThisTurn}/5` : "Waiting"}</small>
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
                    </div>

                    <div className="hex-zoom-bar">
                        <span className="hex-zoom-label">🔍</span>
                        <input type="range" className="hex-zoom-slider" min={-0.4} max={0.5} step={0.02}
                            value={userScaleOffset} onChange={e => setUserScaleOffset(Number(e.target.value))} />
                        <button className="hex-zoom-reset" onClick={() => setUserScaleOffset(0)} title="Reset zoom">↺</button>
                    </div>

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
                                    const orbForPos = (animPos: number, isOpp: boolean, imgSrc: string, altName: string) => {
                                        const pos = animPos >= 0 ? animPos : (isOpp ? oppPos : myPos);
                                        const row = Math.floor(pos / gridWidth);
                                        const col = pos % gridWidth;
                                        const ox = col * X_STEP + HEX_W / 2 - ORB / 2;
                                        const oy = row * Y_STEP + (col % 2 === 1 ? HEX_H / 2 : 0) + HEX_H * 0.85 - ORB;
                                        const isImg = imgSrc.startsWith("data:image") || imgSrc.startsWith("blob:") || imgSrc.startsWith("/api/img");
                                        return (
                                            // Walk the hex path between cells instead of snapping (Move / Dash /
                                            // Flicker / Push / Pull / ground relocation) so units read as travelling,
                                            // not teleporting. Stable key => same DOM node => CSS transitions each
                                            // hop. Always rendered (emoji fallback when there's no avatar image) so
                                            // emoji-only fighters travel too rather than blinking tile-to-tile.
                                            <div key={isOpp ? "opp-orb" : "me-orb"}
                                                className={`avatar-orb ${isOpp ? "enemy-orb" : ""}`}
                                                style={{ position: "absolute", left: ox, top: oy, width: ORB, height: ORB, zIndex: 10, pointerEvents: "none", transition: ORB_PATH_TRANSITION }}>
                                                {isImg
                                                    ? <img className="tiny-map-avatar" src={imgSrc} alt={altName} />
                                                    : <span style={{ fontSize: 28, lineHeight: 1 }} role="img" aria-label={altName}>🥷</span>}
                                            </div>
                                        );
                                    };
                                    return (
                                        <>
                                            {orbForPos(myPathPos, false, myAvatar, me.name)}
                                            {orbForPos(oppPathPos, true, oppAvatar, opp.name)}
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
                                        const canMove = moveAdjacentTiles.has(i) ||
                                            Boolean(pendingJutsu && pvpIsMoveJutsu(pendingJutsu) && groundJutsuTiles.has(i));
                                        const isJutsuRange = jutsuRangeTiles.has(i) || weaponRangeTilesSet.has(i) || basicAttackRangeTiles.has(i);
                                        const isGroundTarget = groundJutsuTiles.has(i);
                                        const isGroundAffected = groundJutsuAffectedTiles.has(i);
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
                                        return (
                                            <button
                                                key={i}
                                                className={`hex-tile${isMyTile ? " hex-player" : ""}${isOppTile ? " hex-enemy" : ""}${canMove ? " dash-target-tile" : ""}${isJutsuRange ? " jutsu-range-tile" : ""}${(isGroundAffected || isActiveGroundEffect) ? " ground-affected-tile" : ""}${isGroundTarget ? " ground-target-tile" : ""}${groundEffectClass}${isPendingTarget ? " jutsu-target-tile" : ""}${isSelfTarget ? " jutsu-self-target-tile" : ""}`}
                                                style={{ left: `${tx}px`, top: `${ty}px`, width: `${HEX_W}px`, height: `${HEX_H}px` }}
                                                onMouseEnter={() => setHoveredPvpTile(i)}
                                                onMouseLeave={() => setHoveredPvpTile(null)}
                                                onClick={() => handleTileClick(i)}
                                            />
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>

                    <BattleTabBar tab={battleTabs.tab} setTab={battleTabs.setTab} unread={battleTabs.unread} />

                    {/* Action bar stays visible on the opponent's turn (dimmed +
                        non-interactive) so the player can review their kit and plan.
                        submitAction also guards isMyTurn, so nothing can fire. */}
                    {!done && !amSpectator && (
                        <div className="basic-action-bar shinobi-command-bar" style={isMyTurn ? undefined : { opacity: 0.55, pointerEvents: "none" }}>
                            <button className={pendingBasicAttack ? "selected-action" : ""}
                                onClick={() => { clearPendingPvpJutsu(); setPendingWeaponId(""); setSelectedActionId(undefined); setPendingBasicAttack(v => !v); }}
                                disabled={submitting || myAp < 40 || me.stamina < 10}>
                                <span>Attack</span><small>40 AP | 10 SP | R1</small>
                            </button>
                            <button className={selectedActionId === "move" ? "selected-action" : ""}
                                onClick={() => { clearPendingPvpJutsu(); setPendingBasicAttack(false); setPendingWeaponId(""); setSelectedActionId(v => v === "move" ? undefined : "move"); }}
                                disabled={submitting || myAp < pvpAdjustedApCost(30)}>
                                <span>Move</span><small>{pvpAdjustedApCost(30)} AP / tile</small>
                            </button>
                            <button onClick={() => submitAction("basicHeal")}
                                disabled={submitting || (myCooldowns.basicHeal ?? 0) > 0 || me.chakra < 10 || myAp < 60}>
                                <span>Heal</span><small>60 AP | 10 CP | CD {myCooldowns.basicHeal ?? 0}</small>
                            </button>
                            <button onClick={() => submitAction("clear")}
                                disabled={submitting || (myCooldowns.clear ?? 0) > 0 || myAp < 60}>
                                <span>Clear</span><small>60 AP | CD {myCooldowns.clear ?? 0}</small>
                            </button>
                            <button onClick={() => submitAction("cleanse")}
                                disabled={submitting || (myCooldowns.cleanse ?? 0) > 0 || myAp < 60}>
                                <span>Cleanse</span><small>60 AP | CD {myCooldowns.cleanse ?? 0}</small>
                            </button>
                            <button onClick={() => submitAction("flee")} disabled={submitting || myAp < 100}>
                                <span>Flee</span><small>100 AP | 50%</small>
                            </button>
                            <button onClick={() => submitAction("wait")} disabled={submitting}>
                                <span>Wait</span><small>End turn</small>
                            </button>
                        </div>
                    )}
                    {!done && !amSpectator && !isMyTurn && (() => {
                        // Two AFK signals:
                        //  1) Opponent has skipped 2 consecutive rounds via the
                        //     45s round timer auto-firing (server-tracked).
                        //  2) No moves at all for 90s (crashed-tab fallback).
                        // Either lets us claim the win — server validates both.
                        const opponentRole: "p1" | "p2" = role === "p1" ? "p2" : "p1";
                        const oppSkips = session.consecAutoWait?.[opponentRole] ?? 0;
                        const lastMove = Number(session.lastMoveAt ?? session.createdAt);
                        const idleMs = Date.now() - lastMove;
                        const FALLBACK_MS = 90_000;
                        const canClaim = oppSkips >= 2 || idleMs >= FALLBACK_MS;
                        const fallbackSecs = Math.max(0, Math.ceil((FALLBACK_MS - idleMs) / 1000));
                        return (
                            <div className="basic-action-bar shinobi-command-bar" style={{ justifyContent: "center", flexDirection: "column", gap: 8 }}>
                                <p style={{ color: "#94a3b8", padding: "0.5rem 1rem", margin: 0 }}>
                                    {opp.name} is taking their turn...
                                </p>
                                {canClaim ? (
                                    <button
                                        onClick={() => submitAction("claim-afk-win", undefined, undefined, undefined, { allowWhenNotMyTurn: true })}
                                        disabled={submitting}
                                        style={{ background: "linear-gradient(#7c2d12, #422006)", borderColor: "#f97316", color: "#fed7aa" }}
                                    >
                                        ⏱ Claim Win (Opponent AFK)
                                    </button>
                                ) : oppSkips >= 1 ? (
                                    <p className="hint" style={{ fontSize: "0.75rem", margin: 0, color: "#fcd34d" }}>
                                        Opponent skipped {oppSkips}/2 rounds — one more for AFK forfeit
                                    </p>
                                ) : idleMs > 30_000 ? (
                                    <p className="hint" style={{ fontSize: "0.75rem", margin: 0, color: "#fcd34d" }}>
                                        AFK forfeit fallback available in {fallbackSecs}s
                                    </p>
                                ) : null}
                            </div>
                        );
                    })()}

                    <div className="jutsu-layout-card combat-jutsu-bar">
                        {done ? (
                            <div className="battle-ended-overlay" style={{ position: "relative", inset: "unset", background: "none" }}>
                                <div className="card battle-ended-card">
                                    <h2 className={isDraw ? "" : amSpectator ? "" : iWon ? "battle-result-win" : session.fleedBy === role ? "battle-result-fled" : "battle-result-loss"}>
                                        {isDraw ? "Draw" : amSpectator ? "Battle Over" : iWon ? "Victory" : session.fleedBy === role ? "Escaped" : "💥 Defeated"}
                                    </h2>
                                    <p style={{ color: "#94a3b8", fontSize: "0.9rem", margin: "0.4rem 0 0.8rem" }}>
                                        {isDraw ? "The duel ended with equal honor."
                                            : amSpectator ? `${session.winner === "p1" ? session.p1.name : session.winner === "p2" ? session.p2.name : "Nobody"} wins the duel!`
                                            : iWon ? `${me.name} wins the duel!`
                                            : session.fleedBy === role ? `${me.name} fled the battle.`
                                            : `${opp.name} wins the duel.`}
                                    </p>
                                    {!amSpectator && iWon && (() => {
                                        const deathsGate = currentSector === 99;
                                        const xp = 100 * (deathsGate ? 2 : 1);
                                        const ryo = 75 * (deathsGate ? 2 : 1);
                                        return (
                                            <p style={{ color: "#ffd700", fontSize: "0.85rem", margin: "0 0 0.8rem" }}>
                                                +{xp} XP · +{ryo} Ryo · +15 Honor Seals · +6 Aura Dust{deathsGate ? " · ?? 2× bonus!" : ""}
                                            </p>
                                        );
                                    })()}
                                    <div className="menu">
                                        <button onClick={() => setScreen("village")}>Return to Village</button>
                                        <button onClick={() => setScreen("worldMap")}>World Map</button>
                                    </div>
                                </div>
                            </div>
                        ) : amSpectator ? (
                            <p style={{ textAlign: "center", color: "#a78bfa", padding: "0.75rem", fontSize: "0.85em", margin: 0 }}>
                                👁 Spectating — {session.activePlayer === "p1" ? session.p1.name : session.p2.name}'s turn (Round {session.round})
                            </p>
                        ) : (
                            <div style={isMyTurn ? { display: "contents" } : { opacity: 0.6, pointerEvents: "none" }}>
                                {/* Action grid stays visible (dimmed + non-interactive) on the
                                     opponent's turn so the player can review jutsu / weapons /
                                     consumables / throwables and strategize. */}
                                {sessionEquippedJutsu.length === 0 && pvpEquippedWeapons.length === 0 && pvpEquippedThrown.length === 0 && pvpEquippedConsumables.length === 0 ? (
                                    <div className="summary-box">No equipped jutsus or items. Equip from Profile.</div>
                                ) : (
                                    <div className="combat-equipped-jutsu-grid">
                                        {/* ── Jutsu cards ── */}
                                        {sessionEquippedJutsu.map(j => {
                                            const onCooldown = (myCooldowns[j.id] ?? 0) > 0;
                                            const isArmed = pendingJutsuId === j.id;
                                            return (
                                                <div key={j.id} className={`combat-jutsu-card-wrap${isArmed ? " selected-action" : ""}`}>
                                                    {onCooldown && <span className="combat-cd-badge" title={`${myCooldowns[j.id]} turn(s) until ready`}>{myCooldowns[j.id]}</span>}
                                                    <button
                                                        type="button"
                                                        className={`combat-jutsu-button${isArmed ? " selected-action" : ""}${onCooldown ? " jutsu-on-cooldown" : ""}`}
                                                        title={onCooldown ? `${j.name} cooldown: ${myCooldowns[j.id]} turns` : `${j.name} | ${j.ap} AP | Range ${j.range}`}
                                                        onClick={() => !onCooldown && selectJutsu(j)}
                                                        disabled={submitting || onCooldown || myAp < (j.ap ?? 40)}
                                                    >
                                                        <span className="combat-jutsu-thumb">
                                                            {j.image ? <img src={j.image} alt={j.name} /> : <strong>{fallbackIcon(j)}</strong>}
                                                        </span>
                                                        <span className="combat-jutsu-name">{j.name}</span>
                                                        <span className="combat-jutsu-info">{j.ap} AP | R{j.range} | CD {myCooldowns[j.id] ?? 0}</span>
                                                    </button>
                                                    <button type="button" className="combat-jutsu-help"
                                                        onClick={() => setInspectedJutsuId(inspectedJutsuId === j.id ? "" : j.id)}
                                                        title={`View ${j.name} details`}>ℹ️</button>
                                                </div>
                                            );
                                        })}

                                        {/* ── Weapon cards (green) ── */}
                                        {pvpEquippedWeapons.map(item => {
                                            const slot = normalizeEquipmentSlot(item.slot);
                                            const wRange = item.weaponRange ?? (slot === "thrown" ? 4 : 1);
                                            const apCost = item.apCost ?? 40;
                                            const isArmed = pendingWeaponId === item.id;
                                            // Named (hand) weapons honour their CD server-side — grey
                                            // out + show the remaining turns, matching the jutsu cards.
                                            const wCd = myCooldowns[item.id] ?? 0;
                                            const onCooldown = wCd > 0;
                                            return (
                                                <div className={`combat-jutsu-card-wrap combat-item-card-wrap combat-weapon-card${isArmed ? " selected-action" : ""}${onCooldown ? " jutsu-on-cooldown" : ""}`} key={item.id}>
                                                    {onCooldown && <span className="combat-cd-badge" title={`${wCd} turn(s) until ready`}>{wCd}</span>}
                                                    <button
                                                        type="button"
                                                        className={`combat-jutsu-button combat-item-button rarity-${item.rarity}${isArmed ? " selected-action" : ""}${onCooldown ? " jutsu-on-cooldown" : ""}`}
                                                        title={onCooldown ? `${item.name} cooldown: ${wCd} turn(s)` : `${item.name} | ${apCost} AP | Range ${wRange}`}
                                                        onClick={() => { if (onCooldown) return; setInspectedJutsuId(""); setInspectedWeaponId(""); clearPendingPvpJutsu(); setSelectedActionId(undefined); setPendingBasicAttack(false); setPendingWeaponId(v => v === item.id ? "" : item.id); }}
                                                        disabled={submitting || myAp < apCost || onCooldown}>
                                                        <span className="combat-jutsu-thumb combat-item-thumb">
                                                            {item.image ? <img src={item.image} alt={item.name} /> : <strong>🗡</strong>}
                                                        </span>
                                                        <span className="combat-jutsu-name">{item.name}</span>
                                                        <span className="combat-jutsu-info">{apCost} AP | R{wRange}{onCooldown ? ` | CD ${wCd}` : ""}</span>
                                                    </button>
                                                    <button type="button" className="combat-jutsu-help"
                                                        onClick={() => setInspectedWeaponId(inspectedWeaponId === item.id ? "" : item.id)}
                                                        title={`View ${item.name} details`}>ℹ️</button>
                                                </div>
                                            );
                                        })}

                                        {/* ── Thrown weapon cards (green) ── */}
                                        {pvpEquippedThrown.map(item => {
                                            const wRange = item.weaponRange ?? 4;
                                            const apCost = item.apCost ?? 40;
                                            const isArmed = pendingWeaponId === item.id;
                                            const chargesLeft = pvpItemChargesLeft(item.id);
                                            const depleted = chargesLeft != null && chargesLeft <= 0;
                                            const countSuffix = chargesLeft != null ? ` ×${chargesLeft}` : "";
                                            // Thrown weapons also honour their CD server-side — grey
                                            // out + show the remaining turns like the jutsu cards.
                                            const wCd = myCooldowns[item.id] ?? 0;
                                            const onCooldown = wCd > 0;
                                            return (
                                                <div className={`combat-jutsu-card-wrap combat-item-card-wrap combat-weapon-card${isArmed ? " selected-action" : ""}${onCooldown ? " jutsu-on-cooldown" : ""}`} key={item.id}>
                                                    {onCooldown && <span className="combat-cd-badge" title={`${wCd} turn(s) until ready`}>{wCd}</span>}
                                                    <button
                                                        type="button"
                                                        className={`combat-jutsu-button combat-item-button rarity-${item.rarity}${isArmed ? " selected-action" : ""}${onCooldown ? " jutsu-on-cooldown" : ""}`}
                                                        title={depleted ? `${item.name} — none left this battle` : onCooldown ? `${item.name} cooldown: ${wCd} turn(s)` : `${item.name} | ${apCost} AP | Range ${wRange} | Thrown`}
                                                        onClick={() => { if (onCooldown) return; setInspectedJutsuId(""); setInspectedWeaponId(""); clearPendingPvpJutsu(); setSelectedActionId(undefined); setPendingBasicAttack(false); setPendingWeaponId(v => v === item.id ? "" : item.id); }}
                                                        disabled={submitting || myAp < apCost || depleted || onCooldown}>
                                                        <span className="combat-jutsu-thumb combat-item-thumb">
                                                            {item.image ? <img src={item.image} alt={item.name} /> : <strong>🎯</strong>}
                                                        </span>
                                                        <span className="combat-jutsu-name">{item.name}</span>
                                                        <span className="combat-jutsu-info">Thrown · {apCost} AP | R{wRange}{countSuffix}{onCooldown ? ` | CD ${wCd}` : ""}</span>
                                                    </button>
                                                    <button type="button" className="combat-jutsu-help"
                                                        onClick={() => setInspectedWeaponId(inspectedWeaponId === item.id ? "" : item.id)}
                                                        title={`View ${item.name} details`}>ℹ️</button>
                                                </div>
                                            );
                                        })}

                                        {/* ── Consumable cards (red) ── */}
                                        {pvpEquippedConsumables.map(item => {
                                            const apCost = item.apCost ?? 35;
                                            const chargesLeft = pvpItemChargesLeft(item.id);
                                            const depleted = chargesLeft != null && chargesLeft <= 0;
                                            const countSuffix = chargesLeft != null ? ` ×${chargesLeft}` : "";
                                            // Combat items (pills / smoke bomb) honour their CD
                                            // server-side — grey out + show the remaining turns like
                                            // the weapon cards. Restore-only potions carry no CD, so
                                            // wCd stays 0 and they never grey for this reason.
                                            const wCd = myCooldowns[item.id] ?? 0;
                                            const onCooldown = wCd > 0;
                                            return (
                                                <div className={`combat-jutsu-card-wrap combat-item-card-wrap combat-consumable-card${onCooldown ? " jutsu-on-cooldown" : ""}`} key={item.id}>
                                                    {onCooldown && <span className="combat-cd-badge" title={`${wCd} turn(s) until ready`}>{wCd}</span>}
                                                    <button
                                                        type="button"
                                                        className={`combat-jutsu-button combat-item-button rarity-${item.rarity}${onCooldown ? " jutsu-on-cooldown" : ""}`}
                                                        title={depleted ? `${item.name} — none left this battle` : onCooldown ? `${item.name} cooldown: ${wCd} turn(s)` : `${item.name} | ${apCost} AP | Use`}
                                                        onClick={() => { if (onCooldown) return; setInspectedJutsuId(""); clearPendingPvpJutsu(); setPendingBasicAttack(false); setPendingWeaponId(""); submitAction("item", undefined, undefined, item); }}
                                                        disabled={submitting || myAp < apCost || depleted || onCooldown}>
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
                                    const w = pvpEquippedWeapons.find(x => x.id === inspectedWeaponId);
                                    if (!w) return null;
                                    const slot = normalizeEquipmentSlot(w.slot);
                                    const wRange = w.weaponRange ?? (slot === "thrown" ? 4 : 1);
                                    return (
                                        <div className="combat-jutsu-detail-popover">
                                            <div className="combat-jutsu-detail-header">
                                                <div><strong>{w.name}</strong><small>{slot === "thrown" ? "Thrown" : "Melee"}</small></div>
                                                <button type="button" onClick={() => setInspectedWeaponId("")}>x</button>
                                            </div>
                                            <div className="combat-jutsu-detail-grid">
                                                <span><strong>Type:</strong> Bukijutsu</span>
                                                <span><strong>Rarity:</strong> {w.rarity}</span>
                                                <span><strong>AP Cost:</strong> {w.apCost ?? 40}</span>
                                                <span><strong>Range:</strong> {wRange}</span>
                                                <span><strong>Effect Power:</strong> {w.weaponEp ?? 15}</span>
                                                {w.weaponCooldown != null && w.weaponCooldown > 0 && <span><strong>Cooldown:</strong> {w.weaponCooldown} round(s)</span>}
                                                {w.weaponEffect && <span><strong>Effect:</strong> {w.weaponEffect}</span>}
                                            </div>
                                            {w.description && <p className="combat-jutsu-detail-desc">{w.description}</p>}
                                        </div>
                                    );
                                })()}
                                {inspectedJutsu && (() => {
                                    const mastery = getJutsuMastery(character, inspectedJutsu.id);
                                    const scaled = scaleJutsuByLevel(inspectedJutsu, mastery.level);
                                    return (
                                        <div className="combat-jutsu-detail-popover">
                                            <div className="combat-jutsu-detail-header">
                                                <div><strong>{inspectedJutsu.name}</strong><small>Level {mastery.level} / {JUTSU_MAX_LEVEL}</small></div>
                                                <button type="button" onClick={() => setInspectedJutsuId("")}>x</button>
                                            </div>
                                            <div className="combat-jutsu-detail-grid">
                                                <span><strong>Type:</strong> {inspectedJutsu.type}</span>
                                                <span><strong>Element:</strong> {inspectedJutsu.element}</span>
                                                <span><strong>AP:</strong> {inspectedJutsu.ap}</span>
                                                <span><strong>Range:</strong> {inspectedJutsu.range}</span>
                                                <span><strong>Effect Power:</strong> {scaled.scaledEffectPower}</span>
                                                <span><strong>Cooldown:</strong> {inspectedJutsu.cooldown}</span>
                                                <span><strong>Chakra Cost:</strong> {formatJutsuResourcePercent(inspectedJutsu, "chakra", mastery.level)}</span>
                                                <span><strong>Stamina Cost:</strong> {formatJutsuResourcePercent(inspectedJutsu, "stamina", mastery.level)}</span>
                                            </div>
                                            {inspectedJutsu.description && <p className="combat-jutsu-detail-desc">{inspectedJutsu.description}</p>}
                                            <div className="combat-jutsu-effects-list">
                                                <JutsuEffectCards jutsu={inspectedJutsu} scaledEffectPower={scaled.scaledEffectPower} masteryLevel={mastery.level} lensDiscipline={playerLensDiscipline(character)} />
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>

                    <div ref={logRef} className="combat-text-log combat-timeline" aria-live="polite" aria-label="Battle log">
                        <div className="combat-log-header">
                            <strong>Battle Log</strong>
                            <span>{isMyTurn ? "Your Turn" : `${opp.name}'s Turn`}</span>
                        </div>
                        {session.log.length === 0 ? (
                            <p>No entries yet.</p>
                        ) : pvpLogRounds.length > 0 ? pvpLogRounds.map(group => {
                            const maxLogRound = pvpLogRounds[pvpLogRounds.length - 1]?.round ?? 0;
                            const roundOpen = logRoundOverrides[group.round] ?? (group.round >= maxLogRound - 1);
                            return (
                            <section className={`timeline-round${roundOpen ? " open" : " collapsed"}`} key={group.round}>
                                <button type="button" className="timeline-round-header timeline-round-toggle" aria-expanded={roundOpen}
                                    onClick={() => setLogRoundOverrides((prev) => ({ ...prev, [group.round]: !roundOpen }))}>
                                    <span className="timeline-round-chevron" aria-hidden="true">▾</span>
                                    <span>Round {group.round}</span>
                                    <span className="timeline-round-count">{group.entries.length}</span>
                                </button>
                                {roundOpen && (() => {
                                    let act = 0;
                                    return group.entries.map((line, i) => {
                                        // Defensive %user/%target substitution (D2): the server
                                        // already interpolates cast flavor, but any un-substituted
                                        // token (e.g. a future custom-jutsu line) would otherwise
                                        // leak a literal %target into the log. No-op when absent.
                                        const display = interpolateFlavor(line, me.name, opp.name);
                                        const trimmed = display.trim();
                                        const actorRole = display.startsWith(me.name) ? "timeline-player" : display.startsWith(opp.name) ? "timeline-enemy" : "timeline-system";
                                        const isAction = / uses /.test(trimmed);
                                        const isHeader = isAction || trimmed.endsWith(":") || display.startsWith(me.name) || display.startsWith(opp.name);
                                        if (isHeader) {
                                            if (isAction) act++;
                                            return (
                                                <p key={i} className={`timeline-entry-head ${actorRole}`}
                                                    style={{ color: display.includes("wins!") ? "#fbbf24" : undefined }}>
                                                    {isAction ? <span className="timeline-act-num" aria-hidden="true">#{act}</span> : null}{trimmed}
                                                </p>
                                            );
                                        }
                                        return <BattleLogLine line={trimmed} key={i} />;
                                    });
                                })()}
                            </section>
                            );
                        }) : session.log.map((line, i) => <BattleLogLine line={line} key={i} />)}
                    </div>
                </main>

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
                                    placeholder={amSpectator ? "Chat as spectator…" : "Type a message…"}
                                    maxLength={200}
                                />
                                <button type="submit" disabled={!battleChatInput.trim()}>Send</button>
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
                />
            </div>

            {/* Spectator list is now shown inside the chat panel header */}
        </div>
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
