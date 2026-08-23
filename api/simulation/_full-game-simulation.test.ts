import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
    STAT_KEYS,
    creditPvpWinBase,
    gainXp,
    maxChakraForLevel,
    maxHpForLevel,
    maxStaminaForLevel,
    rankFromLevel,
    type Stats,
} from '../_xp-engine.js';
import { computeBankInterest } from '../_bank-interest.js';
import { applyTxnToAgg, duplicateTxnIds, type EconAgg, type EconTxn } from '../_economy.js';
import {
    ACADEMY_TRIAL,
    applyCurrencyRewardFields,
    boostAmount,
    combatMissionByKey,
    grantItemsToInventory,
    hasDailyHuntSlot,
    hasDailyMissionSlot,
    huntMissionById,
    markHuntCompletedFields,
    markMissionCompletedFields,
    missionRewardBonusPct,
} from '../missions/_mission-catalog.js';
import { JUTSU_CATALOG, type CatalogJutsu } from '../pvp/_jutsu-catalog.js';
import { ITEM_CATALOG, type CatalogItem } from '../pvp/_item-catalog.js';
import { applyJutsu } from '../pvp/move.js';
import type { PvpFighter } from '../pvp/session.js';
import { extractAssaultResult } from '../clan-boss/_assault.js';
import {
    CB_ASSAULT_HP_CAP,
    CB_ASSAULTS_PER_MEMBER,
    CLAN_BOSS_BY_ID,
    bankAssault,
    clanBossDamageDealt,
    clanBossScore,
    clanBossWeekId,
    newClanBossProgress,
    reserveAttempt,
} from '../clan-boss/_storage.js';
import { buildTowerEncounter, type SquadMemberInput } from '../towers/_encounter.js';
import { CLAN_BOSS_FLOORS, getFloor, type TowerFloor } from '../towers/_floor-catalog.js';
import { applyAction, runTowerFloor, startRound } from '../towers/_engine.js';
import { createTowerSession, getActor, type TowerActor, type TowerMap, type TowerSession } from '../towers/_tower-session.js';
import { makeRng } from '../towers/_sim.js';

const NOW = Date.UTC(2026, 6, 6, 12, 0, 0);
const TODAY_KEY = '2026-07-06';
const MONTH_KEY = '2026-07';
const MAP8: TowerMap = { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] };

const VILLAGES = ['Ashen Leaf', 'Stormveil', 'Frostfang', 'Moonshadow'] as const;
const SPECIALTIES = ['Ninjutsu', 'Taijutsu', 'Genjutsu', 'Bukijutsu'] as const;
type Specialty = typeof SPECIALTIES[number];

type SimCharacter = {
    name: string;
    village: string;
    specialty: Specialty;
    bloodline: string;
    level: number;
    xp: number;
    rankTitle: string;
    ryo: number;
    bankRyo: number;
    hp: number;
    maxHp: number;
    chakra: number;
    maxChakra: number;
    stamina: number;
    maxStamina: number;
    stats: Stats;
    inventory: string[];
    equipment: Record<string, string>;
    pvpItems: Array<CatalogItem | typeof NAMED_WEAPON>;
    jutsu: CatalogJutsu[];
    equippedJutsuIds: string[];
    jutsuMastery: Array<{ jutsuId: string; level: number; xp: number }>;
    examsPassed: string[];
    villageUpgrades: Record<string, number>;
    currentSector: number;
    dailyMissionsCompleted?: number;
    dailyHuntsCompleted?: number;
    lastDailyReset?: string;
    lastHuntReset?: string;
    clanMissionContrib?: number;
    totalMissionsCompleted?: number;
    clanContribMonth?: string;
    fateShards?: number;
    honorSeals?: number;
    boneCharms?: number;
    auraStones?: number;
    auraDust?: number;
    mythicSeals?: number;
    lastBankInterestAt?: number;
    academyTrialClaimed?: boolean;
    [key: string]: unknown;
};

const OFFENSE_BY_SPECIALTY: Record<Specialty, keyof Stats> = {
    Ninjutsu: 'ninjutsuOffense',
    Taijutsu: 'taijutsuOffense',
    Genjutsu: 'genjutsuOffense',
    Bukijutsu: 'bukijutsuOffense',
};

const DEFENSE_BY_SPECIALTY: Record<Specialty, keyof Stats> = {
    Ninjutsu: 'ninjutsuDefense',
    Taijutsu: 'taijutsuDefense',
    Genjutsu: 'genjutsuDefense',
    Bukijutsu: 'bukijutsuDefense',
};

