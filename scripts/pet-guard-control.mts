/** Fair survivability control through the production Showdown engine.
 * Run from the repository root: node --import tsx scripts/pet-guard-control.mts
 * Both builds move the same ten points out of Power; all other points match.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PET_CATALOG } from '../api/pet/_catalog.js';
import { createShowdownSession, resolveShowdownRound } from '../api/_pet-showdown/engine.js';
import { chooseShowdownAiCommands } from '../api/_pet-showdown/ai.js';
import { growthPointsEarned, sanitizeGrowthAllocation, type PetGrowthAllocation } from '../api/pet/_growth.js';
import type { Pet } from '../api/_pet-sim/pet-types.js';
import { SHOWDOWN_TURN_CAP } from '../shared/pet-showdown-contract.js';

const outputIndex = process.argv.indexOf('--output');
const output = resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : 'docs/pet-progression-evidence/guard-control.json');
const seeds = [104729, 130363];
const sourcePaths = [
    'api/_pet-showdown/engine.ts', 'api/_pet-showdown/ai.ts', 'api/_pet-showdown/damage-pacing.ts',
    'api/pet/_growth.ts', 'api/pet/_catalog.ts', 'api/_pet-stat-ceil.ts', 'api/_pet-sim/pet-config.ts',
    'shared/pet-battle-stats.ts', 'shared/pet-battle-loadout.ts', 'shared/pet-ability-progression.ts',
    'shared/pet-ability-mastery.ts', 'shared/pet-showdown-contract.ts', 'scripts/pet-guard-control.mts',
];
const fingerprints = () => Object.fromEntries(sourcePaths.map(path =>
    [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
const sourceFingerprints = fingerprints();
type Trace = { round: number; actor: 'guard' | 'vitality'; kind: string; move: string; damage: number; heal: number };
type Stats = { hp: number; defense: number; spDefense: number; stamina: number; attack: number; speed: number };
type Row = { id: string; name: string; role: string; level: number; seed: number; swapped: boolean;
    syntheticUnreachableForm: boolean; guard: Stats; vitality: Stats;
    guardRest: number; vitalityRest: number; guardHealing: number; vitalityHealing: number;
    guardDamage: number; vitalityDamage: number; rounds: number; guardWin: boolean;
    guardHp: number; vitalityHp: number; trace?: Trace[] };
const rows: Row[] = [];
type Template = Record<string, unknown> & { id: string; name: string };
for (const template of Object.values(PET_CATALOG) as Template[]) for (const level of [75, 100]) {
    const earned = growthPointsEarned(level), each = Math.floor(earned / 4);
    const balanced: PetGrowthAllocation = { vitality: each, power: each, guard: each, agility: each };
    const attributes = ['vitality', 'power', 'guard', 'agility'] as const;
    for (let i = 0; i < earned % 4; i++) balanced[attributes[i]]++;
    const guard = { ...balanced, power: balanced.power - 10, guard: balanced.guard + 10 };
    const vitality = { ...balanced, power: balanced.power - 10, vitality: balanced.vitality + 10 };
    for (const allocation of [guard, vitality]) {
        if (JSON.stringify(sanitizeGrowthAllocation(allocation, level)) !== JSON.stringify(allocation)) throw new Error('Illegal control allocation');
    }
    for (const seed of seeds) for (const swapped of [false, true]) {
        const pet = (growthAllocation: PetGrowthAllocation, id: string): Pet => ({
            ...template, id, templateId: template.id, level, trait: undefined,
            growthBaseStats: { hp: template.hp, attack: template.attack, defense: template.defense, speed: template.speed },
            growthAllocation,
        } as Pet);
        const a = pet(guard, 'guard'), b = pet(vitality, 'vitality');
        const session = createShowdownSession({
            sessionId: 'guard-control', playerName: 'Evidence', format: '1v1', tier: 'warrior', seed,
            playerPets: [swapped ? b : a], enemyPets: [swapped ? a : b],
            enemyTeamName: 'Evidence', rulesetVersion: 'progression-v3', rewardEligible: false,
        });
        const g = (swapped ? session.enemy : session.player)[0], v = (swapped ? session.player : session.enemy)[0];
        const stats = (p: typeof g): Stats => ({ hp: p.maxHp, defense: p.defense, spDefense: p.spDefense,
            stamina: p.maxStamina, attack: p.attack, speed: p.speed });
        const trace: Trace[] = [];
        const row: Row = {
            id: template.id, name: String(template.name), role: g.role, level, seed, swapped,
            syntheticUnreachableForm: /^starter-.+-l$/.test(template.id) && level < 90,
            guard: stats(g), vitality: stats(v), guardRest: 0, vitalityRest: 0,
            guardHealing: 0, vitalityHealing: 0, guardDamage: 0, vitalityDamage: 0,
            rounds: 0, guardWin: false, guardHp: 0, vitalityHp: 0,
        };
        while (!session.finished && session.round <= SHOWDOWN_TURN_CAP) {
            const events = resolveShowdownRound(session, chooseShowdownAiCommands(session, 'player'), chooseShowdownAiCommands(session, 'enemy'));
            for (const event of events) {
                if (event.t !== 'action') continue;
                const actor = event.actorId === 'guard' ? 'guard' : 'vitality';
                const damage = event.targets.reduce((sum, target) => sum + target.damage, 0);
                const heal = event.targets.reduce((sum, target) => sum + target.heal, 0);
                row[actor === 'guard' ? 'guardRest' : 'vitalityRest'] += Number(event.moveKind === 'rest');
                row[actor === 'guard' ? 'guardDamage' : 'vitalityDamage'] += damage;
                row[actor === 'guard' ? 'guardHealing' : 'vitalityHealing'] += heal;
                trace.push({ round: session.round, actor, kind: event.moveKind, move: event.moveName, damage, heal });
            }
        }
        if (!session.finished || session.round > SHOWDOWN_TURN_CAP) throw new Error('Unfinished control battle');
        row.rounds = session.round; row.guardWin = session.outcome === (swapped ? 'loss' : 'win');
        row.guardHp = g.hp; row.vitalityHp = v.hp;
        // Keep complete traces for repeatable examples, with compact results elsewhere.
        if (level === 75 && ['standard-21', 'legendary-3'].includes(template.id)
            || level === 100 && template.id === 'standard-46') row.trace = trace;
        rows.push(row);
    }
}
const summarize = (sample: Row[]) => ({
    fights: sample.length, guardWins: sample.filter(row => row.guardWin).length,
    guardRest: sample.reduce((sum, row) => sum + row.guardRest, 0),
    vitalityRest: sample.reduce((sum, row) => sum + row.vitalityRest, 0),
});
const finalSourceFingerprints = fingerprints();
const warnings = JSON.stringify(sourceFingerprints) === JSON.stringify(finalSourceFingerprints) ? [] : ['Source changed during run'];
const report = {
    generatedAt: new Date().toISOString(), evidenceTier: 'controlled-production-engine-simulation',
    scenario: 'Same ten points from Power into Guard versus Vitality; all other allocations identical.',
    configuration: { levels: [75, 100], seeds, swappedSides: true, format: '1v1', traits: false, gear: false,
        rulesetVersion: 'progression-v3', policy: 'same server AI on both sides', rewards: false,
        syntheticForms: 'Starter legendary forms below level90 are labelled and excluded from reachable summary.' },
    sourceFingerprints, finalSourceFingerprints, warnings,
    summary: summarize(rows), reachableSummary: summarize(rows.filter(row => !row.syntheticUnreachableForm)),
    levels: [75, 100].map(level => ({ level, ...summarize(rows.filter(row => row.level === level)),
        reachable: summarize(rows.filter(row => row.level === level && !row.syntheticUnreachableForm)) })),
    limitations: ['Natural AI outcomes include move choices and variance; no universal point-value equality is asserted.',
        'This survivability control is not PvP validation and does not replace team, summon or spatial integration evidence.'],
    rows,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, summary: report.summary, reachableSummary: report.reachableSummary, warnings }));
if (warnings.length) process.exitCode = 1;
