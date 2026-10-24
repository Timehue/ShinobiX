import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    TRAINING_TIERS as CLIENT_TIERS,
    LEGACY_TRAINING_TIERS as CLIENT_LEGACY_TIERS,
    trainingTiersFor as clientTiersFor,
    trainingStatGain as clientGain,
    rookieStatMultiplier as clientRookie,
    sealedTrainingGain as clientSealed,
    previewTrainingGain,
    MAX_AGGREGATE_STAT_BOOST as CLIENT_MAX_BOOST,
    ROOKIE_STAT_PEAK_MULTIPLIER as CLIENT_PEAK,
    ROOKIE_TAPER_END_LEVEL as CLIENT_END,
} from '../shinobij.client/src/lib/training-config.js';
import { getTrainingXpBonus } from '../shinobij.client/src/lib/village-upgrades.js';
import { cacheVillageElders, resetVillageElders } from '../shinobij.client/src/lib/village-elder-focus.js';
import type { Character } from '../shinobij.client/src/types/character.js';
import {
    TRAINING_TIERS as SERVER_TIERS,
    LEGACY_TRAINING_TIERS as SERVER_LEGACY_TIERS,
    trainingTiersFor as serverTiersFor,
    trainingStatGain as serverGain,
    rookieStatMultiplier as serverRookie,
    sealedTrainingGain as serverSealed,
    ROOKIE_STAT_PEAK_MULTIPLIER as SERVER_PEAK,
    ROOKIE_TAPER_END_LEVEL as SERVER_END,
    type TrainingTier,
} from './_training-config.js';
import { MAX_SEALED_STAT_GAIN, trainingBonusPct, trustedTrainingRewards } from './training/_session.js';
import { applyMoraleToGain, WAR_BUFF_TRAINING_XP_MULT, WAR_DEBUFF_TRAINING_XP_MULT } from './_war-morale.js';
import { combinedStatBoost, MAX_AGGREGATE_STAT_BOOST, STAT_GAIN_DIAL_STEPS, statGainMultiplier } from './_stat-growth.js';
import { earnedForLevel, earnedStatPoints, levelForEarned } from './_xp-engine.js';
import { BOOST_MAX_MULTIPLIER } from '../shared/boost-event.js';

// Pins the server training config (api/_training-config.ts) to the client copy
// (shinobij.client/src/lib/training-config.ts) so /api/training/start seals the
// exact gain the client shows and applies. A drift in either side breaks here.

const TABLES = [
    ['v2', SERVER_TIERS, CLIENT_TIERS],
    ['legacy', SERVER_LEGACY_TIERS, CLIENT_LEGACY_TIERS],
] as const;

