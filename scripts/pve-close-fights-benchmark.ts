/** Current-main matched-seed follow-up. Offline only; no storage writes.
 * NODE_PATH=<repo>/node_modules node --import tsx scripts/pve-close-fights-benchmark.ts
 * --baseline-root <archive of a31087565> --output report.json
 * Both variants use the SAME legal player fixture/policy and rolled level.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CURRENT, pressureFight, type Build, type Difficulty, type Runtime } from './pve-pressure-benchmark.js';
import { diagnosticPlayerSave, answeringPlayerActions, plannedPlayerActions } from './pve-viability-diagnostic.js';
import { kageAcceptanceSave } from './pve-kage-acceptance.js';
import { auditPressureFixture } from './_pve-pressure-fixture-audit.js';
import { ordinaryPveLevel } from '../shared/ordinary-pve-encounter.js';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';
import { buildNamedItem } from '../api/craft/_named.js';
import { worldRuntimeAiProfile } from '../api/missions/_world-ai-fight.js';
import { buildItemLookup } from '../api/pvp/_multipliers.js';
import { effectiveItemLevelReq } from '../shared/item-level-gate.js';
import { canonicalEquipmentSlot } from '../api/_equipment-ownership.js';
import type { SoloPveSession } from '../api/solo-pve/_session.js';

const SOURCE_FILES = ['api/solo-pve/_engine.ts', 'api/solo-pve/_ai-encounter.ts', 'api/solo-pve/_ai-turn-policy.ts',
    'api/_ai-opponent-loadout.ts', 'api/_pve-ai-mastery.ts', 'api/_pve-challenge-weapon.ts',
    'api/missions/_ordinary-ai-encounter.ts', 'api/missions/_world-ai-fight.ts', 'shared/story-kage.ts',
    'api/story/_authoritative-story-combat.ts', 'api/_ai-profile-catalog.ts', 'shared/ordinary-pve-encounter.ts',
    'api/story/_authoritative-story-combat.ts', 'api/_ai-profile-catalog.ts', 'shared/ordinary-pve-encounter.ts',
    'api/combat-core/formulas.ts', 'api/pvp/move.ts', 'api/pvp/session.ts', 'api/pvp/_multipliers.ts',
    'api/pvp/_jutsu-catalog.ts', 'api/pvp/_item-catalog.ts', 'api/_combat-resources.ts', 'api/_ai-level-curves.ts',
    'api/craft/_named.ts', 'api/_entitlements.ts', 'api/_xp-engine.ts', 'api/solo-pve/_session.ts',
    'shared/named-forge-roll.ts', 'shared/item-level-gate.ts', 'shared/wanderer-roster.ts',
    'scripts/_pve-pressure-fixture-audit.ts', 'scripts/pve-viability-diagnostic.ts', 'scripts/pve-pressure-benchmark.ts',
    'scripts/pve-kage-acceptance.ts', 'scripts/pve-close-fights-benchmark.ts'];
const hashes = () => Object.fromEntries(SOURCE_FILES.map(p => [p, createHash('sha256').update(readFileSync(p)).digest('hex')]));

/** Current-forge legal sustain control, explicitly NOT an exact Rill replay.
 * Two acquired natures,12slots,50mastery; no custom bloodline jutsu/passives.
 * Known Rill legacy33EP blade and unknown armor rolls are not invented here.
 */
