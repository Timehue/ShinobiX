/** Offline matched-seed war NPC probe. No storage/account writes.
 * NODE_PATH=<repo>/node_modules node --import tsx scripts/war-mercenary-pressure-benchmark.ts
 * --baseline-root ../pve-current-main --output docs/pve-close-fights-evidence/war-mercenaries.json
 * Both variants run the identical current Tower executor and sealed defender.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildMercCharacter } from '../api/towers/_merc-fighters.js';
import { sealTowerFighter } from '../api/towers/_seal.js';
import { createTowerSession, activeActor, type TowerActor } from '../api/towers/_tower-session.js';
import { applyAction, pickAiAction, startRound, endTurn, MAX_ACTIONS } from '../api/towers/_engine.js';
import { makeRng } from '../api/towers/_sim.js';
import type { TowerFloor } from '../api/towers/_floor-catalog.js';
import { startingItemShield } from '../api/combat-core/shields.js';
import { closeFightSave, closeFixtureAudit } from './pve-close-fights-benchmark.js';

const FLOOR: TowerFloor = { id: 1, name: 'Mercenary Skirmish', biome: 'central', objective: 'defeat-all',
    roundBudget: 25, map: { width: 12, height: 10 }, fieldRule: { kind: 'none' }, enemies: [], firstClearReward: {} };
function actor(character: Record<string, any>, enemy: boolean): TowerActor {
    return { id: enemy ? 'merc-0' : 'sq-0', name: enemy ? 'Mercenary' : 'Defender', side: enemy ? 'enemy' : 'squad',
        ai: true, ownerSlug: enemy ? null : 'offline-fixture', hp: character.maxHp, maxHp: character.maxHp,
        chakra: character.maxChakra, maxChakra: character.maxChakra, stamina: character.maxStamina, maxStamina: character.maxStamina,
        shield: startingItemShield(character), statuses: [], cooldowns: {}, pos: enemy ? 60 : 10, character };
}
export function probeWarMercenary(merc: Record<string, any>, defender: Record<string, any>, seed: number) {
    const actors = [actor(structuredClone(defender), false), actor(structuredClone(merc), true)];
    const session = createTowerSession({ towerId: 'merc-skirmish', runId: `merc-${seed}`, floor: 1, seed, partySize: 1,
        map: { width: 12, height: 10, biome: 'central', blockedTiles: [], hazardTiles: [], objectiveTiles: [], features: [] },
        actors, objectiveKind: 'defeat-all', now: 1_700_000_000_000 });
    if (merc.warMercenaryProfile) session.pveGuard = { enemyLevel: Number(merc.level), turnStartHp: {}, dealtThisTurn: {} };
    const metrics = actors.map(a => ({ id: a.id, minimumHp: a.hp, observedHpLoss: 0, observedHpRecovery: 0,
        shieldRemovedDuringAttacks: 0, shieldRemovedOutsideAttacks: 0 }));
    const actions: Array<{ round: number; actor: string; type: string; id?: string; applied: boolean }> = [];
    const observe = (fn: () => void, attack: boolean) => {
        const before = actors.map(a => ({ hp: a.hp, shield: a.shield })); fn();
        actors.forEach((a, i) => {
            metrics[i].minimumHp = Math.min(metrics[i].minimumHp, a.hp);
            metrics[i].observedHpLoss += Math.max(0, before[i].hp - a.hp);
            metrics[i].observedHpRecovery += Math.max(0, a.hp - before[i].hp);
            const removed = Math.max(0, before[i].shield - a.shield);
            if (attack) metrics[i].shieldRemovedDuringAttacks += removed;
            else metrics[i].shieldRemovedOutsideAttacks += removed;
        });
    };
    const rng = makeRng(seed);
    observe(() => startRound(session), false);
    let guard = 0;
    while (session.status === 'active' && guard++ < 5000) {
        const current = activeActor(session);
        if (!current || current.hp <= 0) { observe(() => endTurn(session, FLOOR), false); continue; }
        for (let i = 0; session.status === 'active' && i <= MAX_ACTIONS; i++) {
            const action = pickAiAction(session, current, rng);
            if (action.type === 'wait') break;
            let applied = false;
            observe(() => { applied = applyAction(session, FLOOR, action, rng).applied; }, ['jutsu', 'weapon', 'attack'].includes(action.type));
            actions.push({ round: session.round, actor: current.id, type: action.type,
                id: action.type === 'jutsu' ? action.jutsuId : action.type === 'weapon' ? action.itemId : undefined, applied });
            if (!applied) break;
        }
        if (session.status === 'active') observe(() => endTurn(session, FLOOR), false);
    }
    return { winner: actors[1].hp <= 0 ? 'player' : actors[0].hp <= 0 ? 'merc' : 'stall', rounds: session.round,
        metrics: metrics.map((m, i) => ({ ...m, finalHp: actors[i].hp, maxHp: actors[i].maxHp, finalShield: actors[i].shield,
            finalChakra: actors[i].chakra, finalStamina: actors[i].stamina })), actions, log: session.log };
}

function main() {
    const opt = (key: string) => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
    const root = opt('--baseline-root'), output = opt('--output');
    if (!root || !output) throw new Error('--baseline-root and --output are required');
    const baseline = createRequire(resolve('package.json'))(resolve(root, 'api/towers/_merc-fighters.ts')) as { buildMercCharacter: typeof buildMercCharacter };
    const sourcePaths = ['api/towers/_merc-fighters.ts', 'api/towers/_engine.ts', 'shared/war-mercenary-profile.ts', 'scripts/war-mercenary-pressure-benchmark.ts',
        'scripts/pve-close-fights-benchmark.ts', 'scripts/pve-kage-acceptance.ts', 'api/combat-core/formulas.ts', 'api/_combat-resources.ts', 'api/pvp/move.ts',
        'scripts/pve-viability-diagnostic.ts', 'scripts/pve-pressure-benchmark.ts', 'scripts/_pve-pressure-fixture-audit.ts',
        'api/pvp/session.ts', 'api/pvp/_jutsu-catalog.ts', 'api/pvp/_item-catalog.ts', 'api/towers/_tower-session.ts', 'api/towers/_sim.ts',
        'api/_xp-engine.ts', 'api/towers/_seal.ts', 'api/combat-core/shields.ts', 'api/_pve-difficulty.ts', 'api/_pve-ai-tactics.ts'];
    const hashes = () => Object.fromEntries(sourcePaths.map(p => [p, createHash('sha256').update(readFileSync(p)).digest('hex')]));
    const sourceHashes = hashes();
    const cases: Array<{ level: number; fixture: string; mercLevel?: number }> = [75, 80, 85, 95, 100].map(level => ({ level, fixture: 'optimized' }));
    cases.push({ level: 100, fixture: 'sustain' }, { level: 100, fixture: 'stress' }, { level: 100, fixture: 'narrow' });
    cases.push({ level: 100, mercLevel: 75, fixture: 'stress' }, { level: 100, mercLevel: 85, fixture: 'stress' });
    const rows: any[] = [], fixtureAudit: any[] = [];
    for (const { level, fixture, mercLevel = level } of cases) {
        const audit = closeFixtureAudit(level, fixture);
        if (!audit.legal) throw new Error(`Illegal fixture ${level}/${fixture}`);
        fixtureAudit.push({ level, fixture, audit });
        const save = closeFightSave(level, fixture);
        const defender = sealTowerFighter(save.character, save as unknown as Record<string, unknown>, {}, null);
        for (const seed of [0, 1, 2]) for (const variant of ['before', 'after'] as const) {
            const merc = (variant === 'before' ? baseline.buildMercCharacter : buildMercCharacter)(mercLevel);
            const row = { level, mercLevel, fixture, seed, variant, ...probeWarMercenary(merc, defender, seed) };
            rows.push(row); console.log(JSON.stringify({ level, mercLevel, fixture, seed, variant, winner: row.winner, rounds: row.rounds, hp: row.metrics[0].finalHp, min: row.metrics[0].minimumHp }));
        }
    }
    const unchanged = JSON.stringify(sourceHashes) === JSON.stringify(hashes());
    writeFileSync(output, JSON.stringify({ baselineSha: 'a31087565df43d4b34f81f5b5bdb5acf5841b724', sourceHashes, unchanged, complete: unchanged, node: process.version,
        method: 'Same current Tower executor and same legal sealed defender policy; only merc source adapter differs. Old mercs lack the opt-in war profile, so retain old no-weapon AI.',
        metricLimits: 'Observed HP loss/recovery use per-action and turn-boundary differences; same-action damage plus healing can cancel, so these are lower bounds, not gross damage. Shield loss is reported separately, including non-attack removal/expiry. Full logs are retained.',
        fixtureAudit, rows }, null, 2) + '\n');
    if (!unchanged) throw new Error('Source changed during measurement: rerun');
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/war-mercenary-pressure-benchmark.ts')) main();
