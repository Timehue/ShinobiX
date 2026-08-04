import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildAdminAiCatalog } from './_admin-ai-catalog.js';

describe('admin AI catalog', () => {
    it('matches the client later-source-wins merge and canonical precedence', () => {
        const catalog = buildAdminAiCatalog([
            { creatorAis: [{ id: 'duelist', name: 'Admin 1', rules: [] }] },
            { creatorAis: [{ id: 'duelist', name: 'Admin 2', rules: [] }, { id: 'warden', name: 'Warden' }] },
            { creatorAis: [{ id: 'duelist', name: 'Published', rules: [] }] },
        ]);
        assert.equal(catalog.get('duelist')?.name, 'Published');
        assert.equal(catalog.get('warden')?.name, 'Warden');
    });

    it('rejects malformed ids and non-object entries', () => {
        const catalog = buildAdminAiCatalog([{ creatorAis: [null, 'bad', { id: 'has spaces' }, { id: 'good-ai', name: 'Good' }] }]);
        assert.deepEqual([...catalog.keys()], ['good-ai']);
    });
});
