/*
 * Pure (kv/auth-free) core for the global Pet Ladders (Pet Coliseum 1v1 + Pet
 * Tactical 4v4). The handler (api/pet-ladder/ladder.ts) owns I/O — auth, the KV
 * blobs, the lock, seed minting, notifications — and delegates every decision here
 * so it can be unit-tested in isolation (api/pet-ladder/_core.test.ts).
 *
 * MODEL (Sword-x-Staff style positional ladder, rank 1..N over real players):
 *   • You SET A DEFENSE (1 pet for Coliseum, a 4-pet team for Tactical), sealed
 *     server-side from your save so a challenger fights the pet/team YOU chose —
 *     even while you are OFFLINE.
 *   • Clicking Challenge builds a 3-opponent OFFER: up to 3 humans ranked CLOSE
 *     ABOVE you (within a band, nearest first), topped up with easy AI when fewer
 *     than 3 humans are near (early game / the top of the board). You pick one.
 *   • Beating a human above you takes their rank (they + everyone between shift
 *     down one). Beating an AI while UNRANKED inducts you at the bottom. 10
 *     challenges/day.
 *   • SERVER-AUTHORITATIVE: the winner is recomputed here from the sealed seed +
 *     rosters via the ported deterministic engines — the client cinematic is a
 *     replay, never the source of truth.
 */

import { petStatCeil, petJutsuPowerCeil } from "../_pet-stat-ceil.js";
import { runPetDuel } from "./_duel-sim.js";
import { runPetArenaMatch, type ArenaRole, type ArenaSlot } from "./_arena-sim.js";
import type { Pet, PetJutsu, PetLoadout, JutsuElement, PetRole, PetTrait } from "./_pet-types.js";

export type Mode = "coliseum" | "tactical";
export const COLISEUM_PETS = 1;
export const TACTICAL_PETS = 4;
export const DAILY_CHALLENGES = 10;     // per ladder per day
export const CLIMB_BAND = 10;           // can only challenge humans within this many ranks above
export const OFFER_SIZE = 3;            // opponents presented per Challenge click
export const AI_SEED_COUNT = 5;         // 5 AI / 5 AI teams per the design

export const petsForMode = (mode: Mode): number => (mode === "tactical" ? TACTICAL_PETS : COLISEUM_PETS);

// ── Snapshots ────────────────────────────────────────────────────────────────
const ARENA_ROLES = new Set<ArenaRole>(["defender", "tracker", "assassin", "sage"]);

/** A pet frozen to the combat-relevant fields the engines need — INCLUDING its
 *  loadout, so the ladder honors the wearer's PvP gear + consumable. Built from the
 *  owner's save; client stats are never trusted. */
export type LadderPet = {
    id: string;
    name: string;
    rarity: string;
    level: number;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    element: string;
    trait?: string;
    role?: ArenaRole;
    jutsus: PetJutsu[];
    loadout?: { pvp?: string; consumable?: string };
};

/** Light per-pet summary for list views (no stats → keeps the polled list small). */
export type PetLite = { name: string; element: string; level: number; role?: ArenaRole; rarity: string };

/** One human rung on the ladder. Rank = array index + 1. */
export type LadderEntry = {
    slug: string;
    name: string;
    village?: string;
    record: { wins: number; losses: number; defended: number; defeated: number };
    summary: PetLite[];
    updatedAt: number;
};

/** The sealed, heavy defense doc (stored per player per mode, read only on a fight). */
export type DefenseDoc = { slug: string; name: string; village?: string; mode: Mode; pets: LadderPet[]; roles: ArenaRole[]; updatedAt: number };

const clampStat = (v: unknown, min: number, max: number, dflt: number): number => {
    const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : dflt;
    return Math.max(min, Math.min(max, n));
};

const JUTSU_KINDS = new Set<PetJutsu["kind"]>([
    "damage", "buff", "heal", "debuff", "dot", "move", "barrier", "movelock", "lifesteal", "shield",
    "absorb", "burn", "freeze", "confuse", "stun", "crush", "wound", "mark", "slow", "haste", "taunt", "push", "pull",
]);

