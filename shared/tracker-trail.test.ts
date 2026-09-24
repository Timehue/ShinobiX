import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanTrackerTrail, trackerTrailNextSector, trackerTrailSectors } from './tracker-trail.js';
import { sectorExits, NON_WALKABLE_SECTORS } from './sector-links.js';
import { PLAYABLE_WILD_SECTOR_IDS } from './sector-geo.js';

const roadLinked = (a: number, b: number) => sectorExits(a).some((exit) => exit.destinationSector === b);

describe('tracker trail route', () => {
    it('follows real roads from every playable sector and never loops back', () => {
        for (const origin of PLAYABLE_WILD_SECTOR_IDS) {
            if (NON_WALKABLE_SECTORS.includes(origin)) continue;
            for (const id of ['trail-w-1-2-0-100', 'trail-w-9-7-1-200', 'trail-w-40-3-0-300']) {
                const [first, second] = trackerTrailSectors(id, origin);
                assert.notEqual(first, origin, `${id} from ${origin}`);
                assert.notEqual(second, origin, `${id} from ${origin}`);
                assert.notEqual(second, first, `${id} from ${origin}`);
                assert.ok(PLAYABLE_WILD_SECTOR_IDS.includes(first) && PLAYABLE_WILD_SECTOR_IDS.includes(second));
                assert.ok(!NON_WALKABLE_SECTORS.includes(first) && !NON_WALKABLE_SECTORS.includes(second));
                assert.ok(roadLinked(origin, first), `${origin} -> ${first} is a road`);
                assert.ok(roadLinked(first, second), `${first} -> ${second} is a road`);
            }
        }
    });

    it('is deterministic for the same trail and origin', () => {
        assert.deepEqual(trackerTrailSectors('trail-w-12-5-0-999', 12), trackerTrailSectors('trail-w-12-5-0-999', 12));
    });

    it('points at the tracks sector first, then the pet sector', () => {
        assert.equal(trackerTrailNextSector({ sectors: [3, 4], step: 0 }), 3);
        assert.equal(trackerTrailNextSector({ sectors: [3, 4], step: 1 }), 4);
    });

    it('sanitises stored rows and rejects malformed ones', () => {
        const good = {
            id: 'trail-w-1-2-0-100', requestId: 'trk_abcdef0123456789', giver: 'Ibo the Tracker',
            originSector: 1, sectors: [7, 8], step: 0, expiresAt: 1_000,
        };
        assert.deepEqual(cleanTrackerTrail(good), good);
        assert.equal(cleanTrackerTrail({ ...good, sectors: [7, 99] }), null);
        assert.equal(cleanTrackerTrail({ ...good, step: 2 }), null);
        assert.equal(cleanTrackerTrail({ ...good, id: 'favor-1' }), null);
        assert.equal(cleanTrackerTrail({ ...good, requestId: 'x' }), null);
        assert.equal(cleanTrackerTrail(null), null);
    });
});
