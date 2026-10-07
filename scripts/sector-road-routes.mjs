import { pathInMask } from '../shared/sector-walk-mask.ts';

/** Paint only routes joining real destinations; a construction hub is not one. */
export function sectorRoadRoutes(layout) {
    // The arena court is reached through map travel; it has no overworld roads.
    if (layout.sector === 99 && layout.exits.length === 0) return [];
    const root = layout.village?.approach ?? layout.exits[0].tile;
    const mask = layout.mask.map(row => row.replace(/\./g, '#'));
    const endpoints = [...layout.exits.map(e => e.tile),
        ...Object.entries(layout.sites).filter(([kind]) => kind !== 'rift').map(([, s]) => s.approach)];
    return endpoints.map(endpoint => {
        const route = pathInMask(mask, endpoint, root);
        if (!route) throw new Error(`Disconnected road destination ${layout.sector}:${endpoint}`);
        return route;
    });
}
