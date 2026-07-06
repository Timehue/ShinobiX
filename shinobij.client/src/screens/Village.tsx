import { type Screen, villagePageImage } from "../App";
import type { Biome, WeatherType } from "../types/core";
import type { Character } from "../types/character";
import { SceneAmbience } from "../components/SceneAmbience";
import { SceneCritters } from "../components/SceneCritters";
import { DayNightSky } from "../components/DayNightSky";
import { currentLogbookObjective } from "../lib/logbook-objectives";
import { rankFromLevel } from "../lib/stats";

// Bespoke pixel-art building icons (generated via scripts/gen-asset.mjs, then
// committed as bundle assets). One biome-neutral set reused across all four
// villages; the marker chip tint carries the per-village flavor.
import battleArenaIcon from "../assets/village-icons/battle-arena.webp";
import storyHallIcon from "../assets/village-icons/story-hall.webp";
import townHallIcon from "../assets/village-icons/townhall.webp";
import bankIcon from "../assets/village-icons/bank.webp";
import shopIcon from "../assets/village-icons/shop.webp";
import clanHallIcon from "../assets/village-icons/clan-hall.webp";
import hospitalIcon from "../assets/village-icons/hospital.webp";
import missionHallIcon from "../assets/village-icons/mission-hall.webp";
import cafeteriaIcon from "../assets/village-icons/cafeteria.webp";
import tavernIcon from "../assets/village-icons/tavern.webp";
import statTrainingIcon from "../assets/village-icons/stat-training.webp";
import jutsuTrainingIcon from "../assets/village-icons/jutsu-training.webp";
import worldMapIcon from "../assets/village-icons/world-map.webp";
import petYardIcon from "../assets/village-icons/pet-yard.webp";
import cardHallIcon from "../assets/village-icons/card-hall.webp";
import type { CSSProperties } from "react";

type VillageLocationTier = "main" | "support" | "advanced";

interface VillageLocation {
    name: string;
    img: string;
    screen: Screen;
    x: string;
    y: string;
    tier: VillageLocationTier;
}

const TIER_LABELS: Record<VillageLocationTier, string> = {
    main: "Main Path",
    support: "Support",
    advanced: "Later",
};

// Per-village accent for the marker chip (label border + hover glow). The
// object icons are warm/neutral, so this tint gives each village its flavor
// without needing a separate icon set per village.
const VILLAGE_ACCENT: Record<string, { border: string; glow: string }> = {
    "Frostfang Village": { border: "rgba(125, 211, 252, 0.55)", glow: "rgba(125, 211, 252, 0.7)" },
    "Stormveil Village": { border: "rgba(134, 239, 172, 0.55)", glow: "rgba(74, 222, 128, 0.7)" },
    "Ashen Leaf Village": { border: "rgba(251, 146, 60, 0.55)", glow: "rgba(251, 146, 60, 0.7)" },
    "Moonshadow Village": { border: "rgba(192, 132, 252, 0.55)", glow: "rgba(168, 85, 247, 0.7)" },
};

// Ambience tuned to each village's painted scene: snow over Frostfang, drifting
// petals over Moonshadow, leaves over the forest villages, rain over Stormveil's
// storm-coast. Drives the same SceneAmbience overlay used in sector views.
const VILLAGE_AMBIENCE: Record<string, { biome: Biome; weather?: WeatherType }> = {
    "Frostfang Village": { biome: "snow" },
    "Stormveil Village": { biome: "forest", weather: "rain" },
    "Ashen Leaf Village": { biome: "forest" },
    "Moonshadow Village": { biome: "shadow" },
};

