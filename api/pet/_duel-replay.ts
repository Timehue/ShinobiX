// ─────────────────────────────────────────────────────────────────────────────
// _duel-replay.ts — server-authoritative replay of a PLAYER-CONTROLLED coliseum
// duel (docs/pet-coliseum-player-control-plan.md §9.6, option 1).
//
// The problem this closes: battle-start used to seal an `authoritativeOutcome`
// by running the OLD pet-duel-sim engine AI-vs-AI over the seed, and
// battle-result paid from that. The live coliseum runs pet-duel-cinematic, so
// the reward never followed the fight on screen — and once the player could
// actually command the fight, outplaying the AI could still be scored a loss.
//
// The fix: the client posts the commands it issued, stamped with the tick each
// one landed on, and the server steps the SAME seeded cinematic sim with that
// log. Nothing about the outcome comes from the client any more — the reported
// win/loss is not consulted at all, only the inputs. A modified client can lie
// about which buttons it pressed, but not about what pressing them does.
//
// What is validated here, and what deliberately is NOT:
//
//   * RATE. Capped per second and in total. This is the real exploit surface —
//     a script re-ordering every tick micros beyond any human.
//   * BOND BREAK. The one command the engine does not gate itself:
//     applyDuelCommand accepts it unconditionally AND it zeroes the signature
//     cooldown, so an ungated Break is a free signature every five seconds. The
//     meter is a pure fold over the event log, so the server recomputes it here
//     and drops a Break that was not paid for.
//   * CLASH CALLS: no extra check needed here, because applyDuelCommand already
//     gates them completely — a clash command is accepted only while that exact
//     fighter is inside an open bind, only once per bind, and only for a pick of
//     0/1/2. A forged or replayed clash entry therefore fails in the engine and
//     lands in `rejected` like any other refused command.
//
//     Known and accepted: because the simulation is deterministic and runs on the
//     client, a modified client can look ahead, see which read the AI is going to
//     make, and answer to beat it. That is not new — the same client can already
//     see the whole fight before it plays — and the exposure is bounded: this path
//     is casual PvE, the reward is recomputed here and capped, and ranked / ladder
//     / sector war never bind at all (they run the authoritative path, where the
//     clash trigger is gated off by `Fighter.brawl`). Closing it properly would
//     mean hidden server-side rolls, which this architecture deliberately does not
//     have; it is not worth breaking replay parity for a casual-mode edge.
//
//   * COOLDOWN / STAMINA on an ordinary ability order: NOT rejected, on
//     purpose. The engine already refuses to EXECUTE an unaffordable or
//     on-cooldown move (see commandedOffensive / readySupport in
//     pet-duel-cinematic.ts) — a queued order simply waits up to
//     DUEL_ORDER_TICKS for its window. The command deck reflects that: it dims
//     such buttons rather than disabling them, because queuing the next move
//     early is intended play. Rejecting those at issue time would both break
//     replay parity and punish legitimate players for a cheat that the engine
//     makes impossible anyway.
// ─────────────────────────────────────────────────────────────────────────────
import { DUEL_TPS } from '../_pet-sim/pet-duel-sim.js';
import {
    createLiveCinematicDuel, createLivePartyCinematicDuel,
    stepCinematicDuel, finishCinematicDuel, applyDuelCommand,
} from '../_pet-sim/pet-duel-cinematic.js';
import { bondCharge, BOND_FULL } from '../_pet-sim/pet-bond-meter.js';
import { applyDoctrineTick, type PetDoctrine } from '../_pet-sim/pet-duel-doctrine.js';
import type { DuelCommand } from '../_pet-sim/pet-duel-cinematic.js';
import type { Pet } from '../_pet-sim/pet-types.js';

export type PetDuelOutcome = 'win' | 'loss' | 'draw';

/** One accepted command and the tick it took effect on. Mirrors
 *  DuelInputLogEntry in shinobij.client/src/lib/pet-duel-live.ts. */
