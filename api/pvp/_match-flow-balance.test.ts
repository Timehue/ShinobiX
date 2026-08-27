import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PvpFighter, PvpGroundEffect, PvpSession, PvpStatus } from './session.js';
import {
    PVP_ABSOLUTE_SHIELD_CAP,
    applyGroundEffectToFighter,
    applyJutsu,
    applyPvpServerAutoWait,
    pvpLiveShieldCap,
    pvpNormalizedEffectiveHealth,
} from './move.js';
import { MAX_ROUNDS } from '../combat-core/constants.js';

type PvpRole = 'p1' | 'p2';
type StampedSession = PvpSession & { roundOpener?: PvpRole };
type TimedGroundEffect = PvpGroundEffect & { activeRound?: number };

const stats = Object.fromEntries([
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
].map((key) => [key, 500]));

function fighter(name: string, pos: number, patch: Partial<PvpFighter> = {}): PvpFighter {
    return {
        name,
        hp: 1_000,
        maxHp: 1_000,
        chakra: 1_000,
        maxChakra: 1_000,
        stamina: 1_000,
        maxStamina: 1_000,
        shield: 0,
        statuses: [],
        character: { name, level: 100, specialty: 'Ninjutsu', stats, jutsu: [], jutsuMastery: [] },
        pos,
        ...patch,
    };
}

