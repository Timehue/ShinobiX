import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    sectorWarId,
    newSectorWarSession,
    normalizeSectorWarSession,
    applySectorBattleResult,
    findSectorWarBattleReceipt,
    recordSectorWarBattleOutcome,
    MERC_DEFENDER_REGEN_FRACTION,
    sectorWarKey,
    sectorWarTokenKey,
    newSectorWarBattleToken,
    normalizeSectorWarBattleToken,
    canDeclareSectorWar,
    applyContestBattleByWinner,
    cappedSectorSwing,
    isSectorWarActive,
    sectorWarExpiry,
    applyLazySectorWarExpiry,
    abandonSectorWar,
    SECTOR_WAR_IDLE_TIMEOUT_MS,
    SECTOR_WAR_MAX_DURATION_MS,
    type SectorWarSession,
} from './_sector-war.js';
import { SECTOR_CONTROL_HP_MAX, SECTOR_CONTROL_MAX_SWING_FRACTION, SECTOR_CONTROL_HP_ABSOLUTE_MAX } from './_war-state.js';

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
        const s = newSectorWarSession({ sector: 8, attackerVillage: 'A Village', defenderVillage: 'B Village', winCondition: 'card', now: NOW, controlHpMax: 115 });
        assert.equal(s.controlHpMax, 115);
        assert.equal(s.controlHp, 115);
    });
});

describe('sector-war: normalize', () => {
    it('clamps Control HP into [0, max] and validates the win-condition', () => {
        const s = normalizeSectorWarSession({ sector: 8, attackerVillage: 'A', defenderVillage: 'B', winCondition: 'hax' as never, controlHp: 99999, controlHpMax: 115 });
        assert.ok(s);
        assert.equal(s!.controlHp, 115);
        assert.equal(s!.winCondition, 'combat');
    });
    it('migrates an in-flight session written under the old, much larger bar', () => {
        // A siege opened before the 2026-08-06 rescale stored controlHpMax 2000.
        // It must clamp to the current absolute ceiling instead of leaving a live
        // contest that needs hundreds of wins to finish.
        const s = normalizeSectorWarSession({
            sector: 8, attackerVillage: 'A', defenderVillage: 'B',
            winCondition: 'combat', controlHp: 1800, controlHpMax: 2000,
        } as never);
        assert.ok(s);
        assert.ok(s!.controlHpMax <= SECTOR_CONTROL_HP_ABSOLUTE_MAX, 'bar migrated down');
        assert.ok(s!.controlHp <= s!.controlHpMax, 'current HP stays inside the migrated bar');
    });

    it('rejects a malformed / self-targeting session', () => {
        assert.equal(normalizeSectorWarSession(null as never), null);
        assert.equal(normalizeSectorWarSession({ attackerVillage: 'A', defenderVillage: 'A' } as never), null);
        assert.equal(normalizeSectorWarSession({ attackerVillage: 'A' } as never), null);
    });
});

// The role-ladder swings the live resolves actually produce (api/_war-role
// sectorControlSwing = winner.win + loser.loss).
const SWING_VILLAGER_V_VILLAGER = 5;    // 5 + 0
const SWING_ANBU_V_VILLAGER = 15;       // 15 + 0
const SWING_KAGE_V_KAGE = 80;           // 30 + 50 — the top of the ladder
const CAP = Math.floor(SECTOR_CONTROL_HP_MAX * SECTOR_CONTROL_MAX_SWING_FRACTION);

