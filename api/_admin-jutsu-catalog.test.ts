import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildAdminJutsuCatalog } from './_admin-jutsu-catalog.js';

describe('buildAdminJutsuCatalog', () => {
    it('keys authored jutsu from both admin slots by id', () => {
        const catalog = buildAdminJutsuCatalog([
            { creatorJutsus: [{ id: 'starter-universal-blitz', name: 'Overload', effectPower: 40 }] },
            { creatorJutsus: [{ id: 'custom-moon-thread', name: 'Moon Thread' }] },
        ]);
        assert.deepEqual([...catalog.keys()].sort(), ['custom-moon-thread', 'starter-universal-blitz']);
        assert.equal(catalog.get('starter-universal-blitz')?.name, 'Overload');
    });

    it('preserves authored balance values verbatim', () => {
        const authored = { id: 'a', effectPower: 47, ap: 60, tags: [{ name: 'Wound', percent: 30 }] };
        const catalog = buildAdminJutsuCatalog([{ creatorJutsus: [authored] }]);
        assert.deepEqual(catalog.get('a'), authored);
    });

    it('lets the later slot win an id collision (Admin 2 over Admin 1)', () => {
        const catalog = buildAdminJutsuCatalog([
            { creatorJutsus: [{ id: 'dup', name: 'First' }] },
            { creatorJutsus: [{ id: 'dup', name: 'Second' }] },
        ]);
        assert.equal(catalog.get('dup')?.name, 'Second');
    });

    it('skips malformed entries and missing/absent records', () => {
        const catalog = buildAdminJutsuCatalog([
            null,
            undefined,
            {},
            { creatorJutsus: 'not-an-array' },
            { creatorJutsus: [null, 42, [], { name: 'no id' }, { id: '   ' }, { id: 'x'.repeat(200) }, { id: '  ok  ', name: 'Trimmed' }] },
        ]);
        assert.deepEqual([...catalog.keys()], ['ok']);
        assert.equal(catalog.get('ok')?.name, 'Trimmed');
    });
});
