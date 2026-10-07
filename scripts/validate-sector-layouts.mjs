import assert from 'node:assert/strict';
import { pathInMask, tileNeighbors } from '../shared/sector-walk-mask.ts';
import { SECTOR_PLACES } from '../shared/sector-geo.ts';
import { sectorExits } from '../shared/sector-links.ts';
import { shrineForSector } from '../shared/shrines.ts';
import { HOME_SECTORS } from '../shinobij.client/src/data/war-map-sectors.ts';
import { sectorRoadRoutes } from './sector-road-routes.mjs';

/** Validate the geometry that will actually accompany each floor painting. */
export function validateSectorLayouts(layouts) {
    const places = SECTOR_PLACES.filter(p => ![54, 99].includes(p.id));
    assert.equal(Object.keys(layouts).filter(key => Number(key) !== 99).length, places.length);
    if (layouts[99]) validateSpecialSectorLayout(layouts[99]);
    const signatures = new Set();
    for (const place of places) {
        const l = layouts[place.artKey];
        assert.ok(l, `Missing ${place.id}`);
        assert.equal(l.sector, place.id); assert.equal(l.biome, place.biome);
        assert.equal(l.mask.length, 12);
        l.mask.forEach(row => assert.match(row, /^[.=~#TB]{12}$/));
        const mask = l.mask.join(''), open = [...mask].flatMap((c, n) => '.='.includes(c) ? [n] : []);
        const blocked = 144 - open.length;
        assert.ok(blocked >= 14 && blocked <= 43, `Sector ${place.id}: ${blocked} blocked`);
        assert.ok(!signatures.has(mask), `Duplicated sector ${place.id}`); signatures.add(mask);
        for (const n of open) assert.ok(pathInMask(l.mask, open[0], n), `Disconnected ${place.id}:${n}`);
        const exits = sectorExits(place.id);
        for (const e of exits) assert.ok(open.includes(e.tile), `Closed exit ${e.id}`);
        for (const p of places) for (const e of sectorExits(p.id)) if (e.destinationSector === place.id)
            assert.ok(open.includes(e.destinationTile), `Blocked arrival ${p.id}->${place.id}`);
        const border = Array.from({ length: 144 }, (_, n) => n).filter(n => n < 12 || n >= 132 || n % 12 === 0 || n % 12 === 11);
        assert.ok(border.filter(n => !'.='.includes(mask[n])).length >= Math.ceil((44 - exits.length) / 2), `Open border ${place.id}`);
        for (const [kind, site] of Object.entries(l.sites)) {
            const [x, y, size] = site.footprint;
            assert.equal(site.left, (x + size / 2) / 12 * 100);
            assert.equal(site.top, (y + size) / 12 * 100);
            for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++)
                assert.ok(kind === 'rift' ? '.='.includes(mask[(y + dy) * 12 + x + dx]) : mask[(y + dy) * 12 + x + dx] === 'B', `Invalid ${kind} footprint in ${place.id}`);
            assert.ok(open.includes(site.approach), `Closed ${kind} approach ${place.id}`);
        }
        assert.equal(!!l.sites.stronghold, !l.village && Object.values(HOME_SECTORS).some(ids => ids.includes(place.id)), `Invented or missing stronghold ${place.id}`);
        assert.equal(!!l.sites.shrine, !!shrineForSector(place.id), `Invented or missing shrine ${place.id}`);
        const roadEnds = new Set([...exits.map(e => e.tile),
            ...Object.entries(l.sites).filter(([kind]) => kind !== 'rift').map(([, s]) => s.approach),
            ...(l.village ? [l.village.approach] : [])]);
        const paintedRoad = new Set(sectorRoadRoutes(l).flat());
        assert.deepEqual([...mask].flatMap((c, n) => c === '=' ? [n] : []), [...paintedRoad].sort((a, b) => a - b), `Unpainted or purposeless road ${place.id}`);
        for (let n = 0; n < 144; n++) if (mask[n] === '=' && !roadEnds.has(n))
            assert.ok(tileNeighbors(n).filter(t => mask[t] === '=').length > 1, `Road to nowhere ${place.id}:${n}`);
        if (l.village) { assert.equal(l.village.left, 50); assert.equal(l.village.top, 50); assert.ok(open.includes(l.village.approach)); }
        if (l.hydrology) {
            const water = [...l.hydrology.waterTiles, ...l.hydrology.bridgeTiles];
            assert.ok(l.hydrology.waterTiles.length >= 4, `Tiny water pit ${place.id}`);
            const seen = new Set([water[0]]), queue = [water[0]], union = new Set(water);
            for (const n of queue) for (const next of tileNeighbors(n)) if (union.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
            assert.equal(seen.size, union.size, `Scattered water in ${place.id}`);
            assert.deepEqual([...mask].flatMap((c, n) => c === '~' ? [n] : []), [...l.hydrology.waterTiles].sort((a, b) => a - b));
            for (const n of l.hydrology.bridgeTiles) assert.equal(mask[n], '=');
        } else assert.ok(!mask.includes('~'));
    }
    return places.length;
}

/** Death's Gate is a map-travel arena, with an interior court rather than roads. */
export function validateSpecialSectorLayout(layout) {
    assert.equal(layout.sector, 99); assert.equal(layout.artKey, 99);
    assert.equal(layout.biome, 'volcano'); assert.equal(layout.bakedLandmarks, true);
    assert.deepEqual(layout.exits, []); assert.deepEqual(sectorExits(99), []);
    assert.equal(layout.mask.length, 12);
    layout.mask.forEach(row => assert.match(row, /^[.=~#B]{12}$/));
    const mask = layout.mask.join(''), open = [...mask].flatMap((c, t) => '.='.includes(c) ? [t] : []);
    assert(144 - open.length >= 15 && 144 - open.length <= 43);
    const border = [...mask].flatMap((c, t) => (t < 12 || t >= 132 || t % 12 === 0 || t % 12 === 11) && !'.='.includes(c) ? [t] : []);
    assert(border.length >= 22);
    for (const t of open) assert(pathInMask(layout.mask, open[0], t), `Disconnected arena ground ${t}`);
    assert.deepEqual(Object.keys(layout.sites), ['stronghold']);
    const site = layout.sites.stronghold, [x, y, n] = site.footprint;
    assert.equal(n, 3); assert(Math.abs(site.left - (x + n / 2) / 12 * 100) < 1e-9);
    assert(Math.abs(site.top - (y + n) / 12 * 100) < 1e-9); assert.equal(site.width, n / 12 * 100);
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) assert.equal(layout.mask[y + dy]?.[x + dx], 'B');
    assert.equal([...mask].filter(c => c === 'B').length, 9); assert(open.includes(site.approach));
    const lava = [...mask].flatMap((c, t) => c === '~' ? [t] : []), seen = new Set([lava[0]]), queue = [lava[0]];
    assert(lava.length >= 4);
    for (const t of queue) for (const next of tileNeighbors(t)) if (lava.includes(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
    assert.equal(seen.size, lava.length, 'Arena lava must form one continuous channel');
    return 1;
}
