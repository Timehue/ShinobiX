/*
 * gauntlet-sim (server) — a FAITHFUL PORT of the Pet Gauntlet run state machine
 * (shinobij.client/src/lib/pet-gauntlet.ts) + the fight wiring from
 * components/PetGauntlet.tsx (enemyUnits / fightSeed), so the server can
 * RE-SIMULATE a whole run from (sealed seed + the player's decision transcript)
 * and pay Ryo/premium from the SERVER-computed roundsCleared/heartsLeft — never
 * from a client-asserted value (P1 reward integrity; docs §5 / auth-and-anti-cheat).
 *
 * Only OUTCOME-affecting state is kept (valor / hearts / roster / stars / fieldIds
 * / relics / buffs / itemsBought / roundsCleared / premium flags / status); the
 * client's cosmetic `log` is dropped. Every buy/reroll/field function no-ops on an
 * illegal action exactly like the client, so a tampered transcript can at most
 * reproduce a legal (losing-fight) run — the fights still have to be WON in the
 * board sim to advance. Determinism relies on GAUNTLET_POOL being in the same
 * order as the client POOL (pinned by _gauntlet-pool.test.ts).
 */
import {
    GAUNTLET_POOL,
    GAUNTLET_POOL_BY_RARITY,
    type GauntletPoolPet,
    type GauntletRarity,
} from './_gauntlet-pool.js';
import { applySynergiesToSquad } from './pet-synergies.js';
import {
    runPetGridBattle,
    BOARD_COLS,
    BOARD_ROWS_PER_SIDE,
    type BoardMods,
    type GridUnit,
} from './pet-board-sim.js';

// ── Tunables (verbatim from lib/pet-gauntlet.ts) ─────────────────────────────
const GAUNTLET_START_HEARTS = 3;
const GAUNTLET_START_VALOR = 10;
const GAUNTLET_ROSTER_CAP = 5;
const GAUNTLET_FIELD_CAP = 5;
const GAUNTLET_SHOP_SIZE = 4;
const GAUNTLET_MAX_ROUNDS = 10;
const GAUNTLET_SPIKE_ROUND = 7;
const GAUNTLET_REROLL_COST = 1;
const GAUNTLET_LOSS_VALOR = 3;
const GAUNTLET_MERGE_BOOST = 1.5;
const GAUNTLET_PREMIUM_ROUND = 9;
const GAUNTLET_SHARD_COST = 15;
const GAUNTLET_CHARM_COST = 10;
const RELIC_SHOP_SIZE = 3;
const RARITY_COST: Record<GauntletRarity, number> = { standard: 3, rare: 5, legendary: 7, mythic: 9 };

// ── Seeded PRNG (verbatim) ────────────────────────────────────────────────────
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

// ── Difficulty curves (verbatim) ─────────────────────────────────────────────
function shopRaritiesForRound(round: number): GauntletRarity[] {
    if (round <= 2) return ['standard', 'standard', 'standard', 'rare'];
    if (round <= 4) return ['standard', 'rare', 'rare', 'legendary'];
    if (round <= 6) return ['rare', 'rare', 'legendary', 'legendary'];
    if (round <= 8) return ['rare', 'legendary', 'legendary', 'mythic'];
    return ['legendary', 'legendary', 'mythic', 'mythic'];
}
function enemyRarityForRound(round: number): GauntletRarity {
    if (round <= 2) return 'standard';
    if (round <= 5) return 'rare';
    if (round <= 8) return 'legendary';
    return 'mythic';
}
function enemySizeForRound(round: number): number {
    if (round <= 2) return 2;
    if (round <= 4) return 3;
    if (round <= 6) return 4;
    return 5;
}
function enemyStatMultForRound(round: number): number {
    const base = 1 + (round - 1) * 0.04;
    const spike = round >= GAUNTLET_SPIKE_ROUND ? 0.22 + (round - GAUNTLET_SPIKE_ROUND) * 0.13 : 0;
    return base + spike;
}
function valorRewardForRound(round: number): number { return 4 + round; }

