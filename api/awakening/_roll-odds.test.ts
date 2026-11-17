import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AWAKENING_PAID_BOTH_ID, AWAKENING_PAID_SINGLE_ID, rollAwakening } from './_roll.js';
import {
    AWAKENING_ELEMENTS, AWAKENING_REROLL_COST, awakeningBothRerollPairs, awakeningOddsPercent,
    awakeningRerollOddsText, awakeningSingleRerollPool,
} from '../../shared/awakening-roll.js';

/**
 * Play, the FTC and the EU CPC principles want paid random odds disclosed
 * before purchase. These tests drive the REAL server roll through every index
 * its random source can return and check that the outcomes are exactly the
 * pool the screen publishes, each reachable once, so a uniform draw gives the
 * published percent.
 */
function everyOutcome(elements: string[], kind: string, target?: string): { outcomes: string[][]; cost: number } {
    const outcomes: string[][] = [];
    let cost = -1;
    for (let index = 0, max = 1; index < max; index += 1) {
        const rolled = rollAwakening({ level: 99, fateShards: 100, elements }, kind, `odds_check_${index}_${outcomes.length}`, (size) => { max = size; return index; }, target);
        assert.equal(rolled.ok, true, `${kind} from ${elements} refused`);
        if (!rolled.ok || rolled.alreadyApplied) return { outcomes, cost };
        outcomes.push(rolled.character.elements as string[]);
        cost = 100 - Number(rolled.character.fateShards);
    }
    return { outcomes, cost };
}

const OWNED: string[][] = [['Fire'], ['Water', 'Fire'], ['Lightning', 'Wind'], ['Earth', 'Water', 'Wind']];

describe('Awakening reroll odds disclosure', () => {
    it('the single reroll draws exactly the published pool, at the published price', () => {
        for (const owned of OWNED) for (const target of owned) {
            const { outcomes, cost } = everyOutcome(owned, AWAKENING_PAID_SINGLE_ID, target);
            const slot = owned.indexOf(target);
            const landed = outcomes.map((elements) => elements[slot]);
            assert.deepEqual(landed, awakeningSingleRerollPool(owned), `${owned} rerolling ${target}`);
            assert.equal(new Set(landed).size, landed.length, 'each outcome reachable once, so each is equally likely');
            assert.equal(cost, AWAKENING_REROLL_COST.single);
        }
    });

    it('the two-element reroll draws exactly the published pairs, at the published price', () => {
        for (const owned of OWNED.filter((list) => list.length >= 2)) {
            const { outcomes, cost } = everyOutcome(owned, AWAKENING_PAID_BOTH_ID);
            assert.deepEqual(outcomes.map((elements) => elements.slice(0, 2)), awakeningBothRerollPairs(owned));
            assert.equal(cost, AWAKENING_REROLL_COST.both);
            // Both orders of each unordered pair appear once, so the published per-pair chance holds.
            const unordered = new Map<string, number>();
            for (const [a, b] of outcomes) unordered.set([a, b].sort().join('+'), (unordered.get([a, b].sort().join('+')) ?? 0) + 1);
            assert.deepEqual([...new Set(unordered.values())], [2]);
            assert.ok(!unordered.has(owned.slice(0, 2).sort().join('+')), 'the held pair never comes back');
        }
    });

    it('publishes the numbers a player with two elements actually faces', () => {
        assert.equal(AWAKENING_ELEMENTS.length, 5);
        assert.deepEqual(AWAKENING_REROLL_COST, { single: 10, both: 15 });
        assert.equal(awakeningRerollOddsText(['Water', 'Fire'], 'single'), 'A single reroll gives Wind, Earth or Lightning, each with a 33.3% chance.');
        assert.equal(awakeningRerollOddsText(['Fire'], 'single'), 'A single reroll gives Water, Wind, Earth or Lightning, each with a 25% chance.');
        assert.match(awakeningRerollOddsText(['Water', 'Fire'], 'both'), /^Rerolling both gives one of the 9 element pairs you do not hold, each with a 11\.1% chance\./);
        assert.equal(awakeningOddsPercent(9), 11.1);
        assert.equal(awakeningRerollOddsText([...AWAKENING_ELEMENTS], 'single'), '', 'nothing to land on means nothing to sell');
    });

    it('the screen publishes Awakening and named forge odds from the roll tables', () => {
        const screen = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'screens', 'CentralHub.tsx'), 'utf8');
        assert.match(screen, /from "\.\.\/\.\.\/\.\.\/shared\/awakening-roll"/);
        assert.ok((screen.match(/awakeningRerollOddsText\(/g) ?? []).length >= 3, 'on screen and in both confirm dialogs');
        assert.doesNotMatch(screen, /fateShards < 1[05]\b|\b1[05] Fate Shards/, 'prices come from AWAKENING_REROLL_COST, not literals');
        // The named forge's "Roll Odds" panels read api/craft/_named.ts's own tables
        // (shared/named-forge-roll.ts); api/craft/_named.test.ts ties those to the roll.
        assert.match(screen, /from "\.\.\/\.\.\/\.\.\/shared\/named-forge-roll"/);
        for (const table of ['NAMED_WEAPON_EP_VALUES.map', 'NAMED_WEAPON_RANGES.map', 'NAMED_WEAPON_TAG_APPEARANCE_PERCENT', 'NAMED_ARMOR_SPECIALS.map', 'NAMED_ARMOR_QUALITIES.length', 'NAMED_GAUNTLET_OFFENSE']) {
            assert.ok(screen.includes(table), `the forge odds panel must read ${table}`);
        }
    });
});
