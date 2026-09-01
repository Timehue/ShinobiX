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
import { after, describe, it } from 'node:test';
import { createShowdownSession } from '../_pet-showdown/engine.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { SHOWDOWN_DAILY_WIN_CAP } from '../../shared/pet-showdown-contract.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ENABLE_LEGACY = '1';

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ENABLE_LEGACY;
});

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
        // Exactly FOUR seal sites exist, and each is pinned to its entry:
        //   crisis    → the literal false. The level-80 companion front pays
        //               only through the shared village witness ledger.
        //   practice  → the literal false
        //   arena     → `!hollowGate`, i.e. it pays UNLESS the bout is bound to a
        //               Hollow Gate run, which pays through the run's own
        //               settlement instead. Paying both would be a double faucet.
        //   encounter → the literal false. An authored encounter (dungeon Rare
        //               Beast Seal, admin-authored VN pet battle) decides an
        //               OUTCOME; its rewards belong to the dungeon run's own
        //               settlement and the event's completion.
        const seals = [...src.matchAll(/rewardEligible: ([^,\n]+)/g)].map((m) => m[1].trim());
        assert.deepEqual(seals, ['false', 'false', '!hollowGate', 'false'], 'only these four seal forms may exist, in this order');

        const crisisAt = indexOfOrFail("action === 'world-crisis-80'");
        const practiceAt = indexOfOrFail("action === 'start'");
        // The paid branch is matched on its FULL opening line, not on a bare
        // `action === 'arena'`: the Hollow Gate admission guard below tests the
        // same action earlier in the file, so the loose needle would bind
        // arenaAt to that guard and every ordering assertion here would be
        // measuring the wrong block.
        const arenaAt = indexOfOrFail("if (action === 'arena') {");
        const encounterAt = indexOfOrFail("action === 'encounter'");
        const hollowGateRetirement = indexOfOrFail("action === 'arena' && body.hollowGate != null");
        const paidSeal = src.indexOf('rewardEligible: !hollowGate');
        const crisisSeal = src.indexOf('rewardEligible: false', crisisAt);
        const practiceSeal = src.indexOf('rewardEligible: false', practiceAt);
        const encounterSeal = src.indexOf('rewardEligible: false', arenaAt);
        assert.ok(crisisSeal > crisisAt && crisisSeal < practiceAt, 'the world-crisis entry seals itself unpaid');
        assert.ok(paidSeal > arenaAt && paidSeal < encounterAt, 'the paying seal belongs to the arena entry');
        assert.ok(practiceSeal > practiceAt && practiceSeal < arenaAt, 'the practice entry seals itself unpaid');
        assert.ok(hollowGateRetirement < arenaAt, 'new Hollow Gate Showdown admission must fail before the paid arena branch');
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
        // Same full-line needle as above, and bounded at the encounter entry
        // rather than at `const sessionIdRaw` — that marker now sits PAST the
        // encounter branch, so the looser bound would sweep the authored entry
        // into the arena block and test the wrong code.
        const arenaAt = indexOfOrFail("if (action === 'arena') {");
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
        // Full opening line, as above: the Hollow Gate admission guard tests
        // `action === 'arena'` BEFORE the practice entry, so the loose needle
        // would put arenaAt ahead of practiceAt and make the range below
        // unsatisfiable for every reader.
        const arenaAt = indexOfOrFail("if (action === 'arena') {");
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

    it('suppresses ordinary settlement before validating a retained bound terminal', () => {
        const terminalAt = indexOfOrFail("if (action === 'turn')");
        const sidecarAt = src.indexOf('const hgBinding = await kv.get<ShowdownHollowGateBinding>', terminalAt);
        const crisisSidecarAt = src.indexOf('const crisisBinding = await kv.get<ShowdownWorldCrisis80Binding>', terminalAt);
        const paidAt = src.indexOf("if (!hgBinding && !crisisBinding && session.outcome === 'win')", terminalAt);
        const exactParentAt = src.indexOf("hollowGatePetAuthorityMatches(parent, 'showdown', session.sessionId)", terminalAt);
        assert.ok(sidecarAt > terminalAt && sidecarAt < paidAt,
            'the server-only HG sidecar must load before ordinary Showdown settlement');
        assert.ok(crisisSidecarAt > terminalAt && crisisSidecarAt < paidAt,
            'the server-only crisis sidecar must also load before ordinary Showdown settlement');
        assert.ok(exactParentAt > paidAt,
            'retained HG recovery validates its exact parent only after paid settlement has been suppressed');
    });

    it('transfers paid win witness and Legacy semantics exactly once, with receipt-aware recovery', async () => {
        const playerName = 'showdownparityprobe';
        const session = createShowdownSession({
            sessionId: 'ShowdownParityReceipt01', playerName, format: '1v1', tier: 'scrapper', seed: 17,
            playerPets: [pet('p1')], enemyPets: [pet('e1')], enemyTeamName: 'Foes', rewardEligible: true,
        });
        const [{ kv }, { settleShowdownWin }, { bumpLegacyStats }] = await Promise.all([
            import('../_storage.js'),
            import('./showdown.js'),
            import('../_legacy-track.js'),
        ]);
        await kv.set(`save:${playerName}`, {
            _saveVersion: 1,
            character: {
                name: playerName, level: 30, ryo: 10, totalPetWins: 4, dailyPetWins: 2,
                lastDailyReset: new Date().toISOString().slice(0, 10), starterCardsClaimed: true,
                tileCards: [], pets: [{ ...pet('p1'), nickname: 'Witness Ember', chronicleArenaWins: 9 }],
            },
        });

        const first = await settleShowdownWin(playerName, session);
        assert.ok(Number(first.reward) > 0);
        assert.equal(first.progressionEligible, true);
        assert.equal(first.totalPetWins, 5);
        assert.equal(first.dailyPetWins, 3);
        assert.deepEqual(first.chronicleCards, ['pet-witness-fire']);
        assert.deepEqual(first.livingWitnessProgress, [{
            sourceReceipt: 'sd:ShowdownParityReceipt01',
            petId: 'p1',
            petName: 'Pet p1',
            cardId: 'pet-witness-fire',
            wins: 10,
            threshold: 10,
            deedRecorded: true,
            cardPressed: true,
        }]);

        // Model a process stopping after the paid save write but before its
        // best-effort Legacy hook. A terminal replay must advertise that one
        // missing side effect without paying or witnessing again.
        const recovery = await settleShowdownWin(playerName, session);
        assert.equal(recovery.reward, 0);
        assert.equal(recovery.progressionEligible, true);
        assert.deepEqual(recovery.chronicleCards, ['pet-witness-fire']);
        await bumpLegacyStats(playerName, { petDuelWins: 1 }, {
            receiptId: `pet-showdown:${session.sessionId}`,
            // The helper itself is covered in _legacy-defs.test. Keep this test
            // free of a static storage import so its QA-memory flag is in place
            // before _storage chooses a backend.
            characterForBootstrap: {
                ...(recovery.character as Record<string, unknown>),
                totalPetWins: Math.max(0, Number((recovery.character as Record<string, unknown>).totalPetWins ?? 0) - 1),
            },
        });
        const statsAfterRepair = await kv.get<Record<string, unknown>>(`legacy:stats:${playerName}`);
        assert.equal(statsAfterRepair?.petDuelWins, 5,
            'first-touch bootstrap counts the four historical wins plus this receipt exactly once');
        const saveAfterRepair = await kv.get<Record<string, unknown>>(`save:${playerName}`);

        const replay = await settleShowdownWin(playerName, session);
        assert.equal(replay.reward, 0);
        assert.equal(replay.progressionEligible, false, 'a recorded Legacy receipt suppresses normal replay work');
        assert.equal(replay.totalPetWins, 5);
        assert.equal(replay.dailyPetWins, 3);
        assert.deepEqual(replay.chronicleCards, ['pet-witness-fire']);
        assert.deepEqual(await kv.get(`legacy:stats:${playerName}`), statsAfterRepair);
        const saveAfterReplay = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        assert.equal(saveAfterReplay?._saveVersion, saveAfterRepair?._saveVersion, 'terminal replay does not rewrite counters or witness state');

        const paidMarker = await kv.get<Record<string, unknown>>(`pet:battle-paid:${playerName}:sd:${session.sessionId}`);
        assert.equal(paidMarker?.legacyApplied, true, 'the finite session keeps a durable Legacy-applied marker');
        await kv.set(`legacy:stats:${playerName}`, { ...statsAfterRepair, activityReceipts: [] });
        const afterReceiptRotation = await settleShowdownWin(playerName, session);
        assert.equal(afterReceiptRotation.progressionEligible, false,
            'rolling Legacy history cannot reopen a still-replayable terminal session');
        assert.equal(afterReceiptRotation.totalPetWins, 5);
        assert.deepEqual(afterReceiptRotation.chronicleCards, ['pet-witness-fire']);
    });

    it('credits Living Witness only to the immutable opening field, never an unproven bench selection', async () => {
        const playerName = 'showdownfieldwitness';
        const session = createShowdownSession({
            sessionId: 'ShowdownFieldReceipt01', playerName, format: '1v1', tier: 'scrapper', seed: 23,
            playerPets: [pet('lead'), pet('bench-a'), pet('bench-b')],
            enemyPets: [pet('enemy-lead'), pet('enemy-a'), pet('enemy-b')],
            enemyTeamName: 'Foes', rewardEligible: true,
        });
        const [{ kv }, { settleShowdownWin }] = await Promise.all([
            import('../_storage.js'),
            import('./showdown.js'),
        ]);
        await kv.set(`save:${playerName}`, {
            _saveVersion: 1,
            character: {
                name: playerName, level: 30, ryo: 0, totalPetWins: 0, dailyPetWins: 0,
                lastDailyReset: new Date().toISOString().slice(0, 10), tileCards: [],
                pets: [pet('lead'), pet('bench-a'), pet('bench-b')],
            },
        });

        const settled = await settleShowdownWin(playerName, session);
        assert.deepEqual(
            (settled.livingWitnessProgress as Array<Record<string, unknown>>).map((entry) => entry.petId),
            ['lead'],
        );
        const character = settled.character as Record<string, unknown>;
        const wins = Object.fromEntries((character.pets as Array<Record<string, unknown>>)
            .map((entry) => [entry.id, Number(entry.chronicleArenaWins ?? 0)]));
        assert.deepEqual(wins, { lead: 1, 'bench-a': 0, 'bench-b': 0 });
    });

    it('stops all paid progression at the Showdown daily cap', async () => {
        const playerName = 'showdowncapprobe';
        const session = createShowdownSession({
            sessionId: 'ShowdownCapReceipt01', playerName, format: '1v1', tier: 'scrapper', seed: 19,
            playerPets: [pet('p1')], enemyPets: [pet('e1')], enemyTeamName: 'Foes', rewardEligible: true,
        });
        const [{ kv }, { settleShowdownWin }] = await Promise.all([
            import('../_storage.js'),
            import('./showdown.js'),
        ]);
        await kv.set(`save:${playerName}`, {
            _saveVersion: 1,
            character: {
                name: playerName, level: 30, ryo: 10, totalPetWins: 40,
                dailyPetWins: SHOWDOWN_DAILY_WIN_CAP, lastDailyReset: new Date().toISOString().slice(0, 10),
                starterCardsClaimed: true, tileCards: [],
                pets: [{ ...pet('p1'), chronicleArenaWins: 9 }],
            },
        });

        const capped = await settleShowdownWin(playerName, session);
        assert.equal(capped.capped, true);
        assert.equal(capped.reward, 0);
        assert.equal(capped.progressionEligible, undefined);
        assert.equal(capped.totalPetWins, 40);
        assert.deepEqual(capped.chronicleCards, undefined);
        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const character = save?.character as Record<string, unknown>;
        assert.equal(save?._saveVersion, 1);
        assert.equal(character.ryo, 10);
        assert.equal(character.totalPetWins, 40);
        assert.equal(((character.pets as Array<Record<string, unknown>>)[0]).chronicleArenaWins, 9);
        assert.deepEqual(character.tileCards, []);
        assert.equal(await kv.get(`legacy:stats:${playerName}`), null);
    });
});
