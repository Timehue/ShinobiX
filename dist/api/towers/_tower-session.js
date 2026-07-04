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
    // Wave 3: a sealed 'extraPhase' modifier injects a DESPERATION gate into the boss's
    // HP-phase ladder. Merge it into the authored phases (deduped) so tickBossPhases fires it
    // exactly once; seal the threshold so the engine knows WHICH crossing is the blast. Story +
    // floors < 15 carry no extraPhase modifier → basePhases only, byte-identical.
    const basePhases = (p.bossPhases ?? []).slice();
    const extraPhases = (p.ascension?.modifierStack ?? [])
        .filter(m => m.kind === 'extraPhase')
        .map(m => Math.max(1, Math.min(99, Math.floor(Number(m.value) || 0))))
        .filter(v => v > 0);
    const extraPhaseThreshold = extraPhases.length ? Math.max(...extraPhases) : undefined;
    // Add only NON-colliding extra gates so a collision fires one gate (native mechanic + blast),
    // never two; base phases are left byte-for-byte untouched (story runs seal no extraPhases →
    // basePhases only, identical to the pre-Wave-3 `.slice().sort()`).
    const extrasToAdd = extraPhases.filter(v => !basePhases.includes(v));
    const pendingPhases = [...basePhases, ...extrasToAdd].sort((a, b) => b - a);
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
            // descending so the engine pops the highest threshold first (Wave-3 desperation
            // gate already merged + deduped into pendingPhases above).
            pendingPhases,
            triggeredPhases: [],
        },
        status: 'active',
        winner: null,
        recentMoveTokens: [],
        rewardSettlementState: 'pending',
        log: [],
        createdAt: p.now,
        lastActionAt: p.now,
        // Endless Spire: seal the ascension modifiers (absent → undefined, story unchanged).
        ...(p.ascension ? {
            ascensionTier: p.ascension.ascensionTier,
            spireBossId: p.spireBossId,
            roundCap: p.ascension.roundCap,
            enrageCap: p.ascension.enrageCap,
            dmgMult: p.ascension.dmgMult,
            modifierStack: p.ascension.modifierStack,
            ...(typeof extraPhaseThreshold === 'number' ? { extraPhaseThreshold } : {}),
            ...(typeof p.regenFlatCap === 'number' ? { regenFlatCap: p.regenFlatCap } : {}),
        } : {}),
    };
}
