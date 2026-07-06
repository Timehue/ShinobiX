"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pvpFighterToCombatFighter = pvpFighterToCombatFighter;
exports.combatFighterToPvpFighter = combatFighterToPvpFighter;
exports.pvpSessionToCombatBattleState = pvpSessionToCombatBattleState;
exports.applyCombatResolveResultToPvpSession = applyCombatResolveResultToPvpSession;
function roleFromActorId(actorId) {
    return actorId === 'p2' ? 'p2' : 'p1';
}
function pvpFighterToCombatFighter(fighter, role, session) {
    const character = fighter.character;
    return {
        id: role,
        side: 'player',
        name: fighter.name,
        hp: fighter.hp,
        maxHp: fighter.maxHp,
        chakra: fighter.chakra,
        maxChakra: fighter.maxChakra,
        stamina: fighter.stamina,
        maxStamina: fighter.maxStamina,
        shield: fighter.shield,
        statuses: fighter.statuses,
        pos: fighter.pos,
        character,
        stats: character.stats,
        jutsu: character.jutsu,
        items: character.pvpItems,
        equipment: character.equipment,
        cooldowns: session.cooldowns[role],
    };
}
function combatFighterToPvpFighter(fighter, previous) {
    return {
        ...previous,
        name: fighter.name,
        hp: fighter.hp,
        maxHp: fighter.maxHp,
        chakra: fighter.chakra,
        maxChakra: fighter.maxChakra,
        stamina: fighter.stamina,
        maxStamina: fighter.maxStamina,
        shield: fighter.shield,
        statuses: fighter.statuses,
        character: fighter.character ?? previous.character,
        pos: fighter.pos,
    };
}
function pvpGroundEffectToCombat(effect) {
    return { ...effect, owner: effect.owner };
}
function combatGroundEffectToPvp(effect) {
    return { ...effect, owner: roleFromActorId(effect.owner) };
}
function pvpSessionToCombatBattleState(session) {
    return {
        battleId: session.battleId,
        round: session.round,
        activeActorId: session.activePlayer,
        ap: { p1: session.ap.p1, p2: session.ap.p2 },
        actionsThisTurn: session.actionsThisTurn,
        cooldowns: {
            p1: { ...session.cooldowns.p1 },
            p2: { ...session.cooldowns.p2 },
        },
        fighters: {
            p1: pvpFighterToCombatFighter(session.p1, 'p1', session),
            p2: pvpFighterToCombatFighter(session.p2, 'p2', session),
        },
        groundEffects: session.groundEffects?.map(pvpGroundEffectToCombat),
        log: [...session.log],
        status: session.status,
        winner: session.winner,
        meta: {
            biome: session.biome,
            weatherPositiveElement: session.weatherPositiveElement,
            weatherNegativeElement: session.weatherNegativeElement,
            ranked: session.ranked,
            rankedKind: session.rankedKind,
        },
    };
}
function applyCombatResolveResultToPvpSession(session, result) {
    let next = { ...session };
    const p1 = result.fighters?.p1;
    const p2 = result.fighters?.p2;
    if (p1)
        next = { ...next, p1: combatFighterToPvpFighter(p1, next.p1) };
    if (p2)
        next = { ...next, p2: combatFighterToPvpFighter(p2, next.p2) };
    if (result.ap)
        next = { ...next, ap: { ...next.ap, p1: result.ap.p1 ?? next.ap.p1, p2: result.ap.p2 ?? next.ap.p2 } };
    if (result.cooldowns) {
        next = {
            ...next,
            cooldowns: {
                p1: result.cooldowns.p1 ?? next.cooldowns.p1,
                p2: result.cooldowns.p2 ?? next.cooldowns.p2,
            },
        };
    }
    if (result.groundEffects)
        next = { ...next, groundEffects: result.groundEffects.map(combatGroundEffectToPvp) };
    if (result.log)
        next = { ...next, log: result.log };
    if (result.status)
        next = { ...next, status: result.status };
    if (result.winner !== undefined)
        next = { ...next, winner: result.winner === 'draw' ? 'draw' : result.winner === 'p2' ? 'p2' : result.winner === 'p1' ? 'p1' : next.winner };
    if (result.fx)
        next = { ...next, fx: result.fx.map(fx => ({ ...fx, target: roleFromActorId(fx.target) })) };
    if (result.fxSeq !== undefined)
        next = { ...next, fxSeq: result.fxSeq };
    return next;
}
