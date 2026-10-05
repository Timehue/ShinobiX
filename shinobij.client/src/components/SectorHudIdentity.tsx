import { sectorName } from '../../../shared/sector-geo';
import { sectorRegionName } from '../data/sectors';
import type { Biome } from '../types/core';
import { SectorSkyForecast } from './SectorSkyForecast';

export function SectorHudIdentity({ sector, present, biome }: {
    sector: number; present: boolean; biome: Biome;
}) {
    return <header className="sector-hud-identity">
        <div className="sector-hud-heading">
            <span className="sector-hud-region">Sector {sector} · {sectorRegionName(sector)}</span>
            <strong>{sectorName(sector) ?? `Sector ${sector}`}</strong>
        </div>
        <div className="sector-hud-location">
            <b>{present ? 'Present' : 'Scouting · read only'}</b>
            <span className="sector-hud-weather"><small>Weather</small><span>
                <SectorSkyForecast sector={sector} biome={biome} /></span></span>
        </div>
        <span className="sector-hud-help-slot" aria-hidden="true" />
    </header>;
}
