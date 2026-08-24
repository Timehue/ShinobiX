/*
 * Sector weather — ONE world, ONE sky. Shared by client and server (like
 * sector-geo), so both sides derive the SAME weather for a sector on a given
 * day and the server never has to trust a client-reported forecast.
 *
 * The weather for a sector is a pure function of
 *   (biome, sector, UTC day bucket)
 * seeded with a small integer hash, so it rotates day to day, differs between
 * neighbouring sectors, and is identical for every player — provided both
 * sides feed it the server clock (client: lib/server-clock `serverNow()`;
 * server: `Date.now()`).
 *
 * Precedence (`resolveSectorWeather`): a clan that HOLDS the sector and has
 * stamped a weather on the territory record overrides the schedule; otherwise
 * the schedule applies. Unknown biomes fall back to "clear".
 *
 * The modifier VALUES (+5% / −2%) live in the combat engines (client
 * data/world.ts `weatherEffects`, api/combat-core/formulas.ts
 * `weatherMultiplier`); this module only decides WHICH weather is up.
 */

export type SectorWeatherBiome = 'forest' | 'snow' | 'volcano' | 'shadow' | 'central';

export type SectorWeather = 'clear' | 'rain' | 'ashfall' | 'thunderstorm' | 'tornado' | 'desertHaze';

/** Element each weather boosts / dampens. Mirrors client `weatherEffects`
 *  (data/world.ts) — a test pins the two together. */
export const WEATHER_ELEMENTS: Readonly<Record<SectorWeather, { positiveElement: string; negativeElement: string }>> = Object.freeze({
    clear: { positiveElement: '', negativeElement: '' },
    rain: { positiveElement: 'Water', negativeElement: 'Fire' },
    ashfall: { positiveElement: 'Fire', negativeElement: 'Water' },
    thunderstorm: { positiveElement: 'Lightning', negativeElement: 'Wind' },
    tornado: { positiveElement: 'Wind', negativeElement: 'Earth' },
    desertHaze: { positiveElement: 'Earth', negativeElement: 'Lightning' },
});

/** Per-biome weather rotation tables (the historical client tables, unchanged). */
export const biomeWeatherTables: Readonly<Record<SectorWeatherBiome, readonly SectorWeather[]>> = Object.freeze({
    forest: ['rain', 'tornado', 'rain', 'clear'],
    snow: ['rain', 'thunderstorm', 'clear', 'rain'],
    volcano: ['ashfall', 'desertHaze', 'ashfall', 'clear'],
    shadow: ['thunderstorm', 'tornado', 'desertHaze', 'clear'],
    central: ['clear', 'rain', 'ashfall', 'thunderstorm', 'tornado', 'desertHaze'],
});

const BIOME_SALT: Readonly<Record<SectorWeatherBiome, number>> = Object.freeze({
    forest: 1, snow: 2, volcano: 3, shadow: 4, central: 5,
});

export const WEATHER_DAY_MS = 24 * 60 * 60 * 1000;

/** UTC day bucket for a ms timestamp — the unit weather rotates on. */
export function weatherDayBucket(nowMs: number): number {
    const n = Number(nowMs);
    return Number.isFinite(n) ? Math.floor(n / WEATHER_DAY_MS) : 0;
}

/** Small integer mixer (lowbias32) — deterministic across JS runtimes. */
function mix32(x: number): number {
    let h = x >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return h >>> 0;
}

function isKnownBiome(biome: unknown): biome is SectorWeatherBiome {
    return typeof biome === 'string' && Object.prototype.hasOwnProperty.call(biomeWeatherTables, biome);
}

/**
 * The scheduled weather for a sector on a UTC day, ignoring any clan override.
 * Pure: same (biome, sector, dayBucket) → same weather on every machine.
 */
export function scheduledSectorWeather(biome: unknown, sector: number, dayBucket: number): SectorWeather {
    if (!isKnownBiome(biome)) return 'clear';
    const table = biomeWeatherTables[biome];
    if (table.length === 0) return 'clear';
    const s = Number.isFinite(sector) ? Math.floor(sector) : 0;
    const d = Number.isFinite(dayBucket) ? Math.floor(dayBucket) : 0;
    const seed = mix32((s * 0x9e3779b1) ^ mix32(d * 0x85ebca6b + BIOME_SALT[biome]));
    return table[seed % table.length] ?? 'clear';
}

export type SectorWeatherOverride = { ownerClan?: unknown; weather?: unknown } | null | undefined;

function isWeather(w: unknown): w is SectorWeather {
    return typeof w === 'string' && Object.prototype.hasOwnProperty.call(WEATHER_ELEMENTS, w);
}

/**
 * The weather a sector shows RIGHT NOW: a holding clan's stamped weather wins,
 * otherwise today's scheduled weather. `nowMs` must come from the server
 * clock on both sides (client `serverNow()`, server `Date.now()`).
 */
export function resolveSectorWeather(biome: unknown, sector: number, nowMs: number, territory?: SectorWeatherOverride): SectorWeather {
    const ownerClan = String(territory?.ownerClan ?? '').trim();
    if (ownerClan && isWeather(territory?.weather)) return territory.weather;
    return scheduledSectorWeather(biome, sector, weatherDayBucket(nowMs));
}

/** Elements the given weather boosts / dampens — '' for none. */
export function sectorWeatherElements(weather: SectorWeather): { positiveElement: string; negativeElement: string } {
    return WEATHER_ELEMENTS[weather] ?? WEATHER_ELEMENTS.clear;
}
