import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LOADOUT_CAP_BASE } from '../_entitlements.js';
import { LEGACY_JUTSU_CATALOG } from './_legacy-jutsu-catalog.js';
import { normalizeHumanPvpLoadout } from './session.js';

const techniques = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `regular-${index}` }));

describe('human PvP loadout normalization', () => {
    it('seals supporter and base accounts to the same 12 regular techniques', () => {
        const regular = techniques(15);
        const normalized = normalizeHumanPvpLoadout({ name: 'Supporter', patreon: { active: true }, jutsu: regular });
        assert.deepEqual(normalized.jutsu, regular.slice(0, LOADOUT_CAP_BASE));
    });

    it('does not mutate a loadout already at or below the neutral PvP cap', () => {
        const character = { name: 'Base', jutsu: techniques(12) };
        assert.equal(normalizeHumanPvpLoadout(character), character);
    });

    it('preserves the separately earned Legacy signature after the 12 regular slots', () => {
        const signature = Object.values(LEGACY_JUTSU_CATALOG)[0]!;
        const regular = techniques(15);
        const normalized = normalizeHumanPvpLoadout({ jutsu: [...regular, signature] });
        assert.deepEqual(normalized.jutsu, [...regular.slice(0, LOADOUT_CAP_BASE), signature]);
    });

    it('is wired into real-player session sealing for both fighters', () => {
        const source = readFileSync(resolve(process.cwd(), 'api/pvp/session.ts'), 'utf8');
        assert.match(source, /const humanPvp = realFighters\.p1 && realFighters\.p2/);
        assert.match(source, /if \(humanPvp\)[\s\S]{0,300}normalizeHumanPvpLoadout\(finalP1Character\)[\s\S]{0,200}normalizeHumanPvpLoadout\(finalP2Character\)/);
    });
});
