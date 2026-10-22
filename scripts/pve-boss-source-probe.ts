/** Offline source-specific boss probe. No KV, handler, settlement or live-save calls.
 * node --import tsx scripts/pve-boss-source-probe.ts [--seeds 3] [--output path]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { diagnosticPlayerSave, answeringPlayerActions } from './pve-viability-diagnostic.js';
import { auditPressureFixture } from './_pve-pressure-fixture-audit.js';
import { closeFightSave, closeFixtureAudit } from './pve-close-fights-benchmark.js';
import { hydrateCharacterFromSave } from '../api/pvp/session.js';
import { weeklyBossEnemyTemplate } from '../api/_authoritative-pve.js';
import { weeklyBossChallengeProfile } from '../api/_weekly-boss-profile.js';
import { builtinAiProfile } from '../api/_ai-profile-catalog.js';
import { buildSoloPveAiEncounter } from '../api/solo-pve/_ai-encounter.js';
import { applySoloPveAction } from '../api/solo-pve/_engine.js';
import { WEEKLY_BOSS_AI_POLICY } from '../api/solo-pve/_ai-turn-policy.js';
import { buildWorldBossTeamEncounter } from '../api/world-boss-event/_encounter.js';
import { snapshotWorldBossContribution, recordWorldBossContribution, scoreWorldBossContribution } from '../api/world-boss-event/_contribution.js';
import { WORLD_BOSS_DEFINITIONS } from '../shared/world-boss-event.js';
import { buildTowerEncounter, type SquadMemberInput } from '../api/towers/_encounter.js';
import { configureClanBossEncounter } from '../api/clan-boss/_encounter-config.js';
import { CB_ASSAULT_HP_CAP, CLAN_BOSSES } from '../api/clan-boss/_storage.js';
import { CLAN_BOSS_FLOORS, type TowerFloor } from '../api/towers/_floor-catalog.js';
import { applyAction, startRound, endTurn, pickAiAction, towerNeighbors, nextStepToward, type TowerAction } from '../api/towers/_engine.js';
import { activeActor, type TowerActor, type TowerSession } from '../api/towers/_tower-session.js';
import { hexDistance } from '../api/combat-core/grid.js';
import { makeRng } from '../api/towers/_sim.js';

const option = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const seeds = Array.from({ length: Math.max(1, Math.min(12, Number(option('--seeds')) || 3)) }, (_, i) => 71041 + i * 137);
const output = option('--output') ?? 'docs/pve-close-fights-evidence/boss-source-audit.json';
const previousReport = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : undefined;
const baseline = previousReport?.baseline ?? previousReport;
const fixtureName = option('--fixture') ?? 'catalog';
const complementaryCatalog = previousReport?.complementaryCatalog ?? (fixtureName === 'stress' && previousReport?.fixture?.name !== 'stress' ? previousReport : undefined);
const sources = new Set((option('--sources') ?? 'weekly,world,clan').split(','));
const save = fixtureName === 'stress' ? closeFightSave(100, 'stress') : diagnosticPlayerSave(100, 'maxed', 'coherent');
if (fixtureName !== 'stress') {
    const ids = [...save.character.equippedJutsuIds, 'starter-nin-earth-1', 'starter-nin-earth-3', 'starter-gen-earth-4', 'starter-tai-earth-2'];
    save.character.equippedJutsuIds = ids;
    save.character.jutsuMastery = ids.map(jutsuId => ({ jutsuId, level: 50, xp: 0 }));
}
const fixtureAudit = fixtureName === 'stress' ? closeFixtureAudit(100, 'stress') : auditPressureFixture(save, 100, { expectedBloodlineRank: 'S Rank', expectedMasteryCeiling: 50 });
if (!fixtureAudit.legal || fixtureAudit.acquisitionWarnings.length) throw new Error(`Illegal fixture: ${JSON.stringify(fixtureAudit)}`);
const hydrated = hydrateCharacterFromSave(save.character, {}, save, null);
const squad = (size: number): SquadMemberInput[] => Array.from({ length: size }, (_, i) => ({ id: `sq-${i}`, name: `Offline${i}`, ownerSlug: `offline${i}`, ai: false, character: structuredClone(hydrated) }));
const positive = (actor: TowerActor, name: string, round: number) => actor.statuses.some(s => s.name === name && s.rounds > 0 && (s.activeRound ?? 0) <= round && (s.inactiveRound ?? Infinity) > round);
type TeamEngine = Pick<typeof import('../api/towers/_engine.js'), 'applyAction' | 'startRound' | 'endTurn' | 'pickAiAction' | 'nextStepToward' | 'towerNeighbors'>;
const currentTeamEngine: TeamEngine = { applyAction, startRound, endTurn, pickAiAction, nextStepToward, towerNeighbors };

/** Public-state bounded policy: dodge marked tiles, clear guards, maintain a
 * damage setup, use sustain when injured, focus adds, then legal best immediate
 * damage. Resolver previews decide legality and current outcomes only. */
