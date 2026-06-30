import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    WAR_VILLAGES,
    HOME_SECTORS,
    CENTRAL_SECTORS,
    NON_WAR_SPECIAL_SECTORS,
    homeSectorsForVillage,
    homeVillageForSector,
    isWarSector,
    isCentralSector,
    sectorAlias,
    isWarVillage,
} from './_war-map-sectors.js';

describe('war-map-sectors: ownership invariants', () => {
    it('exactly 4 villages, 8 home sectors each, 32 total', () => {
        assert.equal(WAR_VILLAGES.length, 4);
        let total = 0;
        for (const v of WAR_VILLAGES) {
            assert.equal(HOME_SECTORS[v].length, 8, `${v} should own 8 sectors`);
            total += HOME_SECTORS[v].length;
        }
        assert.equal(total, 32);
    });

    it('no sector is owned by two villages', () => {
        const seen = new Set<number>();
        for (const v of WAR_VILLAGES) {
            for (const s of HOME_SECTORS[v]) {
                assert.ok(!seen.has(s), `sector ${s} is double-owned`);
                seen.add(s);
            }
        }
        assert.equal(seen.size, 32);
    });

    it('no home sector is a central or special (Hollow-Gate / Death\'s Gate) sector', () => {
        const banned = new Set<number>([...CENTRAL_SECTORS, ...NON_WAR_SPECIAL_SECTORS]);
        for (const v of WAR_VILLAGES) {
            for (const s of HOME_SECTORS[v]) {
                assert.ok(!banned.has(s), `sector ${s} (${v}) collides with a neutral/special sector`);
            }
        }
    });

    it('home sectors stay within each village\'s biome band', () => {
        const band = (s: number) =>
            s <= 20 ? 'shadow' : s <= 35 ? 'forest' : s <= 45 ? 'volcano' : s <= 55 ? 'snow' : 'central';
        const expected: Record<string, string> = {
            'Moonshadow Village': 'shadow', 'Stormveil Village': 'forest',
            'Ashen Leaf Village': 'volcano', 'Frostfang Village': 'snow',
        };
        for (const v of WAR_VILLAGES) {
            for (const s of HOME_SECTORS[v]) {
                assert.equal(band(s), expected[v], `sector ${s} of ${v} is outside its biome band`);
            }
        }
    });
});

describe('war-map-sectors: mappers', () => {
    it('homeVillageForSector / isWarSector round-trip every home sector', () => {
        for (const v of WAR_VILLAGES) {
            for (const s of HOME_SECTORS[v]) {
                assert.equal(homeVillageForSector(s), v);
                assert.ok(isWarSector(s));
            }
        }
    });

    it('central + special sectors are not war sectors', () => {
        for (const s of [...CENTRAL_SECTORS, 99]) {
            assert.equal(homeVillageForSector(s), undefined);
            assert.equal(isWarSector(s), false);
        }
        assert.ok(isCentralSector(58));
        assert.equal(isCentralSector(8), false);
    });

    it('homeSectorsForVillage returns the table; unknown village → empty', () => {
        assert.deepEqual([...homeSectorsForVillage('Frostfang Village')], [...HOME_SECTORS['Frostfang Village']]);
        assert.deepEqual([...homeSectorsForVillage('Nowhere')], []);
    });

    it('sector aliases are unique and match the village prefix', () => {
        const aliases = new Set<string>();
        for (const v of WAR_VILLAGES) {
            HOME_SECTORS[v].forEach((s, i) => {
                const a = sectorAlias(s);
                assert.ok(a, `sector ${s} has no alias`);
                assert.equal(a, `${({ 'Ashen Leaf Village': 'AL', 'Frostfang Village': 'FF', 'Stormveil Village': 'SV', 'Moonshadow Village': 'MS' } as Record<string, string>)[v]}-${i + 1}`);
                assert.ok(!aliases.has(a!), `duplicate alias ${a}`);
                aliases.add(a!);
            });
        }
        assert.equal(aliases.size, 32);
        assert.equal(sectorAlias(58), undefined); // central has no alias
    });

    it('isWarVillage type guard', () => {
        assert.ok(isWarVillage('Frostfang Village'));
        assert.equal(isWarVillage('Konoha'), false);
    });
});
