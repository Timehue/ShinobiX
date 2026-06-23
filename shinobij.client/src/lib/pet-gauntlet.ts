/*
 * pet-gauntlet — the Pet Gauntlet roguelike run engine (state machine only).
 *
 * A run = a sequence of escalating fights. Between fights you DRAFT from a shop
 * into a small run-only roster, field up to 2 of them, and chase element/role
 * SYNERGIES (lib/pet-synergies.ts). The fight itself is the deterministic
 * continuous duel — this module never simulates combat; the UI hands the fielded
 * (synergy-buffed) squad to runPetPartyDuel and reports back win/loss.
 *
 * LOCKED DESIGN (owner): FRESH-DRAFT, RUN-ONLY pets pulled from the EXISTING
 * roster (rawPetPool → balanceBuiltInPetTemplate) — no new pets, and drafted pets
 * vanish at run end (the gauntlet never touches the player's real collection).
 * V1 = PREVIEW: no rewards (the UI grants nothing); fields up to 2 so it reuses
 * runPetPartyDuel + PetColiseumDuel with ZERO engine/renderer changes. A larger
 * fielded squad (deeper synergies) is a v2 that needs an N-v-N sim wrapper +
 * renderer work.
 *
 * Pure + deterministic: every roll is a function of (seed, round, rerolls) via a
 * seeded PRNG, so a run is reproducible (and server-validatable later). No
 * Math.random / Date.
 */

import type { Pet, PetRarity } from "../types/pet";
import { rawPetPool } from "../data/pet-pool";
import { balanceBuiltInPetTemplate } from "./pet-balance";
import { derivePetRole, type PetRole } from "./pet-roles";
import { petCardImage } from "./pet-battle-anim";

// ── Tunables ─────────────────────────────────────────────────────────────────
export const GAUNTLET_START_HEARTS = 3;
export const GAUNTLET_START_GOLD = 10;
export const GAUNTLET_ROSTER_CAP = 5;   // how many run-pets you can hold
export const GAUNTLET_FIELD_CAP = 2;    // how many you fight with (v1 = runPetPartyDuel)
export const GAUNTLET_SHOP_SIZE = 4;
export const GAUNTLET_MAX_ROUNDS = 8;
export const GAUNTLET_REROLL_COST = 1;

const RARITY_COST: Record<PetRarity, number> = { standard: 3, rare: 5, legendary: 7, mythic: 9 };

// Balanced pool, indexed by rarity. Built once from the canonical templates —
// the SAME transform App.tsx applies (rawPetPool.map(balanceBuiltInPetTemplate)).
const POOL: Pet[] = rawPetPool.map(balanceBuiltInPetTemplate);
const POOL_BY_RARITY: Record<PetRarity, Pet[]> = { standard: [], rare: [], legendary: [], mythic: [] };
for (const p of POOL) (POOL_BY_RARITY[p.rarity] ??= []).push(p);

// ── Seeded PRNG (mulberry32) ─────────────────────────────────────────────────
function hashSeed(...nums: number[]): number {
    let h = 2166136261 >>> 0;
    for (const n of nums) { h = Math.imul(h ^ (n >>> 0), 16777619) >>> 0; h = Math.imul(h ^ (n >> 16), 16777619) >>> 0; }
    return h >>> 0;
}
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function pickN<T>(arr: T[], n: number, rng: () => number): T[] {
    const pool = arr.slice();
    const out: T[] = [];
    for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return out;
}

// ── Difficulty curves (deterministic functions of round) ─────────────────────
/** Rarity tiers a player can DRAFT this round (escalates so the shop stays fresh). */
function shopRaritiesForRound(round: number): PetRarity[] {
    if (round <= 2) return ["standard", "standard", "standard", "rare"];
    if (round <= 4) return ["standard", "rare", "rare", "legendary"];
    if (round <= 6) return ["rare", "rare", "legendary", "legendary"];
    return ["rare", "legendary", "legendary", "mythic"];
}
/** The enemy squad's rarity + size + a small per-round stat bump on top of rarity. */
function enemyRarityForRound(round: number): PetRarity {
    if (round <= 2) return "standard";
    if (round <= 4) return "rare";
    if (round <= 6) return "legendary";
    return "mythic";
}
function enemySizeForRound(round: number): number {
    return round <= 2 ? 1 : 2;
}
function enemyStatMultForRound(round: number): number {
    return 1 + (round - 1) * 0.04;   // gentle escalation layered over the rarity jump
}
function goldRewardForRound(round: number): number {
    return 4 + round;   // round 1 win = 5g … round 8 = 12g
}

