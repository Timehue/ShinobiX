import assert from 'node:assert/strict';
import test from 'node:test';
import { runWarfrontMatch as serverRun } from '../api/_pet-sim/pet-warfront-sim';
import { runWarfrontMatch as clientRun } from '../shinobij.client/src/lib/pet-warfront-sim';
import type { Pet } from '../shinobij.client/src/types/pet';
import type { ArenaRole, ArenaSlot } from '../shinobij.client/src/lib/pet-arena-sim';
import { buildWarfrontAiTeam } from '../api/pet/_warfront-ai';
import { sealedWarfrontCoachRounds, warfrontAiTacticalSetup } from '../api/pet/warfront-start';

const roles = ['defender', 'tracker', 'assassin', 'sage'] as const;
const blue: ArenaSlot[] = roles.map((role, index) => ({
    role: role as ArenaRole,
    pet: {
        id: `authored-blue-${index}`,
        name: `Authored Blue ${index}`,
        element: ['Earth', 'Water', 'Fire', 'Wind'][index],
        rarity: 'rare',
        hp: role === 'defender' ? 500 : role === 'sage' ? 440 : 390,
        attack: role === 'tracker' ? 65 : role === 'assassin' ? 59 : 48,
        defense: role === 'defender' ? 45 : 36,
        speed: role === 'tracker' ? 49 : role === 'assassin' ? 47 : 41,
    } as Pet,
}));

const plans = [
    { policy: 'defense' as const, doctrine: 'bulwark' as const, buildPackage: 'hold-line' as const, coachOrder: 'contest' as const, objectiveTechnique: 'zone' as const, counterstrike: 'fortify' as const },
    { policy: 'offense' as const, doctrine: 'zealot' as const, buildPackage: 'blood-hunt' as const, coachOrder: 'ambush' as const, objectiveTechnique: 'hijack' as const, counterstrike: 'bounty-hunt' as const },
    { policy: 'balanced' as const, doctrine: 'vanguard' as const, buildPackage: 'escort-rite' as const, coachOrder: 'trade' as const, objectiveTechnique: 'secure' as const, counterstrike: 'cross-map' as const },
];

test('generated server and client authored playbooks resolve byte-identically', () => {
    for (const seed of [3, 4, 5]) {
        const red = buildWarfrontAiTeam(4, seed).map((pet) => ({ pet: pet as unknown as Pet, role: pet.role as ArenaRole }));
        const redSetup = warfrontAiTacticalSetup(seed);
        const plan = plans[seed % plans.length];
        const runtime = {
            captureSnapshots: false,
            blueDeployment: ['top', 'mid', 'bottom', 'flex'] as const,
            redDeployment: redSetup.deployment,
            blueBuildPackage: plan.buildPackage,
            redBuildPackage: redSetup.buildPackage,
            blueObjectiveTechnique: plan.objectiveTechnique,
            redObjectiveTechnique: redSetup.objectiveTechnique,
            blueCounterstrike: plan.counterstrike,
            redCounterstrike: redSetup.counterstrike,
            blueRoundDecisions: sealedWarfrontCoachRounds(plan.coachOrder),
            redRoundDecisions: sealedWarfrontCoachRounds(redSetup.coachOrder),
        };
        const args = [
            blue,
            red,
            seed,
            plan.policy,
            'balanced' as const,
            undefined,
            { blue: 'balanced' as const, red: redSetup.stance },
            { blue: plan.doctrine, red: redSetup.doctrine },
            runtime,
        ] as const;
        assert.equal(JSON.stringify(serverRun(...args)), JSON.stringify(clientRun(...args)), `authored parity drift @ seed ${seed}`);
    }
});
