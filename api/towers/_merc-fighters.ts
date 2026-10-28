/*
 * Village-War mercenary fighters + the SERVER-AUTHORITATIVE merc-vs-player battle
 * (Phase 5, §17.5). A hired merc is a PEAK Battle-Towers fighter (capped stats + a
 * max-mastery jutsu kit + gear, lvl 75-100). When a merc attacks an enemy-village
 * player the fight resolves HEADLESS via the towers engine (both sides AI-driven,
 * deterministic by seed) — so the outcome is server-authoritative and the defender
 * can't suppress a merc win the way a client-run PvE fight would let them.
 *
 * Pure + deterministic: takes a SEALED player combat snapshot (api/towers/_seal
 * sealTowerFighter) + a seed; no kv / Date.now in the resolution path (the caller
 * stamps now/seed). The contest application + WR refund live in the endpoint.
 *
 * Hired bands are prepared special NPCs with catalog techniques, shared level
 * pools and legal equipment, without bloodline/item-damage multipliers. Their
 * opponent uses the existing sealed defender AI, not live player inputs.
 */
import { createTowerSession, type TowerActor } from './_tower-session.js';
import { runTowerFloor } from './_engine.js';
import { makeRng } from './_sim.js';
import type { TowerFloor } from './_floor-catalog.js';
import { jutsuLevelCapForLevel, statCapForLevel } from '../combat-core/formulas.js';
import { startingItemShield } from '../combat-core/shields.js';
import { pveAiItemCharges } from '../combat-core/ai-items.js';
import { resolveAiProfileJutsu, MAX_CHALLENGE_AI_LOADOUT_JUTSU, teachPveGapClosingJutsu, type AiOpponentJutsu } from '../_ai-opponent-loadout.js';
import { COMBAT_RESOURCES_V2, v2JutsuCosts } from '../_combat-resources.js';
import { maxHpForLevel, maxChakraForLevel, maxStaminaForLevel } from '../_xp-engine.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { warMercenaryCombatProfile } from '../../shared/war-mercenary-profile.js';

const STAT_KEYS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'taijutsuOffense', 'taijutsuDefense', 'bukijutsuOffense', 'bukijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
] as const;

// A two-nature veteran curriculum, capped at the baseline player's 12 slots.
// All EP/AP/tags/cooldowns come from the catalog. Six or more strikes cover
// recovery turns; 40AP stances can pair with a 60AP attack. Upper tiers add
// counters rather than inflating the EP of their attacks.
function mercJutsuKit(level: number): Array<Record<string, unknown>> {
    const ids = [
        'starter-buki-earth-2', 'starter-tai-earth-2', 'starter-tai-wind-2',
        'starter-nin-earth-2', 'starter-nin-wind-2', 'starter-gen-wind-2',
        'starter-buki-wind-4', 'starter-buki-earth-3', 'starter-universal-flicker',
    ];
    if (level >= 80) ids.splice(1, 0, 'starter-gen-earth-2');
    if (level >= 85) ids.splice(1, 0, 'starter-buki-wind-2');
    if (level >= 95) ids.push(level >= 100 ? 'starter-gen-earth-4' : 'starter-tai-wind-4');
    return resolveAiProfileJutsu(ids, null, MAX_CHALLENGE_AI_LOADOUT_JUTSU).map(j => ({ ...j,
        ...(COMBAT_RESOURCES_V2 ? v2JutsuCosts(j, level, 'Taijutsu') : {}),
    }));
}
/** Newly hired war combatants only. Existing Tower squad recruits use their own
 * builder; human and ranked combat formulas are untouched. */
export function buildMercCharacter(level: number): Record<string, unknown> {
    level = Math.max(1, Math.min(100, Math.floor(Number(level) || 1)));
    const cap = statCapForLevel(level);
    const stats: Record<string, number> = {};
    for (const k of STAT_KEYS) stats[k] = cap;
    const jutsu = mercJutsuKit(level);
    const weapon = { ...ITEM_CATALOG[level >= 80 ? 'worldsplitter-katana' : 'elderbranch-katana'] };
    // Same single equipment bonus as player hydration; mastery is not baked in.
    for (const [key, bonus] of Object.entries(weapon.bonuses ?? {})) stats[key] = (stats[key] ?? 0) + Number(bonus);
    return {
        level,
        specialty: 'Taijutsu',
        elements: ['Earth', 'Wind'],
        warMercenaryProfile: warMercenaryCombatProfile(level),
        stats,
        jutsu,
        jutsuMastery: jutsu.map((j) => ({ jutsuId: j.id, level: jutsuLevelCapForLevel(level) })),
        equipment: { hand: weapon.id },
        pvpItems: [weapon],
        bloodlineMult: 1,   // no bloodline — kept fair/beatable
        itemDamagePct: 0,
        armorRawDR: 0.35,   // a basic armor (modest DR)
        maxHp: maxHpForLevel(level),
        maxChakra: maxChakraForLevel(level),
        maxStamina: maxStaminaForLevel(level),
    };
}

