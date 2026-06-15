import { type Screen, villagePageImage } from "../App";
import type { Biome, WeatherType } from "../types/core";
import { SceneAmbience } from "../components/SceneAmbience";
import { SceneCritters } from "../components/SceneCritters";
import { DayNightSky } from "../components/DayNightSky";

// Bespoke pixel-art building icons (generated via scripts/gen-asset.mjs, then
// committed as bundle assets). One biome-neutral set reused across all four
// villages — the marker chip tint carries the per-village flavor.
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

// Per-village accent for the marker chip (label border + hover glow). The
// object icons are warm/neutral, so this tint is what gives each village its
// biome flavour without needing a separate icon set per village.
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

export function Village({ characterVillage, setScreen }: { characterVillage: string; setScreen: (screen: Screen) => void }) {
    // `saveMsg` was destructured without a setter and stayed "" forever —
    // the conditional render at line 28 was dead code. Removed.
    const locations = [
        { name: "Battle Arena", img: battleArenaIcon, screen: "battleArena" as Screen, x: "10%", y: "31%" },
        { name: "Story Hall", img: storyHallIcon, screen: "storyHall" as Screen, x: "29%", y: "33%" },
        { name: "Town Hall", img: townHallIcon, screen: "townHall" as Screen, x: "50%", y: "22%" },
        { name: "Bank", img: bankIcon, screen: "bank" as Screen, x: "68%", y: "31%" },
        { name: "Shop", img: shopIcon, screen: "shop" as Screen, x: "18%", y: "79%" },
        { name: "Clan Hall", img: clanHallIcon, screen: "clan" as Screen, x: "13%", y: "57%" },
        { name: "Hospital", img: hospitalIcon, screen: "hospital" as Screen, x: "66%", y: "56%" },
        { name: "Mission Hall", img: missionHallIcon, screen: "missions" as Screen, x: "68%", y: "75%" },
        { name: "Cafeteria", img: cafeteriaIcon, screen: "cafeteria" as Screen, x: "82%", y: "45%" },
        { name: "Tavern", img: tavernIcon, screen: "tavern" as Screen, x: "82%", y: "63%" },
        { name: "Stat Training", img: statTrainingIcon, screen: "training" as Screen, x: "83%", y: "25%" },
        { name: "Jutsu Training", img: jutsuTrainingIcon, screen: "jutsuTraining" as Screen, x: "80%", y: "81%" },
        { name: "World Map", img: worldMapIcon, screen: "worldMap" as Screen, x: "45%", y: "68%" },
        { name: "Pet Yard", img: petYardIcon, screen: "pets" as Screen, x: "32%", y: "55%" },
        { name: "Card Hall", img: cardHallIcon, screen: "shinobiTiles" as Screen, x: "52%", y: "55%" },
    ];

    const accent = VILLAGE_ACCENT[characterVillage] ?? VILLAGE_ACCENT["Frostfang Village"];
    const ambience = VILLAGE_AMBIENCE[characterVillage] ?? VILLAGE_AMBIENCE["Frostfang Village"];

    return (
        <div className="stormveil-village-screen">
            <div className="village-save-bar">
                <div className="village-safe-zone">🛡️ SAFE ZONE</div>
            </div>

            <div
                className="stormveil-map"
                style={{
                    backgroundImage: `url(${villagePageImage(characterVillage)})`,
                    "--village-accent": accent.border,
                    "--village-glow": accent.glow,
                } as CSSProperties}
            >
                {/* Living village: time-of-day wash, drifting biome ambience, and
                    wildlife (birds by day, fireflies after dark) behind the building
                    markers (all z-index below the z-4 map buttons). */}
                <DayNightSky className="amb-under" />
                <SceneAmbience className="amb-under" biome={ambience.biome} weather={ambience.weather} />
                <SceneCritters className="amb-under" biome={ambience.biome} density={0.9} />
                {locations.map((location) => (
                    <button
                        key={location.name}
                        className="stormveil-map-button"
                        style={{
                            left: location.x,
                            top: location.y,
                        }}
                        onClick={() => setScreen(location.screen)}
                    >
                        <img className="stormveil-map-icon" src={location.img} alt="" draggable={false} />
                        <strong>{location.name}</strong>
                    </button>
                ))}
            </div>
        </div>
    );
}
