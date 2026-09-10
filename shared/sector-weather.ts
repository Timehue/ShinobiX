/*
 * Sector weather — ONE world, ONE sky. Shared by client and server (like
 * sector-geo), so both sides derive the SAME weather for a sector at a given
 * moment and the server never has to trust a client-reported forecast.
 *
 * The weather for a sector is a pure function of
 *   (biome, sector, weather window)
 * seeded with a small integer hash, so it moves through the day, differs between
 * neighbouring sectors, and is identical for every player — provided both
 * sides feed it the server clock (client: lib/server-clock `serverNow()`;
 * server: `Date.now()`).
 *
 * WEATHER MOVES WITHIN A DAY, AND IT MOVES IN PATTERNS
 * ---------------------------------------------------
 * Two things used to make this a label rather than weather.
 *
 * 1. It rotated once per REAL day. A sector's sky was a fixed fact for 24 hours,
 *    which sector-contracts had to write around in prose: a weather requirement
 *    "would be either always true or always impossible for a given sector that
 *    day". Windows are now a third of an IN-WORLD day (shared/world-clock), so
 *    three skies per in-world day and one change every 40 real minutes. That is
 *    Final Fantasy XIV's cadence, which changes zone weather every eight Eorzean
 *    hours, and it is picked for the same reason: often enough to be worth
 *    looking up, slow enough to plan around.
 *
 * 2. Each window drew independently, so the sky teleported — clear, tornado,
 *    clear again inside two hours. Draws are now a MARKOV CHAIN: the next window
 *    usually holds the current weather, and when it does change it may only move
 *    one step along a calm→severe ladder. Fronts build and break (clear → rain →
 *    thunderstorm → rain → clear) instead of flickering. This is the standard
 *    fix for "random weather tables are too random", and it costs no storage.
 *
 * STILL PURE, STILL STATELESS
 * ---------------------------
 * A chain normally needs somewhere to keep yesterday's state. This one does not:
 * every query replays the chain from a fixed anchor (the start of the current
 * BLOCK of windows) with a seeded opening draw, so any machine asking about any
 * window gets the identical answer without reading anything. The replay is
 * bounded by `WEATHER_BLOCK_WINDOWS` — a few dozen integer mixes, far cheaper
 * than the storage round-trip it replaces.
 *
 * The one seam is the block boundary, where the chain re-seeds and may step more
 * than one rung. That is once per sector per two real days, and the re-seed
 * draws from the biome's own table, so the worst case is a sky that turns faster
 * than usual — not one that turns into something the biome never has.
 *
 * Precedence (`resolveSectorWeather`): a clan that HOLDS the sector and has
 * stamped a weather on the territory record overrides the schedule; otherwise
 * the schedule applies. Unknown biomes fall back to "clear".
 *
 * The modifier VALUES (+5% / −2%) live in the combat engines (client
 * data/world.ts `weatherEffects`, api/combat-core/formulas.ts
 * `weatherMultiplier`); this module only decides WHICH weather is up. The
 * per-biome tables below are likewise untouched — they are the CLIMATE, and the
 * chain only changes the order and the dwell time, never which skies a biome has.
 */

import { WORLD_DAY_MS } from './world-clock.js';

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

/** Weather windows per in-world day — FFXIV's three (every eight world hours). */
export const WEATHER_WINDOWS_PER_DAY = 3;

/** How long one sky lasts, in real ms: 40 minutes at a 2-hour world day. */
export const WEATHER_WINDOW_MS = WORLD_DAY_MS / WEATHER_WINDOWS_PER_DAY;

/**
 * How many windows the Markov chain replays before it can answer. Longer means
 * a rarer re-seed seam and a slightly dearer query; 72 windows is two real days
 * of world, replayed in at most 71 integer mixes.
 */
export const WEATHER_BLOCK_WINDOWS = 72;

/**
 * The weather window a ms timestamp falls in — the unit weather rotates on.
 * Successive windows are adjacent integers, which is what lets the chain step.
 */
