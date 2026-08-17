/*
 * THE SECTOR WANDERER DUEL — the last fight the client used to build itself.
 *
 * A roaming beast on the World Map challenges you, and the fight opens in the
 * Pet Arena. Until now the CLIENT chose the opponent: it picked one of three
 * arena templates by the player's own level and scaled it, then handed the
 * finished pet to `/api/pet/battle-start` as `opponentPetIds`. The server
 * re-resolved those ids against its own roster, so the pet itself was never
 * client-supplied — but WHICH tier was fought still was, and the payout scales
 * with the opponent fought (`petArenaRyoRewardForTeam`). A client that asked for
 * the apex template at level 5 was asking for a bigger purse.
 *
 * So the selector moves here. The request says "this is a wanderer duel" and
 * nothing else that matters; the tier and the scaling come from the CALLER'S OWN
 * SAVED LEVEL. That is the same trust shape the authored encounters use
 * (`_authored-encounter.ts`): the client names WHICH FIGHT, never the fighter.
 *
 * THE SCALING IS A PORT of the client original — `WorldMap.tsx`'s
 * `startWandererPetDuel` tier pick plus `lib/pet-balance.ts`
 * `scaleWandererPetOpponent` + `capPetStats` — so that porting the ENGINE is the
 * only thing that changes what a player fights.
 *
 * KNOWN BALANCE CONSEQUENCE, stated rather than discovered: this duel resolves on
 * Showdown, and Showdown has no PvE mastery multipliers anywhere in it. The Pet
 * Tamer damage bonus, the mastery HP bonus and Alpha Bond's revive stop applying
 * to this fight. That is not a nerf aimed at the wanderer — it is the wanderer
 * becoming consistent with every other fight already on the engine.
 *
 * DETERMINISM is NOT required of the tier pick's inputs the way it is for a war
 * duel: nobody re-derives this fight from stored inputs, because only one player
 * is in it and the seed is minted server-side per bout. What IS required is that
 * the opponent never comes from the request.
 */

import { SERVER_ARENA_PETS } from './_arena-ai.js';
import { petJutsuPowerCeil } from '../_pet-stat-ceil.js';
import type { Pet, PetJutsu } from '../_pet-sim/pet-types.js';

/**
 * The three arena templates a wanderer fields, weakest first, and the level at
 * or above which each takes over. Mirrors `WorldMap.tsx`:
 *   `< 20` → sparrow, `< 45` → guardhound, else emberlynx.
 * The ids are the server's own roster keys, so a tier can never name a pet the
 * server does not already know.
 */
export const WANDERER_TIERS: readonly { readonly minLevel: number; readonly petId: string }[] = [
    { minLevel: 45, petId: 'generic-ai-pet-emberlynx' },
    { minLevel: 20, petId: 'generic-ai-pet-guardhound' },
    { minLevel: 1, petId: 'generic-ai-pet-sparrow' },
];

const clampLevel = (n: unknown): number => Math.max(1, Math.min(100, Math.round(Number(n) || 1)));

/** The jutsu half of the client's `capPetStats`: scale, then clamp to the
 *  rarity's power ceiling. A utility move (power 0) stays 0. */
function scaleJutsus(jutsus: readonly PetJutsu[], rarity: unknown, mult: number): PetJutsu[] {
    const ceiling = petJutsuPowerCeil(rarity);
    return jutsus.map((jutsu) => ({
        ...jutsu,
        power: Number(jutsu.power) > 0
            ? Math.min(ceiling, Math.max(1, Math.round(Number(jutsu.power) * mult)))
            : 0,
        currentCooldown: 0,
    }));
}

/** Which template this player faces. Exported for the test that proves a level
 *  cannot reach above its tier. */
export function wandererTierFor(playerLevel: number): string {
    const level = clampLevel(playerLevel);
    return (WANDERER_TIERS.find((tier) => level >= tier.minLevel) ?? WANDERER_TIERS[WANDERER_TIERS.length - 1]).petId;
}

/**
 * Build the beast a wanderer fields against this player.
 *
 * Pure over the player's level. Returns null only if the server roster has lost
 * a template it names, which is a deployment fault rather than a request the
 * caller can provoke.
 */
export function buildWandererBeast(playerLevel: number): Pet | null {
    const target = clampLevel(playerLevel);
    const base = SERVER_ARENA_PETS[wandererTierFor(target)];
    if (!base) return null;

    // The client's `scaleWandererPetOpponent`, verbatim in intent: scale toward
    // the player's level, but never below 0.7x or above 4x the template, and
    // hold speed to 1.5x so a scaled beast cannot simply outrun everything.
    const mult = Math.max(0.7, Math.min(4, target / Math.max(1, Number(base.level) || 1)));
    const positive = (n: number): number => Math.max(1, Math.round(n));
    return {
        ...base,
        level: target,
        hp: positive(Number(base.hp) * mult),
        attack: positive(Number(base.attack) * mult),
        defense: positive(Number(base.defense) * mult),
        speed: positive(Number(base.speed) * Math.min(1.5, mult)),
        jutsus: scaleJutsus(base.jutsus ?? [], base.rarity, mult),
        moveRange: Math.max(2, Math.min(5, Math.round(Number(base.moveRange) || 3))),
    } as Pet;
}