const BLOODLINE_BY_SPECIALTY: Record<Specialty, string> = {
    Ninjutsu: 'Inferno Cataclysm',
    Taijutsu: 'Iron Fang',
    Genjutsu: 'Ashen Eyes',
    Bukijutsu: 'Shadow Lotus',
};

const JUTSU_LOADOUTS: Record<Specialty, string[]> = {
    Ninjutsu: ['starter-nin-fire-2', 'starter-nin-lightning-aoe', 'inferno-cataclysm-lava-burst', 'starter-universal-flicker'],
    Taijutsu: ['starter-tai-earth-2', 'starter-tai-fire-aoe', 'iron-fang-ferrous-crash', 'starter-universal-flicker'],
    Genjutsu: ['starter-gen-lightning-2', 'starter-gen-fire-aoe', 'ashen-eyes-blood-gaze', 'starter-universal-flicker'],
    Bukijutsu: ['starter-buki-wind-2', 'starter-buki-water-aoe', 'shadow-lotus-umbra-senbon', 'starter-universal-flicker'],
};

const CUSTOM_JUTSU: CatalogJutsu = {
    id: 'custom-crystal-prison',
    name: 'Crystal Prison',
    type: 'Ninjutsu',
    element: 'Earth',
    ap: 60,
    range: 4,
    effectPower: 34,
    cooldown: 4,
    chakraCost: 120,
    staminaCost: 80,
    target: 'OPPONENT',
    method: 'SINGLE',
    battleDescription: 'A lattice of crystal pins the target in place.',
    tags: [{ name: 'Wound', percent: 24 }, { name: 'Decrease Damage Given', percent: 18 }],
    bloodlineRank: 'A Rank',
};

const NAMED_WEAPON: CatalogItem = {
    id: 'named-moonlit-sabre',
    name: 'Moonlit Sabre',
    slot: 'hand',
    rarity: 'legendary',
    weaponRange: 4,
    weaponCooldown: 5,
    weaponEp: 34,
    weaponTags: [{ name: 'Wound', percent: 22 }, { name: 'Lifesteal', percent: 15 }],
    bonuses: { bukijutsuOffense: 140, ninjutsuOffense: 80 },
};

function catalogJutsu(id: string): CatalogJutsu {
    const found = JUTSU_CATALOG[id];
    assert.ok(found, `missing jutsu ${id}`);
    return { ...found, tags: found.tags.map((tag) => ({ ...tag })) };
}

function catalogItem(id: string): CatalogItem {
    const found = ITEM_CATALOG[id];
    assert.ok(found, `missing item ${id}`);
    return { ...found, bonuses: { ...(found.bonuses ?? {}) }, weaponTags: found.weaponTags?.map((tag) => ({ ...tag })) };
}

function statsFor(level: number, specialty: Specialty): Stats {
    const base = Math.min(2500, Math.max(10, 80 + level * 23));
    const stats = STAT_KEYS.reduce((acc, key) => {
        acc[key] = base;
        return acc;
    }, {} as Stats);
    stats.strength = Math.min(2500, base + Math.floor(level * 3));
    stats.speed = Math.min(2500, base + Math.floor(level * 2));
    stats.intelligence = Math.min(2500, base + Math.floor(level * 2));
    stats.willpower = Math.min(2500, base + Math.floor(level * 3));
    stats[OFFENSE_BY_SPECIALTY[specialty]] = Math.min(2500, base + 350);
    stats[DEFENSE_BY_SPECIALTY[specialty]] = Math.min(2500, base + 250);
    return stats;
}

function jutsuFor(specialty: Specialty): CatalogJutsu[] {
    return [...JUTSU_LOADOUTS[specialty].map(catalogJutsu), { ...CUSTOM_JUTSU, tags: CUSTOM_JUTSU.tags.map((tag) => ({ ...tag })) }];
}

