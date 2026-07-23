// ─────────────────────────────────────────────────────────────────────────────
// pet-duel-live.ts — the PLAYER-CONTROLLED coliseum duel
// (docs/pet-coliseum-player-control-plan.md).
//
// The shipped coliseum resolves the whole fight before frame 1 and plays back
// `snapshots[tick]`. That architecture cannot accept input, because the winner is
// already decided when the player sees the opening pose. This module keeps the
// engine and the entire presentation layer intact, and makes the fight live by
// running the deterministic sim one tick at a time, a fixed LOOK-AHEAD ahead of
// playback.
//
// WHY THE LOOK-AHEAD EXISTS. The renderer is not a dumb snapshot player: the stage
// director (pet-duel-stage-director.ts) fits movement tracks across the timeline
// and can retroactively re-launch a route up to ~1.35 s before a wind-up, and
// DuelDirector reads ~2.2 s ahead to avoid promising a cinematic payoff for an
// attack that is about to miss. Playing the very newest tick would strip all of
// that and the fight would visibly regress. So the sim always runs LOOKAHEAD_TICKS
// ahead and the player only ever SEES the settled portion.
//
// WHY COMMANDS ARE STILL INSTANT. A look-ahead normally means input latency. It
// does not here: when a command arrives we REWIND to the last tick the player has
// actually seen, apply the order there, and re-simulate the buffer. The engine is
// deterministic and costs microseconds a tick, so replaying ~1.6 s is free, and
// the already-played prefix is bit-identical because we restore a checkpoint taken
// at the end of that tick. The player presses a button and the very next thing
// they see reflects it.
//
// This module is CLIENT-ONLY and casual-only. Nothing here is imported by the
// server mirror (api/_pet-sim), the pet ladder, or sector war; those keep calling
// runPetDuelCinematic, whose behaviour is unchanged.
// ─────────────────────────────────────────────────────────────────────────────
import type { Pet } from "../types/pet";
import { directPetDuelPresentation } from "./pet-duel-stage-director";
import {
    DUEL_TPS, type DuelResult, type DuelEvent,
} from "./pet-duel-sim";
import {
    createLiveCinematicDuel, createLivePartyCinematicDuel,
    stepCinematicDuel, finishCinematicDuel, applyDuelCommand, readDuelControl,
    checkpointCinematicDuel, restoreCinematicDuel,
    type CinematicDuelState, type CinematicDuelCheckpoint,
    type DuelCommand, type DuelControlSnap,
} from "./pet-duel-cinematic";

/** How far the simulation stays ahead of what the player sees. Must comfortably
 *  exceed the stage director's WINDUP_LOOKAHEAD (1.35 s) so every retroactive
 *  track edit lands in the unseen buffer rather than on screen. */
export const LOOKAHEAD_TICKS = Math.round(DUEL_TPS * 1.6);
/** Checkpoints retained for rewind — one per buffered tick, plus a little slack. */
const CHECKPOINT_WINDOW = LOOKAHEAD_TICKS + 8;
/** Ticks of new simulation before the stage director re-authors the timeline.
 *  Re-directing every tick would rebuild the whole snapshot array 30×/second. */
const REDIRECT_EVERY = Math.round(DUEL_TPS * 0.5);
/** Hard stop on ticks simulated in one advance() call, so a stalled tab that
 *  resumes with a huge delta cannot lock the main thread. */
const MAX_TICKS_PER_ADVANCE = DUEL_TPS * 4;

/** Accuracy (miss chance) for a COMMANDED duel is PINNED, not read from the
 *  per-device `petAccuracy.v1` flag. Two reasons, both load-bearing now that the
 *  server replays the fight to decide the reward (plan §9.6): the server has no
 *  way to know a browser's localStorage, so an unpinned flag desynchronises the
 *  replay; and a flag that flips miss chance off is a client-controlled lever on
 *  the outcome. `true` matches the flag's own browser default, so this is the
 *  fight virtually every player is already getting. Watch-only duels are
 *  unaffected — they keep reading the flag. */
export const CONTROLLED_DUEL_ACCURACY = true;

/** One accepted command, stamped with the tick it actually took effect on.
 *  This is the wire format posted to /api/pet/battle-result: the server steps the
 *  same seeded sim, applies each entry when `sim.t === t`, and derives the outcome
 *  itself instead of trusting the reported win/loss (plan §9.6 option 1). */
