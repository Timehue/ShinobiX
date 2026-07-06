"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Clan-boss assault: server-trusted result extraction from a finished tower
 * session, plus the cross-module consistency pin (CLAN_BOSSES ↔ CLAN_BOSS_FLOORS ↔
 * enemy templates) so a boss can never reference a missing floor or template.
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const _assault_js_1 = require("./_assault.js");
const _storage_js_1 = require("./_storage.js");
const _floor_catalog_js_1 = require("../towers/_floor-catalog.js");
const _enemy_templates_js_1 = require("../towers/_enemy-templates.js");
const clanBossAdapter_js_1 = require("../combat-adapters/clanBossAdapter.js");
const move_js_1 = require("../pvp/move.js");
function mkSession(opts) {
    const actors = [
        { id: 'boss', side: 'enemy', hp: opts.bossHp, maxHp: opts.bossMaxHp },
        ...opts.squadHps.map((hp, i) => ({ id: `sq-${i}`, side: 'squad', hp, maxHp: 1000 })),
    ];
    return {
        phaseState: { bossId: 'boss', pendingPhases: [], triggeredPhases: [] },
        actors, winner: opts.winner, round: opts.round,
    };
}
(0, node_test_1.describe)('extractAssaultResult', () => {
    (0, node_test_1.it)('a clean kill banks full boss HP, no wipe, clean=true', () => {
        const r = (0, _assault_js_1.extractAssaultResult)(mkSession({ bossHp: 0, bossMaxHp: 5000, squadHps: [800, 700, 900], winner: 'squad', round: 15 }));
        node_assert_1.strict.deepEqual(r, { won: true, damage: 5000, rounds: 15, wiped: false, clean: true });
    });
    (0, node_test_1.it)('a timeout (squad alive, boss not dead) banks partial damage, not a wipe, not clean', () => {
        const r = (0, _assault_js_1.extractAssaultResult)(mkSession({ bossHp: 2000, bossMaxHp: 5000, squadHps: [100, 0, 300], winner: 'enemy', round: 25 }));
        node_assert_1.strict.equal(r.won, false);
        node_assert_1.strict.equal(r.damage, 3000);
        node_assert_1.strict.equal(r.wiped, false); // someone is still standing
        node_assert_1.strict.equal(r.clean, false);
    });
    (0, node_test_1.it)('a full wipe (whole party down) is a wipe', () => {
        const r = (0, _assault_js_1.extractAssaultResult)(mkSession({ bossHp: 3000, bossMaxHp: 5000, squadHps: [0, 0, 0], winner: 'enemy', round: 12 }));
        node_assert_1.strict.equal(r.won, false);
        node_assert_1.strict.equal(r.damage, 2000);
        node_assert_1.strict.equal(r.wiped, true);
    });
    (0, node_test_1.it)('a win with a downed member is NOT clean', () => {
        const r = (0, _assault_js_1.extractAssaultResult)(mkSession({ bossHp: 0, bossMaxHp: 5000, squadHps: [500, 0, 400], winner: 'squad', round: 18 }));
        node_assert_1.strict.equal(r.won, true);
        node_assert_1.strict.equal(r.clean, false);
    });
});
(0, node_test_1.describe)('clan-boss content consistency', () => {
    (0, node_test_1.it)('CLAN_BOSSES and CLAN_BOSS_FLOORS are index-aligned by floorId + mechanic', () => {
        node_assert_1.strict.equal(_storage_js_1.CLAN_BOSSES.length, _floor_catalog_js_1.CLAN_BOSS_FLOORS.length);
        _storage_js_1.CLAN_BOSSES.forEach((b, i) => {
            const floor = _floor_catalog_js_1.CLAN_BOSS_FLOORS[i];
            node_assert_1.strict.equal(b.floorId, floor.id, `${b.id} floorId`);
            node_assert_1.strict.equal(b.mechanic, floor.boss?.mechanic, `${b.id} mechanic`);
        });
    });
    (0, node_test_1.it)('every clan-boss floor references real enemy/boss/summon templates', () => {
        for (const floor of _floor_catalog_js_1.CLAN_BOSS_FLOORS) {
            node_assert_1.strict.ok((0, _enemy_templates_js_1.hasEnemyTemplate)(floor.boss.aiId), `boss template ${floor.boss.aiId}`);
            for (const pod of floor.enemies)
                node_assert_1.strict.ok((0, _enemy_templates_js_1.hasEnemyTemplate)(pod.aiId), `enemy template ${pod.aiId}`);
            if (floor.boss?.summonAiId)
                node_assert_1.strict.ok((0, _enemy_templates_js_1.hasEnemyTemplate)(floor.boss.summonAiId), `summon template ${floor.boss.summonAiId}`);
        }
    });
});
(0, node_test_1.describe)('clan-boss player-combat parity guard', () => {
    (0, node_test_1.it)('normalizes a tower session into combat-core battle state without mutating actors', () => {
        const tower = mkSession({ bossHp: 3200, bossMaxHp: 5000, squadHps: [800, 700], winner: null, round: 7 });
        const combat = (0, clanBossAdapter_js_1.clanBossTowerSessionToCombatBattleState)(tower);
        node_assert_1.strict.equal(combat.battleId, 'clan-boss');
        node_assert_1.strict.equal(combat.round, 7);
        node_assert_1.strict.equal(combat.activeActorId, 'boss');
        node_assert_1.strict.equal(combat.fighters.boss?.side, 'enemy');
        node_assert_1.strict.equal(combat.fighters.boss?.hp, 3200);
        node_assert_1.strict.equal(combat.fighters['sq-0']?.side, 'squad');
        node_assert_1.strict.equal(combat.fighters['sq-0']?.hp, 800);
        node_assert_1.strict.equal(tower.actors[0]?.hp, 3200);
    });
    (0, node_test_1.it)('normalizes player combat context with resources, mastery, equipment, and defense profile', () => {
        const stats = {
            strength: 900,
            speed: 900,
            intelligence: 900,
            willpower: 900,
            ninjutsuOffense: 900,
            ninjutsuDefense: 900,
        };
        const jutsu = {
            id: 'contract-blast',
            name: 'Contract Blast',
            type: 'Ninjutsu',
            target: 'OPPONENT',
            range: 3,
            ap: 60,
            cooldown: 3,
            chakraCost: 25,
            staminaCost: 15,
            effectPower: 32,
            tags: [{ name: 'Wound', percent: 25 }],
        };
        const actor = {
            id: 'sq-0',
            side: 'squad',
            name: 'alice',
            hp: 5000,
            maxHp: 5000,
            chakra: 1000,
            maxChakra: 1000,
            stamina: 1000,
            maxStamina: 1000,
            shield: 0,
            statuses: [{ name: 'Increase Damage Given', rounds: 2, percent: 20, kind: 'positive' }],
            cooldowns: { old: 1 },
            pos: 0,
            character: {
                level: 100,
                specialty: 'Ninjutsu',
                stats,
                jutsu: [jutsu],
                jutsuMastery: [{ jutsuId: 'contract-blast', level: 50 }],
                bloodlineMult: 1.2,
                pvpItems: [{ id: 'ring', name: 'Ring', weaponEffect: 'Lifesteal', weaponEffectValue: 5 }],
                equipment: { armor: 'mist-mail' },
            },
        };
        const target = {
            ...actor,
            id: 'boss',
            side: 'enemy',
            name: 'boss',
            hp: 6000,
            maxHp: 6000,
            pos: 1,
            statuses: [{ name: 'Decrease Damage Taken', rounds: 2, percent: 15, kind: 'positive' }],
            cooldowns: {},
            character: {
                level: 100,
                stats,
                armorRawDR: 0.25,
                armorFactor: 0.75,
                guardDefensePct: 3,
                equipment: { armor: 'boss-mail' },
            },
        };
        const normalized = (0, clanBossAdapter_js_1.normalizeTowerPlayerJutsuCombat)({
            session: { round: 4, map: { biome: 'volcano' } },
            actor,
            target,
            jutsu,
            wMult: 1.1,
        });
        node_assert_1.strict.equal(normalized.self.stats?.ninjutsuOffense, 900);
        node_assert_1.strict.deepEqual(normalized.self.character?.jutsuMastery, [{ jutsuId: 'contract-blast', level: 50 }]);
        node_assert_1.strict.equal(normalized.self.character?.bloodlineMult, 1.2);
        node_assert_1.strict.equal(normalized.self.items?.[0]?.weaponEffect, 'Lifesteal');
        node_assert_1.strict.equal(normalized.self.equipment?.armor, 'mist-mail');
        node_assert_1.strict.equal(normalized.jutsu.id, 'contract-blast');
        node_assert_1.strict.deepEqual(normalized.resources, {
            apCost: 60,
            chakraCost: 25,
            staminaCost: 15,
            cooldownKey: 'contract-blast',
            cooldownTurns: 3,
        });
        node_assert_1.strict.deepEqual(normalized.environment, { round: 4, biome: 'volcano', wMult: 1.1 });
        node_assert_1.strict.equal(normalized.targetDefense.armorRawDR, 0.25);
        node_assert_1.strict.equal(normalized.targetDefense.armorFactor, 0.75);
        node_assert_1.strict.equal(normalized.targetDefense.guardDefensePct, 3);
        node_assert_1.strict.equal(normalized.targetDefense.statuses[0]?.name, 'Decrease Damage Taken');
    });
    (0, node_test_1.it)('player-side resolveJutsu adapter matches the PvP resolver for the same normalized input', () => {
        const stats = {
            strength: 900,
            speed: 900,
            intelligence: 900,
            willpower: 900,
            bukijutsuOffense: 900,
            bukijutsuDefense: 900,
            taijutsuOffense: 900,
            taijutsuDefense: 900,
            genjutsuOffense: 900,
            genjutsuDefense: 900,
            ninjutsuOffense: 900,
            ninjutsuDefense: 900,
        };
        const jutsu = {
            id: 'parity-blast',
            name: 'Parity Blast',
            type: 'Ninjutsu',
            target: 'OPPONENT',
            range: 1,
            ap: 60,
            effectPower: 32,
            isUtility: false,
            tags: [{ name: 'Wound', percent: 25 }],
        };
        const self = {
            name: 'alice',
            hp: 5000,
            maxHp: 5000,
            chakra: 1000,
            maxChakra: 1000,
            stamina: 1000,
            maxStamina: 1000,
            shield: 0,
            statuses: [],
            pos: 0,
            character: {
                name: 'alice',
                level: 100,
                specialty: 'Ninjutsu',
                stats,
                jutsu: [jutsu],
                jutsuMastery: [{ jutsuId: 'parity-blast', level: 50 }],
            },
        };
        const opponent = {
            ...self,
            name: 'boss',
            hp: 6000,
            maxHp: 6000,
            pos: 1,
            character: { ...self.character, name: 'boss', jutsu: [], jutsuMastery: [] },
        };
        const pvp = (0, move_js_1.applyJutsu)(self, opponent, jutsu, 1, 'central', 1);
        const clanBoss = (0, clanBossAdapter_js_1.resolveClanBossPlayerJutsu)({
            self,
            opponent,
            jutsu,
            resolver: move_js_1.applyJutsu,
            wMult: 1,
            biome: 'central',
            round: 1,
        });
        node_assert_1.strict.deepEqual(clanBoss, pvp);
        node_assert_1.strict.ok(opponent.hp - clanBoss.opponent.hp > 0, 'adapter path deals the same direct damage as PvP');
        node_assert_1.strict.equal(clanBoss.self.hp, pvp.self.hp);
        node_assert_1.strict.equal(clanBoss.self.chakra, pvp.self.chakra, 'resolver does not spend resources; tower/PvP shells do');
        node_assert_1.strict.equal(clanBoss.opponent.hp, pvp.opponent.hp);
        node_assert_1.strict.equal(clanBoss.opponent.statuses.filter(status => status.name === 'Wound').length, 1, 'Wound applies once, not as an immediate DoT duplicate');
        node_assert_1.strict.ok(clanBoss.lines.some(line => line.includes('damage to boss')));
        node_assert_1.strict.ok(clanBoss.lines.some(line => line.includes('Wound: boss bleeds')));
    });
    (0, node_test_1.it)('reuses PvP combat resolution while documenting remaining tower-local drift', () => {
        const move = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'api', 'pvp', 'move.ts'), 'utf8');
        const engine = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'api', 'towers', '_engine.ts'), 'utf8');
        const adapter = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'api', 'combat-adapters', 'clanBossAdapter.ts'), 'utf8');
        node_assert_1.strict.match(move, /from '..\/combat-core\/resolveJutsu\.js'/, 'PvP applyJutsu should keep delegating phase order to combat-core');
        node_assert_1.strict.match(move, /resolveCoreJutsu\({/, 'PvP applyJutsu should call the combat-core resolver wrapper');
        node_assert_1.strict.match(engine, /resolveTowerPlayerJutsu/, 'tower/clan-boss hit path should go through the combat adapter seam');
        node_assert_1.strict.match(engine, /applyJutsu as applyPvpJutsu,\s*applyDoTs,\s*tickStatuses,\s*applyGroundEffectToFighter,\s*tickGroundEffects\s*}\s*from '..\/pvp\/move\.js'/, 'tower/clan-boss still uses PvP as the player-combat truth source while phase wrappers live there');
        node_assert_1.strict.match(engine, /from '..\/combat-core\/formulas\.js'/, 'tower fallback damage should consume combat-core formula helpers instead of copied constants');
        node_assert_1.strict.match(adapter, /normalizeTowerPlayerJutsuCombat/, 'adapter should expose a normalized tower/clan-boss player-combat contract');
        node_assert_1.strict.doesNotMatch(engine, /function resolveTagStatuses|function resolvePostDamage/, 'tower should not duplicate PvP tag/post-damage resolver phases');
        for (const constant of [
            'BASE_AP',
            'MAX_ACTIONS',
            'MAX_ROUNDS',
            'STUN_AP_PENALTY',
            'MOVE_AP',
            'BASIC_ATTACK_AP',
        ]) {
            node_assert_1.strict.match(engine, new RegExp(`export const ${constant} = `), `${constant} is still tower-local and should be migrated deliberately`);
        }
        node_assert_1.strict.doesNotMatch(engine, /\bexport const (?:K_DR|JUTSU_MAX_LEVEL|MASTERY_MIN_DAMAGE_FRAC) = /, 'tower should not own copied player damage formula constants');
    });
    (0, node_test_1.it)('blocks new duplicate player-combat formulas outside combat-core', () => {
        const apiRoot = (0, node_path_1.join)(process.cwd(), 'api');
        const allowedDirs = new Set(['combat-core', 'combat-adapters']);
        const allowedFiles = new Set([
            // PvP remains the live shell/truth source and keeps thin phase
            // wrappers while their shared numeric work delegates to combat-core.
            (0, node_path_1.join)(apiRoot, 'pvp', 'move.ts'),
        ]);
        const forbidden = /\b(?:const|function)\s+(?:EP_MULTIPLIER|MASTERY_MIN_DAMAGE_FRAC|JUTSU_MAX_LEVEL|K_DR|K_AMP|K_DISCIPLINE|WOUND_CAP|pierceTrueDamage|scaledTagPercent|ampTagCapForRank|terrainMultiplier|weatherMultiplier|statCapForLevel|jutsuLevelCapForLevel)\b|function\s+resolve(?:BaseDamage|TagStatuses|DamageNumber|PostDamage)\b/;
        const files = [];
        const walk = (dir) => {
            for (const entry of (0, node_fs_1.readdirSync)(dir)) {
                const full = (0, node_path_1.join)(dir, entry);
                if (allowedFiles.has(full))
                    continue;
                const stat = (0, node_fs_1.statSync)(full);
                if (stat.isDirectory()) {
                    if (allowedDirs.has(entry))
                        continue;
                    walk(full);
                }
                else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
                    files.push(full);
            }
        };
        walk(apiRoot);
        for (const file of files) {
            const src = (0, node_fs_1.readFileSync)(file, 'utf8');
            if (forbidden.test(src) && src.includes('COMBAT_FORMULA_DUPLICATION_EXCEPTION'))
                continue;
            node_assert_1.strict.doesNotMatch(src, forbidden, `${file} should not define duplicate player-combat formula constants/phases`);
        }
    });
});