export function closeFightSave(level: number, fixture: string): ReturnType<typeof diagnosticPlayerSave> {
    if (fixture === 'stress') {
        const save = closeFightSave(level, 'sustain');
        const c = save.character as Record<string, any>;
        // Explicit legacy stress control: observed33EP remains below the
        // shared36EP weapon ceiling. It is not a current-forge roll or a
        // reconstruction of Rill's unknown custom jutsu/other armor rolls.
        c.patreon = { active: true };
        const extra = ['starter-buki-earth-3', 'starter-gen-earth-4', 'starter-tai-wind-3'];
        c.equippedJutsuIds.push(...extra);
        c.jutsuMastery.push(...extra.map(jutsuId => ({ jutsuId, level: 50, xp: 0 })));
        (save as Record<string, any>).creatorItems[0].weaponEp = 33;
        return save;
    }
    const build: Build = fixture === 'rookie' ? 'starter' : fixture === 'trained' ? 'midgame' : fixture === 'specialist' ? 'offense' : 'maxed';
    const save = level === 100 && fixture !== 'narrow' ? kageAcceptanceSave(build) : diagnosticPlayerSave(level, build, 'coherent', 'B');
    if (fixture === 'rookie') {
        if (level !== 17) throw new Error('Rookie control is level17 only');
        // Buster-inspired control: legal cloth/mastery1 and319unspent points.
        // Exact live stat allocation is unknown, so this is explicitly synthetic.
        const c = save.character;
        c.equipment = { body: 'shinobi-vest' } as typeof c.equipment;
        c.inventory = ['shinobi-vest'];
        c.jutsuMastery = c.jutsuMastery.map(m => ({ ...m, level: 1 }));
        let refund = 319;
        while (refund > 0) for (const key of Object.keys(c.stats)) if (refund > 0 && c.stats[key] > 10) { c.stats[key]--; refund--; }
        c.unspentStats = 319;
        return save;
    }
    if (fixture !== 'sustain') return save;
    if (level !== 100) throw new Error('Current-forge sustain control is endgame only');
    const c = save.character;
    c.specialty = 'Ninjutsu';
    c.equippedJutsuIds = ['starter-nin-earth-2', 'starter-nin-wind-2', 'starter-gen-earth-2', 'starter-gen-wind-2',
        'starter-tai-wind-2', 'starter-buki-wind-2', 'starter-nin-earth-3', 'starter-gen-earth-1',
        'starter-nin-earth-1', 'starter-buki-wind-4', 'starter-gen-wind-1', 'starter-universal-flicker'];
    c.jutsuMastery = c.equippedJutsuIds.map(jutsuId => ({ jutsuId, level: 50, xp: 0 }));
    const blade = buildNamedItem({ kind: 'weapon', ep: 27, range: 4, offenseVal: 180,
        tags: [{ name: 'Heal', percent: 12 }, { name: 'Shield', percent: 12 }] }, 'Benchmark Sustain Blade', '');
    blade.id = 'named-weapon-00000000000000000000000000000001';
    const armor = (['head', 'body', 'waist', 'legs', 'feet'] as const).map((slot, i) => ({
        ...buildNamedItem({ kind: 'armor', slot, armorQuality: 'Legendary', offenseVal: 30, defenseVal: 30,
            special: { kind: 'Life Steal', bonusKey: 'lifeStealPercent', value: 2 } }, `Benchmark ${slot}`, ''),
        id: `named-armor-0000000000000000000000000000000${i + 2}`,
    }));
    c.equipment = Object.fromEntries([['hand', blade.id], ...armor.map(a => [a.slot, a.id])]);
    c.inventory = Object.values(c.equipment);
    (save as Record<string, unknown>).creatorItems = [blade, ...armor];
    return save;
}

/** Reuse the independent catalog validator for every other invariant; the
 * six explicit current-forge definitions are separately verified as owned,
 * slot-compatible and level-gated through the production lookup. */
