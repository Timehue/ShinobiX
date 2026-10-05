/** Read-only audit probes. Writes only this audit's derived evidence with --write. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_DEFS, STAT_CATEGORY, type LegacyDef } from '../../../api/_legacy-defs.js';
import { trialObjectivesFor, TRIAL_VARIANT_COUNT } from '../../../api/_legacy-core.js';
import { evaluateAllLegacies, evaluateLegacy, pickSageOffers } from '../../../api/_legacy-score.js';
import { BOOTSTRAP_CAPS, seedLegacyStatsFromSave, type LegacyStats } from '../../../api/_legacy-track.js';
import { extractPvpLegacyDeltas } from '../../../api/_legacy-pvp.js';
import { applyJutsu } from '../../../api/pvp/move.js';

const outputDir = path.dirname(fileURLToPath(import.meta.url));
const floors = (def: LegacyDef) => def.reqs.flatMap((req) => 'stat' in req ? [req] : [...req.anyOf]);
const statKeys = Object.keys(STAT_CATEGORY);
const styleKills = ['ninjutsuKills', 'genjutsuKills', 'taijutsuKills', 'bukijutsuKills'];
const villages = ['', 'Ashen Leaf', 'Stormveil', 'Frostfang', 'Moonshadow'];
const selected = (stats: LegacyStats, village = '') => pickSageOffers(evaluateAllLegacies(stats, { level: 100, village })).map((entry) => entry.legacyId);
const requirementStats = new Set(LEGACY_DEFS.flatMap((def) => floors(def).map((floor) => floor.stat)));
const trialStats = new Set<string>();
const directPvpStats = new Set(['pvpWins', 'pvpKills', 'rankedWins', 'sameRankWins', 'higherLevelWins', 'defensiveWins', 'comebackWins', 'bestKillStreak', 'warPvpKills']);
let eligibilityBoundaryChecks = 0;
let trialVariants = 0;
const rows = LEGACY_DEFS.map((def) => {
  const stats: LegacyStats = {};
  for (const floor of floors(def)) stats[floor.stat] = Math.max(Number(stats[floor.stat] ?? 0), floor.atLeast);
  assert.equal(evaluateLegacy(def, stats).eligible, true, `${def.id}: exact-floor qualification failed`);
  for (const req of def.reqs) {
    if (!('stat' in req)) continue;
    assert.equal(evaluateLegacy(def, { ...stats, [req.stat]: req.atLeast - 1 }).eligible, false, `${def.id}: below-floor qualified`);
    eligibilityBoundaryChecks++;
  }
  const trials = Object.fromEntries(['awaken', 'bind', 'prove', 'mythic'].map((kind) => [kind,
    Array.from({ length: TRIAL_VARIANT_COUNT }, (_, variant) => {
      const objectives = trialObjectivesFor(def, kind as 'awaken' | 'bind' | 'prove' | 'mythic', variant);
      trialVariants++;
      objectives.forEach((objective) => trialStats.add(objective.stat));
      return objectives;
    }),
  ]));
  let witness: { stats: LegacyStats; village: string; offers: string[] } | null = null;
  // Abstract counter-state witnesses: these prove selector inclusion, not that
  // a real character can earn these combinations. Producer constraints are
  // inspected separately in the report.
  let randomState = 1234567;
  const rand = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
  for (let attempt = 0; attempt < 180 && !witness; attempt++) {
    const candidate = Object.fromEntries(Object.entries(stats).map(([stat, floor]) => [stat,
      Math.ceil(Number(floor) * (attempt < 6 ? [1, 1.01, 1.15, 1.5, 2, 4][attempt]! : 1 + rand() * 5)),
    ])) as LegacyStats;
    for (const village of villages) {
      const offers = selected(candidate, village);
      if (offers.includes(def.id)) { witness = { stats: candidate, village, offers }; break; }
    }
  }
  const stagesWithMandatoryPvp = Object.entries(trials).filter(([, variants]) =>
    variants.every((objectives) => objectives.some((objective) => directPvpStats.has(objective.stat))),
  ).map(([kind]) => kind);
  const findings = [
    ...(floors(def).some((floor) => floor.stat === 'higherLevelWins') ? ['F02'] : []),
    ...(floors(def).some((floor) => /^(ninjutsu|genjutsu|taijutsu|bukijutsu)(Kills|Damage)$/.test(floor.stat)) ? ['F03'] : []),
    ...(floors(def).some((floor) => ['healingDone','shieldsApplied','damageBlocked'].includes(floor.stat)) || def.category === 'support' ? ['F04'] : []),
    ...(floors(def).some((floor) => floor.stat === 'dungeonClears') || def.category === 'pve' ? ['F05'] : []),
    ...(stagesWithMandatoryPvp.length > 0 && !floors(def).some((floor) => directPvpStats.has(floor.stat)) ? ['F06'] : []),
  ];
  return { id: def.id, name: def.name, rarity: def.rarity, category: def.category,
    requirements: def.reqs, exactFloorOffers: selected(stats, def.villageAffinity ?? ''),
    selectorWitness: witness, trials, stagesWithMandatoryPvp, findings,
    multiplePermanentStyleKillRequirements: floors(def).filter((floor) => styleKills.includes(floor.stat)).length > 1,
  };
});

const saturation: LegacyStats = Object.fromEntries(statKeys.map((stat) => [stat, 1_000_000_000]));
for (const stat of ['tilesExplored', 'endlessTowerBest', 'arenaTournaments']) {
  saturation[stat as keyof LegacyStats] = BOOTSTRAP_CAPS[stat as keyof typeof BOOTSTRAP_CAPS] ?? 0;
}
const fullyQualified = evaluateAllLegacies(saturation, { level: 100 });
const styleSession = {
  p1: { name: 'Winner', hp: 900, maxHp: 1000, character: { level: 50, specialty: 'Ninjutsu' } },
  p2: { name: 'Loser', hp: 0, maxHp: 1000, character: { level: 50, specialty: 'Taijutsu' } },
  log: ['100 damage to Loser.', 'Siphon: Winner heals 50 HP.', 'Lifesteal: Winner heals 30 HP.'],
};
const styleExtraction = extractPvpLegacyDeltas(styleSession, 'Winner', 'Loser');
assert.equal(styleExtraction.winnerDeltas.ninjutsuKills, 1);
assert.equal(styleExtraction.winnerDeltas.taijutsuKills ?? 0, 0);
assert.equal(styleExtraction.winnerDeltas.healingDone ?? 0, 0);
const basicHealExtraction = extractPvpLegacyDeltas({ ...styleSession, log: ['Winner uses Basic Heal, restoring 100 HP.'] }, 'Winner', 'Loser');
assert.equal(basicHealExtraction.winnerDeltas.healingDone ?? 0, 0);
const fullHpHealExtraction = extractPvpLegacyDeltas({ ...styleSession, p1: { ...styleSession.p1, hp: 1000 }, log: ['Heal: Winner restores 750 HP.'] }, 'Winner', 'Loser');
assert.equal(fullHpHealExtraction.winnerDeltas.healingDone, 750);
const engineFighter = (name: string): Parameters<typeof applyJutsu>[0] => ({
  name, hp: 1000, maxHp: 1000, chakra: 1000, maxChakra: 1000,
  stamina: 1000, maxStamina: 1000, shield: 0, statuses: [], pos: name === 'Winner' ? 0 : 1,
  character: { name, level: 50, specialty: 'Ninjutsu', stats: {}, jutsuMastery: [] },
});
const healTechnique = {
  id: 'audit-heal', name: 'Audit Heal', type: 'Ninjutsu', element: 'Fire',
  ap: 40, range: 1, effectPower: 0, cooldown: 0, chakraCost: 0, staminaCost: 0,
  target: 'SELF', method: 'SINGLE', tags: [{ name: 'Heal' }],
} as Parameters<typeof applyJutsu>[2];
const actualEngineHeal = applyJutsu(engineFighter('Winner'), engineFighter('Loser'), healTechnique);
const engineHealExtraction = extractPvpLegacyDeltas({ ...styleSession, log: actualEngineHeal.lines }, 'Winner', 'Loser');
assert.equal(actualEngineHeal.self.hp, 1000);
assert.ok(Number(engineHealExtraction.winnerDeltas.healingDone) > 0);
const endLowHp = extractPvpLegacyDeltas({ ...styleSession, p1: { ...styleSession.p1, hp: 100 } }, 'Winner', 'Loser');
const fallbackSeed = seedLegacyStatsFromSave({ level: 50, village: 'Ashen Leaf' }, 0);
const maxedSpecialists = Object.fromEntries(['ninjutsu','genjutsu','taijutsu','bukijutsu'].map((specialty) => {
  const stats = { ...saturation };
  for (const other of ['ninjutsu','genjutsu','taijutsu','bukijutsu']) {
    if (specialty === other) continue;
    stats[`${other}Kills` as keyof LegacyStats] = 0;
    stats[`${other}Damage` as keyof LegacyStats] = 0;
  }
  return [specialty, {
    eligible: evaluateAllLegacies(stats, { level: 100 }).filter((entry) => entry.eligible).length,
    offersByVillage: Object.fromEntries(villages.map((village) => [village || 'none', selected(stats, village)])),
  }];
}));
const summary = {
  rosterCount: rows.length, requirementStats: [...requirementStats].sort(), trialStats: [...trialStats].sort(),
  requirementStatCount: requirementStats.size, trialStatCount: trialStats.size,
  eligibilityBoundaryChecks, trialVariants,
  multiplePermanentStyleKillPaths: rows.filter((row) => row.multiplePermanentStyleKillRequirements).map((row) => row.id),
  selectorWitnessCount: rows.filter((row) => row.selectorWitness).length,
  noSelectorWitness: rows.filter((row) => !row.selectorWitness).map((row) => row.id),
  fullyQualifiedCount: fullyQualified.filter((entry) => entry.eligible).length,
  fullyQualifiedProfileIsAbstractAndViolatesPermanentSpecialty: true,
  saturatedOffersByVillage: Object.fromEntries(villages.map((village) => [village || 'none', selected(saturation, village)])),
  saturatedProfilesRespectingPermanentSpecialty: maxedSpecialists,
  styleExtraction,
  basicHealCredited: basicHealExtraction.winnerDeltas.healingDone ?? 0,
  rawHealCreditedAtFullEndingHp: fullHpHealExtraction.winnerDeltas.healingDone ?? 0,
  realEngineHealAtFullHp: { actualHpRestored: actualEngineHeal.self.hp - 1000, lines: actualEngineHeal.lines, legacyHealingCredited: engineHealExtraction.winnerDeltas.healingDone },
  lowEndingHpWithoutPriorDamageStillCountsComeback: endLowHp.winnerComeback,
  level50Fallback: { seed: fallbackSeed, offers: selected(fallbackSeed, 'Ashen Leaf') },
  cappedUpsetPaths: rows.filter((row) => row.findings.includes('F02')).map((row) => row.id),
  laterPvpWithoutDirectPvpQualification: rows.filter((row) => row.findings.includes('F06')).map((row) => ({ id: row.id, stages: row.stagesWithMandatoryPvp })),
  findingsCoverage: Object.fromEntries(['F02','F03','F04','F05','F06'].map((finding) => [finding, rows.filter((row) => row.findings.includes(finding)).map((row) => row.id)])),
};
if (process.argv.includes('--write')) {
  fs.writeFileSync(path.join(outputDir, 'evidence.json'), JSON.stringify({ summary, paths: rows }, null, 2) + '\n');
  const formatObjectives = (objectives: Array<{ stat: string; delta: number }>) => objectives.map((o) => `${o.stat} +${o.delta}`).join('; ');
  const formatReqs = (def: LegacyDef) => def.reqs.map((req) => 'stat' in req
    ? `${req.stat} ≥ ${req.atLeast}` : `any of (${req.anyOf.map((r) => `${r.stat} ≥ ${r.atLeast}`).join(' / ')})`).join('; ');
  const table = ['# All 100 legacy paths — audited baseline matrix', '',
    'Generated from the current canonical roster and trial generator. Every requirement in a row must pass. The selector witness is an abstract stat profile, not proof that a real character can earn it. Current runtime overlay values were not available to this local audit.', '',
    'Finding IDs refer to README.md. F01 (world-raid credit), F07–F10 (system behavior and documentation) also apply across paths. A finding tag indicates exposure to that issue; it does not mean the whole path is unobtainable.', '',
    '| Path | Rarity / category | Qualification | Findings | Abstract selector witness | Stage 2, variants 0 / 1 | Stage 3 | Stage 4 | Stage 5 |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map((row, index) => `| ${row.name} (${row.id}) | ${row.rarity} / ${row.category} | ${formatReqs(LEGACY_DEFS[index]!)} | ${row.findings.join(', ') || 'no path-specific finding'} | ${row.selectorWitness ? 'found' : 'not found'}${row.multiplePermanentStyleKillRequirements ? '; blocked by permanent specialty' : ''} | ${['awaken','bind','prove','mythic'].map((kind) => row.trials[kind]!.map(formatObjectives).join(' / ')).join(' | ')} |`), '',
  ];
  fs.writeFileSync(path.join(outputDir, 'path-matrix.md'), table.join('\n'));
}
console.log(JSON.stringify(summary, null, 2));
