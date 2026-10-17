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

test('a contact-authored attack owns its torso throughout windup, contact and recovery', () => {
    const attackBank = { ...bank, plantedAttack: true };
    for (const motion of ['windup', 'strike', 'recover']) {
        assert.equal(petBakedSupportOwnsBody({ motion }, 'quadruped', attackBank, false), true);
        assert.equal(petBakedSupportOwnsBody({ motion }, 'quadruped', bank, false), false);
        assert.equal(petBakedSupportOwnsBody({ motion }, 'quadruped', attackBank, true), false);
        assert.equal(petBakedSupportOwnsBody({ motion, victorious: true }, 'quadruped', attackBank, false), false);
        assert.equal(petBakedSupportOwnsBody({ motion, entranceProgress: .5 }, 'quadruped', attackBank, false), false);
        assert.equal(petBakedSupportOwnsBody({ motion }, 'quadruped', { ...attackBank, revision: 'old' }, false), false);
        assert.equal(petBakedSupportOwnsBody({ motion }, 'quadruped', { ...attackBank, clips: [{ contacts: 0 }] }, false), false);
    }
    for (const motion of ['dodge', 'stagger', 'dead']) assert.equal(petBakedSupportOwnsBody({ motion }, 'quadruped', attackBank, false), false);
    assert.equal(petBakedSupportOwnsBody({ motion: 'stagger' }, 'quadruped', { ...bank, plantedRecoil: true }, false), true);
    assert.equal(petBakedSupportOwnsBody({ motion: 'dodge' }, 'quadruped', { ...bank, plantedRecoil: true }, false), false);
});

test('unflagged banks preserve every prior body-ownership decision', () => {
    const support = new Set(['idle', 'run', 'dash', 'guard', 'rest']);
    for (const clips of [[], [{ contacts: 0 }], [{ contacts: 28 }]])
        for (const revision of [PET_CHARACTER_MOTION_ASSET_REVISION, 'old'])
            for (const motion of ['idle', 'run', 'dash', 'guard', 'rest', 'windup', 'strike', 'recover', 'dodge', 'stagger', 'dead'])
                for (const profile of ['quadruped', 'biped', 'heavy', 'avian'])
                    for (const aquatic of [true, false])
                        for (const victorious of [true, false])
                            for (const entranceProgress of [undefined, 0, .5, 1]) {
                                const expected = revision === PET_CHARACTER_MOTION_ASSET_REVISION && clips.length > 0 && clips.some(c => c.contacts > 0)
                                    && !aquatic && !victorious && !(entranceProgress !== undefined && entranceProgress < 1)
                                    && support.has(motion) && !(profile === 'avian' && motion === 'dash');
                                assert.equal(petBakedSupportOwnsBody({ motion, victorious, entranceProgress }, profile, { revision, clips }, aquatic), expected);
                            }
});
