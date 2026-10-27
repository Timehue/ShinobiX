/** Offline comparison with the accepted October normal-PvE preparation fixtures.
 * No storage, credentials or live writes. The two engines retain their own AI.
 * node --import tsx scripts/tower-pve-comparison.ts --output <json> [--seeds 5]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { closeFightSave, closeFixtureAudit } from './pve-close-fights-benchmark.js';
import { CURRENT, pressureFight } from './pve-pressure-benchmark.js';
import { plannedPlayerActions } from './pve-viability-diagnostic.js';
import { storyGear } from './tower-story-balance-sim.js';
import { buildTowerEncounter, type SquadMemberInput } from '../api/towers/_encounter.js';
import { getFloor } from '../api/towers/_floor-catalog.js';
import { sealTowerFighter } from '../api/towers/_seal.js';
import { applyAction, endTurn, startRound, pickAiAction, MAX_ACTIONS, MAX_ROUNDS, type TowerAction } from '../api/towers/_engine.js';
import { activeActor } from '../api/towers/_tower-session.js';
import { smartSquadAction } from './spire-balance-sim.js';
import { sealPveDifficultyBand } from '../api/_pve-band-seal.js';
import { sealPveAiMastery } from '../api/_pve-ai-mastery.js';
import { applyTowerRouteChoice, type TowerRouteChoiceId } from '../api/towers/_route-choice.js';
import { makeRng } from '../api/towers/_sim.js';
import { auditPressureFixture } from './_pve-pressure-fixture-audit.js';
import { ordinaryPveLevel } from '../shared/ordinary-pve-encounter.js';

export type PveComparisonFixture = 'optimized' | 'sustain' | 'prepared75-rotation' | 'prepared75-sustain';

export function comparisonSave(level: number, fixture: PveComparisonFixture) {
    const prepared75 = fixture.startsWith('prepared75-');
    if (prepared75 && level !== 75) throw new Error('The accepted twelve-slot midgame probe is level75 only');
    const save = closeFightSave(level, prepared75 ? 'optimized' : fixture);
    if (prepared75) {
        // Exact additions from pve-level75-prepared-probe.ts, at identical
        // earned stats, S-rank, catalog gear, natures and capped mastery.
        const extra = fixture === 'prepared75-rotation'
            ? ['starter-gen-earth-aoe', 'starter-gen-wind-aoe', 'starter-buki-wind-2', 'starter-gen-wind-4']
            : ['starter-nin-earth-1', 'starter-nin-earth-3', 'starter-gen-earth-4', 'starter-tai-earth-2'];
        save.character.equippedJutsuIds.push(...extra);
        save.character.jutsuMastery.push(...extra.map(jutsuId => ({ jutsuId, level: 50, xp: 0 })));
        const audit = auditPressureFixture(save, level, { expectedBloodlineRank: 'S Rank', expectedMasteryCeiling: 50 });
        if (!audit.legal || audit.acquisitionWarnings.length || save.character.equippedJutsuIds.length !== 12)
            throw new Error('Prepared level75 fixture failed its independent audit');
    } else if (!closeFixtureAudit(level, fixture).legal) throw new Error('Normal-PvE fixture failed its independent ownership/rank audit');
    return save;
}

export function comparisonSquad(level: number, fixture: PveComparisonFixture, towerGear = false): SquadMemberInput[] {
    return Array.from({ length: 4 }, (_, index) => {
        const save = comparisonSave(level, fixture);
        if (towerGear) {
            const gear = storyGear(level, 'progression', save.character.specialty);
            Object.assign(save.character, { equipment: gear.equipment, inventory: Object.values(gear.equipment) });
            (save as Record<string, unknown>).creatorItems = gear.creatorItems;
        }
        return { id: `sq-${index}`, ownerSlug: `compare-${index}`, name: `Compare ${index}`, ai: false,
            character: sealTowerFighter(save.character, save, {}, null) };
    });
}

export function compareTower(floorId: number, seedIndex: number, fixture: PveComparisonFixture,
    route: TowerRouteChoiceId = 'rest-shrine', towerGear = false) {
    const floor = getFloor(floorId)!;
    const seed = 101 + seedIndex * 7919;
    const squad = comparisonSquad(floor.recommendedLevel!, fixture, towerGear);
    const session = buildTowerEncounter({ floor, squad, partySize: 4, runId: `compare-${floorId}-${seedIndex}`, seed, now: 0 });
    applyTowerRouteChoice(session, route);
    sealPveDifficultyBand(session, { mode: 'TOWER', scaleHp: false, scaleStats: false, env: {} });
    sealPveAiMastery(session, { mode: 'TOWER', env: {} });
    const humans = () => session.actors.filter(a => a.side === 'squad');
    let minimumTeamHp = 1, refusedEnemy = 0, enemyActions = 0, enemyAp = 0, enemyTurns = 0;
    const minimumMemberHp: Record<string, number> = Object.fromEntries(humans().map(a => [a.id, 1]));
    const actionCounts: Record<string, number> = {};
    const sample = () => {
        minimumTeamHp = Math.min(minimumTeamHp, humans().reduce((sum, a) => sum + a.hp / a.maxHp, 0) / 4);
        for (const a of humans()) minimumMemberHp[a.id] = Math.min(minimumMemberHp[a.id]!, a.hp / a.maxHp);
    };
    const rng = makeRng(seed);
    startRound(session);
    const guard = (MAX_ROUNDS + 2) * (session.actors.length + 2) * (MAX_ACTIONS + 2) + 256;
    for (let n = 0; session.status === 'active' && n < guard; n++) {
        const actor = activeActor(session);
        if (!actor || actor.hp <= 0 || actor.side === 'npc') { endTurn(session, floor); sample(); continue; }
        if (actor.side === 'enemy') enemyTurns++;
        for (let actions = 0; session.status === 'active' && actions <= MAX_ACTIONS; actions++) {
            const action: TowerAction = actor.side === 'squad' ? smartSquadAction(session, actor, true) : pickAiAction(session, actor, rng);
            if (action.type === 'wait') break;
            const ap = session.activeAp;
            const result = applyAction(session, floor, action, rng);
            if (actor.side === 'enemy') {
                if (!result.applied) refusedEnemy++;
                else {
                    enemyActions++; enemyAp += Math.max(0, ap - session.activeAp);
                    const key = action.type === 'jutsu' ? action.jutsuId : action.type;
                    actionCounts[key] = (actionCounts[key] ?? 0) + 1;
                }
            }
            sample();
            if (!result.applied) break;
        }
        if (session.status === 'active') endTurn(session, floor);
        sample();
    }
    if (session.status !== 'done') throw new Error('Comparison stalled');
    return { floor: floorId, level: floor.recommendedLevel, seedIndex, fixture, towerGear, route,
        winner: session.winner, rounds: session.round, minimumTeamHp, minimumMemberHp,
        finalTeamHp: humans().reduce((sum, a) => sum + a.hp / a.maxHp, 0) / 4,
        survivors: humans().filter(a => a.hp > 0).length, refusedEnemy, enemyActions, enemyAp, enemyTurns, actionCounts,
        sealedPlayer: { level: squad[0]!.character.level, stats: squad[0]!.character.stats,
            armor: squad[0]!.character.armorRawDR, bloodline: squad[0]!.character.bloodlineMult,
            slots: (squad[0]!.character.jutsu as unknown[]).length } };
}

async function main() {
    const opt = (key: string) => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
    const output = opt('--output');
    if (!output) throw new Error('--output is required');
    const seeds = Math.max(1, Math.floor(Number(opt('--seeds') ?? 5)));
    const paths = ['api/towers/_engine.ts', 'api/_pve-ai-mastery.ts', 'api/_pve-difficulty.ts',
        'api/towers/_story-balance.ts', 'api/solo-pve/_engine.ts', 'api/_pve-challenge-weapon.ts',
        'scripts/pve-close-fights-benchmark.ts', 'scripts/tower-pve-comparison.ts', 'scripts/spire-balance-sim.ts',
        'scripts/pve-level75-prepared-probe.ts', 'scripts/pve-kage-acceptance.ts', 'scripts/pve-viability-diagnostic.ts',
        'scripts/pve-pressure-benchmark.ts', 'scripts/_pve-pressure-fixture-audit.ts', 'scripts/tower-story-balance-sim.ts',
        'api/_ai-level-curves.ts', 'api/_xp-engine.ts', 'api/towers/_seal.ts', 'api/towers/_encounter.ts',
        'api/towers/_floor-catalog.ts', 'api/towers/_enemy-templates.ts', 'api/towers/_route-choice.ts',
        'api/solo-pve/_ai-encounter.ts', 'api/solo-pve/_ai-turn-policy.ts', 'api/pvp/_multipliers.ts',
        'api/pvp/_item-catalog.ts', 'api/pvp/_jutsu-catalog.ts', 'api/pvp/move.ts', 'api/pvp/session.ts', 'api/combat-core/formulas.ts'];
    const hashes = () => Object.fromEntries(paths.map(p => [p, createHash('sha256').update(readFileSync(p)).digest('hex')]));
    const sourceHashes = hashes();
    const tower: ReturnType<typeof compareTower>[] = [], ordinary: ReturnType<typeof pressureFight>[] = [];
    const saveReport = () => writeFileSync(output, JSON.stringify({ complete: false, seeds, sourceHashes, tower, ordinary }, null, 2) + '\n');
    for (const floor of [1, 5, 7, 9, 10, 12, 13, 14, 15]) for (const towerGear of [false, true]) {
        for (const route of ['rest-shrine', 'elite-shortcut'] as const) for (let seed = 0; seed < seeds; seed++) {
            tower.push(compareTower(floor, seed, 'optimized', route, towerGear)); saveReport();
        }
        console.log(JSON.stringify({ floor, towerGear, completed: tower.length }));
    }
    for (const route of ['rest-shrine', 'elite-shortcut'] as const) for (let seed = 0; seed < seeds; seed++) {
        tower.push(compareTower(15, seed, 'sustain', route)); saveReport();
    }
    for (const fixture of ['prepared75-rotation', 'prepared75-sustain'] as const)
        for (const route of ['rest-shrine', 'elite-shortcut'] as const) for (let seed = 0; seed < seeds; seed++) {
            tower.push(compareTower(10, seed, fixture, route)); saveReport();
        }
    if (!process.argv.includes('--tower-only')) for (const level of [30, 50, 70, 85, 100]) for (let seed = 0; seed < seeds; seed++) {
        ordinary.push(pressureFight(CURRENT, { level, enemyLevel: level === 100 ? 94 : level, seed, build: 'maxed',
            variant: 'after', difficulty: 'standard', save: closeFightSave(level, 'optimized'), playerPolicy: plannedPlayerActions,
            playerPolicyName: 'normal-pve-public-state-planner' }));
        saveReport(); console.log(JSON.stringify({ ordinaryLevel: level, seed }));
    }
    if (!process.argv.includes('--tower-only')) for (const fixture of ['prepared75-rotation', 'prepared75-sustain'] as const)
        for (let seed = 0; seed < seeds; seed++) {
            const enemyLevel = ordinaryPveLevel(75, Math.ceil((75 - 6) / 1.4), 'standard', [0, .25, .5, .75, .999999][seed % 5]!);
            ordinary.push(pressureFight(CURRENT, { level: 75, enemyLevel, seed, build: 'maxed', variant: 'after', difficulty: 'standard',
                save: comparisonSave(75, fixture), playerPolicy: plannedPlayerActions, playerPolicyName: fixture }));
            saveReport();
        }
    const unchanged = JSON.stringify(sourceHashes) === JSON.stringify(hashes());
    writeFileSync(output, JSON.stringify({ complete: unchanged, seeds, sourceHashes, tower, ordinary,
        limitations: ['Offline synthetic fixtures and bounded controllers; not production cohorts or optimal strategies.',
            'Solo uses its public-state planner; Tower uses its coordinated focus/hazard/utility controller. Clear rates are not interchangeable.',
            'Optimized fixture below level100 retains the accepted eight-slot PvE control; at100 it has twelve slots and S-rank1.20.',
            'Prepared75 fixtures separately retain both exact twelve-slot kits from the accepted midgame capacity probe.',
            'towerGear keeps that same training/kit and replaces only equipment with the Tower progression gear fixture.'] }, null, 2) + '\n');
    if (!unchanged) throw new Error('Sources changed during comparison');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
