/*
 * Sector forecast, worded.
 *
 * shared/sector-weather already knows the sky for every window ahead — it is a
 * pure function of (biome, sector, window), which is exactly what lets the
 * server seal the same value into a fight. A deterministic sky that a player
 * cannot read is a wasted one, so this turns those windows into the two lines
 * the sector plate shows: what is overhead, and what is coming.
 *
 * Pure and $0: no network, no storage, no assets. `nowMs` is passed in by the
 * caller (from lib/server-clock `serverNow()`, on a tick) rather than read here,
 * so this module never touches a clock during render.
 */

import { sectorForecast, WEATHER_WINDOW_MS, type SectorForecastEntry } from "../../../shared/sector-weather";
import { weatherEffects } from "../data/world";
import type { Biome, WeatherType } from "../types/core";
import { loadSectorTerritory } from "./world-state";
import { serverNow } from "./server-clock";

export type SectorSkyLine = {
    /** The sky overhead right now — always equal to `weatherForSector`. */
    now: WeatherType;
    /** Its display name, e.g. "Rainstorm". */
    nowName: string;
    /** The next DIFFERENT sky, or null when a clan has stamped this sector. */
    next: WeatherType | null;
    nextName: string;
    /** Real ms until `next` arrives; 0 when there is nothing to count down to. */
    inMs: number;
    /** Human "18m" / "1h 20m" / "" — what the plate actually prints. */
    inLabel: string;
    /** True when a holding clan is stamping the sky, so nothing is scheduled. */
    stamped: boolean;
};

/** "18m", "1h 20m", "<1m" — short enough to sit on one line of the plate. */
export function shortDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "";
    const totalMinutes = Math.ceil(ms / 60_000);
    if (totalMinutes < 1) return "<1m";
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

const nameOf = (weather: WeatherType) => weatherEffects[weather]?.name ?? "Clear Skies";

/**
 * The sky over a sector and the next change due, ready to render.
 *
 * Looks far enough ahead to find a sky that actually DIFFERS: the chain
 * deliberately holds a front for several windows, so "next: Rainstorm" while it
 * is already raining would be a countdown to nothing happening. When the whole
 * horizon holds the same sky, `next` is null and the plate simply says what is
 * overhead — a settled spell is a true answer, not a missing one.
 */
export function sectorSkyLine(sector: number, biome: Biome, nowMs: number = serverNow()): SectorSkyLine {
    // 12 windows is a full in-world day of lookahead — enough that a settled
    // spell reads as settled rather than as the horizon running out.
    const rows: SectorForecastEntry[] = sectorForecast(biome, sector, nowMs, 12, loadSectorTerritory(sector));
    const current = rows[0];
    const now = (current?.weather ?? "clear") as WeatherType;
    const base: SectorSkyLine = {
        now,
        nowName: nameOf(now),
        next: null,
        nextName: "",
        inMs: 0,
        inLabel: "",
        stamped: current?.stamped === true,
    };
    if (base.stamped) return base;

    const change = rows.find((row) => row.weather !== now);
    if (!change) return base;
    const next = change.weather as WeatherType;
    const inMs = Math.max(0, change.startsAt - nowMs);
    return { ...base, next, nextName: nameOf(next), inMs, inLabel: shortDuration(inMs) };
}

/**
 * How often a forecast readout should re-read the clock.
 *
 * The countdown label is minute-resolution, so a minute would be enough for the
 * COUNTDOWN. The sky's NAME is the tighter constraint: a window turns every 40
 * real minutes, the server re-derives the sky from its own clock the moment a
 * fight is sealed, and a plate still naming the previous sky is a plate lying
 * about the modifiers the fight will use. Reading every 15s bounds that
 * disagreement to 15s instead of a minute.
 *
 * The tick is close to free either way: consumers that store the weather STRING
 * (SceneAmbience) hit React's bail-out when it has not changed, and the one that
 * stores a fresh object repaints a single span.
 */
export const FORECAST_REFRESH_MS = Math.min(15_000, WEATHER_WINDOW_MS);
