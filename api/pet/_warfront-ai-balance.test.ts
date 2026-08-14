import assert from 'node:assert/strict';
import test from 'node:test';
import { GAUNTLET_POOL, type GauntletPoolPet } from '../_pet-sim/_gauntlet-pool.js';
import {
    runWarfrontMatch,
    WARFRONT_TPS,
    WF_MAX_SECONDS,
    type WfBuildPackage,
    type WfCoachOrder,
    type WfCounterstrike,
    type WfDoctrine,
    type WfObjectiveTechnique,
    type WfOpeningDeployment,
} from '../_pet-sim/pet-warfront-sim.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { buildProgressionWarfrontAiTeam, buildWarfrontAiTeam, normalizeWarfrontPlayerTeam, warfrontAiWarband, type WarfrontAiWarbandId } from './_warfront-ai.js';
import { sealedWarfrontCoachRounds, warfrontAiTacticalSetup } from './warfront-start.js';
import { gainServerPetXp } from './_progress.js';

// A mid-progression Warfront roster: one rare fighter per role, neither the
// weakest nor strongest roll in the canonical rare band.
const REPRESENTATIVE_IDS = ['rare-12', 'rare-13', 'rare-14', 'rare-15'] as const;
const DEPLOYMENTS: readonly WfOpeningDeployment[] = [
    ['top', 'mid', 'bottom', 'flex'],
    ['flex', 'top', 'mid', 'bottom'],
    ['bottom', 'flex', 'top', 'mid'],
];
const PLAYER_PLANS: ReadonlyArray<{
    policy: 'balanced' | 'offense' | 'defense';
    doctrine: WfDoctrine;
    buildPackage: WfBuildPackage;
    coachOrder: WfCoachOrder;
    objectiveTechnique: WfObjectiveTechnique;
    counterstrike: WfCounterstrike;
}> = [
    { policy: 'defense', doctrine: 'bulwark', buildPackage: 'hold-line', coachOrder: 'contest', objectiveTechnique: 'zone', counterstrike: 'fortify' },
    { policy: 'offense', doctrine: 'zealot', buildPackage: 'blood-hunt', coachOrder: 'ambush', objectiveTechnique: 'hijack', counterstrike: 'bounty-hunt' },
    { policy: 'balanced', doctrine: 'vanguard', buildPackage: 'escort-rite', coachOrder: 'trade', objectiveTechnique: 'secure', counterstrike: 'cross-map' },
];

function asPet(source: GauntletPoolPet): Pet {
    return {
        ...source,
        element: (source.element ?? 'None') as Pet['element'],
        level: 18,
        xp: 0,
        maxLevel: 70,
        moveRange: source.role === 'defender' ? 2 : source.role === 'assassin' ? 5 : source.role === 'tracker' ? 4 : 3,
        jutsus: source.jutsus.map((jutsu) => ({ ...jutsu, kind: jutsu.kind as Pet['jutsus'][number]['kind'], currentCooldown: 0 })),
        unlockedForPve: true,
    };
}

const representative = REPRESENTATIVE_IDS.map((id) => {
    const source = GAUNTLET_POOL.find((pet) => pet.id === id);
    if (!source) throw new Error(`Missing representative pet ${id}`);
    return asPet(source);
});
const slots = (pets: Pet[]) => pets.map((pet) => ({ pet, role: pet.role! }));

export type WarfrontProfileProbe = {
    id: WarfrontAiWarbandId;
    redWins: number;
    blueWins: number;
    draws: number;
    timeouts: number;
    redStructures: number;
    redSigils: number;
    redSteals: number;
    redWardenKills: number;
    meanSeconds: number;
    medianSeconds: number;
};

