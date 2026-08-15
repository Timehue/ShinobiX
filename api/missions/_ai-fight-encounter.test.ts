import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { loadAiFightProfile } from './_ai-fight-encounter.js';

describe('loadAiFightProfile', () => {
    it('resolves a built-in AI from the generated mirror', async () => {
        const found = await loadAiFightProfile('builtin-ai-ember-duelist');
        assert.ok(found, 'built-in AI must resolve');
        assert.equal(found.id, 'builtin-ai-ember-duelist');
        assert.equal(found.name, 'Ember Duelist');
    });

    it('rejects malformed ids without a storage lookup', async () => {
        for (const bad of ['', '   ', 'has spaces', 'bad/slash', null, 42, {}]) {
            assert.equal(await loadAiFightProfile(bad), null, `should reject ${JSON.stringify(bad)}`);
        }
    });
});
