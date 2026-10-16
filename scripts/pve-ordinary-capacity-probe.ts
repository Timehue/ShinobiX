/** Six bounded ordinary-viability controls with acquired full player capacity.
 * No bloodline multiplier, no injected combat stats and no storage access.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { CURRENT, pressureFight } from './pve-pressure-benchmark.js';
import { diagnosticPlayerSave, diagnosticFixtureAudit, plannedPlayerActions } from './pve-viability-diagnostic.js';
import { kageAcceptanceSave } from './pve-kage-acceptance.js';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';

async function main() {
    const fullIds = kageAcceptanceSave('maxed').character.equippedJutsuIds;
    const save = diagnosticPlayerSave(100, 'midgame', 'coherent', 'none');
    save.character.equippedJutsuIds = [...fullIds];
    save.character.jutsuMastery = fullIds.map(jutsuId => ({ jutsuId, level: 30, xp: 0 }));
    const fixtureAudit = { ...diagnosticFixtureAudit(100, 'midgame', 'coherent', 'none'),
        effectiveBloodlineRank: 'none', equippedSlots: fullIds.length,
        fullKit: fullIds.map(id => ({ id, element: JUTSU_CATALOG[id]?.element,
            owned: ['Earth', 'Wind', 'None'].includes(JUTSU_CATALOG[id]?.element ?? '') })) };
    if (!fixtureAudit.legal || fixtureAudit.equippedSlots !== 12 || fixtureAudit.fullKit.some(jutsu => !jutsu.owned)) throw new Error('Illegal full-capacity fixture');
    const sourceHashes = Object.fromEntries(['api/solo-pve/_engine.ts', 'api/solo-pve/_ai-turn-policy.ts', 'api/solo-pve/_ai-encounter.ts',
        'api/missions/_ordinary-ai-encounter.ts', 'api/_ai-opponent-loadout.ts', 'scripts/pve-viability-diagnostic.ts',
        'scripts/pve-kage-acceptance.ts', 'scripts/pve-ordinary-capacity-probe.ts'].map(path =>
        [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
    const rows = [];
    for (const enemyLevel of [90, 95, 98]) for (const seed of [0, 4]) {
        const row = pressureFight(CURRENT, { level: 100, build: 'midgame', difficulty: 'standard', seed, variant: 'after', enemyLevel,
            save: structuredClone(save), playerPolicy: plannedPlayerActions, playerPolicyName: 'planner' });
        if (row.playerBloodlineMult !== 1) throw new Error('No-bloodline control received a multiplier');
        rows.push(row);
        console.log(JSON.stringify({ enemyLevel, seed, outcome: row.outcome, hp: row.finalHp, minimumHp: row.minimumHp,
            enemyHp: row.finalEnemyHp, rounds: row.rounds, bloodlineMult: row.playerBloodlineMult }));
        writeFileSync('docs/pve-pressure-evidence/ordinary-capacity-probe.json', JSON.stringify({
            label: 'trained-mastery30-earned29000-no-bloodline-two-nature-twelve-slot', sourceHashes,
            timingLoad: 'concurrent', fixtureAudit, startingVitals: 'full', playerPolicy: 'public bounded own-turn planner',
            limitation: 'Two representative archetypes across the actual standard roll range, not every build or matchup.', rows }, null, 2) + '\n');
    }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/pve-ordinary-capacity-probe.ts')) void main();