function squadAction(session: TowerSession, floor: TowerFloor, actor: TowerActor, cautious: boolean, engine: TeamEngine): TowerAction {
    const enemies = session.actors.filter(a => a.side === 'enemy' && a.hp > 0).sort((a, b) => a.hp - b.hp || a.id.localeCompare(b.id));
    const target = enemies[0];
    if (!target) return { actorId: actor.id, type: 'wait' };
    const danger = new Set([...(session.map.hazardTiles ?? []), ...(session.map.nextRoundHazardTiles ?? []), ...(session.bossStrike?.tiles ?? [])]);
    const legal = (action: TowerAction) => engine.applyAction(structuredClone({ ...session, log: [], vfx: [] }), floor, action, () => .5).applied;
    const vacant = (tile: number) => !session.map.blockedTiles.includes(tile) && !session.actors.some(a => a.hp > 0 && a.id !== actor.id && a.pos === tile);
    if (cautious && danger.has(actor.pos)) {
        const queue = [{ tile: actor.pos, first: actor.pos, depth: 0 }], visited = new Set([actor.pos]);
        const budget = Math.floor(session.activeAp / 30);
        for (let i = 0; i < queue.length; i++) {
            const at = queue[i]; if (at.depth >= budget) continue;
            for (const tile of engine.towerNeighbors(at.tile, session.map.width, session.map.height).filter(vacant).sort((a, b) => hexDistance(a, target.pos, session.map.width) - hexDistance(b, target.pos, session.map.width))) {
                if (visited.has(tile)) continue; visited.add(tile);
                const first = at.depth === 0 ? tile : at.first;
                if (!danger.has(tile)) { const action: TowerAction = { actorId: actor.id, type: 'move', tile: first }; if (legal(action)) return action; }
                queue.push({ tile, first, depth: at.depth + 1 });
            }
        }
    }
    const priorities: TowerAction[] = [];
    if (cautious && actor.statuses.some(s => s.kind === 'negative' && ['Poison', 'Wound', 'Drain', 'Increase Damage Taken', 'Decrease Damage Given'].includes(s.name))) priorities.push({ actorId: actor.id, type: 'cleanse' });
    if (cautious && actor.hp < actor.maxHp * .35) priorities.push({ actorId: actor.id, type: 'heal' });
    if (cautious && (target.shield > 400 || positive(target, 'Reflect', session.round) || positive(target, 'Decrease Damage Taken', session.round))) priorities.push({ actorId: actor.id, type: 'clear', targetId: target.id });
    if (!positive(actor, 'Increase Damage Given', session.round)) priorities.push({ actorId: actor.id, type: 'jutsu', jutsuId: 'starter-gen-earth-1', targetId: target.id });
    if (cautious && actor.hp < actor.maxHp * .8 && !positive(actor, 'Lifesteal', session.round)) priorities.push({ actorId: actor.id, type: 'jutsu', jutsuId: 'starter-nin-earth-3', targetId: target.id });
    if (cautious && actor.shield < 200 && !positive(target, 'Increase Damage Taken', session.round)) priorities.push({ actorId: actor.id, type: 'jutsu', jutsuId: 'starter-nin-earth-1', targetId: target.id });
    for (const action of priorities) if (legal(action)) return action;
    const candidates: TowerAction[] = [
        ...(actor.character.jutsu as Array<{ id: string; effectPower?: number }>).filter(j => Number(j.effectPower) > 1 && !j.id.includes('flicker')).map(j => ({ actorId: actor.id, type: 'jutsu' as const, jutsuId: j.id, targetId: target.id })),
        { actorId: actor.id, type: 'weapon', targetId: target.id }, { actorId: actor.id, type: 'attack', targetId: target.id },
    ];
    let best: { score: number; action: TowerAction } | undefined;
    for (const action of candidates) {
        const preview = structuredClone({ ...session, log: [], vfx: [] });
        if (!engine.applyAction(preview, floor, action, () => .5).applied) continue;
        const score = enemies.reduce((total, enemy) => { const after = preview.actors.find(a => a.id === enemy.id)!; return total + enemy.hp - after.hp + Math.max(0, enemy.shield - after.shield); }, 0)
            + Math.max(0, preview.actors.find(a => a.id === actor.id)!.hp - actor.hp) * 1.2;
        if (!best || score > best.score) best = { score, action };
    }
    if (best && best.score > 0) return best.action;
    const move = engine.nextStepToward(session, actor.pos, target.pos, actor.id);
    if (move !== actor.pos && (!cautious || !danger.has(move))) { const action: TowerAction = { actorId: actor.id, type: 'move', tile: move }; if (legal(action)) return action; }
    return { actorId: actor.id, type: 'wait' };
}