export function closeFixtureAudit(level: number, fixture: string) {
    const save = closeFightSave(level, fixture);
    const audit = auditPressureFixture(save, level);
    const custom = (save as Record<string, any>).creatorItems as Record<string, any>[] | undefined;
    const lookup = buildItemLookup(custom);
    const customGear = Object.entries(save.character.equipment).map(([slot, id]) => {
        const item = lookup(id);
        return { slot, id, requiredLevel: item ? effectiveItemLevelReq(item) : null,
            legal: !!item && effectiveItemLevelReq(item) <= level && canonicalEquipmentSlot(String(item.slot)) === canonicalEquipmentSlot(slot)
                && save.character.inventory.includes(id) };
    });
    const failures = audit.failures.filter(f => !(custom && f.code === 'equipment-source'));
    if (customGear.some(g => !g.legal)) failures.push({ code: 'current-forge-equipment', path: 'character.equipment' });
    return { ...audit, legal: failures.length === 0 && !audit.acquisitionWarnings.length, failures, customGear,
        kit: save.character.equippedJutsuIds.map(id => ({ ...JUTSU_CATALOG[id], mastery: save.character.jutsuMastery.find(m => m.jutsuId === id)?.level })),
        ownedNamedDefinitions: custom, save };
}

const recklessActions = (s: SoloPveSession) => answeringPlayerActions(s).filter(a => !['clear', 'cleanse', 'basicHeal'].includes(a.type)
    && (a.type !== 'jutsu' || !['starter-gen-earth-1', 'starter-nin-earth-3', 'starter-gen-wind-1'].includes(a.jutsuId)));