describe('sector-war: per-fight swing cap', () => {
    it('leaves an ordinary role swing untouched', () => {
        assert.equal(cappedSectorSwing(SWING_VILLAGER_V_VILLAGER, SECTOR_CONTROL_HP_MAX), 5);
        assert.equal(cappedSectorSwing(SWING_ANBU_V_VILLAGER, SECTOR_CONTROL_HP_MAX), 15);
    });

    it('caps the top of the ladder so one duel can never flip a sector', () => {
        assert.equal(cappedSectorSwing(SWING_KAGE_V_KAGE, SECTOR_CONTROL_HP_MAX), CAP);
        assert.ok(CAP < SECTOR_CONTROL_HP_MAX, 'a single fight cannot cover the whole bar');
    });

    it('scales the cap with the sector bar (Watchtower raises both)', () => {
        assert.equal(cappedSectorSwing(999, 200), 40);
        assert.equal(cappedSectorSwing(999, 50), 10);
    });

    it('never turns a real fight into a no-op, however lopsided', () => {
        assert.equal(cappedSectorSwing(1, 1), 1);
        assert.equal(cappedSectorSwing(3, 2), 1);
        assert.equal(cappedSectorSwing(0, SECTOR_CONTROL_HP_MAX), 0);
        assert.equal(cappedSectorSwing(-50, SECTOR_CONTROL_HP_MAX), 0);
    });
});

describe('sector-war: pacing (the numbers a siege actually costs)', () => {
    /** Wins needed to flip a full sector at a constant swing, attacker winning every fight. */
    function winsToFlip(swing: number): number {
        let s = fresh();
        for (let i = 1; i <= 500; i++) {
            const out = applySectorBattleResult(s, true, { now: NOW, swing });
            s = out.session;
            if (out.captured) return i;
        }
        return Infinity;
    }

    it('costs rank-and-file a real but achievable siege', () => {
        const wins = winsToFlip(SWING_VILLAGER_V_VILLAGER);
        assert.equal(wins, 20);
        // Guard the regression this tuning fixed: it used to be 400.
        assert.ok(wins <= 40, `villager siege must stay a session's work, got ${wins}`);
    });

    it('rewards fielding leadership without trivialising the siege', () => {
        assert.equal(winsToFlip(SWING_ANBU_V_VILLAGER), 7);
        const kage = winsToFlip(SWING_KAGE_V_KAGE);
        assert.equal(kage, 5, 'the cap floors any siege at 5 fights');
        assert.ok(kage < winsToFlip(SWING_VILLAGER_V_VILLAGER), 'rank must still matter');
    });

    it('a full mercenary band moves a sector meaningfully', () => {
        // A 5-merc warlord band fights at villager weight (ROLE_MERC).
        const band = 5 * SWING_VILLAGER_V_VILLAGER;
        assert.ok(band / SECTOR_CONTROL_HP_MAX >= 0.2, 'a top-tier hire must be worth its WR');
    });
});

