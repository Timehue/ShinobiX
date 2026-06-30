import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    sectorWarId,
    newSectorWarSession,
    normalizeSectorWarSession,
    applySectorBattleResult,
    type SectorWarSession,
} from './_sector-war.js';
import { SECTOR_CONTROL_HP_MAX, SECTOR_CONTROL_HP_DEFENDER_REGEN } from './_war-state.js';

const NOW = Date.UTC(2026, 5, 29, 4, 0, 0);

function fresh(winCondition: 'combat' | 'card' | 'pet' = 'combat'): SectorWarSession {
    return newSectorWarSession({
        sector: 8, attackerVillage: 'Moonshadow Village', defenderVillage: 'Frostfang Village',
        winCondition, now: NOW,
    });
}

describe('sector-war: id + session shape', () => {
    it('builds a stable, slugged id', () => {
        assert.equal(sectorWarId(8, 'Moonshadow Village', 'Frostfang Village'), '8:moonshadowvillage-vs-frostfangvillage');
    });
    it('a fresh session starts at full Control HP', () => {
        const s = fresh();
        assert.equal(s.controlHp, SECTOR_CONTROL_HP_MAX);
        assert.equal(s.controlHpMax, SECTOR_CONTROL_HP_MAX);
        assert.equal(s.flipped, false);
        assert.equal(s.sector, 8);
    });
    it('honors a Watchtower-boosted Control HP cap', () => {
        const s = newSectorWarSession({ sector: 8, attackerVillage: 'A Village', defenderVillage: 'B Village', winCondition: 'card', now: NOW, controlHpMax: 690 });
        assert.equal(s.controlHpMax, 690);
        assert.equal(s.controlHp, 690);
    });
});

describe('sector-war: normalize', () => {
    it('clamps Control HP into [0, max] and validates the win-condition', () => {
        const s = normalizeSectorWarSession({ sector: 8, attackerVillage: 'A', defenderVillage: 'B', winCondition: 'hax' as never, controlHp: 99999, controlHpMax: 600 });
        assert.ok(s);
        assert.equal(s!.controlHp, 600);
        assert.equal(s!.winCondition, 'combat');
    });
    it('rejects a malformed / self-targeting session', () => {
        assert.equal(normalizeSectorWarSession(null as never), null);
        assert.equal(normalizeSectorWarSession({ attackerVillage: 'A', defenderVillage: 'A' } as never), null);
        assert.equal(normalizeSectorWarSession({ attackerVillage: 'A' } as never), null);
    });
});

describe('sector-war: applySectorBattleResult', () => {
    it('an attacker win chips Control HP by the per-win amount', () => {
        const out = applySectorBattleResult(fresh(), true, { now: NOW });
        assert.equal(out.hpDealt, 150);
        assert.equal(out.session.controlHp, 450);
        assert.equal(out.captured, false);
    });

    it('flips the sector after ~4 attacker wins (600 / 150)', () => {
        let s = fresh();
        let captured = false;
        for (let i = 0; i < 4; i++) {
            const out = applySectorBattleResult(s, true, { now: NOW });
            s = out.session;
            captured = out.captured;
        }
        assert.equal(s.controlHp, 0);
        assert.equal(s.flipped, true);
        assert.equal(captured, true); // flipped on the 4th
    });

    it('a defender win holds the line (+regen, capped at max)', () => {
        // chip once then defend twice; regen is capped at the max.
        let s = applySectorBattleResult(fresh(), true, { now: NOW }).session; // 450
        const d1 = applySectorBattleResult(s, false, { now: NOW });
        assert.equal(d1.hpRegen, SECTOR_CONTROL_HP_DEFENDER_REGEN);
        assert.equal(d1.session.controlHp, 500);
        // From full, a defender win cannot exceed the cap.
        const atMax = applySectorBattleResult(fresh(), false, { now: NOW });
        assert.equal(atMax.session.controlHp, SECTOR_CONTROL_HP_MAX);
        assert.equal(atMax.hpRegen, 0);
    });

    it('honors a War-Academy-boosted damage value', () => {
        const out = applySectorBattleResult(fresh(), true, { now: NOW, damage: 173 }); // +15% of 150 ≈ 173
        assert.equal(out.session.controlHp, 600 - 173);
        assert.equal(out.hpDealt, 173);
    });

    it('an already-flipped session is inert', () => {
        const flipped: SectorWarSession = { ...fresh(), controlHp: 0, flipped: true };
        const out = applySectorBattleResult(flipped, true, { now: NOW + 1000 });
        assert.equal(out.captured, false);
        assert.equal(out.hpDealt, 0);
        assert.equal(out.session, flipped); // unchanged reference
    });
});