export function probeWarfrontProfiles(): WarfrontProfileProbe[] {
    const probes = new Map<WarfrontAiWarbandId, WarfrontProfileProbe & { durations: number[] }>();
    for (const id of ['siege', 'sustain', 'ambush'] as const) {
        probes.set(id, {
            id, redWins: 0, blueWins: 0, draws: 0, timeouts: 0,
            redStructures: 0, redSigils: 0, redSteals: 0, redWardenKills: 0,
            meanSeconds: 0, medianSeconds: 0, durations: [],
        });
    }
    for (let profileIndex = 0; profileIndex < 3; profileIndex++) {
        for (let sample = 0; sample < 20; sample++) {
            const seed = profileIndex + 3 * (sample + 1);
            const id = warfrontAiWarband(seed).id;
            const probe = probes.get(id)!;
            const plan = PLAYER_PLANS[sample % PLAYER_PLANS.length];
            const red = warfrontAiTacticalSetup(seed);
            const result = runWarfrontMatch(
                slots(representative),
                slots(buildWarfrontAiTeam(4, seed)),
                seed,
                plan.policy,
                'balanced',
                undefined,
                { blue: 'balanced', red: red.stance },
                { blue: plan.doctrine, red: red.doctrine },
                {
                    captureSnapshots: false,
                    blueDeployment: DEPLOYMENTS[sample % DEPLOYMENTS.length],
                    redDeployment: red.deployment,
                    blueBuildPackage: plan.buildPackage,
                    redBuildPackage: red.buildPackage,
                    blueObjectiveTechnique: plan.objectiveTechnique,
                    redObjectiveTechnique: red.objectiveTechnique,
                    blueCounterstrike: plan.counterstrike,
                    redCounterstrike: red.counterstrike,
                    blueRoundDecisions: sealedWarfrontCoachRounds(plan.coachOrder),
                    redRoundDecisions: sealedWarfrontCoachRounds(red.coachOrder),
                },
            );
            if (result.winner === 'red') probe.redWins++;
            else if (result.winner === 'blue') probe.blueWins++;
            else probe.draws++;
            if (result.ticks >= WF_MAX_SECONDS * WARFRONT_TPS) probe.timeouts++;
            const objective = result.decisionReceipts?.red.outcome;
            probe.redStructures += objective?.structuresDestroyed ?? 0;
            probe.redSigils += objective?.sigilsClaimed ?? 0;
            probe.redSteals += objective?.objectiveSteals ?? 0;
            probe.redWardenKills += result.events.filter((event) => event.type === 'wardenkill' && event.team === 'red').length;
            probe.durations.push(result.ticks / WARFRONT_TPS);
        }
    }
    return [...probes.values()].map(({ durations, ...probe }) => {
        const sorted = [...durations].sort((a, b) => a - b);
        const middle = sorted.length / 2;
        return {
            ...probe,
            meanSeconds: Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10,
            medianSeconds: Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10,
        };
    });
}

test('20-seed authored profile probe meets outcome, pacing, and objective gates', () => {
    const results = probeWarfrontProfiles();
    console.info('[warfront-profile-probe]', JSON.stringify(results));
    for (const profile of results) {
        assert.ok(profile.redWins <= 13 && profile.blueWins <= 13,
            `${profile.id} exceeded 65% outcome skew: ${JSON.stringify(profile)}`);
        assert.ok(profile.timeouts <= 5,
            `${profile.id} exceeded 25% regulation-clock finishes: ${JSON.stringify(profile)}`);
        assert.ok(profile.redStructures + profile.redSigils + profile.redWardenKills > 0,
            `${profile.id} never participated in a scored map objective: ${JSON.stringify(profile)}`);
    }
});