function runTeam(session: TowerSession, floor: TowerFloor, cautious = true, engine: TeamEngine = currentTeamEngine) {
    const rng = makeRng(session.seed);
    const totals = Object.fromEntries(session.actors.filter(a => a.side === 'squad').map(a => [a.id, { maxHp: a.maxHp, initialHp: a.hp, minimumHp: a.hp, hpLossObservedLowerBound: 0, hpRecoveryObservedLowerBound: 0, shieldLossDuringEnemyActions: 0, shieldGainObserved: 0, shieldExpiredOrLostAtTurnBoundary: 0 }]));
    const track = (fn: () => unknown, enemyAction = false, boundary = false) => {
        const before = session.actors.filter(a => a.side === 'squad').map(a => ({ id: a.id, hp: a.hp, shield: a.shield }));
        fn();
        for (const old of before) { const a = session.actors.find(a => a.id === old.id)!; const t = totals[a.id];
            t.minimumHp = Math.min(t.minimumHp, a.hp);
            t.hpLossObservedLowerBound += Math.max(0, old.hp - a.hp); t.hpRecoveryObservedLowerBound += Math.max(0, a.hp - old.hp);
            t.shieldGainObserved += Math.max(0, a.shield - old.shield);
            if (enemyAction) t.shieldLossDuringEnemyActions += Math.max(0, old.shield - a.shield);
            if (boundary) t.shieldExpiredOrLostAtTurnBoundary += Math.max(0, old.shield - a.shield);
        }
    };
    track(() => engine.startRound(session));
    let actions = 0, guard = 0;
    while (session.status === 'active' && guard++ < 4000) {
        const actor = activeActor(session);
        if (!actor || actor.hp <= 0) { track(() => engine.endTurn(session, floor), false, true); continue; }
        const action = actor.side === 'squad' ? squadAction(session, floor, actor, cautious, engine) : engine.pickAiAction(session, actor, rng);
        if (action.type === 'wait') { track(() => engine.endTurn(session, floor), false, true); continue; }
        let applied = false;
        const beforeContribution = snapshotWorldBossContribution(session);
        track(() => { applied = engine.applyAction(session, floor, action, rng).applied; }, actor.side === 'enemy');
        if (applied && actor.side === 'squad') recordWorldBossContribution(session, actor.id, beforeContribution);
        if (applied) actions++; else track(() => engine.endTurn(session, floor), false, true);
    }
    if (session.status !== 'done') throw new Error(`Probe failed to terminalize ${session.runId}`);
    const boss = session.actors.find(a => a.id === session.phaseState.bossId)!;
    return { rounds: session.round, winner: session.winner, survivors: session.actors.filter(a => a.side === 'squad' && a.hp > 0).length, actions,
        bossRemainingHp: boss.hp, bossMaxHp: boss.maxHp, bossShield: boss.shield,
        players: session.actors.filter(a => a.side === 'squad').map(a => ({ id: a.id, ...totals[a.id], finalHp: a.hp, netHpLoss: totals[a.id].initialHp - a.hp, finalShield: a.shield, finalChakra: a.chakra, finalStamina: a.stamina })),
        ...(session.worldBossEvent ? { contribution: Object.fromEntries(Object.entries(session.worldBossContributions ?? {}).map(([slug, contribution]) => [slug, scoreWorldBossContribution(contribution)])), bankableTeamDamage: Object.values(session.worldBossContributions ?? {}).reduce((n, contribution) => n + contribution.damage, 0) } : {}),
        terminalLog: session.log.slice(-5) };
}

