// ─────────────────────────────────────────────────────────────────────────────
// pet-bond-meter.ts — the Bond gauge that gates Bond Break
// (docs/pet-coliseum-player-control-plan.md §4B).
//
// The pet's SIGNATURE is the coliseum's best-looking beat: it is the only move
// with a marquee cut-in and a full hero pose. The AI spends it on a cooldown
// timer, so it happens *at* the player. The Bond meter moves that decision to the
// player: fight well, fill the gauge, choose the moment.
//
// Deliberately NOT part of the simulation. It is a pure fold over the event log,
// which means (a) the deterministic engine is untouched, and (b) it self-heals
// when the live controller rewinds and re-simulates — the truncated event list
// simply yields the truncated meter, with no separate state to resynchronise.
// ─────────────────────────────────────────────────────────────────────────────
import type { DuelEvent } from "./pet-duel-sim";

export const BOND_FULL = 100;

/** Gains are tuned so a clean, aggressive fight earns roughly two Breaks over a
 *  35–45 s duel, and a defensive one still earns about one. Taking damage pays a
 *  little so a losing player is not locked out of their comeback button. */
export const BOND_GAINS = Object.freeze({
    hitLanded: 9,
    critBonus: 6,
    signatureBonus: 0,   // the Break already IS the signature — no self-refund
    dodged: 12,
    hitTaken: 5,
});

/**
 * Bond charge for `actorId` at `tick`, counting only events after `sinceTick`
 * (the tick the last Bond Break was spent on, or -1 for none). Clamped to
 * BOND_FULL, so a long fight cannot bank multiple Breaks.
 */
export function bondCharge(
    events: readonly DuelEvent[],
    actorId: string,
    tick: number,
    sinceTick = -1,
): number {
    let charge = 0;
    for (const e of events) {
        if (e.t > tick || e.t <= sinceTick) continue;
        if (e.type === "hit") {
            if (e.actorId === actorId) {
                charge += BOND_GAINS.hitLanded;
                if (e.crit) charge += BOND_GAINS.critBonus;
                if (e.signature) charge += BOND_GAINS.signatureBonus;
            } else if (e.targetId === actorId) {
                charge += BOND_GAINS.hitTaken;
            }
        } else if (e.type === "dodge" && e.actorId === actorId) {
            charge += BOND_GAINS.dodged;
        }
        if (charge >= BOND_FULL) return BOND_FULL;
    }
    return charge;
}

/** Convenience: is a Bond Break available right now? */
export const bondReady = (
    events: readonly DuelEvent[],
    actorId: string,
    tick: number,
    sinceTick = -1,
): boolean => bondCharge(events, actorId, tick, sinceTick) >= BOND_FULL;