export interface DuelInputLogEntry { t: number; cmd: DuelCommand }

/** Everything needed to rebuild the exact fight, SEALED at battle-start so the
 *  client cannot restate any of it when it reports the result. */
export interface SealedDuelParams {
    mode: '1v1' | '2v2';
    seed: number;
    damageMult: number;
    hpMult: number;
    revive: boolean;
    applyItems: boolean;
    accuracy: boolean;
    terrain: string | null;
}

/** Total commands accepted in one duel. A 45 s fight at the per-second cap is
 *  ~360, so this only stops an unbounded payload. */
export const MAX_INPUT_LOG = 600;
/** Accepted commands per second. Comfortably above human tapping (the deck has
 *  five ability slots plus stance/auto/break) and far below a script. */
export const MAX_COMMANDS_PER_SECOND = 8;
/** Matches the guard the engine's own tests use — a duel cannot outlive it. */
const MAX_REPLAY_TICKS = DUEL_TPS * 200;

export interface DuelReplayResult {
    outcome: PetDuelOutcome;
    /** Commands actually handed to the engine. */
    applied: number;
    /** Dropped by the rate caps. */
    rateLimited: number;
    /** Dropped because the Bond meter was not full, or the engine refused them. */
    rejected: number;
}

/**
 * Coerce an untrusted request body into a well-formed input log.
 * Returns null when the payload is not a usable log at all, so the caller can
 * fall back to the sealed AI-vs-AI baseline rather than paying out blind.
 */
export function parseDuelInputLog(raw: unknown): DuelInputLogEntry[] | null {
    if (raw == null) return [];
    if (!Array.isArray(raw)) return null;
    if (raw.length > MAX_INPUT_LOG) return null;
    const out: DuelInputLogEntry[] = [];
    let prevTick = -1;
    for (const item of raw) {
        if (!item || typeof item !== 'object') return null;
        const entry = item as Record<string, unknown>;
        const t = Number(entry.t);
        // Ticks must be whole, in range, and non-decreasing. The client only ever
        // rewinds into the UNSEEN buffer, so its log is naturally ordered; an
        // out-of-order log is a rewritten one.
        if (!Number.isInteger(t) || t < 0 || t > MAX_REPLAY_TICKS || t < prevTick) return null;
        prevTick = t;
        const cmdRaw = entry.cmd;
        if (!cmdRaw || typeof cmdRaw !== 'object') return null;
        const c = cmdRaw as Record<string, unknown>;
        const actorId = typeof c.actorId === 'string' ? c.actorId.slice(0, 32) : '';
        if (!actorId) return null;
        switch (c.kind) {
            case 'ability': {
                const idx = Number(c.idx);
                // -1 is "plain basic attack"; the engine range-checks the upper
                // bound against this fighter's real ability count.
                if (!Number.isInteger(idx) || idx < -1 || idx > 32) return null;
                out.push({ t, cmd: { kind: 'ability', actorId, idx } });
                break;
            }
            case 'break':
                out.push({ t, cmd: { kind: 'break', actorId } });
                break;
            case 'stance': {
                const stance = Number(c.stance);
                if (!Number.isFinite(stance)) return null;
                out.push({ t, cmd: { kind: 'stance', actorId, stance } });
                break;
            }
            case 'auto':
                if (typeof c.on !== 'boolean') return null;
                out.push({ t, cmd: { kind: 'auto', actorId, on: c.on } });
                break;
            case 'clash': {
                // The player's read inside a clash bind. Only 0/1/2 exist; anything
                // else is a rewritten log, not a client we should be scoring. The
                // engine does the rest of the gating (bind open, right fighter, one
                // call only) — see applyDuelCommand.
                // Checked as a NUMBER, not coerced: `Number(null)` and `Number('')`
                // are both 0, which would quietly turn a malformed entry into a
                // Strike read rather than rejecting the log.
                const pick = c.pick;
                if (pick !== 0 && pick !== 1 && pick !== 2) return null;
                out.push({ t, cmd: { kind: 'clash', actorId, pick } });
                break;
            }
            default:
                return null;
        }
    }
    return out;
}

