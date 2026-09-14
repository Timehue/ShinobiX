import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { missionRewardBonusPct } from '../api/missions/_mission-catalog.ts';
import { getMissionRewardBonus } from '../shinobij.client/src/lib/village-upgrades.ts';

// Real cross-build-root behavior, executed by the root tsx test runner. Keep
// this outside the server TypeScript build, which has a different module target.
describe('mission reward preview and authoritative clan bonus agree', () => {
    for (const doctrine of ['none', 'warmonger', 'merchant', 'scholars', 'medics']) {
        for (const clan of ['', 'Ashen Vale']) {
            it(`${doctrine}, ${clan || 'no membership'}: village and clan bonus match`, () => {
                const character = { clan, clanDoctrine: doctrine, villageUpgrades: { missionHall: 10 } };
                assert.equal(missionRewardBonusPct(character), getMissionRewardBonus(character));
            });
        }
    }

    it('adds the equipped Aura Sphere to the existing Scholars bonus', () => {
        const character = {
            clan: 'Ashen Vale', clanDoctrine: 'scholars',
            villageUpgrades: { missionHall: 50 }, auraSphereLevel: 60,
            equipment: { aura: 'aura-sphere' },
        };
        assert.equal(missionRewardBonusPct(character), getMissionRewardBonus(character) + 2);
        assert.equal(missionRewardBonusPct({ ...character, equipment: {} }), 30);
        assert.equal(missionRewardBonusPct({ ...character, auraSphereLevel: 100 }), 31);
    });

    it('does not apply a stale Scholars mirror without clan membership', () => {
        assert.equal(missionRewardBonusPct({ clanDoctrine: 'scholars' }), 0);
        assert.equal(missionRewardBonusPct({ clan: '', clanDoctrine: 'scholars' }), 0);
    });
});
