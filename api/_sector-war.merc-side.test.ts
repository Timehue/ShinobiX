import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applySectorWarBattle, MERC_REPEL_POINTS_FRACTION, newSectorWarSession } from './_sector-war.js';

/*
 * applySectorWarBattle `mercSide` (owner ruling 2026-10-08). The side that BEAT
 * the AI scores at the repel fraction; an AI that won scores its own side in
 * full. 'attacker' is the default — the shape every earlier merc battle and
 * every garrison hold (`mercBattle: !attackerWon`) was scored with — and
 * 'defender' is a defending village's hired band.
 */

const NOW = 1_800_000_000_000;
const session = () => newSectorWarSession({ sector: 23, attackerVillage: 'A Village', defenderVillage: 'D Village', winCondition: 'combat', now: NOW - 1_000 });

describe('applySectorWarBattle — mercSide', () => {
    it("'defender': a band win scores the defence in full", () => {
        const out = applySectorWarBattle(session(), false, { now: NOW, roleSwing: 55, mercBattle: true, mercSide: 'defender' });
        assert.deepEqual({ side: out.side, awarded: out.awarded, d: out.session.defenderPoints, a: out.session.attackerPoints }, { side: 'defender', awarded: 55, d: 55, a: 0 });
    });

    it("'defender': an attacker who beats the band scores a quarter", () => {
        const out = applySectorWarBattle(session(), true, { now: NOW, roleSwing: 30, mercBattle: true, mercSide: 'defender' });
        assert.deepEqual({ side: out.side, awarded: out.awarded }, { side: 'attacker', awarded: Math.floor(30 * MERC_REPEL_POINTS_FRACTION) });
    });

    it("'defender': the attack's structure multiplier still applies before the fraction", () => {
        const out = applySectorWarBattle(session(), true, { now: NOW, roleSwing: 40, attackerMult: 1.15, mercBattle: true, mercSide: 'defender' });
        assert.equal(out.awarded, Math.floor(Math.round(40 * 1.15) * MERC_REPEL_POINTS_FRACTION));
    });

    it("default / 'attacker': unchanged — a merc win is full, a defender repel a quarter", () => {
        for (const mercSide of [undefined, 'attacker'] as const) {
            const won = applySectorWarBattle(session(), true, { now: NOW, roleSwing: 20, mercBattle: true, mercSide });
            assert.equal(won.awarded, 20);
            const repelled = applySectorWarBattle(session(), false, { now: NOW, roleSwing: 20, mercBattle: true, mercSide });
            assert.equal(repelled.awarded, 5);
        }
    });

    it('a merc battle is an AI battle on either side: it never touches lastLiveBattleAt', () => {
        for (const mercSide of ['attacker', 'defender'] as const) {
            for (const attackerWon of [true, false]) {
                const out = applySectorWarBattle(session(), attackerWon, { now: NOW, roleSwing: 10, mercBattle: true, mercSide });
                assert.equal(out.session.lastLiveBattleAt, undefined);
                assert.equal(out.session.updatedAt, NOW);
            }
        }
    });
});