// ── Petstrip (verbatim from pet-battle-anim.ts) ──────────────────────────────
function petStripVariant(id: string): string { return id.replace(/-\d{10,}$/, ''); }

// ── Shop items (numeric parts of GAUNTLET_ITEMS) ─────────────────────────────
export type GauntletItemId = 'mend' | 'whetstone' | 'bulwark' | 'vigor';
interface ItemDef { id: GauntletItemId; baseCost: number; step: number; max: number; }
const GAUNTLET_ITEMS: ItemDef[] = [
    { id: 'mend', baseCost: 6, step: 3, max: 3 },
    { id: 'whetstone', baseCost: 4, step: 2, max: 6 },
    { id: 'bulwark', baseCost: 4, step: 2, max: 6 },
    { id: 'vigor', baseCost: 4, step: 2, max: 6 },
];
const GAUNTLET_ITEM_BY_ID = Object.fromEntries(GAUNTLET_ITEMS.map((d) => [d.id, d])) as Record<GauntletItemId, ItemDef>;
function itemCost(def: ItemDef, owned: number): number { return def.baseCost + def.step * Math.max(0, owned); }

interface GauntletBuffs { atk: number; def: number; hp: number; spd: number; }

// ── Relics (numeric + effect parts of GAUNTLET_RELICS) ───────────────────────
export type RelicId =
    | 'titan_heart' | 'razor_fang' | 'aegis_plating' | 'swift_wind'
    | 'merchant_charm' | 'lucky_coin' | 'beast_bond'
    | 'stoneward' | 'phoenix_plume' | 'bramble_mail' | 'chain_charm' | 'vampiric_fang';
interface RelicDef {
    id: RelicId; cost: number;
    stat?: Partial<GauntletBuffs>;
    valorPerRound?: number;
    freeReroll?: boolean;
    mergeDiscount?: number;
    mods?: Partial<BoardMods>;
}
const GAUNTLET_RELICS: RelicDef[] = [
    { id: 'titan_heart', cost: 8, stat: { hp: 0.25 } },
    { id: 'razor_fang', cost: 8, stat: { atk: 0.18 } },
    { id: 'aegis_plating', cost: 6, stat: { def: 0.25 } },
    { id: 'swift_wind', cost: 6, stat: { spd: 0.20 } },
    { id: 'merchant_charm', cost: 7, valorPerRound: 3 },
    { id: 'lucky_coin', cost: 4, freeReroll: true },
    { id: 'beast_bond', cost: 6, mergeDiscount: 2 },
    { id: 'stoneward', cost: 7, mods: { shieldStartFrac: 0.15 } },
    { id: 'phoenix_plume', cost: 9, mods: { reviveCharges: 1, reviveHpFrac: 0.35 } },
    { id: 'bramble_mail', cost: 6, mods: { reflectPct: 0.15 } },
    { id: 'chain_charm', cost: 7, mods: { chainPct: 0.40 } },
    { id: 'vampiric_fang', cost: 7, mods: { lifestealPct: 0.15 } },
];
const RELIC_BY_ID = Object.fromEntries(GAUNTLET_RELICS.map((d) => [d.id, d])) as Record<RelicId, RelicDef>;
function relicValorPerRound(relics: RelicId[]): number { return relics.reduce((s, id) => s + (RELIC_BY_ID[id]?.valorPerRound ?? 0), 0); }
function hasFreeReroll(relics: RelicId[]): boolean { return relics.some((id) => RELIC_BY_ID[id]?.freeReroll); }
function mergeDiscountFromRelics(relics: RelicId[]): number { return relics.reduce((s, id) => s + (RELIC_BY_ID[id]?.mergeDiscount ?? 0), 0); }
function boardModsFromRelics(relics: RelicId[]): Partial<BoardMods> {
    const m: BoardMods = { shieldStartFrac: 0, reflectPct: 0, chainPct: 0, lifestealPct: 0, reviveCharges: 0, reviveHpFrac: 0 };
    for (const id of relics) {
        const mod = RELIC_BY_ID[id]?.mods;
        if (!mod) continue;
        m.shieldStartFrac += mod.shieldStartFrac ?? 0;
        m.reflectPct += mod.reflectPct ?? 0;
        m.chainPct += mod.chainPct ?? 0;
        m.lifestealPct += mod.lifestealPct ?? 0;
        m.reviveCharges += mod.reviveCharges ?? 0;
        m.reviveHpFrac = Math.max(m.reviveHpFrac, mod.reviveHpFrac ?? 0);
    }
    return m;
}
function mergeRelicStat(buffs: GauntletBuffs, stat?: Partial<GauntletBuffs>): GauntletBuffs {
    if (!stat) return buffs;
    return { atk: buffs.atk + (stat.atk ?? 0), def: buffs.def + (stat.def ?? 0), hp: buffs.hp + (stat.hp ?? 0), spd: buffs.spd + (stat.spd ?? 0) };
}