function makeCharacter(index: number, opts: { level?: number; namedWeapon?: boolean } = {}): SimCharacter {
    const specialty = SPECIALTIES[index % SPECIALTIES.length]!;
    const village = VILLAGES[index % VILLAGES.length]!;
    const level = opts.level ?? (1 + index);
    const maxHp = maxHpForLevel(level);
    const maxChakra = maxChakraForLevel(level);
    const maxStamina = maxStaminaForLevel(level);
    const jutsu = jutsuFor(specialty);
    const hand = opts.namedWeapon ? NAMED_WEAPON.id : (specialty === 'Taijutsu' ? 'training-katana' : 'rustfang-kunai');
    const pvpItems: Array<CatalogItem | typeof NAMED_WEAPON> = [
        opts.namedWeapon ? NAMED_WEAPON : catalogItem(hand),
        catalogItem('shinobi-vest'),
        catalogItem('thrown-shuriken'),
        catalogItem('item-attack-pill'),
        catalogItem('potion-rejuvenation'),
        catalogItem('aura-sphere'),
    ];
    return {
        name: `${village.replace(/\s+/g, '')}${specialty}${index}`,
        village,
        specialty,
        bloodline: BLOODLINE_BY_SPECIALTY[specialty],
        level,
        xp: 0,
        rankTitle: rankFromLevel(level),
        ryo: 500 + level * 20,
        bankRyo: 2500 + level * 80,
        hp: maxHp,
        maxHp,
        chakra: maxChakra,
        maxChakra,
        stamina: maxStamina,
        maxStamina,
        stats: statsFor(level, specialty),
        inventory: [
            hand,
            'shinobi-vest',
            'thrown-shuriken',
            'thrown-shuriken',
            'thrown-shuriken',
            'item-attack-pill',
            'item-attack-pill',
            'potion-rejuvenation',
            'potion-rejuvenation',
            'aura-sphere',
        ],
        equipment: {
            hand,
            body: 'shinobi-vest',
            thrown: 'thrown-shuriken',
            item: 'item-attack-pill',
            potion: 'potion-rejuvenation',
            aura: 'aura-sphere',
        },
        pvpItems,
        jutsu,
        equippedJutsuIds: jutsu.map((entry) => entry.id),
        jutsuMastery: jutsu.map((entry) => ({ jutsuId: entry.id, level: Math.min(50, Math.max(1, level)), xp: 0 })),
        examsPassed: ['genin', 'chunin'],
        villageUpgrades: { missionHall: 10, bank: 25, training: 8, shop: 6, hospital: 5 },
        currentSector: 1,
        fateShards: 0,
        honorSeals: 0,
        boneCharms: 0,
        auraStones: 0,
        auraDust: 0,
        mythicSeals: 0,
        lastBankInterestAt: NOW - 2 * 24 * 60 * 60 * 1000,
    };
}

function withXp(char: SimCharacter, amount: number): SimCharacter {
    return gainXp(char, amount) as SimCharacter;
}

function applyAcademyTrial(char: SimCharacter): SimCharacter {
    const leveled = withXp(char, ACADEMY_TRIAL.xp);
    return {
        ...leveled,
        ryo: Number(leveled.ryo) + ACADEMY_TRIAL.ryo,
        stamina: Math.min(Number(leveled.maxStamina), Number(leveled.stamina) + ACADEMY_TRIAL.stamina),
        academyTrialClaimed: true,
    };
}

function applyCombatMission(char: SimCharacter, missionKey: string): SimCharacter {
    const mission = combatMissionByKey(missionKey);
    assert.ok(mission, `missing mission ${missionKey}`);
    assert.ok(hasDailyMissionSlot(char, TODAY_KEY), 'mission daily cap exhausted');
    const bonusPct = missionRewardBonusPct(char);
    const leveled = withXp(char, boostAmount(mission.xp, bonusPct));
    return {
        ...leveled,
        ryo: Number(leveled.ryo) + boostAmount(mission.ryo, bonusPct),
        ...markMissionCompletedFields(leveled, TODAY_KEY, MONTH_KEY),
    };
}

function applyHunt(char: SimCharacter, huntId: string): SimCharacter {
    const hunt = huntMissionById(huntId);
    assert.ok(hunt, `missing hunt ${huntId}`);
    assert.ok(hasDailyHuntSlot(char, TODAY_KEY), 'hunt daily cap exhausted');
    const bonusPct = missionRewardBonusPct(char);
    const leveled = withXp(char, boostAmount(hunt.xpReward, bonusPct));
    return {
        ...leveled,
        ryo: Number(leveled.ryo) + boostAmount(hunt.ryoReward, bonusPct),
        stamina: Math.min(Number(leveled.maxStamina), Number(leveled.stamina) + hunt.staminaReward),
        inventory: grantItemsToInventory(leveled, hunt.itemRewards),
        ...applyCurrencyRewardFields(leveled, hunt.currencyRewards),
        ...markHuntCompletedFields(leveled, TODAY_KEY, MONTH_KEY),
    };
}

