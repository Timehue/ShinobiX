import type { ReactNode } from "react";
import { sectorName } from '../../../shared/sector-geo';
import { sectorRegionName } from '../data/sectors';
import type { Biome } from '../types/core';
import { SectorSkyForecast } from './SectorSkyForecast';

export function SectorHudIdentity({ sector, present, biome, region, name, weather }: {
    sector: number; present: boolean; biome: Biome; region?: string; name?: string; weather?: ReactNode;
}) {
    return <header className="sector-hud-identity">
        <div className="sector-hud-heading">
            <span className="sector-hud-region">Sector {sector} · {region ?? sectorRegionName(sector)}</span>
            <strong>{name ?? sectorName(sector) ?? `Sector ${sector}`}</strong>
        </div>
        <div className="sector-hud-location">
            <b>{present ? 'Present' : 'Scouting · read only'}</b>
            <span className="sector-hud-weather"><small>Weather</small><span>
                {weather ?? <SectorSkyForecast sector={sector} biome={biome} />}</span></span>
        </div>
        <span className="sector-hud-help-slot" aria-hidden="true" />
    </header>;
}
