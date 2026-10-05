/*
 * The sky over the wild sector a fight is fought on, as the sealed weather
 * terms of that fight — or nothing, off the wild map.
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
 * Sealed once at the start: a window turning under a live fight does not move
 * its damage terms, exactly as PvP seals it. A sealed clear sky is empty
 * strings, not absent fields, so the client can tell "sealed clear" from
 * "nothing sealed" (shinobij.client/src/lib/combat-presentation.ts).
 */
import { kv } from './_storage.js';
import { resolveSectorWeather, sectorWeatherElements } from '../shared/sector-weather.js';
import { isWildSector, sectorBiomeOf } from '../shared/sector-geo.js';
import type { SoloPveEnvironment } from './solo-pve/_session.js';

export type SealedSectorWeather = Pick<SoloPveEnvironment, 'weatherPositiveElement' | 'weatherNegativeElement'>;

export async function sealedSectorWeather(sector: unknown, now: number): Promise<SealedSectorWeather> {
    const wild = Math.floor(Number(sector));
    if (!isWildSector(wild)) return {};
    let territory: Record<string, unknown> | null = null;
    try { territory = await kv.get<Record<string, unknown>>(`world:territory:${wild}`); }
    catch { /* A missing territory read keeps the scheduled sector weather. */ }
    const elements = sectorWeatherElements(resolveSectorWeather(sectorBiomeOf(wild), wild, now, territory));
    return { weatherPositiveElement: elements.positiveElement, weatherNegativeElement: elements.negativeElement };
}
