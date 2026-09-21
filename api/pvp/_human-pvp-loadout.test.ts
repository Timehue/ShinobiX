import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LOADOUT_CAP_BASE, LOADOUT_CAP_SUB } from '../_entitlements.js';
import { JUTSU_CATALOG } from './_jutsu-catalog.js';
import { LEGACY_JUTSU_CATALOG } from './_legacy-jutsu-catalog.js';
import { hydrateCharacterFromSave, normalizeHumanPvpLoadout } from './session.js';

const techniques = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `regular-${index}` }));

describe('human PvP loadout normalization', () => {
    it('keeps all 15 regular techniques for an active supporter', () => {
        const regular = techniques(15);
        const normalized = normalizeHumanPvpLoadout({ name: 'Supporter', patreon: { active: true }, jutsu: regular });
        assert.deepEqual(normalized.jutsu, regular.slice(0, LOADOUT_CAP_SUB));
    });

    it('hydrates all 15 learned subscriber slots before human-PvP sealing', () => {
        const equippedJutsuIds = Object.keys(JUTSU_CATALOG)
            .filter((id) => id.startsWith('starter-'))
            .slice(0, LOADOUT_CAP_SUB);
        assert.equal(equippedJutsuIds.length, LOADOUT_CAP_SUB, 'fixture needs 15 built-in starter jutsu');
        const saveCharacter = {
            name: 'Supporter',
            patreon: { active: true },
            level: 50,
            specialty: 'Ninjutsu',
            stats: {},
            equippedJutsuIds,
            jutsuMastery: equippedJutsuIds.map((jutsuId) => ({ jutsuId, level: 0 })),
        };
        const hydrated = hydrateCharacterFromSave(saveCharacter, {}, { character: saveCharacter });
        assert.deepEqual(
            (hydrated.jutsu as Array<{ id: string }>).map(({ id }) => id),
            equippedJutsuIds,
        );
    });

    it('keeps the base-account cap and does not mutate a loadout already within it', () => {
        const character = { name: 'Base', jutsu: techniques(12) };
        assert.equal(normalizeHumanPvpLoadout(character), character);
        assert.deepEqual(
            normalizeHumanPvpLoadout({ name: 'Base', jutsu: techniques(15) }).jutsu,
            techniques(15).slice(0, LOADOUT_CAP_BASE),
        );
    });

    it('preserves the separately earned Legacy signature after the subscriber slots', () => {
        const signature = Object.values(LEGACY_JUTSU_CATALOG)[0]!;
        const regular = techniques(15);
        const normalized = normalizeHumanPvpLoadout({ patreon: { active: true }, jutsu: [...regular, signature] });
        assert.deepEqual(normalized.jutsu, [...regular.slice(0, LOADOUT_CAP_SUB), signature]);
    });

    it('is wired into real-player session sealing for both fighters', () => {
        const source = readFileSync(resolve(process.cwd(), 'api/pvp/session.ts'), 'utf8');
        assert.match(source, /const humanPvp = realFighters\.p1 && realFighters\.p2/);
        assert.match(source, /if \(humanPvp\)[\s\S]{0,300}normalizeHumanPvpLoadout\(finalP1Character\)[\s\S]{0,200}normalizeHumanPvpLoadout\(finalP2Character\)/);
    });
});
