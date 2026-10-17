/** Read-only cloned-state timing controls; never changes stored combat.
 * Run separately from other QA for low-load timing. --concurrent labels load.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildSoloPveAiEncounter } from '../api/solo-pve/_ai-encounter.js';
import { storyBossEnemyTemplate } from '../api/story/_authoritative-story-combat.js';
import { diagnosticPlayerSave } from './pve-viability-diagnostic.js';
import { enemyTurnPolicy, enemyTurnPolicyForEncounter, STANDARD_PVE_AI_POLICY } from '../api/solo-pve/_ai-turn-policy.js';
import { planStandardPveEnemyActionForTest, runStandardPveEnemyTurnForTest } from '../api/solo-pve/_engine.js';
import { hexDistance } from '../api/combat-core/grid.js';
import type { SoloPveJutsu } from '../api/solo-pve/_session.js';

async function main() {
    const opt = (key: string) => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
    const sampleRounds = Math.max(8, Number(opt('--samples')) || 8);
    const warmup = 3;
    const rows = [];
    const villages = ['Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village'];
    for (const village of villages) for (const state of ['range-four', 'post-signature', 'endangered', 'dry-cooldowns']) {
        const profile = storyBossEnemyTemplate({ village, progressIndex: 8 });
        const base = buildSoloPveAiEncounter({ sessionId: 'budget', playerName: 'budget',
            save: diagnosticPlayerSave(100, 'maxed', 'coherent'), profile, now: 1_800_000_000_000,
            admin: null, difficultyMode: 'STORY', aiTurnPolicy: STANDARD_PVE_AI_POLICY,
            encounter: { kind: 'story-boss', id: profile.id, level: 100 }, env: { DISABLE_PVE_AI_PLANNER: '' } });
        base.activeSide = 'enemy';
        base.actionsThisTurn = 0;
        base.ap.enemy = state === 'post-signature' ? 40 : 100;
        base.enemy.pos = Array.from({ length: 96 }, (_, tile) => tile)
            .find(tile => hexDistance(tile, base.player.pos) === (state === 'endangered' ? 1 : 4))!;
        const damage = (base.enemy.character.jutsu as SoloPveJutsu[]).filter(jutsu => Number(jutsu.effectPower) > 1).map(jutsu => jutsu.id);
        if (state === 'post-signature') base.cooldowns.enemy[damage[0]] = 7;
        if (state === 'endangered') {
            base.enemy.hp = Math.floor(base.enemy.maxHp * .1);
            base.player.shield = 800;
        }
        if (state === 'dry-cooldowns') {
            for (const id of damage) base.cooldowns.enemy[id] = 2;
            base.player.statuses.push({ name: 'Increase Damage Given', kind: 'positive', percent: 30, rounds: 3, activeRound: base.round });
        }
        for (const variant of ['current', 'apex']) {
            const policy = variant === 'apex'
                ? enemyTurnPolicyForEncounter({ level: 100, masterAi: true, kind: 'story-boss', difficulty: 'final-kage' })
                : enemyTurnPolicy(100, true);
            const pick = planStandardPveEnemyActionForTest(structuredClone(base), policy);
            const samples = [];
            let after = base;
            for (let i = 0; i < warmup + sampleRounds; i++) {
                const clone = structuredClone(base);
                const start = performance.now();
                runStandardPveEnemyTurnForTest(clone, policy);
                const elapsed = performance.now() - start;
                if (i >= warmup) samples.push(elapsed);
                after = clone;
            }
            samples.sort((a, b) => a - b);
            rows.push({ village, state, variant, simulations: pick.simulations, firstAction: pick.action,
                p50Ms: samples[Math.floor(samples.length * .5)], p95Ms: samples[Math.floor(samples.length * .95)],
                playerHp: after.player.hp, enemyHp: after.enemy.hp, remainingAp: after.ap.enemy,
                enemyActions: after.events.filter(event => event.actor === 'enemy').map(event => event.actionId ?? event.action) });
        }
    }
    const sourceHashes = Object.fromEntries(['api/solo-pve/_engine.ts', 'api/solo-pve/_ai-turn-policy.ts', 'shared/story-kage.ts',
        'scripts/pve-kage-policy-benchmark.ts'].map(path => [path,
        createHash('sha256').update(readFileSync(path)).digest('hex')]));
    writeFileSync(opt('--output') ?? 'docs/pve-pressure-evidence/kage-policy-budget.json',
        JSON.stringify({ diagnosticOnly: true, sourceHashes, sampleRounds, warmup, concurrentLoad: process.argv.includes('--concurrent'), rows }, null, 2) + '\n');
    for (const variant of ['current', 'apex']) {
        const set = rows.filter(row => row.variant === variant);
        console.log(JSON.stringify({ variant, maxStateP95Ms: Math.max(...set.map(row => row.p95Ms)),
            medianStateP50Ms: set.map(row => row.p50Ms).sort((a, b) => a - b)[Math.floor(set.length / 2)],
            maxDecisionSimulations: Math.max(...set.map(row => row.simulations)) }));
    }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/pve-kage-policy-benchmark.ts')) void main();

