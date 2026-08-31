import assert from 'node:assert/strict';
import test from 'node:test';
import {
    PET_EXPEDITION_ROUTES,
    petExpeditionBasePetXp,
    petExpeditionBaseRyo,
    petExpeditionMaterialChances,
    petExpeditionStory,
    resolvePetExpeditionChoice,
} from './pet-expedition-contract.js';

test('canonical route previews stay aligned with the progression formula', () => {
    assert.equal(PET_EXPEDITION_ROUTES.scout.durationMinutes, 45);
    assert.equal(PET_EXPEDITION_ROUTES.forage.durationMinutes, 120);
    assert.equal(PET_EXPEDITION_ROUTES.ruins.durationMinutes, 240);
    assert.equal(petExpeditionBasePetXp('scout'), 120);
    assert.equal(petExpeditionBasePetXp('forage'), 348);
    assert.equal(petExpeditionBasePetXp('ruins'), 576);
    assert.equal(petExpeditionBaseRyo('scout', 30), 301.5);
});

test('investigate is a fair risk choice with explicit discovery and setback branches', () => {
    assert.deepEqual(resolvePetExpeditionChoice('secure', 0.01), {
        outcome: 'secured', label: 'Haul secured', ryoMultiplier: 1, materialMultiplier: 1,
    });
    assert.equal(resolvePetExpeditionChoice('investigate', 0.59).outcome, 'discovery');
    assert.equal(resolvePetExpeditionChoice('investigate', 0.60).outcome, 'setback');
    assert.ok(0.6 * 1.25 + 0.4 * 0.60 < 1, 'investigate must not become a larger expected-value faucet');
});

test('material chances are bounded and stories persist world context', () => {
    assert.deepEqual(petExpeditionMaterialChances('ruins', { dropBonus: 10, multiplier: 10, rewardScale: 1 }), {
        bone: 1, aura: 1, fate: 1,
    });
    const story = petExpeditionStory({ token: 'abc123', type: 'ruins', place: 'Moongrotto', biome: 'shadow', outcome: 'discovery' });
    assert.match(story, /Moongrotto/);
    assert.match(story, /second, better cache/);
});