/**
 * Step the sealed duel with the player's inputs and return the outcome the
 * server derived. `log` must already have been through parseDuelInputLog.
 *
 * An EMPTY log reproduces the uncommanded AI fight exactly — that is the
 * property pet-duel-live.test.ts asserts — so this is also the correct way to
 * score a fight the player watched without touching the controls.
 */
export function replayCasualPetDuel(
    playerPets: Pet[],
    opponentPets: Pet[],
    params: SealedDuelParams,
    log: readonly DuelInputLogEntry[],
): DuelReplayResult {
    const { mode, seed, damageMult, hpMult, revive, applyItems, accuracy, terrain } = params;
    const sim = mode === '2v2'
        ? createLivePartyCinematicDuel(
            playerPets[0], playerPets[1] ?? null, opponentPets[0], opponentPets[1] ?? null,
            seed, damageMult, hpMult, revive, applyItems, accuracy, false,
        )
        : createLiveCinematicDuel(
            playerPets[0], opponentPets[0], seed,
            damageMult, hpMult, revive, applyItems, accuracy, terrain, false,
        );

    let i = 0;
    let applied = 0;
    let rateLimited = 0;
    let rejected = 0;
    // Ticks of recently ACCEPTED commands, for the sliding per-second cap.
    const recent: number[] = [];
    // Tick of the last Bond Break spend, mirroring PetColiseum's `bondSpentAt`.
    // The client stamps it from the PLAYBACK clock, one tick behind the tick the
    // order lands on, so mirror that offset — being a tick more generous here
    // can only ever accept a press the player legitimately made.
    let bondSpentAt = -1;

    for (let guard = 0; guard < MAX_REPLAY_TICKS; guard++) {
        // Apply everything scheduled for this tick BEFORE stepping — exactly the
        // order the live controller uses (it rewinds so sim.t equals the order's
        // tick, applies, then resumes).
        while (i < log.length && log[i].t <= sim.t) {
            const { t, cmd } = log[i++];
            while (recent.length && recent[0] <= t - DUEL_TPS) recent.shift();
            if (recent.length >= MAX_COMMANDS_PER_SECOND || applied >= MAX_INPUT_LOG) {
                rateLimited++;
                continue;
            }
            if (cmd.kind === 'break' && bondCharge(sim.events, cmd.actorId, t, bondSpentAt) < BOND_FULL) {
                // Unpaid Bond Break — the meter is the only gate on a move that
                // otherwise ignores its cooldown.
                rejected++;
                continue;
            }
            if (!applyDuelCommand(sim, cmd)) { rejected++; continue; }
            if (cmd.kind === 'break') bondSpentAt = t - 1;
            recent.push(t);
            applied++;
        }
        if (!stepCinematicDuel(sim)) break;
    }

    return { outcome: finishCinematicDuel(sim).result as PetDuelOutcome, applied, rateLimited, rejected };
}

// ── Two-player (lockstep) replay ───────────────────────────────────────────────

/** Which side an actor belongs to. The engine seats the challenger's pets as the
 *  "player" team and the opponent's as "enemy", so this is a prefix test — the
 *  same one the socket layer uses to reject commanding the pet you are fighting. */
const actorSide = (actorId: string): 'p1' | 'p2' => (actorId.startsWith('player-') ? 'p1' : 'p2');

export interface LockstepReplayResult extends DuelReplayResult {
    /** 'p1' = the challenger, 'p2' = the opponent, null = a draw. */
    winner: 'p1' | 'p2' | null;
}

/** A side that went silent mid-fight, and the standing orders its pets fell back
 *  to. `from` is the server-computed hand-over tick that BOTH clients were told,
 *  so replaying with it reproduces the fight they actually watched. */
