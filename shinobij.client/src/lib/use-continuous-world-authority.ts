import { startTransition, useCallback } from 'react';
import type { Biome, WeatherType } from '../types/core';
import { biomeForWorldSector } from '../data/sectors';
import { weatherForSector } from './world-state';
import { regionSplashLabelFor, regionTintForSector } from '../components/WorldWalkFeel';

type Options = {
    currentSector?: number | null; busy: () => boolean;
    setSectorPlayerPos: (tile: number) => void; setCurrentSector: (sector: number) => void;
    setSelectedSector: (sector: number) => void; setCurrentBiome: (biome: Biome) => void;
    setCurrentWeather: (weather: WeatherType) => void;
    setRegionSplash: (splash: { label: string; tint: string; stamp: number }) => void;
};
export function useContinuousWorldAuthority(options: Options) {
    return useCallback((sector: number, tile: number) => {
        if (options.busy()) return;
        if (sector === options.currentSector) {
            // A step inside the sector changes only the player's tile, and the
            // whole World Map renders it, several times a second while walking.
            // As a transition that render yields to walking frames and taps.
            // React applies updates in the order they were made, so a later
            // crossing (below, urgent) still wins over an older tile.
            startTransition(() => options.setSectorPlayerPos(tile));
            return;
        }
        options.setSectorPlayerPos(tile);
        const biome = biomeForWorldSector(sector);
        options.setCurrentSector(sector); options.setSelectedSector(sector);
        options.setCurrentBiome(biome); options.setCurrentWeather(weatherForSector(sector, biome));
        const label = regionSplashLabelFor(sector);
        if (label) options.setRegionSplash({ label, tint: regionTintForSector(sector), stamp: Date.now() });
    }, [options]);
}
