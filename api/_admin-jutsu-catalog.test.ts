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

    it('lets the later slot win an id collision when neither carries updatedAt', () => {
        const catalog = buildAdminJutsuCatalog([
            { creatorJutsus: [{ id: 'dup', name: 'First' }] },
            { creatorJutsus: [{ id: 'dup', name: 'Second' }] },
        ]);
        assert.equal(catalog.get('dup')?.name, 'Second');
    });

    // Live data: starter-universal-blitz is the edited "Overload" (ap 40, stamped)
    // on save:admin1 and a stale "Blitz" (ap 60, unstamped) on save:admin2. The
    // client resolves this by updatedAt (mergeJutsusByRecency), so slot order alone
    // would make the server fight with a different jutsu than the player sees.
    it('keeps the more recently edited entry when an earlier slot is newer', () => {
        const catalog = buildAdminJutsuCatalog([
            { creatorJutsus: [{ id: 'starter-universal-blitz', name: 'Overload', ap: 40, updatedAt: 1781240366994 }] },
            { creatorJutsus: [{ id: 'starter-universal-blitz', name: 'Blitz', ap: 60 }] },
        ]);
        assert.equal(catalog.get('starter-universal-blitz')?.name, 'Overload');
        assert.equal(catalog.get('starter-universal-blitz')?.ap, 40);
    });

    it('still takes the later slot when it is the newer edit', () => {
        const catalog = buildAdminJutsuCatalog([
            { creatorJutsus: [{ id: 'dup', name: 'Older', updatedAt: 100 }] },
            { creatorJutsus: [{ id: 'dup', name: 'Newer', updatedAt: 200 }] },
        ]);
        assert.equal(catalog.get('dup')?.name, 'Newer');
    });

    it('treats an equal or unparseable stamp as a tie and lets the later slot win', () => {
        const equal = buildAdminJutsuCatalog([
            { creatorJutsus: [{ id: 'dup', name: 'First', updatedAt: 500 }] },
            { creatorJutsus: [{ id: 'dup', name: 'Second', updatedAt: 500 }] },
        ]);
        assert.equal(equal.get('dup')?.name, 'Second');
        const junk = buildAdminJutsuCatalog([
            { creatorJutsus: [{ id: 'dup', name: 'First', updatedAt: 'yesterday' }] },
            { creatorJutsus: [{ id: 'dup', name: 'Second', updatedAt: null }] },
        ]);
        assert.equal(junk.get('dup')?.name, 'Second');
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