export interface LockstepAutonomy {
    actorIds: readonly string[];
    doctrine: PetDoctrine;
    from: number;
}

/**
 * Replay a LIVE two-player duel from the merged, server-sequenced input log and
 * derive the winner (docs/pet-coliseum-player-control-plan.md §10.6).
 *
 * Differences from the casual replay above, all of them because BOTH pets are
 * commanded here rather than one:
 *
 *   • both sides are marked controlled, so an `enemy-*` order takes effect;
 *   • each side's Bond meter is tracked SEPARATELY — one player spending their
 *     Break must not reset the other's;
 *   • the rate cap is per side, so a flooding client cannot starve its opponent
 *     out of the shared budget.
 *
 * The log this consumes is the server's own `session.inputs`, already validated
 * for ownership and watermark at accept time, so this is the second line of
 * defence rather than the first.
 */
export function replayLockstepPetDuel(
    playerPets: Pet[],
    opponentPets: Pet[],
    params: SealedDuelParams,
    log: readonly DuelInputLogEntry[],
    /** Sides whose player dropped. Omitted when both played it out. */
    autonomy: readonly LockstepAutonomy[] = [],
): LockstepReplayResult {
    const { mode, seed, applyItems, accuracy, terrain } = params;
    const sim = mode === '2v2'
        ? createLivePartyCinematicDuel(
            playerPets[0], playerPets[1] ?? null, opponentPets[0], opponentPets[1] ?? null,
            seed, 1, 1, false, applyItems, accuracy, false,
        )
        : createLiveCinematicDuel(
            playerPets[0], opponentPets[0], seed, 1, 1, false, applyItems, accuracy, terrain, false,
        );
    // PvP has no PvE multipliers — both sides fight on their own stats — and BOTH
    // sides take orders, which the single-commander constructors do not set up.
    for (const f of sim.fighters) f.controlled = true;

    let i = 0;
    let applied = 0;
    let rateLimited = 0;
    let rejected = 0;
    const recent: Record<'p1' | 'p2', number[]> = { p1: [], p2: [] };
    const bondSpentAt: Record<'p1' | 'p2', number> = { p1: -1, p2: -1 };
    const count: Record<'p1' | 'p2', number> = { p1: 0, p2: 0 };
    // Standing orders for a dropped side, evaluated with the IDENTICAL pure
    // function both clients ran. Its Bond spends are tracked per actor, exactly as
    // the client tracks them, so the meter gates the same way on both.
    const doctrineBond = new Map<string, number>();

    for (let guard = 0; guard < MAX_REPLAY_TICKS; guard++) {
        applied += applyDoctrineTick(sim, autonomy, doctrineBond);
        while (i < log.length && log[i].t <= sim.t) {
            const { t, cmd } = log[i++];
            const side = actorSide(cmd.actorId);
            const window = recent[side];
            while (window.length && window[0] <= t - DUEL_TPS) window.shift();
            if (window.length >= MAX_COMMANDS_PER_SECOND || count[side] >= MAX_INPUT_LOG) {
                rateLimited++;
                continue;
            }
            if (cmd.kind === 'break' && bondCharge(sim.events, cmd.actorId, t, bondSpentAt[side]) < BOND_FULL) {
                rejected++;
                continue;
            }
            if (!applyDuelCommand(sim, cmd)) { rejected++; continue; }
            if (cmd.kind === 'break') bondSpentAt[side] = t - 1;
            window.push(t);
            count[side]++;
            applied++;
        }
        if (!stepCinematicDuel(sim)) break;
    }

    const final = finishCinematicDuel(sim);
    // `result` is from the "player" team's perspective, i.e. the challenger's.
    const winner = final.result === 'win' ? 'p1' : final.result === 'loss' ? 'p2' : null;
    return { outcome: final.result as PetDuelOutcome, winner, applied, rateLimited, rejected };
}
