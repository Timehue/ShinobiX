import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { isLegacyJutsuId, LEGACY_JUTSU_ID_PREFIX } from './legacy-jutsu-id.js';
import { LEGACY_JUTSU_DEFS } from '../data/legacy-jutsu.js';
import { starterJutsus } from '../data/jutsu.js';

/*
 * The entry chunk's isLegacyJutsuId is a PREFIX test so lib/jutsu-scaling can
 * avoid importing the ~53 KB signature table (see lib/legacy-jutsu-id.ts).
 * A prefix test is only correct while the prefix is EXACT — these pins hold
 * both directions against the real data, so the cheap test can never drift
 * from table membership.
 */
describe('legacy-jutsu-id: prefix test ≡ table membership', () => {
    it('every signature in the table matches the prefix test', () => {
        assert.ok(LEGACY_JUTSU_DEFS.length >= 100, `expected the full roster, got ${LEGACY_JUTSU_DEFS.length}`);
        for (const def of LEGACY_JUTSU_DEFS) {
            assert.ok(def.jutsu.id.startsWith(LEGACY_JUTSU_ID_PREFIX), `${def.jutsu.id} lacks the ${LEGACY_JUTSU_ID_PREFIX} prefix`);
            assert.ok(isLegacyJutsuId(def.jutsu.id), `isLegacyJutsuId rejected ${def.jutsu.id}`);
        }
    });

    it('no base-game jutsu id collides with the prefix', () => {
        for (const j of starterJutsus) {
            assert.ok(!isLegacyJutsuId(j.id), `base jutsu ${j.id} would be mistaken for a legacy signature`);
        }
    });

    it('rejects non-legacy shapes', () => {
        for (const id of ['starter-fire-1', 'cj-custom', '', 'LEGACY-shout', 'my-legacy-thing']) {
            assert.equal(isLegacyJutsuId(id), false, id);
        }
    });
});