function session(opener: PvpRole = 'p1', patch: Partial<PvpSession> = {}): StampedSession {
    return {
        battleId: `flow-${opener}`,
        p1: fighter('alice', 0),
        p2: fighter('bob', 1),
        round: 1,
        activePlayer: opener,
        roundOpener: opener,
        ap: { p1: 100, p2: 100 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: ['Battle begins.'],
        status: 'active',
        winner: null,
        joined: { p1: true, p2: true },
        rewardAuthority: 'challenge',
        createdAt: Date.now(),
        lastMoveAt: Date.now(),
        turnStartedAt: Date.now(),
        ...patch,
    } as StampedSession;
}

function advanceToNextRound(input: PvpSession): PvpSession {
    const startingRound = input.round;
    let next = input;
    while (next.status === 'active' && next.round === startingRound) {
        next = applyPvpServerAutoWait(next);
    }
    return next;
}

describe('opener-relative round flow', () => {
    for (const opener of ['p1', 'p2'] as const) {
        test(`${opener} opening still grants exactly ${MAX_ROUNDS} turns to each fighter`, () => {
            let current: PvpSession = session(opener);
            const turns = { p1: 0, p2: 0 };
            while (current.status === 'active') {
                turns[current.activePlayer]++;
                assert.ok(turns.p1 + turns.p2 <= MAX_ROUNDS * 2, 'match exceeded its bounded turn budget');
                current = applyPvpServerAutoWait(current);
            }

            assert.deepEqual(turns, { p1: MAX_ROUNDS, p2: MAX_ROUNDS });
            assert.equal(current.round, MAX_ROUNDS + 1);
            assert.equal(current.winner, 'draw');
        });
    }
});

describe('round-symmetric deferred lifecycle', () => {
    for (const opener of ['p1', 'p2'] as const) {
        const closer: PvpRole = opener === 'p1' ? 'p2' : 'p1';
        for (const caster of [opener, closer]) {
            const phase = caster === opener ? 'opener' : 'closer';
            test(`a deferred status cast by ${caster} as ${phase} lasts two complete active rounds`, () => {
                const deferred: PvpStatus = { name: 'Reflect', rounds: 2, percent: 30, kind: 'positive', activeRound: 2 };
                let current = session(opener, {
                    activePlayer: caster,
                    p1: fighter('alice', 0, { statuses: caster === 'p1' ? [deferred] : [] }),
                    p2: fighter('bob', 1, { statuses: caster === 'p2' ? [deferred] : [] }),
                });

                current = advanceToNextRound(current) as StampedSession;
                const atRound2 = caster === 'p1' ? current.p1.statuses : current.p2.statuses;
                assert.equal(current.round, 2);
                assert.equal(atRound2[0]?.rounds, 2, 'activation boundary must not consume a duration');

                current = advanceToNextRound(current) as StampedSession;
                const atRound3 = caster === 'p1' ? current.p1.statuses : current.p2.statuses;
                assert.equal(atRound3[0]?.rounds, 1);

                current = advanceToNextRound(current) as StampedSession;
                const atRound4 = caster === 'p1' ? current.p1.statuses : current.p2.statuses;
                assert.equal(atRound4.length, 0);
            });

            test(`a ground zone created by ${caster} as ${phase} affects exactly two target turns`, () => {
                const effect: TimedGroundEffect = {
                    id: `zone-${caster}`,
                    owner: caster,
                    name: 'Test Zone',
                    tiles: [caster === 'p1' ? 1 : 0],
                    rounds: 2,
                    activeRound: 2,
                    castPulseConsumed: caster === opener,
                    tags: [{ name: 'Decrease Damage Given', percent: 20 }],
                };
                let current = session(opener, { activePlayer: caster, groundEffects: [effect] });
                const target: PvpRole = caster === 'p1' ? 'p2' : 'p1';
                if (caster === opener) {
                    const targetFighter = target === 'p1' ? current.p1 : current.p2;
                    const castPulse = applyGroundEffectToFighter(targetFighter, effect, current.round, true);
                    current = target === 'p1'
                        ? { ...current, p1: castPulse.fighter, log: [...current.log, ...castPulse.lines] }
                        : { ...current, p2: castPulse.fighter, log: [...current.log, ...castPulse.lines] };
                }

                let affectedTargetTurns = 0;
                for (let handoff = 0; handoff < 8; handoff++) {
                    current = applyPvpServerAutoWait(current) as StampedSession;
                    if (current.activePlayer === target) {
                        const targetFighter = target === 'p1' ? current.p1 : current.p2;
                        if (targetFighter.statuses.some((status) => status.name === 'Decrease Damage Given')) {
                            affectedTargetTurns++;
                        }
                    }
                }

                assert.equal(affectedTargetTurns, 2, 'either casting phase must affect exactly the next two target turns');
                assert.equal(current.log.filter((line) => line.startsWith('Test Zone:')).length, 2,
                    'cast pulse plus recurrence, or two recurrences, must total two applications');
                assert.equal(current.groundEffects?.length, 0);
            });

            test(`Barrier cast by ${caster} as ${phase} is deferred for two complete rounds`, () => {
                const self = fighter(caster === 'p1' ? 'alice' : 'bob', caster === 'p1' ? 0 : 3);
                const opponent = fighter(caster === 'p1' ? 'bob' : 'alice', caster === 'p1' ? 3 : 0);
                const barrierJutsu = {
                    id: `barrier-${caster}`,
                    name: 'Test Barrier',
                    type: 'Ninjutsu',
                    target: 'OPPONENT',
                    method: 'SINGLE',
                    ap: 40,
                    effectPower: 0,
                    isUtility: true,
                    tags: [{ name: 'Barrier' }],
                };
                const cast = applyJutsu(self, opponent, barrierJutsu, 1, 'central', 1);
                const barrier = cast.self.statuses.find((status) => status.name === 'Barrier');
                assert.equal(barrier?.activeRound, 2, 'Barrier must not become active during its cast round');
                assert.equal(barrier?.rounds, 2);

                let current = session(opener, {
                    activePlayer: caster,
                    p1: caster === 'p1' ? cast.self : cast.opponent,
                    p2: caster === 'p2' ? cast.self : cast.opponent,
                });
                current = advanceToNextRound(current) as StampedSession;
                const atRound2 = caster === 'p1' ? current.p1.statuses : current.p2.statuses;
                assert.equal(atRound2.find((status) => status.name === 'Barrier')?.rounds, 2);

                current = advanceToNextRound(current) as StampedSession;
                const atRound3 = caster === 'p1' ? current.p1.statuses : current.p2.statuses;
                assert.equal(atRound3.find((status) => status.name === 'Barrier')?.rounds, 1);

                current = advanceToNextRound(current) as StampedSession;
                const atRound4 = caster === 'p1' ? current.p1.statuses : current.p2.statuses;
                assert.equal(atRound4.some((status) => status.name === 'Barrier'), false);
            });
        }
    }

    test('an off-target opener zone keeps both future recurrence rounds', () => {
        const effect: TimedGroundEffect = {
            id: 'off-target-opener-zone',
            owner: 'p1',
            name: 'Off-target Zone',
            tiles: [119],
            rounds: 2,
            activeRound: 2,
            castPulseConsumed: false,
            tags: [{ name: 'Decrease Damage Given', percent: 20 }],
        };
        const current = advanceToNextRound(session('p1', { groundEffects: [effect] }));

        assert.equal(current.round, 2);
        assert.equal(current.groundEffects?.[0]?.rounds, 2,
            'a phase alone must not age a zone whose cast pulse hit nobody');
    });
});

describe('bounded shield and normalized timeout score', () => {
    test('repeated shield casts cannot bank more than one bounded health bar', () => {
        const shieldJutsu = {
            id: 'shield-cap-test',
            name: 'Shield Cap Test',
            type: 'Ninjutsu',
            target: 'SELF',
            method: 'SINGLE',
            ap: 40,
            effectPower: 0,
            isUtility: true,
            tags: [{ name: 'Shield', percent: 0 }],
        };
        let self = fighter('alice', 0, {
            character: {
                name: 'alice', level: 100, specialty: 'Ninjutsu', stats,
                jutsu: [shieldJutsu], jutsuMastery: [{ jutsuId: shieldJutsu.id, level: 50 }],
            },
        });
        const opponent = fighter('bob', 1);

        for (let cast = 0; cast < 10; cast++) {
            self = applyJutsu(self, opponent, shieldJutsu, 1, 'central', cast + 1).self;
        }

        assert.equal(pvpLiveShieldCap(self), 1_000);
        assert.equal(self.shield, 1_000);
        assert.equal(PVP_ABSOLUTE_SHIELD_CAP, 5_000);
    });

    test('equal normalized effective health is a deterministic draw despite unequal raw HP', () => {
        const starting = session('p1', {
            round: MAX_ROUNDS,
            activePlayer: 'p2',
            p1: fighter('alice', 0, { hp: 500, maxHp: 1_000 }),
            p2: fighter('bob', 1, { hp: 1_000, maxHp: 2_000 }),
        });
        const done = applyPvpServerAutoWait(starting);
        assert.equal(done.status, 'done');
        assert.equal(done.winner, 'draw');
    });

    test('bounded shield counts in the normalized timeout result', () => {
        const starting = session('p1', {
            round: MAX_ROUNDS,
            activePlayer: 'p2',
            p1: fighter('alice', 0, { hp: 400, shield: 200 }),
            p2: fighter('bob', 1, { hp: 500 }),
        });
        const done = applyPvpServerAutoWait(starting);
        assert.equal(done.winner, 'p1');
        assert.match(done.log.at(-1) ?? '', /normalized effective health/i);
    });

    test('timeout resolves before an unmatched round-26 start-of-turn DoT', () => {
        const starting = session('p1', {
            round: MAX_ROUNDS,
            activePlayer: 'p2',
            p1: fighter('alice', 0, {
                hp: 500,
                statuses: [{ name: 'Wound', rounds: 2, amount: 100, kind: 'negative', activeRound: MAX_ROUNDS }],
            }),
            p2: fighter('bob', 1, { hp: 500 }),
        });
        const done = applyPvpServerAutoWait(starting);
        assert.equal(done.winner, 'draw');
        assert.equal(done.p1.hp, 500, 'the opener does not receive a 26th turn-start tick');
    });

    test('legacy oversized shields are clamped before scoring', () => {
        const starting = session('p1', {
            round: MAX_ROUNDS,
            activePlayer: 'p2',
            p1: fighter('alice', 0, { hp: 100, shield: 99_999 }),
            p2: fighter('bob', 1, { hp: 900, shield: 300 }),
        });
        const done = applyPvpServerAutoWait(starting);
        assert.equal(done.p1.shield, 1_000);
        assert.equal(done.winner, 'p2');
        assert.equal(pvpNormalizedEffectiveHealth(done.p1), 1.1);
        assert.equal(pvpNormalizedEffectiveHealth(done.p2), 1.2);
    });
});
