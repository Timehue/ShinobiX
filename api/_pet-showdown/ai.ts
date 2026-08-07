/*
 * Pet Showdown — AI opponents.
 *
 * Team generation samples the real PET_CATALOG (so opponents are recognizable
 * species with authored kits) scaled to the challenger's own pets, and the
 * command picker plays the same rules the player does — stamina, cooldowns,
 * element counters, supers. Three tiers ladder the pressure:
 *   scrapper — softer stats, impulsive move choice
 *   warrior  — even stats, sound fundamentals
 *   champion — harder stats, element-optimal focus fire + super discipline
 *
 * Deterministic: all randomness flows through the session rng (or the local
 * mulberry sampler seeded by the caller for team generation).
 */

import { PET_CATALOG } from '../pet/_catalog.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import {
    SHOWDOWN_ELEMENT_BEATS,
    SHOWDOWN_MAX_STAMINA,
    SHOWDOWN_METER_MAX,
    type ShowdownCommand,
    type ShowdownTier,
} from '../../shared/pet-showdown-contract.js';
import { nextRand, type ShowdownPet, type ShowdownSession } from './engine.js';

// Local deterministic sampler for team generation (session rng not built yet).
function makeRand(seed: number): () => number {
    let state = seed | 0;
    return () => {
        let t = (state += 0x6d2b79f5) | 0;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        state = state | 0;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const TIER_RARITIES: Record<ShowdownTier, string[]> = {
    scrapper: ['standard', 'rare'],
    warrior: ['rare', 'legendary'],
    champion: ['legendary', 'mythic'],
};

/** Per-level share of the base-stat growth budget the AI team receives. A
 *  balanced player build lands around 0.25/level; champion presses above it. */
const TIER_GROWTH_SHARE: Record<ShowdownTier, number> = {
    scrapper: 0.22,
    warrior: 0.3,
    champion: 0.38,
};

export const SHOWDOWN_TEAM_NAMES: Record<ShowdownTier, string[]> = {
    scrapper: ['Backalley Strays', 'Riverbank Pack', 'Dust Yard Runts'],
    warrior: ['Ironfang Company', 'Stormcaller Kennel', 'Ashen Vanguard'],
    champion: ['The Apex Court', 'Mythwoven Chosen', 'Sovereign Talons'],
};

/** Build an AI team from the live catalog, scaled to the player's pets. */
export function buildShowdownAiTeam(
    playerPets: Pet[],
    size: number,
    tier: ShowdownTier,
    seed: number,
): { pets: Pet[]; teamName: string } {
    const rand = makeRand(seed);
    const avgLevel = Math.max(1, Math.min(100, Math.round(
        playerPets.reduce((sum, p) => sum + (Number(p.level) || 1), 0) / Math.max(1, playerPets.length),
    )));
    const rarities = new Set(TIER_RARITIES[tier]);
    const pool = Object.values(PET_CATALOG).filter((tpl) =>
        rarities.has(String(tpl.rarity)) && tpl.wildSpawnable !== false && Array.isArray(tpl.jutsus));

    const growth = 1 + (avgLevel - 1) * 0.04 * TIER_GROWTH_SHARE[tier];
    const picked: Pet[] = [];
    const usedElements = new Set<string>();
    // Fisher–Yates with the seeded sampler — a rand() sort comparator is not a
    // deterministic shuffle across engines.
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (const tpl of shuffled) {
        if (picked.length >= size) break;
        const element = String(tpl.element ?? 'None');
        // Prefer element diversity so 2v2/3v3 teams pose varied matchups.
        if (usedElements.has(element) && shuffled.length > size * 3 && rand() < 0.8) continue;
        usedElements.add(element);
        picked.push({
            ...(tpl as unknown as Pet),
            id: `showdown-ai-${picked.length}-${String(tpl.id)}`,
            templateId: String(tpl.id),
            level: avgLevel,
            hp: Math.round(Number(tpl.hp) * growth),
            attack: Math.round(Number(tpl.attack) * growth),
            defense: Math.round(Number(tpl.defense) * growth),
            speed: Math.round(Number(tpl.speed) * growth),
        });
    }
    // Pool exhausted (over-filtered) — refill without the diversity preference.
    for (const tpl of shuffled) {
        if (picked.length >= size) break;
        if (picked.some((p) => p.id.endsWith(String(tpl.id)))) continue;
        picked.push({
            ...(tpl as unknown as Pet),
            id: `showdown-ai-${picked.length}-${String(tpl.id)}`,
            templateId: String(tpl.id),
            level: avgLevel,
            hp: Math.round(Number(tpl.hp) * growth),
            attack: Math.round(Number(tpl.attack) * growth),
            defense: Math.round(Number(tpl.defense) * growth),
            speed: Math.round(Number(tpl.speed) * growth),
        });
    }
    const names = SHOWDOWN_TEAM_NAMES[tier];
    return { pets: picked, teamName: names[Math.floor(rand() * names.length)] };
}

function elementBeats(attacker: string, defender: string): boolean {
    return SHOWDOWN_ELEMENT_BEATS[attacker] === defender;
}

function rngOf(session: ShowdownSession): () => number {
    // The AI shares the session rng stream (and the engine's single PRNG
    // implementation) so replays are exact.
    return () => nextRand(session);
}

/** Pick this round's commands for every living AI pet. */
export function chooseShowdownAiCommands(session: ShowdownSession): ShowdownCommand[] {
    const rand = rngOf(session);
    const tier = session.tier;
    const foes = session.player.filter((p) => !p.ko);
    const commands: ShowdownCommand[] = [];
    if (!foes.length) return commands;

    for (const pet of session.enemy) {
        if (pet.ko) continue;
        commands.push(choosePetCommand(session, pet, foes, tier, rand));
    }
    return commands;
}

function choosePetCommand(
    session: ShowdownSession,
    pet: ShowdownPet,
    foes: ShowdownPet[],
    tier: ShowdownTier,
    rand: () => number,
): ShowdownCommand {
    // Target selection: focus the kill. Champion weights element advantage in.
    const scored = foes.map((f) => ({
        foe: f,
        score: (1 - f.hp / f.maxHp) * 100
            + (elementBeats(pet.element, f.element) ? (tier === 'champion' ? 60 : 25) : 0)
            + (elementBeats(f.element, pet.element) ? -15 : 0),
    })).sort((a, b) => b.score - a.score);
    const target = tier === 'scrapper' && scored.length > 1 && rand() < 0.35
        ? scored[Math.floor(rand() * scored.length)].foe
        : scored[0].foe;

    // Super discipline: champion holds until it can confirm value; others pop it.
    if (pet.meter >= SHOWDOWN_METER_MAX) {
        const eager = tier === 'scrapper' ? 0.9 : tier === 'warrior' ? 0.75 : (target.hp / target.maxHp < 0.75 ? 1 : 0.3);
        if (rand() < eager) {
            return { kind: 'super', petId: pet.id, targetId: target.id, timing: tier === 'champion' ? 2 : 1 };
        }
    }

    const ready = pet.moves
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => m.currentCooldown <= 0);
    const affordable = ready.filter(({ m }) => m.cost <= pet.stamina);

    // Heal check: patch a bloodied self/ally when the kit allows it.
    const healMove = affordable.find(({ m }) => m.kind === 'heal');
    if (healMove && tier !== 'scrapper') {
        const allies = (session.enemy).filter((p) => !p.ko);
        const bloodied = allies.filter((a) => a.hp / a.maxHp < 0.45)
            .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        if (bloodied && rand() < 0.8) {
            return { kind: 'move', petId: pet.id, moveIndex: healMove.i, targetId: bloodied.id };
        }
    }

    // Low stamina: rest rather than overexert — except champion smells blood and
    // will overexert deliberately to close a kill.
    if (!affordable.length || pet.stamina < SHOWDOWN_MAX_STAMINA * 0.28) {
        const killPower = ready.filter(({ m }) => m.power > 0)
            .sort((a, b) => b.m.power - a.m.power)[0];
        const canExecute = tier === 'champion' && killPower && target.hp / target.maxHp < 0.22;
        if (!canExecute) {
            return rand() < 0.75
                ? { kind: 'rest', petId: pet.id }
                : { kind: 'guard', petId: pet.id };
        }
        return { kind: 'move', petId: pet.id, moveIndex: killPower.i, targetId: target.id, timing: 2 };
    }

    // Score the affordable kit: damage value + status opportunism.
    const targetHasStatus = new Set(target.statuses.map((s) => s.kind));
    const best = affordable
        .map(({ m, i }) => {
            let score = m.power * (elementBeats(pet.element, target.element) ? 1.3 : 1);
            if (m.kind !== 'damage' && m.kind !== 'crush' && m.kind !== 'lifesteal') {
                // Status moves are strong openers but wasted on an already-afflicted target.
                score = m.power * 0.8 + (targetHasStatus.has(m.kind) ? -60 : 45);
                if (session.round <= 1) score += 25;
            }
            if (m.kind === 'lifesteal' && pet.hp / pet.maxHp < 0.5) score += 50;
            score += rand() * (tier === 'scrapper' ? 90 : tier === 'warrior' ? 35 : 15);
            return { i, score };
        })
        .sort((a, b) => b.score - a.score)[0];

    const timing = tier === 'champion' ? (rand() < 0.7 ? 2 : 1)
        : tier === 'warrior' ? (rand() < 0.5 ? 1 : rand() < 0.5 ? 2 : 0)
        : (rand() < 0.35 ? 1 : 0);

    return { kind: 'move', petId: pet.id, moveIndex: best.i, targetId: target.id, timing };
}