function snapshotJutsu(raw: Record<string, unknown>, rarity: unknown): PetJutsu {
    const kind = JUTSU_KINDS.has(raw.kind as PetJutsu["kind"]) ? (raw.kind as PetJutsu["kind"]) : "damage";
    return {
        name: String(raw.name ?? "Strike").slice(0, 40),
        // Per-rarity jutsu-power ceiling (anti-tamper). Was a flat 1000 (~2-3× a
        // legit cap); mirrors client petStatCaps[*].jutsuPower so an honest pet is
        // unaffected and a forged pet can't seal an absurd jutsu into the duel.
        power: clampStat(raw.power, 1, petJutsuPowerCeil(rarity), 80),
        cooldown: clampStat(raw.cooldown, 0, 60, 0),
        kind,
        ...(typeof raw.rounds === "number" ? { rounds: clampStat(raw.rounds, 1, 20, 1) } : {}),
        ...(raw.signature ? { signature: true } : {}),
        ...(raw.aoe ? { aoe: true } : {}),
    };
}

/** Freeze a raw pet (from a save) to the fields the sim/renderer use, incl loadout. */
export function snapshotLadderPet(raw: Record<string, unknown>): LadderPet {
    const loadoutRaw = (raw.loadout && typeof raw.loadout === "object" ? raw.loadout : {}) as Record<string, unknown>;
    const pvp = typeof loadoutRaw.pvp === "string" ? loadoutRaw.pvp : undefined;
    const consumable = typeof loadoutRaw.consumable === "string" ? loadoutRaw.consumable : undefined;
    const rarity = String(raw.rarity ?? "standard");
    const jutsus = Array.isArray(raw.jutsus) ? raw.jutsus.slice(0, 4).map((j) => snapshotJutsu((j ?? {}) as Record<string, unknown>, rarity)) : [];
    return {
        id: String(raw.id ?? ""),
        name: String(raw.name ?? "Pet").slice(0, 40),
        rarity,
        level: clampStat(raw.level, 1, 100, 1),
        hp: clampStat(raw.hp, 1, petStatCeil(rarity, "hp"), 600),
        attack: clampStat(raw.attack, 1, petStatCeil(rarity, "attack"), 60),
        defense: clampStat(raw.defense, 0, petStatCeil(rarity, "defense"), 30),
        speed: clampStat(raw.speed, 1, petStatCeil(rarity, "speed"), 50),
        element: String(raw.element ?? "Fire"),
        trait: typeof raw.trait === "string" ? raw.trait : undefined,
        role: ARENA_ROLES.has(raw.role as ArenaRole) ? (raw.role as ArenaRole) : undefined,
        jutsus,
        ...(pvp || consumable ? { loadout: { ...(pvp ? { pvp } : {}), ...(consumable ? { consumable } : {}) } } : {}),
    };
}

export const petLite = (p: LadderPet): PetLite => ({ name: p.name, element: p.element, level: p.level, role: p.role, rarity: p.rarity });

/** Reconstruct a sim-ready Pet from a snapshot. */
export function toPet(p: LadderPet): Pet {
    return {
        id: p.id, name: p.name, rarity: (p.rarity as Pet["rarity"]) ?? "standard", level: p.level,
        hp: p.hp, attack: p.attack, defense: p.defense, speed: p.speed,
        element: p.element as JutsuElement, trait: p.trait as PetTrait | undefined, role: p.role as PetRole | undefined,
        jutsus: p.jutsus,
        ...(p.loadout ? { loadout: p.loadout as PetLoadout } : {}),
    };
}

/**
 * Resolve the player's chosen pet ids against the pets they actually own. Consumes
 * one owned pet per id (two distinct instances of a template both work; one owned
 * pet can't be picked twice). Returns null when the count is wrong or any id isn't
 * owned. Mirrors api/arena/_lobby-core.ts:chooseOwnedPets but keeps the loadout.
 */
export function chooseOwnedLadderPets(owned: Array<Record<string, unknown>>, petIds: unknown, count: number): LadderPet[] | null {
    if (!Array.isArray(petIds) || petIds.length !== count) return null;
    const pool = owned.slice();
    const chosen: LadderPet[] = [];
    for (const id of petIds) {
        const idx = pool.findIndex((p) => String(p.id ?? "") === String(id));
        if (idx < 0) return null;
        chosen.push(snapshotLadderPet(pool[idx]));
        pool.splice(idx, 1);
    }
    return chosen;
}

/** Index of the max/min-scoring entry; ties → lowest index. */
function pickIdx(idx: number[], score: (i: number) => number, dir: "max" | "min"): number {
    let best = idx[0];
    for (const i of idx) { const better = dir === "max" ? score(i) > score(best) : score(i) < score(best); if (better) best = i; }
    return best;
}

/** Roles for a team: each pet's native role when present, else a stat-profile fallback
 *  (toughest → defender, best atk+spd → assassin, weakest atk → sage, rest → tracker).
 *  Mirrors api/arena/_lobby-core.ts:autoArenaRoles. Deterministic; sealed into defense. */