// ── Run state ─────────────────────────────────────────────────────────────────
interface GauntletOffer { pet: GauntletPoolPet; cost: number; }
export type GauntletStatus = 'drafting' | 'fighting' | 'won' | 'lost';
interface GauntletRun {
    seed: number; round: number; maxRounds: number; hearts: number; valor: number;
    rerolls: number; instanceCounter: number;
    roster: GauntletPoolPet[]; stars: Record<string, number>; fieldIds: string[];
    shop: GauntletOffer[]; itemsBought: Record<GauntletItemId, number>;
    relics: RelicId[]; relicShop: RelicId[]; buffs: GauntletBuffs;
    roundsCleared: number; boughtFateShard: boolean; boughtBoneCharm: boolean;
    status: GauntletStatus;
}

function instantiate(template: GauntletPoolPet, instanceN: number, statMult = 1): GauntletPoolPet {
    const scale = (v: number, min: number) => Math.max(min, Math.round(v * statMult));
    return {
        ...template,
        id: `${template.id}-${1000000000 + instanceN}`,
        role: template.role,
        hp: scale(template.hp, 1),
        attack: scale(template.attack, 1),
        defense: scale(template.defense, 0),
        speed: scale(template.speed, 1),
    };
}

function rollShop(seed: number, round: number, rerolls: number): GauntletOffer[] {
    const rng = mulberry32(hashSeed(seed, round, rerolls, 0x5407));
    return shopRaritiesForRound(round).slice(0, GAUNTLET_SHOP_SIZE).map((rarity) => {
        const tier = GAUNTLET_POOL_BY_RARITY[rarity] ?? [];
        const pet = tier.length ? tier[Math.floor(rng() * tier.length)] : GAUNTLET_POOL[0];
        return { pet, cost: RARITY_COST[pet.rarity] };
    });
}
function rollRelicShop(seed: number, round: number, rerolls: number, owned: RelicId[]): RelicId[] {
    const rng = mulberry32(hashSeed(seed, round, rerolls, 0x9e3d));
    const pool = GAUNTLET_RELICS.map((d) => d.id).filter((id) => !owned.includes(id));
    return pickN(pool, RELIC_SHOP_SIZE, rng);
}

function startGauntletRun(seed: number): GauntletRun {
    return {
        seed: seed >>> 0, round: 1, maxRounds: GAUNTLET_MAX_ROUNDS,
        hearts: GAUNTLET_START_HEARTS, valor: GAUNTLET_START_VALOR, rerolls: 0,
        instanceCounter: 0, roster: [], stars: {}, fieldIds: [],
        shop: rollShop(seed >>> 0, 1, 0),
        itemsBought: { mend: 0, whetstone: 0, bulwark: 0, vigor: 0 },
        relics: [], relicShop: rollRelicShop(seed >>> 0, 1, 0, []),
        buffs: { atk: 0, def: 0, hp: 0, spd: 0 },
        roundsCleared: 0, boughtFateShard: false, boughtBoneCharm: false,
        status: 'drafting',
    };
}

