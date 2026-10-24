import assert from 'node:assert/strict';
import test from 'node:test';
import {
    PET_EXPEDITION_DAILY_CAP,
    PET_EXPEDITION_CARAVAN_BONUS,
    PET_EXPEDITION_RISK_RULES,
    PET_EXPEDITION_ROUTES,
    PET_EXPEDITION_RYO_SCALE,
    TAMER_RYO_MULT,
    petExpeditionBasePetXp,
    petExpeditionBaseRyo,
    petExpeditionMaterialChances,
    petExpeditionStory,
    resolvePetExpeditionChoice,
    petExpeditionRewardPreview,
} from './pet-expedition-contract.js';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('canonical route previews stay aligned with the progression formula', () => {
    assert.equal(PET_EXPEDITION_ROUTES.scout.durationMinutes, 45);
    assert.equal(PET_EXPEDITION_ROUTES.forage.durationMinutes, 120);
    assert.equal(PET_EXPEDITION_ROUTES.ruins.durationMinutes, 240);
    assert.equal(petExpeditionBasePetXp('scout'), 120);
    assert.equal(petExpeditionBasePetXp('forage'), 348);
    assert.equal(petExpeditionBasePetXp('ruins'), 576);
    // 301.5 before the 2026-10 rebalance, then x TAMER_RYO_MULT 0.4 (owner A6).
    close(petExpeditionBaseRyo('scout', 30), 120.6);
});

test('TAMER_RYO_MULT scales every expedition inside the shared base (2026-10 rebalance #15, owner A6)', () => {
    assert.equal(TAMER_RYO_MULT, 0.4);
    // The kill value 1 reproduces the pre-rebalance base exactly.
    assert.equal(petExpeditionBaseRyo('scout', 30, 1), 301.5);
    assert.equal(petExpeditionBaseRyo('ruins', 100, 1), 996);
    close(petExpeditionBaseRyo('ruins', 100), 398.4);
    // A bad multiplier falls back to the code default; a negative one pays nothing.
    close(petExpeditionBaseRyo('ruins', 100, Number.NaN), 398.4);
    assert.equal(petExpeditionBaseRyo('ruins', 100, -1), 0);

    // Rank-10 Tamer (x1.25), Trailblazer 15%, bold route, L100 pet, secure haul.
    const bold = PET_EXPEDITION_RISK_RULES.bold.ryoMultiplier;
    const tamerClaim = Math.round(petExpeditionBaseRyo('ruins', 100) * 1.25 * 1.15 * bold);
    const firstClaim = Math.round(petExpeditionBaseRyo('ruins', 100) * 1.25 * 2 * 1.15 * bold);
    assert.equal(tamerClaim, 641, 'was 1,604 per Ruins claim');
    assert.equal(firstClaim, 1283);
    const dailyClaims = PET_EXPEDITION_DAILY_CAP + PET_EXPEDITION_CARAVAN_BONUS;
    assert.equal(firstClaim + (dailyClaims - 1) * tamerClaim, 9616, 'the Ruins daily maximum was 24,060');
    // A non-Tamer's maxed pet earns half base ryo and stays below the Tamer rate.
    const nonTamerClaim = Math.round(petExpeditionBaseRyo('ruins', 100) * 0.5 * bold);
    assert.equal(nonTamerClaim, 223);
    assert.ok(nonTamerClaim < tamerClaim);
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
    // Ryo carries PET_EXPEDITION_RYO_SCALE (0.2): 180 / 720 / 2,160 route ryo pay 36 / 144 / 432.
    for (const [type, level, ryo, petXp] of [['scout', 20, 36, 120], ['forage', 50, 144, 480], ['ruins', 80, 432, 1280]] as const) {
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

test('expedition ryo carries the 0.2 scale under active play, and the server may pass its dial', () => {
    assert.equal(PET_EXPEDITION_RYO_SCALE, 0.2);
    const opts = { profession: 'petTamer', risk: 'safe', provision: 'none', rewardMastery: 1, materialMastery: 1 } as const;
    assert.equal(petExpeditionRewardPreview('ruins', opts).ryo, 648);
    assert.equal(petExpeditionRewardPreview('ruins', { ...opts, ryoScale: 1 }).ryo, 3240, 'kill value 1 restores the full route pay');
    assert.equal(petExpeditionRewardPreview('ruins', { ...opts, ryoScale: 0 }).ryo, 0);
    assert.equal(petExpeditionRewardPreview('ruins', { ...opts, ryoScale: Number.NaN }).ryo, 648, 'a bad reading falls back to the default');
    // 12 safe Ruins claims a day: 7,776 ryo for a base Tamer, well under 90
    // active minutes at L90 (27,000).
    assert.equal(12 * 648, 7_776);
    // Pet XP and material odds are untouched by the ryo scale.
    assert.equal(petExpeditionRewardPreview('ruins', { ...opts, ryoScale: 0 }).petXp, petExpeditionRewardPreview('ruins', opts).petXp);
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
    assert.equal(mastered.ryo, 745, '4 h x 540 x 1.5 Tamer x 1.15 mastery x 0.2 scale');
    assert.ok(mastered.materialMultiplier > base.materialMultiplier);
    assert.ok(mastered.chances.aura > base.chances.aura);
    const boosted = petExpeditionRewardPreview('ruins', { profession: 'petTamer', risk: 'bold', provision: 'ancient-pet-treat', rewardMastery: 2, materialMastery: 2 });
    for (const chance of Object.values(boosted.chances)) assert.ok(chance >= 0 && chance <= 1);
});
