/*
 * Starter companions — the 5 element-themed pets a brand-new shinobi chooses
 * from right after the Village Lore screen (the "investment hook" onboarding
 * beat). One per element so the choice doubles as a Pet-Arena type-matchup
 * identity (Fire > Wind > Lightning > Earth > Water > Fire).
 *
 * Design intent: all five are STANDARD tier and roughly equal in total power —
 * the choice is meaningful because of the element wheel + a distinct role lean
 * and trait, NOT because one is statistically better (the Pokémon-starter
 * model). Stats sit inside the standard band, so they're balance-safe and are
 * never clamped by capPetStats.
 *
 * IMPORTANT — the `starter-*` ids are deliberately NOT of the form
 * `${rarity}-${index}`, so builtInPetTemplateId() never matches them and
 * normalizePet() leaves the hand-authored kit + stat leans untouched on every
 * load. Do not renumber them to `standard-N`.
 *
 * Pure data. Granted to character.pets in App.tsx (applyPetTraitBonuses is
 * applied at grant time, exactly like a befriended encounter pet).
 */

import type { Pet } from "../types/pet";
import type { JutsuElement } from "../types/core";

export type StarterPetOption = {
    pet: Pet;
    element: JutsuElement;
    role: string;            // one-line combat identity
    blurb: string;           // flavor + what playing it feels like
    accent: string;          // card accent color
    icon: string;            // element emoji
    strongVs: JutsuElement;  // element this beats (×1.25)
    weakVs: JutsuElement;    // element that beats this (×0.80)
    traitEffect: string;     // human-readable trait effect
};

