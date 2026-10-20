import assert from 'node:assert/strict';
import test from 'node:test';
import {
    PET_EXPEDITION_ROUTES,
    petExpeditionBasePetXp,
    petExpeditionBaseRyo,
    petExpeditionMaterialChances,
    petExpeditionStory,
    resolvePetExpeditionChoice,
    petExpeditionRewardPreview,
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

test('level-gated routes improve ryo and pet XP per hour while the profession bonus stays fixed', () => {
    let priorRyoRate = 0, priorXpRate = 0;
    for (const [type, level, ryo, petXp] of [['scout', 20, 180, 120], ['forage', 50, 720, 480], ['ruins', 80, 2160, 1280]] as const) {
        const route = PET_EXPEDITION_ROUTES[type];
        assert.equal(route.requiredLevel, level);
        const base = petExpeditionRewardPreview(type, { profession: 'vanguard', risk: 'safe', provision: 'none', rewardMastery: 1, materialMastery: 1 });
        const tamer = petExpeditionRewardPreview(type, { profession: 'petTamer', risk: 'safe', provision: 'none', rewardMastery: 1, materialMastery: 1 });
        assert.equal(base.ryo, ryo);
        assert.equal(base.petXp, petXp);
        assert.equal(tamer.ryo, base.ryo * 1.5);
        assert.equal(tamer.petXp, base.petXp * 1.5);
        for (const key of ['bone', 'aura', 'fate'] as const) assert.equal(tamer.chances[key], base.chances[key] * 1.5);
        assert.ok(base.ryo / route.durationMinutes > priorRyoRate, 'longer higher-level routes must improve ryo pace');
        assert.ok(base.petXp / route.durationMinutes > priorXpRate, 'longer higher-level routes must improve XP pace');
        priorRyoRate = base.ryo / route.durationMinutes;
        priorXpRate = base.petXp / route.durationMinutes;
    }
});

test('Fate finds grow with route level while Aura Stones belong to the highest route', () => {
    const previews = (['scout', 'forage', 'ruins'] as const).map(type => petExpeditionRewardPreview(type,
        { profession: 'vanguard', risk: 'safe', provision: 'none', rewardMastery: 1, materialMastery: 1 }));
    assert.deepEqual(previews.map(preview => preview.chances.fate), [0.03, 0.06, 0.12]);
    assert.deepEqual(previews.map(preview => preview.chances.aura), [0, 0, 0.04]);
});

test('purchased mastery remains useful and premium odds cannot exceed certainty', () => {
    const base = petExpeditionRewardPreview('ruins', { profession: 'petTamer', risk: 'safe', provision: 'none', rewardMastery: 1, materialMastery: 1 });
    const mastered = petExpeditionRewardPreview('ruins', { profession: 'petTamer', risk: 'safe', provision: 'none', rewardMastery: 1.15, materialMastery: 1.15 });
    assert.equal(mastered.ryo, 3726);
    assert.ok(mastered.materialMultiplier > base.materialMultiplier);
    assert.ok(mastered.chances.aura > base.chances.aura);
    const boosted = petExpeditionRewardPreview('ruins', { profession: 'petTamer', risk: 'bold', provision: 'ancient-pet-treat', rewardMastery: 2, materialMastery: 2 });
    for (const chance of Object.values(boosted.chances)) assert.ok(chance >= 0 && chance <= 1);
});
