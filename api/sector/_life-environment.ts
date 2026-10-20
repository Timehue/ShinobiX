import { sectorBiomeOf } from '../../shared/sector-geo.js';
import { resolveSectorWeather,type SectorWeatherOverride } from '../../shared/sector-weather.js';
import { shrineTier } from '../../shared/shrines.js';
import { parseShrineCare } from '../../shared/sector-life-memory.js';
import type { LifeEventState } from '../../shared/sector-life.js';
import { parseShrineState } from './_traces.js';

/** The visible scene and battle-start observers use the same world inputs. */
export function lifeEnvironment(sector:number,state:LifeEventState,now:number,territory:SectorWeatherOverride|null,offerings:unknown) {
    const offering=parseShrineState(offerings);
    return {weather:resolveSectorWeather(sectorBiomeOf(sector),sector,now,territory??undefined),
        memory:{tier:shrineTier(offering.total),supportStartedAt:offering.kindledAt,...parseShrineCare(state.care,now)}};
}