function buyOffer(run: GauntletRun, offerIndex: number): GauntletRun {
    if (run.status !== 'drafting') return run;
    const offer = run.shop[offerIndex];
    if (!offer) return run;
    const dupIdx = run.roster.findIndex((p) => petStripVariant(p.id) === offer.pet.id);
    if (dupIdx >= 0) {
        const cost = Math.max(0, offer.cost - mergeDiscountFromRelics(run.relics));
        if (run.valor < cost) return run;
        const existing = run.roster[dupIdx];
        const merged: GauntletPoolPet = {
            ...existing,
            hp: Math.max(1, Math.round(existing.hp * GAUNTLET_MERGE_BOOST)),
            attack: Math.max(1, Math.round(existing.attack * GAUNTLET_MERGE_BOOST)),
            defense: Math.max(0, Math.round(existing.defense * GAUNTLET_MERGE_BOOST)),
            speed: Math.max(1, Math.round(existing.speed * GAUNTLET_MERGE_BOOST)),
        };
        return {
            ...run,
            valor: run.valor - cost,
            roster: run.roster.map((p, i) => (i === dupIdx ? merged : p)),
            stars: { ...run.stars, [existing.id]: (run.stars[existing.id] ?? 1) + 1 },
            shop: run.shop.filter((_, i) => i !== offerIndex),
        };
    }
    if (run.valor < offer.cost) return run;
    if (run.roster.length >= GAUNTLET_ROSTER_CAP) return run;
    const pet = instantiate(offer.pet, run.instanceCounter);
    const roster = [...run.roster, pet];
    const fieldIds = run.fieldIds.length < GAUNTLET_FIELD_CAP ? [...run.fieldIds, pet.id] : run.fieldIds;
    return {
        ...run,
        valor: run.valor - offer.cost,
        instanceCounter: run.instanceCounter + 1,
        roster, fieldIds,
        shop: run.shop.filter((_, i) => i !== offerIndex),
    };
}

function buyItem(run: GauntletRun, itemId: GauntletItemId): GauntletRun {
    if (run.status !== 'drafting') return run;
    const def = GAUNTLET_ITEM_BY_ID[itemId];
    if (!def) return run;
    const owned = run.itemsBought[itemId] ?? 0;
    if (owned >= def.max) return run;
    if (itemId === 'mend' && run.hearts >= GAUNTLET_START_HEARTS) return run;
    const cost = itemCost(def, owned);
    if (run.valor < cost) return run;
    const next: GauntletRun = { ...run, valor: run.valor - cost, itemsBought: { ...run.itemsBought, [itemId]: owned + 1 } };
    if (itemId === 'mend') next.hearts = Math.min(GAUNTLET_START_HEARTS, run.hearts + 1);
    else if (itemId === 'whetstone') next.buffs = { ...run.buffs, atk: run.buffs.atk + 0.08 };
    else if (itemId === 'bulwark') next.buffs = { ...run.buffs, def: run.buffs.def + 0.08 };
    else if (itemId === 'vigor') next.buffs = { ...run.buffs, hp: run.buffs.hp + 0.08 };
    return next;
}

