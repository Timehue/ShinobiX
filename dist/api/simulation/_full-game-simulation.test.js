"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const _xp_engine_js_1 = require("../_xp-engine.js");
const _bank_interest_js_1 = require("../_bank-interest.js");
const _economy_js_1 = require("../_economy.js");
const _mission_catalog_js_1 = require("../missions/_mission-catalog.js");
const _jutsu_catalog_js_1 = require("../pvp/_jutsu-catalog.js");
const _item_catalog_js_1 = require("../pvp/_item-catalog.js");
const move_js_1 = require("../pvp/move.js");
const _assault_js_1 = require("../clan-boss/_assault.js");
const _storage_js_1 = require("../clan-boss/_storage.js");
const _encounter_js_1 = require("../towers/_encounter.js");
const _floor_catalog_js_1 = require("../towers/_floor-catalog.js");
const _engine_js_1 = require("../towers/_engine.js");
const _tower_session_js_1 = require("../towers/_tower-session.js");
const _sim_js_1 = require("../towers/_sim.js");
const NOW = Date.UTC(2026, 6, 6, 12, 0, 0);
const TODAY_KEY = '2026-07-06';
const MONTH_KEY = '2026-07';
const MAP8 = { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] };
const VILLAGES = ['Ashen Leaf', 'Stormveil', 'Frostfang', 'Moonshadow'];
const SPECIALTIES = ['Ninjutsu', 'Taijutsu', 'Genjutsu', 'Bukijutsu'];
const OFFENSE_BY_SPECIALTY = {
    Ninjutsu: 'ninjutsuOffense',
    Taijutsu: 'taijutsuOffense',
    Genjutsu: 'genjutsuOffense',
    Bukijutsu: 'bukijutsuOffense',
};
const DEFENSE_BY_SPECIALTY = {
    Ninjutsu: 'ninjutsuDefense',
    Taijutsu: 'taijutsuDefense',
    Genjutsu: 'genjutsuDefense',
    Bukijutsu: 'bukijutsuDefense',
};
const BLOODLINE_BY_SPECIALTY = {
    Ninjutsu: 'Inferno Cataclysm',
    Taijutsu: 'Iron Fang',
    Genjutsu: 'Ashen Eyes',
    Bukijutsu: 'Shadow Lotus',
};
const JUTSU_LOADOUTS = {
    Ninjutsu: ['starter-nin-fire-2', 'starter-nin-lightning-aoe', 'inferno-cataclysm-lava-burst', 'starter-universal-flicker'],
    Taijutsu: ['starter-tai-earth-2', 'starter-tai-fire-aoe', 'iron-fang-ferrous-crash', 'starter-universal-flicker'],
    Genjutsu: ['starter-gen-lightning-2', 'starter-gen-fire-aoe', 'ashen-eyes-blood-gaze', 'starter-universal-flicker'],
    Bukijutsu: ['starter-buki-wind-2', 'starter-buki-water-aoe', 'shadow-lotus-umbra-senbon', 'starter-universal-flicker'],
};
const CUSTOM_JUTSU = {
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
const NAMED_WEAPON = {
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
function catalogJutsu(id) {
    const found = _jutsu_catalog_js_1.JUTSU_CATALOG[id];
    node_assert_1.strict.ok(found, `missing jutsu ${id}`);
    return { ...found, tags: found.tags.map((tag) => ({ ...tag })) };
}
function catalogItem(id) {
    const found = _item_catalog_js_1.ITEM_CATALOG[id];
    node_assert_1.strict.ok(found, `missing item ${id}`);
    return { ...found, bonuses: { ...(found.bonuses ?? {}) }, weaponTags: found.weaponTags?.map((tag) => ({ ...tag })) };
}
function statsFor(level, specialty) {
    const base = Math.min(2500, Math.max(10, 80 + level * 23));
    const stats = _xp_engine_js_1.STAT_KEYS.reduce((acc, key) => {
        acc[key] = base;
        return acc;
    }, {});
    stats.strength = Math.min(2500, base + Math.floor(level * 3));
    stats.speed = Math.min(2500, base + Math.floor(level * 2));
    stats.intelligence = Math.min(2500, base + Math.floor(level * 2));
    stats.willpower = Math.min(2500, base + Math.floor(level * 3));
    stats[OFFENSE_BY_SPECIALTY[specialty]] = Math.min(2500, base + 350);
    stats[DEFENSE_BY_SPECIALTY[specialty]] = Math.min(2500, base + 250);
    return stats;
}
function jutsuFor(specialty) {
    return [...JUTSU_LOADOUTS[specialty].map(catalogJutsu), { ...CUSTOM_JUTSU, tags: CUSTOM_JUTSU.tags.map((tag) => ({ ...tag })) }];
}
function makeCharacter(index, opts = {}) {
    const specialty = SPECIALTIES[index % SPECIALTIES.length];
    const village = VILLAGES[index % VILLAGES.length];
    const level = opts.level ?? (1 + index);
    const maxHp = (0, _xp_engine_js_1.maxHpForLevel)(level);
    const maxChakra = (0, _xp_engine_js_1.maxChakraForLevel)(level);
    const maxStamina = (0, _xp_engine_js_1.maxStaminaForLevel)(level);
    const jutsu = jutsuFor(specialty);
    const hand = opts.namedWeapon ? NAMED_WEAPON.id : (specialty === 'Taijutsu' ? 'training-katana' : 'rustfang-kunai');
    const pvpItems = [
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
        rankTitle: (0, _xp_engine_js_1.rankFromLevel)(level),
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
function withXp(char, amount) {
    return (0, _xp_engine_js_1.gainXp)(char, amount);
}
function applyAcademyTrial(char) {
    const leveled = withXp(char, _mission_catalog_js_1.ACADEMY_TRIAL.xp);
    return {
        ...leveled,
        ryo: Number(leveled.ryo) + _mission_catalog_js_1.ACADEMY_TRIAL.ryo,
        stamina: Math.min(Number(leveled.maxStamina), Number(leveled.stamina) + _mission_catalog_js_1.ACADEMY_TRIAL.stamina),
        academyTrialClaimed: true,
    };
}
function applyCombatMission(char, missionKey) {
    const mission = (0, _mission_catalog_js_1.combatMissionByKey)(missionKey);
    node_assert_1.strict.ok(mission, `missing mission ${missionKey}`);
    node_assert_1.strict.ok((0, _mission_catalog_js_1.hasDailyMissionSlot)(char, TODAY_KEY), 'mission daily cap exhausted');
    const bonusPct = (0, _mission_catalog_js_1.missionRewardBonusPct)(char);
    const leveled = withXp(char, (0, _mission_catalog_js_1.boostAmount)(mission.xp, bonusPct));
    return {
        ...leveled,
        ryo: Number(leveled.ryo) + (0, _mission_catalog_js_1.boostAmount)(mission.ryo, bonusPct),
        inventory: (0, _mission_catalog_js_1.grantTerritoryScrollsToInventory)(leveled, mission.territoryScrolls),
        ...(0, _mission_catalog_js_1.markMissionCompletedFields)(leveled, TODAY_KEY, MONTH_KEY),
    };
}
function applyHunt(char, huntId) {
    const hunt = (0, _mission_catalog_js_1.huntMissionById)(huntId);
    node_assert_1.strict.ok(hunt, `missing hunt ${huntId}`);
    node_assert_1.strict.ok((0, _mission_catalog_js_1.hasDailyHuntSlot)(char, TODAY_KEY), 'hunt daily cap exhausted');
    const bonusPct = (0, _mission_catalog_js_1.missionRewardBonusPct)(char);
    const leveled = withXp(char, (0, _mission_catalog_js_1.boostAmount)(hunt.xpReward, bonusPct));
    const withScrolls = { ...leveled, inventory: (0, _mission_catalog_js_1.grantTerritoryScrollsToInventory)(leveled, _mission_catalog_js_1.HUNT_MISSION_SCROLLS) };
    return {
        ...withScrolls,
        ryo: Number(withScrolls.ryo) + (0, _mission_catalog_js_1.boostAmount)(hunt.ryoReward, bonusPct),
        stamina: Math.min(Number(withScrolls.maxStamina), Number(withScrolls.stamina) + hunt.staminaReward),
        inventory: (0, _mission_catalog_js_1.grantItemsToInventory)(withScrolls, hunt.itemRewards),
        ...(0, _mission_catalog_js_1.applyCurrencyRewardFields)(withScrolls, hunt.currencyRewards),
        ...(0, _mission_catalog_js_1.markHuntCompletedFields)(withScrolls, TODAY_KEY, MONTH_KEY),
    };
}
function itemChargesFor(char) {
    const inventory = char.inventory;
    const count = (id) => inventory.filter((entry) => entry === id).length;
    return {
        'thrown-shuriken': count('thrown-shuriken'),
        'item-attack-pill': count('item-attack-pill'),
        'potion-rejuvenation': Math.min(2, count('potion-rejuvenation')),
    };
}
function combatSnapshot(char) {
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
function squadMember(char, index, ai = true) {
    return {
        id: `sq-${index}`,
        name: char.name,
        ownerSlug: slug(char.name),
        ai,
        character: combatSnapshot(char),
        itemCharges: itemChargesFor(char),
    };
}
function makeTowerActor(id, side, pos, character, over = {}) {
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
function makeSession(actors, floor, opts = {}) {
    return (0, _tower_session_js_1.createTowerSession)({
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
function makeFloor(objective = 'defeat-all') {
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
function pvpFighter(char, pos) {
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
function forceActive(session, actorId) {
    if (session.turnQueue.length === 0)
        (0, _engine_js_1.startRound)(session);
    const idx = session.turnQueue.indexOf(actorId);
    node_assert_1.strict.notEqual(idx, -1, `actor ${actorId} was not in the turn queue`);
    session.activeIndex = idx;
    session.activeAp = 100;
    session.actionsThisTurn = 0;
}
function slug(value) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function assertFiniteNumber(label, value) {
    node_assert_1.strict.equal(typeof value, 'number', `${label} should be numeric`);
    node_assert_1.strict.ok(Number.isFinite(value), `${label} should be finite`);
}
function assertHealthyCharacter(char) {
    for (const key of ['level', 'xp', 'ryo', 'bankRyo', 'hp', 'maxHp', 'chakra', 'maxChakra', 'stamina', 'maxStamina']) {
        assertFiniteNumber(`${char.name}.${key}`, char[key]);
    }
    node_assert_1.strict.ok(char.level >= 1 && char.level <= 100, `${char.name} level out of range`);
    node_assert_1.strict.ok(char.ryo >= 0, `${char.name} negative wallet ryo`);
    node_assert_1.strict.ok(char.bankRyo >= 0, `${char.name} negative bank ryo`);
    node_assert_1.strict.ok(char.hp >= 0 && char.hp <= char.maxHp, `${char.name} hp out of range`);
    node_assert_1.strict.ok(char.chakra >= 0 && char.chakra <= char.maxChakra, `${char.name} chakra out of range`);
    node_assert_1.strict.ok(char.stamina >= 0 && char.stamina <= char.maxStamina, `${char.name} stamina out of range`);
    for (const stat of _xp_engine_js_1.STAT_KEYS) {
        assertFiniteNumber(`${char.name}.stats.${stat}`, char.stats[stat]);
        node_assert_1.strict.ok(char.stats[stat] >= 0 && char.stats[stat] <= 2500, `${char.name}.${stat} out of range`);
    }
    node_assert_1.strict.ok(Array.isArray(char.inventory), `${char.name} inventory missing`);
    node_assert_1.strict.ok(Number(char.dailyMissionsCompleted ?? 0) <= 20, `${char.name} mission daily cap exceeded`);
    node_assert_1.strict.ok(Number(char.dailyHuntsCompleted ?? 0) <= 20, `${char.name} hunt daily cap exceeded`);
}
function assertHealthySession(session) {
    node_assert_1.strict.equal(session.status, 'done');
    for (const actor of session.actors) {
        assertFiniteNumber(`${actor.id}.hp`, actor.hp);
        assertFiniteNumber(`${actor.id}.chakra`, actor.chakra);
        assertFiniteNumber(`${actor.id}.stamina`, actor.stamina);
        node_assert_1.strict.ok(actor.hp >= 0 && actor.hp <= actor.maxHp, `${actor.id} hp out of range`);
        node_assert_1.strict.ok(actor.chakra >= 0 && actor.chakra <= actor.maxChakra, `${actor.id} chakra out of range`);
        node_assert_1.strict.ok(actor.stamina >= 0 && actor.stamina <= actor.maxStamina, `${actor.id} stamina out of range`);
        for (const value of Object.values(actor.cooldowns))
            node_assert_1.strict.ok(Number.isFinite(value) && value >= 0);
        for (const value of Object.values(actor.itemCharges ?? {}))
            node_assert_1.strict.ok(Number.isFinite(value) && value >= 0);
        for (const value of Object.values(actor.itemsUsed ?? {}))
            node_assert_1.strict.ok(Number.isFinite(value) && value >= 0);
    }
}
(0, node_test_1.describe)('full game simulation harness', () => {
    (0, node_test_1.it)('walks a new player through onboarding, missions, a first fight, travel, and reload', () => {
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
        const result = (0, _engine_js_1.runTowerFloor)(session, floor, (0, _sim_js_1.makeRng)(101));
        assertHealthySession(result);
        node_assert_1.strict.equal(result.winner, 'squad');
        node_assert_1.strict.equal(player.academyTrialClaimed, true);
        node_assert_1.strict.ok(player.inventory.includes('territory-control-scroll'), 'mission/hunt rewards should grant territory scrolls');
        node_assert_1.strict.ok(player.inventory.includes('hunt-beast-meat'), 'hunt rewards should grant materials');
        assertHealthyCharacter(player);
        const reloaded = JSON.parse(JSON.stringify(player));
        node_assert_1.strict.deepEqual(reloaded.equipment, player.equipment);
        node_assert_1.strict.equal(reloaded.currentSector, 2);
        assertHealthyCharacter(reloaded);
    });
    (0, node_test_1.it)('runs all villages and specialties through tower combat, PvP parity, custom jutsu, and combat items', () => {
        const roster = VILLAGES.map((_, index) => makeCharacter(index, { level: 95, namedWeapon: index === 3 }));
        const floor = (0, _floor_catalog_js_1.getFloor)(5);
        node_assert_1.strict.ok(floor, 'tower floor 5 should exist');
        const tower = (0, _encounter_js_1.buildTowerEncounter)({
            floor,
            squad: roster.map((char, index) => squadMember(char, index)),
            runId: 'simulation-floor-5',
            seed: 4242,
            partySize: roster.length,
            now: NOW,
        });
        const towerResult = (0, _engine_js_1.runTowerFloor)(tower, floor, (0, _sim_js_1.makeRng)(4242));
        assertHealthySession(towerResult);
        node_assert_1.strict.equal(towerResult.winner, 'squad');
        node_assert_1.strict.equal(new Set(roster.map((char) => char.village)).size, VILLAGES.length);
        node_assert_1.strict.equal(new Set(roster.map((char) => char.specialty)).size, SPECIALTIES.length);
        const attacker = pvpFighter(roster[0], 0);
        const defender = pvpFighter(roster[1], 3);
        const builtIn = catalogJutsu('starter-nin-fire-2');
        const builtInResult = (0, move_js_1.applyJutsu)(attacker, defender, builtIn, 1, 'forest', 1);
        node_assert_1.strict.ok(builtInResult.opponent.hp < defender.hp, 'built-in PvP jutsu should deal damage');
        const customResult = (0, move_js_1.applyJutsu)(builtInResult.self, builtInResult.opponent, CUSTOM_JUTSU, 1, 'forest', 1);
        node_assert_1.strict.ok(customResult.lines.length > 0, 'custom jutsu should produce combat log output');
        node_assert_1.strict.ok(customResult.opponent.statuses.some((status) => status.name === 'Wound' || status.name === 'Decrease Damage Given'), 'custom jutsu tags should resolve through PvP truth source');
        const itemFloor = makeFloor('defeat-all');
        const itemUser = makeCharacter(33, { level: 95, namedWeapon: true });
        const itemSession = makeSession([
            makeTowerActor('sq-0', 'squad', 0, combatSnapshot(itemUser), { itemCharges: itemChargesFor(itemUser) }),
            makeTowerActor('en-0', 'enemy', 1, { name: 'Durability Dummy', specialty: 'Taijutsu', level: 100, stats: statsFor(100, 'Taijutsu'), maxHp: 10000, maxChakra: 1000, maxStamina: 1000 }, { hp: 10000, maxHp: 10000 }),
        ], itemFloor);
        (0, _engine_js_1.startRound)(itemSession);
        const dummy = (0, _tower_session_js_1.getActor)(itemSession, 'en-0');
        const actor = (0, _tower_session_js_1.getActor)(itemSession, 'sq-0');
        node_assert_1.strict.ok(dummy && actor);
        forceActive(itemSession, 'sq-0');
        const beforeWeaponHp = dummy.hp;
        node_assert_1.strict.equal((0, _engine_js_1.applyAction)(itemSession, itemFloor, { actorId: 'sq-0', type: 'weapon', targetId: 'en-0', itemId: NAMED_WEAPON.id }, (0, _sim_js_1.makeRng)(7)).applied, true);
        node_assert_1.strict.ok(dummy.hp < beforeWeaponHp, 'named weapon should damage');
        actor.cooldowns = {};
        forceActive(itemSession, 'sq-0');
        node_assert_1.strict.equal((0, _engine_js_1.applyAction)(itemSession, itemFloor, { actorId: 'sq-0', type: 'weapon', targetId: 'en-0', itemId: 'thrown-shuriken' }, (0, _sim_js_1.makeRng)(8)).applied, true);
        node_assert_1.strict.equal(actor.itemCharges?.['thrown-shuriken'], 2, 'thrown item charge should be spent');
        node_assert_1.strict.equal(actor.itemsUsed?.['thrown-shuriken'], 1, 'thrown item use should be tallied');
        actor.cooldowns = {};
        forceActive(itemSession, 'sq-0');
        node_assert_1.strict.equal((0, _engine_js_1.applyAction)(itemSession, itemFloor, { actorId: 'sq-0', type: 'item', itemId: 'item-attack-pill' }, (0, _sim_js_1.makeRng)(9)).applied, true);
        node_assert_1.strict.equal(actor.itemCharges?.['item-attack-pill'], 1, 'combat item charge should be spent');
        node_assert_1.strict.ok(actor.statuses.some((status) => status.name === 'Increase Damage Given'), 'attack pill should buff the user');
        actor.cooldowns = {};
        actor.chakra = 10;
        actor.stamina = 10;
        forceActive(itemSession, 'sq-0');
        node_assert_1.strict.equal((0, _engine_js_1.applyAction)(itemSession, itemFloor, { actorId: 'sq-0', type: 'item', itemId: 'potion-rejuvenation' }, (0, _sim_js_1.makeRng)(10)).applied, true);
        node_assert_1.strict.ok(actor.chakra > 10 && actor.stamina > 10, 'potion should restore combat resources');
        node_assert_1.strict.equal(actor.itemCharges?.['potion-rejuvenation'], 1, 'potion charge should be spent');
    });
    (0, node_test_1.it)('settles a clan boss from spawn through repeated real assaults and scoring', () => {
        const weekId = (0, _storage_js_1.clanBossWeekId)(NOW);
        const boss = _storage_js_1.CLAN_BOSS_BY_ID['oni-warlord'];
        node_assert_1.strict.ok(boss, 'oni clan boss should exist');
        const floor = _floor_catalog_js_1.CLAN_BOSS_FLOORS.find((entry) => entry.id === boss.floorId);
        node_assert_1.strict.ok(floor, 'oni clan boss floor should exist');
        const week = { weekId, bossId: boss.id, spawnedAt: NOW, endsAt: NOW + 7 * 24 * 60 * 60 * 1000 };
        let progress = (0, _storage_js_1.newClanBossProgress)('Full Simulation Clan', week, 3);
        const partyChars = [makeCharacter(10, { level: 100 }), makeCharacter(11, { level: 100 }), makeCharacter(12, { level: 100 })];
        const party = partyChars.map((char) => slug(char.name));
        let attempts = 0;
        while (progress.pool > 0 && attempts < _storage_js_1.CB_ASSAULTS_PER_MEMBER) {
            const runId = `clan-boss-simulation-${attempts}`;
            const host = party[attempts % party.length];
            progress = (0, _storage_js_1.reserveAttempt)(progress, host, party, NOW + attempts * 60_000);
            const session = (0, _encounter_js_1.buildTowerEncounter)({
                floor,
                squad: partyChars.map((char, index) => squadMember(char, index)),
                runId,
                seed: 9000 + attempts,
                partySize: 3,
                now: NOW + attempts * 60_000,
            });
            const bossActorId = session.phaseState.bossId;
            node_assert_1.strict.ok(bossActorId, 'clan boss session should identify a boss actor');
            const bossActor = (0, _tower_session_js_1.getActor)(session, bossActorId);
            node_assert_1.strict.ok(bossActor, 'clan boss actor should exist');
            const assaultHp = Math.min(progress.pool, _storage_js_1.CB_ASSAULT_HP_CAP);
            bossActor.hp = assaultHp;
            bossActor.maxHp = assaultHp;
            const finished = (0, _engine_js_1.runTowerFloor)(session, floor, (0, _sim_js_1.makeRng)(9000 + attempts));
            assertHealthySession(finished);
            const result = (0, _assault_js_1.extractAssaultResult)(finished);
            node_assert_1.strict.ok(result.damage > 0, 'assault should bank boss damage');
            progress = (0, _storage_js_1.bankAssault)(progress, {
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
        node_assert_1.strict.equal(progress.pool, 0, 'strong simulation party should finish the clan boss loop');
        node_assert_1.strict.ok(progress.killedAt, 'kill timestamp should be set');
        node_assert_1.strict.equal((0, _storage_js_1.clanBossDamageDealt)(progress), progress.poolMax);
        node_assert_1.strict.ok((0, _storage_js_1.clanBossScore)(progress) > 0, 'finished clan boss should score');
        node_assert_1.strict.equal(progress.participants.length, party.length);
        // A gauntlet-tuned boss can be finished in fewer assaults than there are members, so some
        // members may never host (0 attempts) — that trivially satisfies the per-member cap.
        node_assert_1.strict.ok(party.every((member) => (progress.memberAttempts[member] ?? 0) <= _storage_js_1.CB_ASSAULTS_PER_MEMBER));
    });
    (0, node_test_1.it)('soaks progression, sectors, economy, inventory, shops, hospital, bank, and PvP rewards without invalid state', () => {
        const roster = Array.from({ length: 64 }, (_, index) => makeCharacter(index, { level: 10 + (index % 70), namedWeapon: index % 11 === 0 }));
        let ryoAgg = { created: 0, destroyed: 0 };
        const txns = [];
        const record = (char, delta, source, step) => {
            if (delta === 0)
                return;
            ryoAgg = (0, _economy_js_1.applyTxnToAgg)(ryoAgg, delta);
            txns.push({ ts: NOW + step, txnId: `${source}:${char.name}:${step}`, player: slug(char.name), currency: 'ryo', delta, source, balanceAfter: char.ryo });
        };
        for (let step = 0; step < 1000; step++) {
            let char = roster[step % roster.length];
            const mode = step % 10;
            if (mode === 0) {
                const stat = _xp_engine_js_1.STAT_KEYS[step % _xp_engine_js_1.STAT_KEYS.length];
                char.stats = { ...char.stats, [stat]: Math.min(2500, char.stats[stat] + 1) };
                char.stamina = Math.max(0, char.stamina - 1);
            }
            else if (mode === 1 && Number(char.dailyMissionsCompleted ?? 0) < 20) {
                const before = char.ryo;
                char = applyCombatMission(char, step % 20 === 1 ? 'combat-d-errand' : 'combat-e-drill');
                record(char, char.ryo - before, 'mission.claim', step);
            }
            else if (mode === 2 && Number(char.dailyHuntsCompleted ?? 0) < 20) {
                const before = char.ryo;
                char = applyHunt(char, 'hunt-wild-boar');
                record(char, char.ryo - before, 'hunt.claim', step);
            }
            else if (mode === 3) {
                char.currentSector = ((char.currentSector + 7) % 144) + 1;
            }
            else if (mode === 4) {
                const gains = { xpGain: 100 + (step % 5) * 10, ryoGain: 75 + (step % 3) * 5 };
                const credited = (0, _xp_engine_js_1.creditPvpWinBase)(char, gains.xpGain, gains.ryoGain).char;
                record(credited, gains.ryoGain, 'pvp.win', step);
                char = credited;
            }
            else if (mode === 5 && char.ryo >= 45) {
                char.ryo -= 45;
                char.inventory = [...char.inventory, 'potion-rejuvenation'];
                record(char, -45, 'shop.buy', step);
            }
            else if (mode === 6) {
                const claim = (0, _bank_interest_js_1.computeBankInterest)(char, NOW + step * 1000);
                if (claim.eligible) {
                    char.bankRyo += claim.interest;
                    char.lastBankInterestAt = NOW + step * 1000;
                    record(char, claim.interest, 'bank.interest', step);
                }
            }
            else if (mode === 7) {
                char.hp = Math.max(1, char.hp - 125);
            }
            else if (mode === 8 && char.hp < char.maxHp && char.ryo >= 20) {
                char.ryo -= 20;
                char.hp = char.maxHp;
                record(char, -20, 'hospital.heal', step);
            }
            else if (mode === 9 && char.inventory.includes('potion-rejuvenation')) {
                char.inventory = char.inventory.filter((item, index) => item !== 'potion-rejuvenation' || index !== char.inventory.indexOf('potion-rejuvenation'));
                char.chakra = Math.min(char.maxChakra, char.chakra + 1000);
                char.stamina = Math.min(char.maxStamina, char.stamina + 1000);
            }
            roster[step % roster.length] = char;
            assertHealthyCharacter(char);
        }
        node_assert_1.strict.equal((0, _economy_js_1.duplicateTxnIds)(txns).length, 0);
        node_assert_1.strict.ok(ryoAgg.created > 0, 'economy soak should create ryo through rewards');
        node_assert_1.strict.ok(ryoAgg.destroyed > 0, 'economy soak should destroy ryo through sinks');
        node_assert_1.strict.ok(roster.some((char) => char.currentSector !== 1), 'sector travel should move players');
        node_assert_1.strict.ok(roster.some((char) => char.inventory.includes('territory-control-scroll')), 'mission rewards should enter inventories');
        for (const char of roster)
            assertHealthyCharacter(char);
    });
    (0, node_test_1.it)('keeps server route and client screen coverage for the simulated game surfaces', () => {
        const root = process.cwd();
        const serverText = (0, node_fs_1.readFileSync)(node_path_1.default.join(root, 'server.ts'), 'utf8');
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
            node_assert_1.strict.ok(serverText.includes(`route('${route}'`), `server.ts must register ${route}`);
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
            node_assert_1.strict.ok((0, node_fs_1.existsSync)(node_path_1.default.join(root, screen)), `${screen} should exist for browser/UI simulation coverage`);
        }
    });
});
