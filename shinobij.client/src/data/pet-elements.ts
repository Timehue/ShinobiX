/*
 * petElementByName — name → element lookup for every built-in pet template.
 *
 * Drives the Pet Arena type-effectiveness matchup (Fire > Wind > Lightning >
 * Earth > Water > Fire). Distribution across the player pet pool:
 *   • Standard (25 pets): 5 Fire, 5 Water, 5 Wind, 5 Lightning, 5 Earth
 *   • Rare     (25 pets): 5 each (same)
 *   • Legendary (15 pets): 3 each
 *   • Mythic    (5 pets):  1 each, set inline on the templates themselves
 *
 * No "None" pets — every player pet plays the type chart so element matters
 * in every matchup. Elements were assigned thematically where the pet name
 * suggested one (Cinder Rat → Fire, Frost Cub → Water, etc.) and balanced
 * out across the more neutral names.
 *
 * Pure data. Extracted from App.tsx.
 */

import type { JutsuElement } from "../types/core";

export const petElementByName: Record<string, JutsuElement> = {
    // Standard — Fire
    "Red Fox": "Fire", "Ashen Crow": "Fire", "Cinder Rat": "Fire",
    "Desert Lizard": "Fire", "Sand Snake": "Fire",
    // Standard — Water
    "Snow Rabbit": "Water", "River Otter": "Water", "Blue Frog": "Water",
    "Mist Ferret": "Water", "Frost Cub": "Water",
    // Standard — Wind
    "Forest Hawk": "Wind", "Pine Owl": "Wind", "White Crane": "Wind",
    "Leaf Monkey": "Wind", "Storm Gull": "Wind",
    // Standard — Lightning
    "Iron Beetle": "Lightning", "Shadow Bat": "Lightning", "Tiny Wolf": "Lightning",
    "Temple Gecko": "Lightning", "Meadow Deer": "Lightning",
    // Standard — Earth
    "Stone Turtle": "Earth", "Wild Boar": "Earth", "Mud Toad": "Earth",
    "Rock Badger": "Earth", "Black Cat": "Earth",

    // Rare — Fire
    "Crimson Fox": "Fire", "Ashwing Raven": "Fire", "Cinder Weasel": "Fire",
    "Shrine Salamander": "Fire", "Dune Viper": "Fire",
    // Rare — Water
    "Frost Hare": "Water", "Tide Otter": "Water", "Azure Toad": "Water",
    "Mist Lynx": "Water", "Frostbite Cub": "Water",
    // Rare — Wind
    "Sky Falcon": "Wind", "Silver Owl": "Wind", "Pearl Crane": "Wind",
    "Bamboo Ape": "Wind", "Stormfin Gull": "Wind",
    // Rare — Lightning
    "Glass Serpent": "Lightning", "Steel Beetle": "Lightning", "Duskwings Bat": "Lightning",
    "Thorn Stag": "Lightning", "Young Direwolf": "Lightning",
    // Rare — Earth
    "Ironback Turtle": "Earth", "Bristle Boar": "Earth", "Mossback Toad": "Earth",
    "Granite Badger": "Earth", "Night Panther": "Earth",

    // Legendary — Fire
    "Ember Phoenix": "Fire", "Ironfang Tiger": "Fire", "Golden Scarab": "Fire",
    // Legendary — Water
    "Glacier Wolf": "Water", "Azure Kirin": "Water", "Frost Lynx": "Water",
    // Legendary — Wind
    "Tempest Hawk": "Wind", "Ancient Crane": "Wind", "Umbra Fox": "Wind",
    // Legendary — Lightning
    "Storm Lion": "Lightning", "Thunder Drake": "Lightning", "Void Raven": "Lightning",
    // Legendary — Earth
    "Crystal Bear": "Earth", "Moon Serpent": "Earth", "Spirit Deer": "Earth",
};
