/** Offline peer-level cooperative acceptance. No handlers, storage or settlement.
 * NODE_PATH=<repo>/node_modules node --import tsx scripts/pve-boss-peer80-probe.ts
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { diagnosticPlayerSave } from './pve-viability-diagnostic.js';
import { auditPressureFixture } from './_pve-pressure-fixture-audit.js';
import { hydrateCharacterFromSave } from '../api/pvp/session.js';
import { earnedForLevel, STAT_KEYS } from '../api/_xp-engine.js';
import { jutsuLevelCapForLevel, statCapForLevel } from '../api/combat-core/formulas.js';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';
import { effectiveItemLevelReq } from '../shared/item-level-gate.js';
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

const LEVEL = 80;
const seeds = [71041, 71178, 71315];
const option = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const save = diagnosticPlayerSave(LEVEL, 'maxed', 'coherent');
// Exact own-level earned budget, cap-limited Genjutsu specialist allocation.
// S-rank multiplier remains derived from an owned synthetic bloodline definition.
const c = save.character;
const cap = statCapForLevel(LEVEL), mastery = jutsuLevelCapForLevel(LEVEL);
const weights = Object.fromEntries(STAT_KEYS.map(key => [key, key === 'genjutsuOffense' ? 2.2 : key === 'willpower' || key === 'intelligence' ? 1.7 : key.endsWith('Defense') ? 1.25 : 1]));
c.stats = Object.fromEntries(STAT_KEYS.map(key => [key, 10]));
let remaining = earnedForLevel(LEVEL);
while (remaining > 0) {
    const active = STAT_KEYS.filter(key => c.stats[key] < cap);
    if (!active.length) throw new Error('Earned budget exceeds all rank caps');
    const total = active.reduce((n, key) => n + weights[key], 0); let spent = 0;
    for (const key of active) { const amount = Math.min(cap - c.stats[key], Math.max(0, Math.floor(remaining * weights[key] / total))); c.stats[key] += amount; spent += amount; }
    if (!spent) for (const key of active) { if (spent >= remaining) break; c.stats[key]++; spent++; }
    remaining -= spent;
}
c.earnedStatPoints = earnedForLevel(LEVEL);
c.equippedJutsuIds.push('starter-nin-earth-1', 'starter-nin-earth-3', 'starter-gen-earth-4', 'starter-tai-earth-2');
c.jutsuMastery = c.equippedJutsuIds.map(jutsuId => ({ jutsuId, level: mastery, xp: 0 }));
const fixtureAudit = auditPressureFixture(save, LEVEL, { expectedBloodlineRank: 'S Rank', expectedMasteryCeiling: mastery });
if (!fixtureAudit.legal || fixtureAudit.acquisitionWarnings.length || c.equippedJutsuIds.length !== 12 || fixtureAudit.derivedBloodlineMult !== 1.2 || fixtureAudit.allocated !== earnedForLevel(LEVEL)) throw new Error(`Illegal peer fixture: ${JSON.stringify(fixtureAudit)}`);
const hydrated = hydrateCharacterFromSave(c, {}, save, null);
const squad = (): SquadMemberInput[] => Array.from({ length: 3 }, (_, i) => ({ id: `sq-${i}`, name: `Peer80-${i}`, ownerSlug: `peer80-${i}`, ai: false, character: structuredClone(hydrated) }));
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


const BASELINE_SHA = 'a31087565df43d4b34f81f5b5bdb5acf5841b724';
async function main() {
    console.log('Peer80 probe: audited fixture ready, loading immutable engines');
    const baselineRoot = resolve(option('--baseline-root') ?? '../pve-current-main');
    const output = option('--output') ?? 'docs/pve-close-fights-evidence/boss-peer80.json';
    const paths = [...new Set(execFileSync('git', ['ls-files', 'api/towers', 'api/combat-core', 'api/pvp', 'shared'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(p => p.endsWith('.ts') && !p.endsWith('.test.ts')).concat([
        'scripts/pve-boss-peer80-probe.ts', 'scripts/pve-boss-source-probe.ts', 'scripts/pve-viability-diagnostic.ts', 'scripts/pve-pressure-benchmark.ts', 'scripts/mission-encounter-sim.ts', 'scripts/_pve-pressure-fixture-audit.ts',
        'api/world-boss-event/_encounter.ts', 'api/world-boss-event/_contribution.ts', 'api/clan-boss/_encounter-config.ts', 'api/clan-boss/_storage.ts', 'api/_boss-challenge-kit.ts', 'api/_ai-level-curves.ts', 'api/_ai-opponent-loadout.ts', 'api/_pve-difficulty.ts', 'api/_pve-band-seal.ts', 'api/_combat-resources.ts', 'api/_xp-engine.ts', 'api/_entitlements.ts', 'api/_equipment-ownership.ts',
    ]))].sort();
    const hashes = (root: string) => Object.fromEntries(paths.map(path => [path, existsSync(resolve(root, path)) ? createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') : null]));
    const sourceHashes = hashes('.'), baselineSourceHashes = hashes(baselineRoot);
    const baselineRequire = createRequire(resolve(baselineRoot, 'package.json'));
    const baselineWorld = baselineRequire('./api/world-boss-event/_encounter.ts');
    const baselineClan = baselineRequire('./api/clan-boss/_encounter-config.ts');
    const baselineEngine = baselineRequire('./api/towers/_engine.ts');
    // Check every imported archived runtime source against the immutable main tree.
    const tree = new Map<string, string>(execFileSync('git', ['ls-tree', '-r', BASELINE_SHA], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim().split(/\r?\n/).map((line): [string, string] => { const [meta, path] = line.split('\t'); return [path, meta.split(' ')[2]]; }));
    for (const path of paths.filter(p => p.startsWith('api/') || p.startsWith('shared/'))) {
        if (!tree.has(path)) continue;
        // Windows checkout conversion changes text bytes, not runtime source.
        // Keep raw SHA256 above; normalize CRLF only for the Git blob proof.
        const bytes = Buffer.from(readFileSync(resolve(baselineRoot, path), 'utf8').replaceAll('\r\n', '\n'));
        const blobHash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        if (blobHash !== tree.get(path)) throw new Error(`Archived main source mismatch: ${path}`);
    }
    const previousEvidence = ['boss-source-audit.json', 'endgame.json', 'near94.json', 'progression.json', 'rookie.json', 'special.json', 'war-mercenaries.json', 'level75-prepared.json'].filter(name => existsSync(`docs/pve-close-fights-evidence/${name}`));
    const previousEvidenceHashes = Object.fromEntries(previousEvidence.map(name => [name, createHash('sha256').update(readFileSync(`docs/pve-close-fights-evidence/${name}`)).digest('hex')]));
    const rows: unknown[] = [];
    const report = { baselineSha: BASELINE_SHA, headAtStart: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), generatedAt: new Date().toISOString(), node: process.version,
        sourceHashes, baselineSourceHashes, previousEvidenceHashes, seeds, fixture: { description: 'Synthetic peer-level80 capped Genjutsu specialist: exact earned budget, owned S-rank1.20 bloodline, Earth/Wind,12catalog slots,rank-capped mastery50,level-gated catalog Crimson set/Ashen Dragon Katana. No named/custom/legacy gear,companions or consumables.', save, audit: fixtureAudit, hydrated,
            gear: Object.entries(c.equipment).map(([slot, id]) => ({ slot, id, levelReq: effectiveItemLevelReq(ITEM_CATALOG[id]), definition: ITEM_CATALOG[id] })), kit: c.equippedJutsuIds.map(id => ({ ...JUTSU_CATALOG[id], mastery })) }, rows,
        limits: ['Tower HP damage/recovery are per-action/per-boundary observed lower bounds; simultaneous damage/healing can net within an action. Shield loss is separate.', 'Prepared world trio uses maximum60Hollow Shards, shared600000HP pool snapshot547545,20round contribution deadline; no one-raid kill requirement.', 'Clan trio uses existing24000HP persistent-pool slice and source round windows. Survival, partial contribution and slice clear are separate.', 'Identical bounded public-state competent policy and fixtures on actual archived/current builders and engines; not optimal play,role-specialist support or live testing.', 'All seven bosses retain sourcelevel80. Rotation controls cover one seed per boss; no unprepared peer80 or party-size sensitivity measured.'] };
    const checkpoint = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    for (const boss of WORLD_BOSS_DEFINITIONS) for (const seed of seeds) for (const variant of ['before-adapter', 'after-adapter'] as const) {
        const build = variant === 'before-adapter' ? baselineWorld.buildWorldBossTeamEncounter : buildWorldBossTeamEncounter;
        const s = build({ event: { eventId: 'offline-peer80', bossId: boss.id, bossName: boss.name, hp: 547545, hpMax: 600000, hollowShardsDeposited: 60 }, matchId: `peer80-${seed}`, runId: `peer80-world-${boss.id}-${seed}`, squad: squad(), seed, now: 1_800_000_000_000 });
        const result = runTeam(s, s.encounterFloor!, true, variant === 'before-adapter' ? baselineEngine : currentTeamEngine);
        rows.push({ source: 'world', bossId: boss.id, bossName: boss.name, bossLevel: 80, playerLevel: LEVEL, partySize: 3, shards: 60, seed, policy: 'cautious', variant, netBossHpRemoved: Math.max(0, 547545 - result.bossRemainingHp), ...result }); checkpoint(); console.log(`World ${boss.name} ${seed} ${variant}: ${result.survivors}/3 survivors, ${result.rounds} rounds`);
    }
    for (let index = 0; index < CLAN_BOSS_FLOORS.length; index++) for (const seed of seeds) for (const variant of ['before-adapter', 'after-adapter'] as const) {
        const floor = CLAN_BOSS_FLOORS[index], s = buildTowerEncounter({ floor, squad: squad(), runId: `peer80-clan-${index}-${seed}`, seed, partySize: 3, now: 1_800_000_000_000 });
        (variant === 'before-adapter' ? baselineClan.configureClanBossEncounter : configureClanBossEncounter)(s, floor, CB_ASSAULT_HP_CAP);
        const result = runTeam(s, floor, true, variant === 'before-adapter' ? baselineEngine : currentTeamEngine);
        rows.push({ source: 'clan', bossId: CLAN_BOSSES[index].id, bossName: CLAN_BOSSES[index].name, bossLevel: 80, playerLevel: LEVEL, partySize: 3, seed, policy: 'cautious', variant, netBossHpRemoved: Math.max(0, CB_ASSAULT_HP_CAP - result.bossRemainingHp), ...result }); checkpoint(); console.log(`Clan ${CLAN_BOSSES[index].name} ${seed} ${variant}: ${result.survivors}/3 survivors, ${result.rounds} rounds, ${result.winner}`);
    }
    // One current-runtime rotation control per boss demonstrates the cost of
    // ignoring marks/status counters while retaining the same offense/setup kit.
    for (const boss of WORLD_BOSS_DEFINITIONS) {
        const seed = seeds[0], s = buildWorldBossTeamEncounter({ event: { eventId: 'offline-peer80', bossId: boss.id, bossName: boss.name, hp: 547545, hpMax: 600000, hollowShardsDeposited: 60 }, matchId: `peer80-control-${seed}`, runId: `peer80-world-control-${boss.id}`, squad: squad(), seed, now: 1_800_000_000_000 });
        const result = runTeam(s, s.encounterFloor!, false, currentTeamEngine);
        rows.push({ source: 'world', bossId: boss.id, bossName: boss.name, bossLevel: 80, playerLevel: LEVEL, partySize: 3, shards: 60, seed, policy: 'rotation-control', variant: 'after-adapter', netBossHpRemoved: Math.max(0, 547545 - result.bossRemainingHp), ...result }); checkpoint();
    }
    for (let index = 0; index < CLAN_BOSS_FLOORS.length; index++) {
        const seed = seeds[0], floor = CLAN_BOSS_FLOORS[index], s = buildTowerEncounter({ floor, squad: squad(), runId: `peer80-clan-control-${index}`, seed, partySize: 3, now: 1_800_000_000_000 });
        configureClanBossEncounter(s, floor, CB_ASSAULT_HP_CAP); const result = runTeam(s, floor, false, currentTeamEngine);
        rows.push({ source: 'clan', bossId: CLAN_BOSSES[index].id, bossName: CLAN_BOSSES[index].name, bossLevel: 80, playerLevel: LEVEL, partySize: 3, seed, policy: 'rotation-control', variant: 'after-adapter', netBossHpRemoved: Math.max(0, CB_ASSAULT_HP_CAP - result.bossRemainingHp), ...result }); checkpoint();
    }
    const afterHashes = hashes('.'), changedSources = paths.filter(path => sourceHashes[path] !== afterHashes[path]);
    const changedPreviousEvidence = previousEvidence.filter(name => previousEvidenceHashes[name] !== createHash('sha256').update(readFileSync(`docs/pve-close-fights-evidence/${name}`)).digest('hex'));
    Object.assign(report, { sourceHashesAtFinish: afterHashes, changedSources, changedPreviousEvidence, complete: rows.length === 49 && changedSources.length === 0 && changedPreviousEvidence.length === 0 }); checkpoint();
    if (!(report as typeof report & { complete: boolean }).complete) throw new Error('Probe incomplete or frozen sources/evidence changed');
    console.log(`Complete: ${rows.length} peer80 cases; ${output}`);
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/pve-boss-peer80-probe.ts')) void main().catch(error => { console.error(error); process.exitCode = 1; });
