import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_DEFS } from '../api/_legacy-defs.js';
import { LEGACY_JUTSU_DEFS } from '../shinobij.client/src/data/legacy-jutsu.js';
import { v2JutsuResourceCost } from '../api/_combat-resources.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cell = (value: string) => value.replaceAll('|', '\\|').replaceAll('\n', ' ');

export function renderLegacyJutsuReference(): string {
    const signatures = new Map(LEGACY_JUTSU_DEFS.map(row => [row.legacyId, row.jutsu]));
    const lines = ['# All 100 Legacy signature jutsu', '',
        '> Generated from the authored jutsu and Legacy definitions. Regenerate with `npm run generate:legacy-jutsu-reference`; verify with `npm run check:legacy-jutsu-reference`.', '',
        'Every signature unlocks at Stage II (Awakened) in its own slot. Mastery improves with the Legacy: II = 20, III = 30, IV = 40, V = 50. Stage I has no signature. All signatures have cooldown 10 and no elemental restriction. Existing identity, technique IDs and artwork are preserved.', '',
        'Damaging 60-AP signatures have at most two tags, including movement and discipline buffs. Zero-damage 40-AP utilities have at most three.', '',
        'Common (Basic) 40-AP utilities each have exactly two tags. Their percentage effects reach 32% at mastery 50, versus 30% on comparable normal/global jutsu and 35% on Rare signatures. Heal and Shield use their normal flat, mastery-scaled amounts rather than percentages. The Common utility cap carrier permits 32% without changing the Legacy’s rarity.', '',
        'EP below is authored base effect power, before mastery and combat modifiers. Effect descriptions state timing and purpose; actual percentages and outcomes use the current mastery and combat rules. Stronger rarity increases the authored damage/effect budget; each technique has distinct tactical mechanics beyond that numeric ladder.', '',
        'Live resource costs depend on character level and use one bar. Ninjutsu/Genjutsu draw chakra; Taijutsu/Bukijutsu draw stamina. Adaptive techniques and utilities use the owner’s permanent specialty. The table below reports the live base cost before other combat modifiers, not the older stored two-bar values.', '',
        '| AP | Resource at level 50 | Resource at level 99 | Cooldown |', '|---|---|---|---|'];
    for (const ap of [40, 60]) lines.push(`| ${ap} | ${v2JutsuResourceCost(ap, 50)} | ${v2JutsuResourceCost(ap, 99)} | 10 |`);
    lines.push('');
    for (const rarity of ['basic', 'rare', 'legendary', 'mythic'] as const) {
        lines.push(`## ${rarity[0].toUpperCase() + rarity.slice(1)}`, '',
            '| Legacy | Signature jutsu | Discipline | AP | Range | Base EP | Effects |', '|---|---|---|---|---|---|---|');
        for (const def of LEGACY_DEFS.filter(def => def.rarity === rarity)) {
            const j = signatures.get(def.id);
            if (!j) throw new Error(`Missing signature: ${def.id}`);
            lines.push(`| ${cell(def.name)} | ${cell(j.name)} | ${j.type === 'Any' ? 'Adaptive' : j.type} | ${j.ap} | ${j.range} | ${j.effectPower} | ${cell(j.description)} |`);
        }
        lines.push('');
    }
    return lines.join('\n').trimEnd() + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const destination = path.join(root, 'docs', 'legacy-jutsu-reference.md');
    const expected = renderLegacyJutsuReference();
    if (process.argv.includes('--check')) {
        if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8').replace(/\r\n/g, '\n') !== expected)
            throw new Error('Legacy jutsu reference is stale; run npm run generate:legacy-jutsu-reference.');
        console.log('Legacy jutsu reference matches all 100 signatures.');
    } else {
        fs.writeFileSync(destination, expected);
        console.log('Generated docs/legacy-jutsu-reference.md.');
    }
}
