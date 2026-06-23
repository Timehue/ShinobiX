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
// The in-run shop currency is VALOR — a run-local resource you earn by winning
// rounds and spend in the shop. It is NOT Ryo (the global game currency); Ryo is
// only ever PAID OUT as the run reward, server-side. Keeping them distinct means
// the gauntlet can never touch (or be cheated for) the player's real Ryo balance.
export const GAUNTLET_START_HEARTS = 3;
export const GAUNTLET_START_VALOR = 10;
export const GAUNTLET_ROSTER_CAP = 5;   // how many run-pets you can hold
export const GAUNTLET_FIELD_CAP = 5;    // how many you field on the board (= BOARD_SQUAD_MAX)
export const GAUNTLET_SHOP_SIZE = 4;
export const GAUNTLET_MAX_ROUNDS = 10;
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
    if (round <= 8) return ["rare", "legendary", "legendary", "mythic"];
    return ["legendary", "legendary", "mythic", "mythic"];
}
/** The enemy squad's rarity + size + a small per-round stat bump on top of rarity. */
function enemyRarityForRound(round: number): PetRarity {
    if (round <= 2) return "standard";
    if (round <= 5) return "rare";
    if (round <= 8) return "legendary";
    return "mythic";
}
function enemySizeForRound(round: number): number {
    if (round <= 2) return 2;
    if (round <= 4) return 3;
    if (round <= 6) return 4;
    return 5;   // BOARD_SQUAD_MAX
}
function enemyStatMultForRound(round: number): number {
    return 1 + (round - 1) * 0.04;   // gentle escalation layered over the rarity jump
}
/** Valor paid for clearing a round (run-local shop currency — NOT Ryo). */
function valorRewardForRound(round: number): number {
    return 4 + round;   // round 1 win = 5 valor … round 10 = 14 valor
}

// ── Shop items (Valor consumables) ───────────────────────────────────────────
// A fixed shelf of non-pet buys, alongside the rolled pet offers. Stat items add
// a permanent run-wide multiplier applied to the fielded squad at fight time
// (exactly like a synergy — so the board engine never changes); Mend restores a
// heart. Costs scale with the number already bought this run so they can't be
// spammed into a runaway squad.
export type GauntletItemId = "mend" | "whetstone" | "bulwark" | "vigor";
export interface GauntletItemDef {
    id: GauntletItemId; name: string; icon: string; blurb: string;
    baseCost: number; step: number; max: number;
}
export const GAUNTLET_ITEMS: GauntletItemDef[] = [
    { id: "mend",      name: "Field Medic",  icon: "❤️", blurb: "Restore 1 heart.",                 baseCost: 6, step: 3, max: 3 },
    { id: "whetstone", name: "Whetstone",    icon: "⚔️", blurb: "+8% Attack to your whole squad.",  baseCost: 4, step: 2, max: 6 },
    { id: "bulwark",   name: "Bulwark",      icon: "🛡️", blurb: "+8% Defense to your whole squad.", baseCost: 4, step: 2, max: 6 },
    { id: "vigor",     name: "Vigor Charm",  icon: "💗", blurb: "+8% HP to your whole squad.",      baseCost: 4, step: 2, max: 6 },
];
const GAUNTLET_ITEM_BY_ID: Record<GauntletItemId, GauntletItemDef> =
    Object.fromEntries(GAUNTLET_ITEMS.map((d) => [d.id, d])) as Record<GauntletItemId, GauntletItemDef>;
/** The Valor cost of the NEXT purchase of an item, given how many are already owned. */
export function itemCost(def: GauntletItemDef, owned: number): number {
    return def.baseCost + def.step * Math.max(0, owned);
}
/** Run-wide stat buffs accumulated from shop items + relics (fractional pct). */
export interface GauntletBuffs { atk: number; def: number; hp: number; spd: number; }
const EMPTY_BUFFS: GauntletBuffs = { atk: 0, def: 0, hp: 0, spd: 0 };

