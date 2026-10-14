import assert from 'node:assert/strict';
import { test } from 'node:test';
import { petBakedSupportOwnsBody } from './pet-baked-support';
import { PET_CHARACTER_MOTION_ASSET_REVISION } from './pet-proper-animation-assets';

const bank = { revision: PET_CHARACTER_MOTION_ASSET_REVISION, clips: [{ contacts: 28 }] };
test('contact-authored support clips own their body offsets across every grounded profile', () => {
    for (const profile of ['quadruped', 'biped', 'heavy', 'avian']) for (const motion of ['idle', 'run', 'guard', 'rest']) {
        assert.equal(petBakedSupportOwnsBody({ motion }, profile, bank, false), true);
    }
    assert.equal(petBakedSupportOwnsBody({ motion: 'dash' }, 'quadruped', bank, false), true);
});
test('flight, swimming and action choreography retain their host motion', () => {
    for (const motion of ['windup', 'strike', 'recover', 'dodge', 'stagger', 'dead']) {
        assert.equal(petBakedSupportOwnsBody({ motion }, 'biped', bank, false), false);
    }
    assert.equal(petBakedSupportOwnsBody({ motion: 'dash' }, 'avian', bank, false), false);
    assert.equal(petBakedSupportOwnsBody({ motion: 'idle' }, 'quadruped', bank, true), false);
    assert.equal(petBakedSupportOwnsBody({ motion: 'idle', victorious: true }, 'quadruped', bank, false), false);
    assert.equal(petBakedSupportOwnsBody({ motion: 'idle', entranceProgress: .4 }, 'biped', bank, false), false);
    assert.equal(petBakedSupportOwnsBody({ motion: 'idle' }, 'biped', undefined, false), false);
    assert.equal(petBakedSupportOwnsBody({ motion: 'idle' }, 'biped', { ...bank, revision: 'older-bank' }, false), false);
    assert.equal(petBakedSupportOwnsBody({ motion: 'idle' }, 'biped', { ...bank, clips: [{ contacts: 0 }] }, false), false);
});