export function weatherWindowAt(nowMs: number): number {
    const n = Number(nowMs);
    return Number.isFinite(n) ? Math.floor(n / WEATHER_WINDOW_MS) : 0;
}

/** Real ms at which a given weather window opens. Pure; the inverse of the above. */
export function weatherWindowStartMs(window: number): number {
    const w = Number.isFinite(window) ? Math.floor(window) : 0;
    return w * WEATHER_WINDOW_MS;
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
 * How settled each sky is, on a calm → severe ladder. A change may only move
 * ONE rung, which is what stops clear → tornado → clear: a storm has to build
 * through the middle of the ladder and break back down through it.
 *
 * These are weather ADJACENCY, not weather strength — they say nothing about
 * the combat modifier, which is flat ±5% / −2% for every non-clear sky alike
 * (WEATHER_ELEMENTS, and the engines that read it). A sector's climate table
 * still decides which of these it can ever show.
 */
const WEATHER_SEVERITY: Readonly<Record<SectorWeather, number>> = Object.freeze({
    clear: 0,
    desertHaze: 1,
    rain: 1,
    ashfall: 1,
    tornado: 2,
    thunderstorm: 2,
});

/**
 * Chance in 256 that a window holds the previous sky OUTRIGHT, before the
 * severity rule gets a say. It is not the whole hold rate: a proposal rejected
 * for jumping too far also holds, and how often that happens depends on the
 * biome's table, so the realised rate lands higher and differs per biome.
 *
 * Tuned against the measured mean front rather than by feel. At 140 the fronts
 * ran 2-3 real HOURS, which is a forecast nobody needs; at 64 they run roughly
 * 70-105 real minutes across the five biomes — a sky holds for about a session,
 * so checking what is coming is worth doing and a bad sky is never a whole
 * evening. `sector-weather.test.ts` pins that range so a retune here cannot
 * quietly turn the weather back into a label.
 */
const WEATHER_HOLD_IN_256 = 64;

/** Deterministic 0..255 draw for one (sector, window, salt) — the chain's dice. */
function roll(sector: number, window: number, salt: number): number {
    return mix32((sector * 0x9e3779b1) ^ mix32(window * 0x85ebca6b + salt)) & 0xff;
}

/** The chain's opening draw for a block: straight from the biome's climate table. */
function seedWeather(biome: SectorWeatherBiome, sector: number, window: number): SectorWeather {
    const table = biomeWeatherTables[biome];
    return table[roll(sector, window, BIOME_SALT[biome]) % table.length] ?? 'clear';
}

/**
 * One step of the chain: propose a sky from the biome's climate table, and take
 * it only if it is within one rung of the current one. A rejected proposal HOLDS
 * — the front simply lasts another window.
 *
 * Propose-and-reject rather than "pick among the adjacent skies", because the
 * two are not the same distribution and the difference is not cosmetic. Picking
 * among adjacent skies makes a mid-ladder sky a hub every path has to cross, and
 * strands a sky that only one other can reach. Measured on the real tables, that
 * pushed the shadow biome's `clear` from the authored 25% down to 13% while
 * desertHaze rose to 38% — a table nobody edited, quietly rebalanced. Since
 * weather carries a combat modifier, that is a balance change by accident.
 *
 * Proposing from the climate table instead makes the authored frequencies the
 * chain's stationary distribution EXACTLY. The proposal does not depend on the
 * current sky, and a pair is either mutually adjacent or mutually not, so the
 * accept rule is symmetric and detailed balance holds against the table's own
 * weights. `sector-weather.test.ts` measures it rather than taking that on
 * trust. The repeats in a table are its weights (forest lists rain twice), so
 * they are deliberately not de-duplicated here.
 */
function stepWeather(biome: SectorWeatherBiome, sector: number, window: number, current: SectorWeather): SectorWeather {
    if (roll(sector, window, BIOME_SALT[biome] + 0x51) < WEATHER_HOLD_IN_256) return current;
    const table = biomeWeatherTables[biome];
    const candidate = table[roll(sector, window, BIOME_SALT[biome] + 0xa7) % table.length];
    if (candidate === undefined || candidate === current) return current;
    const step = Math.abs((WEATHER_SEVERITY[candidate] ?? 0) - (WEATHER_SEVERITY[current] ?? 0));
    return step <= 1 ? candidate : current;
}

/**
 * The scheduled weather for a sector in a weather window, ignoring any clan
 * override. Pure: same (biome, sector, window) → same weather on every machine,
 * with no stored state — the chain is replayed from the block anchor each call
 * (see the module header).
 */
export function scheduledSectorWeather(biome: unknown, sector: number, window: number): SectorWeather {
    if (!isKnownBiome(biome)) return 'clear';
    const table = biomeWeatherTables[biome];
    if (table.length === 0) return 'clear';
    const s = Number.isFinite(sector) ? Math.floor(sector) : 0;
    const target = Number.isFinite(window) ? Math.floor(window) : 0;
    const anchor = Math.floor(target / WEATHER_BLOCK_WINDOWS) * WEATHER_BLOCK_WINDOWS;
    let weather = seedWeather(biome, s, anchor);
    for (let w = anchor + 1; w <= target; w++) weather = stepWeather(biome, s, w, weather);
    return weather;
}

/** One entry of a forecast: the sky, and the real window it holds for. */
export type SectorForecastEntry = {
    weather: SectorWeather;
    /** Real ms this sky starts at (the current one may have started earlier). */
    startsAt: number;
    /** Real ms it gives way to the next. */
    endsAt: number;
    /** True when a holding clan has stamped this sky rather than the schedule. */
    stamped: boolean;
};

/**
 * The sky now and for the next few windows, so the UI can say "rain, turning to
 * thunder in 18m" instead of only naming today's label. Same inputs and same
 * precedence as `resolveSectorWeather`, so the first entry always equals it.
 *
 * A clan's stamped sky has no schedule to forecast — it holds until the clan
 * changes it or loses the sector — so it comes back as a single `stamped` entry
 * and callers render it as a standing condition, not a countdown to a lie.
 */
export function sectorForecast(
    biome: unknown,
    sector: number,
    nowMs: number,
    count = 3,
    territory?: SectorWeatherOverride,
): SectorForecastEntry[] {
    const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : 0;
    const stampedWeather = stampedSectorWeather(territory, now);
    const window = weatherWindowAt(now);
    if (stampedWeather) {
        return [{ weather: stampedWeather, startsAt: weatherWindowStartMs(window), endsAt: Number.POSITIVE_INFINITY, stamped: true }];
    }
    const wanted = Math.max(1, Math.min(24, Math.floor(Number(count)) || 1));
    const out: SectorForecastEntry[] = [];
    for (let i = 0; i < wanted; i++) {
        const w = window + i;
        out.push({
            weather: scheduledSectorWeather(biome, sector, w),
            startsAt: weatherWindowStartMs(w),
            endsAt: weatherWindowStartMs(w + 1),
            stamped: false,
        });
    }
    return out;
}

export const TERRITORY_BREACH_DURATION_MS = 12 * 60 * 60 * 1_000;

/**
 * A holding clan's stamped weather is a COMBAT MODIFIER (see WEATHER_ELEMENTS),
 * and the clan picks it to favour its own element — so the lifecycle fields are
 * part of this override, not decoration. A breached or dormant holding must
 * stop supplying weather, exactly as it already stops supplying the terrain
 * buff, or a clan that has lost its garrison keeps fighting at home advantage
 * while the UI on the same screen reads "Rewards and bonuses suspended".
 */
export type SectorWeatherOverride = {
    ownerClan?: unknown;
    weather?: unknown;
    breachedAt?: unknown;
    breachEndsAt?: unknown;
    hp?: unknown;
    rewardSuspendedAt?: unknown;
} | null | undefined;

function finiteTimestamp(value: unknown): number | undefined {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function territoryBreachDeadlineOf(row: SectorWeatherOverride): number | undefined {
    const startedAt = finiteTimestamp(row?.breachedAt);
    if (!startedAt) return undefined;
    return finiteTimestamp(row?.breachEndsAt) ?? startedAt + TERRITORY_BREACH_DURATION_MS;
}

/** Canonical: api/_territory-lifecycle.ts re-exports these so the server and the
 *  sealed-fight resolver cannot drift apart on what "suspended" means. */
export function territoryIsBreachedRow(row: SectorWeatherOverride, now: number): boolean {
    if (!row?.ownerClan || !finiteTimestamp(row?.breachedAt)) return false;
    const deadline = territoryBreachDeadlineOf(row);
    return !!deadline && (now < deadline || Math.max(0, Number(row?.hp) || 0) <= 0);
}

/** Benefits are suspended during a breach and after verified clan inactivity. */
export function territoryRewardsSuspendedRow(row: SectorWeatherOverride, now: number): boolean {
    return territoryIsBreachedRow(row, now) || !!finiteTimestamp(row?.rewardSuspendedAt);
}

function isWeather(w: unknown): w is SectorWeather {
    return typeof w === 'string' && Object.prototype.hasOwnProperty.call(WEATHER_ELEMENTS, w);
}

/**
 * The sky a holding clan has stamped on this sector, or null when the schedule
 * applies. The ONE place the override's precedence is decided, so
 * `resolveSectorWeather` and `sectorForecast` cannot disagree about whose sky it
 * is — a forecast that counted down a change the resolver was never going to
 * make would be worse than no forecast.
 */
function stampedSectorWeather(territory: SectorWeatherOverride, nowMs: number): SectorWeather | null {
    const ownerClan = String(territory?.ownerClan ?? '').trim();
    if (!ownerClan || !isWeather(territory?.weather)) return null;
    return territoryRewardsSuspendedRow(territory, nowMs) ? null : territory.weather;
}

/**
 * The weather a sector shows RIGHT NOW: a holding clan's stamped weather wins,
 * otherwise this window's scheduled weather. `nowMs` must come from the server
 * clock on both sides (client `serverNow()`, server `Date.now()`).
 */
export function resolveSectorWeather(biome: unknown, sector: number, nowMs: number, territory?: SectorWeatherOverride): SectorWeather {
    return stampedSectorWeather(territory, nowMs)
        ?? scheduledSectorWeather(biome, sector, weatherWindowAt(nowMs));
}

/** Elements the given weather boosts / dampens — '' for none. */
export function sectorWeatherElements(weather: SectorWeather): { positiveElement: string; negativeElement: string } {
    return WEATHER_ELEMENTS[weather] ?? WEATHER_ELEMENTS.clear;
}

/**
 * The inverse: which weather a sealed element pair came from.
 *
 * A fight seals the ELEMENTS, not the weather's name (api/pvp/session.ts), so a
 * screen that wants to NAME the sealed sky has to come back through here. Doing
 * it any other way means naming the weather the client happens to be holding,
 * which is a different sky whenever a window turned between walking into the
 * sector and starting the fight — 40 real minutes now, not 24 hours.
 *
 * Every pair in WEATHER_ELEMENTS is distinct, so this is a true inverse; an
 * unrecognised pair falls back to 'clear' rather than guessing.
 */
export function weatherFromElements(positiveElement: unknown, negativeElement: unknown): SectorWeather {
    const pos = String(positiveElement ?? '');
    const neg = String(negativeElement ?? '');
    for (const [weather, pair] of Object.entries(WEATHER_ELEMENTS) as [SectorWeather, { positiveElement: string; negativeElement: string }][]) {
        if (pair.positiveElement === pos && pair.negativeElement === neg) return weather;
    }
    return 'clear';
}
