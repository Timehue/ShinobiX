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
    it('keeps PRACTICE unpaid and confines payment to the arena entry', () => {
        // Two entry points, and the split IS the reward design:
        //   'start' — you choose the tier and the fight, without limit. Sparring.
        //   'arena' — the arena matches you, the daily cap is enforced, it pays.
        // The comment this test used to carry said "until a live entry point
        // exists". That entry point now exists, so the assertion moves from
        // "nothing pays" to "exactly one thing pays, and it is the right one".
        // Exactly THREE seal sites exist, and each is pinned to its entry:
        //   practice  → the literal false
        //   arena     → `!hollowGate`, i.e. it pays UNLESS the bout is bound to a
        //               Hollow Gate run, which pays through the run's own
        //               settlement instead. Paying both would be a double faucet.
        //   encounter → the literal false. An authored encounter (dungeon Rare
        //               Beast Seal, admin-authored VN pet battle) decides an
        //               OUTCOME; its rewards belong to the dungeon run's own
        //               settlement and the event's completion.
        const seals = [...src.matchAll(/rewardEligible: ([^,\n]+)/g)].map((m) => m[1].trim());
        assert.deepEqual(seals, ['false', '!hollowGate', 'false'], 'only these three seal forms may exist, in this order');

        const practiceAt = indexOfOrFail("action === 'start'");
        const arenaAt = indexOfOrFail("action === 'arena'");
        const encounterAt = indexOfOrFail("action === 'encounter'");
        const paidSeal = src.indexOf('rewardEligible: !hollowGate');
        const practiceSeal = src.indexOf('rewardEligible: false');
        const encounterSeal = src.indexOf('rewardEligible: false', arenaAt);
        assert.ok(paidSeal > arenaAt && paidSeal < encounterAt, 'the paying seal belongs to the arena entry');
        assert.ok(practiceSeal > practiceAt && practiceSeal < arenaAt, 'the practice entry seals itself unpaid');
        assert.ok(encounterSeal > encounterAt, 'the authored-encounter entry seals itself unpaid');

        // An authored encounter must never take the opponent from the request —
        // that is the whole reason it took this long to port. It names WHICH
        // authored fight it is in; the server rebuilds the opponent from its own
        // content. A stat, level or kit read off the body here would reopen the
        // surface the mint-token pattern exists to close.
        const encounterBlock = src.slice(encounterAt, src.indexOf('const sessionIdRaw', encounterAt));
        for (const forbidden of ['body.hp', 'body.attack', 'body.defense', 'body.speed', 'body.level', 'body.enemy', 'body.opponent', 'body.tier']) {
            assert.equal(encounterBlock.includes(forbidden), false, `the authored entry must not read ${forbidden}`);
        }
        assert.ok(/buildDungeonSealBeast|buildAuthoredEventBeast/.test(encounterBlock),
            'its opponent comes from the server-side authored-encounter builders');
        assert.ok(encounterBlock.includes('dungeonSealRunIssue'),
            'and a dungeon seal is gated on the player\'s own active run');

        // `hollowGate` must be SERVER-derived — built only after the run token
        // and combat binding validate — never lifted from the body. A client
        // can therefore make itself ineligible (harmless) but can never argue
        // itself INTO a payout.
        const arenaBlock = src.slice(arenaAt, encounterAt);
        assert.ok(/hollowGate = \{ runId, petIds/.test(arenaBlock), 'the binding is constructed server-side');
        assert.ok(arenaBlock.includes('validateHollowGatePetClaim'), 'and only after the run claim validates');
    });

    it('never lets the paying entry take its tier or skip its cap', () => {
        // The payout rides on sealedOpponentLevel, derived from the opponent the
        // SERVER builds. A body-supplied tier would let a player dial the
        // opposition down and farm the faucet at full price.
        const arenaAt = indexOfOrFail("action === 'arena'");
        const arenaBlock = src.slice(arenaAt, indexOfOrFail("action === 'encounter'"));
        assert.equal(/body\.tier/.test(arenaBlock), false, 'the arena entry must not read a tier from the body');
        assert.ok(/const tier: ShowdownTier = avgLevel/.test(arenaBlock), 'its tier is derived from the team brought');
        assert.ok(arenaBlock.includes('DAILY_ARENA_WIN_CAP'), 'it checks the daily cap BEFORE the fight, not only at settlement');
    });

    it('confines the sparring flag to the unpaid practice entry', () => {
        // Sparring lets the CALLER ask for a rolled tier and a level-mirrored AI
        // team. That is safe only where it lives: the practice entry, which seals
        // itself unpaid whatever the body says. On the arena entry the same flag
        // would be a difficulty dial on a faucet — the exact thing `body.tier` is
        // already barred from doing there.
        const practiceAt = indexOfOrFail("action === 'start'");
        const arenaAt = indexOfOrFail("action === 'arena'");
        const sparringReads = [...src.matchAll(/body\.sparring/g)].map((m) => m.index ?? -1);
        assert.ok(sparringReads.length > 0, 'the practice entry reads the sparring flag');
        for (const at of sparringReads) {
            assert.ok(at > practiceAt && at < arenaAt, 'body.sparring may only be read inside the practice entry');
        }
    });

    it('never takes eligibility from the request body', () => {
        // The whole point of sealing at start is that the client cannot argue
        // for its own payout. Any read off `body` here would defeat it.
        assert.equal(/body\.rewardEligible/.test(src), false, 'eligibility must never be read from the body');
        assert.equal(/rewardEligible\s*[:=]\s*(?!true\b|false\b)[A-Za-z_$]/.test(src), false,
            'eligibility must be a literal at each seal site, not a variable a request can steer');
    });

    it('makes a forfeit a CONCESSION, so a bound encounter still gets an outcome', () => {
        // A forfeit used to delete the session and answer ok. Harmless while
        // every bout was practice; the moment one could be BOUND to a Hollow
        // Gate encounter it became a way to walk out of a fight the run was
        // waiting on — the receipt is minted by the finishing turn, so a deleted
        // session left the Gate sealed with no outcome to settle and no path
        // back to one.
        const forfeitAt = indexOfOrFail("action === 'forfeit'");
        const branch = src.slice(forfeitAt, indexOfOrFail("action === 'turn'"));
        assert.ok(/session\.finished = true/.test(branch), 'a forfeit must DECIDE the session');
        assert.ok(/session\.outcome = 'loss'/.test(branch), 'and decide it as a loss');
        assert.ok(branch.includes('mintHollowGatePetReceipt'),
            'a bound bout must still mint the receipt its run settles with');
        // Conceding must never be a way to be paid. settleShowdownWin is only
        // reached from the finishing turn, and only on a win.
        assert.equal(branch.includes('settleShowdownWin'), false,
            'a concession must not reach the payout path');
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