// ── Run-pet instantiation (run-only copies) ──────────────────────────────────
/** Clone a template into a run-only pet: a unique instance id (so duplicates and
 *  the UI keys never collide) + a PINNED role (derived from the ORIGINAL id, since
 *  the new id would otherwise re-roll derivePetRole's variant). */
function instantiate(template: Pet, instanceN: number, statMult = 1): Pet {
    const role: PetRole = (template.role as PetRole | undefined) ?? derivePetRole(template).role;
    const scale = (v: number, min: number) => Math.max(min, Math.round(v * statMult));
    return {
        ...template,
        // Unique id whose trailing 10-digit suffix petStripVariant() strips back to
        // the canonical `<rarity>-<index>` — so the 2.5D pose art (keyed by that id)
        // resolves for the drafted copy: the animated in-fight flipbook (posedId)
        // AND, via the bodyImage below, the static avatars/cards.
        id: `${template.id}-${1000000000 + instanceN}`,
        role,
        // Pin the idle 2.5D render as the body sprite so the avatar/card renderers
        // (which don't fall back to poses) show real art instead of name-initials.
        bodyImage: petCardImage(template) || template.bodyImage,
        hp: scale(template.hp, 1),
        attack: scale(template.attack, 1),
        defense: scale(template.defense, 0),
        speed: scale(template.speed, 1),
    };
}

// ── Run state ────────────────────────────────────────────────────────────────
export interface GauntletOffer { pet: Pet; cost: number; }
export type GauntletStatus = "drafting" | "fighting" | "won" | "lost";

export interface GauntletRun {
    seed: number;
    round: number;            // 1-based current round
    maxRounds: number;
    hearts: number;
    gold: number;
    rerolls: number;          // shop rerolls this round (also salts the shop roll)
    instanceCounter: number;  // monotonic → unique run-pet ids
    roster: Pet[];            // drafted run-pets you hold
    fieldIds: string[];       // which roster pets are fielded (≤ FIELD_CAP), lead first
    shop: GauntletOffer[];
    status: GauntletStatus;
    log: string[];
}

function rollShop(seed: number, round: number, rerolls: number): GauntletOffer[] {
    const rng = mulberry32(hashSeed(seed, round, rerolls, 0x5407));
    return shopRaritiesForRound(round).slice(0, GAUNTLET_SHOP_SIZE).map((rarity) => {
        const tier = POOL_BY_RARITY[rarity] ?? [];
        const pet = tier.length ? tier[Math.floor(rng() * tier.length)] : POOL[0];
        return { pet, cost: RARITY_COST[pet.rarity] };
    });
}

/** Start a fresh run. Deterministic from the seed. */
export function startGauntletRun(seed: number): GauntletRun {
    return {
        seed: seed >>> 0,
        round: 1,
        maxRounds: GAUNTLET_MAX_ROUNDS,
        hearts: GAUNTLET_START_HEARTS,
        gold: GAUNTLET_START_GOLD,
        rerolls: 0,
        instanceCounter: 0,
        roster: [],
        fieldIds: [],
        shop: rollShop(seed >>> 0, 1, 0),
        status: "drafting",
        log: ["The Gauntlet begins — draft your squad."],
    };
}

/** Buy shop offer #i into the roster (if affordable + room). */
export function buyOffer(run: GauntletRun, offerIndex: number): GauntletRun {
    if (run.status !== "drafting") return run;
    const offer = run.shop[offerIndex];
    if (!offer) return run;
    if (run.gold < offer.cost) return run;
    if (run.roster.length >= GAUNTLET_ROSTER_CAP) return run;
    const pet = instantiate(offer.pet, run.instanceCounter);
    const roster = [...run.roster, pet];
    // Auto-field newcomers while there's an open fielded slot.
    const fieldIds = run.fieldIds.length < GAUNTLET_FIELD_CAP ? [...run.fieldIds, pet.id] : run.fieldIds;
    return {
        ...run,
        gold: run.gold - offer.cost,
        instanceCounter: run.instanceCounter + 1,
        roster,
        fieldIds,
        shop: run.shop.filter((_, i) => i !== offerIndex),
    };
}

