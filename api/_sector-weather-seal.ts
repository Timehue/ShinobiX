/*
 * The sky over the sector a fight is fought on, as the sealed weather terms of
 * that fight — or nothing, off both maps.
 *
 * The same shared schedule the sector plate names and that missions, PvP and
 * wild-pet encounters already seal (shared/sector-weather: the sector's real
 * biome, its weather window, a holding clan's stamp first), fed the SERVER
 * clock, so a client cannot wait for or claim a favourable sky. Until this was
 * sealed, wanderers, patrols, hunts, exploration, raid, sector-war garrison,
 * ANBU vault and stronghold patrol fights ignored the weather the plate
 * advertised while the board still drew its rain.
 *
 * The biome is always the SECTOR's (sectorBiomeOf), never a fight's board
 * biome: a garrison or vault fight is fought on the defender's chosen terrain,
 * but the sky above it is the sector's, exactly as a human sector-war duel's
 * is (api/pvp/session.ts seals the sky before the terrain is applied).
 *
 * The Unmapped Coast has weather too (owner, 2026-11-21, "Yes, add both"). It
 * is the same schedule read with the coast's own ground (coastBiomeOf), and the
 * clan that holds a sector there can fix its sky as a clan could on the home
 * map (api/coast/_land.ts setCoastClaimWeather). Until then a coast fight
 * sealed no weather at all.
 *
 * Sealed once at the start: a window turning under a live fight does not move
 * its damage terms, exactly as PvP seals it. A sealed clear sky is empty
 * strings, not absent fields, so the client can tell "sealed clear" from
 * "nothing sealed" (shinobij.client/src/lib/combat-presentation.ts).
 */
import { kv } from './_storage.js';
import { resolveSectorWeather, sectorWeatherElements, type SectorWeather, type SectorWeatherOverride } from '../shared/sector-weather.js';
import { isWildSector, sectorBiomeOf } from '../shared/sector-geo.js';
import { coastBiomeOf } from '../shared/coast-world.js';
import { coastWeatherStamp } from './coast/_land.js';
import type { SoloPveEnvironment } from './solo-pve/_session.js';

export type SealedSectorWeather = Pick<SoloPveEnvironment, 'weatherPositiveElement' | 'weatherNegativeElement'>;

/**
 * The weather over a sector right now, or null where there is none to name (a village, a sector on neither map).
 *
 * `stamped: false` reads the schedule alone and ignores a holding clan's fixed sky. It is for a fight whose
 * sector the server has only been TOLD: a clan fixes its sky to favour its own element, so that sky is sealed
 * only where the server itself placed the fight (a world fight's settled sector, an exploration receipt, a
 * proven world attack). The schedule is the same for everyone, so it needs no such proof.
 */
export async function sectorWeatherNow(sector: unknown, now: number, options: { stamped?: boolean } = {}): Promise<SectorWeather | null> {
    const id = Math.floor(Number(sector));
    const stamped = options.stamped !== false;
    if (isWildSector(id)) {
        let territory: SectorWeatherOverride = null;
        if (stamped) {
            try { territory = await kv.get<Record<string, unknown>>(`world:territory:${id}`); }
            catch { /* A missing territory read keeps the scheduled sector weather. */ }
        }
        return resolveSectorWeather(sectorBiomeOf(id), id, now, territory);
    }
    const coastBiome = coastBiomeOf(id);
    if (!coastBiome) return null;
    // A claim that cannot be read keeps the scheduled sky, as a territory row that cannot be read does.
    const stamp = stamped ? await coastWeatherStamp(id).catch(() => null) : null;
    return resolveSectorWeather(coastBiome, id, now, stamp);
}

export async function sealedSectorWeather(sector: unknown, now: number, options: { stamped?: boolean } = {}): Promise<SealedSectorWeather> {
    const weather = await sectorWeatherNow(sector, now, options);
    if (!weather) return {};
    const elements = sectorWeatherElements(weather);
    return { weatherPositiveElement: elements.positiveElement, weatherNegativeElement: elements.negativeElement };
}
