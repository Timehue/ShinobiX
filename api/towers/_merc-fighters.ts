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
 * The merc is deliberately a CREDIBLE-BUT-BEATABLE peak fighter — capped stats and
 * a solid kit, but NO bloodline / item-damage bonuses, so a well-built player
 * out-guns it. All numbers are tunable (verified by _merc-fighters.test.ts).
 */
import { createTowerSession, type TowerActor } from './_tower-session.js';
import { runTowerFloor } from './_engine.js';
import { makeRng } from './_sim.js';
import type { TowerFloor } from './_floor-catalog.js';

// Per-rank stat cap (mirrors api/pvp/move.ts statCapForLevel, which isn't exported;
// the engine clamps to this anyway). A peak merc fills every stat to its cap.
function statCapForLevel(level: number): number {
    const lvl = Math.max(1, Math.floor(Number(level) || 1));
    if (lvl >= 80) return 2500;
    if (lvl >= 50) return 2100;
    if (lvl >= 30) return 1300;
    if (lvl >= 15) return 700;
    return 350;
}

// A peak merc's max HP, scaled by tier level. Tunable.
function mercMaxHp(level: number): number {
    return Math.round(2200 + Math.max(1, level) * 28); // L75 ≈ 4300, L100 ≈ 5000
}

const STAT_KEYS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'taijutsuOffense', 'taijutsuDefense', 'bukijutsuOffense', 'bukijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
] as const;

// The merc's fixed Taijutsu kit: 5 elemental strikes (cd 7 — the AI rotates through
// them) + a Flicker for mobility. Real catalog ids so jutsuMastery applies. The
// fighter's `specialty` matches (Taijutsu) so the engine's AI picks these.
function mercJutsuKit(): Array<Record<string, unknown>> {
    const strike = (id: string, name: string, element: string, tag?: { name: string; percent: number }) => ({
        id, name, type: 'Taijutsu', element, ap: 60, range: 4, effectPower: 36, cooldown: 7,
        chakraCost: 250, staminaCost: 250, target: 'OPPONENT', method: 'SINGLE',
        tags: tag ? [tag] : [],
    });
    return [
        strike('starter-tai-earth-2', 'Boulder Heel Drop', 'Earth', { name: 'Poison', percent: 30 }),
        strike('starter-tai-fire-2', 'Meteor Axe Kick', 'Fire'),
        strike('starter-tai-lightning-2', 'Raikou Knee Strike', 'Lightning', { name: 'Reflect', percent: 30 }),
        strike('starter-tai-water-2', 'Tidal Shoulder Throw', 'Water', { name: 'Increase Damage Given', percent: 30 }),
        strike('starter-tai-wind-2', 'Rising Gale Combo', 'Wind', { name: 'Lifesteal', percent: 30 }),
        { id: 'starter-universal-flicker', name: 'Flicker', type: 'Taijutsu', element: 'None', ap: 20, range: 5, effectPower: 1, cooldown: 2, chakraCost: 25, staminaCost: 25, target: 'EMPTY_GROUND', method: 'SINGLE', tags: [{ name: 'Move', percent: 0 }] },
    ];
}

/** The sealed `character` for a peak merc at a tier level (75-100): capped stats +
 *  a max-mastery Taijutsu kit + a basic weapon/armor. No bloodline / item-damage
 *  bonus → a credible but beatable threat. Tunable. */
export function buildMercCharacter(level: number): Record<string, unknown> {
    const cap = statCapForLevel(level);
    const stats: Record<string, number> = {};
    for (const k of STAT_KEYS) stats[k] = cap;
    const jutsu = mercJutsuKit();
    return {
        level,
        specialty: 'Taijutsu',
        stats,
        jutsu,
        jutsuMastery: jutsu.map((j) => ({ jutsuId: j.id, level: 50 })),
        equipment: { hand: 'merc-blade' },
        pvpItems: [
            { id: 'merc-blade', name: 'Mercenary Blade', slot: 'hand', weaponEp: 24, weaponElement: 'None', weaponRange: 1, apCost: 40, weaponTags: [] },
        ],
        bloodlineMult: 1,   // no bloodline — kept fair/beatable
        itemDamagePct: 0,
        armorRawDR: 0.35,   // a basic armor (modest DR)
        maxHp: mercMaxHp(level),
        maxChakra: 1400,
        maxStamina: 1000,
    };
}

function mercActor(level: number): TowerActor {
    const character = buildMercCharacter(level);
    const hp = Number(character.maxHp);
    return {
        id: 'merc-0', side: 'enemy', name: 'Mercenary', ownerSlug: null, ai: true,
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
        shield: 0, statuses: [], cooldowns: {}, pos: 10, character: sealedChar,
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
    mercWon: boolean;    // → chip Control HP (attacker win)
    playerWon: boolean;  // → 25% defender regen
    rounds: number;
    log: string[];
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
}): MercBattleResult {
    const merc = mercActor(args.mercLevel);
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
    const out = runTowerFloor(session, MERC_FLOOR, makeRng(args.seed));
    const playerDead = (out.actors.find((a) => a.id === 'sq-0')?.hp ?? 1) <= 0;
    const mercDead = (out.actors.find((a) => a.id === 'merc-0')?.hp ?? 1) <= 0;
    const winner: MercBattleWinner = mercDead ? 'player' : playerDead ? 'merc' : 'stall';
    return {
        winner,
        mercWon: winner === 'merc',
        playerWon: winner === 'player',
        rounds: out.round,
        log: out.log,
    };
}
