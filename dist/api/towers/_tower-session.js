"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActor = getActor;
exports.actorsOnSide = actorsOnSide;
exports.livingOnSide = livingOnSide;
exports.isSideAlive = isSideAlive;
exports.activeActor = activeActor;
exports.createTowerSession = createTowerSession;
// ─── accessors / invariants ──────────────────────────────────────────────────
function getActor(session, id) {
    return session.actors.find(a => a.id === id);
}
function actorsOnSide(session, side) {
    return session.actors.filter(a => a.side === side);
}
function livingOnSide(session, side) {
    return session.actors.filter(a => a.side === side && a.hp > 0);
}
function isSideAlive(session, side) {
    return session.actors.some(a => a.side === side && a.hp > 0);
}
/** The actor whose turn it currently is (undefined if the queue is exhausted / session done). */
function activeActor(session) {
    const id = session.turnQueue[session.activeIndex];
    return id ? getActor(session, id) : undefined;
}
function createTowerSession(p) {
    const hasNpc = p.actors.some(a => a.side === 'npc');
    return {
        towerId: p.towerId,
        runId: p.runId,
        floor: p.floor,
        seed: p.seed,
        partySize: p.partySize,
        map: p.map,
        actors: p.actors,
        turnQueue: [], // built by the engine on first advance
        activeIndex: 0,
        round: 1,
        activeAp: 0,
        actionsThisTurn: 0,
        groundEffects: [],
        objectiveState: {
            kind: p.objectiveKind,
            ...(hasNpc ? { npcAlive: true } : {}),
            completed: false,
            failed: false,
        },
        phaseState: {
            bossId: p.bossId,
            // descending so the engine pops the highest threshold first
            pendingPhases: (p.bossPhases ?? []).slice().sort((a, b) => b - a),
            triggeredPhases: [],
        },
        status: 'active',
        winner: null,
        recentMoveTokens: [],
        rewardSettlementState: 'pending',
        log: [],
        createdAt: p.now,
        lastActionAt: p.now,
    };
}