// ── Relics (bought with Valor in the shop) ───────────────────────────────────
// Permanent run-long boons, owned at most once. A small shelf rolls each round
// alongside the pet offers, so a relic competes with recruiting/items for Valor.
// v1 effects are engine-light (squad stat scales folded into the buffs, plus two
// economy boons), so the determinism-locked board sim never changes.
export type RelicId = "titan_heart" | "razor_fang" | "aegis_plating" | "swift_wind" | "merchant_charm" | "lucky_coin";
export interface RelicDef {
    id: RelicId; name: string; icon: string; blurb: string; cost: number;
    stat?: Partial<GauntletBuffs>;   // squad stat scale folded into run.buffs on purchase
    valorPerRound?: number;          // passive Valor income each new round
    freeReroll?: boolean;            // first reroll each round is free
}
export const GAUNTLET_RELICS: RelicDef[] = [
    { id: "titan_heart",    name: "Titan's Heart",     icon: "💖", blurb: "+25% squad HP for the run.",                   cost: 8, stat: { hp: 0.25 } },
    { id: "razor_fang",     name: "Razor Fang",        icon: "🦷", blurb: "+18% squad Attack for the run.",               cost: 8, stat: { atk: 0.18 } },
    { id: "aegis_plating",  name: "Aegis Plating",     icon: "🛡️", blurb: "+25% squad Defense for the run.",              cost: 6, stat: { def: 0.25 } },
    { id: "swift_wind",     name: "Swift Wind",        icon: "🌀", blurb: "+20% squad Speed — your pets act first.",      cost: 6, stat: { spd: 0.20 } },
    { id: "merchant_charm", name: "Merchant's Charm",  icon: "🪙", blurb: "+3 Valor at the start of every round.",        cost: 7, valorPerRound: 3 },
    { id: "lucky_coin",     name: "Lucky Coin",        icon: "🍀", blurb: "Your first reroll each round is free.",        cost: 5, freeReroll: true },
];
const RELIC_BY_ID: Record<RelicId, RelicDef> =
    Object.fromEntries(GAUNTLET_RELICS.map((d) => [d.id, d])) as Record<RelicId, RelicDef>;
