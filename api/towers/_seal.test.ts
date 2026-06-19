import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sealTowerFighter } from './_seal.js';

describe('Battle Towers fighter sealing (P1.B)', () => {
    it('clamps tampered stats + vitals to the hard caps', () => {
        const sealed = sealTowerFighter({
            name: 'Cheater', level: 50, specialty: 'Ninjutsu',
            stats: { taijutsuOffense: 999999, willpower: -50 },
            maxHp: 999999, maxChakra: 999999, bloodlineMult: 99,
        });
        const stats = sealed.stats as Record<string, number>;
        assert.equal(stats.taijutsuOffense, 2500);
        assert.equal(stats.willpower, 0);
        assert.equal(sealed.maxHp, 10000);
        assert.equal(sealed.maxChakra, 5000);
        assert.equal(sealed.bloodlineMult, 3);
        assert.equal(sealed.specialty, 'Ninjutsu');
    });

    it('sanitizes the jutsu loadout (caps effectPower)', () => {
        const sealed = sealTowerFighter({ stats: {}, jutsu: [{ id: 'j1', effectPower: 999999, type: 'Ninjutsu' }] });
        const jutsu = sealed.jutsu as Array<Record<string, unknown>>;
        assert.ok((jutsu[0].effectPower as number) <= 600, 'effectPower clamped by sanitizeJutsuList');
    });

    it('strips currencies + inventory + battleTower ledgers', () => {
        const sealed = sealTowerFighter({ name: 'A', ryo: 1e9, inventory: [1, 2, 3], battleTowerClearedFloors: [1, 2, 3], stats: {} });
        assert.ok(!('ryo' in sealed));
        assert.ok(!('inventory' in sealed));
        assert.ok(!('battleTowerClearedFloors' in sealed));
        assert.equal(sealed.name, 'A');
    });

    it('defaults an invalid specialty to Taijutsu', () => {
        const sealed = sealTowerFighter({ specialty: 'Hacking', stats: {} });
        assert.equal(sealed.specialty, 'Taijutsu');
    });
});