describe('sector-war: contest expiry', () => {
    const DAY = 24 * 60 * 60 * 1000;

    it('a fresh contest is active', () => {
        assert.equal(isSectorWarActive(fresh(), NOW), true);
        assert.equal(sectorWarExpiry(fresh(), NOW).expired, false);
    });

    it('lapses once nobody has fought it for the idle timeout', () => {
        const s = fresh();
        assert.equal(isSectorWarActive(s, NOW + SECTOR_WAR_IDLE_TIMEOUT_MS - 1), true);
        const e = sectorWarExpiry(s, NOW + SECTOR_WAR_IDLE_TIMEOUT_MS);
        assert.equal(e.expired, true);
        assert.equal(e.reason, 'idle');
    });

    it('a battle refreshes the idle clock — an ACTIVE siege is not reaped', () => {
        // updatedAt advances on every applied battle, so it doubles as last-activity.
        const fought = applySectorBattleResult(fresh(), true, { now: NOW + 20 * 60 * 60 * 1000, swing: SWING_VILLAGER_V_VILLAGER }).session;
        assert.equal(isSectorWarActive(fought, NOW + 30 * 60 * 60 * 1000), true, 'still live 10h after the last fight');
    });

    it('hits the hard cap even while being actively fought', () => {
        const grinding: SectorWarSession = { ...fresh(), updatedAt: NOW + 3 * DAY };
        const e = sectorWarExpiry(grinding, NOW + SECTOR_WAR_MAX_DURATION_MS);
        assert.equal(e.expired, true);
        assert.equal(e.reason, 'timeout');
    });

    it('a captured contest never "expires" — it was already decided', () => {
        const flipped: SectorWarSession = { ...fresh(), flipped: true };
        assert.equal(sectorWarExpiry(flipped, NOW + 30 * DAY).expired, false);
        assert.equal(isSectorWarActive(flipped, NOW), false, 'but it is not active either');
    });

    it('applyLazySectorWarExpiry stamps a lapsed contest exactly once', () => {
        const first = applyLazySectorWarExpiry(fresh(), NOW + SECTOR_WAR_IDLE_TIMEOUT_MS);
        assert.equal(first.changed, true);
        assert.equal(first.session.expiredReason, 'idle');
        assert.equal(first.session.expiredAt, NOW + SECTOR_WAR_IDLE_TIMEOUT_MS);
        // Re-running is inert — no re-stamp, same reference.
        const second = applyLazySectorWarExpiry(first.session, NOW + 10 * DAY);
        assert.equal(second.changed, false);
        assert.equal(second.session, first.session);
    });

    it('leaves a live contest untouched', () => {
        const r = applyLazySectorWarExpiry(fresh(), NOW + 1000);
        assert.equal(r.changed, false);
        assert.equal(r.session.expiredAt, undefined);
    });

    it('an expired contest can no longer take Control-HP damage', () => {
        const expired = applyLazySectorWarExpiry(fresh(), NOW + SECTOR_WAR_IDLE_TIMEOUT_MS).session;
        const out = applySectorBattleResult(expired, true, { now: NOW + SECTOR_WAR_IDLE_TIMEOUT_MS + 1, swing: SWING_KAGE_V_KAGE });
        assert.equal(out.hpDealt, 0);
        assert.equal(out.captured, false);
        assert.equal(out.session, expired, 'unchanged reference — the defender held');
    });

    it('the attacking Kage can call a siege off, and it stays off', () => {
        const a = abandonSectorWar(fresh(), NOW + 60_000);
        assert.equal(a.changed, true);
        assert.equal(a.session.expiredReason, 'abandoned');
        assert.equal(isSectorWarActive(a.session, NOW + 60_000), false);
        // Idempotent — a second call-off does nothing.
        assert.equal(abandonSectorWar(a.session, NOW + 120_000).changed, false);
    });

    it('a captured sector cannot be retroactively abandoned', () => {
        const flipped: SectorWarSession = { ...fresh(), flipped: true };
        assert.equal(abandonSectorWar(flipped, NOW).changed, false);
    });

    it('round-trips the expiry stamp through storage normalization', () => {
        const expired = applyLazySectorWarExpiry(fresh(), NOW + SECTOR_WAR_IDLE_TIMEOUT_MS).session;
        const n = normalizeSectorWarSession(JSON.parse(JSON.stringify(expired)));
        assert.equal(n?.expiredAt, expired.expiredAt);
        assert.equal(n?.expiredReason, 'idle');
        assert.equal(isSectorWarActive(n, NOW + SECTOR_WAR_IDLE_TIMEOUT_MS), false);
    });

    it('defaults an unrecognised stored reason rather than trusting the blob', () => {
        const n = normalizeSectorWarSession({
            sector: 8, attackerVillage: 'A', defenderVillage: 'B',
            winCondition: 'combat', expiredAt: NOW, expiredReason: 'hax' as never,
        } as never);
        assert.equal(n?.expiredReason, 'timeout');
    });

    it('the idle timeout is comfortably shorter than the hard cap', () => {
        assert.ok(SECTOR_WAR_IDLE_TIMEOUT_MS < SECTOR_WAR_MAX_DURATION_MS);
        // And a sector war must resolve well inside a village war's 14 days (§17.6).
        assert.ok(SECTOR_WAR_MAX_DURATION_MS < 14 * DAY);
    });
});

