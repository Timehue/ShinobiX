import assert from 'node:assert/strict';
import test from 'node:test';
import {
    PET_EXPEDITION_DAILY_CAP,
    PET_EXPEDITION_CARAVAN_BONUS,
    PET_EXPEDITION_RISK_RULES,
    PET_EXPEDITION_ROUTES,
    TAMER_RYO_MULT,
    petExpeditionBasePetXp,
    petExpeditionBaseRyo,
    petExpeditionMaterialChances,
    petExpeditionStory,
    resolvePetExpeditionChoice,
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
