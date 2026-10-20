/** Bounded neutral-mirror ordinary-hit diagnostic; no runtime mutations.
 * Run from repository root: node --import tsx scripts/pet-damage-tail-audit.mts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PET_CATALOG } from '../api/pet/_catalog.js';
import { createShowdownSession, resolveShowdownRound, nextRand, estimateShowdownMoveDamage,
    type ShowdownPet } from '../api/_pet-showdown/engine.js';
import type { ShowdownCommand } from '../shared/pet-showdown-contract.js';
import { growthPointsEarned, type PetGrowthAllocation } from '../api/pet/_growth.js';
import type { Pet } from '../api/_pet-sim/pet-types.js';

const output = 'docs/pet-progression-evidence/damage-tail-audit.json';
const sourcePaths = ['api/_pet-showdown/engine.ts', 'api/_pet-showdown/ai.ts', 'api/_pet-showdown/damage-pacing.ts',
    'api/pet/_growth.ts', 'api/pet/_catalog.ts', 'shared/pet-battle-stats.ts', 'shared/pet-battle-loadout.ts',
    'shared/pet-ability-progression.ts', 'shared/pet-ability-mastery.ts', 'shared/pet-showdown-contract.ts',
    'api/_pet-stat-ceil.ts', 'api/_pet-sim/pet-config.ts', 'scripts/pet-damage-tail-audit.mts'];
const fingerprints = () => Object.fromEntries(sourcePaths.map(path => [path,
    createHash('sha256').update(readFileSync(path)).digest('hex')]));
const sourceFingerprints = fingerprints();
type Template = Record<string, unknown> & { id: string; name: string; rarity: string; element: string };
type Scenario = 'tackle' | 'native-basic' | 'advanced';
type Row = { speciesId: string; name: string; level: number; rarity: string; role: string; element: string;
    syntheticUnreachableForm: boolean; allocation: PetGrowthAllocation; scenario: Scenario;
    readiness: 'natural-opening' | 'matched-probe'; seed: number; swapped: boolean; damage: number; hpFraction: number;
    estimateBeforeRound: number; ordinaryGateSatisfied: boolean; source: unknown; target: unknown; move: unknown;
    sourceActedFirst: boolean; rngBefore: number; rngAfter: number; consumedRng: { index: number; value: number; damageVarianceCandidate: number }[];
    events: unknown[] };
const groups = new Map<string, Row[]>();
const stats = (pet: ShowdownPet) => ({ id: pet.id, role: pet.role, element: pet.element, hp: pet.hp, maxHp: pet.maxHp,
    attack: pet.attack, defense: pet.defense, spAttack: pet.spAttack, spDefense: pet.spDefense, speed: pet.speed,
    stamina: pet.stamina, maxStamina: pet.maxStamina, readiness: pet.readiness, meter: pet.meter,
    statuses: structuredClone(pet.statuses), trait: pet.trait ?? null, gear: pet.gear ?? null, consumable: pet.consumable ?? null });
for (const template of Object.values(PET_CATALOG) as Template[]) for (const level of [1, 10, 20, 75, 100]) {
    const earned = growthPointsEarned(level), each = Math.floor(earned / 4);
    const allocation: PetGrowthAllocation = { vitality: each, power: each, guard: each, agility: each };
    const attributes = ['vitality', 'power', 'guard', 'agility'] as const;
    for (let i = 0; i < earned % 4; i++) allocation[attributes[i]]++;
    const raw = { ...template, templateId: template.id, level, trait: undefined,
        growthBaseStats: { hp: template.hp, attack: template.attack, defense: template.defense, speed: template.speed },
        growthAllocation: allocation } as unknown as Pet;
    for (const scenario of ['tackle', 'native-basic', 'advanced'] as const) {
        if (scenario === 'advanced' && level < 10) continue;
        for (const readiness of ['natural-opening', 'matched-probe'] as const) {
            for (const seed of [104729, 130363]) for (const swapped of [false, true]) {
                const session = createShowdownSession({ sessionId: 'damage-tail-audit', playerName: 'Evidence', format: '1v1', tier: 'warrior', seed,
                    playerPets: [{ ...raw, id: 'a-0-' + template.id }], enemyPets: [{ ...raw, id: 'b-0-' + template.id }],
                    enemyTeamName: 'Evidence', rulesetVersion: 'progression-v3', rewardEligible: false });
                const source = (swapped ? session.enemy : session.player)[0], target = (swapped ? session.player : session.enemy)[0];
                if (readiness === 'matched-probe') { source.readiness = target.readiness = 100; source.meter = target.meter = 100; }
                const moveIndex = (pet: ShowdownPet) => scenario === 'tackle' ? 0
                    : pet.moves.findIndex(move => move.abilityId?.includes(scenario === 'advanced' ? ':advanced' : ':basic'));
                const index = moveIndex(source), responseIndex = moveIndex(target);
                const move = source.moves[index];
                if (!move) throw new Error('Missing expected ordinary move ' + template.id + ':' + scenario);
                const moveBefore = structuredClone(move);
                const attack: ShowdownCommand = { kind: 'move', petId: source.id, moveIndex: index, targetId: target.id };
                const response: ShowdownCommand = { kind: 'move', petId: target.id, moveIndex: responseIndex, targetId: source.id };
                const rngBefore = session.rng, sourceBefore = stats(source), targetBefore = stats(target), stream = structuredClone(session);
                const estimateBeforeRound = estimateShowdownMoveDamage(session, source, target, move);
                const events = resolveShowdownRound(session, swapped ? [response] : [attack], swapped ? [attack] : [response]);
                const action = events.find(event => event.t === 'action' && event.actorId === source.id);
                const damage = action?.t === 'action' ? action.targets.filter(t => t.id === target.id).reduce((sum, t) => sum + t.damage, 0) : 0;
                const consumedRng: Row['consumedRng'] = [];
                while (stream.rng !== session.rng && consumedRng.length < 128) {
                    const value = nextRand(stream);
                    consumedRng.push({ index: consumedRng.length + 1, value, damageVarianceCandidate: .92 + Math.floor(value * 16) * .01 });
                }
                if (stream.rng !== session.rng) throw new Error('Could not reconstruct seeded draw stream');
                const first = events.find(event => event.t === 'action');
                const row: Row = { speciesId: template.id, name: template.name, level, rarity: template.rarity,
                    role: source.role, element: source.element, allocation, scenario, readiness, seed, swapped,
                    syntheticUnreachableForm: /^starter-.+-l$/.test(template.id) ? level < 90 : /^starter-.+-r$/.test(template.id) && level < 50,
                    damage, hpFraction: damage / target.maxHp, estimateBeforeRound,
                    ordinaryGateSatisfied: move.hold <= (sourceBefore as ReturnType<typeof stats>).readiness && move.cost <= (sourceBefore as ReturnType<typeof stats>).stamina,
                    source: sourceBefore, target: targetBefore, move: moveBefore, sourceActedFirst: first?.t === 'action' && first.actorId === source.id,
                    rngBefore, rngAfter: session.rng, consumedRng, events };
                const key = readiness + '/level-' + level + '/' + scenario;
                const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
            }
        }
    }
}
const finalSourceFingerprints = fingerprints();
const warnings = JSON.stringify(sourceFingerprints) === JSON.stringify(finalSourceFingerprints) ? [] : ['Source changed during run'];
const summarize = (rows: Row[]) => {
    const ordered = [...rows].sort((a, b) => b.hpFraction - a.hpFraction);
    const reachable = ordered.filter(row => !row.syntheticUnreachableForm);
    return { observations: rows.length, atLeast75Pct: rows.filter(row => row.hpFraction >= .75).length,
        atLeast89Pct: rows.filter(row => row.hpFraction >= .89).length,
        firstActionAtLeast75Pct: rows.filter(row => row.hpFraction >= .75 && row.sourceActedFirst).length,
        maximum: ordered[0].hpFraction, reachableMaximum: reachable[0]?.hpFraction ?? null,
        top: ordered.slice(0, 6), topReachable: reachable.slice(0, 6) };
};
const report = { generatedAt: new Date().toISOString(), evidenceTier: 'controlled-production-engine-simulation',
    configuration: { species: Object.keys(PET_CATALOG).length, levels: [1, 10, 20, 75, 100], seeds: [104729, 130363], swappedSides: true,
        format: '1v1', growth: 'all earned points allocated evenly, remainder Vitality then Power then Guard then Agility',
        gear: false, traits: false, consumables: false, setup: false, weather: false, target: 'same species/form, role, element, level and allocation; same ordinary move command',
        readiness: { 'natural-opening': 'production initial readiness and meter', 'matched-probe': 'readiness100 and meter100 on both pets, as in the main direct-hit probes' },
        rng: 'All consumed draws are retained in order; candidate variance values do not identify which consumer used each draw.',
        syntheticForms: 'Unreachable low-level starter forms are labelled and excluded from reachable maxima.' },
    sourceFingerprints, finalSourceFingerprints, warnings,
    totalOneRoundScenarios: [...groups.values()].reduce((sum, rows) => sum + rows.length, 0),
    groups: Object.fromEntries([...groups].map(([key, rows]) => [key, summarize(rows)])) };
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, scenarios: report.totalOneRoundScenarios, warnings,
    maxima: Object.fromEntries([...groups].filter(([key]) => key.startsWith('natural-opening')).map(([key, rows]) => {
        const top = summarize(rows).topReachable[0]; return [key, { species: top.speciesId, name: top.name, ratio: top.hpFraction, move: top.move, source: top.source, seed: top.seed, swapped: top.swapped }];
    })) }));
if (warnings.length) process.exitCode = 1;