export const STARTER_PETS: StarterPetOption[] = [
    {
        element: "Fire",
        role: "Assassin — fragile burst",
        blurb: "Hits hardest, but fragile. Win the exchange before it can hit you back.",
        accent: "#f97316",
        icon: "🔥",
        strongVs: "Wind",
        weakVs: "Water",
        traitEffect: "Aggressive — spawns with +15% attack",
        pet: {
            id: "starter-fire",
            name: "Cinder Cub",
            rarity: "standard",
            level: 1,
            xp: 0,
            maxLevel: 100,
            hp: 280,
            attack: 56,
            defense: 22,
            speed: 38,
            moveRange: 3,
            element: "Fire",
            trait: "Aggressive",
            unlockedForPve: false,
            description: "A hot-tempered fox kit whose fur smolders when it's spoiling for a fight.",
            jutsus: [
                { name: "Cinder Pounce", power: 48, cooldown: 2, currentCooldown: 0, kind: "damage" },
                { name: "Searing Wound", power: 30, cooldown: 4, currentCooldown: 0, kind: "wound", rounds: 2 },
                { name: "Flame Burst", power: 58, cooldown: 3, currentCooldown: 0, kind: "damage", signature: true },
                { name: "Ember Dash", power: 0, cooldown: 3, currentCooldown: 0, kind: "move" },
            ],
        },
    },
    {
        element: "Water",
        role: "Sage — sustain healer",
        blurb: "Durable and self-healing. Out-lasts opponents in a long fight.",
        accent: "#38bdf8",
        icon: "💧",
        strongVs: "Fire",
        weakVs: "Earth",
        traitEffect: "Loyal — trains 50% faster, grows stronger with you",
        pet: {
            id: "starter-water",
            name: "Ripple Seal",
            rarity: "standard",
            level: 1,
            xp: 0,
            maxLevel: 100,
            hp: 360,
            attack: 32,
            defense: 32,
            speed: 28,
            moveRange: 3,
            element: "Water",
            trait: "Loyal",
            unlockedForPve: false,
            description: "A calm river seal that mends its companion's wounds between exchanges.",
            jutsus: [
                { name: "Tide Ward", power: 40, cooldown: 4, currentCooldown: 0, kind: "barrier" },
                { name: "Soothing Current", power: 46, cooldown: 4, currentCooldown: 0, kind: "heal" },
                { name: "Tidal Crash", power: 54, cooldown: 3, currentCooldown: 0, kind: "damage", signature: true },
                { name: "Seal Glide", power: 0, cooldown: 3, currentCooldown: 0, kind: "move" },
            ],
        },
    },
    {
        element: "Wind",
        role: "Tracker — swift skirmisher",
        blurb: "Fastest on the board. Slows its prey, then strikes from range.",
        accent: "#2dd4bf",
        icon: "🌬️",
        strongVs: "Lightning",
        weakVs: "Fire",
        traitEffect: "Swift — spawns with +20% speed, +25% battle XP while active",
        pet: {
            id: "starter-wind",
            name: "Gale Chick",
            rarity: "standard",
            level: 1,
            xp: 0,
            maxLevel: 100,
            hp: 300,
            attack: 42,
            defense: 24,
            speed: 44,
            moveRange: 4,
            element: "Wind",
            trait: "Swift",
            unlockedForPve: false,
            description: "A fledgling raptor that rides the wind, striking before the enemy can react.",
            jutsus: [
                { name: "Talon Rake", power: 46, cooldown: 2, currentCooldown: 0, kind: "damage" },
                { name: "Hobbling Gust", power: 0, cooldown: 4, currentCooldown: 0, kind: "slow", rounds: 2 },
                { name: "Gale Slash", power: 54, cooldown: 3, currentCooldown: 0, kind: "damage", signature: true },
                { name: "Wind Step", power: 0, cooldown: 2, currentCooldown: 0, kind: "move" },
            ],
        },
    },
    {
        element: "Lightning",
        role: "Assassin — glass cannon",
        blurb: "Highest single-hit damage. Marks a target, then bites with a thunderclap.",
        accent: "#facc15",
        icon: "⚡",
        strongVs: "Earth",
        weakVs: "Wind",
        traitEffect: "Battleborn — spawns with +10% to all stats",
        pet: {
            id: "starter-lightning",
            name: "Spark Pup",
            rarity: "standard",
            level: 1,
            xp: 0,
            maxLevel: 100,
            hp: 265,
            attack: 58,
            defense: 20,
            speed: 36,
            moveRange: 3,
            element: "Lightning",
            trait: "Battleborn",
            unlockedForPve: false,
            description: "A crackling wolf pup that marks its prey, then strikes with a thunderclap.",
            jutsus: [
                { name: "Jolt Bite", power: 50, cooldown: 2, currentCooldown: 0, kind: "damage" },
                { name: "Static Mark", power: 0, cooldown: 4, currentCooldown: 0, kind: "mark", rounds: 2 },
                { name: "Thunder Fang", power: 58, cooldown: 3, currentCooldown: 0, kind: "damage", signature: true },
                { name: "Bolt Dash", power: 0, cooldown: 3, currentCooldown: 0, kind: "move" },
            ],
        },
    },
    {
        element: "Earth",
        role: "Defender — guardian tank",
        blurb: "Toughest to kill. Raises walls and shrugs off blows for its partner.",
        accent: "#c2855a",
        icon: "🪨",
        strongVs: "Water",
        weakVs: "Lightning",
        traitEffect: "Guardian — spawns with +20% HP & DEF, cuts your battle damage 8%",
        pet: {
            id: "starter-earth",
            name: "Pebble Tortoise",
            rarity: "standard",
            level: 1,
            xp: 0,
            maxLevel: 100,
            hp: 400,
            attack: 32,
            defense: 44,
            speed: 20,
            moveRange: 2,
            element: "Earth",
            trait: "Guardian",
            unlockedForPve: false,
            description: "A sturdy tortoise that raises stone walls and weathers blows for its partner.",
            jutsus: [
                { name: "Shell Bash", power: 42, cooldown: 2, currentCooldown: 0, kind: "damage" },
                { name: "Stone Guard", power: 30, cooldown: 4, currentCooldown: 0, kind: "barrier" },
                { name: "Boulder Crush", power: 48, cooldown: 3, currentCooldown: 0, kind: "crush", signature: true },
                { name: "Pebble Roll", power: 0, cooldown: 3, currentCooldown: 0, kind: "move" },
            ],
        },
    },
];
