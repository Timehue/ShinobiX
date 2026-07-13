/**
 * Click-to-move walking for the Hollow Gate — the sector movement feel inside
 * the dungeon. Tap a known tile and the avatar walks there step by step.
 *
 * Every step goes through the SAME moveStep the arrow keys use
 * (App.moveHollowGatePlayer), so torch drain, threat, wing seals and tile
 * events are byte-identical to manual movement — walking a 6-tile path costs
 * exactly six key presses.
 *
 * The walker is EVENT-DRIVEN, not a free-running interval: each step is
 * scheduled only after the previous step's position change actually commits
 * (the position effect below), so it can never outrun React on a slow frame.
 * A watchdog stops the walk when an issued step never lands (wall bump /
 * sealed wing / an event that swallowed the move). The walk also halts when:
 *   • a modal / intro / hidden-chamber overlay opens (blocked),
 *   • the floor changes (descend) or the run ends,
 *   • the player presses a movement key (manual input wins).
 *
 * This hook also owns the WASD / arrow-key handler (moved out of App.tsx so
 * both input styles live beside each other).
 */
import { useEffect, useRef, useState } from "react";
import { findHollowGatePath } from "../../lib/hollow-gate-path";
import type { HollowGateShrineRun } from "../../types/character";

// Pause between committed steps. The avatar overlay glides between tile
// centres at a matching speed, so movement reads as one continuous walk.
export const HOLLOW_GATE_STEP_MS = 175;
// An issued step that hasn't moved us after this long was rejected — stop.
const WALK_WATCHDOG_MS = 900;

export function useHollowGateWalk({ active, run, blocked, moveStep }: {
    active: boolean;                              // the shrine screen is up
    run: HollowGateShrineRun | null;
    blocked: boolean;                             // any overlay is eating input
    moveStep: (dx: number, dy: number) => void;   // App.moveHollowGatePlayer
}): {
    walkTo: (targetIdx: number) => void;
    stopWalk: () => void;
    walkTarget: number | null;                    // destination ring for the renderer
} {
    const [walkTarget, setWalkTarget] = useState<number | null>(null);

    // Live mirrors so timer callbacks always read fresh values without
    // re-arming on every render. Written in a passive effect (never during
    // render — the hooks purity rule) which commits before any timer fires.
    const runRef = useRef(run);
    const blockedRef = useRef(blocked);
    const moveRef = useRef(moveStep);
    useEffect(() => { runRef.current = run; blockedRef.current = blocked; moveRef.current = moveStep; });

    const pathRef = useRef<number[]>([]);
    const targetRef = useRef<number | null>(null);
    const walkFloorRef = useRef<number>(-1);      // floor the walk started on
    const stepTimerRef = useRef<number | null>(null);
    const watchdogRef = useRef<number | null>(null);

    const clearTimers = () => {
        if (stepTimerRef.current != null) { window.clearTimeout(stepTimerRef.current); stepTimerRef.current = null; }
        if (watchdogRef.current != null) { window.clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    };
    const stopWalk = () => {
        clearTimers();
        pathRef.current = [];
        targetRef.current = null;
        setWalkTarget(null);
    };
    const stopRef = useRef(stopWalk);
    useEffect(() => { stopRef.current = stopWalk; });

    // Issue the next queued step (or stop). Called immediately by walkTo and
    // then re-armed by the position-commit effect after each landed step.
    function issueNext() {
        stepTimerRef.current = null;
        const r = runRef.current;
        if (!r || blockedRef.current || targetRef.current == null || r.floor !== walkFloorRef.current) { stopRef.current(); return; }
        const pos = r.playerY * r.width + r.playerX;
        if (pos === targetRef.current) { stopRef.current(); return; }        // arrived
        let next = pathRef.current[0];
        const stale = next == null
            || Math.abs((next % r.width) - r.playerX) + Math.abs(Math.floor(next / r.width) - r.playerY) !== 1;
        if (stale) {
            // Self-heal: something moved us off the plotted line (a mid-walk
            // re-click, an event nudge) — re-plot from where we stand now.
            const fresh = findHollowGatePath(r, targetRef.current);
            if (!fresh || fresh.length === 0) { stopRef.current(); return; }
            pathRef.current = fresh;
            next = fresh[0];
        }
        pathRef.current = pathRef.current.slice(1);
        // Watchdog: if this step never lands (rejected move), stop the walk.
        if (watchdogRef.current != null) window.clearTimeout(watchdogRef.current);
        watchdogRef.current = window.setTimeout(() => stopRef.current(), WALK_WATCHDOG_MS);
        moveRef.current((next % r.width) - r.playerX, Math.floor(next / r.width) - r.playerY);
    }
    const issueRef = useRef(issueNext);
    useEffect(() => { issueRef.current = issueNext; });

    // Position commit — the previous step landed. Clear the watchdog and
    // chain the next step after the walk cadence.
    const posKey = run ? run.playerY * run.width + run.playerX : -1;
    useEffect(() => {
        if (targetRef.current == null) return;
        if (watchdogRef.current != null) { window.clearTimeout(watchdogRef.current); watchdogRef.current = null; }
        if (posKey === targetRef.current || posKey < 0) { stopRef.current(); return; }
        if (stepTimerRef.current != null) window.clearTimeout(stepTimerRef.current);
        stepTimerRef.current = window.setTimeout(() => issueRef.current(), HOLLOW_GATE_STEP_MS);
        // Timers are intentionally NOT cleared on effect cleanup here — the
        // next commit re-arms them and stopWalk owns teardown.
    }, [posKey]);

    function walkTo(targetIdx: number) {
        const r = runRef.current;
        if (!r || blockedRef.current) return;
        const path = findHollowGatePath(r, targetIdx);
        if (!path || path.length === 0) return;   // unknown / unreachable / already there
        clearTimers();
        pathRef.current = path;
        targetRef.current = targetIdx;
        walkFloorRef.current = r.floor;
        setWalkTarget(targetIdx);
        issueNext();                               // first step immediately — snappy
    }

    // Halt as soon as an overlay opens or the screen goes away.
    useEffect(() => {
        if (!active || blocked) stopRef.current();
    }, [active, blocked]);
    useEffect(() => clearTimers, []);              // unmount safety

    // WASD / Arrow keys move one tile (and cancel any click-walk in flight).
    // Only active while the shrine screen is open, no overlay is up, and focus
    // is not in a text field. (Moved here from App.tsx.)
    useEffect(() => {
        if (!active) return;
        function handleKey(e: KeyboardEvent) {
            const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
            if (tag === "input" || tag === "textarea" || tag === "select") return;
            const k = e.key.toLowerCase();
            const dir = k === "w" || k === "arrowup" ? [0, -1]
                : k === "s" || k === "arrowdown" ? [0, 1]
                : k === "a" || k === "arrowleft" ? [-1, 0]
                : k === "d" || k === "arrowright" ? [1, 0]
                : null;
            if (!dir) return;
            e.preventDefault();
            stopRef.current();
            if (!blockedRef.current) moveRef.current(dir[0], dir[1]);
        }
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [active]);

    return { walkTo, stopWalk, walkTarget };
}