function weekly(id: string, active: boolean, variant: 'legacy-runner' | 'sealed-planner' | 'challenge-kit', baselineRuntime?: { build: typeof buildSoloPveAiEncounter; act: typeof applySoloPveAction }) {
    const profile = builtinAiProfile(id);
    if (!profile) throw new Error(`Missing weekly profile ${id}`);
    const build = variant === 'legacy-runner' && baselineRuntime ? baselineRuntime.build : buildSoloPveAiEncounter;
    const act = variant === 'legacy-runner' && baselineRuntime ? baselineRuntime.act : applySoloPveAction;
    let s = build({ sessionId: `offline-weekly-${id}-${active}`, playerName: 'offline', save, now: 1_800_000_000_000,
        profile: variant === 'challenge-kit' ? weeklyBossChallengeProfile(profile, { id, name: profile.name }) : { id, ...weeklyBossEnemyTemplate(profile, { id, name: profile.name }) }, admin: null, difficultyMode: false,
        encounter: { kind: 'weekly-boss', id: 'offline-week', sourceId: id }, environment: { biome: 'central' }, weeklyBossRoundBudget: 20,
        ...(variant !== 'legacy-runner' ? { aiTurnPolicy: WEEKLY_BOSS_AI_POLICY } : {}) });
    s.enemy.hp = s.enemy.maxHp = 126000;
    const events = []; let seq = 0, minimumHp = s.player.hp;
    for (let step = 0; step < 600 && s.status === 'active'; step++) {
        let next;
        for (const action of active ? answeringPlayerActions(s) : [{ type: 'wait' as const }]) { const r = act(s, action); if (r.applied) { next = r.session; break; } }
        if (!next) throw new Error(`No weekly action ${id}`);
        for (const event of next.events.filter(e => e.seq > seq)) { minimumHp = Math.min(minimumHp, event.after.player.hp); events.push(event); }
        seq = next.eventSeq; s = next;
    }
    if (s.status !== 'done') throw new Error(`Weekly probe failed to terminalize ${id}`);
    const damage = events.flatMap(e => e.combat.damage).filter(d => d.target === 'player');
    return { source: 'weekly', variant, bossId: id, policy: active ? 'answer' : 'wait-control', rounds: s.round, unlimitedHealth: s.enemy.unlimitedHealth,
        scoreDamage: s.enemy.damageReceived, survived: s.player.hp > 0, minimumHp, finalHp: s.player.hp, maxHp: s.player.maxHp,
        actualHpDamage: damage.reduce((n, d) => n + d.toHp, 0), shieldDamage: damage.reduce((n, d) => n + d.toShield, 0),
        healingApplied: events.flatMap(e => e.combat.healing).filter(h => h.role === 'player').reduce((n, h) => n + h.applied, 0), netHpLoss: s.player.maxHp - s.player.hp,
        hpLossObservedLowerBound: events.reduce((n, e) => n + Math.max(0, e.before.player.hp - e.after.player.hp), 0),
        finalChakra: s.player.chakra, finalStamina: s.player.stamina, outcome: s.outcome };
}

