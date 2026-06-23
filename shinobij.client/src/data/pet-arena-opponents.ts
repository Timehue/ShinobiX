/*
 * Central Pet Arena built-in AI opponents — the PetArenaOpponent shape and the
 * rank ladder of generic arena pets (trait bonuses pre-applied). Pure data,
 * extracted verbatim from App.tsx.
 */
import type { Pet } from "../types/pet";
import type { Screen } from "../types/core";
import { applyPetTraitBonuses } from "../lib/pet-balance";

export type PetArenaOpponent = {
    owner: string;
    pet: Pet;
    battleSeed?: number;
    // Optional override for the screen the player goes back to when the
    // battle ends. Defaults to "centralHub" inside PetArena. Used by the
    // Hollow Gate pet_battle tile to return the player to the shrine.
    returnScreen?: Screen;
    // ── Party (2v2) extensions ────────────────────────────────────────
    // When opponentParty is set, the incoming battle should resolve as a
    // 2-pet set. challengerParty is the player's locked-in pair (carried
    // from a PvP party challenge so we don't re-pick on the player's side).
    opponentParty?: [Pet, Pet];
    challengerParty?: [Pet, Pet];
    // ── Ranked 1v1 extensions ─────────────────────────────────────────
    // Set when this opponent came from the pet-ranked ladder queue. The
    // battle resolves deterministically (canonical sim) and the result
    // adjusts each player's account-level petRankedRating via rankedDelta.
    // opponentRating is the opponent's petRankedRating snapshot for the
    // symmetric Elo computation. selfPet is MY pet as locked into the
    // challenge handshake — used instead of the UI's selectedPet so both
    // clients feed the canonical sim the exact same two combatants (a
    // mid-handshake pet swap would otherwise desync the deterministic fight).
    ranked?: boolean;
    opponentRating?: number;
    selfPet?: Pet;
    // Shared server-minted pet-ranked match token, carried from the challenge
    // handshake so both sides report battle-result with the SAME token.
    petRankedToken?: string;
};

export const genericPetArenaOpponents: PetArenaOpponent[] = [
    {
        // -- D-rank: fast skirmisher — lifesteal + harassment --
        owner: "Pet Coliseum AI",
        pet: applyPetTraitBonuses({
            id: "generic-ai-pet-sparrow",
            name: "Arena Sparrow",
            rarity: "standard",
            level: 8,
            xp: 0,
            maxLevel: 50,
            hp: 130,
            attack: 26,
            defense: 14,
            speed: 32,
            moveRange: 4,
            description: "A darting sparrow that harasses with quick pecks, drains HP, and blinds with feathers. Fragile but relentless.",
            jutsus: [
                { name: "Talon Strike",    power: 24, cooldown: 1, currentCooldown: 0, kind: "damage"    },
                { name: "Blood Peck",      power: 28, cooldown: 3, currentCooldown: 0, kind: "lifesteal" },
                { name: "Feather Cloud",   power: 22, cooldown: 4, currentCooldown: 0, kind: "debuff"    },
                { name: "Pin Feathers",    power: 0,  cooldown: 5, currentCooldown: 0, kind: "movelock"  },
                { name: "Wing Burst",      power: 0,  cooldown: 4, currentCooldown: 0, kind: "move"      },
            ],
            unlockedForPve: true,
            trait: "Swift",
        }, "Swift"),
    },
    {
        // -- B-rank: fortress tank, absorb + shield + sustain --
        owner: "Pet Coliseum AI",
        pet: applyPetTraitBonuses({
            id: "generic-ai-pet-guardhound",
            name: "Arena Guardhound",
            rarity: "rare",
            level: 18,
            xp: 0,
            maxLevel: 70,
            hp: 260,
            attack: 36,
            defense: 34,
            speed: 20,
            moveRange: 2,
            description: "An armored hound that absorbs blows, raises shields, heals, and wears opponents down with relentless pressure.",
            jutsus: [
                { name: "Iron Fang",       power: 40, cooldown: 2, currentCooldown: 0, kind: "damage"  },
                { name: "Iron Shell",      power: 34, cooldown: 3, currentCooldown: 0, kind: "buff"    },
                { name: "Iron Barrier",    power: 90, cooldown: 5, currentCooldown: 0, kind: "barrier" },
                { name: "Iron Ward",       power: 55, cooldown: 4, currentCooldown: 0, kind: "shield"  },
                { name: "Absorb Stance",   power: 0,  cooldown: 6, currentCooldown: 0, kind: "absorb"  },
                { name: "Hound Mend",      power: 65, cooldown: 5, currentCooldown: 0, kind: "heal"    },
            ],
            unlockedForPve: true,
            trait: "Guardian",
        }, "Guardian"),
    },
    {
        // -- S-rank: apex predator — lifesteal + absorb + nuke --
        owner: "Pet Coliseum AI",
        pet: applyPetTraitBonuses({
            id: "generic-ai-pet-emberlynx",
            name: "Arena Emberlynx",
            rarity: "legendary",
            level: 35,
            xp: 0,
            maxLevel: 90,
            hp: 370,
            attack: 66,
            defense: 32,
            speed: 50,
            moveRange: 5,
            description: "A legendary fire-lynx that strips defenses, drains life, absorbs retaliation, then closes in for devastating finishing blows.",
            jutsus: [
                { name: "Claw Slash",      power: 58, cooldown: 1, currentCooldown: 0, kind: "damage"    },
                { name: "Ember Drain",     power: 70, cooldown: 3, currentCooldown: 0, kind: "lifesteal" },
                { name: "Predator Mark",   power: 48, cooldown: 3, currentCooldown: 0, kind: "debuff"    },
                { name: "Flame Venom",     power: 68, cooldown: 5, currentCooldown: 0, kind: "dot"       },
                { name: "Ember Absorb",    power: 0,  cooldown: 6, currentCooldown: 0, kind: "absorb"    },
                { name: "Ember Pounce",    power: 90, cooldown: 4, currentCooldown: 0, kind: "damage"    },
            ],
            unlockedForPve: true,
            trait: "Aggressive",
        }, "Aggressive"),
    },
];

// PvE detection: the built-in Pet Arena AI opponents (above). A battle counts as
// PvE — and so eligible for Pet Tamer PvE mastery modifiers — only when the
// opponent is one of these. Any real-player opponent (ranked / clan battle /
// PvP challenge / casual-vs-player) is excluded, so mastery never touches PvP.
const GENERIC_PET_OPPONENT_IDS = new Set(genericPetArenaOpponents.map((o) => o.pet.id));
export function isGenericPetOpponent(pet: Pet | null | undefined): boolean {
    return !!pet && GENERIC_PET_OPPONENT_IDS.has(pet.id);
}