describe('sector-war: applySectorBattleResult', () => {
    it('an attacker win chips Control HP by the role-scaled swing', () => {
        const out = applySectorBattleResult(fresh(), true, { now: NOW, swing: SWING_ANBU_V_VILLAGER });
        assert.equal(out.hpDealt, 15);
        assert.equal(out.session.controlHp, SECTOR_CONTROL_HP_MAX - 15);
        assert.equal(out.captured, false);
    });

    it('clamps a huge swing to the per-fight cap before applying it', () => {
        const out = applySectorBattleResult(fresh(), true, { now: NOW, swing: SWING_KAGE_V_KAGE });
        assert.equal(out.hpDealt, CAP);
        assert.equal(out.session.controlHp, SECTOR_CONTROL_HP_MAX - CAP);
    });

    it('flips the sector when Control HP drains to 0', () => {
        let s = fresh();
        let captured = false;
        // Capped swing 20 → 5 wins drain a full 100 pool to 0.
        for (let i = 0; i < 5; i++) {
            const out = applySectorBattleResult(s, true, { now: NOW, swing: SWING_KAGE_V_KAGE });
            s = out.session;
            captured = out.captured;
        }
        assert.equal(s.controlHp, 0);
        assert.equal(s.flipped, true);
        assert.equal(captured, true); // flipped on the 5th
    });

    it('a defender win HEALS half the swing (capped at max)', () => {
        // chip twice (30), then a defender win with swing 15 heals floor(15 * 0.5) = 7.
        let s = applySectorBattleResult(fresh(), true, { now: NOW, swing: SWING_ANBU_V_VILLAGER }).session;
        s = applySectorBattleResult(s, true, { now: NOW, swing: SWING_ANBU_V_VILLAGER }).session;
        const d1 = applySectorBattleResult(s, false, { now: NOW, swing: SWING_ANBU_V_VILLAGER });
        assert.equal(d1.hpRegen, 7);
        assert.equal(d1.session.controlHp, SECTOR_CONTROL_HP_MAX - 30 + 7);
        // From full, a defender win cannot exceed the cap.
        const atMax = applySectorBattleResult(fresh(), false, { now: NOW, swing: SWING_ANBU_V_VILLAGER });
        assert.equal(atMax.session.controlHp, SECTOR_CONTROL_HP_MAX);
        assert.equal(atMax.hpRegen, 0);
    });

    it('a defender win never fully undoes an attacker win (a siege keeps ground)', () => {
        const chipped = applySectorBattleResult(fresh(), true, { now: NOW, swing: SWING_ANBU_V_VILLAGER });
        const healed = applySectorBattleResult(chipped.session, false, { now: NOW, swing: SWING_ANBU_V_VILLAGER });
        assert.ok(healed.hpRegen < chipped.hpDealt, 'trading wins 1:1 must still favour the attacker');
    });

    it('a player repelling a MERCENARY heals only the merc fraction of the swing', () => {
        let s = applySectorBattleResult(fresh(), true, { now: NOW, swing: SWING_KAGE_V_KAGE }).session;
        s = applySectorBattleResult(s, true, { now: NOW, swing: SWING_KAGE_V_KAGE }).session;
        const merc = applySectorBattleResult(s, false, { now: NOW, swing: SWING_KAGE_V_KAGE, mercBattle: true });
        assert.equal(merc.hpRegen, Math.floor(CAP * MERC_DEFENDER_REGEN_FRACTION)); // 5
        const normal = applySectorBattleResult(s, false, { now: NOW, swing: SWING_KAGE_V_KAGE });
        assert.equal(normal.hpRegen, Math.floor(CAP * 0.5)); // 10 — a real player win heals more
    });

    it('an already-flipped session is inert', () => {
        const flipped: SectorWarSession = { ...fresh(), controlHp: 0, flipped: true };
        const out = applySectorBattleResult(flipped, true, { now: NOW + 1000, swing: SWING_KAGE_V_KAGE });
        assert.equal(out.captured, false);
        assert.equal(out.hpDealt, 0);
        assert.equal(out.session, flipped); // unchanged reference
    });
});

