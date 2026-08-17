/*
 * AUTHORED PET ENCOUNTERS — server-side opponent reconstruction.
 *
 * Two entries in the game hand a pet fight an opponent the ARENA did not pick:
 * the relic-dungeon Rare Beast Seal, and an admin-authored VN choice whose
 * `battle.encounterType === "pet"`. Both used to build that opponent in the
 * browser and fight it in a client-local sim, which is why neither could move
 * onto the Showdown engine: Showdown has no entry that accepts a caller-supplied
 * opponent, and adding one would mean taking combat stats over the wire.
 *
 * This module is the answer to that. The caller names WHICH authored encounter
 * it is standing in — a dungeon run token, or an event id plus the authored
 * pet/difficulty pair that identifies the choice — and the server rebuilds the
 * opponent from ITS OWN copy of the authored content (PET_CATALOG for the
 * species, the admin event catalog for the authoring). Nothing about the
 * opponent's statline, kit, level or name is read from the request.
 *
 * The scaling formulas are ports of the client originals so that porting the
 * ENGINE is the only thing that changes what a player fights:
 *   • dungeon beast     — Dungeon.tsx DungeonPetBattle's enemy block
 *   • authored VN boss  — lib/pet-balance.ts scaleEventPetOpponent + capPetStats
 *
 * These bouts pay NOTHING (`rewardEligible: false` at the call site). Their
 * rewards belong to the systems that own them — the dungeon run's own settle
 * endpoint and the event's completion — so this file never touches currency.
 */

import { PET_CATALOG } from './_catalog.js';
import { petJutsuPowerCeil } from '../_pet-stat-ceil.js';
import type { AdminEvent } from '../_admin-event-catalog.js';
import type { Pet, PetJutsu } from '../_pet-sim/pet-types.js';

/** Difficulty tiers an admin may author on a VN pet battle. */
export type AuthoredDifficulty = 'easy' | 'normal' | 'hard' | 'impossible';

const DIFFICULTIES: readonly AuthoredDifficulty[] = ['easy', 'normal', 'hard', 'impossible'];

export function cleanAuthoredDifficulty(value: unknown): AuthoredDifficulty | undefined {
    const raw = typeof value === 'string' ? value.trim() : '';
    return DIFFICULTIES.find((entry) => entry === raw);
}

/** Mirror of eventPetDifficultyMultiplier (lib/pet-balance.ts). */
export function authoredDifficultyMultiplier(difficulty?: AuthoredDifficulty): number {
    if (difficulty === 'easy') return 0.75;
    if (difficulty === 'hard') return 1.35;
    if (difficulty === 'impossible') return 2.1;
    return 1;
}

/** FNV-1a, the same shape dungeonWardenTier uses — a stable per-run pick that
 *  needs no stored state and cannot be re-rolled by retrying the request. */
function hash(value: string): number {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
    }
    return result >>> 0;
}

function catalogRows(): Record<string, unknown>[] {
    return Object.values(PET_CATALOG);
}

function jutsusOf(template: Record<string, unknown>): PetJutsu[] {
    return Array.isArray(template.jutsus)
        ? (template.jutsus as unknown[]).filter(
            (entry): entry is PetJutsu => !!entry && typeof entry === 'object' && !Array.isArray(entry),
        )
        : [];
}

/** The jutsu-power half of capPetStats. Power 0 stays 0 (utility moves). */
function capJutsus(jutsus: PetJutsu[], rarity: unknown, mult: number): PetJutsu[] {
    const ceiling = petJutsuPowerCeil(rarity);
    return jutsus.map((jutsu) => ({
        ...jutsu,
        power: Number(jutsu.power) > 0
            ? Math.min(ceiling, Math.max(1, Math.round(Number(jutsu.power) * mult)))
            : 0,
        currentCooldown: 0,
    }));
}

const positive = (n: number): number => Math.max(1, Math.round(Number.isFinite(n) ? n : 1));

// ── The relic-dungeon Rare Beast Seal ────────────────────────────────────────

/** The client picked this beast with Math.random over the admin pet list, then
 *  boosted it. The species pick is now derived from the run token instead, so
 *  the same run always faces the same beast (a reload cannot reroll it) and the
 *  server never has to be told which one it was. The BOOST is the client's
 *  block, verbatim — rarity forced to "rare", jutsu power untouched. */
export function buildDungeonSealBeast(playerName: string, runToken: string): Pet | null {
    const pool = catalogRows()
        .filter((tpl) => {
            const rarity = String(tpl.rarity);
            return (rarity === 'rare' || rarity === 'legendary' || rarity === 'mythic')
                && jutsusOf(tpl).length > 0;
        })
        // Object.values order is insertion order for string keys, which is stable
        // for a generated file — but sort anyway so the pick is a function of the
        // catalog's CONTENT, not of how the generator happened to emit it.
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (!pool.length) return null;
    const base = pool[hash(`${playerName.toLowerCase()}:${runToken}`) % pool.length];
    return {
        ...(base as unknown as Pet),
        id: 'dungeon-rare-beast',
        templateId: String(base.id),
        name: String(base.name || 'Dungeon Rare Beast'),
        rarity: 'rare',
        level: Math.max(55, Math.floor(Number(base.level) || 1) + 25),
        hp: Math.max(900, Math.floor(Number(base.hp) * 2.1)),
        attack: Math.max(110, Math.floor(Number(base.attack) * 1.9)),
        defense: Math.max(100, Math.floor(Number(base.defense) * 1.8)),
        speed: Math.max(90, Math.floor(Number(base.speed) * 1.6)),
        trait: (base.trait as Pet['trait']) ?? 'Battleborn',
        jutsus: jutsusOf(base).map((jutsu) => ({ ...jutsu, currentCooldown: 0 })),
    } as Pet;
}

