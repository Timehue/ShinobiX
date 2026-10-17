/** Offline, seeded production-engine PvE pressure audit. No storage writes.
 * --baseline-root <git archive checkout> compares its actual runtime/catalog.
 * --output <json> --levels 10,25,50,75,100 --builds starter,midgame,offense,defense,maxed
 * --seeds 2. A matched-mastery baseline isolates kit/tactic improvements.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { buildSoloPveAiEncounter } from '../api/solo-pve/_ai-encounter.js';
import { applySoloPveAction } from '../api/solo-pve/_engine.js';
import { AI_PROFILE_CATALOG } from '../api/_ai-profile-catalog.js';
import { relevelAiProfile } from '../api/_ai-level-curves.js';
import { STANDARD_PVE_AI_POLICY } from '../api/solo-pve/_ai-turn-policy.js';
import { pveAiMasteryForEncounter } from '../api/_pve-ai-mastery.js';
import { pveAiMasteryForLevel } from '../api/_pve-difficulty.js';
import { jutsuLevelCapForLevel, masteryDamageFrac } from '../api/combat-core/formulas.js';
import { missionPlayerSave, policyActions } from './mission-encounter-sim.js';
import { storyBossEnemyTemplate } from '../api/story/_authoritative-story-combat.js';
import { ordinaryAiProfile } from '../api/missions/_ordinary-ai-encounter.js';
import { hexDistance } from '../api/combat-core/grid.js';
import type { SoloPveAction, SoloPveCombatEvent, SoloPveJutsu, SoloPveSession } from '../api/solo-pve/_session.js';

export const PRESSURE_LEVELS = [10, 25, 50, 75, 100];
export const PRESSURE_BUILDS = ['starter', 'midgame', 'offense', 'defense', 'maxed'] as const;
export type Build = typeof PRESSURE_BUILDS[number];
export type Difficulty = 'weaker' | 'standard' | 'dangerous' | 'elite' | 'final-kage';
export type Runtime = { build: typeof buildSoloPveAiEncounter; act: typeof applySoloPveAction; catalog: typeof AI_PROFILE_CATALOG; story: typeof storyBossEnemyTemplate; relevel: typeof relevelAiProfile };
export const CURRENT: Runtime = { build: buildSoloPveAiEncounter, act: applySoloPveAction, catalog: AI_PROFILE_CATALOG, story: storyBossEnemyTemplate, relevel: relevelAiProfile };
const IDS = ['builtin-ai-rogue-ninja', 'builtin-ai-ember-duelist', 'builtin-ai-shadow-weaver', 'builtin-ai-frost-sealer', 'builtin-ai-mist-sentinel'];
const VILLAGES = ['Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village'];
const NOW = 1_800_000_000_000;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export function pressurePlayerSave(level: number, build: Build) {
    const save = missionPlayerSave(level, 'Ninjutsu', 'PressureTester');
    const c = save.character as Record<string, any>;
    const cap = jutsuLevelCapForLevel(level);
    const mastery = build === 'starter' ? Math.min(10, cap) : build === 'midgame' ? Math.min(30, cap) : build === 'maxed' ? cap : Math.min(40, cap);
    // Acquisition grants one nature at L2 and the second at L20; paid rerolls
    // replace, rather than add, natures. These fixtures require no legacy extras.
    c.elements = level < 20 ? ['Earth'] : ['Earth', 'Wind'];
    const ids = build === 'starter' ? ['starter-nin-earth-2', 'starter-gen-earth-2', 'starter-gen-earth-1', 'starter-universal-flicker'] : level < 20 ? [
        'starter-nin-earth-2', 'starter-gen-earth-2', 'starter-tai-earth-2', 'starter-buki-earth-2',
        'starter-gen-earth-1', 'starter-nin-earth-1', 'starter-tai-earth-1', 'starter-universal-flicker',
    ] : [
        'starter-gen-earth-2', 'starter-gen-wind-2', 'starter-nin-earth-2', 'starter-nin-wind-2',
        'starter-gen-earth-1', 'starter-gen-wind-1', 'starter-tai-wind-2', 'starter-universal-flicker',
    ];
    c.equippedJutsuIds = ids;
    c.jutsuMastery = ids.map((jutsuId: string) => ({ jutsuId, level: mastery, xp: 0 }));
    // These are explicit synthetic loadout fixtures, not a copy of a live save.
    // Maxed means rank-capped stats + battle mastery, Rill-style sustain/armor.
    if (build === 'maxed' && level === 100) for (const key of Object.keys(c.stats)) c.stats[key] = 2500;
    c.earnedStatPoints = Object.values(c.stats as Record<string, number>).reduce((total, value) => total + Math.max(0, value - 10), 0);
    // All multiplier values must derive from real equipped definitions: the
    // hydrator intentionally ignores handwritten armorRawDR/item* save fields.
    if (level >= 65 && build !== 'starter') {
        const set = build === 'defense' ? 'ironwall' : build === 'offense' ? 'sennin' : 'crimson';
        c.equipment = { hand: level >= 80 ? 'ashen-dragon-katana' : 'elderbranch-katana', body: `${set}-chest`, head: `${set}-crown`, waist: `${set}-waist`, legs: `${set}-legs`, feet: `${set}-feet` };
        c.inventory = Object.values(c.equipment);
    } else if (level >= 50 && build !== 'starter') {
        c.equipment = { hand: 'frostbite-cleaver', body: 'rare-chest-plate', head: 'iron-kabuto', waist: 'chain-obi', legs: 'rare-greaves', feet: 'rare-tabi' };
        c.inventory = Object.values(c.equipment);
    } else if (level >= 15 && build !== 'starter') {
        c.equipment = { hand: 'rustfang-kunai', body: 'reinforced-vest-s3', legs: 'padded-leggings-s3', feet: 'shinobi-boots-s3' };
        c.inventory = Object.values(c.equipment);
    }
    if (build === 'maxed' && level >= 50) {
        c.equippedBloodlineId = 'benchmark-s-rank';
        (save.savedBloodlines as unknown[]) = [{ id: 'benchmark-s-rank', name: 'Benchmark S Rank', rank: 'S Rank' }];
    }
    return save;
}

function playerActions(s: SoloPveSession, build: Build): SoloPveAction[] {
    const hand = (s.player.character.equipment as Record<string, string>)?.hand;
    const ordinary = policyActions(s, 'damage');
    const firstBasic = ordinary.findIndex(a => a.type === 'basicAttack');
    const attacks = [...ordinary.slice(0, firstBasic), ...(hand ? [{ type: 'weapon' as const, itemId: hand }] : []), ...ordinary.slice(firstBasic)];
    if (build === 'starter' || build === 'offense') return attacks;
    const has = (name: string) => s.player.statuses.some(t => t.name === name && (t.activeRound ?? 0) <= s.round && t.rounds > 0);
    const actions: SoloPveAction[] = [];
    if (s.player.hp < s.player.maxHp * 0.72) actions.push({ type: 'basicHeal' });
    if ((build === 'defense' || build === 'maxed') && !has('Decrease Damage Taken')) actions.push({ type: 'jutsu', jutsuId: 'starter-gen-earth-1' });
    if ((build === 'defense' || build === 'maxed') && s.player.shield < 100 && !has('Absorb')) actions.push({ type: 'jutsu', jutsuId: 'starter-gen-wind-1' });
    // Do not waste 60 AP on trivial buffs; good play can clear strong defense.
    if (s.enemy.shield > 400 || s.enemy.statuses.some(t => ['Decrease Damage Taken', 'Increase Damage Given', 'Reflect'].includes(t.name) && t.rounds > 0)) actions.push({ type: 'clear' });
    return [...actions, ...attacks];
}

type Turn = { ap: number; damaging: boolean; cooldownDry: boolean; ms: number };
export type PressureResult = ReturnType<typeof pressureFight>;

export function summarizePressure(rows: PressureResult[]) {
    const summaries = [];
    const mean = (set: PressureResult[], field: keyof PressureResult) => sum(set.map(r => Number(r[field]) || 0)) / Math.max(1, set.length);
    for (const level of PRESSURE_LEVELS) for (const difficulty of ['weaker', 'standard', 'dangerous', 'elite', ...(level === 100 ? ['final-kage'] : [])]) {
        for (const variant of ['before', 'before-matched-mastery', 'after']) {
            const set = rows.filter(r => r.level === level && r.difficulty === difficulty && r.variant === variant);
            if (!set.length) continue;
            summaries.push({ level, difficulty, variant, fights: set.length, wins: set.filter(r => r.outcome === 'win').length,
                deaths: set.filter(r => r.death).length, roundLimitLosses: set.filter(r => r.roundLimitLoss).length,
                meanRounds: mean(set, 'rounds'), meanFinalHp: mean(set, 'finalHp'), meanMinimumHp: mean(set, 'minimumHp'),
                meanObservedHpDamagePerTurn: mean(set, 'observedHpDamagePerEnemyTurn'),
                meanDirectHpAndShieldPerTurn: sum(set.map(r => (r.enemyDirectHpDamage + r.damageToShield) / Math.max(1, r.turns))) / set.length,
                meanNetHpLossPerTurn: mean(set, 'netHpLossPerEnemyTurn'),
                meanPlayerHealing: mean(set, 'playerHealing'), meanEnemyAp: mean(set, 'enemyApPerTurn'),
                maxTurnMsP95: Math.max(...set.map(r => r.enemyTurnMsP95)),
            });
        }
    }
    return summaries;
}
export function pressureFight(runtime: Runtime, input: { level: number; build: Build; difficulty: Difficulty; seed: number; variant: string; matchedMastery?: boolean; path?: 'explore' | 'natural';
    enemyLevel?: number; save?: ReturnType<typeof pressurePlayerSave>; playerPolicy?: (session: SoloPveSession) => SoloPveAction[]; playerPolicyName?: string; initialVitalFraction?: number; trace?: boolean;
    profileOverride?: Parameters<typeof buildSoloPveAiEncounter>[0]['profile'];
    profileTransform?: (profile: Parameters<typeof buildSoloPveAiEncounter>[0]['profile'], level: number) => Parameters<typeof buildSoloPveAiEncounter>[0]['profile'] }) {
    const { level, build, difficulty, seed, variant } = input;
    const path = input.path ?? 'explore';
    const candidateLevel = input.enemyLevel ?? (difficulty === 'weaker' ? Math.max(1, Math.floor(level * 0.75)) : level);
    const before = variant !== 'after';
    const enemyLevel = before && !input.matchedMastery ? Math.min(100, level + (path === 'natural' ? 1 : 0)) : candidateLevel;
    const naturalProfiles = ['builtin-ai-rogue-ninja', 'builtin-ai-shadow-weaver', 'builtin-ai-mist-sentinel'];
    const profileId = path === 'natural' ? naturalProfiles[seed % 3] : IDS[seed % IDS.length];
    let scaling: { level: number } | undefined;
    let profile;
    if (difficulty === 'final-kage') profile = runtime.story({ village: VILLAGES[seed % VILLAGES.length], progressIndex: 8 });
    else if (!before) profile = ordinaryAiProfile({ version: 1, id: 'ordinary-benchmark', sourceId: 'benchmark', displayName: runtime.catalog[profileId].name, level: enemyLevel,
        difficulty, archetype: profileId === IDS[0] ? 'bruiser' : profileId === IDS[1] ? 'skirmisher' : profileId === IDS[2] ? 'assassin' : profileId === IDS[3] ? 'elementalist' : 'defender',
        profileId, portraitKey: 'benchmark', baseXp: 0, baseRyo: 0 });
    else if (path === 'natural') {
        // Exact old runtimeProfile mapping: nightblade used the burst/Ember
        // template, rival miner the sentinel, bandit the rogue; no kit weights.
        const oldId = seed % 3 === 1 ? IDS[1] : seed % 3 === 2 ? IDS[4] : IDS[0];
        profile = runtime.relevel({ ...structuredClone(runtime.catalog[oldId]), id: `world-wanderer-benchmark-${seed}` } as unknown as Parameters<typeof relevelAiProfile>[0], enemyLevel, 0);
    } else {
        // Exact old generic Explore start contract: pass the authored profile;
        // the production builder's scaling resolves the original weighted kit.
        profile = runtime.catalog[profileId];
        if (profile.level !== enemyLevel) scaling = { level: enemyLevel };
    }
    if (!before && path === 'natural') profile = { ...profile, id: `world-wanderer-benchmark-${seed}` };
    if (input.profileOverride) { profile = input.profileOverride; scaling = undefined; }
    if (input.profileTransform) profile = input.profileTransform(profile, enemyLevel);
    let s = runtime.build({ sessionId: `pressure-${seed}-${level}-${build}-${difficulty}`, playerName: 'pressuretester',
        save: input.save ?? pressurePlayerSave(level, build), profile, now: NOW, admin: null,
        ...(scaling ? { scaling } : {}),
        aiTurnPolicy: STANDARD_PVE_AI_POLICY, difficultyMode: difficulty === 'final-kage' ? 'STORY' : 'AI_FIGHT',
        encounter: { kind: difficulty === 'final-kage' ? 'story-boss' : 'generic-ai', id: profile.id, level: enemyLevel },
        env: { ...process.env, DISABLE_PVE_AI_PLANNER: '' },
    });
    if (input.matchedMastery) s.enemy.character.jutsuMastery = (s.enemy.character.jutsu as SoloPveJutsu[]).map(j => ({ jutsuId: j.id, level: pveAiMasteryForEncounter(enemyLevel, difficulty) }));
    if (input.initialVitalFraction !== undefined) {
        const fraction = Math.max(0, Math.min(1, input.initialVitalFraction));
        s.player.hp = Math.floor(s.player.maxHp * fraction);
        s.player.chakra = Math.floor(s.player.maxChakra * fraction);
        s.player.stamina = Math.floor(s.player.maxStamina * fraction);
    }
    // Seeded openings exercise approach and adjacency, without RNG in decisions.
    if (seed % 2) s.enemy.pos = Array.from({ length: 96 }, (_, t) => t).find(t => hexDistance(t, s.player.pos) === 1)!;
    const initial = { hp: s.player.hp, enemyHp: s.enemy.maxHp, chakra: s.player.chakra, stamina: s.player.stamina, enemyChakra: s.enemy.chakra, enemyStamina: s.enemy.stamina };
    const allEvents: SoloPveCombatEvent[] = [], turns: Turn[] = [];
    let minimumHp = s.player.hp, sequence = 0;
    const began = performance.now();
    for (let step = 0; step < 600 && s.status === 'active'; step++) {
        let next: SoloPveSession | undefined;
        const started = performance.now();
        for (const action of input.playerPolicy ? input.playerPolicy(s) : playerActions(s, build)) {
            const result = runtime.act(s, action);
            if (result.applied) { next = result.session; break; }
        }
        if (!next) throw new Error('benchmark fixture has no legal action');
        const events = next.events.filter(e => e.seq > sequence);
        allEvents.push(...events);
        const enemy = events.filter(e => e.actor === 'enemy');
        if (next.round > s.round || enemy.length > 0) {
            const damaging = enemy.some(e => e.combat.damage.some(d => d.target === 'player' && d.resolved > 0));
            const kit = next.enemy.character.jutsu as SoloPveJutsu[];
            const damagingIds = kit.filter(j => (j.effectPower ?? 0) > 1 && j.ap !== 40).map(j => j.id);
            turns.push({ ap: sum(enemy.map(e => e.combat.actorSpend.ap)), damaging,
                cooldownDry: !damaging && damagingIds.length > 0 && damagingIds.every(id => Number(next!.cooldowns.enemy[id] ?? 0) > 0), ms: performance.now() - started });
        }
        for (const e of events) minimumHp = Math.min(minimumHp, e.after.player.hp);
        sequence = next.eventSeq; s = next;
    }
    const damage = allEvents.filter(e => e.actor === 'enemy' && e.action !== 'clear').flatMap(e => e.combat.damage).filter(d => d.target === 'player');
    const allPlayerDamage = allEvents.flatMap(e => e.combat.damage).filter(d => d.target === 'player');
    const playerHealing = sum(allEvents.flatMap(e => e.combat.healing).filter(h => h.role === 'player').map(h => h.applied));
    const enemyHealing = sum(allEvents.flatMap(e => e.combat.healing).filter(h => h.role === 'enemy').map(h => h.applied));
    const mastery = (s.enemy.character.jutsuMastery as Array<{ level: number }>)[0]?.level ?? 0;
    return { variant, path, level, enemyLevel, build, difficulty, seed, profile: profile.id,
        ...(input.playerPolicyName ? { playerPolicy: input.playerPolicyName } : {}),
        ...(input.initialVitalFraction === undefined ? {} : { initialVitalFraction: input.initialVitalFraction }),
        outcome: s.outcome, death: s.player.hp <= 0, roundLimitLoss: s.outcome === 'loss' && s.player.hp > 0,
        rounds: s.round, minimumHp: Math.min(minimumHp, s.player.hp), finalHp: s.player.hp, maxHp: s.player.maxHp,
        finalEnemyHp: s.enemy.hp, finalPlayerChakra: s.player.chakra, finalPlayerStamina: s.player.stamina,
        enemyMaxHp: initial.enemyHp, enemyMastery: mastery, effectiveEp36: +(46 * masteryDamageFrac(mastery)).toFixed(2),
        playerMastery: (s.player.character.jutsuMastery as Array<{ level: number }>)[0]?.level,
        playerArmorRawDR: s.player.character.armorRawDR, playerBloodlineMult: s.player.character.bloodlineMult,
        // raw is explicitly AFTER DR/amps, BEFORE encounter ceilings; no
        // unsupported claim that the legacy event exposes pre-DR base damage.
        rawAfterMitigation: sum(damage.map(d => d.raw)), resolvedAfterGuard: sum(damage.map(d => d.resolved)),
        damageToHp: sum(allPlayerDamage.map(d => d.toHp)), enemyDirectHpDamage: sum(damage.map(d => d.toHp)),
        damageToShield: sum(damage.map(d => d.toShield)),
        damageToEnemyHp: sum(allEvents.flatMap(e => e.combat.damage).filter(d => d.target === 'enemy').map(d => d.toHp)),
        damageToEnemyShield: sum(allEvents.filter(e => e.action !== 'clear').flatMap(e => e.combat.damage).filter(d => d.target === 'enemy').map(d => d.toShield)),
        ...(damage.some(d => d.baseDamage !== undefined) ? {
            formulaBaseDamage: sum(damage.map(d => d.baseDamage ?? 0)),
            drDeductionBeforeAmplifiers: sum(damage.map(d => (d.baseDamage ?? 0) * (d.effectiveDR ?? 0))),
        } : {}),
        guardPrevented: sum(damage.map(d => Math.max(0, d.raw - d.resolved))),
        playerHealing, enemyHealing, netHpLoss: initial.hp - s.player.hp,
        observedHpDamagePerEnemyTurn: sum(allPlayerDamage.map(d => d.toHp)) / Math.max(1, turns.length),
        netHpLossPerEnemyTurn: (initial.hp - s.player.hp) / Math.max(1, turns.length),
        playerChakraSpent: initial.chakra - s.player.chakra, playerStaminaSpent: initial.stamina - s.player.stamina,
        enemyChakraSpent: initial.enemyChakra - s.enemy.chakra, enemyStaminaSpent: initial.enemyStamina - s.enemy.stamina,
        turns: turns.length, enemyApPerTurn: sum(turns.map(t => t.ap)) / Math.max(1, turns.length),
        wastedAp: sum(turns.map(t => 100 - t.ap)), nondamagingTurns: turns.filter(t => !t.damaging).length,
        cooldownDryTurns: turns.filter(t => t.cooldownDry).length,
        enemyTurnMsP95: turns.map(t => t.ms).sort((a, b) => a - b)[Math.floor(turns.length * 0.95)] ?? 0,
        elapsedMs: performance.now() - began, completed: s.status === 'done',
        enemyActions: allEvents.filter(e => e.actor === 'enemy').reduce((out, e) => { const id = e.actionId ?? e.action; out[id] = (out[id] ?? 0) + 1; return out; }, {} as Record<string, number>),
        playerActions: allEvents.filter(e => e.actor === 'player').reduce((out, e) => { const id = e.actionId ?? e.action; out[id] = (out[id] ?? 0) + 1; return out; }, {} as Record<string, number>),
        ...(input.trace ? { trace: allEvents.map(e => ({ round: e.round, actor: e.actor, action: e.actionId ?? e.action,
            playerHp: e.after.player.hp, enemyHp: e.after.enemy.hp, ap: e.after.ap, damage: e.combat.damage,
            healing: e.combat.healing, playerChakra: e.after.player.chakra, playerStamina: e.after.player.stamina })) } : {}),
    };
}

async function main() {
    const option = (key: string) => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
    if (option('--summarize')) {
        const report = JSON.parse(readFileSync(option('--summarize')!, 'utf8'));
        const summary = summarizePressure(report.rows);
        if (option('--output')) writeFileSync(option('--output')!, JSON.stringify({ ...report, rows: undefined, summary }, null, 2) + '\n');
        console.log(JSON.stringify(summary, null, 2));
        return;
    }
    const baselineRoot = option('--baseline-root');
    const reuseBefore: PressureResult[] = option('--reuse-before') ? JSON.parse(readFileSync(option('--reuse-before')!, 'utf8')).rows : [];
    let baseline: Runtime | undefined;
    if (baselineRoot) {
        const from = (path: string) => import(pathToFileURL(resolve(baselineRoot, path)).href);
        const [builder, engine, catalog, story, curves] = await Promise.all([from('api/solo-pve/_ai-encounter.ts'), from('api/solo-pve/_engine.ts'), from('api/_ai-profile-catalog.ts'), from('api/story/_authoritative-story-combat.ts'), from('api/_ai-level-curves.ts')]);
        baseline = { build: builder.buildSoloPveAiEncounter, act: engine.applySoloPveAction, catalog: catalog.AI_PROFILE_CATALOG, story: story.storyBossEnemyTemplate, relevel: curves.relevelAiProfile };
    }
    const levels = (option('--levels')?.split(',').map(Number) ?? PRESSURE_LEVELS);
    const builds = (option('--builds')?.split(',') ?? PRESSURE_BUILDS) as Build[];
    const seeds = Math.max(1, Math.min(5, Number(option('--seeds')) || 2));
    const path: 'natural' | 'explore' = option('--path') === 'natural' ? 'natural' : 'explore';
    const difficulties = (option('--difficulties')?.split(',') ?? ['weaker', 'standard', 'dangerous', 'elite']) as Difficulty[];
    const rows: PressureResult[] = [];
    for (const level of levels) for (const build of builds) for (const difficulty of [...difficulties, ...(level === 100 && path === 'explore' && !option('--difficulties') ? ['final-kage'] : [])] as Difficulty[]) for (let seed = 0; seed < seeds; seed++) {
        if (difficulty === 'final-kage' && seed >= VILLAGES.length) continue;
        if (baseline) {
            const cached = (variant: string) => reuseBefore.find(r => (r.path ?? 'explore') === path && r.variant === variant && r.level === level && r.build === build && r.difficulty === (difficulty === 'weaker' && variant === 'before' ? 'standard' : difficulty) && r.seed === seed);
            const oldBefore = cached('before');
            const before = oldBefore ? { ...oldBefore, difficulty, path } : pressureFight(baseline, { level, build, difficulty, seed, variant: 'before', path });
            rows.push(before);
            const candidateLevel = difficulty === 'weaker' ? Math.max(1, Math.floor(level * .75)) : level;
            rows.push(cached('before-matched-mastery') ?? (before.enemyLevel === candidateLevel && pveAiMasteryForEncounter(before.enemyLevel, difficulty) === pveAiMasteryForLevel(before.enemyLevel)
                ? { ...before, variant: 'before-matched-mastery' }
                : pressureFight(baseline, { level, build, difficulty, seed, variant: 'before-matched-mastery', matchedMastery: true, path })));
        }
        rows.push(pressureFight(CURRENT, { level, build, difficulty, seed, variant: 'after', path }));
        console.log(JSON.stringify(rows.at(-1)));
        if (option('--output')) writeFileSync(option('--output')!, JSON.stringify({ node: process.version, platform: process.platform, baselineRoot, seeded: true,
            notes: ['Legacy events omit pre-DR formula base; candidate casts expose formulaBaseDamage/effectiveDR.', 'damageToHp includes every observed HP loss, including DOT/recoil; enemyDirectHpDamage only counts enemy actions.', 'Healing is observed applied healing from event HP deltas; simultaneous damage/heal may net within an event.', 'Fixtures are synthetic legal gear/progression builds, not copied live accounts.'], rows }, null, 2) + '\n');
    }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/pve-pressure-benchmark.ts')) void main();
