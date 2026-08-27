import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
    ARCHETYPES,
    applyJutsu,
    evaluateTournamentIntegrity,
    makeChampion,
    runTournament,
    scoredRate,
    sealAPlayerAuthoredLoadout,
    simulateFight,
    takeTurn,
    type FightRunner,
    type Seat,
} from './pvp-formula-sim.js';
import { bloodlinePoints, pointBudgetForRank } from '../api/_jutsu-points.js';

const A_RANK = 'A Rank';
const FORTY_AP_BLOCKED_TAGS = new Set(['Pierce', 'Siphon', 'Mirror', 'Copy', 'Wound']);
const BLOODLINE_UNIQUE_TAGS = new Set([
    'Stun', 'Bloodline Seal', 'Buff Prevent', 'Debuff Prevent', 'Elemental Seal',
    'Mirror', 'Copy', 'Lag', 'Overclock', 'Pierce',
]);

function result(winner: Seat | 'draw', opener: Seat) {
    return { winner, opener, turns: 1, p1Dealt: 0, p2Dealt: 0 } as const;
}

function twoFighterRoster() {
    return [
        makeChampion('Alpha', 'Standard-Meta'),
        makeChampion('Bravo', 'Tempo'),
    ] as const;
}

describe('PvP formula simulator tournament integrity', () => {
    test('Pierce bypasses shield without consuming it', () => {
        const attacker = makeChampion('Piercer', 'Standard-Meta');
        const defender = makeChampion('Shielded', 'Standard-Meta');
        defender.shield = 1_000;
        const beforeHp = defender.hp;

        const result = applyJutsu(attacker, defender, {
            id: 'pierce-test', name: 'Pierce Test', type: 'Ninjutsu',
            apCost: 60, effectPower: 40, chakraCost: 0, cooldown: 7,
            tags: [{ name: 'Pierce' }],
        } as never, 1);

        assert.ok(result.dealt > 0);
        assert.ok(defender.hp < beforeHp);
        assert.equal(defender.shield, 1_000);
    });

    test('models the live two-round Copy/Mirror contract and prevention gates', () => {
        const copyUser = makeChampion('Copy User', 'Disruption');
        const copyTarget = makeChampion('Copy Target', 'Standard-Meta');
        copyTarget.statuses = [
            { name: 'Reflect', rounds: 1, inactiveRound: 2, percent: 30, kind: 'positive' },
            { name: 'Absorb', rounds: 2, percent: 30, kind: 'positive' },
            { name: 'Lifesteal', rounds: 2, percent: 30, kind: 'positive' },
            { name: 'Increase Heal', rounds: 2, activeRound: 2, percent: 30, kind: 'positive' },
        ];
        applyJutsu(copyUser, copyTarget, {
            id: 'copy-contract', name: 'Copy Contract', type: 'Genjutsu',
            apCost: 60, effectPower: 40, chakraCost: 0, cooldown: 7,
            tags: [{ name: 'Copy' }],
        } as never, 1);
        const copiedReflect = copyUser.statuses.find(status => status.name === 'Reflect');
        assert.deepEqual(
            { rounds: copiedReflect?.rounds, activeRound: copiedReflect?.activeRound },
            { rounds: 2, activeRound: 2 },
        );
        assert.equal(copiedReflect?.inactiveRound, undefined, 'Copy clears the source retirement boundary');
        assert.equal(copyUser.statuses.some(status => status.name === 'Absorb'), false);
        assert.equal(copyUser.statuses.some(status => status.name === 'Lifesteal'), false);
        assert.equal(copyUser.statuses.some(status => status.name === 'Increase Heal'), false);

        const blockedCopyUser = makeChampion('Blocked Copy', 'Disruption');
        blockedCopyUser.statuses = [{ name: 'Buff Prevent', rounds: 2, kind: 'negative' }];
        applyJutsu(blockedCopyUser, copyTarget, {
            id: 'blocked-copy', name: 'Blocked Copy', type: 'Genjutsu',
            apCost: 60, effectPower: 40, chakraCost: 0, cooldown: 7,
            tags: [{ name: 'Copy' }],
        } as never, 1);
        assert.equal(blockedCopyUser.statuses.some(status => status.name === 'Reflect'), false);

        const mirrorUser = makeChampion('Mirror User', 'Disruption');
        const mirrorTarget = makeChampion('Mirror Target', 'Standard-Meta');
        mirrorUser.statuses = [
            { name: 'Decrease Damage Given', rounds: 1, inactiveRound: 2, percent: 30, kind: 'negative' },
            { name: 'Wound', rounds: 1, amount: 100, kind: 'negative' },
            { name: 'Ignition', rounds: 1, percent: 20, kind: 'negative' },
            { name: 'Poison', rounds: 1, percent: 6, kind: 'negative' },
            { name: 'Drain', rounds: 1, amount: 50, kind: 'negative' },
            { name: 'Buff Prevent', rounds: 2, activeRound: 2, kind: 'negative' },
        ];
        applyJutsu(mirrorUser, mirrorTarget, {
            id: 'mirror-contract', name: 'Mirror Contract', type: 'Genjutsu',
            apCost: 60, effectPower: 40, chakraCost: 0, cooldown: 7,
            tags: [{ name: 'Mirror' }],
        } as never, 1);
        assert.deepEqual(
            mirrorTarget.statuses.map(status => [status.name, status.rounds, status.activeRound]),
            [
                ['Decrease Damage Given', 2, 2],
                ['Wound', 2, 2],
                ['Ignition', 2, 2],
                ['Poison', 2, 2],
                ['Drain', 2, 2],
            ],
        );
        assert.equal(mirrorUser.statuses.length, 6, 'Mirror leaves every original debuff on the caster');
        assert.equal(
            mirrorTarget.statuses.find(status => status.name === 'Decrease Damage Given')?.inactiveRound,
            undefined,
            'Mirror clears the source retirement boundary',
        );

        const blockedMirrorTarget = makeChampion('Blocked Mirror', 'Standard-Meta');
        blockedMirrorTarget.statuses = [{ name: 'Debuff Prevent', rounds: 2, kind: 'positive' }];
        applyJutsu(mirrorUser, blockedMirrorTarget, {
            id: 'blocked-mirror', name: 'Blocked Mirror', type: 'Genjutsu',
            apCost: 60, effectPower: 40, chakraCost: 0, cooldown: 7,
            tags: [{ name: 'Mirror' }],
        } as never, 1);
        assert.deepEqual(blockedMirrorTarget.statuses.map(status => status.name), ['Debuff Prevent']);
    });

    test('Cleanse, Clear, and Stun consumption preserve pending next-round statuses', () => {
        const cleanser = makeChampion('Cleanser', 'Standard-Meta');
        const cleanserTarget = makeChampion('Cleanser Target', 'Standard-Meta');
        cleanser.statuses = [
            { name: 'Ignition', rounds: 2, percent: 30, kind: 'negative' },
            { name: 'Drain', rounds: 2, amount: 50, kind: 'negative' },
            { name: 'Poison', rounds: 2, activeRound: 2, percent: 6, kind: 'negative' },
        ];
        takeTurn(cleanser, cleanserTarget, 1);
        assert.equal(cleanser.statuses.some(status => status.name === 'Ignition'), false);
        assert.equal(cleanser.statuses.some(status => status.name === 'Drain'), false);
        assert.ok(
            cleanser.statuses.some(status => status.name === 'Poison' && status.activeRound === 2),
            'Cleanse preserves a pending Mirror debuff',
        );

        const clearer = makeChampion('Clearer', 'Standard-Meta');
        const clearTarget = makeChampion('Clear Target', 'Standard-Meta');
        clearTarget.statuses = [
            { name: 'Reflect', rounds: 2, percent: 30, kind: 'positive' },
            { name: 'Increase Heal', rounds: 2, percent: 30, kind: 'positive' },
            { name: 'Overclock', rounds: 1, activeRound: 2, percent: 20, kind: 'positive' },
        ];
        takeTurn(clearer, clearTarget, 1);
        assert.equal(clearTarget.statuses.some(status => status.name === 'Reflect'), false);
        assert.equal(clearTarget.statuses.some(status => status.name === 'Increase Heal'), false);
        assert.ok(
            clearTarget.statuses.some(status => status.name === 'Overclock' && status.activeRound === 2),
            'Clear preserves a pending Copy buff',
        );

        const stunned = makeChampion('Stunned', 'Standard-Meta');
        const stunTarget = makeChampion('Stun Target', 'Standard-Meta');
        stunned.statuses = [
            { name: 'Stun', rounds: 1, kind: 'negative' },
            { name: 'Stun', rounds: 1, activeRound: 2, kind: 'negative' },
        ];
        takeTurn(stunned, stunTarget, 1);
        assert.deepEqual(
            stunned.statuses.filter(status => status.name === 'Stun').map(status => status.activeRound),
            [2],
            'consuming active Stun preserves its pending refresh',
        );
    });

    test('every champion uses an idempotent creator-legal A-rank jutsu kit', () => {
        for (const archetype of ARCHETYPES) {
            const champion = makeChampion(archetype, archetype);
            const kit = champion.jutsu;

            assert.ok(kit.length > 0 && kit.length <= 5, `${archetype} must have 1-5 sealed jutsu`);
            assert.deepEqual(
                sealAPlayerAuthoredLoadout(kit),
                kit,
                `${archetype} must survive a second live-schema round trip unchanged`,
            );

            const ids = new Set<string>();
            const usedUniqueTags = new Set<string>();
            const pointShape = kit.map(jutsu => ({
                ap: jutsu.apCost,
                range: 4,
                target: jutsu.apCost === 40 ? 'SELF' : 'OPPONENT',
                method: 'SINGLE',
                effectPower: jutsu.effectPower,
                cooldown: jutsu.cooldown,
                tags: jutsu.tags,
            }));
            assert.ok(
                bloodlinePoints(pointShape, A_RANK) <= pointBudgetForRank(A_RANK),
                `${archetype} must stay within the live A-rank point budget`,
            );

            for (const jutsu of kit) {
                assert.ok(!ids.has(jutsu.id), `${archetype} cannot repeat jutsu id ${jutsu.id}`);
                ids.add(jutsu.id);
                assert.ok(jutsu.apCost === 40 || jutsu.apCost === 60);
                assert.equal(jutsu.cooldown, 7);
                assert.ok(jutsu.tags.length <= (jutsu.apCost === 40 ? 3 : 2));
                if (jutsu.apCost === 40) {
                    assert.equal(jutsu.type, 'Any');
                    assert.equal(jutsu.effectPower, 0);
                }

                for (const tag of jutsu.tags) {
                    assert.ok([0, 25, 30].includes(tag.percent ?? 0),
                        `${archetype}/${jutsu.name}/${tag.name} must use an A-rank creator magnitude`);
                    assert.equal(jutsu.apCost === 40 && FORTY_AP_BLOCKED_TAGS.has(tag.name), false,
                        `${archetype}/${jutsu.name} has live-illegal 40-AP tag ${tag.name}`);
                    if (BLOODLINE_UNIQUE_TAGS.has(tag.name)) {
                        assert.equal(usedUniqueTags.has(tag.name), false,
                            `${archetype} repeats bloodline-unique tag ${tag.name}`);
                        usedUniqueTags.add(tag.name);
                    }
                }
            }
        }
    });

    test('crosses both fighter seat and opener for every unordered pair', () => {
        const calls: Array<{ p1: string; p2: string; opener: Seat }> = [];
        const fight: FightRunner = (p1, p2, opener) => {
            calls.push({ p1: p1.name, p2: p2.name, opener });
            return result('draw', opener);
        };

        const report = runTournament(twoFighterRoster(), fight);

        assert.equal(report.totalFights, 4);
        assert.deepEqual(calls, [
            { p1: 'Alpha', p2: 'Bravo', opener: 'p1' },
            { p1: 'Alpha', p2: 'Bravo', opener: 'p2' },
            { p1: 'Bravo', p2: 'Alpha', opener: 'p1' },
            { p1: 'Bravo', p2: 'Alpha', opener: 'p2' },
        ]);
    });

    test('rejects 100% P1-seat dominance even when crossed entrants and matchups look 50/50', () => {
        const alwaysP1: FightRunner = (_p1, _p2, opener) => result('p1', opener);
        const report = runTournament(twoFighterRoster(), alwaysP1);

        assert.equal(scoredRate(report.seats.p1), 1);
        assert.equal(scoredRate(report.opener), 0.5);
        assert.deepEqual(report.entrants.Alpha, { wins: 2, losses: 2, draws: 0, games: 4 });
        assert.deepEqual(report.entrants.Bravo, { wins: 2, losses: 2, draws: 0, games: 4 });
        assert.equal(scoredRate(report.matchups['Standard-Meta'].Tempo), 0.5);
        assert.ok(evaluateTournamentIntegrity(report).some(issue => issue.code === 'SEAT_DOMINANCE'));
    });

    test('rejects 100% opener dominance even when seats, entrants, and matchups look 50/50', () => {
        const openerAlwaysWins: FightRunner = (_p1, _p2, opener) => result(opener, opener);
        const report = runTournament(twoFighterRoster(), openerAlwaysWins);

        assert.equal(scoredRate(report.seats.p1), 0.5);
        assert.equal(scoredRate(report.seats.p2), 0.5);
        assert.equal(scoredRate(report.opener), 1);
        assert.deepEqual(report.entrants.Alpha, { wins: 2, losses: 2, draws: 0, games: 4 });
        assert.deepEqual(report.entrants.Bravo, { wins: 2, losses: 2, draws: 0, games: 4 });
        assert.equal(scoredRate(report.matchups['Standard-Meta'].Tempo), 0.5);
        assert.ok(evaluateTournamentIntegrity(report).some(issue => issue.code === 'OPENER_DOMINANCE'));
    });

    test('aggregates directional matchup wins, losses, and draws reciprocally', () => {
        const winners: Array<Seat | 'draw'> = ['p1', 'draw', 'p2', 'draw'];
        let call = 0;
        const fight: FightRunner = (_p1, _p2, opener) => result(winners[call++]!, opener);
        const report = runTournament(twoFighterRoster(), fight);
        const standardVsTempo = report.matchups['Standard-Meta'].Tempo;
        const tempoVsStandard = report.matchups.Tempo['Standard-Meta'];

        assert.deepEqual(standardVsTempo, { wins: 2, losses: 0, draws: 2, games: 4 });
        assert.deepEqual(tempoVsStandard, { wins: 0, losses: 2, draws: 2, games: 4 });
        assert.equal(scoredRate(standardVsTempo), 0.75);
        assert.equal(scoredRate(tempoVsStandard), 0.25);
        assert.equal(scoredRate(standardVsTempo) + scoredRate(tempoVsStandard), 1);
        assert.deepEqual(report.integrityIssues, []);
    });

    test('real model conserves all crossed fight tallies', () => {
        const report = runTournament([
            makeChampion('Standard', 'Standard-Meta'),
            makeChampion('Dot', 'DoT-Sustain'),
            makeChampion('Tempo', 'Tempo'),
        ]);

        assert.equal(report.totalFights, 12);
        assert.equal(Object.values(report.entrants).reduce((sum, tally) => sum + tally.games, 0), 24);
        assert.equal(report.integrityIssues.some(issue => issue.code === 'TALLY_CONSERVATION'), false);
        assert.equal(report.integrityIssues.some(issue => issue.code === 'MATCHUP_RECIPROCITY'), false);
    });

    test('timeout uses bounded normalized effective health like live PvP', () => {
        const p1 = makeChampion('Shielded', 'Standard-Meta');
        const p2 = makeChampion('Healthy', 'Standard-Meta');
        Object.assign(p1, { hp: 10, maxHp: 100, shield: 5_000 });
        Object.assign(p2, { hp: 100, maxHp: 100, shield: 0 });

        // P1 has less raw HP, but its live-bounded shield gives it 110% effective
        // health versus P2's 100%. An unbounded shield would also mask cap drift.
        assert.equal(simulateFight(p1, p2, 'p1', 0).winner, 'p1');
        assert.equal(p1.shield, 5_000, 'timeout scoring must not mutate the fixture');
    });
});
