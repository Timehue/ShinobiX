import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseWarfrontChoiceLog,
    replayManualWarfront,
    replayManualWarfrontDetailed,
} from './battle-result.js';
import type {
    SealedManualWarfront,
    SealedWarfrontSlot,
} from './warfront-start.js';
import {
    sealedWarfrontCoachRounds,
    warfrontAiTacticalSetup,
} from './warfront-start.js';
import { appendManualWarfrontRound } from './_warfront-council.js';
import { DEFAULT_WARFRONT_AUTHORED_SETUP } from './_warfront-setup.js';
import {
    startWarfrontMatch,
    type WarfrontRoundChoice,
    type WfStance,
} from '../_pet-sim/pet-warfront-sim.js';
import type { Pet } from '../_pet-sim/pet-types.js';

type ServerArenaSlot = { role: SealedWarfrontSlot['role']; pet: Pet };

const ROLES = ['defender', 'tracker', 'assassin', 'sage'] as const;
const ELEMENTS = ['Earth', 'Water', 'Fire', 'Wind'] as const;

function slots(prefix: string, attack = 90, hp = 700): SealedWarfrontSlot[] {
    return ROLES.map((role, i) => ({
        role,
        pet: {
            id: `${prefix}-${i}`,
            name: `${prefix}${i}`,
            rarity: 'rare',
            hp,
            attack,
            defense: Math.max(5, Math.round(attack / 2)),
            speed: 60,
            element: ELEMENTS[i],
        },
    }));
}

function sealedManual(overrides: Partial<Pick<SealedManualWarfront, 'blue' | 'red' | 'seed'>> = {}): SealedManualWarfront {
    return {
        version: 1,
        seed: overrides.seed ?? 12345,
        blue: overrides.blue ?? slots('A'),
        red: overrides.red ?? slots('B'),
        options: {
            bluePolicy: 'off',
            redPolicy: 'balanced',
            blueStance: 'balanced',
            blueDoctrine: 'vanguard',
            adaptStances: true,
        },
    };
}

function authoredManual(seed = 12345): SealedManualWarfront {
    const red = warfrontAiTacticalSetup(seed);
    return {
        version: 1,
        seed,
        blue: slots('authored-blue'),
        red: slots('authored-red'),
        options: {
            bluePolicy: 'off',
            redPolicy: 'balanced',
            blueStance: 'balanced',
            redStance: red.stance,
            blueDoctrine: 'vanguard',
            redDoctrine: red.doctrine,
            blueDeployment: DEFAULT_WARFRONT_AUTHORED_SETUP.deployment,
            redDeployment: red.deployment,
            blueBuildPackage: 'hold-line',
            redBuildPackage: red.buildPackage,
            // Blue intentionally defers both one-shot calls to live Council.
            redObjectiveTechnique: red.objectiveTechnique,
            redCounterstrike: red.counterstrike,
            blueRoundDecisions: sealedWarfrontCoachRounds('contest'),
            redRoundDecisions: sealedWarfrontCoachRounds(red.coachOrder),
            adaptStances: true,
        },
    };
}

function asServerSlots(value: SealedWarfrontSlot[]): ServerArenaSlot[] {
    return value.map((slot) => ({ role: slot.role, pet: slot.pet as unknown as Pet }));
}

function playManual(value: SealedManualWarfront): { winner: 'blue' | 'red' | 'draw'; ticks: number; log: WarfrontRoundChoice[]; snapshotCount: number } {
    // The generated server engine is copied verbatim from the client source;
    // scripts/warfront-parity.test.ts separately proves the two execution paths
    // are byte-identical. Keeping this API test on the generated module also
    // preserves the server project's Node16 module boundary.
    const ctl = startWarfrontMatch(asServerSlots(value.blue), asServerSlots(value.red), value.seed, value.options);
    let guard = 0;
    while (!ctl.done && guard++ < 10) {
        if (ctl.round === 0) {
            ctl.advanceRound();
        } else {
            // Exercise both purchase and stance replay at the first Council;
            // later no-spend Councils still have to be present in the log.
            const choices = ctl.round === 1 ? [{ petIndex: 0, kind: 'strike' as const }] : [];
            const stance: WfStance | undefined = ctl.round === 1 ? 'siege' : undefined;
            ctl.advanceRound(choices, stance);
        }
    }
    const winner = ctl.result.winner;
    assert.ok(ctl.done && winner, 'fixture match must terminate');
    return {
        winner,
        ticks: ctl.result.ticks,
        log: ctl.result.choiceLog ?? [],
        snapshotCount: ctl.result.snapshots.length,
    };
}