export function ladderRoles(pets: LadderPet[]): ArenaRole[] {
    if (pets.length > 0 && pets.every((p) => p.role)) return pets.map((p) => p.role!);
    const n = pets.length;
    if (n <= 2) return pets.map((_, i) => (i === 0 ? "defender" : "assassin"));
    const all = pets.map((_, i) => i);
    const def = pickIdx(all, (i) => pets[i].defense, "max");
    const rest1 = all.filter((i) => i !== def);
    const asn = pickIdx(rest1, (i) => pets[i].attack + pets[i].speed, "max");
    const rest2 = rest1.filter((i) => i !== asn);
    const sge = pickIdx(rest2, (i) => pets[i].attack, "min");
    return all.map((i) => (i === def ? "defender" : i === asn ? "assassin" : i === sge ? "sage" : "tracker"));
}

// ── AI seed opponents (easy, beatable — the on-ramp / fallback fill) ───────────
const J = (name: string, kind: PetJutsu["kind"], power: number): PetJutsu => ({ name, kind, power, cooldown: 2 });
const aiPet = (id: string, name: string, rarity: string, level: number, hp: number, attack: number, defense: number, speed: number, element: string, role: ArenaRole, jutsus: PetJutsu[]): LadderPet =>
    ({ id, name, rarity, level, hp, attack, defense, speed, element, role, jutsus });

// 5 easy single pets for the Coliseum ladder.
export const AI_COLISEUM: LadderPet[] = [
    aiPet("ai-col-0", "Straw Sentinel", "standard", 8, 300, 26, 22, 22, "Earth", "defender", [J("Bash", "damage", 60)]),
    aiPet("ai-col-1", "Cinder Pup", "standard", 9, 260, 34, 16, 30, "Fire", "assassin", [J("Nip", "damage", 70)]),
    aiPet("ai-col-2", "Tide Sprite", "standard", 9, 280, 28, 20, 28, "Water", "sage", [J("Splash", "damage", 60), J("Mend", "heal", 80)]),
    aiPet("ai-col-3", "Gale Chick", "standard", 10, 250, 32, 16, 36, "Wind", "tracker", [J("Peck", "damage", 66)]),
    aiPet("ai-col-4", "Spark Mite", "standard", 10, 240, 36, 14, 34, "Lightning", "assassin", [J("Zap", "damage", 72)]),
];

// 5 easy 4-pet teams for the Tactical ladder.
export const AI_TACTICAL: Array<{ name: string; pets: LadderPet[] }> = [
    { name: "Academy Cubs", pets: [
        aiPet("ai-tac-0-0", "Cub Guard", "standard", 9, 360, 30, 30, 24, "Earth", "defender", []),
        aiPet("ai-tac-0-1", "Cub Scout", "standard", 9, 280, 34, 18, 36, "Wind", "tracker", []),
        aiPet("ai-tac-0-2", "Cub Striker", "standard", 9, 250, 40, 16, 38, "Fire", "assassin", []),
        aiPet("ai-tac-0-3", "Cub Mender", "standard", 9, 300, 26, 22, 28, "Water", "sage", []),
    ] },
    { name: "Straw Patrol", pets: [
        aiPet("ai-tac-1-0", "Straw Wall", "standard", 10, 380, 30, 32, 22, "Earth", "defender", []),
        aiPet("ai-tac-1-1", "Straw Runner", "standard", 10, 290, 36, 18, 38, "Lightning", "tracker", []),
        aiPet("ai-tac-1-2", "Straw Fang", "standard", 10, 255, 42, 16, 40, "Fire", "assassin", []),
        aiPet("ai-tac-1-3", "Straw Sage", "standard", 10, 300, 26, 24, 28, "Water", "sage", []),
    ] },
    { name: "Tide Recruits", pets: [
        aiPet("ai-tac-2-0", "Tide Bulwark", "standard", 11, 400, 32, 34, 24, "Water", "defender", []),
        aiPet("ai-tac-2-1", "Tide Tracker", "standard", 11, 300, 38, 20, 40, "Wind", "tracker", []),
        aiPet("ai-tac-2-2", "Tide Edge", "standard", 11, 260, 44, 16, 42, "Lightning", "assassin", []),
        aiPet("ai-tac-2-3", "Tide Healer", "standard", 11, 310, 28, 24, 30, "Water", "sage", []),
    ] },
    { name: "Ember Drills", pets: [
        aiPet("ai-tac-3-0", "Ember Shield", "standard", 12, 410, 34, 34, 26, "Fire", "defender", []),
        aiPet("ai-tac-3-1", "Ember Hunter", "standard", 12, 305, 40, 20, 42, "Wind", "tracker", []),
        aiPet("ai-tac-3-2", "Ember Blade", "standard", 12, 265, 46, 18, 44, "Fire", "assassin", []),
        aiPet("ai-tac-3-3", "Ember Warder", "standard", 12, 315, 30, 26, 30, "Earth", "sage", []),
    ] },
    { name: "Gale Cadets", pets: [
        aiPet("ai-tac-4-0", "Gale Tower", "standard", 13, 420, 36, 36, 26, "Earth", "defender", []),
        aiPet("ai-tac-4-1", "Gale Stalker", "standard", 13, 310, 42, 22, 44, "Wind", "tracker", []),
        aiPet("ai-tac-4-2", "Gale Talon", "standard", 13, 270, 48, 18, 46, "Lightning", "assassin", []),
        aiPet("ai-tac-4-3", "Gale Oracle", "standard", 13, 320, 32, 26, 32, "Water", "sage", []),
    ] },
];