const LOCATIONS: VillageLocation[] = [
    { name: "Battle Arena", img: battleArenaIcon, screen: "battleArena", x: "10%", y: "31%", tier: "main" },
    { name: "Story Hall", img: storyHallIcon, screen: "storyHall", x: "29%", y: "33%", tier: "support" },
    { name: "Town Hall", img: townHallIcon, screen: "townHall", x: "50%", y: "22%", tier: "support" },
    { name: "Bank", img: bankIcon, screen: "bank", x: "68%", y: "31%", tier: "support" },
    { name: "Shop", img: shopIcon, screen: "shop", x: "18%", y: "79%", tier: "support" },
    { name: "Clan Hall", img: clanHallIcon, screen: "clan", x: "13%", y: "57%", tier: "support" },
    { name: "Hospital", img: hospitalIcon, screen: "hospital", x: "66%", y: "56%", tier: "support" },
    { name: "Mission Hall", img: missionHallIcon, screen: "missions", x: "68%", y: "75%", tier: "main" },
    { name: "Cafeteria", img: cafeteriaIcon, screen: "cafeteria", x: "82%", y: "45%", tier: "support" },
    { name: "Tavern", img: tavernIcon, screen: "tavern", x: "82%", y: "63%", tier: "support" },
    { name: "Stat Training", img: statTrainingIcon, screen: "training", x: "83%", y: "25%", tier: "main" },
    { name: "Jutsu Training", img: jutsuTrainingIcon, screen: "jutsuTraining", x: "80%", y: "81%", tier: "main" },
    { name: "World Map", img: worldMapIcon, screen: "worldMap", x: "45%", y: "68%", tier: "main" },
    { name: "Pet Yard", img: petYardIcon, screen: "pets", x: "32%", y: "55%", tier: "support" },
    { name: "Card Hall", img: cardHallIcon, screen: "shinobiTiles", x: "52%", y: "55%", tier: "advanced" },
];

export function Village({ character, setScreen }: { character: Character; setScreen: (screen: Screen) => void }) {
    const characterVillage = character.village;
    const currentObjective = currentLogbookObjective(character);
    const currentRequirement = currentObjective?.requirements.find((requirement) => requirement.progress < requirement.target);
    const currentRank = rankFromLevel(character.level);
    const pathActions: Array<{ label: string; screen: Screen; emphasis?: boolean }> = [
        { label: "Logbook", screen: "logbook", emphasis: true },
        { label: "Missions", screen: "missions" },
        { label: "Training", screen: "training" },
        { label: "Jutsu", screen: "jutsuTraining" },
        { label: "World Map", screen: "worldMap" },
    ];

    const accent = VILLAGE_ACCENT[characterVillage] ?? VILLAGE_ACCENT["Frostfang Village"];
    const ambience = VILLAGE_AMBIENCE[characterVillage] ?? VILLAGE_AMBIENCE["Frostfang Village"];

    return (
        <div className="stormveil-village-screen">
            <div className="village-save-bar">
                <div className="village-safe-zone">SAFE ZONE</div>
            </div>

            <section className="village-path-panel">
                <div>
                    <span className="village-path-kicker">{currentRank} route</span>
                    <h2>{currentObjective?.title ?? "Village Route"}</h2>
                    <p>{currentRequirement ? currentRequirement.label : "Pick up the next Logbook goal when you are ready."}</p>
                </div>
                <div className="village-path-actions">
                    {pathActions.map((action) => (
                        <button key={action.screen} className={action.emphasis ? "primary" : ""} onClick={() => setScreen(action.screen)}>
                            {action.label}
                        </button>
                    ))}
                </div>
            </section>

            <div
                className="stormveil-map"
                style={{
                    backgroundImage: `url(${villagePageImage(characterVillage)})`,
                    "--village-accent": accent.border,
                    "--village-glow": accent.glow,
                } as CSSProperties}
            >
                <DayNightSky className="amb-under" />
                <SceneAmbience className="amb-under" biome={ambience.biome} weather={ambience.weather} />
                <SceneCritters className="amb-under" biome={ambience.biome} density={0.9} />
                {LOCATIONS.map((location) => (
                    <button
                        key={location.name}
                        className={`stormveil-map-button village-${location.tier}-path`}
                        style={{
                            left: location.x,
                            top: location.y,
                        }}
                        onClick={() => setScreen(location.screen)}
                    >
                        <img className="stormveil-map-icon" src={location.img} alt="" draggable={false} />
                        <strong>{location.name}</strong>
                        <span className="village-marker-tag">{TIER_LABELS[location.tier]}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
