/*
 * Parity guard: the server's mirror of the PvE combat-AI perception layer
 * (api/_pve-ai-tactics.ts) MUST match the client's
 * (shinobij.client/src/lib/combat-ai-tactics.ts).
 *
 * The mirrored piece is the "worth a 60-AP Clear" buff list, which feeds
 * pveAiCompetence().clearBuffThreshold in both engines. Drift here is silent and
 * asymmetric: a buff the server forgets is a buff the migrated AI ignores while
 * the client's AI answers it (or the reverse), and nothing else would notice.
 *
 * Lives in scripts/ — excluded from both build roots — like the other
 * cross-build-root parity tests.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

// Client (source of truth)
import { MEANINGFUL_BUFFS as CLIENT_MEANINGFUL_BUFFS, buildPlayerRead } from '../shinobij.client/src/lib/combat-ai-tactics';
import { pveAiCompetence as clientCompetence } from '../shinobij.client/src/lib/pve-difficulty';

// Server (the port under test)
import { PVE_MEANINGFUL_BUFFS, pveMeaningfulBuffCount } from '../api/_pve-ai-tactics';

const sorted = (set: ReadonlySet<string>) => [...set].sort();

describe('PvE AI tactics parity (server ⇄ client)', () => {
    it('the meaningful-buff list matches exactly', () => {
        assert.deepEqual(
            sorted(PVE_MEANINGFUL_BUFFS),
            sorted(CLIENT_MEANINGFUL_BUFFS),
            'api/_pve-ai-tactics.ts drifted from shinobij.client/src/lib/combat-ai-tactics.ts',
        );
        // Guard against both lists being emptied together.
        assert.ok(PVE_MEANINGFUL_BUFFS.size >= 10, 'fixture check: the list is non-trivial');
    });

    it('counts the same buffs the client\'s buildPlayerRead does', () => {
        // The server helper replaces exactly one client field —
        // PlayerRead.meaningfulBuffCount — so it must agree on the same input.
        const cases: Array<Array<{ name: string; kind: 'positive' | 'negative' }>> = [
            [],
            [{ name: 'Increase Damage Given', kind: 'positive' }],
            [{ name: 'Increase Damage Given', kind: 'positive' }, { name: 'Absorb', kind: 'positive' }],
            // A meaningful NAME carried as a negative must not count.
            [{ name: 'Absorb', kind: 'negative' }],
            // Unlisted positives are deliberately ignored by both sides.
            [{ name: 'Cosmetic Sparkle', kind: 'positive' }, { name: 'Reflect', kind: 'positive' }],
            // Every listed buff at once.
            [...PVE_MEANINGFUL_BUFFS].map(name => ({ name, kind: 'positive' as const })),
            // Mixed bag with duplicates — both sides count occurrences, not names.
            [
                { name: 'Reflect', kind: 'positive' }, { name: 'Reflect', kind: 'positive' },
                { name: 'Poison', kind: 'negative' }, { name: 'Overclock', kind: 'positive' },
            ],
        ];
        for (const statuses of cases) {
            const client = buildPlayerRead({
                turn: 1, hp: 100, maxHp: 100, ap: 100, shield: 0,
                statuses, recentActions: [],
            }).meaningfulBuffCount;
            assert.equal(
                pveMeaningfulBuffCount(statuses), client,
                `meaningfulBuffCount mismatch for ${JSON.stringify(statuses)}`,
            );
        }
    });

    it('the Clear threshold the count is compared against matches per band', () => {
        // Pins the pairing, not just the two halves: the server compares this
        // count to pveAiCompetence().clearBuffThreshold, so a band whose
        // threshold drifted would break the wiring even with an identical list.
        for (const level of [1, 20, 30, 31, 50, 51, 90, 91, 100]) {
            assert.equal(clientCompetence(level).clearBuffThreshold, clientCompetence(level, true).clearBuffThreshold,
                `masterAi must not move the Clear threshold @ ${level} — the server never reads that flag`);
        }
    });
});
