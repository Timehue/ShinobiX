// ─────────────────────────────────────────────────────────────────────────────
// pet-duel-lockstep.ts — TWO-PLAYER commanded duels
// (docs/pet-coliseum-player-control-plan.md §10).
//
// The PvE controller (pet-duel-live.ts) makes commands feel instant by rewinding
// to the last tick the player saw and re-simulating. That trick cannot work when
// two people command the same fight: rewinding would rewrite ticks the OTHER
// player has already watched. Merging two separately-recorded input logs after
// the fact does not work either — an order is a reaction to what the opponent
// did, so replaying it against different opponent behaviour reproduces the
// keystroke without the reason for it.
//
// So PvP uses classic LOCKSTEP with a fixed input delay:
//
//   • A command is never applied now. It is scheduled for a tick far enough
//     ahead that both clients are guaranteed to learn about it first.
//   • Neither client may simulate past `safeTick` — the watermark below which no
//     further command can ever be inserted.
//   • Both clients therefore apply an IDENTICAL command set at IDENTICAL ticks,
//     which is exactly the determinism contract the engine already guarantees.
//
// WHY THE WATERMARK IS `min(both players' progress) + DELAY`. A player schedules
// its own orders at `ownTick + DELAY`, so once it reports having reached tick K
// it can never again insert anything at or before `K + DELAY`. Taking the min
// over both players yields a tick that is settled for both. The consequence is
// inherent to lockstep and worth stating plainly: the slower client gates the
// faster one, so a struggling device makes its opponent wait.
//
// The cost of this design is that a PvP order lands ~INPUT_DELAY_TICKS later
// than a PvE one, which is instant. For "tell your pet which move to use" that
// delay is imperceptible; it would not be for a fighting game, which is why the
// two controllers are separate rather than one mode flag.
//
// This module is PURE and transport-free: it never touches the network. The
// caller feeds it authoritative updates and hands its proposals to whatever
// channel it likes (the Socket.IO layer, in practice). That is what makes the
// correctness testable without a server.
// ─────────────────────────────────────────────────────────────────────────────
import type { Pet } from "../types/pet";
import { directPetDuelPresentation } from "./pet-duel-stage-director";
import { DUEL_TPS, type DuelResult, type DuelEvent } from "./pet-duel-sim";
import {
    createLiveCinematicDuel, createLivePartyCinematicDuel,
    stepCinematicDuel, finishCinematicDuel, applyDuelCommand, readDuelControl,
    readClashPrompt, CLASH_WINDOW_TICKS,
    type CinematicDuelState, type DuelCommand, type DuelControlSnap, type ClashPrompt,
} from "./pet-duel-cinematic";
import { type LiveDuel, type DuelInputLogEntry } from "./pet-duel-live";
import { applyDoctrineTick, type PetDoctrine, type DoctrineAssignment } from "./pet-duel-doctrine";

/** How far ahead of a player's own position their order is scheduled. 12 ticks
 *  is 400 ms at 30 TPS, which covers a normal round trip with room to spare and
 *  is well below the ~1 s a player would notice when ordering a pet. */
export const INPUT_DELAY_TICKS = 12;
/** How often the session wants its progress reported upstream, in ticks. The
 *  watermark cannot advance faster than these reports arrive. */
export const PROGRESS_REPORT_TICKS = Math.round(DUEL_TPS * 0.2);
/**
 * PvP runs a SHORTER speculative buffer than PvE.
 *
 * PvE simulates 1.6 s ahead of playback so the stage director gets its look-ahead,
 * and hides that behind a rewind whenever an order arrives. Lockstep cannot rewind
 * freely: the buffer is shared truth, so anything already simulated may already
 * have been watched by the opponent. With no rewind, every tick of buffer is a
 * tick of added command latency, so the buffer is cut to the input delay itself.
 *
 * The cost is that the director loses some of its retroactive routing window in
 * PvP. Restoring it means rewinding the speculative buffer down to the watermark
 * (safe by construction — the watermark is behind BOTH players' playback), which
 * is the planned upgrade; see §10.3 of the plan.
 */
export const LOCKSTEP_LOOKAHEAD_TICKS = INPUT_DELAY_TICKS;

/** A command that has been given an authoritative slot in the timeline.
 *  `seq` is the server's monotonic accept order and breaks ties when two players
 *  land on the same tick, so both clients apply them in the same order. */
export interface LockstepInput {
    tick: number;
    seq: number;
    cmd: DuelCommand;
}