async function main() {
    const opt = (key: string) => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
    const output = opt('--output');
    if (!output) throw new Error('--output is required');
    let baseline: Runtime | undefined;
    if (opt('--baseline-root')) {
        const from = (p: string) => import(pathToFileURL(resolve(opt('--baseline-root')!, p)).href);
        const [b, e, c, st, r] = await Promise.all([from('api/solo-pve/_ai-encounter.ts'), from('api/solo-pve/_engine.ts'),
            from('api/_ai-profile-catalog.ts'), from('api/story/_authoritative-story-combat.ts'), from('api/_ai-level-curves.ts')]);
        baseline = { build: b.buildSoloPveAiEncounter, act: e.applySoloPveAction, catalog: c.AI_PROFILE_CATALOG,
            story: st.storyBossEnemyTemplate, relevel: r.relevelAiProfile };
    }
    const levels = (opt('--levels') ?? '17,25,50,75,100').split(',').map(Number);
    const fixtures = (opt('--fixtures') ?? 'trained,specialist,optimized,narrow').split(',');
    const difficulties = (opt('--difficulties') ?? 'weaker,standard,dangerous,elite').split(',') as Difficulty[];
    const seeds = (opt('--seeds') ?? '0,1,2,3,4').split(',').map(Number);
    const policies = (opt('--policies') ?? 'planner').split(',');
    const paths = (opt('--paths') ?? 'explore').split(',') as Array<'explore' | 'natural'>;
    const startHashes = hashes();
    const fixtureAudit = levels.flatMap(l => fixtures.filter(f => !['sustain', 'stress'].includes(f) || l === 100).map(f => ({ fixture: f, ...closeFixtureAudit(l, f) })));
    if (fixtureAudit.some(a => !a.legal)) throw new Error(`Illegal fixtures: ${JSON.stringify(fixtureAudit.filter(a => !a.legal))}`);
    const rows: Array<ReturnType<typeof pressureFight> & { fixture: string; source: string }> = [];
    const record = (row: typeof rows[number]) => {
        rows.push(row);
        writeFileSync(output, JSON.stringify({ baselineSha: 'a31087565df43d4b34f81f5b5bdb5acf5841b724', node: process.version,
            sourceHashes: startHashes, complete: false, fixtureAudit, rows }, null, 2) + '\n');
        console.log(JSON.stringify({ fixture: row.fixture, variant: row.variant, source: row.source, level: row.level,
            enemyLevel: row.enemyLevel, difficulty: row.difficulty, seed: row.seed, policy: row.playerPolicy,
            outcome: row.outcome, hp: row.finalHp, min: row.minimumHp, rounds: row.rounds }));
    };
    for (const level of levels) for (const fixture of fixtures.filter(f => !['sustain', 'stress'].includes(f) || level === 100)) for (const policy of policies)
        for (const path of paths) for (const difficulty of difficulties) for (const seed of seeds) {
            if (path === 'natural' && seed > 2) continue;
            const sector = Math.max(0, Math.min(66, Math.ceil((level - 6) / 1.4)));
            const enemyLevel = difficulty === 'final-kage' ? 100 : opt('--enemy-level') ? Number(opt('--enemy-level')) : ordinaryPveLevel(level, sector, difficulty, [0, .25, .5, .75, .999999][seed % 5]);
            const save = closeFightSave(level, fixture);
            const run = (runtime: Runtime) => pressureFight(runtime, { level, build: fixture === 'trained' ? 'midgame' : fixture === 'specialist' ? 'offense' : 'maxed',
                difficulty, seed, variant: 'after', path, enemyLevel, save,
                playerPolicy: policy === 'planner' ? plannedPlayerActions : policy === 'reckless' ? recklessActions : answeringPlayerActions,
                playerPolicyName: policy, trace: process.argv.includes('--trace') });
            if (baseline) record({ ...run(baseline), variant: 'before', fixture, source: path });
            record({ ...run(CURRENT), fixture, source: path });
        }
    if (process.argv.includes('--named')) for (const fixture of fixtures.filter(f => ['optimized', 'sustain', 'stress'].includes(f)))
        for (const loadout of ['bruiser', 'defender', 'boss'] as const) for (const seed of seeds.slice(0, 2)) {
            const profile = worldRuntimeAiProfile(`world-benchmark-${loadout}`, `Named ${loadout}`, 100, 0, loadout, true);
            for (const [variant, runtime] of [...(baseline ? [['before', baseline] as const] : []), ['after', CURRENT] as const]) {
                const oldId = loadout === 'boss' ? 'builtin-ai-central-champion' : loadout === 'defender' ? 'builtin-ai-mist-sentinel' : 'builtin-ai-rogue-ninja';
                const oldProfile = runtime.relevel({ ...structuredClone(runtime.catalog[oldId]), id: profile.id, name: profile.name } as any, 100, 0);
                record({ ...pressureFight(runtime, { level: 100, build: 'maxed', difficulty: 'elite', seed, variant: 'after', enemyLevel: 100,
                    save: closeFightSave(100, fixture), profileOverride: variant === 'before' ? oldProfile : profile,
                    playerPolicy: plannedPlayerActions, playerPolicyName: 'planner', trace: process.argv.includes('--trace') }),
                    variant, fixture, source: `named-${loadout}` });
            }
        }
    const unchangedSources = JSON.stringify(startHashes) === JSON.stringify(hashes());
    writeFileSync(output, JSON.stringify({ baselineSha: 'a31087565df43d4b34f81f5b5bdb5acf5841b724', node: process.version,
        sourceHashes: startHashes, complete: unchangedSources && rows.every(r => r.completed), unchangedSources, fixtureAudit, rows,
        limitations: ['Offline synthetic fixtures, not an exact live Rill replay. No unknown custom techniques or gear rolls were invented.',
            'Sustain uses current legal27EP named blade. Separately labeled stress uses observedlegacy33EP,15subscriber slots,synthetic catalog techniques and five2%lifesteal armor rolls; neither is an exact Rill replay.',
            'Planner is bounded own-turn public-state search; no hidden player input or forced health target.',
            'Damage/healing telemetry can net simultaneous recovery within one event; actual HP damage, shield damage and final/minimum HP are separate.',
            'Named before profile reproduces the exact old runtimeProfile generic allocation; identity/rewards are not simulated.',
            'World/clan group bosses and weekly score attack have separate source probes.'] }, null, 2) + '\n');
    if (!unchangedSources) throw new Error('Runtime sources changed during measurement; rerun evidence');
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/pve-close-fights-benchmark.ts')) void main();