/** The active dungeon run this seal belongs to, or a reason it does not.
 *  Seal 3 sits behind seal 1, so a run whose Warden is still standing has no
 *  rare beast to fight — the same ordering the dungeon screen walks. */
export function dungeonSealRunIssue(
    character: Record<string, unknown>,
    runTokenRaw: unknown,
): string | null {
    const runToken = typeof runTokenRaw === 'string' ? runTokenRaw.trim().slice(0, 80) : '';
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(runToken)) return 'A dungeon run token is required.';
    const active = character.activeDungeonRun && typeof character.activeDungeonRun === 'object'
        && !Array.isArray(character.activeDungeonRun)
        ? character.activeDungeonRun as Record<string, unknown>
        : null;
    if (!active || active.token !== runToken) return 'No matching active dungeon run.';
    if (active.wardenDefeated !== true) return 'The Dungeon Warden still stands.';
    return null;
}

// ── Admin-authored VN pet encounters ─────────────────────────────────────────

/** One authored `battle` block with `encounterType: "pet"`, as stored on a
 *  creator event. Only the fields the opponent is built from are read. */
export type AuthoredPetBattle = {
    petId: string;
    difficulty?: AuthoredDifficulty;
    bossName?: string;
};

function authoredPetBattles(event: AdminEvent): AuthoredPetBattle[] {
    const pages = Array.isArray(event.vnPages) ? event.vnPages : [];
    const out: AuthoredPetBattle[] = [];
    for (const rawPage of pages) {
        if (!rawPage || typeof rawPage !== 'object' || Array.isArray(rawPage)) continue;
        const choices = (rawPage as Record<string, unknown>).choices;
        if (!Array.isArray(choices)) continue;
        for (const rawChoice of choices) {
            if (!rawChoice || typeof rawChoice !== 'object' || Array.isArray(rawChoice)) continue;
            const battle = (rawChoice as Record<string, unknown>).battle;
            if (!battle || typeof battle !== 'object' || Array.isArray(battle)) continue;
            const row = battle as Record<string, unknown>;
            if (row.encounterType !== 'pet') continue;
            const petId = typeof row.petId === 'string' ? row.petId.trim() : '';
            if (!petId) continue;
            out.push({
                petId,
                difficulty: cleanAuthoredDifficulty(row.difficulty),
                bossName: typeof row.bossName === 'string' ? row.bossName.trim().slice(0, 80) : undefined,
            });
        }
    }
    return out;
}

/** Find the authored encounter the caller says it is standing in.
 *
 *  The request carries a SELECTOR (which authored fight), never a statline. The
 *  worst a tampered client can do with it is name a different authored fight
 *  inside the same event — a fight the admin already wrote and shipped — and
 *  since this entry pays nothing, that buys it nothing at all. Everything the
 *  opponent is made of comes from the row found here. */
export function findAuthoredPetBattle(
    event: AdminEvent | undefined,
    petIdRaw: unknown,
    difficultyRaw: unknown,
): AuthoredPetBattle | null {
    if (!event) return null;
    const rows = authoredPetBattles(event);
    if (!rows.length) return null;
    const petId = typeof petIdRaw === 'string' ? petIdRaw.trim() : '';
    const difficulty = cleanAuthoredDifficulty(difficultyRaw);
    return rows.find((row) => row.petId === petId && row.difficulty === difficulty)
        ?? rows.find((row) => row.petId === petId)
        ?? null;
}

/** Port of scaleEventPetOpponent + capPetStats, over the SERVER's species
 *  catalog. An authored petId that names no known species is a dead encounter
 *  rather than an invented one — the caller reports it instead of guessing. */
export function buildAuthoredEventBeast(battle: AuthoredPetBattle): Pet | null {
    const base = PET_CATALOG[battle.petId];
    if (!base) return null;
    const mult = authoredDifficultyMultiplier(battle.difficulty);
    const rarity = String(base.rarity);
    return {
        ...(base as unknown as Pet),
        id: `event-${battle.petId}`,
        templateId: String(base.id),
        name: battle.bossName || String(base.name),
        level: Math.max(1, Math.min(100, Math.round((Number(base.level) || 1) * mult))),
        hp: positive(Number(base.hp) * mult),
        attack: positive(Number(base.attack) * mult),
        defense: positive(Number(base.defense) * mult),
        // Speed is capped at 1.5x in the original so even an "impossible" boss
        // cannot permanently out-tempo the player. Kept exactly.
        speed: positive(Number(base.speed) * Math.min(1.5, mult)),
        jutsus: capJutsus(jutsusOf(base), rarity, mult),
    } as Pet;
}
