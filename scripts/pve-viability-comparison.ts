/** Corrected progression fixture comparison, actual Explore/road constructors.
 * Example: --baseline-root ../pve-baseline --path explore --output report.json
 * Captures every deterministic case; no writes outside the requested JSON.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CURRENT, PRESSURE_LEVELS, PRESSURE_BUILDS, pressureFight, summarizePressure, type Build, type Difficulty, type Runtime, type PressureResult } from './pve-pressure-benchmark.js';
import { answeringPlayerActions, diagnosticPlayerSave, diagnosticFixtureAudit } from './pve-viability-diagnostic.js';
import { ordinaryPveLevel } from '../shared/ordinary-pve-encounter.js';
import { auditPressureFixture } from './_pve-pressure-fixture-audit.js';

const BASELINE_SHA = 'e2ccccb0d4d7cc30e8810040e3353f8a6cd2aba9';
const SOURCE_FILES = ['api/solo-pve/_engine.ts', 'api/solo-pve/_ai-turn-policy.ts', 'api/solo-pve/_ai-encounter.ts',
    'api/missions/_ordinary-ai-encounter.ts', 'api/_ai-opponent-loadout.ts', 'api/_pve-ai-mastery.ts',
    'api/story/_authoritative-story-combat.ts', 'shared/story-kage.ts', 'shared/ordinary-pve-encounter.ts',
    'scripts/pve-pressure-benchmark.ts', 'scripts/pve-viability-diagnostic.ts', 'scripts/pve-viability-comparison.ts', 'scripts/_pve-pressure-fixture-audit.ts'];

async function main() {
    const opt = (key: string) => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
    if (!opt('--baseline-root') || !opt('--output')) throw new Error('--baseline-root and --output required');
    const from = (path: string) => import(pathToFileURL(resolve(opt('--baseline-root')!, path)).href);
    const [builder, engine, catalog, story, curves] = await Promise.all([from('api/solo-pve/_ai-encounter.ts'), from('api/solo-pve/_engine.ts'),
        from('api/_ai-profile-catalog.ts'), from('api/story/_authoritative-story-combat.ts'), from('api/_ai-level-curves.ts')]);
    const beforeRuntime: Runtime = { build: builder.buildSoloPveAiEncounter, act: engine.applySoloPveAction, catalog: catalog.AI_PROFILE_CATALOG,
        story: story.storyBossEnemyTemplate, relevel: curves.relevelAiProfile };
    const path: 'explore' | 'natural' = opt('--path') === 'natural' ? 'natural' : 'explore';
    const levels = (opt('--levels')?.split(',').map(Number) ?? PRESSURE_LEVELS);
    const builds = (opt('--builds')?.split(',') ?? PRESSURE_BUILDS) as Build[];
    const seeds = path === 'natural' ? [0, 1, 2] : [0, 1, 2, 3, 4];
    const fractions = path === 'natural' ? [0, .5, .999999] : [0, .25, .5, .75, .999999];
    // A region near each player's progression, capped to the current map.
    // Putting a novice in sector66 invokes the +5 danger floor and would test
    // remote-region intrusion rather than an ordinary same-progression roll.
    const sectorForLevel = (level: number) => Math.max(0, Math.min(66, Math.ceil((level - 6) / 1.4)));
    const rows: PressureResult[] = [];
    const beforeCache = new Map<string, PressureResult>();
    const fixtureAudit = levels.flatMap(level => builds.map(build => ({ build,
        basic: diagnosticFixtureAudit(level, build, 'coherent', build === 'starter' ? 'none' : 'B'),
        ...auditPressureFixture(diagnosticPlayerSave(level, build, 'coherent', build === 'starter' ? 'none' : 'B'), level),
    })));
    if (fixtureAudit.some(row => !row.legal || !row.basic.legal || row.acquisitionWarnings.length))
        throw new Error(`Fixture validation failed: ${JSON.stringify(fixtureAudit.filter(row => !row.legal || !row.basic.legal || row.acquisitionWarnings.length))}`);
    const sourceHashes = Object.fromEntries(SOURCE_FILES.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]));
    const metadata = { fixtureVersion: 2, node: process.version, platform: process.platform, baselineSha: BASELINE_SHA,
        path, sectors: Object.fromEntries(levels.map(level => [level, sectorForLevel(level)])), seeds, fractions, sourceHashes, playerPolicy: 'answer', fixtureAudit,
        notes: ['Actual before Explore authored-profile/scaling path; actual before road player+1/generic path.',
            'After uses server ordinaryAiProfile, actual fraction/region-derived level, and the sealed legal kit/resources.',
            'Nonstarter moderate B-rank multiplier1.10; maxed control retains S-rank1.20. No BL-exclusive jutsu.',
            'Full starting resources; no pets/consumables. Five builds use one/two acquired natures and effective-gated gear.',
            'Eight techniques are a bounded loadout below player baseline12-slot entitlement. Policy is competent, not optimal.',
            'Pre-DR base unavailable from immutable old resolver; rawAfterMitigation is post-DR/pre-guard.',
            'Living round-limit loss is separate from death. AP wasted includes terminal partial turns. Net resource spend includes regeneration.'] };
    const checkpoint = (complete = false) => writeFileSync(opt('--output')!, JSON.stringify({ ...metadata, complete, rows, summary: summarizePressure(rows) }, null, 2) + '\n');
    for (const level of levels) for (const build of builds) {
        const save = diagnosticPlayerSave(level, build, 'coherent', build === 'starter' ? 'none' : 'B');
        for (const difficulty of ['weaker', 'standard', 'dangerous', 'elite'] as Difficulty[]) for (const seed of seeds) {
            const cacheKey = `${level}:${build}:${seed}`;
            let old = beforeCache.get(cacheKey);
            if (!old) {
                old = pressureFight(beforeRuntime, { level, build, difficulty: 'standard', seed, variant: 'before', path,
                    save, playerPolicy: answeringPlayerActions, playerPolicyName: 'answer' });
                beforeCache.set(cacheKey, old);
            }
            rows.push({ ...old, difficulty });
            rows.push(pressureFight(CURRENT, { level, build, difficulty, seed, variant: 'after', path,
                enemyLevel: ordinaryPveLevel(level, sectorForLevel(level), difficulty as 'weaker' | 'standard' | 'dangerous' | 'elite', fractions[seed]),
                save, playerPolicy: answeringPlayerActions, playerPolicyName: 'answer' }));
        }
        if (level === 100 && path === 'explore') for (let seed = 0; seed < 4; seed++) for (const [variant, runtime] of [['before', beforeRuntime], ['after', CURRENT]] as const)
            rows.push(pressureFight(runtime, { level, build, difficulty: 'final-kage', seed, variant, path,
                save, playerPolicy: answeringPlayerActions, playerPolicyName: 'answer' }));
        checkpoint();
        console.log(JSON.stringify({ path, level, build, rows: rows.length,
            after: rows.filter(row => row.level === level && row.build === build && row.variant === 'after').map(row => ({ difficulty: row.difficulty,
                seed: row.seed, enemyLevel: row.enemyLevel, outcome: row.outcome, death: row.death, limit: row.roundLimitLoss, hp: row.finalHp, rounds: row.rounds })) }));
    }
    checkpoint(true);
    console.log(`${rows.length} rows complete; source hashes captured before simulation.`);
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/pve-viability-comparison.ts')) void main();
