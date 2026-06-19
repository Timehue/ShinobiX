/*
 * Battle Towers — live co-op (multiplayer) helpers.
 *
 * Handler-level utilities for real-time human co-op: a per-turn wall-clock so an
 * absent player's turn can auto-pass, keeping a run from deadlocking. The
 * deterministic engine never sees wall-clock — these wrap it at the handler edge,
 * exactly like the other handlers thread `now` in from outside.
 */
import { activeActor, type TowerSession } from './_tower-session.js';
import { endTurn, runAiUntilHuman } from './_engine.js';
import { getFloor } from './_floor-catalog.js';
import { makeRng } from './_sim.js';

// A live player gets this long to act before their turn auto-passes (offline/AFK
// protection so a co-op run never stalls on someone who walked away).
export const TURN_AFK_MS = 75_000;

/** Stamp when the CURRENT human's turn began. Call after advancing to a human. */
export function stampTurnClock(session: TowerSession, now: number): void {
    if (session.status === 'active') session.turnStartedAt = now;
}

/**
 * If the active actor is a HUMAN whose turn has gone stale (> TURN_AFK_MS), auto-'wait'
 * them and advance to the next human. Each freshly-active human gets a full window
 * (turnStartedAt is reset), so absent players pass one at a time rather than all at
 * once. Returns true if it advanced (the caller should persist). Pure w.r.t. the engine
 * (it only calls the deterministic engine functions); `now` is the only wall-clock.
 */
export function autoPassAfkHumans(session: TowerSession, now: number): boolean {
    if (session.status !== 'active') return false;
    const floor = getFloor(session.floor);
    if (!floor) return false;
    const rng = makeRng(session.seed);
    let advanced = false;
    let guard = 0;
    while (session.status === 'active' && guard++ < session.actors.length + 4) {
        const actor = activeActor(session);
        if (!actor || actor.ai !== false || actor.hp <= 0) break;   // not a live human's live turn
        const started = Number(session.turnStartedAt ?? now);
        if (now - started < TURN_AFK_MS) break;                     // current human still has time
        session.log.push(`${actor.name} was away — their turn passed.`);
        endTurn(session, floor);
        runAiUntilHuman(session, floor, rng);                       // advance past AI to the next human
        session.turnStartedAt = now;                                // fresh window for the next human
        advanced = true;
    }
    return advanced;
}
