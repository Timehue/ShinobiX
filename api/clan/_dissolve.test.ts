import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    ClanDissolutionForbiddenError,
    assertClanDissolutionFounder,
} from './_dissolve.js';

describe('clan dissolution founder fencing', () => {
    it('rejects a stale caller after canonicalizing both founder identities', () => {
        assert.throws(
            () => assertClanDissolutionFounder('Current Founder', 'Old Founder'),
            ClanDissolutionForbiddenError,
        );
        assert.doesNotThrow(() => assertClanDissolutionFounder('Current Founder', 'currentfounder'));
    });

    it('allows admins/no expected founder but fences a receipt from another founder', () => {
        assert.doesNotThrow(() => assertClanDissolutionFounder('originalfounder', null));
        assert.throws(
            () => assertClanDissolutionFounder('originalfounder', 'intruder'),
            ClanDissolutionForbiddenError,
        );
    });
});
