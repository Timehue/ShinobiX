import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

// L18a: the war-campaign 409 must echo only player-facing refusals, never a raw
// internal error message (lock keys, storage/driver text, runtime TypeErrors).

type WarCampaignModule = typeof import('./war-campaign.js');
let mod: Pick<WarCampaignModule, 'warCampaignErrorMessage' | 'WarCampaignRefusal' | 'WAR_CAMPAIGN_BUSY_MESSAGE'>;
let LockContendedError: typeof import('../_lock.js').LockContendedError;
before(async () => {
    const loaded = await import('./war-campaign.js');
    mod = {
        warCampaignErrorMessage: loaded.warCampaignErrorMessage,
        WarCampaignRefusal: loaded.WarCampaignRefusal,
        WAR_CAMPAIGN_BUSY_MESSAGE: loaded.WAR_CAMPAIGN_BUSY_MESSAGE,
    };
    ({ LockContendedError } = await import('../_lock.js'));
});

describe('warCampaignErrorMessage', () => {
    it('echoes typed refusals verbatim', () => {
        const r = mod.warCampaignErrorMessage(new mod.WarCampaignRefusal('Finish the pending PvP settlement before taking guard duty.'));
        assert.deepEqual(r, { message: 'Finish the pending PvP settlement before taking guard duty.', internal: false });
    });

    it('echoes the shared helpers\' plain one-sentence refusals', () => {
        for (const m of ['Village war changed. Please retry.', 'Choose Supply, Sabotage or Espionage.', 'This war is not active.']) {
            assert.deepEqual(mod.warCampaignErrorMessage(new Error(m)), { message: m, internal: false });
        }
    });

    it('hides lock, storage and runtime errors behind the generic message', () => {
        for (const e of [
            new LockContendedError('world:war:secret-key'),
            new Error('connect ECONNREFUSED 10.0.0.5:5432'),
            new Error('kv set failed: relation "kv_store" does not exist'),
            Object.assign(new Error('Duplicate key.'), { code: '23505' }),
            new TypeError('Cannot read properties of undefined (reading \'campaign\').'),
            'a thrown string',
            undefined,
        ]) {
            const r = mod.warCampaignErrorMessage(e);
            assert.equal(r.message, mod.WAR_CAMPAIGN_BUSY_MESSAGE);
            assert.equal(r.internal, true);
        }
    });
});
