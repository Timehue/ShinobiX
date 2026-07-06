"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.towerActorToCombatFighter = towerActorToCombatFighter;
exports.towerActorToPvpFighter = towerActorToPvpFighter;
exports.towerJutsuToCombatJutsu = towerJutsuToCombatJutsu;
exports.normalizeTowerPlayerJutsuCombat = normalizeTowerPlayerJutsuCombat;
exports.resolveTowerPlayerJutsu = resolveTowerPlayerJutsu;
exports.clanBossTowerSessionToCombatBattleState = clanBossTowerSessionToCombatBattleState;
exports.resolveClanBossPlayerJutsu = resolveClanBossPlayerJutsu;
function towerActorToCombatFighter(actor) {
    const character = (actor.character ?? {});
    return {
        id: actor.id,
        side: actor.side,
        name: actor.name ?? actor.id,
        hp: Number(actor.hp ?? 0),
        maxHp: Number(actor.maxHp ?? actor.hp ?? 0),
        chakra: Number(actor.chakra ?? 0),
        maxChakra: Number(actor.maxChakra ?? actor.chakra ?? 0),
        stamina: Number(actor.stamina ?? 0),
        maxStamina: Number(actor.maxStamina ?? actor.stamina ?? 0),
        shield: Number(actor.shield ?? 0),
        statuses: actor.statuses ?? [],
        pos: Number(actor.pos ?? 0),
        character,
        stats: character.stats,
        jutsu: character.jutsu,
        items: character.pvpItems,
        equipment: character.equipment,
        cooldowns: { ...(actor.cooldowns ?? {}) },
    };
}
function towerActorToPvpFighter(actor) {
    return {
        name: actor.name,
        hp: actor.hp,
        maxHp: actor.maxHp,
        chakra: actor.chakra,
        maxChakra: actor.maxChakra,
        stamina: actor.stamina,
        maxStamina: actor.maxStamina,
        shield: actor.shield,
        statuses: actor.statuses.map(status => ({ ...status })),
        character: actor.character,
        pos: actor.pos,
    };
}
function towerJutsuToCombatJutsu(jutsu) {
    return {
        ...jutsu,
        id: String(jutsu.id ?? ''),
        name: String(jutsu.name ?? jutsu.id ?? 'Jutsu'),
        type: String(jutsu.type ?? 'Taijutsu'),
        tags: Array.isArray(jutsu.tags) ? jutsu.tags.map(tag => ({ ...tag, name: String(tag.name) })) : undefined,
    };
}
function resourceCostsForJutsu(jutsu, cooldownKey) {
    return {
        apCost: Math.max(0, Number(jutsu.ap ?? 40)),
        chakraCost: Math.max(0, Number(jutsu.chakraCost ?? 0)),
        staminaCost: Math.max(0, Number(jutsu.staminaCost ?? 0)),
        cooldownKey: String(cooldownKey ?? jutsu.id ?? ''),
        cooldownTurns: Math.max(0, Math.floor(Number(jutsu.cooldown ?? 0))),
    };
}
function targetDefenseFor(fighter) {
    const character = fighter.character ?? {};
    return {
        hp: fighter.hp,
        maxHp: fighter.maxHp,
        shield: fighter.shield,
        statuses: fighter.statuses,
        stats: fighter.stats,
        armorRawDR: typeof character.armorRawDR === 'number' ? character.armorRawDR : undefined,
        armorFactor: typeof character.armorFactor === 'number' ? character.armorFactor : undefined,
        guardDefensePct: typeof character.guardDefensePct === 'number' ? character.guardDefensePct : undefined,
        equipment: fighter.equipment,
    };
}
function normalizeTowerPlayerJutsuCombat(args) {
    const self = towerActorToCombatFighter(args.actor);
    const opponent = towerActorToCombatFighter(args.target);
    const jutsu = towerJutsuToCombatJutsu(args.jutsu);
    return {
        self,
        opponent,
        jutsu,
        resources: resourceCostsForJutsu(jutsu, args.cooldownKey),
        environment: {
            round: Number(args.session.round ?? 1),
            biome: String(args.session.map?.biome ?? 'central'),
            wMult: args.wMult ?? 1,
        },
        targetDefense: targetDefenseFor(opponent),
    };
}
function resolveTowerPlayerJutsu(args) {
    const normalized = normalizeTowerPlayerJutsuCombat(args);
    const self = towerActorToPvpFighter(args.actor);
    const opponent = args.actor.id === args.target.id ? towerActorToPvpFighter(args.actor) : towerActorToPvpFighter(args.target);
    const result = args.resolver(self, opponent, normalized.jutsu, normalized.environment.wMult, normalized.environment.biome, normalized.environment.round);
    return { ...result, normalized };
}
function towerGroundEffectToCombat(effect) {
    return { ...effect, owner: String(effect.owner) };
}
function clanBossTowerSessionToCombatBattleState(session) {
    const fighters = Object.fromEntries(session.actors.map(actor => [actor.id, towerActorToCombatFighter(actor)]));
    const activeActorId = session.turnQueue?.[session.activeIndex] ?? session.phaseState?.bossId ?? session.actors[0]?.id ?? 'unknown';
    const ap = Object.fromEntries(session.actors.map(actor => [actor.id, actor.id === activeActorId ? Number(session.activeAp ?? 0) : 0]));
    const cooldowns = Object.fromEntries(session.actors.map(actor => [actor.id, { ...(actor.cooldowns ?? {}) }]));
    return {
        battleId: session.runId ?? session.towerId ?? 'clan-boss',
        round: Number(session.round ?? 1),
        activeActorId,
        ap,
        actionsThisTurn: Number(session.actionsThisTurn ?? 0),
        cooldowns,
        fighters,
        groundEffects: session.groundEffects?.map(towerGroundEffectToCombat) ?? [],
        log: [...(session.log ?? [])],
        status: session.status ?? (session.winner ? 'done' : 'active'),
        winner: session.winner ?? null,
        meta: {
            towerId: session.towerId,
            floor: session.floor,
            partySize: session.partySize,
            bossId: session.phaseState?.bossId,
            biome: session.map?.biome,
        },
    };
}
function resolveClanBossPlayerJutsu(args) {
    return args.resolver(args.self, args.opponent, args.jutsu, args.wMult ?? 1, args.biome ?? 'central', args.round ?? 1);
}
