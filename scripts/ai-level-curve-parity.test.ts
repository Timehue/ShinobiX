/*
 * Parity guard: the server's AI level curves (api/_ai-level-curves.ts) MUST
 * produce byte-identical output to the client's (shinobij.client/src/lib/
 * ai-stats.ts + combat-ai.ts relevelBuiltinAi).
 *
 * These are FORMULAS, so they are hand-ported rather than generated — which
 * means the only thing standing between a tuning change and a server fight that
 * differs from the one the player was shown is this test. It sweeps the whole
 * legal input space (every level, several stat bonuses, every built-in AI)
 * rather than spot-checking, because a curve that agrees at level 50 and
 * diverges at level 7 is exactly the bug that would survive a spot check.
 *
 * Lives in scripts/ — excluded from both build roots — so importing the client
 * source here never pulls client files into the server dist. Same mechanism as
 * scripts/jutsu-catalog.test.mjs.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

// Client (source of truth)
import {
    aiHpForLevel as clientAiHpForLevel,
    aiPrimaryJutsuType as clientAiPrimaryJutsuType,
    aiRawDamageReductionForLevel as clientAiRawDR,
    aiStatBudgetForLevel as clientAiStatBudget,
    aiStatsForLevel as clientAiStatsForLevel,
    aiArmorFactorFromRaw as clientArmorFactorFromRaw,
} from '../shinobij.client/src/lib/ai-stats';
import { builtinAis, relevelBuiltinAi } from '../shinobij.client/src/lib/combat-ai';
import { starterJutsus } from '../shinobij.client/src/data/jutsu';
import type { Jutsu } from '../shinobij.client/src/types/combat';

// Server (the port under test)
import {
    aiHpForLevel,
    aiPrimaryJutsuType,
    aiRawDamageReductionForLevel,
    aiStatBudgetForLevel,
    aiStatsForLevel,
    aiArmorFactorFromRaw,
    aiToughnessForId,
    relevelAiProfile,
    type RelevelableProfile,
} from '../api/_ai-level-curves';

const ALL_LEVELS = Array.from({ length: 100 }, (_, i) => i + 1);
const TOUGHNESS = [0, 0.18, 0.35, 0.5];
const BONUSES = [0, 20, 35, 55, 75, 90, 165, 220];

/** A few loadout shapes, since the discipline mix picks the archetype weights. */
const LOADOUTS: Array<{ label: string; jutsu: Jutsu[] }> = [
    { label: 'empty', jutsu: [] },
    { label: 'ninjutsu-heavy', jutsu: starterJutsus.filter((j) => j.type === 'Ninjutsu').slice(0, 4) },
    { label: 'taijutsu-heavy', jutsu: starterJutsus.filter((j) => j.type === 'Taijutsu').slice(0, 4) },
    { label: 'genjutsu-heavy', jutsu: starterJutsus.filter((j) => j.type === 'Genjutsu').slice(0, 3) },
    { label: 'bukijutsu-heavy', jutsu: starterJutsus.filter((j) => j.type === 'Bukijutsu').slice(0, 3) },
    { label: 'mixed', jutsu: starterJutsus.slice(0, 6) },
];

