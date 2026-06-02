/*
 * World environment tables — terrain effects per biome, weather effects
 * per weather type, and the per-biome weather rotation table that drives
 * the per-sector weather lookup. Plus biomeLabel: the biome → in-world
 * place-name lookup used across battle, world-map, VN, and dungeon screens.
 *
 * Pure data + the one pure biome lookup helper. Extracted from App.tsx.
 */

import type { Biome, WeatherType, JutsuElement } from "../types/core";

export const terrainEffects: Record<
    Biome,
    {
        name: string;
        description: string;
        playerBuff?: string;
    }
> = {
    forest: {
        name: "Forest Terrain",
        description: "Taijutsu is empowered.",
        playerBuff: "+10% Taijutsu Damage",
    },

    snow: {
        name: "Frozen Terrain",
        description: "Bukijutsu is empowered.",
        playerBuff: "+10% Bukijutsu Damage",
    },

    volcano: {
        name: "Volcanic Terrain",
        description: "Ninjutsu is empowered.",
        playerBuff: "+10% Ninjutsu Damage",
    },

    shadow: {
        name: "Shadow Terrain",
        description: "Genjutsu thrives in darkness.",
        playerBuff: "+10% Genjutsu Damage",
    },

    central: {
        name: "Central Arena",
        description: "Balanced battlefield.",
    },
};

export const weatherEffects: Record<
    WeatherType,
    {
        name: string;
        description: string;
        effect: string;
        positiveElement?: JutsuElement;
        negativeElement?: JutsuElement;
    }
> = {
    clear: {
        name: "Clear Skies",
        description: "No active weather effect.",
        effect: "No combat modifiers.",
    },

    rain: {
        name: "Rainstorm",
        description: "Water chakra flows easier while fire struggles to ignite.",
        effect: "Water damage +5%. Fire damage -2%.",
        positiveElement: "Water",
        negativeElement: "Fire",
    },

    ashfall: {
        name: "Ashfall",
        description: "Fire chakra burns hotter while water is choked by drifting ash.",
        effect: "Fire damage +5%. Water damage -2%.",
        positiveElement: "Fire",
        negativeElement: "Water",
    },

    thunderstorm: {
        name: "Thunderstorm",
        description: "Lightning surges through the field while wind patterns collapse.",
        effect: "Lightning damage +5%. Wind damage -2%.",
        positiveElement: "Lightning",
        negativeElement: "Wind",
    },

    tornado: {
        name: "Tornado",
        description: "Wind chakra accelerates while grounded techniques lose stability.",
        effect: "Wind damage +5%. Earth damage -2%.",
        positiveElement: "Wind",
        negativeElement: "Earth",
    },

    desertHaze: {
        name: "Desert Haze",
        description: "Earth chakra hardens while lightning has trouble finding a clean path.",
        effect: "Earth damage +5%. Lightning damage -2%.",
        positiveElement: "Earth",
        negativeElement: "Lightning",
    },
};

export const biomeWeatherTables: Record<Biome, WeatherType[]> = {
    forest: ["rain", "tornado", "rain", "clear"],
    snow: ["rain", "thunderstorm", "clear", "rain"],
    volcano: ["ashfall", "desertHaze", "ashfall", "clear"],
    shadow: ["thunderstorm", "tornado", "desertHaze", "clear"],
    central: ["clear", "rain", "ashfall", "thunderstorm", "tornado", "desertHaze"],
};

export function biomeLabel(biome: Biome) {
    if (biome === "forest") return "Stormveil Coastal Waters";
    if (biome === "snow") return "Frostfang Icefields";
    if (biome === "volcano") return "Ashen Leaf Forest";
    if (biome === "shadow") return "Moonshadow Darklands";
    return "Central Meadow";
}
