// Read-only combat and pacing research. Never imports player settlement endpoints.
// Run: node --import tsx docs/audits/eras-2026-10-01/endgame-probe.mts
import { writeFileSync } from 'node:fs';
import { simFloor, KNOBS } from '../../../scripts/spire-balance-sim.js';
import { SPIRE_CATALOG_VERSION } from '../../../api/towers/_spire-catalog.js';
import { LEGACY_DEFS } from '../../../api/_legacy-defs.js';
import { trialObjectivesFor, type TrialKind } from '../../../api/_legacy-core.js';

const seeds = 64;
const fixtures = [
    { name: 'geared-four', members: 4 },
    { name: 'geared-three', members: 3 },
    { name: 'geared-solo', members: 1 },
];
const spire = fixtures.flatMap((fixture) => [12, 15, 18, 20].map((floor) => ({
    fixture: fixture.name, floor, members: fixture.members, seeds,
    blessingWeek: 0,
    ...simFloor(floor, fixture.members, seeds),
})));

// Sensitivity only: a stronger fixture, NOT a claim about real player power.
const oldBloodline = KNOBS.bloodlineMult;
const oldItemDamage = KNOBS.itemDamagePct;
const oldPowers = KNOBS.jutsu.map((jutsu) => Number(jutsu.effectPower));
let stronger: typeof spire = [];
try {
    KNOBS.bloodlineMult = 1.56;
    KNOBS.itemDamagePct = 42;
    KNOBS.jutsu.forEach((jutsu, index) => { jutsu.effectPower = Math.round(oldPowers[index]! * 1.4); });
    stronger = [15, 18, 20].map((floor) => ({
        fixture: 'stronger-four', floor, members: 4, seeds, blessingWeek: 0,
        ...simFloor(floor, 4, seeds),
    }));
} finally {
    KNOBS.bloodlineMult = oldBloodline;
    KNOBS.itemDamagePct = oldItemDamage;
    KNOBS.jutsu.forEach((jutsu, index) => { jutsu.effectPower = oldPowers[index]!; });
}

const trialKinds: TrialKind[] = ['awaken', 'bind', 'prove', 'mythic'];
const trials = ['hollow-seeker', 'gatebreaker', 'gate-opener'].map((id) => {
    const def = LEGACY_DEFS.find((candidate) => candidate.id === id)!;
    return {
        id, rarity: def.rarity, category: def.category,
        variant: 0,
        stages: trialKinds.map((kind) => ({ kind, objectives: trialObjectivesFor(def, kind, 0) })),
    };
});

const quantities = [5, 60, 100, 120, 200, 240, 400, 600];
const missionPacing = quantities.map((required) => ({
    required,
    // Successful claims per PLAY DAY; frequency, attempts, and time per fight are unmeasured.
    playDaysAt2: Math.ceil(required / 2),
    playDaysAt5: Math.ceil(required / 5),
    playDaysAt10: Math.ceil(required / 10),
    minimumDaysAtCurrent20ClaimCap: Math.ceil(required / 20),
}));
const communityMissionPacing = [5, 25, 100].map((activePlayers) => ({
    activePlayers, assumedQualifyingClaimsPerPlayerPerDay: 10,
    required: 5000, freshZeroBaselineDays: Math.ceil(5000 / (activePlayers * 10)),
}));

const report = {
    status: 'research; no tuning promoted',
    generatedAt: new Date().toISOString(),
    spireCatalog: SPIRE_CATALOG_VERSION,
    limitations: [
        'Fixed deterministic seeds; one blessing; policy/gear fixtures are not real player cohorts.',
        'Win percentages are rounded; no clean-clear probability measured.',
        'Solo uses the same geared fixture with one member; it does not establish a fair solo challenge.',
        'Pacing is arithmetic sensitivity, not observed calendar duration or telemetry.',
        'Existing world counters have lifetime progress; the community example assumes fresh zero.',
    ],
    knobs: KNOBS, spire: [...spire, ...stronger], trials, missionPacing, communityMissionPacing,
};
writeFileSync(new URL('./endgame-probe-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ spire: report.spire, missionPacing, communityMissionPacing }, null, 2));
