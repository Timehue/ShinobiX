import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    sectorWarId,
    newSectorWarSession,
    normalizeSectorWarSession,
    applySectorBattleResult,
    sectorWarKey,
    sectorWarTokenKey,
    newSectorWarBattleToken,
    normalizeSectorWarBattleToken,
    canDeclareSectorWar,
    applyContestBattleByWinner,
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

describe('sector-war: storage keys + single-use battle token', () => {
    it('keys the contest + token records under shared:', () => {
        assert.equal(sectorWarKey('8:a-vs-b'), 'shared:sector-war:8:a-vs-b');
        assert.equal(sectorWarTokenKey('battle-123'), 'shared:sector-war-token:battle-123');
    });
    it('mints + round-trips a battle token', () => {
        const t = newSectorWarBattleToken({
            battleId: 'b1', sectorWarId: '8:moonshadowvillage-vs-frostfangvillage',
            sector: 8, attackerVillage: 'Moonshadow Village', defenderVillage: 'Frostfang Village',
            registeredBy: 'alice', winCondition: 'combat', now: NOW,
        });
        assert.equal(t.expiresAt, NOW + 60 * 60 * 1000);
        assert.deepEqual(normalizeSectorWarBattleToken(JSON.parse(JSON.stringify(t))), t);
    });
    it('rejects a malformed / self-targeting token', () => {
        assert.equal(normalizeSectorWarBattleToken(null as never), null);
        assert.equal(normalizeSectorWarBattleToken({ battleId: 'b', sectorWarId: 's', attackerVillage: 'A', defenderVillage: 'A' } as never), null);
        assert.equal(normalizeSectorWarBattleToken({ sectorWarId: 's', attackerVillage: 'A', defenderVillage: 'B' } as never), null); // no battleId
    });
});

describe('sector-war: canDeclareSectorWar', () => {
    const base = {
        attackerVillage: 'Moonshadow Village',
        defenderVillage: 'Frostfang Village',
        sector: 47, // a Frostfang home sector
        sectorOwnerVillage: 'Frostfang Village',
        winCondition: 'combat' as const,
        attackerInActiveVillageWar: false,
        defenderInActiveVillageWar: false,
        contestAlreadyActive: false,
        attackerWr: 1000,
        attackerSectorsHeld: 8,
    };
    it('allows a well-formed declaration and returns the discounted cost', () => {
        const r = canDeclareSectorWar(base);
        assert.equal(r.ok, true);
        assert.equal((r as { cost: number }).cost, 250); // 8 sectors held → full price
    });
    it('is free at 0 sectors held (comeback discount)', () => {
        const r = canDeclareSectorWar({ ...base, attackerSectorsHeld: 0, attackerWr: 0 });
        assert.equal(r.ok, true);
        assert.equal((r as { cost: number }).cost, 0);
    });
    it('rejects self / non-war village / non-war sector', () => {
        assert.equal((canDeclareSectorWar({ ...base, defenderVillage: 'Moonshadow Village' }) as { error: string }).error, 'self');
        assert.equal((canDeclareSectorWar({ ...base, attackerVillage: 'Konoha' }) as { error: string }).error, 'not-war-village');
        assert.equal((canDeclareSectorWar({ ...base, sector: 57 }) as { error: string }).error, 'not-war-sector'); // central, not a war sector
    });
    it('requires the target sector to currently be held by the defender', () => {
        assert.equal((canDeclareSectorWar({ ...base, sectorOwnerVillage: 'Moonshadow Village' }) as { error: string }).error, 'not-enemy-held');
    });
    it('enforces the village-war mutual exclusion on both sides', () => {
        assert.equal((canDeclareSectorWar({ ...base, attackerInActiveVillageWar: true }) as { error: string }).error, 'mutual-exclusion-attacker');
        assert.equal((canDeclareSectorWar({ ...base, defenderInActiveVillageWar: true }) as { error: string }).error, 'mutual-exclusion-defender');
    });
    it('blocks a second contest on an already-contested sector', () => {
        assert.equal((canDeclareSectorWar({ ...base, contestAlreadyActive: true }) as { error: string }).error, 'already-contested');
    });
    it('blocks win-conditions not wired this build (card/pet until their phase), opt-in allows card', () => {
        assert.equal((canDeclareSectorWar({ ...base, winCondition: 'pet' as const }) as { error: string }).error, 'win-condition-unavailable');
        assert.equal((canDeclareSectorWar({ ...base, winCondition: 'card' as const }) as { error: string }).error, 'win-condition-unavailable');
        assert.equal(canDeclareSectorWar({ ...base, winCondition: 'card' as const, allowedWinConditions: ['combat', 'card'] }).ok, true);
    });
    it('rejects an unaffordable declaration and surfaces the cost', () => {
        const r = canDeclareSectorWar({ ...base, attackerWr: 10 });
        assert.equal(r.ok, false);
        assert.equal((r as { error: string }).error, 'insufficient-wr');
        assert.equal((r as { cost: number }).cost, 250);
    });
});

describe('sector-war: applyContestBattleByWinner (Card by-side mapping)', () => {
    function fresh(): SectorWarSession {
        return newSectorWarSession({
            sector: 8, attackerVillage: 'Moonshadow Village', defenderVillage: 'Frostfang Village',
            winCondition: 'card', now: NOW,
        });
    }
    it('p1 (attacker) win chips Control HP', () => {
        const out = applyContestBattleByWinner(fresh(), 'p1', { now: NOW });
        assert.ok(out);
        assert.equal(out!.hpDealt, 150);
        assert.equal(out!.session.controlHp, 450);
    });
    it('p2 (defender) win regens (held line)', () => {
        const chipped = applyContestBattleByWinner(fresh(), 'p1', { now: NOW })!.session; // 450
        const out = applyContestBattleByWinner(chipped, 'p2', { now: NOW });
        assert.ok(out);
        assert.equal(out!.hpRegen, 50);
        assert.equal(out!.session.controlHp, 500);
    });
    it('a draw leaves Control HP untouched (null outcome)', () => {
        assert.equal(applyContestBattleByWinner(fresh(), 'draw', { now: NOW }), null);
    });
    it('honors a War-Academy-boosted damage value on an attacker win', () => {
        const out = applyContestBattleByWinner(fresh(), 'p1', { now: NOW, damage: 173 });
        assert.equal(out!.session.controlHp, 600 - 173);
    });
});
