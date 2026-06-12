/*
 * petElementByName — name → element lookup for every built-in pet template.
 *
 * Drives the Pet Arena type-effectiveness matchup (Fire > Wind > Lightning >
 * Earth > Water > Fire). Distribution across the player pet pool (two batches
 * of pets share each tier — original + expansion — keeping the per-element
 * split even):
 *   • Standard (50 pets): 10 each element
 *   • Rare     (50 pets): 10 each element
 *   • Legendary (30 pets): 6 each element
 *   • Mythic    (10 pets):  2 each element, set inline on the templates
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
    "Ember Phoenix": "Fire", "Ironfang Tiger": "Fire", "Armored Polar Bear": "Fire",
    // Legendary — Water
    "Glacier Wolf": "Water", "Azure Kirin": "Water", "Frost Lynx": "Water",
    // Legendary — Wind
    "Tempest Hawk": "Wind", "Ancient Crane": "Wind", "Umbra Fox": "Wind",
    // Legendary — Lightning
    "Storm Lion": "Lightning", "Thunder Drake": "Lightning", "Void Raven": "Lightning",
    // Legendary — Earth
    "Crystal Bear": "Earth", "Moon Serpent": "Earth", "Spirit Deer": "Earth",

    // ─────────────────────── EXPANSION BATCH ───────────────────────
    // Standard expansion — Fire
    "Flint Jackal": "Fire", "Ember Mole": "Fire", "Cinder Moth": "Fire",
    "Scorch Skink": "Fire", "Magma Pup": "Fire",
    // Standard expansion — Water
    "Brook Newt": "Water", "Pebble Crab": "Water", "Tide Minnow": "Water",
    "Reed Heron": "Water", "Marsh Eel": "Water",
    // Standard expansion — Wind
    "Breeze Finch": "Wind", "Dust Swift": "Wind", "Cliff Swallow": "Wind",
    "Kite Magpie": "Wind", "Glide Sparrow": "Wind",
    // Standard expansion — Lightning
    "Spark Shrew": "Lightning", "Bolt Mouse": "Lightning", "Arc Vole": "Lightning",
    "Storm Shrike": "Lightning", "Zap Quail": "Lightning",
    // Standard expansion — Earth
    "Clay Tortoise": "Earth", "Moss Hedgehog": "Earth", "Dune Armadillo": "Earth",
    "Gravel Pangolin": "Earth", "Loam Marmot": "Earth",

    // Rare expansion — Fire
    "Magma Hyena": "Fire", "Ember Ocelot": "Fire", "Pyre Kestrel": "Fire",
    "Scoria Mongoose": "Fire", "Blaze Caracal": "Fire",
    // Rare expansion — Water
    "Tidal Mink": "Water", "Frost Seal": "Water", "Coral Serval": "Water",
    "Brine Cormorant": "Water", "Glacier Marten": "Water",
    // Rare expansion — Wind
    "Cyclone Harrier": "Wind", "Zephyr Osprey": "Wind", "Gust Tern": "Wind",
    "Squall Plover": "Wind", "Drift Albatross": "Wind",
    // Rare expansion — Lightning
    "Volt Polecat": "Lightning", "Surge Stoat": "Lightning", "Thunder Jerboa": "Lightning",
    "Static Meerkat": "Lightning", "Arc Buzzard": "Lightning",
    // Rare expansion — Earth
    "Granite Wombat": "Earth", "Stoneback Tapir": "Earth", "Quartz Aardvark": "Earth",
    "Terra Porcupine": "Earth", "Bramble Capybara": "Earth",

    // Legendary expansion — Fire
    "Inferno Chimera": "Fire", "Ash Garuda": "Fire", "Magma Behemoth": "Fire",
    // Legendary expansion — Water
    "Tidelord Leviathan": "Water", "Frost Wyrm": "Water", "Abyss Kraken": "Water",
    // Legendary expansion — Wind
    "Storm Roc": "Wind", "Tempest Pegasus": "Wind", "Cyclone Sphinx": "Wind",
    // Legendary expansion — Lightning
    "Thunder Raiju": "Lightning", "Storm Wyvern": "Lightning", "Galvanic Manticore": "Lightning",
    // Legendary expansion — Earth
    "Titan Golem": "Earth", "Granite Gargoyle": "Earth", "Verdant Treant": "Earth",
};
