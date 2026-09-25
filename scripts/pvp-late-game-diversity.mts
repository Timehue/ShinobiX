import {
    COMPETITIVE_ARCHETYPES,
    COMPETITIVE_PROFILES,
    runCompetitiveProfileRotation,
    runEntitlementComparison,
    runRankIsolationControl,
    scoredRate,
    type Archetype,
    type BloodlineRank,
} from './pvp-level-balance-sim.js';

const LEVELS = [80, 100] as const;
const tally = (value: { wins: number; losses: number; draws: number; games: number }) => ({
    ...value,
    scoreRate: Number(scoredRate(value).toFixed(4)),
});

const levels = LEVELS.map((level) => {
    const report = runCompetitiveProfileRotation(level);
    const fightsPerProfile = report.profiles[0]?.report.totalFights ?? 0;
    const resources = report.profiles.reduce((out, entry) => ({
        meanChakra: out.meanChakra + entry.report.resources.meanChakra / report.profiles.length,
        meanStamina: out.meanStamina + entry.report.resources.meanStamina / report.profiles.length,
        chakraBelowTenPct: out.chakraBelowTenPct + entry.report.resources.chakraBelowTenPct / report.profiles.length,
        staminaBelowTenPct: out.staminaBelowTenPct + entry.report.resources.staminaBelowTenPct / report.profiles.length,
    }), { meanChakra: 0, meanStamina: 0, chakraBelowTenPct: 0, staminaBelowTenPct: 0 });
    const matchups = Object.fromEntries(COMPETITIVE_ARCHETYPES.map((left) => [left,
        Object.fromEntries(COMPETITIVE_ARCHETYPES.map((right) => {
            const result = report.profiles.reduce((sum, entry) => {
                const next = entry.report.matchups[left][right];
                return { wins: sum.wins + next.wins, losses: sum.losses + next.losses, draws: sum.draws + next.draws, games: sum.games + next.games };
            }, { wins: 0, losses: 0, draws: 0, games: 0 });
            return [right, tally(result)];
        })),
    ])) as Record<Archetype, Record<Archetype, ReturnType<typeof tally>>>;

    return {
        level,
        roster: {
            profiles: COMPETITIVE_PROFILES,
            templatesPerProfile: report.profiles[0]?.report.rosterSize ?? 0,
            legalRegularTechniquesPerBuild: 12,
            earnedStatBudget: report.profiles[0]?.report.earnedStats ?? null,
            gear: report.profiles.map(({ profile, report: profileReport }) => ({ profile, summary: profileReport.gearSummary })),
        },
        fights: {
            crossedPairings: report.totalFights,
            fightsPerProfile,
            seatsAndOpeners: 'every unordered build pair crossed in both seats and both first-turn choices',
            rounds: {
                mean: Number((report.totalRounds / Math.max(1, report.totalFights)).toFixed(2)),
                perProfileMedianRange: [report.medianRoundLow, report.medianRoundHigh],
                earlyKnockouts: report.earlyKos,
                timeouts: report.timeouts,
                draws: report.draws,
            },
            resourcesAtEnd: resources,
            archetypes: Object.fromEntries(COMPETITIVE_ARCHETYPES.map((name) => [name, tally(report.archetypes[name])])),
            matchups,
            initiative: tally(report.opener),
            rankCross: Object.fromEntries(Object.entries(report.rankCross).map(([rank, value]) => [rank, tally(value)])) as Record<BloodlineRank, ReturnType<typeof tally>>,
            identicalButtonRankControl: tally(runRankIsolationControl(level)),
            tagCoverage: {
                available: report.availableTags.length,
                attempted: report.availableTags.length - report.uncastAvailableTags.length,
                applied: report.availableTags.filter((tag) => (report.tagApplied[tag] ?? 0) > 0).length,
            },
        },
        simulatorFlags: report.issues,
    };
});

const entitlement = runEntitlementComparison(100);
console.log(JSON.stringify({
    version: 1,
    command: 'node --import tsx scripts/pvp-late-game-diversity.mts',
    engine: 'api/pvp/move.ts combat resolver with scripts/pvp-level-balance-sim.ts deterministic tag-aware scripted policy',
    determinism: 'No random source is used: profiles, build pairings, seats, openers, and policy tie breaks have fixed order. Rerun the same command for the same matrix; there is no RNG seed.',
    policy: 'Same 12 regular techniques and equal legal progression/gear budget within each comparison; profile rotation bounds construction sensitivity. This diagnostic retains the current subscriber 12/15 rule in a separate matched comparison.',
    archetypes: COMPETITIVE_ARCHETYPES,
    levels,
    entitlementAtLevel100: {
        fights: entitlement.fights,
        base12: tally(entitlement.base),
        activeSupporter15: tally(entitlement.supporter),
        flags: entitlement.issues,
    },
    limits: [
        'Scripted policy outcomes are not human competitive balance evidence.',
        'The template tournament excludes Legacy signatures and consumable use; the separate entitlement comparison isolates regular technique capacity.',
        'Only levels 80 and 100 are included in this late-game slice; no balance threshold triggers automatic game changes.',
    ],
}, null, 2));
