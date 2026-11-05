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
/** Lowercased WASD / arrow key → [dx, dy]. Mirrors MOVEMENT_KEYS in lib/held-movement-keys.ts (a test holds them equal). */
const UP: [number, number] = [0, -1], DOWN: [number, number] = [0, 1], LEFT: [number, number] = [-1, 0], RIGHT: [number, number] = [1, 0];
export const KEY_DIRECTIONS: Record<string, [number, number] | undefined> = {
    w: UP, arrowup: UP, s: DOWN, arrowdown: DOWN, a: LEFT, arrowleft: LEFT, d: RIGHT, arrowright: RIGHT,
};

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
    const activeRef = useRef(active);
    const blockedRef = useRef(blocked);
    const moveRef = useRef(moveStep);
    useEffect(() => { runRef.current = run; activeRef.current = active; blockedRef.current = blocked; moveRef.current = moveStep; });

    const pathRef = useRef<number[]>([]);
    const targetRef = useRef<number | null>(null);
    const walkFloorRef = useRef<number>(-1);      // floor the walk started on
    const walkTokenRef = useRef<string | undefined>(undefined);
    // Timer ids are only ever cleared or replaced. Clearing one that already
    // fired is a no-op (browsers never reuse an id), so nothing nulls them.
    const stepTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const watchdogRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    const clearTimers = () => { clearTimeout(stepTimerRef.current); clearTimeout(watchdogRef.current); };
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
        const r = runRef.current;
        if (!r || !activeRef.current || document.hidden || blockedRef.current || targetRef.current == null
            || r.floor !== walkFloorRef.current || r.runToken !== walkTokenRef.current) { stopRef.current(); return; }
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
        clearTimeout(watchdogRef.current);
        watchdogRef.current = setTimeout(() => stopRef.current(), WALK_WATCHDOG_MS);
        moveRef.current((next % r.width) - r.playerX, Math.floor(next / r.width) - r.playerY);
    }
    const issueRef = useRef(issueNext);
    useEffect(() => { issueRef.current = issueNext; });

    // Position commit — the previous step landed. Clear the watchdog and
    // chain the next step after the walk cadence.
    const posKey = run ? run.playerY * run.width + run.playerX : -1;
    useEffect(() => {
        if (targetRef.current == null) return;
        if (!run || run.floor !== walkFloorRef.current || run.runToken !== walkTokenRef.current) { stopRef.current(); return; }
        clearTimeout(watchdogRef.current);
        if (posKey === targetRef.current || posKey < 0) { stopRef.current(); return; }
        clearTimeout(stepTimerRef.current);
        stepTimerRef.current = setTimeout(() => issueRef.current(), HOLLOW_GATE_STEP_MS);
        // Timers are intentionally NOT cleared on effect cleanup here — the
        // next commit re-arms them and stopWalk owns teardown.
        // Floor/run identity can change without changing the tile index.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [posKey, run?.floor, run?.runToken]);

    function walkTo(targetIdx: number) {
        const r = runRef.current;
        if (!r || !activeRef.current || document.hidden || blockedRef.current) return;
        const path = findHollowGatePath(r, targetIdx);
        if (!path || path.length === 0) return;   // unknown / unreachable / already there
        clearTimers();
        pathRef.current = path;
        targetRef.current = targetIdx;
        walkFloorRef.current = r.floor;
        walkTokenRef.current = r.runToken;
        setWalkTarget(targetIdx);
        issueNext();                               // first step immediately — snappy
    }

    // Halt as soon as an overlay opens or the screen goes away.
    useEffect(() => {
        if (!active || blocked) stopRef.current();
    }, [active, blocked]);
    useEffect(() => {
        if (!active) return;
        const onVisibility = () => { if (document.hidden) stopRef.current(); };
        const onPageHide = () => stopRef.current();
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', onPageHide);
        onVisibility();
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pagehide', onPageHide);
        };
    }, [active]);
    useEffect(() => clearTimers, []);              // unmount safety

    // WASD / Arrow keys move one tile (and cancel any click-walk in flight).
    // Only active while the shrine screen is open, no overlay is up, and focus
    // is not in a text field. (Moved here from App.tsx.)
    useEffect(() => {
        if (!active) return;
        // Every move is a server step, so a held key walks once per walk
        // cadence: exactly as fast as click-to-move, and inside the
        // hollow-gate-step limit. It walks on its own timer from the first
        // press rather than on the OS key repeat, whose first delay (about half
        // a second by default on Windows) made a held key step, stall, then
        // walk. Fresh presses are never delayed.
        // The held key, as in lib/held-movement-keys.ts and the open world: a
        // new press takes over and letting go of it ends the hold. App loads
        // this hook eagerly, and importing that module here split it into its
        // own startup chunk (+243 B gzip on a nearly full budget).
        let held: string | null = null, holdTimer: ReturnType<typeof setTimeout> | undefined;
        // A pending tick finds `held` empty and ends, so stopping needs no clearTimeout.
        const stopHold = () => { held = null; };
        function holdStep() {
            const dir = held && KEY_DIRECTIONS[held];
            if (!dir) return;
            // An overlay or an unfocused window (alt-tab, the address bar, a hidden
            // tab: the key's keyup goes elsewhere) ends the hold; walking again takes
            // a fresh press. So does a click-walk (targetRef set), or both would step
            // each cadence: walkTo steps at once, so this tick finds it and only stops.
            if (!document.hasFocus() || blockedRef.current || targetRef.current != null) return stopHold();
            moveRef.current(dir[0], dir[1]);
            holdTimer = setTimeout(holdStep, HOLLOW_GATE_STEP_MS);
        }
        function handleKey(e: KeyboardEvent) {
            // Cmd/Ctrl/Alt chords (Cmd+S, Ctrl+D) are browser shortcuts, not steps.
            // On macOS a Cmd chord also sends no keyup, so it would hold forever.
            // (No document.hidden check: a hidden page receives no key events.)
            // closest() matches the element itself, so one selector covers text fields too.
            if (e.ctrlKey || e.metaKey || e.altKey
                || (e.target as HTMLElement)?.closest('input,textarea,select,dialog,[role="dialog"],[role="alertdialog"],[contenteditable="true"]')) return;
            const k = e.key.toLowerCase();
            const dir = KEY_DIRECTIONS[k];
            if (!dir) return;
            e.preventDefault();
            // A real held key is walked by holdStep. Synthetic presses (a held
            // controller stick) keep the one-step-per-press, paced behaviour.
            if (e.isTrusted && e.repeat) return;
            stopRef.current();
            if (!blockedRef.current) moveRef.current(dir[0], dir[1]);
            if (e.isTrusted) { held = k; clearTimeout(holdTimer); holdTimer = setTimeout(holdStep, HOLLOW_GATE_STEP_MS); }
        }
        function handleKeyUp(e: KeyboardEvent) {
            // macOS sends no keyup for a key let go while Cmd is down, so Cmd's
            // own keyup ends the hold too.
            const k = e.key.toLowerCase();
            if (k === held || k === "meta") stopHold();
        }
        window.addEventListener("keydown", handleKey);
        window.addEventListener("keyup", handleKeyUp);
        return () => {
            clearTimeout(holdTimer);
            window.removeEventListener("keydown", handleKey);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, [active]);

    return { walkTo, stopWalk, walkTarget };
}