const RELIC_SHOP_SIZE = 2;
export function relicDef(id: RelicId): RelicDef { return RELIC_BY_ID[id]; }
/** Total passive Valor-per-round granted by the owned relics. */
export function relicValorPerRound(relics: RelicId[]): number {
    return relics.reduce((s, id) => s + (RELIC_BY_ID[id]?.valorPerRound ?? 0), 0);
}
/** Whether the owned relics make the first reroll of a round free. */
export function hasFreeReroll(relics: RelicId[]): boolean {
    return relics.some((id) => RELIC_BY_ID[id]?.freeReroll);
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
    valor: number;            // run-local shop currency (NOT Ryo)
    rerolls: number;          // shop rerolls this round (also salts the shop roll)
    instanceCounter: number;  // monotonic → unique run-pet ids
    roster: Pet[];            // drafted run-pets you hold
    fieldIds: string[];       // which roster pets are fielded (≤ FIELD_CAP), lead first
    shop: GauntletOffer[];
    itemsBought: Record<GauntletItemId, number>;  // how many of each shop item bought
    relics: RelicId[];        // owned relics (each at most once)
    relicShop: RelicId[];     // relic offers available this round
    buffs: GauntletBuffs;     // run-wide squad stat boosts from items + relics
    roundsCleared: number;    // rounds WON so far (drives the Ryo reward + leaderboard)
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

/** Roll the relic shelf for a round — up to RELIC_SHOP_SIZE relics not yet owned. */
function rollRelicShop(seed: number, round: number, rerolls: number, owned: RelicId[]): RelicId[] {
    const rng = mulberry32(hashSeed(seed, round, rerolls, 0x9e3d));
    const pool = GAUNTLET_RELICS.map((d) => d.id).filter((id) => !owned.includes(id));
    return pickN(pool, RELIC_SHOP_SIZE, rng);
}

/** Start a fresh run. Deterministic from the seed. */
export function startGauntletRun(seed: number): GauntletRun {
    return {
        seed: seed >>> 0,
        round: 1,
        maxRounds: GAUNTLET_MAX_ROUNDS,
        hearts: GAUNTLET_START_HEARTS,
        valor: GAUNTLET_START_VALOR,
        rerolls: 0,
        instanceCounter: 0,
        roster: [],
        fieldIds: [],
        shop: rollShop(seed >>> 0, 1, 0),
        itemsBought: { mend: 0, whetstone: 0, bulwark: 0, vigor: 0 },
        relics: [],
        relicShop: rollRelicShop(seed >>> 0, 1, 0, []),
        buffs: { ...EMPTY_BUFFS },
        roundsCleared: 0,
        status: "drafting",
        log: ["The Gauntlet begins — draft your squad."],
    };
}

/** Buy shop offer #i into the roster (if affordable + room). */
export function buyOffer(run: GauntletRun, offerIndex: number): GauntletRun {
    if (run.status !== "drafting") return run;
    const offer = run.shop[offerIndex];
    if (!offer) return run;
    if (run.valor < offer.cost) return run;
    if (run.roster.length >= GAUNTLET_ROSTER_CAP) return run;
    const pet = instantiate(offer.pet, run.instanceCounter);
    const roster = [...run.roster, pet];
    // Auto-field newcomers while there's an open fielded slot.
    const fieldIds = run.fieldIds.length < GAUNTLET_FIELD_CAP ? [...run.fieldIds, pet.id] : run.fieldIds;
    return {
        ...run,
        valor: run.valor - offer.cost,
        instanceCounter: run.instanceCounter + 1,
        roster,
        fieldIds,
        shop: run.shop.filter((_, i) => i !== offerIndex),
    };
}

/** Buy a Valor shop item (Mend heals a heart; the rest add a run-wide squad buff). */
export function buyItem(run: GauntletRun, itemId: GauntletItemId): GauntletRun {
    if (run.status !== "drafting") return run;
    const def = GAUNTLET_ITEM_BY_ID[itemId];
    if (!def) return run;
    const owned = run.itemsBought[itemId] ?? 0;
    if (owned >= def.max) return run;
    if (itemId === "mend" && run.hearts >= GAUNTLET_START_HEARTS) return run;   // already topped up
    const cost = itemCost(def, owned);
    if (run.valor < cost) return run;
    const next: GauntletRun = {
        ...run,
        valor: run.valor - cost,
        itemsBought: { ...run.itemsBought, [itemId]: owned + 1 },
    };
    if (itemId === "mend") next.hearts = Math.min(GAUNTLET_START_HEARTS, run.hearts + 1);
    else if (itemId === "whetstone") next.buffs = { ...run.buffs, atk: run.buffs.atk + 0.08 };
    else if (itemId === "bulwark") next.buffs = { ...run.buffs, def: run.buffs.def + 0.08 };
    else if (itemId === "vigor") next.buffs = { ...run.buffs, hp: run.buffs.hp + 0.08 };
    return next;
}

/** Buy a relic from the relic shelf (Valor; owned at most once). Stat relics fold
 *  into the run buffs immediately; economy relics take effect via their helpers. */
export function buyRelic(run: GauntletRun, relicId: RelicId): GauntletRun {
    if (run.status !== "drafting") return run;
    if (!run.relicShop.includes(relicId) || run.relics.includes(relicId)) return run;
    const def = RELIC_BY_ID[relicId];
    if (!def || run.valor < def.cost) return run;
    return {
        ...run,
        valor: run.valor - def.cost,
        relics: [...run.relics, relicId],
        relicShop: run.relicShop.filter((id) => id !== relicId),
        buffs: mergeRelicStat(run.buffs, def.stat),
    };
}

/** Reroll the shop — re-rolls both the pet offers and the relic shelf. The first
 *  reroll of a round is free with the Lucky Coin relic. */
export function rerollShop(run: GauntletRun): GauntletRun {
    if (run.status !== "drafting") return run;
    const cost = hasFreeReroll(run.relics) && run.rerolls === 0 ? 0 : GAUNTLET_REROLL_COST;
    if (run.valor < cost) return run;
    const rerolls = run.rerolls + 1;
    return {
        ...run,
        valor: run.valor - cost,
        rerolls,
        shop: rollShop(run.seed, run.round, rerolls),
        relicShop: rollRelicShop(run.seed, run.round, rerolls, run.relics),
    };
}

/** Apply the run-wide item + relic buffs to a fielded squad (run-only copies; min-1 stats). */
export function applyGauntletBuffs(pets: Pet[], buffs: GauntletBuffs): Pet[] {
    if (buffs.atk === 0 && buffs.def === 0 && buffs.hp === 0 && buffs.spd === 0) return pets;
    return pets.map((p) => ({
        ...p,
        hp: Math.max(1, Math.round(p.hp * (1 + buffs.hp))),
        attack: Math.max(1, Math.round(p.attack * (1 + buffs.atk))),
        defense: Math.max(0, Math.round(p.defense * (1 + buffs.def))),
        speed: Math.max(1, Math.round(p.speed * (1 + buffs.spd))),
    }));
}

/** Add a relic's stat scale into the accumulated run buffs. */
function mergeRelicStat(buffs: GauntletBuffs, stat?: Partial<GauntletBuffs>): GauntletBuffs {
    if (!stat) return buffs;
    return {
        atk: buffs.atk + (stat.atk ?? 0),
        def: buffs.def + (stat.def ?? 0),
        hp: buffs.hp + (stat.hp ?? 0),
        spd: buffs.spd + (stat.spd ?? 0),
    };
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
    const income = relicValorPerRound(run.relics);   // passive Valor when entering the next round
    if (won) {
        const reward = valorRewardForRound(run.round);
        const roundsCleared = run.roundsCleared + 1;
        if (run.round >= run.maxRounds) {
            return { ...run, status: "won", valor: run.valor + reward, roundsCleared, log: [...run.log, `Round ${run.round} won — THE GAUNTLET IS CLEARED! 🏆`] };
        }
        return {
            ...run, status: "drafting", round: nextRound, valor: run.valor + reward + income, roundsCleared, rerolls: 0,
            shop: rollShop(run.seed, nextRound, 0),
            relicShop: rollRelicShop(run.seed, nextRound, 0, run.relics),
            log: [...run.log, `Round ${run.round} won! +${reward}${income ? `+${income}` : ""} Valor — draft for round ${nextRound}.`],
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
        ...run, status: "drafting", round: nextRound, hearts, valor: run.valor + income, rerolls: 0,
        shop: rollShop(run.seed, nextRound, 0),
        relicShop: rollRelicShop(run.seed, nextRound, 0, run.relics),
        log: [...run.log, `Round ${run.round} lost — ${hearts} ❤ left. On to round ${nextRound}.`],
    };
}
