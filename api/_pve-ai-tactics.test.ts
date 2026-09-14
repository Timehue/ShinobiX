import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { PVE_MEANINGFUL_BUFFS, pveMeaningfulBuffCount } from './_pve-ai-tactics.js';
import { pveAiCompetence } from './_pve-difficulty.js';

/*
 * The "worth a 60-AP Clear" buff list feeds pveAiCompetence().clearBuffThreshold.
 * It used to be pinned by a client ⇄ server parity test; the client copy
 * (lib/combat-ai-tactics.ts) had no importers left once Solo PvE moved to the
 * server, so the list is pinned here instead. Changing it is a balance change:
 * update this test deliberately, never to make it pass.
 */

describe('PvE AI meaningful-buff list', () => {
    it('is exactly the twelve buffs worth a Clear', () => {
        assert.deepEqual([...PVE_MEANINGFUL_BUFFS].sort(), [
            'Absorb',
            'Clear Prevent',
            'Debuff Prevent',
            'Decrease Damage Taken',
            'Increase Damage Given',
            'Increase Discipline',
            'Increase Generals',
            'Increase Heal',
            'Lifesteal',
            'Overclock',
            'Reflect',
            'Stun Prevent',
        ]);
    });

    it('counts listed positives by occurrence and ignores everything else', () => {
        const cases: Array<[Array<{ name: string; kind: 'positive' | 'negative' }>, number]> = [
            [[], 0],
            [[{ name: 'Increase Damage Given', kind: 'positive' }], 1],
            [[{ name: 'Increase Damage Given', kind: 'positive' }, { name: 'Absorb', kind: 'positive' }], 2],
            // A listed NAME carried as a negative does not count.
            [[{ name: 'Absorb', kind: 'negative' }], 0],
            // Unlisted positives are deliberately ignored.
            [[{ name: 'Cosmetic Sparkle', kind: 'positive' }, { name: 'Reflect', kind: 'positive' }], 1],
            // Every listed buff at once.
            [[...PVE_MEANINGFUL_BUFFS].map((name) => ({ name, kind: 'positive' as const })), 12],
            // Occurrences, not distinct names.
            [[
                { name: 'Reflect', kind: 'positive' }, { name: 'Reflect', kind: 'positive' },
                { name: 'Poison', kind: 'negative' }, { name: 'Overclock', kind: 'positive' },
            ], 3],
        ];
        for (const [statuses, expected] of cases) {
            assert.equal(pveMeaningfulBuffCount(statuses), expected, JSON.stringify(statuses));
        }
    });

    it('tolerates malformed status entries', () => {
        assert.equal(pveMeaningfulBuffCount([{ name: 42, kind: 'positive' }, { kind: 'positive' }, {}]), 0);
    });

    it('masterAi never moves the Clear threshold the count is compared against', () => {
        for (const level of [1, 20, 30, 31, 50, 51, 90, 91, 100]) {
            assert.equal(pveAiCompetence(level).clearBuffThreshold, pveAiCompetence(level, true).clearBuffThreshold,
                `masterAi must not move the Clear threshold @ ${level}`);
        }
    });
});
