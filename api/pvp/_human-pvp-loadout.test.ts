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

    it('hydrates 14 base or 15 supporter learned slots before human-PvP sealing', () => {
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
        for (const [active, cap] of [[false, 14], [true, 15]] as const) {
            const character = { ...saveCharacter, patreon: { active } };
            const hydrated = hydrateCharacterFromSave(character, {}, { character });
            const normalized = normalizeHumanPvpLoadout(hydrated);
            assert.deepEqual(
                (normalized.jutsu as Array<{ id: string }>).map(({ id }) => id),
                equippedJutsuIds.slice(0, cap),
            );
        }
    });

    it('keeps the base-account cap and does not mutate a loadout already within it', () => {
        const character = { name: 'Base', jutsu: techniques(14) };
        assert.equal(normalizeHumanPvpLoadout(character), character);
        assert.deepEqual(
            normalizeHumanPvpLoadout({ name: 'Base', jutsu: techniques(15) }).jutsu,
            techniques(14),
        );
    });

    it('uses the base capacity after a supporter entitlement expires', () => {
        const legacy = Object.values(LEGACY_JUTSU_CATALOG)[0]!;
        const normalized = normalizeHumanPvpLoadout({
            patreon: { active: true, expiresAt: Date.now() - 1 },
            jutsu: [...techniques(15), legacy],
        });
        assert.deepEqual(normalized.jutsu, [...techniques(LOADOUT_CAP_BASE), legacy]);
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

    it('keeps ranked 2v2 fighter hydration on the server entitlement path', () => {
        const store = readFileSync(resolve(process.cwd(), 'api/towers/_pvp-store.ts'), 'utf8');
        assert.match(store, /projectRankedFormatCharacter\(character,[\s\S]{0,220}: character/);
        assert.match(store, /sealTowerFighter\(sealCharacter, save, \{\}, admin\)/);
        const rankedDuo = readFileSync(resolve(process.cwd(), 'api/pvp/_ranked-2v2.ts'), 'utf8');
        assert.match(rankedDuo, /loadTowerPvpFighter\(slug, \{ consumables: true, rankedFormat: true \}\)/);
    });
});