function withEnv<T>(name: string, value: string | undefined, run: () => T): T {
    const previous = process.env[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
    try { return run(); } finally {
        if (previous === undefined) delete process.env[name]; else process.env[name] = previous;
    }
}

describe('training-config parity — server mirrors client', () => {
    for (const [name, serverTiers, clientTiers] of TABLES) {
        it(`has identical ${name} tier tables`, () => {
            assert.equal(serverTiers.length, clientTiers.length);
            for (let i = 0; i < clientTiers.length; i++) {
                const c = clientTiers[i], s = serverTiers[i];
                assert.equal(s.id, c.id, `tier ${i} id`);
                assert.equal(s.label, c.label, `tier ${c.id} label`);
                assert.equal(s.ms, c.ms, `tier ${c.id} ms`);
                assert.equal(s.ratePerHour, c.ratePerHour, `tier ${c.id} ratePerHour`);
                assert.equal(s.xp, c.xp, `tier ${c.id} xp`);
                assert.equal(s.staminaCost, c.staminaCost, `tier ${c.id} staminaCost`);
            }
        });
        it(`trainingStatGain is identical across ${name} tiers, elapsed fractions, and bonuses`, () => {
            for (const tier of clientTiers) {
                for (const frac of [0, 0.25, 0.5, 1, 5]) {
                    for (const bonus of [0, 25, 60]) {
                        const elapsed = tier.ms * frac;
                        assert.equal(serverGain(tier, elapsed, bonus), clientGain(tier, elapsed, bonus), `${tier.id} frac ${frac} bonus ${bonus}`);
                    }
                }
            }
        });
    }
    it('trainingTiersFor picks the same table on both sides', () => {
        assert.equal(serverTiersFor('v2'), SERVER_TIERS);
        assert.equal(serverTiersFor('legacy'), SERVER_LEGACY_TIERS);
        assert.equal(clientTiersFor('v2'), CLIENT_TIERS);
        assert.equal(clientTiersFor('legacy'), CLIENT_LEGACY_TIERS);
        assert.equal(CLIENT_MAX_BOOST, MAX_AGGREGATE_STAT_BOOST);
    });
});

describe('rookie momentum curve — server mirrors client', () => {
    it('shares the same dials', () => {
        assert.equal(SERVER_PEAK, CLIENT_PEAK);
        assert.equal(SERVER_END, CLIENT_END);
    });

    it('is identical at every level and on junk input', () => {
        for (let level = 0; level <= 120; level++) {
            assert.equal(serverRookie(level), clientRookie(level), `parity at L${level}`);
        }
        for (const junk of [undefined, null, NaN, -5, '12', 1.9]) {
            assert.equal(serverRookie(junk), clientRookie(junk), `parity on ${String(junk)}`);
        }
    });

    it('peaks at level 1, reaches exactly 1.0 at the taper end, and never drops below it', () => {
        assert.equal(serverRookie(1), SERVER_PEAK);
        assert.equal(serverRookie(SERVER_END), 1);
        for (const level of [SERVER_END, SERVER_END + 1, 60, 100, 999]) {
            assert.equal(serverRookie(level), 1, `flat at L${level}`);
        }
        // Never a nerf: no level is ever slower than an untouched rate.
        for (let level = 1; level <= 120; level++) {
            assert.ok(serverRookie(level) >= 1, `>= 1 at L${level}`);
        }
    });

    it('decreases monotonically, with no cliff at any single level-up', () => {
        for (let level = 1; level < 120; level++) {
            const here = serverRookie(level);
            const next = serverRookie(level + 1);
            assert.ok(next <= here, `monotone at L${level}`);
            // A single level-up must never cut the rate by more than 15% —
            // a cliff would make levelling feel like a punishment.
            assert.ok(next >= here * 0.85, `no cliff at L${level}: ${here} → ${next}`);
        }
    });

    it('a sealed 8h grant stays inside the session validation bound, on either table', () => {
        // The worst case a lease can carry, in the order api/training/start.ts
        // actually applies them: the tier base × the 2.5 aggregate boost ceiling
        // × the rookie peak (trustedTrainingRewards) × the war-morale ceiling ×
        // the largest boost event (applyMoraleToGain, applied AFTER the seal). It
        // must stay under MAX_SEALED_STAT_GAIN or storedTrainingGrant rejects a
        // legitimate lease at completion — the player would lose a finished
        // session. v2: 65 → 2,145; legacy kill-switch table: 72 → 2,376.
        const moraleCeiling = Math.max(WAR_BUFF_TRAINING_XP_MULT, WAR_DEBUFF_TRAINING_XP_MULT);
        for (const [name, tiers] of TABLES) {
            const eightHour = tiers.find((tier) => tier.id === '8h')!;
            const sealed = Math.round(serverGain(eightHour, eightHour.ms, 0) * MAX_AGGREGATE_STAT_BOOST * SERVER_PEAK);
            const worstCase = applyMoraleToGain(sealed, moraleCeiling * BOOST_MAX_MULTIPLIER);
            assert.ok(
                worstCase <= MAX_SEALED_STAT_GAIN,
                `${name}: worst-case sealed gain ${worstCase} exceeds MAX_SEALED_STAT_GAIN ${MAX_SEALED_STAT_GAIN}`,
            );
        }
    });
});

describe('the Training preview runs the seal arithmetic (PXS-07)', () => {
    const BONUSES = [0, 10, 12.5, 30, 37.5, 200];
    const LEVELS = [1, 10, 20, 34, 35, 90];
    const DIALS = [1, 0.9, 0.95, 1.03, 1.06, 1.5, 2.5, Number.NaN, -1];

    it('sealedTrainingGain is identical server and client for every tier, bonus, ledger level and dial', () => {
        for (const [, serverTiers, clientTiers] of TABLES) {
            serverTiers.forEach((tier, i) => {
                for (const bonus of BONUSES) for (const level of LEVELS) for (const dial of DIALS) {
                    assert.equal(
                        serverSealed(tier, bonus, level, dial),
                        clientSealed(clientTiers[i], bonus, level, dial),
                        `${tier.id} bonus ${bonus} L${level} dial ${dial}`,
                    );
                }
            });
        }
    });

    it('the client preview equals the server seal after war morale and the boost event', () => {
        for (const [, serverTiers, clientTiers] of TABLES) {
            serverTiers.forEach((tier, i) => {
                for (const bonus of [0, 10, 37.5]) for (const level of [1, 20, 35]) {
                    for (const morale of [1, 1.1, 0.95, 1.045]) for (const event of [1, 1.25, 1.5, 2]) {
                        const sealed = applyMoraleToGain(serverSealed(tier, bonus, level, 1), morale * event);
                        const preview = previewTrainingGain({
                            tier: clientTiers[i], bonusPct: bonus, ledgerLevel: level, eraDial: 1, moraleXpMult: morale, eventBoost: event,
                        });
                        assert.equal(preview, sealed, `${tier.id} bonus ${bonus} L${level} morale ${morale} event ${event}`);
                    }
                }
            });
        }
    });

    it('trustedTrainingRewards seals sealedTrainingGain, byte-identical to the old formula, with the dial set or unset', () => {
        const fixtures: Array<Record<string, unknown>> = [
            { stats: {}, unspentStats: earnedForLevel(10) },
            { stats: {}, unspentStats: earnedForLevel(36), elderFocus: 'training' },
            { stats: {}, unspentStats: earnedForLevel(50), villageUpgrades: { training: 50 }, elderFocus: 'training',
                clan: 'c', clanUpgradeLevels: { trainingGrounds: 50 }, clanDoctrine: 'scholars' },
        ];
        for (const dial of [undefined, '1.06', '2.5']) {
            withEnv('STAT_GAIN_MULTIPLIER', dial, () => {
                for (const character of fixtures) for (const tier of SERVER_TIERS) {
                    const bonus = trainingBonusPct(character);
                    const level = levelForEarned(earnedStatPoints(character));
                    const sealed = trustedTrainingRewards(tier, character).sealedGain;
                    assert.equal(sealed, serverSealed(tier, bonus, level, statGainMultiplier()));
                    const legacyFormula = Math.max(0, Math.round(
                        serverGain(tier, tier.ms, 0) * combinedStatBoost(bonus) * serverRookie(level),
                    ));
                    assert.equal(sealed, legacyFormula, `${tier.id} dial ${dial ?? 'unset'} bonus ${bonus}`);
                }
            });
        }
    });

    it('the client training bonus matches the server training bonus', () => {
        const village = 'Stormveil Village';
        resetVillageElders();
        cacheVillageElders(village, ['elderwar', 'eldertrade', 'eldertraining'], Date.now() + 86_400_000);
        try {
            const cases: Array<Record<string, unknown>> = [];
            for (const training of [0, 1, 50, 60]) cases.push({ village, villageUpgrades: { training } });
            cases.push({ village, villageUpgrades: { training: 12 }, elderFocus: 'training' });
            for (const trainingGrounds of [0, 13, 60]) cases.push({ village, clan: 'Leaf', clanUpgradeLevels: { trainingGrounds } });
            cases.push({ village, clan: 'Leaf', clanDoctrine: 'scholars' });
            cases.push({ village, clanDoctrine: 'scholars', clanUpgradeLevels: { trainingGrounds: 50 } }); // no clan: neither applies
            cases.push({ village, villageUpgrades: { training: 50 }, elderFocus: 'training', clan: 'Leaf',
                clanUpgradeLevels: { trainingGrounds: 50 }, clanDoctrine: 'scholars' });
            for (const character of cases) {
                assert.equal(getTrainingXpBonus(character as unknown as Character), trainingBonusPct(character), JSON.stringify(character));
            }
        } finally {
            resetVillageElders();
        }
    });
});

describe('era-dial guard: pacing steps never hand the 15m chain a whole point (PXS-07)', () => {
    // The 15m seal is round(3 × min(2.5, (1 + bonus) × dial)) at L35+, so the
    // dial moves it in whole points while the 8h and 4h tiers move by the step.
    // An upward step past a threshold gives the 96-start chain +25-33%; a
    // downward one leaves it flat while the long tiers lose the step.
    const LEVEL_35 = 35;
    const sealedFor = (tiers: readonly TrainingTier[], id: string, bonus: number, dial: number) =>
        serverSealed(tiers.find((tier) => tier.id === id)!, bonus, LEVEL_35, dial);
    const worstEdge = (tiers: readonly TrainingTier[], dial: number) => {
        let worst = 0;
        for (let i = 0; i <= 750; i += 1) {
            const bonus = i * 0.05;
            worst = Math.max(worst, (96 * sealedFor(tiers, '15m', bonus, dial)) / (3 * sealedFor(tiers, '8h', bonus, dial)));
        }
        return worst;
    };

    for (const [name, tiers] of TABLES) {
        it(`(${name}) every runbook step keeps the archetype 15m seals and the worst sealed edge`, () => {
            const worstAtOne = worstEdge(tiers, 1);
            for (const dial of STAT_GAIN_DIAL_STEPS) {
                for (const bonus of [0, 10, 30, 37.5]) {
                    assert.equal(
                        sealedFor(tiers, '15m', bonus, dial),
                        sealedFor(tiers, '15m', bonus, 1),
                        `dial ${dial} moves the +${bonus}% 15m seal`,
                    );
                }
                assert.ok(worstEdge(tiers, dial) <= worstAtOne + 1e-9, `dial ${dial} widens the sealed 96-start edge`);
            }
        });
    }

    it('names the thresholds the runbook list stays inside', () => {
        // 0.87 drops the +30% seal 4 → 3; 1.08 lifts the +10% seal 3 → 4.
        assert.notEqual(sealedFor(SERVER_TIERS, '15m', 30, 0.87), sealedFor(SERVER_TIERS, '15m', 30, 1));
        assert.notEqual(sealedFor(SERVER_TIERS, '15m', 10, 1.08), sealedFor(SERVER_TIERS, '15m', 10, 1));
        assert.equal(Math.min(...STAT_GAIN_DIAL_STEPS), 0.9);
        assert.equal(Math.max(...STAT_GAIN_DIAL_STEPS), 1.06);
        assert.ok((STAT_GAIN_DIAL_STEPS as readonly number[]).includes(1), 'the default is a step');
    });
});
