import type { Screen } from "../types/core";
import { villagePageImage } from "../lib/village-page-image";
import type { Biome, WeatherType } from "../types/core";
import type { Character } from "../types/character";
import { SceneAmbience } from "../components/SceneAmbience";
import { SceneCritters } from "../components/SceneCritters";
import { DayNightSky } from "../components/DayNightSky";
import { JourneyGuide } from "../components/JourneyGuide";
import { preloadScreen } from "../lib/screen-preload";
import { VILLAGE_FACILITIES } from "../lib/facility-presentation";
import type { CSSProperties } from "react";

// Ambience tuned to each village's painted scene: snow over Frostfang, drifting
// petals over Moonshadow, leaves over the forest villages, rain over Stormveil's
// storm-coast. Drives the same SceneAmbience overlay used in sector views.
const VILLAGE_AMBIENCE: Record<string, { biome: Biome; weather?: WeatherType }> = {
    "Frostfang Village": { biome: "snow" },
    "Stormveil Village": { biome: "forest", weather: "rain" },
    "Ashen Leaf Village": { biome: "forest" },
    "Moonshadow Village": { biome: "shadow" },
};

export function Village({ character, setScreen }: { character: Character; setScreen: (screen: Screen) => void }) {
    const characterVillage = character.village;
    const ambience = VILLAGE_AMBIENCE[characterVillage] ?? VILLAGE_AMBIENCE["Frostfang Village"];

    return (
        <div className="stormveil-village-screen">
            <div className="village-save-bar">
                <div className="village-safe-zone">SAFE ZONE</div>
            </div>

            <div
                className="stormveil-map"
                style={{ backgroundImage: `url(${villagePageImage(characterVillage)})` }}
            >
                <DayNightSky className="amb-under" />
                <SceneAmbience className="amb-under" biome={ambience.biome} weather={ambience.weather} />
                <SceneCritters className="amb-under" biome={ambience.biome} density={0.9} />
                <JourneyGuide key={character.name} character={character} setScreen={setScreen} />
                {VILLAGE_FACILITIES.map((location) => (
                    <button
                        key={location.screen}
                        className="stormveil-map-button facility-tile"
                        style={{
                            left: location.mapX,
                            top: location.mapY,
                            "--facility-accent": location.accent,
                        } as CSSProperties}
                        onPointerEnter={() => preloadScreen(location.screen)}
                        onFocus={() => preloadScreen(location.screen)}
                        onPointerDown={() => preloadScreen(location.screen)}
                        onClick={() => setScreen(location.screen)}
                        aria-label={`Enter ${location.name}`}
                    >
                        <span className="stormveil-map-icon-frame">
                            <img className="stormveil-map-icon" src={location.thumbnail} alt="" draggable={false} />
                        </span>
                        <span className="stormveil-map-copy">
                            <span>{location.eyebrow}</span>
                            <strong>{location.name}</strong>
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}
