import type { CombatBattleState, CombatFighter, CombatGroundEffect, CombatJutsu } from '../combat-core/types.js';
import type { CombatFxEvent } from '../combat-core/types.js';
import type { PvpFighter } from '../pvp/session.js';
import type { TowerActor, TowerSession } from '../towers/_tower-session.js';

export type TowerPlayerCombatResources = {
    apCost: number;
    chakraCost: number;
    staminaCost: number;
    cooldownKey: string;
    cooldownTurns: number;
};

export type TowerPlayerCombatEnvironment = {
    round: number;
    biome: string;
    wMult: number;
    weatherPositiveElement?: string;
    weatherNegativeElement?: string;
};

export type TowerTargetDefenseProfile = {
    hp: number;
    maxHp: number;
    shield: number;
    statuses: CombatFighter['statuses'];
    stats?: CombatFighter['stats'];
    armorRawDR?: number;
    armorFactor?: number;
    guardDefensePct?: number;
    equipment?: CombatFighter['equipment'];
};

export type TowerPlayerJutsuCombatInput = {
    self: CombatFighter;
    opponent: CombatFighter;
    jutsu: CombatJutsu;
    resources: TowerPlayerCombatResources;
    environment: TowerPlayerCombatEnvironment;
    targetDefense: TowerTargetDefenseProfile;
};

export type TowerPlayerJutsuResult = {
    self: PvpFighter;
    opponent: PvpFighter;
    lines: string[];
    fx: CombatFxEvent[];
};

export type TowerPlayerJutsuResolver = (
    self: PvpFighter,
    opponent: PvpFighter,
    jutsu: CombatJutsu,
    wMult: number,
    biome: string,
    round: number,
) => TowerPlayerJutsuResult;

export function towerActorToCombatFighter(actor: TowerActor): CombatFighter {
    const character = (actor.character ?? {}) as Record<string, unknown>;
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
        stats: character.stats as CombatFighter['stats'],
        jutsu: character.jutsu as CombatFighter['jutsu'],
        items: character.pvpItems as CombatFighter['items'],
        equipment: character.equipment as CombatFighter['equipment'],
        cooldowns: { ...(actor.cooldowns ?? {}) },
    };
}

export function towerActorToPvpFighter(actor: TowerActor): PvpFighter {
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

export function towerJutsuToCombatJutsu(jutsu: CombatJutsu): CombatJutsu {
    return {
        ...jutsu,
        id: String(jutsu.id ?? ''),
        name: String(jutsu.name ?? jutsu.id ?? 'Jutsu'),
        type: String(jutsu.type ?? 'Taijutsu'),
        tags: Array.isArray(jutsu.tags) ? jutsu.tags.map(tag => ({ ...tag, name: String(tag.name) })) : undefined,
    };
}

function resourceCostsForJutsu(jutsu: CombatJutsu, cooldownKey?: string): TowerPlayerCombatResources {
    return {
        apCost: Math.max(0, Number(jutsu.ap ?? 40)),
        chakraCost: Math.max(0, Number(jutsu.chakraCost ?? 0)),
        staminaCost: Math.max(0, Number(jutsu.staminaCost ?? 0)),
        cooldownKey: String(cooldownKey ?? jutsu.id ?? ''),
        cooldownTurns: Math.max(0, Math.floor(Number(jutsu.cooldown ?? 0))),
    };
}

function targetDefenseFor(fighter: CombatFighter): TowerTargetDefenseProfile {
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

export function normalizeTowerPlayerJutsuCombat(args: {
    session: Pick<TowerSession, 'round' | 'map'>;
    actor: TowerActor;
    target: TowerActor;
    jutsu: CombatJutsu;
    wMult?: number;
    cooldownKey?: string;
}): TowerPlayerJutsuCombatInput {
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

export function resolveTowerPlayerJutsu(args: {
    session: Pick<TowerSession, 'round' | 'map'>;
    actor: TowerActor;
    target: TowerActor;
    jutsu: CombatJutsu;
    resolver: TowerPlayerJutsuResolver;
    wMult?: number;
    cooldownKey?: string;
}): TowerPlayerJutsuResult & { normalized: TowerPlayerJutsuCombatInput } {
    const normalized = normalizeTowerPlayerJutsuCombat(args);
    const self = towerActorToPvpFighter(args.actor);
    const opponent = args.actor.id === args.target.id ? towerActorToPvpFighter(args.actor) : towerActorToPvpFighter(args.target);
    const result = args.resolver(
        self,
        opponent,
        normalized.jutsu,
        normalized.environment.wMult,
        normalized.environment.biome,
        normalized.environment.round,
    );
    return { ...result, normalized };
}

function towerGroundEffectToCombat(effect: TowerSession['groundEffects'][number]): CombatGroundEffect {
    return { ...effect, owner: String(effect.owner) };
}

export function clanBossTowerSessionToCombatBattleState(session: TowerSession): CombatBattleState {
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

export type ClanBossPlayerJutsuResolver<TFighter, TJutsu, TResult> = (
    self: TFighter,
    opponent: TFighter,
    jutsu: TJutsu,
    wMult: number,
    biome: string,
    round: number,
) => TResult;

export function resolveClanBossPlayerJutsu<TFighter, TJutsu, TResult>(args: {
    self: TFighter;
    opponent: TFighter;
    jutsu: TJutsu;
    resolver: ClanBossPlayerJutsuResolver<TFighter, TJutsu, TResult>;
    wMult?: number;
    biome?: string;
    round?: number;
}): TResult {
    return args.resolver(
        args.self,
        args.opponent,
        args.jutsu,
        args.wMult ?? 1,
        args.biome ?? 'central',
        args.round ?? 1,
    );
}
