/*
 * CombatWeatherLayer — the world's sky over the battlefield.
 *
 * One SceneAmbience canvas (the same lightweight 2D emitter the world map and
 * sector screens already run) in its weather-only mode, mounted inside the
 * board wrapper just before `.hex-grid-layer` so rain, ash and haze read on the
 * arena floor through the tiles' glass tint while fighters, targeting, plates
 * and floating numbers stay crisp on top. (Not a sibling before the wrapper:
 * the wide-desktop skin addresses the wrapper as `.hex-battlefield >
 * div:first-child`.) A clear sky mounts nothing. Reduced motion mounts nothing (a frozen
 * rain frame reads as scratches, not weather). Weak devices get roughly half
 * the particles on top of SceneAmbience's own low-end cut.
 *
 * VISUAL ONLY. The weather it draws is the one the server sealed into the
 * fight (or the sector sky at fight start); it never feeds any combat number.
 * It runs no timer of its own — SceneAmbience in this mode reads its `weather`
 * prop once and polls nothing — and unmounting the screen cancels its rAF,
 * observer and listeners.
 */
import React, { useMemo, type CSSProperties } from "react";
import type { Biome, WeatherType } from "../types/core";
import { SceneAmbience } from "./SceneAmbience";
import { prefersLiteCombatFx, prefersReducedMotion } from "../lib/device-tier";
import { combatWeatherPresentation } from "../lib/combat-presentation";

const BIOMES: ReadonlySet<string> = new Set(["snow", "volcano", "shadow", "forest", "central"]);

export function CombatWeatherLayer({ biome, weather }: {
    /** Arena biome string; anything SceneAmbience does not know falls back to "central". */
    biome: string;
    weather: WeatherType | null | undefined;
}) {
    const presentation = useMemo(() => combatWeatherPresentation(weather), [weather]);
    const lite = useMemo(() => prefersLiteCombatFx(), []);
    if (!presentation || !weather || prefersReducedMotion()) return null;
    const ambienceBiome = (BIOMES.has(biome) ? biome : "central") as Biome;
    return (
        <div
            className={`combat-weather-layer combat-weather-${weather}`}
            data-combat-weather={weather}
            style={{ "--combat-weather-opacity": presentation.opacity } as CSSProperties}
            aria-hidden="true"
        >
            <SceneAmbience
                biome={ambienceBiome}
                weather={weather}
                weatherOnly
                hazeStyle="wisps"
                intensity={presentation.intensity * (lite ? 0.5 : 1)}
                className="combat-weather-ambience"
            />
        </div>
    );
}