function itemChargesFor(char: SimCharacter): Record<string, number> {
    const inventory = char.inventory;
    const count = (id: string) => inventory.filter((entry) => entry === id).length;
    return {
        'thrown-shuriken': count('thrown-shuriken'),
        'item-attack-pill': count('item-attack-pill'),
        'potion-rejuvenation': Math.min(2, count('potion-rejuvenation')),
    };
}

function combatSnapshot(char: SimCharacter): Record<string, unknown> {
    return {
        name: char.name,
        village: char.village,
        level: char.level,
        specialty: char.specialty,
        stats: { ...char.stats },
        maxHp: char.maxHp,
        maxChakra: char.maxChakra,
        maxStamina: char.maxStamina,
        jutsu: char.jutsu.map((entry) => ({ ...entry, tags: entry.tags.map((tag) => ({ ...tag })) })),
        equippedJutsuIds: [...char.equippedJutsuIds],
        jutsuMastery: char.jutsuMastery.map((entry) => ({ ...entry })),
        pvpItems: char.pvpItems.map((entry) => ({ ...entry, bonuses: { ...(entry.bonuses ?? {}) }, weaponTags: entry.weaponTags?.map((tag) => ({ ...tag })) })),
        equipment: { ...char.equipment },
        bloodlineMult: 1.08,
    };
}

function squadMember(char: SimCharacter, index: number, ai = true): SquadMemberInput {
    return {
        id: `sq-${index}`,
        name: char.name,
        ownerSlug: slug(char.name),
        ai,
        character: combatSnapshot(char),
        itemCharges: itemChargesFor(char),
    };
}

function makeTowerActor(id: string, side: TowerActor['side'], pos: number, character: Record<string, unknown>, over: Partial<TowerActor> = {}): TowerActor {
    const maxHp = Math.max(1, Number(character.maxHp ?? over.maxHp ?? 1000));
    const maxChakra = Math.max(0, Number(character.maxChakra ?? over.maxChakra ?? 1000));
    const maxStamina = Math.max(0, Number(character.maxStamina ?? over.maxStamina ?? 1000));
    return {
        id,
        side,
        name: String(character.name ?? id),
        ownerSlug: side === 'squad' ? slug(String(character.name ?? id)) : null,
        ai: true,
        hp: maxHp,
        maxHp,
        chakra: maxChakra,
        maxChakra,
        stamina: maxStamina,
        maxStamina,
        shield: 0,
        statuses: [],
        cooldowns: {},
        pos,
        character,
        ...over,
    };
}

function makeSession(actors: TowerActor[], floor: TowerFloor, opts: Partial<Parameters<typeof createTowerSession>[0]> = {}): TowerSession {
    return createTowerSession({
        towerId: 'simulation',
        runId: `simulation-${floor.id}`,
        floor: floor.id,
        seed: 12345,
        partySize: actors.filter((actor) => actor.side === 'squad').length,
        map: MAP8,
        actors,
        objectiveKind: floor.objective,
        now: NOW,
        ...opts,
    });
}

function makeFloor(objective: TowerFloor['objective'] = 'defeat-all'): TowerFloor {
    return {
        id: 1,
        name: 'Simulation Arena',
        biome: 'forest',
        objective,
        roundBudget: 10,
        map: { width: MAP8.width, height: MAP8.height },
        fieldRule: { kind: 'none' },
        enemies: [],
        firstClearReward: {},
    };
}

function pvpFighter(char: SimCharacter, pos: number): PvpFighter {
    return {
        name: char.name,
        hp: char.hp,
        maxHp: char.maxHp,
        chakra: char.chakra,
        maxChakra: char.maxChakra,
        stamina: char.stamina,
        maxStamina: char.maxStamina,
        shield: 0,
        statuses: [],
        character: combatSnapshot(char),
        pos,
    };
}

function forceActive(session: TowerSession, actorId: string): void {
    if (session.turnQueue.length === 0) startRound(session);
    const idx = session.turnQueue.indexOf(actorId);
    assert.notEqual(idx, -1, `actor ${actorId} was not in the turn queue`);
    session.activeIndex = idx;
    session.activeAp = 100;
    session.actionsThisTurn = 0;
}

function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function assertFiniteNumber(label: string, value: unknown): void {
    assert.equal(typeof value, 'number', `${label} should be numeric`);
    assert.ok(Number.isFinite(value), `${label} should be finite`);
}

