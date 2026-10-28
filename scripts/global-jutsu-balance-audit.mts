/** Element-isolation diagnostic using the existing live-PvP simulation policy.
 * It compares mono-element global kits; even full-slot runs are not a human meta.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { makeBuild, simulateFight, type BuildTemplate, type Archetype } from './pvp-level-balance-sim.js';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';
import { jutsuLevelCapForLevel } from '../api/combat-core/formulas.js';
import { v2JutsuCosts } from '../api/_combat-resources.js';

const elements = ['Earth', 'Wind', 'Lightning', 'Fire', 'Water'];
const profiles: Array<{ prefix: string; archetype: Archetype }> = [
    { prefix: 'nin', archetype: 'Burst' }, { prefix: 'gen', archetype: 'Sustain' },
    { prefix: 'tai', archetype: 'Tempo' }, { prefix: 'buki', archetype: 'Counter' },
    { prefix: 'nin', archetype: 'Ground' }, { prefix: 'gen', archetype: 'Control' },
    { prefix: 'tai', archetype: 'Prevention' }, { prefix: 'buki', archetype: 'Disruption' },
];
const originalIgnition = process.argv.includes('--original-ignition');
const mirrorsOnly = process.argv.includes('--mirrors-only');
const slots = Number(process.argv.find(arg => arg.startsWith('--slots='))?.split('=')[1] ?? 6);
const utilityRotation = Number(process.argv.find(arg => arg.startsWith('--utility-rotation='))?.split('=')[1] ?? 0);
if (![6, 12, 15].includes(slots)) throw new Error('--slots must be 6, 12 or 15');
if (![0, 1, 2].includes(utilityRotation)) throw new Error('--utility-rotation must be 0, 1 or 2');
function build(level: number, profile: typeof profiles[number], element: string): BuildTemplate {
    const result = makeBuild(level, profile.archetype, 'B Rank', { namedGear: false, loadoutSize: slots === 15 ? 15 : 12 });
    const otherStyles = ['nin', 'gen', 'tai', 'buki'].filter(style => style !== profile.prefix);
    const omittedStyle = slots === 12 ? otherStyles[utilityRotation] : undefined;
    const jutsu = Object.values(JUTSU_CATALOG).filter(j =>
        j.id.startsWith(`starter-${profile.prefix}-${element.toLowerCase()}-`)
        || j.id === 'starter-universal-flicker'
        || (slots > 6 && j.id.startsWith('starter-') && j.element === element && j.type === 'Any'
            && j.effectPower === 0 && (!omittedStyle || !j.id.startsWith(`starter-${omittedStyle}-`)))
    ).map(j => {
        const copy = structuredClone(j);
        if (originalIgnition && copy.id === 'starter-gen-fire-aoe') copy.tags[0].percent = 14;
        // Match live session sealing. Catalog costs are authoring placeholders;
        // the runtime charges the level-scaled cost to exactly one resource bar.
        return { ...copy, ...v2JutsuCosts(copy, level, result.discipline) };
    });
    if (jutsu.length !== slots || new Set(jutsu.map(j => j.id)).size !== slots) throw new Error(`Invalid ${slots}-slot ${profile.prefix}/${element} loadout`);
    result.id = result.name = `${level}-${profile.prefix}-${element}`;
    result.jutsu = jutsu;
    result.fighter.name = result.name;
    Object.assign(result.fighter.character, { element, elements: [element], equippedBloodlineId: undefined, bloodlineMult: 1, jutsu,
        jutsuMastery: jutsu.map(j => ({ jutsuId: j.id, level: jutsuLevelCapForLevel(level) })), weaponElements: {} });
    // Both sides use the same gear/stat profile within a discipline. Remove the
    // weapon's elemental affinity so it cannot reward one of the five kits.
    result.weapon = { ...result.weapon, weaponElement: 'None' };
    result.fighter.character.pvpItems = (result.fighter.character.pvpItems as Record<string, unknown>[]).map(item => item.weaponElement ? { ...item, weaponElement: 'None' } : item);
    return result;
}
const rows: unknown[] = [];
let totalFights = 0;
for (const level of [10, 50, 100]) for (const profile of profiles) {
    const builds = elements.map(element => build(level, profile, element));
    const scores = elements.map(element => ({ element, games: 0, score: 0, timeouts: 0, rounds: 0 }));
    const pairs: unknown[] = [];
    for (let a = 0; a < builds.length; a++) for (let b = a; b < builds.length; b++) {
        if (mirrorsOnly && a !== b) continue;
        let scoreA = 0, timeouts = 0, rounds = 0, p1Score = 0, openerScore = 0;
        const actions: Record<string, number> = {};
        for (const swapped of [false, true]) for (const opener of ['p1', 'p2'] as const) {
            const outcome = simulateFight(builds[swapped ? b : a], builds[swapped ? a : b], opener);
            totalFights++;
            const score = outcome.winner === 'draw' ? .5 : outcome.winner === (swapped ? 'p2' : 'p1') ? 1 : 0;
            p1Score += outcome.winner === 'draw' ? .5 : Number(outcome.winner === 'p1');
            openerScore += outcome.winner === 'draw' ? .5 : Number(outcome.winner === opener);
            scoreA += score; timeouts += Number(outcome.timeout); rounds += outcome.rounds;
            for (const [action, count] of Object.entries(outcome.actionCounts)) actions[action] = (actions[action] ?? 0) + count;
            if (a !== b) for (const [index, points] of [[a, score], [b, 1 - score]]) {
                scores[index].games++; scores[index].score += points; scores[index].timeouts += Number(outcome.timeout); scores[index].rounds += outcome.rounds;
            }
        }
        pairs.push({ a: elements[a], b: elements[b], games: 4, scoreA, p1Score, openerScore, timeouts, averageRounds: rounds / 4, actions });
    }
    rows.push({ level, discipline: builds[0].discipline, profile: profile.archetype,
        loadouts: builds.map(b => ({ name: b.name, ids: b.jutsu.map(j => j.id) })), scores, pairs });
    console.log(`Completed level ${level} ${builds[0].discipline} ${profile.archetype}`);
}
const report = { basis: `${totalFights} deterministic fights, two gear/stat profiles per discipline. Same profile within each matchup, ${slots} slots: five primary-discipline techniques plus Flicker${slots > 6 ? ', supplemented by same-element Any-discipline utilities' : ''}, maximum level-legal mastery, live v2 single-bar resource costs; swapped seats and openers. A 12-slot kit omits the three utilities of one other discipline, selected by utilityRotation; a 15-slot kit includes all twelve same-element utility techniques and has Supporter entitlement. No legacy or bloodline techniques; bloodline multiplier reset to 1. Uses live PvP resolution with a heuristic pilot; cannot establish optimal-play balance or cross-discipline power. For mirrors use actual p1Score/openerScore: identity scoreA is symmetric by construction and cannot detect initiative bias. Timeout verdicts are diagnostic, not a tuning mandate.`, originalIgnition, mirrorsOnly, slots, utilityRotation, totalFights, rows };
const output = resolve(process.argv[2] ?? '.tmp/balance-audit-20261028/global-jutsu.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Wrote ${output}`);