export interface DuelInputLogEntry { t: number; cmd: DuelCommand }

export interface LiveDuel {
    /** The duel as the player is allowed to see it: the settled prefix only.
     *  The object identity changes whenever the visible timeline grows, so React
     *  memos keyed on it recompute. */
    view(): DuelResult;
    /** Simulate far enough ahead of `playbackTick` and refresh the view. */
    advance(playbackTick: number): DuelResult;
    /** Queue a player order. Rewinds to `playbackTick` so it takes effect at once. */
    command(cmd: DuelCommand): void;
    /** The commanded fighter's buttons/cooldowns AS OF a played-back tick. */
    controlAt(tick: number, actorId: string): DuelControlSnap | null;
    /** True once the simulation has resolved (the player may still be watching). */
    readonly settled: boolean;
    /** True once the settled result has also been fully played back. */
    finishedAt(playbackTick: number): boolean;
    /** The authoritative outcome. Only meaningful once `settled`. */
    outcome(): DuelResult;
    /** Ids of the fighters that accept commands. */
    readonly controlledIds: readonly string[];
    /** Every accepted command in the order it was applied, for server replay. */
    inputLog(): readonly DuelInputLogEntry[];
}

function makeLiveDuel(sim: CinematicDuelState, controlledIds: string[]): LiveDuel {
    const checkpoints: Array<{ tick: number; cp: CinematicDuelCheckpoint }> = [];
    // Append-only: a rewind only ever reaches into the UNSEEN buffer, and the
    // rewind point is `playbackTick + 1`, which never moves backwards — so a
    // command that was already applied is baked into every later checkpoint and
    // is never undone. That is what makes a flat, ordered log a faithful record.
    const inputs: DuelInputLogEntry[] = [];
    // One entry per SIMULATED tick, so the HUD can show the cooldowns that were
    // true at the tick currently on screen rather than the leading edge.
    const controlLog: Array<Record<string, DuelControlSnap>> = [];
    let playbackTick = -1;
    let directedAt = -1;                    // sim tick count the cached direction was built from
    let directed: DuelResult | null = null; // stage-directed full prefix
    let visible: DuelResult = { result: "draw", winner: null, ticks: 0, snapshots: [], events: [] };
    let visibleHead = -2;                   // last head the view was cut at

    const recordControl = (tick: number) => {
        const row: Record<string, DuelControlSnap> = {};
        for (const id of controlledIds) {
            const snap = readDuelControl(sim, id);
            if (snap) row[id] = snap;
        }
        controlLog[tick] = row;
    };

    /** Run the sim forward until it is LOOKAHEAD_TICKS past `playbackTick`. */
    const simulateAhead = () => {
        const target = playbackTick + LOOKAHEAD_TICKS;
        let ran = 0;
        while (!sim.done && sim.t <= target && ran < MAX_TICKS_PER_ADVANCE) {
            const before = sim.t;
            stepCinematicDuel(sim);
            if (sim.t === before) break;   // refused to advance — never spin
            ran++;
            recordControl(before);
            checkpoints.push({ tick: sim.t, cp: checkpointCinematicDuel(sim) });
        }
        // Retain only checkpoints we could still rewind to. The head must stay at
        // playbackTick + 1 — that is the first tick the player has NOT seen, and
        // therefore the earliest one a new order is allowed to change.
        while (checkpoints.length > 1 && checkpoints[0].tick <= playbackTick) checkpoints.shift();
        while (checkpoints.length > CHECKPOINT_WINDOW) checkpoints.shift();
        return ran;
    };

    /** Re-run the stage director over everything simulated so far, then cut the
     *  view back to the settled head. Retroactive track edits are confined to the
     *  buffer, so the portion already on screen does not move. */
    const refreshView = () => {
        const head = Math.min(sim.snapshots.length - 1, playbackTick + LOOKAHEAD_TICKS);
        if (sim.snapshots.length === 0) return visible;
        if (directed === null || sim.snapshots.length - directedAt >= REDIRECT_EVERY || sim.done) {
            directed = directPetDuelPresentation({
                result: "draw", winner: null, ticks: sim.ticks,
                // Copy the arrays: the director keeps references, and the sim keeps
                // appending to (and on rewind, truncating) its own.
                snapshots: sim.snapshots.slice(), events: sim.events.slice(),
            });
            directedAt = sim.snapshots.length;
            visibleHead = -2;   // force a re-cut against the new direction
        }
        if (head === visibleHead) return visible;
        visibleHead = head;
        const src = directed;
        const cut = Math.min(head, src.snapshots.length - 1);
        const snapshots = src.snapshots.slice(0, cut + 1);
        let eventEnd = src.events.length;
        while (eventEnd > 0 && src.events[eventEnd - 1].t > cut) eventEnd--;
        const events: DuelEvent[] = src.events.slice(0, eventEnd);
        // While the fight is still running the view reports a draw with no winner;
        // only the settled duel carries the real outcome (see `outcome()`).
        visible = sim.done && cut >= sim.snapshots.length - 1
            ? { ...finishCinematicDuel(sim), snapshots, events }
            : { result: "draw", winner: null, ticks: snapshots.length, snapshots, events };
        return visible;
    };

    const advance = (tick: number) => {
        playbackTick = Math.max(playbackTick, Math.floor(tick));
        simulateAhead();
        return refreshView();
    };

    return {
        get settled() { return sim.done; },
        controlledIds,
        view: () => visible,
        advance,
        command(cmd: DuelCommand) {
            // A settled fight cannot obey anything, and accepting the order anyway
            // would append an entry the sim never ran — which is exactly the kind of
            // divergence a server replaying the log would reject. The deck is hidden
            // once `settled`, so this only guards against a stray caller.
            if (sim.done) return;
            // Rewind to the first tick the player has not seen yet, so the order is
            // obeyed on the very next frame instead of after the look-ahead buffer.
            const idx = checkpoints.findIndex((c) => c.tick > playbackTick);
            if (idx >= 0) {
                restoreCinematicDuel(sim, checkpoints[idx].cp);
                controlLog.length = Math.min(controlLog.length, checkpoints[idx].tick);
                checkpoints.length = idx;
                directed = null; directedAt = -1; visibleHead = -2;
            }
            // `sim.t` is the tick the order lands on — after a rewind that is the
            // restored checkpoint's tick, otherwise the sim's leading edge. Record
            // it only if the engine ACCEPTED the command, so the log never carries
            // an entry the server would have to reject on replay.
            const at = sim.t;
            if (applyDuelCommand(sim, cmd)) inputs.push({ t: at, cmd });
            advance(playbackTick);
        },
        inputLog: () => inputs,
        controlAt(tick: number, actorId: string) {
            const i = Math.max(0, Math.min(controlLog.length - 1, Math.floor(tick)));
            return controlLog[i]?.[actorId] ?? null;
        },
        finishedAt: (tick: number) => sim.done && tick >= sim.snapshots.length - 1,
        outcome: () => finishCinematicDuel(sim),
    };
}