function assertHealthyCharacter(char: SimCharacter): void {
    for (const key of ['level', 'xp', 'ryo', 'bankRyo', 'hp', 'maxHp', 'chakra', 'maxChakra', 'stamina', 'maxStamina'] as const) {
        assertFiniteNumber(`${char.name}.${key}`, char[key]);
    }
    assert.ok(char.level >= 1 && char.level <= 100, `${char.name} level out of range`);
    assert.ok(char.ryo >= 0, `${char.name} negative wallet ryo`);
    assert.ok(char.bankRyo >= 0, `${char.name} negative bank ryo`);
    assert.ok(char.hp >= 0 && char.hp <= char.maxHp, `${char.name} hp out of range`);
    assert.ok(char.chakra >= 0 && char.chakra <= char.maxChakra, `${char.name} chakra out of range`);
    assert.ok(char.stamina >= 0 && char.stamina <= char.maxStamina, `${char.name} stamina out of range`);
    for (const stat of STAT_KEYS) {
        assertFiniteNumber(`${char.name}.stats.${stat}`, char.stats[stat]);
        assert.ok(char.stats[stat] >= 0 && char.stats[stat] <= 2500, `${char.name}.${stat} out of range`);
    }
    assert.ok(Array.isArray(char.inventory), `${char.name} inventory missing`);
    assert.ok(Number(char.dailyMissionsCompleted ?? 0) <= 20, `${char.name} mission daily cap exceeded`);
    assert.ok(Number(char.dailyHuntsCompleted ?? 0) <= 20, `${char.name} hunt daily cap exceeded`);
}

function assertHealthySession(session: TowerSession): void {
    assert.equal(session.status, 'done');
    for (const actor of session.actors) {
        assertFiniteNumber(`${actor.id}.hp`, actor.hp);
        assertFiniteNumber(`${actor.id}.chakra`, actor.chakra);
        assertFiniteNumber(`${actor.id}.stamina`, actor.stamina);
        assert.ok(actor.hp >= 0 && actor.hp <= actor.maxHp, `${actor.id} hp out of range`);
        assert.ok(actor.chakra >= 0 && actor.chakra <= actor.maxChakra, `${actor.id} chakra out of range`);
        assert.ok(actor.stamina >= 0 && actor.stamina <= actor.maxStamina, `${actor.id} stamina out of range`);
        for (const value of Object.values(actor.cooldowns)) assert.ok(Number.isFinite(value) && value >= 0);
        for (const value of Object.values(actor.itemCharges ?? {})) assert.ok(Number.isFinite(value) && value >= 0);
        for (const value of Object.values(actor.itemsUsed ?? {})) assert.ok(Number.isFinite(value) && value >= 0);
    }
}