/** What the transport feeds back in. Both fields are cumulative and may repeat:
 *  ingest is idempotent, so a dropped-and-resent update costs nothing. */
export interface LockstepUpdate {
    safeTick: number;
    inputs: readonly LockstepInput[];
}

/** A side that has gone quiet, and the standing orders its pet falls back to.
 *  Bare AI would be a visible downgrade mid-fight; the owner's doctrine is what
 *  they told the pet to do when they could not watch, which is exactly this case. */
export interface LockstepFallback {
    actorIds: readonly string[];
    doctrine: PetDoctrine;
}

export interface LockstepDuel extends LiveDuel {
    /** Ticks that are settled for both players. Simulation stops here. */
    readonly safeTick: number;
    /** True when playback has caught up to the watermark and is waiting on the
     *  peer — the renderer shows a "waiting for opponent" state. */
    readonly stalled: boolean;
    /** The furthest tick this client has played, to report upstream. */
    readonly progressTick: number;
    /** Apply an authoritative update from the transport. */
    ingest(update: LockstepUpdate): void;
    /** Commands this client has proposed and not yet seen confirmed. The caller
     *  resends these if the transport drops. */
    pending(): readonly LockstepInput[];
    /**
     * Hand a side's pets over to standing orders because their player dropped.
     *
     * SAFE FOR LOCKSTEP because the doctrine is a pure function of sim state that
     * both clients evaluate identically, from the same tick — so both timelines
     * stay in step without any of it crossing the wire. It takes effect from
     * `fromTick`, which the server derives from the drop, so the two clients
     * cannot disagree about when the pet went autonomous.
     */
    handOverToDoctrine(fallback: LockstepFallback, fromTick: number): void;
}

/** Everything the caller must send when the session proposes a command.
 *
 *  PROTOCOL INVARIANT: the server must accept or reject the proposed `tick`, and
 *  never restamp it to a different one. The proposing client has already applied
 *  the command optimistically at that tick, so a restamp would leave it one tick
 *  out of step with its peer — the exact divergence this design prevents. The
 *  client only ever proposes ticks strictly past the watermark, so a correct
 *  server never needs to move one. */
export type LockstepProposal = LockstepInput;

/** Structural identity for a command. Needed because a confirmation arrives as a
 *  JSON round-trip, so the optimistic copy it supersedes is never the same object. */
function sameCommand(a: DuelCommand, b: DuelCommand): boolean {
    if (a === b) return true;
    if (a.kind !== b.kind || a.actorId !== b.actorId) return false;
    if (a.kind === "ability" && b.kind === "ability") return a.idx === b.idx;
    if (a.kind === "stance" && b.kind === "stance") return a.stance === b.stance;
    if (a.kind === "auto" && b.kind === "auto") return a.on === b.on;
    if (a.kind === "clash" && b.kind === "clash") return a.pick === b.pick;
    return true;   // "break" carries no payload
}

/**
 * A PvP CLASH call has to reach the engine while the bind is still open.
 *
 * A client schedules at `own progress + INPUT_DELAY_TICKS + 1`, and its own
 * progress can be up to `LOCKSTEP_LOOKAHEAD_TICKS` past the tick it is watching —
 * so the very latest a call can land is that many ticks after the bind opened. The
 * engine refuses a call that arrives after the window closed (safe: both clients
 * refuse it identically, so there is no divergence) but the player would silently
 * lose their read, which is worse than a slow prompt. Checked here rather than
 * commented, because these three constants live in two different files.
 */
const CLASH_CALL_LATEST_TICK = LOCKSTEP_LOOKAHEAD_TICKS + INPUT_DELAY_TICKS + 1;
if (CLASH_CALL_LATEST_TICK >= CLASH_WINDOW_TICKS) {
    throw new Error(
        `pet-duel-lockstep: a clash call can land ${CLASH_CALL_LATEST_TICK} ticks after the bind opens, `
        + `but the bind only holds for ${CLASH_WINDOW_TICKS}. Raise CLASH_WINDOW in pet-duel-cinematic.ts `
        + `or lower INPUT_DELAY_TICKS / LOCKSTEP_LOOKAHEAD_TICKS.`,
    );
}