describe('sector-war: durable applied-battle receipts', () => {
    it('records the Control-HP mutation and battle receipt in one session', () => {
        const outcome = applySectorBattleResult(fresh(), true, { now: NOW, swing: SWING_ANBU_V_VILLAGER });
        const recorded = recordSectorWarBattleOutcome(outcome, { battleId: 'pvp-123', attackerWon: true, at: NOW });
        assert.equal(recorded.session.controlHp, SECTOR_CONTROL_HP_MAX - 15);
        assert.equal(recorded.receipt.hpDealt, 15);
        assert.equal(findSectorWarBattleReceipt(recorded.session, 'pvp-123'), recorded.receipt);
    });

    it('returns the original receipt without appending a duplicate', () => {
        const firstOutcome = applySectorBattleResult(fresh(), true, { now: NOW, swing: SWING_ANBU_V_VILLAGER });
        const first = recordSectorWarBattleOutcome(firstOutcome, { battleId: 'pvp-123', attackerWon: true, at: NOW });
        const replayOutcome = applySectorBattleResult(first.session, true, { now: NOW + 1, swing: 999 });
        const replay = recordSectorWarBattleOutcome(replayOutcome, { battleId: 'pvp-123', attackerWon: true, at: NOW + 1 });
        assert.equal(replay.session, replayOutcome.session);
        assert.equal(replay.receipt, first.receipt);
        assert.equal(replay.session.appliedBattles?.length, 1);
    });

    it('normalizes and retains battle receipts for retry recovery', () => {
        const outcome = applySectorBattleResult(fresh(), false, { now: NOW, swing: SWING_ANBU_V_VILLAGER });
        const recorded = recordSectorWarBattleOutcome(outcome, { battleId: 'card-123', attackerWon: false, at: NOW });
        const normalized = normalizeSectorWarSession(JSON.parse(JSON.stringify(recorded.session)));
        assert.equal(normalized?.appliedBattles?.[0]?.battleId, 'card-123');
        assert.equal(normalized?.appliedBattles?.[0]?.hpRegen, 0);
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
            registeredBy: 'alice', winCondition: 'combat',
            p1Name: 'alice', p2Name: 'bob', p1Village: 'Moonshadow Village', p2Village: 'Frostfang Village',
            now: NOW,
        });
        assert.equal(t.expiresAt, NOW + 60 * 60 * 1000);
        assert.equal(t.p1Village, 'Moonshadow Village');
        assert.equal(t.p2Village, 'Frostfang Village');
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
        sector: 26, // a Frostfang home sector (the gate, 2026-07 numbering)
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
        assert.equal((canDeclareSectorWar({ ...base, sector: 48 }) as { error: string }).error, 'not-war-sector'); // central keep, not a war sector
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
    it('p1 (attacker) win chips Control HP by the swing', () => {
        const out = applyContestBattleByWinner(fresh(), 'p1', { now: NOW, swing: SWING_ANBU_V_VILLAGER });
        assert.ok(out);
        assert.equal(out!.hpDealt, 15);
        assert.equal(out!.session.controlHp, SECTOR_CONTROL_HP_MAX - 15);
    });
    it('p2 (defender) win heals half the swing (held line)', () => {
        let chipped = applyContestBattleByWinner(fresh(), 'p1', { now: NOW, swing: SWING_ANBU_V_VILLAGER })!.session;
        chipped = applyContestBattleByWinner(chipped, 'p1', { now: NOW, swing: SWING_ANBU_V_VILLAGER })!.session;
        const out = applyContestBattleByWinner(chipped, 'p2', { now: NOW, swing: SWING_ANBU_V_VILLAGER });
        assert.ok(out);
        assert.equal(out!.hpRegen, 7); // floor(15 * 0.5)
        assert.equal(out!.session.controlHp, SECTOR_CONTROL_HP_MAX - 30 + 7);
    });
    it('a draw leaves Control HP untouched (null outcome)', () => {
        assert.equal(applyContestBattleByWinner(fresh(), 'draw', { now: NOW, swing: SWING_KAGE_V_KAGE }), null);
    });
});
