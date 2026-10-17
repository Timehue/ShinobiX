/** Local-only final-story acceptance controls. No storage, routes or live saves.
 * One acquired two-nature build faces every village; no per-boss kit changes.
 * Run: node --import tsx scripts/pve-kage-acceptance.ts --output report.json
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { CURRENT, pressureFight, type Build } from './pve-pressure-benchmark.js';
import { diagnosticFixtureAudit, diagnosticPlayerSave, plannedPlayerActions, answeringPlayerActions } from './pve-viability-diagnostic.js';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';

const EXTRA_IDS = ['starter-gen-earth-aoe', 'starter-gen-wind-aoe', 'starter-buki-wind-2', 'starter-gen-wind-4'];

export function kageAcceptanceSave(build: Build) {
    const save = diagnosticPlayerSave(100, build, 'coherent', 'B');
    const mastery = save.character.jutsuMastery[0].level;
    save.character.equippedJutsuIds.push(...EXTRA_IDS);
    save.character.jutsuMastery.push(...EXTRA_IDS.map(jutsuId => ({ jutsuId, level: mastery, xp: 0 })));
    if (save.character.equippedJutsuIds.length !== 12) throw new Error('Expected twelve-slot endgame capacity');
    return save;
}

async function main() {
    const opt = (key: string) => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
    const builds = (opt('--builds') ?? 'offense,maxed').split(',') as Build[];
    const policies = (opt('--policies') ?? 'answer,planner').split(',');
    const fixtureAudit = builds.map(build => ({ ...diagnosticFixtureAudit(100, build, 'coherent', 'B'),
        effectiveBloodlineRank: build === 'maxed' ? 'S' : 'B' }));
    const extraKit = EXTRA_IDS.map(id => ({ id, element: JUTSU_CATALOG[id]?.element, tags: JUTSU_CATALOG[id]?.tags,
        owned: ['Earth', 'Wind'].includes(JUTSU_CATALOG[id]?.element ?? '') }));
    if (fixtureAudit.some(f => !f.legal) || extraKit.some(j => !j.owned)) throw new Error('Illegal acceptance fixture');
    const sourceHashes = Object.fromEntries(['api/solo-pve/_engine.ts', 'api/solo-pve/_ai-turn-policy.ts', 'api/solo-pve/_ai-encounter.ts',
        'api/missions/_ordinary-ai-encounter.ts', 'api/_ai-opponent-loadout.ts', 'shared/story-kage.ts',
        'api/story/_authoritative-story-combat.ts', 'scripts/pve-viability-diagnostic.ts', 'scripts/pve-kage-acceptance.ts']
        .map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
    const rows: ReturnType<typeof pressureFight>[] = [];
    const record = (measured: ReturnType<typeof pressureFight>) => {
        rows.push(measured);
        console.log(JSON.stringify({ build: measured.build, policy: measured.playerPolicy, difficulty: measured.difficulty, seed: measured.seed,
            outcome: measured.outcome, death: measured.death, rounds: measured.rounds, hp: measured.finalHp,
            enemyHp: measured.finalEnemyHp, p95Ms: measured.enemyTurnMsP95 }));
        if (opt('--output')) writeFileSync(opt('--output')!, JSON.stringify({ fixtureVersion: 2, purpose: 'final-story winnability and optional matched ordinary controls',
            sourceHashes, fixtureAudit, extraKit, equippedSlots: 12, timingLoad: opt('--load') ?? 'unspecified',
            limits: ['Synthetic acquired Earth/Wind fixtures, not a live account.',
                'The planner is a bounded public-state own-turn proxy; it omits player weapons.',
                'The answer heuristic is deliberately imperfect. No policy guarantees a win.',
                'Wall timings reflect the recorded local execution load; no universal latency promise.'], rows }, null, 2) + '\n');
    };
    for (const build of builds) for (const policy of policies) for (let seed = 0; seed < 4; seed++) {
        const measured = pressureFight(CURRENT, { level: 100, build, difficulty: 'final-kage', seed, variant: 'after',
            enemyLevel: 100, save: kageAcceptanceSave(build), playerPolicy: policy === 'planner' ? plannedPlayerActions : answeringPlayerActions,
            playerPolicyName: policy, trace: process.argv.includes('--trace') });
        record(measured);
    }
    // Same maximum-regional ordinary level and same acquired twelve-slot build
    // for every archetype. No injected stats, equipment or player-policy switch.
    if (process.argv.includes('--ordinary')) for (const difficulty of ['standard', 'elite'] as const) for (let seed = 0; seed < 5; seed++) {
        record(pressureFight(CURRENT, { level: 100, build: 'maxed', difficulty, seed, variant: 'after', enemyLevel: 98,
            save: kageAcceptanceSave('maxed'), playerPolicy: plannedPlayerActions, playerPolicyName: 'planner', trace: process.argv.includes('--trace') }));
    }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/pve-kage-acceptance.ts')) void main();