function makeLockstepDuel(
    sim: CinematicDuelState,
    controlledIds: string[],
    send: (proposal: LockstepProposal) => void,
): LockstepDuel {
    // Keyed by tick so ingest is naturally idempotent and order-independent.
    const inputsByTick = new Map<number, LockstepInput[]>();
    const seenSeq = new Set<number>();
    const pendingBySeq = new Map<number, LockstepInput>();
    const applied: DuelInputLogEntry[] = [];
    const controlLog: Array<Record<string, DuelControlSnap>> = [];
    // Same shape and same reason as controlLog: the clash prompt has to appear on
    // the tick this client is WATCHING, not the leading edge of its buffer.
    const clashLog: Array<Record<string, ClashPrompt>> = [];
    let safeTick = -1;
    let playbackTick = -1;
    let progressTick = -1;
    let localSeq = -1;              // client-proposed seqs are negative until the server assigns one
    let directedAt = -1;
    let directed: DuelResult | null = null;
    let visible: DuelResult = { result: "draw", winner: null, ticks: 0, snapshots: [], events: [] };
    let visibleHead = -2;
    let stalled = false;

    const recordControl = (tick: number) => {
        const row: Record<string, DuelControlSnap> = {};
        const clashRow: Record<string, ClashPrompt> = {};
        for (const id of controlledIds) {
            const snap = readDuelControl(sim, id);
            if (snap) row[id] = snap;
            const bind = readClashPrompt(sim, id);
            if (bind) clashRow[id] = bind;
        }
        controlLog[tick] = row;
        clashLog[tick] = clashRow;
    };

    // Sides handed over to standing orders after their player dropped, and the
    // tick from which that took effect.
    const autonomous: DoctrineAssignment[] = [];
    // Per-actor tick of the last doctrine Bond Break, so the meter is discounted
    // the same way the deck discounts a player's own spend.
    const doctrineBondSpent = new Map<string, number>();

    /** Standing orders for every autonomous pet. Pure and identical on both
     *  clients, so none of it ever needs to cross the wire. */
    const applyDoctrineAt = () => {
        applyDoctrineTick(sim, autonomous, doctrineBondSpent, (cmd, at) => applied.push({ t: at, cmd }));
    };

    /** Apply every command scheduled for `tick`, in the authoritative seq order. */
    const applyInputsAt = (tick: number) => {
        const due = inputsByTick.get(tick);
        if (!due || due.length === 0) return;
        // Sorting here rather than on insert keeps ingest order-independent: a
        // late-arriving input for an unsimulated tick still lands in the right slot.
        due.sort((a, b) => a.seq - b.seq);
        for (const input of due) {
            if (applyDuelCommand(sim, input.cmd)) applied.push({ t: tick, cmd: input.cmd });
        }
    };

    const simulateAhead = () => {
        // Two ceilings: the presentation look-ahead the renderer needs, and the
        // watermark. Whichever is lower wins, and the watermark being lower is
        // precisely the "waiting for the opponent" condition.
        const want = playbackTick + LOCKSTEP_LOOKAHEAD_TICKS;
        const ceiling = Math.min(want, safeTick);
        let ran = 0;
        while (!sim.done && sim.t <= ceiling && ran < DUEL_TPS * 4) {
            const before = sim.t;
            applyDoctrineAt();
            applyInputsAt(before);
            stepCinematicDuel(sim);
            if (sim.t === before) break;
            ran++;
            recordControl(before);
        }
        progressTick = sim.t - 1;
        stalled = !sim.done && safeTick < want;
        return ran;
    };

    const refreshView = () => {
        if (sim.snapshots.length === 0) return visible;
        const head = Math.min(sim.snapshots.length - 1, playbackTick + LOCKSTEP_LOOKAHEAD_TICKS);
        if (directed === null || sim.snapshots.length - directedAt >= Math.round(DUEL_TPS * 0.5) || sim.done) {
            directed = directPetDuelPresentation({
                result: "draw", winner: null, ticks: sim.ticks,
                snapshots: sim.snapshots.slice(), events: sim.events.slice(),
            });
            directedAt = sim.snapshots.length;
            visibleHead = -2;
        }
        if (head === visibleHead) return visible;
        visibleHead = head;
        const src = directed;
        const cut = Math.min(head, src.snapshots.length - 1);
        const snapshots = src.snapshots.slice(0, cut + 1);
        let eventEnd = src.events.length;
        while (eventEnd > 0 && src.events[eventEnd - 1].t > cut) eventEnd--;
        const events: DuelEvent[] = src.events.slice(0, eventEnd);
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
        get safeTick() { return safeTick; },
        get stalled() { return stalled; },
        get progressTick() { return progressTick; },
        controlledIds,
        view: () => visible,
        advance,
        ingest(update: LockstepUpdate) {
            for (const input of update.inputs) {
                if (seenSeq.has(input.seq)) continue;
                seenSeq.add(input.seq);
                // A confirmation SUPERSEDES the optimistic copy this client applied
                // locally — it does not join it. Leaving both in the tick's list
                // would run the command twice on the proposing client and once on
                // the peer: harmless for an idempotent order, but it flips an
                // `auto` toggle straight back and corrupts the input log the
                // server replays to decide the winner.
                for (const [seq, mine] of pendingBySeq) {
                    if (!sameCommand(mine.cmd, input.cmd)) continue;
                    pendingBySeq.delete(seq);
                    const own = inputsByTick.get(mine.tick);
                    const at = own ? own.findIndex((x) => x.seq === seq) : -1;
                    if (own && at >= 0) own.splice(at, 1);
                    break;
                }
                const list = inputsByTick.get(input.tick);
                if (list) list.push(input);
                else inputsByTick.set(input.tick, [input]);
            }
            // The watermark only ever moves forward; a stale update is ignored.
            if (update.safeTick > safeTick) safeTick = update.safeTick;
        },
        command(cmd: DuelCommand) {
            if (sim.done) return;
            // THE load-bearing rule. Having reported progress P, this client must
            // never schedule at or below `P + INPUT_DELAY_TICKS`, because that is
            // exactly the watermark the server may already have derived from P —
            // and a command landing ON the watermark is the divergence lockstep
            // exists to prevent: one client has simulated that tick, the other has
            // not. The `+ 1` is what makes it strictly past every reachable
            // watermark. Scheduling is relative to our OWN progress, never to the
            // shared watermark, so a lagging peer cannot push our orders further out.
            const tick = Math.max(playbackTick, progressTick) + INPUT_DELAY_TICKS + 1;
            const proposal: LockstepInput = { tick, seq: localSeq--, cmd };
            pendingBySeq.set(proposal.seq, proposal);
            // Applied locally at the SAME scheduled tick rather than immediately:
            // that is what keeps this client's timeline identical to the peer's.
            const list = inputsByTick.get(tick);
            if (list) list.push(proposal);
            else inputsByTick.set(tick, [proposal]);
            seenSeq.add(proposal.seq);
            send(proposal);
        },
        pending: () => [...pendingBySeq.values()],
        handOverToDoctrine(fallback, fromTick) {
            if (autonomous.some((a) => a.actorIds[0] === fallback.actorIds[0])) return;
            autonomous.push({ actorIds: fallback.actorIds, doctrine: fallback.doctrine, from: Math.floor(fromTick) });
        },
        controlAt(tick: number, actorId: string) {
            const i = Math.max(0, Math.min(controlLog.length - 1, Math.floor(tick)));
            return controlLog[i]?.[actorId] ?? null;
        },
        clashAt(tick: number, actorId: string) {
            const i = Math.max(0, Math.min(clashLog.length - 1, Math.floor(tick)));
            return clashLog[i]?.[actorId] ?? null;
        },
        finishedAt: (tick: number) => sim.done && tick >= sim.snapshots.length - 1,
        outcome: () => finishCinematicDuel(sim),
        inputLog: () => applied,
    };
}