function buyRelic(run: GauntletRun, relicId: RelicId): GauntletRun {
    if (run.status !== 'drafting') return run;
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

function premiumUnlocked(run: GauntletRun): boolean { return run.roundsCleared >= GAUNTLET_PREMIUM_ROUND; }
function buyPremium(run: GauntletRun, kind: 'fateShard' | 'boneCharm'): GauntletRun {
    if (run.status !== 'drafting' || !premiumUnlocked(run)) return run;
    if (kind === 'fateShard') {
        if (run.boughtFateShard || run.valor < GAUNTLET_SHARD_COST) return run;
        return { ...run, valor: run.valor - GAUNTLET_SHARD_COST, boughtFateShard: true };
    }
    if (run.boughtBoneCharm || run.valor < GAUNTLET_CHARM_COST) return run;
    return { ...run, valor: run.valor - GAUNTLET_CHARM_COST, boughtBoneCharm: true };
}

function rerollShop(run: GauntletRun): GauntletRun {
    if (run.status !== 'drafting') return run;
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

function applyGauntletBuffs(pets: GauntletPoolPet[], buffs: GauntletBuffs): GauntletPoolPet[] {
    if (buffs.atk === 0 && buffs.def === 0 && buffs.hp === 0 && buffs.spd === 0) return pets;
    return pets.map((p) => ({
        ...p,
        hp: Math.max(1, Math.round(p.hp * (1 + buffs.hp))),
        attack: Math.max(1, Math.round(p.attack * (1 + buffs.atk))),
        defense: Math.max(0, Math.round(p.defense * (1 + buffs.def))),
        speed: Math.max(1, Math.round(p.speed * (1 + buffs.spd))),
    }));
}

function releasePet(run: GauntletRun, petId: string): GauntletRun {
    if (run.status !== 'drafting') return run;
    const stars = { ...run.stars };
    delete stars[petId];
    return { ...run, roster: run.roster.filter((p) => p.id !== petId), stars, fieldIds: run.fieldIds.filter((id) => id !== petId) };
}

function setField(run: GauntletRun, fieldIds: string[]): GauntletRun {
    if (run.status !== 'drafting') return run;
    const valid = fieldIds.filter((id) => run.roster.some((p) => p.id === id)).slice(0, GAUNTLET_FIELD_CAP);
    return { ...run, fieldIds: valid };
}

function fieldedPets(run: GauntletRun): GauntletPoolPet[] {
    return run.fieldIds.map((id) => run.roster.find((p) => p.id === id)).filter((p): p is GauntletPoolPet => !!p);
}

function enemySquadForRound(run: GauntletRun): GauntletPoolPet[] {
    const rng = mulberry32(hashSeed(run.seed, run.round, 0x3a17));
    const rarity = enemyRarityForRound(run.round);
    const size = enemySizeForRound(run.round);
    const mult = enemyStatMultForRound(run.round);
    const tier = GAUNTLET_POOL_BY_RARITY[rarity] ?? GAUNTLET_POOL_BY_RARITY.standard;
    return pickN(tier, size, rng).map((tpl, i) => instantiate(tpl, 100000 + run.round * 10 + i, mult));
}

function beginFight(run: GauntletRun): GauntletRun {
    if (run.status !== 'drafting' || run.fieldIds.length === 0) return run;
    return { ...run, status: 'fighting' };
}

function applyRoundResult(run: GauntletRun, won: boolean): GauntletRun {
    if (run.status !== 'fighting') return run;
    const nextRound = run.round + 1;
    const income = relicValorPerRound(run.relics);
    if (won) {
        const reward = valorRewardForRound(run.round);
        const roundsCleared = run.roundsCleared + 1;
        if (run.round >= run.maxRounds) {
            return { ...run, status: 'won', valor: run.valor + reward, roundsCleared };
        }
        return {
            ...run, status: 'drafting', round: nextRound, valor: run.valor + reward + income, roundsCleared, rerolls: 0,
            shop: rollShop(run.seed, nextRound, 0),
            relicShop: rollRelicShop(run.seed, nextRound, 0, run.relics),
        };
    }
    const hearts = run.hearts - 1;
    if (hearts <= 0) return { ...run, status: 'lost', hearts: 0 };
    if (run.round >= run.maxRounds) return { ...run, status: 'won', hearts };
    return { ...run, status: 'drafting', hearts, valor: run.valor + GAUNTLET_LOSS_VALOR };
}

// ── Fight wiring (port of components/PetGauntlet.tsx enemyUnits / fightSeed) ──
function fightSeed(run: GauntletRun): number { return (run.seed * 7919 + run.round * 104729) >>> 0; }

function enemyUnits(pets: GauntletPoolPet[]): GridUnit[] {
    const rows: GauntletPoolPet[][] = [[], [], []];
    for (const pet of pets) {
        const r = pet.role;
        rows[r === 'defender' ? 0 : r === 'assassin' || r === 'tracker' ? 2 : 1].push(pet);
    }
    const units: GridUnit[] = [];
    rows.forEach((rowPets, row) => {
        const start = Math.max(0, Math.round((BOARD_COLS - rowPets.length) / 2));
        rowPets.forEach((pet, i) => units.push({ pet, row, col: Math.min(BOARD_COLS - 1, start + i) }));
    });
    return units;
}

// ── Transcript replay ────────────────────────────────────────────────────────

export type GauntletAction =
    | { k: 'buy'; i: number }
    | { k: 'item'; id: GauntletItemId }
    | { k: 'relic'; id: RelicId }
    | { k: 'premium'; kind: 'fateShard' | 'boneCharm' }
    | { k: 'reroll' }
    | { k: 'release'; id: string }
    | { k: 'field'; ids: string[] }
    | { k: 'fight'; place?: Array<{ row?: number; col?: number }> };

export interface GauntletReplayResult {
    roundsCleared: number;
    heartsLeft: number;
    boughtFateShard: boolean;
    boughtBoneCharm: boolean;
    status: GauntletStatus;
}

function cell(c: { row?: number; col?: number } | undefined): { row: number; col: number } {
    const row = Number.isInteger(c?.row) ? Math.max(0, Math.min(BOARD_ROWS_PER_SIDE - 1, c!.row as number)) : 2;
    const col = Number.isInteger(c?.col) ? Math.max(0, Math.min(BOARD_COLS - 1, c!.col as number)) : 0;
    return { row, col };
}

/**
 * Re-simulate a whole Gauntlet run from the sealed seed + the player's decision
 * transcript. Illegal actions no-op (as on the client); each 'fight' entry runs
 * the board sim server-side and advances only on a real WIN. Returns the
 * authoritative outcome the reward is paid from.
 */
export function replayGauntlet(seed: number, transcript: unknown): GauntletReplayResult {
    let run = startGauntletRun(seed >>> 0);
    const actions: GauntletAction[] = Array.isArray(transcript) ? (transcript as GauntletAction[]) : [];
    for (const a of actions) {
        if (run.status === 'won' || run.status === 'lost') break;
        if (!a || typeof a !== 'object') continue;
        switch (a.k) {
            case 'buy':
                run = buyOffer(run, Math.floor(Number(a.i)));
                break;
            case 'item':
                run = buyItem(run, a.id);
                break;
            case 'relic':
                run = buyRelic(run, a.id);
                break;
            case 'premium':
                run = buyPremium(run, a.kind === 'boneCharm' ? 'boneCharm' : 'fateShard');
                break;
            case 'reroll':
                run = rerollShop(run);
                break;
            case 'release':
                run = releasePet(run, String(a.id));
                break;
            case 'field':
                run = setField(run, Array.isArray(a.ids) ? a.ids.map((x) => String(x)) : []);
                break;
            case 'fight': {
                const started = beginFight(run);
                if (started.status !== 'fighting') { run = started; break; }
                const squad = applySynergiesToSquad(applyGauntletBuffs(fieldedPets(started), started.buffs));
                const place = Array.isArray(a.place) ? a.place : [];
                const playerUnits: GridUnit[] = squad.map((pet, i) => ({ pet, ...cell(place[i]) }));
                const enemy = enemySquadForRound(started);
                const result = runPetGridBattle(playerUnits, enemyUnits(enemy), fightSeed(started), { playerMods: boardModsFromRelics(started.relics) });
                run = applyRoundResult(started, result.result === 'win');
                break;
            }
            default:
                break;
        }
    }
    return {
        roundsCleared: run.roundsCleared,
        heartsLeft: run.hearts,
        boughtFateShard: run.boughtFateShard,
        boughtBoneCharm: run.boughtBoneCharm,
        status: run.status,
    };
}
