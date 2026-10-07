import { SECTOR_PLACES } from '../shared/sector-geo.ts';
import { SECTOR_EXITS } from '../shared/sector-links.ts';

/** Both ends of a road receive the same material and lane contract. */
export function sectorSeamContracts(sector) {
    const place = id => SECTOR_PLACES.find(p => p.id === id);
    return SECTOR_EXITS.filter(e => e.sector === sector).map(e => {
        const a = place(e.sector), b = place(e.destinationSector);
        const regions = [a.biome === 'volcano' ? 'lavafront' : a.region,
            b.biome === 'volcano' ? 'lavafront' : b.region].sort();
        return { road: [e.sector, e.destinationSector].sort((x, y) => x - y).join('-'),
            direction: e.direction, tile: e.tile, destination: e.destinationSector,
            destinationTile: e.destinationTile, lane: ['north', 'south'].includes(e.direction) ? e.tile % 12 : Math.floor(e.tile / 12),
            width: 100 / 12, surface: 'worn neutral warm-grey stone slabs with muted tan grit, flat and flush with the terrain',
            regions, transition: regions[0] !== regions[1] };
    });
}