function mercActor(level: number): TowerActor {
    const character = buildMercCharacter(level);
    const hp = Number(character.maxHp);
    return {
        id: 'merc-0', side: 'enemy', name: 'Mercenary ' + warMercenaryCombatProfile(level).role, ownerSlug: null, ai: true,
        hp, maxHp: hp, chakra: Number(character.maxChakra), maxChakra: Number(character.maxChakra),
        stamina: Number(character.maxStamina), maxStamina: Number(character.maxStamina),
        shield: 0, statuses: [], cooldowns: {}, pos: 60, character,
    };
}

function playerActorFromSealed(name: string, ownerSlug: string, sealedChar: Record<string, unknown>): TowerActor {
    const maxHp = Math.max(1, Number(sealedChar.maxHp) || 1000);
    const maxChakra = Math.max(0, Number(sealedChar.maxChakra) || 50);
    const maxStamina = Math.max(0, Number(sealedChar.maxStamina) || 50);
    return {
        id: 'sq-0', side: 'squad', name, ownerSlug, ai: true,
        hp: maxHp, maxHp, chakra: maxChakra, maxChakra, stamina: maxStamina, maxStamina,
        // The defender's gear Shield special, timed in createTowerSession.
        shield: startingItemShield(sealedChar), statuses: [], cooldowns: {}, pos: 10, character: sealedChar,
    };
}

const MERC_FLOOR: TowerFloor = {
    id: 1, name: 'Mercenary Skirmish', biome: 'central', objective: 'defeat-all',
    roundBudget: 25, map: { width: 12, height: 10 }, fieldRule: { kind: 'none' },
    enemies: [], firstClearReward: {},
};

export type MercBattleWinner = 'merc' | 'player' | 'stall';
export interface MercBattleResult {
    winner: MercBattleWinner;
    mercWon: boolean;    // → the band's side scores (full weight in a sector war)
    playerWon: boolean;  // → the player's side scores at the merc-repel fraction
    rounds: number;
    log: string[];
    /** Internal offline evidence; omitted by existing injected fight mocks. */
    vitals?: { player: { hp: number; maxHp: number; shield: number }; merc: { hp: number; maxHp: number; shield: number } };
}

/** Auto-resolve a merc-vs-player battle SERVER-SIDE (both AI-driven, deterministic
 *  by seed): the player's sealed combat snapshot fights a peak merc of `mercLevel`.
 *  The REAL outcome is read from who actually died — a towers "stall" defaults to
 *  the enemy, but for a siege a stall is a DRAW (neither chips nor regens). */
export function resolveMercBattle(args: {
    playerName: string;
    playerSlug: string;
    playerSealedChar: Record<string, unknown>;
    mercLevel: number;
    seed: number;
    now: number;
    gapClosingJutsu?: readonly AiOpponentJutsu[];
}): MercBattleResult {
    const merc = mercActor(args.mercLevel);
    teachPveGapClosingJutsu(merc.character, args.gapClosingJutsu ?? []);
    merc.itemCharges = pveAiItemCharges(merc.character);
    const player = playerActorFromSealed(args.playerName, args.playerSlug, args.playerSealedChar);
    const session = createTowerSession({
        towerId: 'merc-skirmish',
        runId: `merc-${args.seed}`,
        floor: MERC_FLOOR.id,
        seed: args.seed,
        partySize: 1,
        map: { width: 12, height: 10, biome: 'central', blockedTiles: [], hazardTiles: [], objectiveTiles: [], features: [] },
        actors: [player, merc],
        objectiveKind: 'defeat-all',
        now: args.now,
    });
    // Veteran competence enables public-state Clear/Cleanse decisions. All live
    // war tiers are 75+, where the onboarding hit ceiling is a no-op.
    session.pveGuard = { enemyLevel: args.mercLevel, turnStartHp: {}, dealtThisTurn: {} };
    const preparation = merc.name + ': ' + warMercenaryCombatProfile(args.mercLevel).tactics + ' Both combatants use their prepared loadouts automatically.';
    const out = runTowerFloor(session, MERC_FLOOR, makeRng(args.seed));
    const playerDead = (out.actors.find((a) => a.id === 'sq-0')?.hp ?? 1) <= 0;
    const mercDead = (out.actors.find((a) => a.id === 'merc-0')?.hp ?? 1) <= 0;
    const winner: MercBattleWinner = mercDead ? 'player' : playerDead ? 'merc' : 'stall';
    return {
        winner,
        mercWon: winner === 'merc',
        playerWon: winner === 'player',
        rounds: out.round,
        log: [preparation, ...out.log],
        vitals: { player: { hp: player.hp, maxHp: player.maxHp, shield: player.shield }, merc: { hp: merc.hp, maxHp: merc.maxHp, shield: merc.shield } },
    };
}
