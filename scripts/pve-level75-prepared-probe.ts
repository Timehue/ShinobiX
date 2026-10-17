/** Standalone L75 capacity/accessibility sensitivity. Offline only.
 * PowerShell: $env:NODE_PATH = Join-Path (Get-Location) 'node_modules'
 * node --import tsx scripts/pve-level75-prepared-probe.ts --baseline-root ../pve-current-main
 * Does not modify the primary benchmark, runtime, or existing evidence manifests.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CURRENT, pressureFight, type Difficulty, type Runtime } from './pve-pressure-benchmark.js';
import { diagnosticPlayerSave, plannedPlayerActions, answeringPlayerActions } from './pve-viability-diagnostic.js';
import { auditPressureFixture } from './_pve-pressure-fixture-audit.js';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { maxLoadout } from '../api/_entitlements.js';
import { earnedForLevel } from '../api/_xp-engine.js';
import { ordinaryPveLevel } from '../shared/ordinary-pve-encounter.js';
import { effectiveItemLevelReq } from '../shared/item-level-gate.js';

const BASELINE_SHA = 'a31087565df43d4b34f81f5b5bdb5acf5841b724';
const LEVEL = 75;
const SECTOR = Math.max(0, Math.min(66, Math.ceil((LEVEL - 6) / 1.4)));
const FRACTIONS = [0, .25, .5, .75, .999999];
const KITS = {
    'rotation12': ['starter-gen-earth-aoe', 'starter-gen-wind-aoe', 'starter-buki-wind-2', 'starter-gen-wind-4'],
    'sustain12': ['starter-nin-earth-1', 'starter-nin-earth-3', 'starter-gen-earth-4', 'starter-tai-earth-2'],
};
type Fixture = keyof typeof KITS;
type Measured = ReturnType<typeof pressureFight> & { fixture: Fixture; source: string; control: string };

function fixture(name: Fixture) {
    // Identical to the previously measured optimized75 eight-slot control,
    // except four learned techniques fill the ordinary account's12 slots.
    const save = diagnosticPlayerSave(LEVEL, 'maxed', 'coherent', 'B');
    save.character.equippedJutsuIds.push(...KITS[name]);
    save.character.jutsuMastery.push(...KITS[name].map(jutsuId => ({ jutsuId, level: 50, xp: 0 })));
    const audit = auditPressureFixture(save, LEVEL, { expectedMasteryCeiling: 50, expectedBloodlineRank: 'S Rank' });
    if (!audit.legal || audit.acquisitionWarnings.length || maxLoadout(save.character) !== 12
        || save.character.equippedJutsuIds.length !== 12 || save.character.earnedStatPoints !== earnedForLevel(LEVEL)) {
        throw new Error(`Invalid ${name} fixture: ${JSON.stringify(audit)}`);
    }
    return { save, audit,
        gear: Object.entries(save.character.equipment).map(([slot, id]) => ({ slot, id, definition: ITEM_CATALOG[id], effectiveLevelReq: effectiveItemLevelReq(ITEM_CATALOG[id]) })),
        kit: save.character.equippedJutsuIds.map(id => ({ ...JUTSU_CATALOG[id], mastery: 50 })),
    };
}

async function main() {
    const option = (key: string) => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
    const baselineRoot = resolve(option('--baseline-root') ?? '../pve-current-main');
    const output = option('--output') ?? 'docs/pve-close-fights-evidence/level75-prepared.json';
    const markdown = output.replace(/\.json$/, '.md');
    // Retain a broad runtime dependency inventory, including this probe itself.
    const sourceFiles = execFileSync('git', ['ls-files', 'api/solo-pve', 'api/combat-core', 'api/pvp', 'shared'], { encoding: 'utf8' })
        .trim().split(/\r?\n/).filter(p => p.endsWith('.ts') && !p.endsWith('.test.ts'));
    sourceFiles.push(...['api/_ai-opponent-loadout.ts', 'api/_ai-profile-catalog.ts', 'api/_ai-level-curves.ts', 'api/_pve-ai-mastery.ts',
        'api/_pve-difficulty.ts', 'api/_pve-band-seal.ts', 'api/_pve-challenge-weapon.ts', 'api/_combat-resources.ts', 'api/_xp-engine.ts', 'api/_entitlements.ts',
        'api/missions/_ordinary-ai-encounter.ts', 'api/story/_authoritative-story-combat.ts',
        'scripts/pve-pressure-benchmark.ts', 'scripts/pve-viability-diagnostic.ts', 'scripts/mission-encounter-sim.ts',
        'scripts/_pve-pressure-fixture-audit.ts', 'scripts/pve-level75-prepared-probe.ts']);
    const paths = [...new Set(sourceFiles)].sort();
    const hashes = (root: string) => Object.fromEntries(paths.map(p => [p, existsSync(resolve(root, p))
        ? createHash('sha256').update(readFileSync(resolve(root, p))).digest('hex') : null]));
    const candidateHashes = hashes('.'), baselineHashes = hashes(baselineRoot);
    // Verify archived runtime bytes against the immutable Git object. New
    // candidate-only helpers are expected absent; no archive label is trusted.
    const archiveMismatches: string[] = [];
    const tree = new Map<string, string>(execFileSync('git', ['ls-tree', '-r', BASELINE_SHA], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
        .trim().split(/\r?\n/).map((line): [string, string] => { const [meta, path] = line.split('\t'); return [path, meta.split(' ')[2]]; }));
    for (const p of paths.filter(p => p.startsWith('api/') || p.startsWith('shared/'))) {
        const expected = tree.get(p);
        if (!expected) continue;
        // Git text is LF while checkout/archive extraction may be CRLF.
        if (!existsSync(resolve(baselineRoot, p))) { archiveMismatches.push(p); continue; }
        const bytes = Buffer.from(readFileSync(resolve(baselineRoot, p), 'utf8').replaceAll('\r\n', '\n'));
        const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        if (blob !== expected) archiveMismatches.push(p);
    }
    if (archiveMismatches.length) throw new Error(`Archive differs from current-main baseline: ${archiveMismatches.join(', ')}`);
    const from = (p: string) => import(pathToFileURL(resolve(baselineRoot, p)).href);
    const [b, e, c, st, r] = await Promise.all([from('api/solo-pve/_ai-encounter.ts'), from('api/solo-pve/_engine.ts'),
        from('api/_ai-profile-catalog.ts'), from('api/story/_authoritative-story-combat.ts'), from('api/_ai-level-curves.ts')]);
    const baseline: Runtime = { build: b.buildSoloPveAiEncounter, act: e.applySoloPveAction, catalog: c.AI_PROFILE_CATALOG,
        story: st.storyBossEnemyTemplate, relevel: r.relevelAiProfile };
    const fixtures = Object.fromEntries((Object.keys(KITS) as Fixture[]).map(name => [name, fixture(name)])) as Record<Fixture, ReturnType<typeof fixture>>;
    const rows: Measured[] = [];
    const report = { baselineSha: BASELINE_SHA, candidateHeadAtStart: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        generatedAt: new Date().toISOString(), node: process.version, level: LEVEL, sector: SECTOR,
        purpose: 'Isolate legal full baseline capacity from prior eight-slot75 fixtures; preserve alternative kits and losses.',
        fixtureAudit: fixtures, sourceHashes: candidateHashes, baselineSourceHashes: baselineHashes, archiveMismatches,
        complete: false, rows, limitations: [
            'Synthetic L75 fixtures with exactly17711earned points, S-rank multiplier1.20, mastery50 and obtainable legendary catalog gear; no invented passive, companion, consumable or supporter capacity.',
            'Both fixed Earth/Wind kits use12baseline slots; stats/gear/bloodline are unchanged from the earlier optimized eight-slot L75 fixture.',
            'The same current bounded own-turn player policy is used in both variants. It is weapon-aware and reads only public state and its own legal actions; no future opponent response is searched.',
            'Before uses archived main resolver/builder/catalog at the same exact rolled enemy level, role, seed, player fixture and player policy. Ordinary profile adapter is unchanged at this baseline.',
            'Observed HP damage, shields, applied healing, net loss and minimum/end HP are distinct; recovery may net within one event.',
            'All failures and alternative controls are retained. A winning route is evidence of accessibility, not a promise every legal build or policy wins.',
        ] };
    mkdirSync(dirname(output), { recursive: true });
    const checkpoint = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    checkpoint();
    const run = (name: Fixture, path: 'explore' | 'natural', difficulty: Difficulty, seed: number, policy = 'planner') => {
        const enemyLevel = ordinaryPveLevel(LEVEL, SECTOR, difficulty as 'standard' | 'dangerous' | 'elite', FRACTIONS[seed]);
        for (const [variant, runtime] of [['before', baseline], ['after', CURRENT]] as const) {
            const row = { ...pressureFight(runtime, { level: LEVEL, build: 'maxed', difficulty, seed, variant: 'after', path,
                enemyLevel, save: structuredClone(fixtures[name].save), playerPolicy: policy === 'planner' ? plannedPlayerActions : answeringPlayerActions,
                playerPolicyName: policy, trace: true }), variant, fixture: name, source: path, control: policy };
            rows.push(row); checkpoint();
            console.log(JSON.stringify({ fixture: name, path, difficulty, seed, variant, enemyLevel, policy, outcome: row.outcome,
                rounds: row.rounds, minimumHp: row.minimumHp, finalHp: row.finalHp, finalEnemyHp: row.finalEnemyHp }));
        }
    };
    // Independent sustain-kit sensitivity, same stats/gear/mastery. No kit is
    // selected per enemy; every standard role faces the same alternative kit.
    for (let seed = 0; seed < 5; seed++) run('sustain12', 'explore', 'standard', seed);
    // All5Explore roles/openings and all3road roles are retained at every tier.
    for (const difficulty of ['standard', 'dangerous', 'elite'] as const) for (const path of ['explore', 'natural'] as const)
        for (let seed = 0; seed < (path === 'explore' ? 5 : 3); seed++) run('rotation12', path, difficulty, seed);
    // If bounded planning fails, retain an independent public heuristic reply
    // for exactly those standard openings, rather than declare unwinnability.
    const failures = rows.filter(row => row.variant === 'after' && row.difficulty === 'standard' && row.outcome !== 'win');
    for (const row of failures) run(row.fixture, row.path as 'explore' | 'natural', 'standard', row.seed, 'answer');
    const afterHashes = hashes('.'), afterBaselineHashes = hashes(baselineRoot);
    const changed = paths.filter(p => candidateHashes[p] !== afterHashes[p]);
    const baselineChanged = paths.filter(p => baselineHashes[p] !== afterBaselineHashes[p]);
    const groups = [...new Set(rows.map(row => `${row.fixture}|${row.source}|${row.difficulty}|${row.control}|${row.variant}`))].map(key => {
        const set = rows.filter(row => `${row.fixture}|${row.source}|${row.difficulty}|${row.control}|${row.variant}` === key);
        return { key, fights: set.length, wins: set.filter(row => row.outcome === 'win').length, deaths: set.filter(row => row.death).length,
            livingLimits: set.filter(row => row.roundLimitLoss).length, minObservedHp: Math.min(...set.map(row => row.minimumHp)),
            meanRounds: set.reduce((n, row) => n + row.rounds, 0) / set.length };
    });
    Object.assign(report, { complete: changed.length === 0 && baselineChanged.length === 0 && rows.every(row => row.completed),
        sourceHashesAtFinish: afterHashes, baselineSourceHashesAtFinish: afterBaselineHashes, changedSources: changed, changedBaselineSources: baselineChanged, summary: groups });
    checkpoint();
    const table = rows.map(row => `| ${row.fixture} | ${row.source} | ${row.difficulty} | ${row.seed} | ${row.enemyLevel} | ${row.control} | ${row.variant} | ${row.outcome} | ${row.rounds} | ${row.minimumHp} | ${row.finalHp} | ${row.finalEnemyHp} |`).join('\n');
    writeFileSync(markdown, `# Level75 prepared capacity probe\n\nBaseline: \`${BASELINE_SHA}\`. Candidate head at start: \`${report.candidateHeadAtStart}\`. Complete: **${report.complete}**. Source changes: ${changed.length}; baseline changes: ${baselineChanged.length}. Raw audit, full fixtures, source hashes and complete per-action traces are in [the JSON](level75-prepared.json).\n\nThe12-slot controls preserve the earlier optimized75 stats, owned gear, S-rank multiplier and50mastery. Only the four added catalog techniques differ. Production audit confirms12baseline slots,2natures,2100stat cap and17711earned points. Rotation and sustain kits are both retained; neither is selected per enemy.\n\n${groups.map(group => `- ${group.key}: ${group.wins}/${group.fights}wins, ${group.deaths}HP-zero endings, ${group.livingLimits}living limits, mean ${group.meanRounds.toFixed(1)}rounds.`).join('\n')}\n\n| Fixture | Source | Tier | Seed | Enemy Lv | Policy | Variant | Outcome | Rounds | MinHP | EndHP | EnemyHP |\n|---|---|---|---:|---:|---|---|---|---:|---:|---:|---:|\n${table}\n\n${report.limitations.map(limit => `- ${limit}`).join('\n')}\n`);
    if (!report.complete) throw new Error(`Evidence sources changed: ${JSON.stringify({ changed, baselineChanged })}`);
    console.log(JSON.stringify({ complete: report.complete, rows: rows.length, summary: groups, output, markdown }));
}
void main();