/** Lockstep 1v1. `mySide` decides which pet THIS client commands; the peer's pet
 *  is driven by the commands that arrive over the wire, never by local input. */
export function createLockstepDuel(
    playerPet: Pet, enemyPet: Pet, seed: number,
    mySide: "player" | "enemy",
    send: (proposal: LockstepProposal) => void,
    applyItems = true,
): LockstepDuel {
    const sim = createLiveCinematicDuel(playerPet, enemyPet, seed, 1, 1, false, applyItems, true, null, false);
    // Both fighters accept commands — the difference is only WHERE the command
    // comes from. Marking both controlled is what lets an ingested enemy order
    // take effect on this client.
    for (const f of sim.fighters) f.controlled = true;
    return makeLockstepDuel(sim, [`${mySide}-0`], send);
}

/** Lockstep 2v2 — this client commands its own side's two pets. */
export function createLockstepPartyDuel(
    playerLead: Pet, playerReserve: Pet | null,
    enemyLead: Pet, enemyReserve: Pet | null,
    seed: number, mySide: "player" | "enemy",
    send: (proposal: LockstepProposal) => void,
    applyItems = true,
): LockstepDuel {
    const sim = createLivePartyCinematicDuel(
        playerLead, playerReserve, enemyLead, enemyReserve, seed, 1, 1, false, applyItems, true, false,
    );
    for (const f of sim.fighters) f.controlled = true;
    const mine = sim.fighters.filter((f) => f.team === mySide).map((f) => f.id);
    return makeLockstepDuel(sim, mine, send);
}