describe('full game simulation harness', () => {
    it('walks a new player through onboarding, missions, a first fight, travel, and reload', () => {
        let player = makeCharacter(0, { level: 1 });
        player = applyAcademyTrial(player);
        player = applyCombatMission(player, 'combat-e-drill');
        player = applyHunt(player, 'hunt-wild-boar');
        player.currentSector = 2;

        const floor = makeFloor('defeat-all');
        const enemyChar = { name: 'Academy Sparring Clone', specialty: 'Taijutsu', level: 1, stats: statsFor(1, 'Taijutsu'), maxHp: 220, maxChakra: 200, maxStamina: 200 };
        const session = makeSession([
            makeTowerActor('sq-0', 'squad', 0, combatSnapshot(player)),
            makeTowerActor('en-0', 'enemy', 1, enemyChar, { hp: 220, maxHp: 220 }),
        ], floor);
        const result = runTowerFloor(session, floor, makeRng(101));

        assertHealthySession(result);
        assert.equal(result.winner, 'squad');
        assert.equal(player.academyTrialClaimed, true);
        assert.equal(player.inventory.includes('territory-control-scroll'), false, 'normal missions and hunts must not grant Territory Scrolls');
        assert.ok(player.inventory.includes('hunt-beast-meat'), 'hunt rewards should grant materials');
        assertHealthyCharacter(player);

        const reloaded = JSON.parse(JSON.stringify(player)) as SimCharacter;
        assert.deepEqual(reloaded.equipment, player.equipment);
        assert.equal(reloaded.currentSector, 2);
        assertHealthyCharacter(reloaded);
    });

    it('runs all villages and specialties through tower combat, PvP parity, custom jutsu, and combat items', () => {
        const roster = VILLAGES.map((_, index) => makeCharacter(index, { level: 95, namedWeapon: index === 3 }));
        const floor = getFloor(5);
        assert.ok(floor, 'tower floor 5 should exist');
        const tower = buildTowerEncounter({
            floor,
            squad: roster.map((char, index) => squadMember(char, index)),
            runId: 'simulation-floor-5',
            seed: 4242,
            partySize: roster.length,
            now: NOW,
        });
        const towerResult = runTowerFloor(tower, floor, makeRng(4242));
        assertHealthySession(towerResult);
        assert.equal(towerResult.winner, 'squad');
        assert.equal(new Set(roster.map((char) => char.village)).size, VILLAGES.length);
        assert.equal(new Set(roster.map((char) => char.specialty)).size, SPECIALTIES.length);

        const attacker = pvpFighter(roster[0]!, 0);
        const defender = pvpFighter(roster[1]!, 3);
        const builtIn = catalogJutsu('starter-nin-fire-2');
        const builtInResult = applyJutsu(attacker, defender, builtIn, 1, 'forest', 1);
        assert.ok(builtInResult.opponent.hp < defender.hp, 'built-in PvP jutsu should deal damage');
        const customResult = applyJutsu(builtInResult.self, builtInResult.opponent, CUSTOM_JUTSU, 1, 'forest', 1);
        assert.ok(customResult.lines.length > 0, 'custom jutsu should produce combat log output');
        assert.ok(customResult.opponent.statuses.some((status) => status.name === 'Wound' || status.name === 'Decrease Damage Given'), 'custom jutsu tags should resolve through PvP truth source');

        const itemFloor = makeFloor('defeat-all');
        const itemUser = makeCharacter(33, { level: 95, namedWeapon: true });
        const itemSession = makeSession([
            makeTowerActor('sq-0', 'squad', 0, combatSnapshot(itemUser), { itemCharges: itemChargesFor(itemUser) }),
            makeTowerActor('en-0', 'enemy', 1, { name: 'Durability Dummy', specialty: 'Taijutsu', level: 100, stats: statsFor(100, 'Taijutsu'), maxHp: 10000, maxChakra: 1000, maxStamina: 1000 }, { hp: 10000, maxHp: 10000 }),
        ], itemFloor);
        startRound(itemSession);
        const dummy = getActor(itemSession, 'en-0');
        const actor = getActor(itemSession, 'sq-0');
        assert.ok(dummy && actor);

        forceActive(itemSession, 'sq-0');
        const beforeWeaponHp = dummy.hp;
        assert.equal(applyAction(itemSession, itemFloor, { actorId: 'sq-0', type: 'weapon', targetId: 'en-0', itemId: NAMED_WEAPON.id }, makeRng(7)).applied, true);
        assert.ok(dummy.hp < beforeWeaponHp, 'named weapon should damage');

        actor.cooldowns = {};
        forceActive(itemSession, 'sq-0');
        assert.equal(applyAction(itemSession, itemFloor, { actorId: 'sq-0', type: 'weapon', targetId: 'en-0', itemId: 'thrown-shuriken' }, makeRng(8)).applied, true);
        assert.equal(actor.itemCharges?.['thrown-shuriken'], 2, 'thrown item charge should be spent');
        assert.equal(actor.itemsUsed?.['thrown-shuriken'], 1, 'thrown item use should be tallied');

        actor.cooldowns = {};
        forceActive(itemSession, 'sq-0');
        assert.equal(applyAction(itemSession, itemFloor, { actorId: 'sq-0', type: 'item', itemId: 'item-attack-pill' }, makeRng(9)).applied, true);
        assert.equal(actor.itemCharges?.['item-attack-pill'], 1, 'combat item charge should be spent');
        assert.ok(actor.statuses.some((status) => status.name === 'Increase Damage Given'), 'attack pill should buff the user');

        actor.cooldowns = {};
        actor.chakra = 10;
        actor.stamina = 10;
        forceActive(itemSession, 'sq-0');
        assert.equal(applyAction(itemSession, itemFloor, { actorId: 'sq-0', type: 'item', itemId: 'potion-rejuvenation' }, makeRng(10)).applied, true);
        assert.ok(actor.chakra > 10 && actor.stamina > 10, 'potion should restore combat resources');
        assert.equal(actor.itemCharges?.['potion-rejuvenation'], 1, 'potion charge should be spent');
    });

    it('settles a clan boss from spawn through repeated real assaults and scoring', () => {
        const weekId = clanBossWeekId(NOW);
        const boss = CLAN_BOSS_BY_ID['oni-warlord'];
        assert.ok(boss, 'oni clan boss should exist');
        const floor = CLAN_BOSS_FLOORS.find((entry) => entry.id === boss.floorId);
        assert.ok(floor, 'oni clan boss floor should exist');

        const week = { weekId, bossId: boss.id, spawnedAt: NOW, endsAt: NOW + 7 * 24 * 60 * 60 * 1000 };
        let progress = newClanBossProgress('Full Simulation Clan', week, 3);
        const partyChars = [makeCharacter(10, { level: 100 }), makeCharacter(11, { level: 100 }), makeCharacter(12, { level: 100 })];
        const party = partyChars.map((char) => slug(char.name));

        let attempts = 0;
        while (progress.pool > 0 && attempts < CB_ASSAULTS_PER_MEMBER) {
            const runId = `clan-boss-simulation-${attempts}`;
            const host = party[attempts % party.length]!;
            progress = reserveAttempt(progress, host, party, NOW + attempts * 60_000);
            const session = buildTowerEncounter({
                floor,
                squad: partyChars.map((char, index) => squadMember(char, index)),
                runId,
                seed: 9000 + attempts,
                partySize: 3,
                now: NOW + attempts * 60_000,
            });
            const bossActorId = session.phaseState.bossId;
            assert.ok(bossActorId, 'clan boss session should identify a boss actor');
            const bossActor = getActor(session, bossActorId);
            assert.ok(bossActor, 'clan boss actor should exist');
            const assaultHp = Math.min(progress.pool, CB_ASSAULT_HP_CAP);
            bossActor.hp = assaultHp;
            bossActor.maxHp = assaultHp;

            const finished = runTowerFloor(session, floor, makeRng(9000 + attempts));
            assertHealthySession(finished);
            const result = extractAssaultResult(finished);
            assert.ok(result.damage > 0, 'assault should bank boss damage');
            progress = bankAssault(progress, {
                runId,
                by: host,
                party,
                damage: result.damage,
                rounds: result.rounds,
                wiped: result.wiped,
                clean: result.clean,
                at: NOW + attempts * 60_000,
            });
            attempts += 1;
        }

        assert.equal(progress.pool, 0, 'strong simulation party should finish the clan boss loop');
        assert.ok(progress.killedAt, 'kill timestamp should be set');
        assert.equal(clanBossDamageDealt(progress), progress.poolMax);
        assert.ok(clanBossScore(progress) > 0, 'finished clan boss should score');
        assert.equal(progress.participants.length, party.length);
        // A gauntlet-tuned boss can be finished in fewer assaults than there are members, so some
        // members may never host (0 attempts) — that trivially satisfies the per-member cap.
        assert.ok(party.every((member) => (progress.memberAttempts[member] ?? 0) <= CB_ASSAULTS_PER_MEMBER));
    });

    it('soaks progression, sectors, economy, inventory, shops, hospital, bank, and PvP rewards without invalid state', () => {
        const roster = Array.from({ length: 64 }, (_, index) => makeCharacter(index, { level: 10 + (index % 70), namedWeapon: index % 11 === 0 }));
        let ryoAgg: EconAgg = { created: 0, destroyed: 0 };
        const txns: EconTxn[] = [];
        const record = (char: SimCharacter, delta: number, source: string, step: number): void => {
            if (delta === 0) return;
            ryoAgg = applyTxnToAgg(ryoAgg, delta);
            txns.push({ ts: NOW + step, txnId: `${source}:${char.name}:${step}`, player: slug(char.name), currency: 'ryo', delta, source, balanceAfter: char.ryo });
        };

        for (let step = 0; step < 1000; step++) {
            let char = roster[step % roster.length]!;
            const mode = step % 10;
            if (mode === 0) {
                const stat = STAT_KEYS[step % STAT_KEYS.length]!;
                char.stats = { ...char.stats, [stat]: Math.min(2500, char.stats[stat] + 1) };
                char.stamina = Math.max(0, char.stamina - 1);
            } else if (mode === 1 && Number(char.dailyMissionsCompleted ?? 0) < 20) {
                const before = char.ryo;
                char = applyCombatMission(char, step % 20 === 1 ? 'combat-d-errand' : 'combat-e-drill');
                record(char, char.ryo - before, 'mission.claim', step);
            } else if (mode === 2 && Number(char.dailyHuntsCompleted ?? 0) < 20) {
                const before = char.ryo;
                char = applyHunt(char, 'hunt-wild-boar');
                record(char, char.ryo - before, 'hunt.claim', step);
            } else if (mode === 3) {
                char.currentSector = ((char.currentSector + 7) % 144) + 1;
            } else if (mode === 4) {
                // Character XP is retired — the base PvP credit is ryo + the
                // derived-level recompute (stat growth is a separate slice).
                const gains = { ryoGain: 75 + (step % 3) * 5 };
                const credited = creditPvpWinBase(char, gains.ryoGain).char as SimCharacter;
                record(credited, gains.ryoGain, 'pvp.win', step);
                char = credited;
            } else if (mode === 5 && char.ryo >= 45) {
                char.ryo -= 45;
                char.inventory = [...char.inventory, 'potion-rejuvenation'];
                record(char, -45, 'shop.buy', step);
            } else if (mode === 6) {
                const claim = computeBankInterest(char, NOW + step * 1000);
                if (claim.eligible) {
                    char.bankRyo += claim.interest;
                    char.lastBankInterestAt = NOW + step * 1000;
                    record(char, claim.interest, 'bank.interest', step);
                }
            } else if (mode === 7) {
                char.hp = Math.max(1, char.hp - 125);
            } else if (mode === 8 && char.hp < char.maxHp && char.ryo >= 20) {
                char.ryo -= 20;
                char.hp = char.maxHp;
                record(char, -20, 'hospital.heal', step);
            } else if (mode === 9 && char.inventory.includes('potion-rejuvenation')) {
                char.inventory = char.inventory.filter((item, index) => item !== 'potion-rejuvenation' || index !== char.inventory.indexOf('potion-rejuvenation'));
                char.chakra = Math.min(char.maxChakra, char.chakra + 1000);
                char.stamina = Math.min(char.maxStamina, char.stamina + 1000);
            }
            roster[step % roster.length] = char;
            assertHealthyCharacter(char);
        }

        assert.equal(duplicateTxnIds(txns).length, 0);
        assert.ok(ryoAgg.created > 0, 'economy soak should create ryo through rewards');
        assert.ok(ryoAgg.destroyed > 0, 'economy soak should destroy ryo through sinks');
        assert.ok(roster.some((char) => char.currentSector !== 1), 'sector travel should move players');
        assert.equal(roster.some((char) => char.inventory.includes('territory-control-scroll')), false, 'normal mission rewards must not mint Territory Scrolls');
        for (const char of roster) assertHealthyCharacter(char);
    });

    it('keeps server route and client screen coverage for the simulated game surfaces', () => {
        const root = process.cwd();
        const serverText = readFileSync(path.join(root, 'server.ts'), 'utf8');
        const routes = [
            '/player-auth',
            '/save/:name',
            '/player/heal',
            '/training/start',
            '/training/complete',
            '/missions/daily',
            '/missions/claim-mission',
            '/sector/questbook',
            '/pvp/session',
            '/pvp/move',
            '/towers/start',
            '/towers/action',
            '/towers/settle',
            '/clan-boss/get',
            '/clan-boss/assault-start',
            '/clan-boss/assault-settle',
            '/bank/claim-interest',
            '/jutsu/speedup',
        ];
        for (const route of routes) {
            assert.ok(serverText.includes(`route('${route}'`), `server.ts must register ${route}`);
        }

        const screens = [
            'shinobij.client/src/App.tsx',
            'shinobij.client/src/screens/StartScreen.tsx',
            'shinobij.client/src/screens/CharacterCreator.tsx',
            'shinobij.client/src/screens/Training.tsx',
            'shinobij.client/src/screens/Missions.tsx',
            'shinobij.client/src/screens/WorldMap.tsx',
            'shinobij.client/src/screens/PvpBattleScreen.tsx',
            'shinobij.client/src/screens/BattleTowerFight.tsx',
            'shinobij.client/src/screens/ClanBoss.tsx',
            'shinobij.client/src/screens/Inventory.tsx',
            'shinobij.client/src/screens/Bank.tsx',
            'shinobij.client/src/screens/Hospital.tsx',
            'shinobij.client/src/screens/BloodlineMaker.tsx',
            'shinobij.client/src/screens/SectorWarPetBattle.tsx',
            'shinobij.client/src/screens/SectorWarCardBattle.tsx',
        ];
        for (const screen of screens) {
            assert.ok(existsSync(path.join(root, screen)), `${screen} should exist for browser/UI simulation coverage`);
        }
    });
});