test('Manual Warfront parser accepts bounded consecutive effective-choice shapes', () => {
    assert.deepEqual(parseWarfrontChoiceLog([
        { round: 1, choices: [{ petIndex: 0, kind: 'strike' }], stance: 'siege' },
        { round: 2, choices: [] },
    ]), [
        { round: 1, choices: [{ petIndex: 0, kind: 'strike' }], stance: 'siege' },
        { round: 2, choices: [] },
    ]);
    assert.equal(parseWarfrontChoiceLog([{ round: 2, choices: [] }]), null, 'a skipped first Council is invalid');
    assert.equal(parseWarfrontChoiceLog([{ round: 1, choices: [{ petIndex: 4, kind: 'strike' }] }]), null, 'pet indexes are bounded');
    assert.equal(parseWarfrontChoiceLog([{ round: 1, choices: [{ petIndex: 0, kind: 'forged' }] }]), null, 'powerup kinds are allowlisted');
    assert.equal(parseWarfrontChoiceLog([{ round: 1, choices: [], stance: 'forged' }]), null, 'stances are allowlisted');
    assert.deepEqual(parseWarfrontChoiceLog([{
        round: 1,
        choices: [],
        coachOrder: 'contest',
        buildPackage: 'hold-line',
        objectiveTechnique: 'hijack',
        counterstrike: 'bounty-hunt',
    }]), [{
        round: 1,
        choices: [],
        coachOrder: 'contest',
        buildPackage: 'hold-line',
        objectiveTechnique: 'hijack',
        counterstrike: 'bounty-hunt',
    }]);
    for (const forged of [
        { coachOrder: 'read-seed' },
        { buildPackage: 'instant-win' },
        { objectiveTechnique: 'always-steal' },
        { counterstrike: 'rewind' },
    ]) assert.equal(parseWarfrontChoiceLog([{ round: 1, choices: [], ...forged }]), null);
});

test('deferred Coach one-shot calls are effective once and frozen on retry', () => {
    const sealed = authoredManual();
    const binding = { playerName: 'Coach', battleToken: 'coach-token', reportKey: `${sealed.seed}:tactical` };
    const first = {
        round: 1,
        choices: [],
        coachOrder: 'contest' as const,
        objectiveTechnique: 'hijack' as const,
        counterstrike: 'bounty-hunt' as const,
    };
    const committed = appendManualWarfrontRound(null, binding, sealed, first, 1);
    assert.equal(committed.ok, true, 'deferred selectors must remain reachable at the first Council');
    if (!committed.ok) return;
    assert.deepEqual(
        appendManualWarfrontRound(committed.attempt, binding, sealed, { ...first, objectiveTechnique: 'zone' }, 2),
        { ok: false, code: 'path-conflict' },
        'a lost response cannot replace an accepted authored decision',
    );
    assert.deepEqual(
        appendManualWarfrontRound(committed.attempt, binding, sealed, {
            round: 2, choices: [], coachOrder: 'contest', objectiveTechnique: 'secure',
        }, 3),
        { ok: false, code: 'invalid-choice' },
        'a one-shot technique cannot be redeclared in a later Council',
    );
});

test('authored Coach decisions replay as complete sealed decision objects', () => {
    const sealed = authoredManual(24680);
    const ctl = startWarfrontMatch(asServerSlots(sealed.blue), asServerSlots(sealed.red), sealed.seed, sealed.options);
    let guard = 0;
    while (!ctl.done && guard++ < 10) {
        if (ctl.round === 0) ctl.advanceRound();
        else ctl.advanceRound({
            choices: [],
            coachOrder: 'contest',
            ...(ctl.round === 1 ? { objectiveTechnique: 'hijack' as const, counterstrike: 'bounty-hunt' as const } : {}),
        });
    }
    assert.ok(ctl.done && ctl.result.winner);
    const log = ctl.result.choiceLog ?? [];
    assert.equal(log.filter((entry) => entry.objectiveTechnique !== undefined).length, 1);
    assert.equal(log.filter((entry) => entry.counterstrike !== undefined).length, 1);
    const expected = ctl.result.winner === 'blue' ? 'win' : ctl.result.winner === 'red' ? 'loss' : 'draw';
    assert.deepEqual(replayManualWarfrontDetailed(sealed, log), { outcome: expected, ticks: ctl.result.ticks });
});

