import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildAdminEventCatalog } from './_admin-event-catalog.js';

/*
 * The event catalog decides which authored row a pet encounter is rebuilt from,
 * so it has to merge in the SAME order the client does — admin1, admin2, then
 * canonical published content, later source winning. A different precedence
 * here would field an opponent from a version of the scene the player is not
 * reading.
 */
describe('admin event catalog', () => {
    it('matches the client later-source-wins merge and canonical precedence', () => {
        const catalog = buildAdminEventCatalog([
            { creatorEvents: [{ id: 'relic-of-ash', name: 'Admin 1' }] },
            { creatorEvents: [{ id: 'relic-of-ash', name: 'Admin 2' }, { id: 'road-scribe', name: 'Scribe' }] },
            { creatorEvents: [{ id: 'relic-of-ash', name: 'Published' }] },
        ]);
        assert.equal(catalog.get('relic-of-ash')?.name, 'Published');
        assert.equal(catalog.get('road-scribe')?.name, 'Scribe');
    });

    it('rejects malformed ids and non-object entries', () => {
        const catalog = buildAdminEventCatalog([
            { creatorEvents: [null, 'bad', { id: 'has spaces' }, { id: 'good-event', name: 'Good' }] },
        ]);
        assert.deepEqual([...catalog.keys()], ['good-event']);
    });

    it('survives a record with no authored events at all', () => {
        assert.equal(buildAdminEventCatalog([null, undefined, {}, { creatorEvents: 'nope' }]).size, 0);
    });
});