/** Player-controlled 1v1. Argument order mirrors runPetDuelCinematic so the call
 *  sites stay readable side by side. */
export function createLiveDuel(
    playerPet: Pet, enemyPet: Pet, seed: number,
    playerDamageMult = 1, playerHpMult = 1, playerReviveOnce = false,
    applyItems = true, accuracyEnabled: boolean = CONTROLLED_DUEL_ACCURACY, terrain: string | null = null,
): LiveDuel {
    const sim = createLiveCinematicDuel(
        playerPet, enemyPet, seed, playerDamageMult, playerHpMult, playerReviveOnce,
        applyItems, accuracyEnabled, terrain, false,
    );
    return makeLiveDuel(sim, ["player-0"]);
}

/** Player-controlled 2v2 — both player-side pets take orders. */
export function createLivePartyDuel(
    playerLead: Pet, playerReserve: Pet | null,
    enemyLead: Pet, enemyReserve: Pet | null,
    seed: number, playerDamageMult = 1, playerHpMult = 1, playerReviveOnce = false,
    applyItems = true, accuracyEnabled: boolean = CONTROLLED_DUEL_ACCURACY,
): LiveDuel {
    const sim = createLivePartyCinematicDuel(
        playerLead, playerReserve, enemyLead, enemyReserve, seed,
        playerDamageMult, playerHpMult, playerReviveOnce, applyItems, accuracyEnabled, false,
    );
    return makeLiveDuel(sim, playerReserve ? ["player-0", "player-1"] : ["player-0"]);
}

export type { DuelCommand, DuelControlSnap };
