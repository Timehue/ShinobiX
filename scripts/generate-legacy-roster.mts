import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_DEFS, type LegacyDef, type LegacyReq } from '../api/_legacy-defs.js';
import { legacyTrialActivities, trialObjectivesFor } from '../api/_legacy-core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cell = (value: string) => value.replaceAll('|', '\\|').replaceAll('\n', ' ');
const requirement = (req: LegacyReq): string => 'stat' in req
    ? `${req.stat} ≥ ${req.atLeast.toLocaleString('en-US')}`
    : `any of (${req.anyOf.map((part) => `${part.stat} ≥ ${part.atLeast.toLocaleString('en-US')}`).join(' / ')})`;

export function renderLegacyRoster(definitions: readonly LegacyDef[] = LEGACY_DEFS): string {
    const lines = ['# Legacy roster', '',
        '> Generated from `api/_legacy-defs.ts` and `api/_legacy-core.ts`. Regenerate with `npm run generate:legacy-roster`; validate with `npm run check:legacy-roster`. Server overlay thresholds and disabled paths can override this code baseline.', '',
        'Tracking continues through level 100. Sage offers begin at level 50; a path may require late-game deeds. Accepting one path is permanent. Declining lets later appearances rotate through eligible choices. Qualification is checked again before the initial acceptance seal.', '',
        'Style deeds follow the character’s permanent specialty. Support counts applied HP restoration, successful shield grants and damage absorbed by shields. `comebackWins` is the historical counter name for clutch wins ending at 15% HP or less. `higherLevelWins` counts wins against opponents at least five levels higher; at level 96+, a sealed player-ranked opponent rated at least 100 higher also qualifies as an upset.', '',
        'PvP credit uses the sealed match, excludes practice/pet/NPC/quick-surrender matches, and applies opponent decay to both fighters and war proof. Each opponent renews at midnight UTC: full, full, half, quarter, then zero credit. Account-age, shared-IP/device, level-gap and suspicion checks still apply.', '',
        'Trials use fresh progress after their sealed baselines. A reroll replaces an unfinished trial with the other variant and fresh baselines; completed stages remain. Paths without PvP qualification requirements have PvE trial routes. An older active trial keeps its issued objectives until completion or reroll.', '',
    ];
    for (const rarity of ['mythic', 'legendary', 'rare', 'basic'] as const) {
        const defs = definitions.filter((def) => def.rarity === rarity);
        lines.push(`## ${rarity} (${defs.length})`, '', '| Path | Title | Category | Village | Qualification: all requirements | Flavor |', '|---|---|---|---|---|---|');
        for (const def of defs) lines.push(`| ${cell(def.name)} (${def.id}) | ${cell(def.title)} | ${def.category} | ${cell(def.villageAffinity ?? '—')} | ${def.reqs.map(requirement).join('; ')} | ${cell(def.flavor)} |`);
        lines.push('');
    }
    lines.push('## Trial routes', '', 'Each stage cell lists variant 0 / variant 1. The signature technique unlocks at Bound (stage 3).', '',
        '| Path | Activities preview | Awaken (2) | Bind (3) | Prove (4) | Summit (5) |', '|---|---|---|---|---|---|');
    for (const def of definitions) {
        const stages = (['awaken', 'bind', 'prove', 'mythic'] as const).map((kind) => [0, 1].map((variant) =>
            trialObjectivesFor(def, kind, variant).map((o) => `${o.stat} +${o.delta.toLocaleString('en-US')}`).join('; ')).join(' / '));
        lines.push(`| ${def.id} | ${legacyTrialActivities(def).join(', ')} | ${stages.join(' | ')} |`);
    }
    return lines.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const output = path.join(root, 'docs', 'legacy-roster.md');
    const expected = renderLegacyRoster();
    if (process.argv.includes('--check')) {
        if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8').replace(/\r\n/g, '\n') !== expected) throw new Error('Legacy roster is stale; run npm run generate:legacy-roster.');
        console.log('Legacy roster matches all 100 definitions and trial routes.');
    } else {
        fs.writeFileSync(output, expected);
        console.log('Generated docs/legacy-roster.md.');
    }
}
