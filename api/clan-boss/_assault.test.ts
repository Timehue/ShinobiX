/**
 * Clan-boss assault: server-trusted result extraction from a finished tower
 * session, plus the cross-module consistency pin (CLAN_BOSSES ↔ CLAN_BOSS_FLOORS ↔
 * enemy templates) so a boss can never reference a missing floor or template.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { TowerActor, TowerSession } from '../towers/_tower-session.js';
import type { PvpFighter } from '../pvp/session.js';
import { extractAssaultResult } from './_assault.js';
import { CLAN_BOSSES } from './_storage.js';
import { CLAN_BOSS_FLOORS } from '../towers/_floor-catalog.js';
import { hasEnemyTemplate } from '../towers/_enemy-templates.js';
import { clanBossTowerSessionToCombatBattleState, normalizeTowerPlayerJutsuCombat, resolveClanBossPlayerJutsu } from '../combat-adapters/clanBossAdapter.js';
import { applyJutsu } from '../pvp/move.js';

function mkSession(opts: {
    bossHp: number; bossMaxHp: number; squadHps: number[];
    winner: TowerSession['winner']; round: number;
}): TowerSession {
    const actors = [
        { id: 'boss', side: 'enemy', hp: opts.bossHp, maxHp: opts.bossMaxHp },
        ...opts.squadHps.map((hp, i) => ({ id: `sq-${i}`, side: 'squad', hp, maxHp: 1000 })),
    ];
    return {
        phaseState: { bossId: 'boss', pendingPhases: [], triggeredPhases: [] },
        actors, winner: opts.winner, round: opts.round,
    } as unknown as TowerSession;
}

describe('extractAssaultResult', () => {
    it('a clean kill banks full boss HP, no wipe, clean=true', () => {
        const r = extractAssaultResult(mkSession({ bossHp: 0, bossMaxHp: 5000, squadHps: [800, 700, 900], winner: 'squad', round: 15 }));
        assert.deepEqual(r, { won: true, damage: 5000, rounds: 15, wiped: false, clean: true });
    });
    it('a timeout (squad alive, boss not dead) banks partial damage, not a wipe, not clean', () => {
        const r = extractAssaultResult(mkSession({ bossHp: 2000, bossMaxHp: 5000, squadHps: [100, 0, 300], winner: 'enemy', round: 25 }));
        assert.equal(r.won, false);
        assert.equal(r.damage, 3000);
        assert.equal(r.wiped, false);   // someone is still standing
        assert.equal(r.clean, false);
    });
    it('a full wipe (whole party down) is a wipe', () => {
        const r = extractAssaultResult(mkSession({ bossHp: 3000, bossMaxHp: 5000, squadHps: [0, 0, 0], winner: 'enemy', round: 12 }));
        assert.equal(r.won, false);
        assert.equal(r.damage, 2000);
        assert.equal(r.wiped, true);
    });
    it('a win with a downed member is NOT clean', () => {
        const r = extractAssaultResult(mkSession({ bossHp: 0, bossMaxHp: 5000, squadHps: [500, 0, 400], winner: 'squad', round: 18 }));
        assert.equal(r.won, true);
        assert.equal(r.clean, false);
    });
});

describe('clan-boss content consistency', () => {
    it('CLAN_BOSSES and CLAN_BOSS_FLOORS are index-aligned by floorId + mechanic', () => {
        assert.equal(CLAN_BOSSES.length, CLAN_BOSS_FLOORS.length);
        CLAN_BOSSES.forEach((b, i) => {
            const floor = CLAN_BOSS_FLOORS[i]!;
            assert.equal(b.floorId, floor.id, `${b.id} floorId`);
            assert.equal(b.mechanic, floor.boss?.mechanic, `${b.id} mechanic`);
        });
    });
    it('every clan-boss floor references real enemy/boss/summon templates', () => {
        for (const floor of CLAN_BOSS_FLOORS) {
            assert.ok(hasEnemyTemplate(floor.boss!.aiId), `boss template ${floor.boss!.aiId}`);
            for (const pod of floor.enemies) assert.ok(hasEnemyTemplate(pod.aiId), `enemy template ${pod.aiId}`);
            if (floor.boss?.summonAiId) assert.ok(hasEnemyTemplate(floor.boss.summonAiId), `summon template ${floor.boss.summonAiId}`);
        }
    });
});

describe('clan-boss player-combat parity guard', () => {
    it('normalizes a tower session into combat-core battle state without mutating actors', () => {
        const tower = mkSession({ bossHp: 3200, bossMaxHp: 5000, squadHps: [800, 700], winner: null, round: 7 });
        const combat = clanBossTowerSessionToCombatBattleState(tower);
        assert.equal(combat.battleId, 'clan-boss');
        assert.equal(combat.round, 7);
        assert.equal(combat.activeActorId, 'boss');
        assert.equal(combat.fighters.boss?.side, 'enemy');
        assert.equal(combat.fighters.boss?.hp, 3200);
        assert.equal(combat.fighters['sq-0']?.side, 'squad');
        assert.equal(combat.fighters['sq-0']?.hp, 800);
        assert.equal(tower.actors[0]?.hp, 3200);
    });

    it('normalizes player combat context with resources, mastery, equipment, and defense profile', () => {
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
        } as unknown as TowerActor;
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
        } as unknown as TowerActor;

        const normalized = normalizeTowerPlayerJutsuCombat({
            session: { round: 4, map: { biome: 'volcano' } } as TowerSession,
            actor,
            target,
            jutsu,
            wMult: 1.1,
        });

        assert.equal(normalized.self.stats?.ninjutsuOffense, 900);
        assert.deepEqual(normalized.self.character?.jutsuMastery, [{ jutsuId: 'contract-blast', level: 50 }]);
        assert.equal(normalized.self.character?.bloodlineMult, 1.2);
        assert.equal(normalized.self.items?.[0]?.weaponEffect, 'Lifesteal');
        assert.equal(normalized.self.equipment?.armor, 'mist-mail');
        assert.equal(normalized.jutsu.id, 'contract-blast');
        assert.deepEqual(normalized.resources, {
            apCost: 60,
            chakraCost: 25,
            staminaCost: 15,
            cooldownKey: 'contract-blast',
            cooldownTurns: 3,
        });
        assert.deepEqual(normalized.environment, { round: 4, biome: 'volcano', wMult: 1.1 });
        assert.equal(normalized.targetDefense.armorRawDR, 0.25);
        assert.equal(normalized.targetDefense.armorFactor, 0.75);
        assert.equal(normalized.targetDefense.guardDefensePct, 3);
        assert.equal(normalized.targetDefense.statuses[0]?.name, 'Decrease Damage Taken');
    });

    it('player-side resolveJutsu adapter matches the PvP resolver for the same normalized input', () => {
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
        const self: PvpFighter = {
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
        const opponent: PvpFighter = {
            ...self,
            name: 'boss',
            hp: 6000,
            maxHp: 6000,
            pos: 1,
            character: { ...self.character, name: 'boss', jutsu: [], jutsuMastery: [] },
        };

        const pvp = applyJutsu(self, opponent, jutsu, 1, 'central', 1);
        const clanBoss = resolveClanBossPlayerJutsu({
            self,
            opponent,
            jutsu,
            resolver: applyJutsu,
            wMult: 1,
            biome: 'central',
            round: 1,
        });

        assert.deepEqual(clanBoss, pvp);
        assert.ok(opponent.hp - clanBoss.opponent.hp > 0, 'adapter path deals the same direct damage as PvP');
        assert.equal(clanBoss.self.hp, pvp.self.hp);
        assert.equal(clanBoss.self.chakra, pvp.self.chakra, 'resolver does not spend resources; tower/PvP shells do');
        assert.equal(clanBoss.opponent.hp, pvp.opponent.hp);
        assert.equal(clanBoss.opponent.statuses.filter(status => status.name === 'Wound').length, 1, 'Wound applies once, not as an immediate DoT duplicate');
        assert.ok(clanBoss.lines.some(line => line.includes('damage to boss')));
        assert.ok(clanBoss.lines.some(line => line.includes('Wound: boss bleeds')));
    });

    it('reuses PvP combat resolution while documenting remaining tower-local drift', () => {
        const move = readFileSync(join(process.cwd(), 'api', 'pvp', 'move.ts'), 'utf8');
        const engine = readFileSync(join(process.cwd(), 'api', 'towers', '_engine.ts'), 'utf8');
        const adapter = readFileSync(join(process.cwd(), 'api', 'combat-adapters', 'clanBossAdapter.ts'), 'utf8');
        assert.match(
            move,
            /from '..\/combat-core\/resolveJutsu\.js'/,
            'PvP applyJutsu should keep delegating phase order to combat-core',
        );
        assert.match(move, /resolveCoreJutsu\({/, 'PvP applyJutsu should call the combat-core resolver wrapper');
        assert.match(
            engine,
            /resolveTowerPlayerJutsu/,
            'tower/clan-boss hit path should go through the combat adapter seam',
        );
        assert.match(
            engine,
            /applyJutsu as applyPvpJutsu,\s*applyDoTs,\s*tickStatuses,\s*applyGroundEffectToFighter,\s*tickGroundEffects\s*}\s*from '..\/pvp\/move\.js'/,
            'tower/clan-boss still uses PvP as the player-combat truth source while phase wrappers live there',
        );
        assert.match(
            engine,
            /from '..\/combat-core\/formulas\.js'/,
            'tower fallback damage should consume combat-core formula helpers instead of copied constants',
        );
        assert.match(
            adapter,
            /normalizeTowerPlayerJutsuCombat/,
            'adapter should expose a normalized tower/clan-boss player-combat contract',
        );
        assert.doesNotMatch(engine, /function resolveTagStatuses|function resolvePostDamage/, 'tower should not duplicate PvP tag/post-damage resolver phases');
        for (const constant of [
            'BASE_AP',
            'MAX_ACTIONS',
            'MAX_ROUNDS',
            'STUN_AP_PENALTY',
            'MOVE_AP',
            'BASIC_ATTACK_AP',
        ]) {
            assert.match(engine, new RegExp(`export const ${constant} = `), `${constant} is still tower-local and should be migrated deliberately`);
        }
        assert.doesNotMatch(engine, /\bexport const (?:K_DR|JUTSU_MAX_LEVEL|MASTERY_MIN_DAMAGE_FRAC) = /, 'tower should not own copied player damage formula constants');
    });

    it('blocks new duplicate player-combat formulas outside combat-core', () => {
        const apiRoot = join(process.cwd(), 'api');
        const allowedDirs = new Set(['combat-core', 'combat-adapters']);
        const allowedFiles = new Set([
            // PvP remains the live shell/truth source and keeps thin phase
            // wrappers while their shared numeric work delegates to combat-core.
            join(apiRoot, 'pvp', 'move.ts'),
        ]);
        const forbidden = /\b(?:const|function)\s+(?:EP_MULTIPLIER|MASTERY_MIN_DAMAGE_FRAC|JUTSU_MAX_LEVEL|K_DR|K_AMP|K_DISCIPLINE|WOUND_CAP|pierceTrueDamage|scaledTagPercent|ampTagCapForRank|terrainMultiplier|weatherMultiplier|statCapForLevel|jutsuLevelCapForLevel)\b|function\s+resolve(?:BaseDamage|TagStatuses|DamageNumber|PostDamage)\b/;
        const files: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (allowedFiles.has(full)) continue;
                const stat = statSync(full);
                if (stat.isDirectory()) {
                    if (allowedDirs.has(entry)) continue;
                    walk(full);
                }
                else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) files.push(full);
            }
        };
        walk(apiRoot);
        for (const file of files) {
            const src = readFileSync(file, 'utf8');
            if (forbidden.test(src) && src.includes('COMBAT_FORMULA_DUPLICATION_EXCEPTION')) continue;
            assert.doesNotMatch(src, forbidden, `${file} should not define duplicate player-combat formula constants/phases`);
        }
    });
});