const sourcePaths = ['scripts/pve-boss-source-probe.ts', 'scripts/pve-viability-diagnostic.ts', 'scripts/pve-pressure-benchmark.ts', 'api/_authoritative-pve.ts', 'api/_pve-difficulty.ts', 'api/_boss-challenge-kit.ts', 'api/_weekly-boss-profile.ts', 'api/solo-pve/_ai-turn-policy.ts', 'api/solo-pve/_engine.ts', 'api/solo-pve/_ai-encounter.ts', 'api/pvp/move.ts', 'api/pvp/_item-catalog.ts', 'api/towers/_engine.ts', 'api/towers/_encounter.ts', 'api/towers/_floor-catalog.ts', 'api/towers/_enemy-templates.ts', 'api/world-boss-event/_encounter.ts', 'api/clan-boss/_encounter-config.ts'];
const hashes = () => Object.fromEntries(sourcePaths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
async function main() {
const stage = (message: string) => { console.log(message); if (option('--trace-startup')) appendFileSync(option('--trace-startup')!, message + '\n'); };
stage(`Boss probe starting: fixture=${fixtureName}, seeds=${seeds.join(',')}`);
const beforeHashes = hashes();
const baselineRoot = resolve(option('--baseline-root') ?? '../pve-current-main');
// Synchronous tsx require avoids parallel CJS/ESM bridge waits when both the
// archived Tower and Solo graphs import the same archived combat-core modules.
const baselineRequire = createRequire(resolve(baselineRoot, 'package.json'));
stage('Loading immutable world builder');
const baselineWorld = baselineRequire('./api/world-boss-event/_encounter.ts');
stage('Loading immutable clan adapter');
const baselineClan = baselineRequire('./api/clan-boss/_encounter-config.ts');
stage('Loading immutable Tower engine');
const baselineEngine = baselineRequire('./api/towers/_engine.ts');
stage('Loading immutable Solo engine');
const baselineSolo = baselineRequire('./api/solo-pve/_engine.ts');
stage('Loading immutable Solo builder');
const baselineBuilder = baselineRequire('./api/solo-pve/_ai-encounter.ts');
stage('Immutable baseline engines loaded.');
const comparableEnginePaths = ['api/towers/_encounter.ts', 'api/towers/_floor-catalog.ts', 'api/towers/_enemy-templates.ts', 'api/pvp/move.ts', 'api/pvp/_item-catalog.ts'];
const baselineSourceHashes = Object.fromEntries([...comparableEnginePaths, 'api/towers/_engine.ts', 'api/world-boss-event/_encounter.ts', 'api/clan-boss/_encounter-config.ts', 'api/solo-pve/_engine.ts', 'api/solo-pve/_ai-encounter.ts'].map(path => [path, createHash('sha256').update(readFileSync(resolve(baselineRoot, path))).digest('hex')]));
if (comparableEnginePaths.some(path => beforeHashes[path] !== baselineSourceHashes[path])) throw new Error('Shared Tower/resolver sources differ; matched baseline requires its own engine imports.');
const rows: unknown[] = [];
stage('Capturing report metadata');
const report = { baseline, baselineSha256: baseline ? createHash('sha256').update(JSON.stringify(baseline)).digest('hex') : undefined, complementaryCatalog,
    baselineRoot, baselineSourceHashes, headAtStart: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), generatedAt: new Date().toISOString(), seeds, fixture: { name: fixtureName, description: fixtureName === 'stress'
        ? 'Synthetic L100 strong sustain stress: subscriber15slots, Earth/Wind mastery50, observed-legacy33EP blade with real225Heal/Shield roll and five synthetic2%lifesteal armor rolls. Not exactRill; all extra techniques are catalog50mastery, unknownbloodline/customjutsu omitted.'
        : 'Synthetic L100 all-stat-cap, S-rank multiplier1.20, catalog Crimson set/Ashen Dragon Katana, 12-slot Earth/Wind mastery50. Not exact Rill replay; no custom/bloodline-exclusive techniques, consumables or companions.', save, audit: fixtureAudit, hydrated }, sourceHashes: beforeHashes, rows,
    metricLimits: ['Weekly uses authoritative event damage/healing facts. Tower exposes no equivalent per-hit numeric event journal: health loss/recovery are separately accumulated net deltas per resolver action/turn-boundary, lower bounds where damage and healing net within one action. Tower shield loss on enemy actions is separate from expiry/turn-boundary loss. Do not call either shield value actual HP damage.', 'Player policy is bounded competent public-state play, not optimal. Identical all-purpose builds in teams do not model specialized support coordination. No claim of live playtesting.', 'World shared HP600000/entryHP547545 is a fixed snapshot; bosses are not expected to die in one raid. Clan assault slice24000 is a persistent-pool contribution snapshot. No reward or participation rules changed.'] };
mkdirSync(dirname(output), { recursive: true });
const checkpoint = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
if (sources.has('weekly')) for (const id of ['ashen-dragon', 'moonshadow-oni', 'frostfang-warlord', 'stormveil-beast', 'deathsgate-revenant']) for (const active of [true, false]) for (const variant of ['legacy-runner', 'sealed-planner', 'challenge-kit'] as const) { const row = weekly(id, active, variant, { build: baselineBuilder.buildSoloPveAiEncounter, act: baselineSolo.applySoloPveAction }); rows.push(row); checkpoint(); console.log(JSON.stringify(row)); }
if (sources.has('world')) for (const boss of WORLD_BOSS_DEFINITIONS) for (const size of [1, 3]) for (const shardCount of [0, 60]) for (const seed of seeds) for (const cautious of [true, false]) for (const variant of ['before-adapter', 'after-adapter'] as const) {
    console.log(`Starting world ${boss.id} size${size} shards${shardCount} seed${seed}`);
    const build = variant === 'before-adapter' ? baselineWorld.buildWorldBossTeamEncounter : buildWorldBossTeamEncounter;
    const s = build({ event: { eventId: 'offline', bossId: boss.id, bossName: boss.name, hp: 547545, hpMax: 600000, hollowShardsDeposited: shardCount }, matchId: `offline-${seed}`, runId: `offline-world-${boss.id}-${size}-${shardCount}-${seed}`, squad: squad(size), seed, now: 1_800_000_000_000 });
    const result = runTeam(s, s.encounterFloor!, cautious, variant === 'before-adapter' ? baselineEngine : currentTeamEngine);
    const row = { source: 'world', variant, bossId: boss.id, partySize: size, shards: shardCount, seed, policy: cautious ? 'cautious' : 'rotation', sharedHpAtStart: 547545, netBossHpRemoved: Math.max(0, 547545 - result.bossRemainingHp), ...result };
    rows.push(row); checkpoint(); console.log(JSON.stringify(row));
}
if (sources.has('clan')) for (let index = 0; index < CLAN_BOSS_FLOORS.length; index++) for (const size of [1, 3]) for (const seed of seeds) for (const cautious of [true, false]) for (const variant of ['before-adapter', 'after-adapter'] as const) {
    const floor = CLAN_BOSS_FLOORS[index];
    const s = buildTowerEncounter({ floor, squad: squad(size), runId: `offline-clan-${index}-${size}-${seed}`, seed, partySize: size, now: 1_800_000_000_000 });
    (variant === 'before-adapter' ? baselineClan.configureClanBossEncounter : configureClanBossEncounter)(s, floor, CB_ASSAULT_HP_CAP);
    const result = runTeam(s, floor, cautious, variant === 'before-adapter' ? baselineEngine : currentTeamEngine);
    const row = { source: 'clan', variant, bossId: CLAN_BOSSES[index].id, partySize: size, seed, policy: cautious ? 'cautious' : 'rotation', assaultHpAtStart: CB_ASSAULT_HP_CAP, netBossHpRemoved: Math.max(0, CB_ASSAULT_HP_CAP - result.bossRemainingHp), ...result };
    rows.push(row); checkpoint(); console.log(JSON.stringify(row));
}
const afterHashes = hashes();
Object.assign(report, { sourceHashesAtFinish: afterHashes, sourceChangedDuringProbe: sourcePaths.filter(path => beforeHashes[path] !== afterHashes[path]), complete: true });
checkpoint();
console.log(`Complete: ${rows.length} actual-constructor cases; ${output}`);
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/pve-boss-source-probe.ts')) void main().catch(error => { console.error(error); process.exitCode = 1; });
