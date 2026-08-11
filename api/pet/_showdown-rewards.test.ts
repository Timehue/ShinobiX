/*
 * Pet Showdown reward gating.
 *
 * The hand-picked-AI entry is PRACTICE and must pay nothing. That is a currency
 * rule, and currency rules in this repo get a gate rather than a comment — the
 * failure mode is silent (a mode quietly becomes an uncapped ryo faucet again)
 * and it is worth real money to a player who notices before we do.
 *
 * Two layers, because the risk has two shapes:
 *  - BEHAVIOUR: the engine seals eligibility at start and refuses to take it
 *    from anything truthy-ish the caller passes.
 *  - SOURCE SHAPE: the endpoint passes false, never reads eligibility from the
 *    request body, and short-circuits BEFORE the save lock. The ordering is the
 *    part a behavioural test can't see without standing up KV, and it is
 *    exactly what a careless refactor would break. Same pattern as
 *    api/player/_trade-escrow.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createShowdownSession } from '../_pet-showdown/engine.js';
import type { Pet } from '../_pet-sim/pet-types.js';

const src = readFileSync(join(process.cwd(), 'api', 'pet', 'showdown.ts'), 'utf8');

const indexOfOrFail = (needle: string | RegExp): number => {
    const idx = typeof needle === 'string' ? src.indexOf(needle) : src.search(needle);
    assert.ok(idx >= 0, `showdown.ts must contain ${needle}`);
    return idx;
};

function pet(id: string): Pet {
    return {
        id, name: `Pet ${id}`, element: 'Fire', role: 'assassin', rarity: 'standard',
        level: 30, hp: 400, attack: 50, defense: 30, speed: 35,
        jutsus: [{ name: 'Ember Jab', power: 90, kind: 'damage' }],
    } as unknown as Pet;
}

const makeWith = (rewardEligible: unknown) => createShowdownSession({
    sessionId: 'sess', playerName: 'Tester', format: '1v1', tier: 'scrapper', seed: 7,
    playerPets: [pet('p1')], enemyPets: [pet('e1')], enemyTeamName: 'Foes',
    rewardEligible: rewardEligible as boolean,
});

describe('showdown reward eligibility is sealed at start', () => {
    it('carries the flag through onto the session, both ways', () => {
        assert.equal(makeWith(false).rewardEligible, false);
        assert.equal(makeWith(true).rewardEligible, true);
    });

    it('seals a STRICT boolean, so a truthy stray value cannot buy a payout', () => {
        // If this ever softened to a bare `!!input.rewardEligible` or an
        // `input.rewardEligible ?? true`, a caller (or a body field that leaked
        // into the input object) could turn practice into a faucet with the
        // string "false", the number 1, or an empty object.
        for (const sneaky of ['true', 'false', 1, {}, [], 'yes']) {
            assert.equal(makeWith(sneaky).rewardEligible, false, `${JSON.stringify(sneaky)} must not be eligible`);
        }
        assert.equal(makeWith(undefined).rewardEligible, false, 'omitted is not eligible');
        assert.equal(makeWith(null).rewardEligible, false, 'null is not eligible');
    });
});

describe('showdown.ts wires practice as unpaid', () => {
    it('starts every session reward-INELIGIBLE', () => {
        indexOfOrFail('rewardEligible: false');
        assert.equal(
            src.includes('rewardEligible: true'),
            false,
            'no start path may seal itself eligible until a live (world-initiated) entry point exists',
        );
    });

    it('never takes eligibility from the request body', () => {
        // The whole point of sealing at start is that the client cannot argue
        // for its own payout. Any read off `body` here would defeat it.
        assert.equal(/body\.rewardEligible/.test(src), false, 'eligibility must never be read from the body');
        assert.equal(/rewardEligible\s*[:=]\s*(?!false\b)[A-Za-z_$]/.test(src), false,
            'eligibility must be a literal at the start site, not a variable a request can steer');
    });

    it('short-circuits an ineligible win BEFORE taking the save lock', () => {
        // Ordering matters twice over: a practice win must cost no lock and no
        // save write, and it must return before any counter is touched.
        const guard = indexOfOrFail('if (!session.rewardEligible)');
        const lock = indexOfOrFail('withKvLock(saveKey');
        assert.ok(guard < lock, 'the practice guard must precede withKvLock');
    });

    it('leaves ryo and BOTH win counters untouched on a practice win', () => {
        // totalPetWins feeds the public 'pets' leaderboard, the pet-100
        // achievement and a sector quest metric; dailyPetWins is the shared
        // 100/day faucet allowance. A free, unlimited practice mode must move
        // neither — otherwise it hands out rank and achievement progress for
        // nothing, and burns the player's real daily allowance for nothing.
        const guard = indexOfOrFail('if (!session.rewardEligible)');
        const practiceReturn = src.indexOf('return { reward: 0, practice: true };', guard);
        assert.ok(practiceReturn > guard, 'the practice branch returns a zero, practice-flagged settlement');

        const branch = src.slice(guard, practiceReturn);
        for (const forbidden of ['ryo', 'totalPetWins', 'dailyPetWins', 'writeSaveProjected', 'redeemedPetBattleTokens']) {
            assert.equal(branch.includes(forbidden), false, `the practice branch must not touch ${forbidden}`);
        }
    });
});