export const aiColiseumDefense = (i: number): DefenseDoc => {
    const p = AI_COLISEUM[i % AI_COLISEUM.length];
    return { slug: `ai:${i}`, name: p.name, mode: "coliseum", pets: [p], roles: ladderRoles([p]), updatedAt: 0 };
};
export const aiTacticalDefense = (i: number): DefenseDoc => {
    const t = AI_TACTICAL[i % AI_TACTICAL.length];
    return { slug: `ai:${i}`, name: t.name, mode: "tactical", pets: t.pets, roles: ladderRoles(t.pets), updatedAt: 0 };
};
export const isAiId = (id: string): boolean => id.startsWith("ai:");
export const aiIndexOf = (id: string): number => { const n = Number(id.slice(3)); return Number.isInteger(n) && n >= 0 ? n : -1; };

// ── Offer + ranking ────────────────────────────────────────────────────────────
export type OfferOpponent = { kind: "player" | "ai"; id: string; name: string; village?: string; rank: number | null; summary: PetLite[] };
const rankOf = (order: LadderEntry[], slug: string): number => order.findIndex((e) => e.slug === slug); // 0-based, -1 = unranked

/**
 * Build the 3-opponent offer for `challenger`: up to OFFER_SIZE humans ranked CLOSE
 * ABOVE within CLIMB_BAND (nearest first), then top up with AI seeds. `aiSummary`
 * maps an AI index → its light summary. `aiPick` chooses the AI fill order (handler
 * passes a rotating/random start so rerolls vary; not result-authoritative).
 */
export function buildOffer(order: LadderEntry[], challenger: string, aiSummary: (i: number) => OfferOpponent, aiStart: number, excludeId?: string): OfferOpponent[] {
    const my = rankOf(order, challenger);
    const effIdx = my < 0 ? order.length : my;                  // unranked sits just below the lowest human
    const offer: OfferOpponent[] = [];
    for (let i = effIdx - 1; i >= 0 && offer.length < OFFER_SIZE; i--) {
        if (effIdx - i > CLIMB_BAND) break;                     // outside the climb band
        const e = order[i];
        if (e.slug === challenger || e.slug === excludeId) continue;   // skip self + the just-fought opponent (no back-to-back rematch)
        offer.push({ kind: "player", id: e.slug, name: e.name, village: e.village, rank: i + 1, summary: e.summary });
    }
    for (let k = 0; offer.length < OFFER_SIZE && k < AI_SEED_COUNT; k++) {
        const idx = (aiStart + k) % AI_SEED_COUNT;
        if (`ai:${idx}` === excludeId) continue;                       // don't immediately re-offer the just-fought AI either
        offer.push(aiSummary(idx));
    }
    return offer;
}

/** Is `target` a legal challenge for `challenger`? AI is always legal; a human must be
 *  ranked above and within the climb band (server enforces — can't snipe rank 1). */
export function canChallenge(order: LadderEntry[], challenger: string, targetId: string, excludeId?: string): boolean {
    if (excludeId && targetId === excludeId) return false;            // no back-to-back rematch of the same opponent
    if (isAiId(targetId)) return aiIndexOf(targetId) >= 0 && aiIndexOf(targetId) < AI_SEED_COUNT;
    const my = rankOf(order, challenger);
    const tgt = rankOf(order, targetId);
    if (tgt < 0) return false;
    const effIdx = my < 0 ? order.length : my;
    return tgt < effIdx && effIdx - tgt <= CLIMB_BAND;
}