test('authoritative low, mid, and max rosters receive competitive deterministic bands where plans matter', () => {
    const progressed = (ids: readonly string[], maxLevel: number): Pet[] => ids.map((id) => {
        const source = GAUNTLET_POOL.find((pet) => pet.id === id);
        if (!source) throw new Error(`Missing progression fixture ${id}`);
        const levelOne = {
            ...source,
            element: (source.element ?? 'None') as Pet['element'],
            level: 1,
            xp: 0,
            maxLevel,
            moveRange: source.role === 'defender' ? 2 : source.role === 'assassin' ? 5 : source.role === 'tracker' ? 4 : 3,
            jutsus: source.jutsus.map((jutsu) => ({ ...jutsu, kind: jutsu.kind as Pet['jutsus'][number]['kind'], currentCooldown: 0 })),
            unlockedForPve: false,
        };
        return (maxLevel === 1 ? levelOne : gainServerPetXp(levelOne, 10_000_000)) as Pet;
    });
    const standardIds = ['standard-0', 'standard-1', 'standard-2', 'standard-3'] as const;
    const tiers = [
        { name: 'low', player: progressed(standardIds, 1), expectedBand: 'rookie' },
        { name: 'mid', player: progressed(REPRESENTATIVE_IDS, 35), expectedBand: 'veteran' },
        { name: 'max', player: progressed(standardIds, 100), expectedBand: 'elite' },
    ] as const;
    const samples = 30;

    const requestedTier = process.env.WARFRONT_BALANCE_TIER;
    for (const tier of tiers.filter((entry) => !requestedTier || entry.name === requestedTier)) {
        const player = normalizeWarfrontPlayerTeam(tier.player);
        let blueWins = 0;
        let redWins = 0;
        let primaryTimeouts = 0;
        let alternateBlueWins = 0;
        let alternateRedWins = 0;
        let alternateTimeouts = 0;
        let winnerChanges = 0;
        let changedByPlan = 0;
        const powerRatios: number[] = [];
        for (let sample = 0; sample < samples; sample++) {
            const seed = 10_000 + sample * 3 + (Number(player[0].level ?? 1) % 3);
            const opponent = buildProgressionWarfrontAiTeam(4, seed, player);
            assert.equal(opponent.difficulty.band, tier.expectedBand);
            const powerRatio = opponent.difficulty.opponentPower / opponent.difficulty.playerPower;
            powerRatios.push(powerRatio);
            assert.ok(powerRatio >= 0.88 && powerRatio <= 1.12,
                `${tier.name} sealed power ratio drifted: ${powerRatio}`);
            const red = warfrontAiTacticalSetup(seed);
            const play = (planIndex: number) => {
                const plan = PLAYER_PLANS[planIndex];
                return runWarfrontMatch(
                    slots(player), slots(opponent.pets), seed,
                    plan.policy, 'balanced', undefined,
                    { blue: 'balanced', red: red.stance },
                    { blue: plan.doctrine, red: red.doctrine },
                    {
                        captureSnapshots: false,
                        blueDeployment: DEPLOYMENTS[planIndex], redDeployment: red.deployment,
                        blueBuildPackage: plan.buildPackage, redBuildPackage: red.buildPackage,
                        blueObjectiveTechnique: plan.objectiveTechnique, redObjectiveTechnique: red.objectiveTechnique,
                        blueCounterstrike: plan.counterstrike, redCounterstrike: red.counterstrike,
                        blueRoundDecisions: sealedWarfrontCoachRounds(plan.coachOrder),
                        redRoundDecisions: sealedWarfrontCoachRounds(red.coachOrder),
                    },
                );
            };
            const primary = play(sample % PLAYER_PLANS.length);
            const alternate = play((sample + 1) % PLAYER_PLANS.length);
            if (primary.winner === 'blue') blueWins++;
            else if (primary.winner === 'red') redWins++;
            if (alternate.winner === 'blue') alternateBlueWins++;
            else if (alternate.winner === 'red') alternateRedWins++;
            if (primary.ticks >= WF_MAX_SECONDS * WARFRONT_TPS) primaryTimeouts++;
            if (alternate.ticks >= WF_MAX_SECONDS * WARFRONT_TPS) alternateTimeouts++;
            if (primary.winner !== alternate.winner) winnerChanges++;
            if (primary.winner !== alternate.winner
                || primary.ticks !== alternate.ticks
                || JSON.stringify(primary.decisionReceipts?.blue.outcome) !== JSON.stringify(alternate.decisionReceipts?.blue.outcome)) {
                changedByPlan++;
            }
        }
        console.info('[warfront-progression-probe]', JSON.stringify({
            tier: tier.name,
            band: tier.expectedBand,
            rosterLevels: player.map(pet => Number(pet.level ?? 1)),
            blueWins,
            redWins,
            draws: samples - blueWins - redWins,
            primaryTimeouts,
            alternateBlueWins,
            alternateRedWins,
            alternateDraws: samples - alternateBlueWins - alternateRedWins,
            alternateTimeouts,
            winnerChanges,
            changedByPlan,
            minPowerRatio: Number(Math.min(...powerRatios).toFixed(4)),
            maxPowerRatio: Number(Math.max(...powerRatios).toFixed(4)),
        }));
        assert.ok(blueWins >= 3 && redWins >= 3,
            `${tier.name} progression gate repeated an extreme primary outcome: ${blueWins}-${redWins}`);
        assert.ok(alternateBlueWins >= 3 && alternateRedWins >= 3,
            `${tier.name} progression gate repeated an extreme alternate outcome: ${alternateBlueWins}-${alternateRedWins}`);
        assert.ok(Math.max(blueWins, redWins) / samples <= 0.70,
            `${tier.name} primary plan exceeded 70% outcome skew: ${blueWins}-${redWins}`);
        assert.ok(Math.max(alternateBlueWins, alternateRedWins) / samples <= 0.70,
            `${tier.name} alternate plan exceeded 70% outcome skew: ${alternateBlueWins}-${alternateRedWins}`);
        assert.ok(primaryTimeouts / samples <= 0.25 && alternateTimeouts / samples <= 0.25,
            `${tier.name} exceeded the 25% regulation-clock gate: ${primaryTimeouts}/${alternateTimeouts}`);
        assert.ok(winnerChanges >= 3,
            `${tier.name} alternate authored plan changed only ${winnerChanges}/${samples} winners`);
        assert.ok(changedByPlan >= 10,
            `${tier.name} authored choices did not materially change enough seeded matches (${changedByPlan}/${samples})`);
    }
});
