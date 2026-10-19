/** Offline, deterministic HP/TTK comparison. Never reads storage or live saves. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHollowGateCombatBinding } from '../api/hollow-gate/_combat-session.js';
import { buildHollowGateSoloPveEncounter } from '../api/hollow-gate/_encounter.js';
import type { HollowGateRunToken } from '../api/hollow-gate/_run-token.js';
import { applySoloPveAction } from '../api/solo-pve/_engine.js';
import type { SoloPveAction, SoloPveSession } from '../api/solo-pve/_session.js';
import { answeringPlayerActions, diagnosticPlayerSave, plannedPlayerActions } from './pve-viability-diagnostic.js';
import { auditPressureFixture } from './_pve-pressure-fixture-audit.js';
import { closeFixtureAudit } from './pve-close-fights-benchmark.js';

type Policy = 'practical' | 'cautious' | 'planner';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function actions(s: SoloPveSession, policy: Policy): SoloPveAction[] {
    if (policy === 'planner') return plannedPlayerActions(s);
    const active = (name: string) => s.player.statuses.some(t => t.name === name && t.rounds > 0
        && (t.activeRound ?? 0) <= s.round && (t.inactiveRound ?? Infinity) > s.round);
    const support: SoloPveAction[] = policy === 'cautious' ? [
        ...(s.player.hp < s.player.maxHp * .65 ? [{ type: 'basicHeal' as const }] : []),
        ...(s.player.character.jutsu as Array<{ id: string; effectPower?: number; tags?: Array<{ name: string }> }>)
            .filter(j => !Number(j.effectPower) && j.tags?.some(t => ['Reflect', 'Absorb', 'Lifesteal', 'Decrease Damage Taken'].includes(t.name) && !active(t.name)))
            .map(j => ({ type: 'jutsu' as const, jutsuId: j.id })),
    ] : [];
    return [...support, ...answeringPlayerActions(s)];
}
function fight(source: SoloPveSession, policy: Policy, missRound10 = false) {
    let s = structuredClone(source), minHp = s.player.hp, steps = 0, missed = false;
    let heals = 0, supports = 0, damageActions = 0, spentAp = 0, enemyHeals = 0;
    while (s.status === 'active' && steps++ < 350) {
        const candidates: SoloPveAction[] = missRound10 && !missed && s.round === 10
            ? [{ type: 'wait' }] : actions(s, policy);
        if (missRound10 && !missed && s.round === 10) missed = true;
        const seq = s.eventSeq;
        let accepted: { action: SoloPveAction; result: ReturnType<typeof applySoloPveAction> } | undefined;
        for (const action of candidates) {
            const result = applySoloPveAction(s, action);
            if (result.applied) { accepted = { action, result }; break; }
        }
        assert.ok(accepted, 'the policy must have an accepted legal action');
        s = accepted.result.session;
        for (const event of s.events.filter(e => e.seq > seq)) {
            assert.ok(event.after.ap.player >= 0 && event.after.ap.enemy >= 0, 'nonnegative AP');
            for (const side of ['player', 'enemy'] as const) assert.ok(event.after[side].chakra >= 0 && event.after[side].stamina >= 0, 'nonnegative resources');
            minHp = Math.min(minHp, event.after.player.hp);
            if (event.actor === 'enemy' && event.action === 'basicHeal') enemyHeals++;
            if (event.actor !== 'player') continue;
            spentAp += Math.max(0, event.before.ap.player - event.after.ap.player);
            if (event.action === 'basicHeal') heals++;
            if (event.after.enemy.hp < event.before.enemy.hp) damageActions++;
            else if (event.action !== 'wait' && event.action !== 'move') supports++;
        }
        minHp = Math.min(minHp, s.player.hp);
    }
    assert.equal(s.status, 'done', 'every comparison must terminate');
    return { outcome: s.outcome, rounds: Math.min(s.round, 25), terminalRound: s.round, endHp: s.player.hp,
        minHp, enemyEndHp: s.enemy.hp, enemyHeals, heals, supports, damageActions, spentAp, missedRound10: missed };
}
function main() {
    const option = (key: string) => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
    const output = option('--output');
    assert.ok(output, '--output is required');
    const quick = process.argv.includes('--quick');
    const riftControl = process.argv.includes('--rift-control');
    const audits: Record<string, unknown> = {}, rows: Array<Record<string, any>> = [];
    const sourcePaths = ['api/hollow-gate/_encounter.ts', 'api/solo-pve/_engine.ts', 'api/solo-pve/_session.ts', 'api/_ai-level-curves.ts'];
    const sourceHashes = () => Object.fromEntries(sourcePaths.map(p => [p, hash(readFileSync(p, 'utf8').replaceAll('\r\n', '\n'))]));
    const before = sourceHashes();
    for (const level of riftControl ? [100] : quick ? [17, 100] : [5, 17, 35, 60, 100]) {
        const builds = ['starter', 'offense'].map(build => {
            const save = diagnosticPlayerSave(level, build as 'starter' | 'offense', 'coherent', build === 'starter' ? 'B' : 'A');
            return { id: `earned-${build}`, save, audit: auditPressureFixture(save, level) };
        });
        if (level === 100) for (const build of ['optimized', 'sustain']) {
            const audit = closeFixtureAudit(level, build);
            builds.push({ id: `strong-${build}`, save: audit.save, audit });
        }
        for (const build of builds) {
            if (riftControl && build.id !== 'strong-sustain') continue;
            assert.equal(build.audit.legal, true, JSON.stringify(build.audit));
            assert.equal(build.audit.acquisitionWarnings.length, 0);
            audits[`${level}:${build.id}`] = build.audit;
            for (const floor of quick || riftControl ? [2] : [1, 2, 5]) for (const kind of ['battle', 'ambush', 'beast', 'elite', 'boss'] as const) {
                if (kind === 'boss' && floor !== (quick || riftControl ? 2 : 5)) continue;
                const policies: Policy[] = level === 100 && build.id.startsWith('strong-') ? ['practical', 'cautious', 'planner'] : ['practical', 'cautious'];
                for (const policy of policies) for (const hpFraction of level === 100 && build.id === 'strong-sustain' && kind === 'elite' && floor === 2 ? [1, .564] : [1])
                    for (const timeout of level === 100 && build.id === 'strong-sustain' && kind === 'elite' && floor === 2 ? [false, true] : [false]) {
                        const save = structuredClone(build.save);
                        save.character.hp = Math.floor(save.character.maxHp * hpFraction);
                        const run: HollowGateRunToken = { playerName: String(save.character.name), mintedAt: 1, floorDepth: kind === 'boss' ? floor : 5,
                            currentFloor: floor, seed: 'shrine-hp-control', entryCurrencies: {}, offeredAugmentIds: [], chosenAugmentId: null, dailyRunOrdinal: 1 };
                        if (riftControl) { run.variantId = 'rift-hollow-stalker'; run.chosenAugmentId = 'keen-edge'; }
                        const nodeId = `floor:${floor}:tile:20`;
                        const binding = createHollowGateCombatBinding({ playerName: run.playerName, token: 'offline', floor, nodeId, kind, runId: 'shrine-hp-control', now: 1000 });
                        const session = buildHollowGateSoloPveEncounter({ binding, run, save, now: 1000, admin: null });
                        const { hp: _hp, maxHp: _maxHp, character, ...enemy } = session.enemy;
                        const { hp: _characterHp, maxHp: _characterMaxHp, ...enemyCharacter } = character;
                        rows.push({ id: `${level}:${build.id}:${floor}:${kind}:${policy}:${hpFraction}:${timeout}${riftControl ? ':rift-control' : ''}`, level, build: build.id, floor, kind, policy, hpFraction, timeout,
                            enemyHp: session.enemy.maxHp, playerHp: session.player.hp, playerMaxHp: session.player.maxHp,
                            nonHpHash: hash({ enemy, character: enemyCharacter, shrineAi: session.shrineAi }), result: fight(session, policy, timeout) });
                    }
            }
        }
    }
    assert.deepEqual(sourceHashes(), before, 'runtime sources must not change during measurement');
    let comparison;
    if (option('--compare')) {
        const baseline = JSON.parse(readFileSync(option('--compare')!, 'utf8'));
        const old = new Map(baseline.rows.map((r: Record<string, any>) => [r.id, r]));
        assert.equal(old.size, rows.length);
        comparison = rows.map(row => {
            const prior = old.get(row.id) as Record<string, any>;
            assert.ok(prior, row.id);
            assert.equal(prior.nonHpHash, row.nonHpHash, `non-HP change: ${row.id}`);
            if (row.kind === 'boss') assert.deepEqual(row, prior, `boss changed: ${row.id}`);
            return { id: row.id, hpBefore: prior.enemyHp, hpAfter: row.enemyHp, before: prior.result, after: row.result };
        });
    }
    writeFileSync(output, JSON.stringify({ sourceHashes: before, audits, rows, comparison, limits: [
        'Offline catalog/current-forge controls, not exact Rill saves or population win rates.',
        'Earned fixtures obey progression budgets; strong L100 controls include explicitly audited additional earned training.',
        'Practical and cautious rotations use visible-state counters; planner is a bounded legal own-turn proxy.',
        'Rill-like sustain uses current-forge27EP and catalog mastery; unknown custom jutsu and legacy33EP are not reconstructed.',
        'Optional Rift/Keen Edge control matches observed elite HP; it does not assert the live augment or reconstruct that player.',
        'The round10 missed-turn control is explicit, not a claimed counterfactual replay of the live fight.',
        'Boss controls exclude external dungeon attrition and map hazards; this patch does not tune bosses.',
    ] }, null, 2) + '\n');
    console.log(`Wrote ${rows.length} audited cases to ${output}`);
}
main();