const blankRecord = () => ({ wins: 0, losses: 0, defended: 0, defeated: 0 });
const ensure = (e: LadderEntry): LadderEntry => ({ ...e, record: { ...blankRecord(), ...e.record } });
const bumpWin = (e: LadderEntry, won: boolean): LadderEntry => ({ ...e, record: { ...e.record, ...(won ? { wins: e.record.wins + 1 } : { losses: e.record.losses + 1 }) } });

/**
 * Apply a resolved challenge to the ladder order. Returns the new (whole) order — the
 * handler persists it as one KV doc — plus `notifySlug`, the human defender to message
 * offline (null for an AI fight). Pure.
 *   • beat a HUMAN above → challenger takes their index (target + everyone between shift
 *     down one); records updated.
 *   • beat an AI while UNRANKED → inducted at the bottom (a loss never ranks you).
 *   • a ranked challenger's AI fight only touches their W/L record, no movement.
 */
export function applyChallenge(order: LadderEntry[], challengerEntry: LadderEntry, targetId: string, challengerWon: boolean): { order: LadderEntry[]; notifySlug: string | null } {
    const next = order.map(ensure);
    const myIdx = rankOf(next, challengerEntry.slug);
    const wasRanked = myIdx >= 0;

    // ── AI target: induction (unranked win) or record-only (ranked) ────────────
    if (isAiId(targetId)) {
        if (wasRanked) { next[myIdx] = bumpWin(next[myIdx], challengerWon); return { order: next, notifySlug: null }; }
        if (!challengerWon) return { order: next, notifySlug: null };   // a loss never ranks you
        next.push(bumpWin(ensure(challengerEntry), true));              // inducted at the bottom
        return { order: next, notifySlug: null };
    }

    // ── Human target ───────────────────────────────────────────────────────────
    const tgtIdx = rankOf(next, targetId);
    const effIdx = wasRanked ? myIdx : next.length;                     // unranked sits below all
    if (tgtIdx < 0 || tgtIdx >= effIdx) {                               // target gone / not above → no-op
        if (wasRanked) next[myIdx] = bumpWin(next[myIdx], challengerWon);
        return { order: next, notifySlug: null };
    }
    let meIdx = myIdx;
    if (!wasRanked) { next.push(ensure(challengerEntry)); meIdx = next.length - 1; }
    if (challengerWon) {
        next[meIdx] = { ...next[meIdx], record: { ...next[meIdx].record, wins: next[meIdx].record.wins + 1 } };
        next[tgtIdx] = { ...next[tgtIdx], record: { ...next[tgtIdx].record, defeated: next[tgtIdx].record.defeated + 1 } };
        const [mover] = next.splice(meIdx, 1);                         // pull the challenger out…
        next.splice(tgtIdx, 0, mover);                                 // …and insert at the target's rank (shifts the rest down one)
    } else {
        next[tgtIdx] = { ...next[tgtIdx], record: { ...next[tgtIdx].record, defended: next[tgtIdx].record.defended + 1 } };
        if (wasRanked) next[meIdx] = { ...next[meIdx], record: { ...next[meIdx].record, losses: next[meIdx].record.losses + 1 } };
        else next.splice(meIdx, 1);                                    // unranked + lost → does not join the board
    }
    return { order: next, notifySlug: targetId };   // a human defender — message them their rank was contested
}

/** Light list projection for the GET endpoint (already light — rank is the index). */
export const projectLadder = (order: LadderEntry[]) => order.map((e, i) => ({ rank: i + 1, slug: e.slug, name: e.name, village: e.village, record: e.record, summary: e.summary }));

// ── Server-authoritative resolution (ported deterministic engines) ─────────────
/** Coliseum 1v1: true ⇒ the ATTACKER (challenger) won. Items applied for both. */
export function resolveColiseum(attacker: LadderPet, defender: LadderPet, seed: number): boolean {
    return runPetDuel(toPet(attacker), toPet(defender), seed, 1, 1, false, true).result === "win";
}
/** Tactical 4v4: true ⇒ the ATTACKER (blue) won. Items applied for both teams. */
export function resolveTactical(attacker: DefenseDoc, defender: DefenseDoc, seed: number): boolean {
    const blue: ArenaSlot[] = attacker.pets.map((p, i) => ({ pet: toPet(p), role: attacker.roles[i] ?? "tracker" }));
    const red: ArenaSlot[] = defender.pets.map((p, i) => ({ pet: toPet(p), role: defender.roles[i] ?? "tracker" }));
    return runPetArenaMatch(blue, red, seed, true).winner === "blue";
}