describe('AI level curve parity (server ⇄ client)', () => {
    it('aiStatBudgetForLevel matches at every level', () => {
        for (const level of ALL_LEVELS) {
            assert.equal(aiStatBudgetForLevel(level), clientAiStatBudget(level), `level ${level}`);
        }
    });

    it('aiStatsForLevel matches at every level, for every loadout shape', () => {
        for (const { label, jutsu } of LOADOUTS) {
            for (const level of ALL_LEVELS) {
                assert.deepEqual(
                    aiStatsForLevel(level, jutsu),
                    clientAiStatsForLevel(level, jutsu),
                    `${label} @ level ${level}`,
                );
            }
        }
    });

    it('aiHpForLevel matches at every level × toughness', () => {
        for (const toughness of TOUGHNESS) {
            for (const level of ALL_LEVELS) {
                assert.equal(
                    aiHpForLevel(level, toughness),
                    clientAiHpForLevel(level, toughness),
                    `level ${level} toughness ${toughness}`,
                );
            }
        }
    });

    it('aiRawDamageReductionForLevel and aiArmorFactorFromRaw match', () => {
        for (const toughness of TOUGHNESS) {
            for (const level of ALL_LEVELS) {
                const server = aiRawDamageReductionForLevel(level, toughness);
                assert.equal(server, clientAiRawDR(level, toughness), `raw DR level ${level} t${toughness}`);
                assert.equal(aiArmorFactorFromRaw(server), clientArmorFactorFromRaw(server), `armor factor level ${level}`);
            }
        }
    });

    it('aiPrimaryJutsuType matches, including ties and empty input', () => {
        const cases: Jutsu[][] = [
            [],
            ...LOADOUTS.map((l) => l.jutsu),
            // Deliberate tie: stable sort must fall to the earlier key on both sides.
            [{ type: 'Ninjutsu' }, { type: 'Taijutsu' }] as unknown as Jutsu[],
            [{ type: 'Taijutsu' }, { type: 'Ninjutsu' }] as unknown as Jutsu[],
            [{ type: 'Any' }, { type: 'Any' }] as unknown as Jutsu[],
            [{ type: 'Any' }, { type: 'Genjutsu' }] as unknown as Jutsu[],
        ];
        for (const [i, jutsu] of cases.entries()) {
            assert.equal(aiPrimaryJutsuType(jutsu), clientAiPrimaryJutsuType(jutsu), `case ${i}`);
        }
    });

    // The one that actually matters for step 3: a re-leveled opponent. Every
    // built-in AI, swept across the level range and the real rank stat bonuses.
    it('relevelAiProfile matches relevelBuiltinAi for EVERY built-in AI', () => {
        const levels = [1, 2, 3, 8, 13, 18, 25, 35, 47, 55, 65, 70, 71, 80, 92, 99, 100];
        for (const base of builtinAis) {
            const loadoutJutsu = base.jutsuIds
                .map((id) => starterJutsus.find((j) => j.id === id))
                .filter((j): j is Jutsu => Boolean(j));
            for (const level of levels) {
                for (const bonus of BONUSES) {
                    for (const hpOverride of [0, 600, 1400, 12_000]) {
                        const expected = relevelBuiltinAi(base, level, bonus, hpOverride, starterJutsus);
                        const actual = relevelAiProfile(
                            base as unknown as RelevelableProfile,
                            level, bonus, hpOverride, loadoutJutsu,
                        );
                        const where = `${base.id} L${level} +${bonus} hp${hpOverride}`;
                        assert.equal(actual.level, expected.level, `${where}: level`);
                        assert.equal(actual.hp, expected.hp, `${where}: hp`);
                        assert.equal(actual.chakra, expected.chakra, `${where}: chakra`);
                        assert.equal(actual.stamina, expected.stamina, `${where}: stamina`);
                        assert.equal(actual.armorRawDR, expected.armorRawDR, `${where}: armorRawDR`);
                        assert.deepEqual(actual.stats, expected.stats, `${where}: stats`);
                    }
                }
            }
        }
    });

    it('reproduces the hunt-beast toughness rule, including the Worldstorm exception', () => {
        assert.equal(aiToughnessForId('hunt-ai-worldstorm-dragon', 92), 0.18, 'the documented exception');
        assert.equal(aiToughnessForId('hunt-ai-ember-drake', 65), 0.18, 'below 70 → 0.18');
        assert.equal(aiToughnessForId('hunt-ai-ember-drake', 70), 0.35, 'at 70 → 0.35');
        assert.equal(aiToughnessForId('builtin-ai-rogue-ninja', 90), 0, 'non-hunt AIs are unarmored');
    });

    // Quirk 1 in _ai-level-curves.ts: the client's re-level path drops
    // hpFloorExempt, so an apex boss re-leveled by the server must be floored
    // back onto the curve exactly like the client's is. If the client ever
    // fixes this, the sweep above fails and both sides get corrected together.
    it('drops hpFloorExempt on re-level, matching the client', () => {
        const apex = builtinAis.find((ai) => ai.id === 'apex-ai-ember-drake');
        assert.ok(apex?.hpFloorExempt, 'fixture check: the apex drake is authored hp-floor-exempt');
        const releveled = relevelAiProfile(apex as unknown as RelevelableProfile, 85, 165, 11_200, []);
        assert.equal(releveled.hpFloorExempt, undefined, 'the exemption must not survive a re-level');
        assert.equal(releveled.hp, relevelBuiltinAi(apex, 85, 165, 11_200, starterJutsus).hp);
    });
});