/** Reroll the shop (costs gold). */
export function rerollShop(run: GauntletRun): GauntletRun {
    if (run.status !== "drafting" || run.gold < GAUNTLET_REROLL_COST) return run;
    const rerolls = run.rerolls + 1;
    return { ...run, gold: run.gold - GAUNTLET_REROLL_COST, rerolls, shop: rollShop(run.seed, run.round, rerolls) };
}

/** Release a run-pet from the roster (no refund — v1 keeps the economy simple). */
export function releasePet(run: GauntletRun, petId: string): GauntletRun {
    if (run.status !== "drafting") return run;
    return {
        ...run,
        roster: run.roster.filter((p) => p.id !== petId),
        fieldIds: run.fieldIds.filter((id) => id !== petId),
    };
}

/** Set which roster pets are fielded (clamped to FIELD_CAP, order = lead first). */
export function setField(run: GauntletRun, fieldIds: string[]): GauntletRun {
    if (run.status !== "drafting") return run;
    const valid = fieldIds.filter((id) => run.roster.some((p) => p.id === id)).slice(0, GAUNTLET_FIELD_CAP);
    return { ...run, fieldIds: valid };
}

/** The fielded pets (lead first), in roster order of fieldIds. */
export function fieldedPets(run: GauntletRun): Pet[] {
    return run.fieldIds.map((id) => run.roster.find((p) => p.id === id)).filter((p): p is Pet => !!p);
}

/** The deterministic enemy squad for the current round. */
export function enemySquadForRound(run: GauntletRun): Pet[] {
    const rng = mulberry32(hashSeed(run.seed, run.round, 0x3a17));
    const rarity = enemyRarityForRound(run.round);
    const size = enemySizeForRound(run.round);
    const mult = enemyStatMultForRound(run.round);
    const tier = POOL_BY_RARITY[rarity] ?? POOL_BY_RARITY.standard;
    return pickN(tier, size, rng).map((tpl, i) => instantiate(tpl, 100000 + run.round * 10 + i, mult));
}

/** Begin the current round's fight (requires at least one fielded pet). */
export function beginFight(run: GauntletRun): GauntletRun {
    if (run.status !== "drafting" || run.fieldIds.length === 0) return run;
    return { ...run, status: "fighting" };
}

/**
 * Apply the result of the current round's fight.
 * Win → gold reward + advance (clearing the final round = "won").
 * Loss → lose a heart (0 hearts = "lost"); the round still advances.
 * Either way (if the run continues) a fresh shop rolls for the next round.
 */
export function applyRoundResult(run: GauntletRun, won: boolean): GauntletRun {
    if (run.status !== "fighting") return run;
    const nextRound = run.round + 1;
    if (won) {
        const reward = goldRewardForRound(run.round);
        if (run.round >= run.maxRounds) {
            return { ...run, status: "won", gold: run.gold + reward, log: [...run.log, `Round ${run.round} won — THE GAUNTLET IS CLEARED! 🏆`] };
        }
        return {
            ...run, status: "drafting", round: nextRound, gold: run.gold + reward, rerolls: 0,
            shop: rollShop(run.seed, nextRound, 0),
            log: [...run.log, `Round ${run.round} won! +${reward}g — draft for round ${nextRound}.`],
        };
    }
    const hearts = run.hearts - 1;
    if (hearts <= 0) {
        return { ...run, status: "lost", hearts: 0, log: [...run.log, `Round ${run.round} lost — out of hearts. Run over.`] };
    }
    if (run.round >= run.maxRounds) {
        return { ...run, status: "won", hearts, log: [...run.log, `Final round lost, but you survived the Gauntlet with ${hearts} ❤ left.`] };
    }
    return {
        ...run, status: "drafting", round: nextRound, hearts, rerolls: 0,
        shop: rollShop(run.seed, nextRound, 0),
        log: [...run.log, `Round ${run.round} lost — ${hearts} ❤ left. On to round ${nextRound}.`],
    };
}
