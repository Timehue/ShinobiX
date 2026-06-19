"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TURN_AFK_MS = void 0;
exports.stampTurnClock = stampTurnClock;
exports.autoPassAfkHumans = autoPassAfkHumans;
/*
 * Battle Towers — live co-op (multiplayer) helpers.
 *
 * Handler-level utilities for real-time human co-op: a per-turn wall-clock so an
 * absent player's turn can auto-pass, keeping a run from deadlocking. The
 * deterministic engine never sees wall-clock — these wrap it at the handler edge,
 * exactly like the other handlers thread `now` in from outside.
 */
const _tower_session_js_1 = require("./_tower-session.js");
const _engine_js_1 = require("./_engine.js");
const _floor_catalog_js_1 = require("./_floor-catalog.js");
const _sim_js_1 = require("./_sim.js");
// A live player gets this long to act before their turn auto-passes (offline/AFK
// protection so a co-op run never stalls on someone who walked away).
exports.TURN_AFK_MS = 75_000;
/** Stamp when the CURRENT human's turn began. Call after advancing to a human. */
function stampTurnClock(session, now) {
    if (session.status === 'active')
        session.turnStartedAt = now;
}
/**
 * If the active actor is a HUMAN whose turn has gone stale (> TURN_AFK_MS), auto-'wait'
 * them and advance to the next human. Each freshly-active human gets a full window
 * (turnStartedAt is reset), so absent players pass one at a time rather than all at
 * once. Returns true if it advanced (the caller should persist). Pure w.r.t. the engine
 * (it only calls the deterministic engine functions); `now` is the only wall-clock.
 */
function autoPassAfkHumans(session, now) {
    if (session.status !== 'active')
        return false;
    const floor = (0, _floor_catalog_js_1.getFloor)(session.floor);
    if (!floor)
        return false;
    const rng = (0, _sim_js_1.makeRng)(session.seed);
    let advanced = false;
    let guard = 0;
    while (session.status === 'active' && guard++ < session.actors.length + 4) {
        const actor = (0, _tower_session_js_1.activeActor)(session);
        if (!actor || actor.ai !== false || actor.hp <= 0)
            break; // not a live human's live turn
        const started = Number(session.turnStartedAt ?? now);
        if (now - started < exports.TURN_AFK_MS)
            break; // current human still has time
        session.log.push(`${actor.name} was away — their turn passed.`);
        (0, _engine_js_1.endTurn)(session, floor);
        (0, _engine_js_1.runAiUntilHuman)(session, floor, rng); // advance past AI to the next human
        session.turnStartedAt = now; // fresh window for the next human
        advanced = true;
    }
    return advanced;
}
