import { sectorExits } from '../../../shared/sector-links';
import { sectorName } from '../../../shared/sector-geo';

/** A readout of the existing gates; travel still belongs to the map controls. */
export function SectorRoutes({ sector, className = '' }: { sector: number; className?: string }) {
    const exits = sectorExits(sector);
    return <section className={`sector-routes ${className}`} aria-label="Sector exits">
        <strong>Paths from here</strong>
        {exits.length ? <ul>{exits.map(exit => <li key={exit.id}>
            <span>{exit.direction}</span><b>{sectorName(exit.destinationSector) ?? `Sector ${exit.destinationSector}`}</b>
        </li>)}</ul> : <p>No walking exits.</p>}
    </section>;
}