test('generated server simulation can omit frames without changing authoritative round state', () => {
    const sealed = sealedManual();
    const blue = asServerSlots(sealed.blue);
    const red = asServerSlots(sealed.red);
    const presented = startWarfrontMatch(blue, red, sealed.seed, sealed.options);
    const headless = startWarfrontMatch(blue, red, sealed.seed, {
        ...sealed.options,
        captureSnapshots: false,
    });

    presented.advanceRound();
    headless.advanceRound();

    const { snapshots: presentedFrames, ...presentedAuthority } = presented.result;
    const { snapshots: headlessFrames, ...headlessAuthority } = headless.result;
    assert.ok(presentedFrames.length > 0, 'snapshot capture remains the public default');
    assert.equal(headlessFrames.length, 0, 'server headless mode retains no presentation frames');
    assert.deepEqual(headlessAuthority, presentedAuthority,
        'winner inputs, events, ticks, coins, and choice state remain byte-for-byte equivalent');
});

test('a complete Manual Council log reproduces from the sealed server snapshot', () => {
    const sealed = sealedManual();
    const played = playManual(sealed);
    assert.ok(played.log.length > 0, 'fixture must reach at least one Council');
    assert.ok(played.snapshotCount > 0, 'the default presentation simulation must keep its replay frames');
    const expected = played.winner === 'blue' ? 'win' : played.winner === 'red' ? 'loss' : 'draw';
    assert.equal(replayManualWarfront(sealed, played.log), expected);
    assert.deepEqual(replayManualWarfrontDetailed(sealed, played.log), { outcome: expected, ticks: played.ticks });
});

test('Manual Warfront replay rejects missing, extra, and ineffective Council entries', () => {
    const sealed = sealedManual();
    const played = playManual(sealed);
    assert.ok(played.log.length > 0, 'fixture must reach at least one Council');

    assert.equal(replayManualWarfront(sealed, played.log.slice(0, -1)), null, 'missing final boundary must fail');
    const extra = [...played.log, { round: played.log.length + 1, choices: [] }];
    assert.equal(replayManualWarfront(sealed, extra), null, 'an unopened extra boundary must fail');

    const ineffective = structuredClone(played.log);
    ineffective[0].choices = Array.from({ length: 7 }, () => ({ petIndex: 0, kind: 'strike' as const }));
    assert.equal(replayManualWarfront(sealed, ineffective), null, 'unaffordable/capped requests cannot masquerade as effective buys');
});

test('a losing sealed replay cannot be promoted by a claimed win', () => {
    const sealed = sealedManual({ blue: slots('weak', 10, 200), red: slots('strong', 900, 4_000), seed: 77 });
    const played = playManual(sealed);
    assert.equal(played.winner, 'red', 'strength-skewed fixture must be a blue loss');
    const authoritative = replayManualWarfront(sealed, played.log);
    assert.equal(authoritative, 'loss');
    assert.notEqual(authoritative, 'win', 'the client claim is not an input to authoritative replay');

    const source = readFileSync(join(process.cwd(), 'api/pet/battle-result.ts'), 'utf8');
    const mismatchGuard = source.indexOf("if (outcome !== replayed.outcome)");
    const rewardLock = source.indexOf('withKvLock(saveKey');
    assert.ok(mismatchGuard >= 0 && rewardLock > mismatchGuard, 'claimed/manual mismatch is rejected before the reward lock');
});

test('the daily Warfront claim marker is written only after the reward save commits', () => {
    const source = readFileSync(join(process.cwd(), 'api/pet/battle-result.ts'), 'utf8');
    const rewardStart = source.indexOf('const isWarfrontWin');
    const committed = source.indexOf('await writeSaveProjected(saveKey, updated, record)', rewardStart);
    const dayKey = source.indexOf('await kv.set(firstWinKey', rewardStart);
    assert.ok(rewardStart >= 0 && committed > rewardStart && dayKey > committed,
        'failed reward persistence must not consume the first-win day key');
});
