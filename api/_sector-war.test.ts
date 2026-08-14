import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    sectorWarId,
    newSectorWarSession,
    normalizeSectorWarSession,
    applySectorWarBattle,
    applyContestBattleByWinner,
    findSectorWarBattleReceipt,
    recordSectorWarBattleOutcome,
    settleSectorWar,
    abandonSectorWar,
    isSectorWarActive,
    isGarrisonAssaultable,
    garrisonPointsInWar,
    sectorWarKey,
    sectorWarTokenKey,
    sectorDeclareLockKey,
    newSectorWarBattleToken,
    normalizeSectorWarBattleToken,
    canDeclareSectorWar,
    SECTOR_WAR_DURATION_MS,
    GARRISON_POINTS_CAP,
    GARRISON_POINTS_FRACTION,
    MERC_REPEL_POINTS_FRACTION,
    GARRISON_UNLOCK_IDLE_MS,
    MAX_ACTIVE_ATTACK_SIEGES,
    SECTOR_RESIEGE_COOLDOWN_SEC,
    type SectorWarSession,
} from './_sector-war.js';

const NOW = Date.UTC(2026, 5, 29, 4, 0, 0);
const HOUR = 60 * 60 * 1000;

function fresh(winCondition: 'combat' | 'card' | 'pet' = 'combat'): SectorWarSession {
    return newSectorWarSession({
        sector: 2, attackerVillage: 'Moonshadow Village', defenderVillage: 'Frostfang Village',
        winCondition, now: NOW,
    });
}

// The role-ladder swings the live resolves actually produce (api/_war-role
// sectorControlSwing = winner.win + loser.loss).
const SWING_VILLAGER_V_VILLAGER = 5;    // 5 + 0
const SWING_ANBU_V_VILLAGER = 15;       // 15 + 0
const SWING_VILLAGER_V_KAGE = 55;       // 5 + 50 — felling the enemy Kage is a bounty
const SWING_KAGE_V_KAGE = 80;           // 30 + 50 — the top of the ladder

describe('sector-war: id + session shape (72h scored war)', () => {
    it('builds a stable, slugged id', () => {
        assert.equal(sectorWarId(8, 'Moonshadow Village', 'Frostfang Village'), '8:moonshadowvillage-vs-frostfangvillage');
    });
    it('a fresh war starts 0:0 with a 72-hour clock', () => {
        const s = fresh();
        assert.equal(s.attackerPoints, 0);
        assert.equal(s.defenderPoints, 0);
        assert.equal(s.endsAt, NOW + SECTOR_WAR_DURATION_MS);
        assert.equal(s.endsAt - s.startedAt, 72 * HOUR);
        assert.equal(s.flipped, false);
    });
});

describe('sector-war: normalize + Control-HP migration', () => {
    it('rejects a malformed / self-targeting session', () => {
        assert.equal(normalizeSectorWarSession(null as never), null);
        assert.equal(normalizeSectorWarSession({ attackerVillage: 'A', defenderVillage: 'A' } as never), null);
        assert.equal(normalizeSectorWarSession({ attackerVillage: 'A' } as never), null);
    });

    it('migrates a LIVE record written under the retired count-down model', () => {
        // A Control-HP siege at 60/100: the 40 damage already dealt becomes the
        // attacker score, the clock runs 72h from the original start.
        const s = normalizeSectorWarSession({
            sector: 8, attackerVillage: 'A', defenderVillage: 'B', winCondition: 'combat',
            startedAt: NOW, updatedAt: NOW, flipped: false,
            controlHp: 60, controlHpMax: 100,
        } as never);
        assert.ok(s);
        assert.equal(s!.attackerPoints, 40, 'dealt damage carries over as score');
        assert.equal(s!.defenderPoints, 0);
        assert.equal(s!.endsAt, NOW + SECTOR_WAR_DURATION_MS);
    });

    it('maps legacy receipts so an already-scored battle cannot replay', () => {
        const s = normalizeSectorWarSession({
            sector: 8, attackerVillage: 'A', defenderVillage: 'B', winCondition: 'combat',
            startedAt: NOW, controlHp: 95, controlHpMax: 100,
            appliedBattles: [{ battleId: 'pvp-1', attackerWon: true, hpDealt: 5, hpRegen: 0, at: NOW }],
        } as never);
        const receipt = findSectorWarBattleReceipt(s!, 'pvp-1');
        assert.ok(receipt);
        assert.equal(receipt!.points, 5);
        assert.equal(receipt!.by, '', 'legacy receipts carry no attribution (no capture credit)');
    });

    it('reads legacy idle/timeout terminal records as defended holds', () => {
        const s = normalizeSectorWarSession({
            sector: 8, attackerVillage: 'A', defenderVillage: 'B', winCondition: 'combat',
            startedAt: NOW, endsAt: NOW + 1, expiredAt: NOW + 1, expiredReason: 'idle',
        } as never);
        assert.equal(s!.expiredReason, 'defended');
    });
});

describe('sector-war: scoring (the tally counts UP)', () => {
    it('an attacker win adds to the attacker tally, a defender win to the defender tally', () => {
        const a = applySectorWarBattle(fresh(), true, { now: NOW + 1, roleSwing: SWING_ANBU_V_VILLAGER, by: 'aria' });
        assert.equal(a.side, 'attacker');
        assert.equal(a.awarded, 15);
        assert.equal(a.session.attackerPoints, 15);
        assert.equal(a.session.defenderPoints, 0);
        const d = applySectorWarBattle(a.session, false, { now: NOW + 2, roleSwing: SWING_VILLAGER_V_VILLAGER, by: 'kell' });
        assert.equal(d.side, 'defender');
        assert.equal(d.session.attackerPoints, 15);
        assert.equal(d.session.defenderPoints, 5);
    });

    it('felling the enemy Kage scores the FULL bounty — no per-fight cap anymore', () => {
        const out = applySectorWarBattle(fresh(), true, { now: NOW + 1, roleSwing: SWING_VILLAGER_V_KAGE, by: 'aria' });
        assert.equal(out.awarded, 55);
        const top = applySectorWarBattle(fresh(), true, { now: NOW + 1, roleSwing: SWING_KAGE_V_KAGE, by: 'aria' });
        assert.equal(top.awarded, 80);
    });

    it('structure multipliers ride per SIDE: War Academy for attackers, Watchtower for defenders', () => {
        const atk = applySectorWarBattle(fresh(), true, { now: NOW + 1, roleSwing: 10, attackerMult: 1.15, defenderMult: 1.15, by: 'a' });
        assert.equal(atk.awarded, 12, 'attacker win uses the attacker mult (round(10 × 1.15))');
        const def = applySectorWarBattle(fresh(), false, { now: NOW + 1, roleSwing: 10, attackerMult: 2, defenderMult: 1.15, by: 'k' });
        assert.equal(def.awarded, 12, 'defender win uses the defender mult');
    });

    it('scores nothing after the whistle or on a terminal war', () => {
        const late = applySectorWarBattle(fresh(), true, { now: NOW + SECTOR_WAR_DURATION_MS, roleSwing: 50, by: 'a' });
        assert.equal(late.awarded, 0);
        assert.equal(late.side, 'none');
        const conceded = abandonSectorWar(fresh(), NOW + 1).session;
        assert.equal(applySectorWarBattle(conceded, true, { now: NOW + 2, roleSwing: 50, by: 'a' }).awarded, 0);
    });

    it('a live battle re-locks the garrison; AI battles do not', () => {
        const live = applySectorWarBattle(fresh(), true, { now: NOW + 1, roleSwing: 5, by: 'a' }).session;
        assert.equal(live.lastLiveBattleAt, NOW + 1);
        const garrison = applySectorWarBattle(fresh(), true, { now: NOW + 1, roleSwing: 5, by: 'a', garrisonBattle: true }).session;
        assert.equal(garrison.lastLiveBattleAt, undefined);
        const merc = applySectorWarBattle(fresh(), true, { now: NOW + 1, roleSwing: 5, mercBattle: true }).session;
        assert.equal(merc.lastLiveBattleAt, undefined);
    });

    it('draw in a card/pet contest scores nothing (null outcome)', () => {
        assert.equal(applyContestBattleByWinner(fresh(), 'draw', { now: NOW + 1, roleSwing: 10 }), null);
        const p1 = applyContestBattleByWinner(fresh(), 'p1', { now: NOW + 1, roleSwing: 10, by: 'a' });
        assert.equal(p1!.side, 'attacker');
        const p2 = applyContestBattleByWinner(fresh(), 'p2', { now: NOW + 1, roleSwing: 10, by: 'k' });
        assert.equal(p2!.side, 'defender');
    });
});

describe('sector-war: score caps (anti-farm)', () => {
    /** Run `n` won battles for `by`, appending receipts like the endpoints do. */
    function grind(session: SectorWarSession, n: number, roleSwing: number, by: string, garrison = false): SectorWarSession {
        let s = session;
        for (let i = 0; i < n; i++) {
            const out = applySectorWarBattle(s, true, { now: NOW + 1000 + i, roleSwing, by, garrisonBattle: garrison });
            s = recordSectorWarBattleOutcome(out, { battleId: `b-${by}-${garrison}-${i}`, attackerWon: true, by, garrison, at: NOW + 1000 + i }).session;
        }
        return s;
    }

    it('PLAYER scoring is uncapped — a Kage-slayer scores every bounty in full (owner ruling)', () => {
        // 5 Kage-weight kills by ONE player: all 400 points land. There is no
        // per-player cap — receipts single-count each battle, but the fights that
        // matter most (Kage/Elder duels) must never stop counting.
        const s = grind(fresh(), 5, SWING_KAGE_V_KAGE, 'slayer');
        assert.equal(s.attackerPoints, 5 * SWING_KAGE_V_KAGE);
        const more = applySectorWarBattle(s, true, { now: NOW + 9999, roleSwing: SWING_KAGE_V_KAGE, by: 'slayer' });
        assert.equal(more.awarded, SWING_KAGE_V_KAGE, 'still full value on the 6th');
    });

    it('garrison kills score at half weight and stop at the garrison cap', () => {
        // ANBU vs garrison: floor(15 × 0.5) = 7 per assault. Derive the run-out
        // from the constant so retuning the cap retunes the test with it.
        const per = Math.floor(SWING_ANBU_V_VILLAGER * GARRISON_POINTS_FRACTION);
        assert.equal(per, 7);
        const full = Math.floor(GARRISON_POINTS_CAP / per);
        const remainder = GARRISON_POINTS_CAP - full * per;
        let s = fresh();
        const awards: number[] = [];
        for (let i = 0; i < full + 2; i++) {
            const out = applySectorWarBattle(s, true, { now: NOW + 7200000 + i, roleSwing: SWING_ANBU_V_VILLAGER, by: 'aria', garrisonBattle: true });
            awards.push(out.awarded);
            s = recordSectorWarBattleOutcome(out, { battleId: `g-${i}`, attackerWon: true, by: 'aria', garrison: true, at: NOW + 7200000 + i }).session;
        }
        assert.equal(garrisonPointsInWar(s), GARRISON_POINTS_CAP, 'the cap is reached exactly');
        assert.equal(awards[full], remainder, 'the run-out award is clipped to the cap remainder');
        assert.equal(awards[full + 1], 0, 'and then the garrison yields nothing');
    });

    it('the garrison cap beats an ABSENT defence; a present defence is uncapped against it', () => {
        // Absent defence scores 0 → any garrison lead wins at settlement.
        assert.equal(GARRISON_POINTS_CAP, 150); // owner tuning 2026-08-07 (was 50)
        // The defence's own scoring has NO cap, so showing up can always outrun it.
        const out = applySectorWarBattle(fresh(), false, { now: NOW + 1, roleSwing: SWING_KAGE_V_KAGE, by: 'kell' });
        assert.equal(out.awarded, SWING_KAGE_V_KAGE);
    });

    it('repelling a mercenary scores the defender at the reduced fraction', () => {
        const out = applySectorWarBattle(fresh(), false, { now: NOW + 1, roleSwing: 20, by: 'kell', mercBattle: true });
        assert.equal(out.awarded, Math.floor(20 * MERC_REPEL_POINTS_FRACTION));
    });
});

describe('sector-war: settlement (most points at 72h wins)', () => {
    it('does nothing while the war still runs', () => {
        const r = settleSectorWar(fresh(), NOW + SECTOR_WAR_DURATION_MS - 1);
        assert.equal(r.changed, false);
    });

    it('attacker strictly ahead → the sector flips', () => {
        const s = { ...fresh(), attackerPoints: 10, defenderPoints: 9 };
        const r = settleSectorWar(s, NOW + SECTOR_WAR_DURATION_MS);
        assert.equal(r.changed, true);
        assert.equal(r.attackerWon, true);
        assert.equal(r.session.flipped, true);
    });

    it('defender ahead OR TIED → the defence holds (holding beats matching)', () => {
        for (const [a, d] of [[9, 10], [10, 10], [0, 0]] as const) {
            const r = settleSectorWar({ ...fresh(), attackerPoints: a, defenderPoints: d }, NOW + SECTOR_WAR_DURATION_MS);
            assert.equal(r.changed, true, `${a}:${d}`);
            assert.equal(r.attackerWon, false, `${a}:${d}`);
            assert.equal(r.session.expiredReason, 'defended', `${a}:${d}`);
        }
    });

    it('settles a pre-existing foreign attack on a protected gate as defended', () => {
        const legacyContest = newSectorWarSession({
            sector: 1,
            attackerVillage: 'Moonshadow Village',
            defenderVillage: 'Stormveil Village',
            winCondition: 'combat',
            now: NOW,
        });
        const blocked = settleSectorWar(
            { ...legacyContest, attackerPoints: 100, defenderPoints: 0 },
            NOW + SECTOR_WAR_DURATION_MS,
        );
        assert.equal(blocked.changed, true);
        assert.equal(blocked.attackerWon, false);
        assert.equal(blocked.session.flipped, false);
        assert.equal(blocked.session.expiredReason, 'defended');

        const homeReclaim = newSectorWarSession({
            sector: 1,
            attackerVillage: 'Stormveil Village',
            defenderVillage: 'Moonshadow Village',
            winCondition: 'combat',
            now: NOW,
        });
        const reclaimed = settleSectorWar(
            { ...homeReclaim, attackerPoints: 1, defenderPoints: 0 },
            NOW + SECTOR_WAR_DURATION_MS,
        );
        assert.equal(reclaimed.attackerWon, true);
        assert.equal(reclaimed.session.flipped, true);
    });

    it('is idempotent — a settled war never re-settles', () => {
        const first = settleSectorWar({ ...fresh(), attackerPoints: 1 }, NOW + SECTOR_WAR_DURATION_MS);
        const again = settleSectorWar(first.session, NOW + SECTOR_WAR_DURATION_MS + HOUR);
        assert.equal(again.changed, false);
        assert.equal(again.attackerWon, true);
    });

    it('abandon is a concession: the defender holds regardless of the score', () => {
        const leading = { ...fresh(), attackerPoints: 100, defenderPoints: 0 };
        const a = abandonSectorWar(leading, NOW + HOUR);
        assert.equal(a.changed, true);
        assert.equal(a.session.expiredReason, 'abandoned');
        assert.equal(abandonSectorWar(a.session, NOW + 2 * HOUR).changed, false, 'idempotent');
    });

    it('activity: running war is active, settled/conceded/past-end are not', () => {
        assert.equal(isSectorWarActive(fresh(), NOW + 1), true);
        assert.equal(isSectorWarActive(fresh(), NOW + SECTOR_WAR_DURATION_MS), false, 'the whistle ends scoring even before settlement stamps');
        assert.equal(isSectorWarActive(abandonSectorWar(fresh(), NOW + 1).session, NOW + 2), false);
    });
});

describe('sector-war: garrison gate (the liveness fallback)', () => {
    it('stays LOCKED while the defence is contesting, unlocks after the idle window', () => {
        assert.equal(isGarrisonAssaultable(fresh(), NOW + GARRISON_UNLOCK_IDLE_MS - 1), false);
        assert.equal(isGarrisonAssaultable(fresh(), NOW + GARRISON_UNLOCK_IDLE_MS), true);
    });

    it('a real defender fighting re-locks it', () => {
        const fought = applySectorWarBattle(fresh(), false, { now: NOW + 3 * HOUR, roleSwing: 5, by: 'kell' }).session;
        assert.equal(isGarrisonAssaultable(fought, NOW + 3 * HOUR + HOUR), false);
        assert.equal(isGarrisonAssaultable(fought, NOW + 3 * HOUR + GARRISON_UNLOCK_IDLE_MS), true);
    });

    it('a garrison assault does NOT re-lock itself', () => {
        const t = NOW + GARRISON_UNLOCK_IDLE_MS;
        const after = applySectorWarBattle(fresh(), true, { now: t, roleSwing: 5, by: 'a', garrisonBattle: true }).session;
        assert.equal(isGarrisonAssaultable(after, t + 1), true);
    });

    it('Combat sectors only, and never on a finished war', () => {
        for (const wc of ['card', 'pet'] as const) {
            assert.equal(isGarrisonAssaultable(fresh(wc), NOW + GARRISON_UNLOCK_IDLE_MS), false, wc);
        }
        assert.equal(isGarrisonAssaultable(fresh(), NOW + SECTOR_WAR_DURATION_MS + 1), false);
    });

    it('the unlock window fits inside the war many times over', () => {
        assert.ok(GARRISON_UNLOCK_IDLE_MS * 4 < SECTOR_WAR_DURATION_MS);
    });
});

describe('sector-war: durable battle receipts', () => {
    it('records points + attribution, and a replayed battleId returns the original', () => {
        const out = applySectorWarBattle(fresh(), true, { now: NOW + 1, roleSwing: 15, by: 'aria' });
        const first = recordSectorWarBattleOutcome(out, { battleId: 'pvp-123', attackerWon: true, by: 'aria', at: NOW + 1 });
        assert.equal(first.receipt.points, 15);
        assert.equal(first.receipt.by, 'aria');
        const replayOut = applySectorWarBattle(first.session, true, { now: NOW + 2, roleSwing: 999, by: 'aria' });
        const replay = recordSectorWarBattleOutcome(replayOut, { battleId: 'pvp-123', attackerWon: true, by: 'aria', at: NOW + 2 });
        assert.equal(replay.receipt, first.receipt);
        assert.equal(replay.session.appliedBattles?.length, 1);
    });

    it('round-trips receipts and the live-battle stamp through storage', () => {
        const out = applySectorWarBattle(fresh(), false, { now: NOW + 5, roleSwing: 20, by: 'kell' });
        const recorded = recordSectorWarBattleOutcome(out, { battleId: 'card-1', attackerWon: false, by: 'kell', at: NOW + 5 });
        const n = normalizeSectorWarSession(JSON.parse(JSON.stringify(recorded.session)));
        assert.equal(n?.defenderPoints, 20);
        assert.equal(n?.lastLiveBattleAt, NOW + 5);
        assert.equal(findSectorWarBattleReceipt(n!, 'card-1')?.points, 20);
    });
});

describe('sector-war: capture contributors (legacy sectorCaptures)', () => {
    it('credits every distinct attacker-side winner, never defenders or AI', async () => {
        const { captureContributors } = await import('./_sector-war-settle.js');
        let s = fresh();
        const battles: Array<[string, boolean, string]> = [
            ['b1', true, 'Aria'],    // attacker win → credited
            ['b2', true, 'aria'],    // same player, different case → once
            ['b3', false, 'Kell'],   // DEFENDER win → not a capture contributor
            ['b4', true, ''],        // AI (merc/garrison) → no legacy save to credit
            ['b5', true, 'Bo'],      // second attacker → credited
        ];
        for (const [id, attackerWon, by] of battles) {
            const out = applySectorWarBattle(s, attackerWon, { now: NOW + 1, roleSwing: 5, by, mercBattle: !by });
            s = recordSectorWarBattleOutcome(out, { battleId: id, attackerWon, by, at: NOW + 1 }).session;
        }
        // Receipts are stored newest-first, so the dedupe keeps the LATEST casing
        // ('aria', not 'Aria') — harmless, since safeName canonicalizes real names.
        assert.deepEqual(captureContributors(s).sort(), ['Bo', 'aria']);
        assert.deepEqual(captureContributors({ appliedBattles: undefined }), []);
    });
});

describe('sector-war: client projection', () => {
    it('strips the receipt ledger and nothing else', async () => {
        const { projectSectorWarForClient } = await import('./_sector-war.js');
        const out = applySectorWarBattle(fresh(), true, { now: NOW + 1, roleSwing: 15, by: 'aria' });
        const recorded = recordSectorWarBattleOutcome(out, { battleId: 'b1', attackerWon: true, by: 'aria', at: NOW + 1 });
        const view = projectSectorWarForClient(recorded.session);
        assert.equal((view as Record<string, unknown>).appliedBattles, undefined, 'receipts are server bookkeeping');
        // Every OTHER field survives — the client renders score, clock, and garrison state from these.
        const { appliedBattles: _receipts, ...expected } = recorded.session;
        assert.deepEqual(view, expected);
    });
});

describe('sector-war: lock scopes + battle token', () => {
    it('the declare lock is SECTOR-scoped so rival attackers serialise', () => {
        const a = sectorWarKey(sectorWarId(26, 'Moonshadow Village', 'Frostfang Village'));
        const b = sectorWarKey(sectorWarId(26, 'Stormveil Village', 'Frostfang Village'));
        assert.notEqual(a, b, 'contest keys differ per attacker — the original race');
        assert.equal(sectorDeclareLockKey(26), sectorDeclareLockKey(26));
        assert.notEqual(sectorDeclareLockKey(26), sectorDeclareLockKey(27));
        assert.notEqual(sectorDeclareLockKey(26), sectorWarKey(sectorWarId(26, 'A Village', 'B Village')));
    });

    it('mints and normalizes a battle token', () => {
        const t = newSectorWarBattleToken({
            battleId: 'b1', sectorWarId: 'sw', sector: 8,
            attackerVillage: 'A Village', defenderVillage: 'B Village',
            registeredBy: 'aria', winCondition: 'combat',
            p1Name: 'aria', p2Name: 'kell', p1Village: 'A Village', p2Village: 'B Village',
            now: NOW,
        });
        assert.equal(sectorWarTokenKey('b1'), 'shared:sector-war-token:b1');
        const n = normalizeSectorWarBattleToken(JSON.parse(JSON.stringify(t)));
        assert.equal(n?.p2Name, 'kell');
        assert.equal(normalizeSectorWarBattleToken({} as never), null);
    });
});

describe('sector-war: canDeclareSectorWar', () => {
    const base = {
        attackerVillage: 'Moonshadow Village',
        defenderVillage: 'Frostfang Village',
        sector: 27,
        sectorOwnerVillage: 'Frostfang Village',
        winCondition: 'combat' as const,
        attackerInActiveVillageWar: false,
        defenderInActiveVillageWar: false,
        contestAlreadyActive: false,
        attackerWr: 5000,
        attackerSectorsHeld: 8,
        allowedWinConditions: ['combat', 'card', 'pet'] as const,
    };

    it('allows a well-formed declaration at the full price', () => {
        const r = canDeclareSectorWar(base);
        assert.equal(r.ok, true);
        assert.equal((r as { cost: number }).cost, 250);
    });

    it('is free at 0 sectors held (comeback discount)', () => {
        const r = canDeclareSectorWar({ ...base, attackerSectorsHeld: 0, attackerWr: 0 });
        assert.equal(r.ok, true);
        assert.equal((r as { cost: number }).cost, 0);
    });

    it('rejects the structural invalids', () => {
        assert.equal((canDeclareSectorWar({ ...base, defenderVillage: base.attackerVillage, sectorOwnerVillage: base.attackerVillage }) as { error: string }).error, 'self');
        assert.equal((canDeclareSectorWar({ ...base, sector: 60 }) as { error: string }).error, 'not-war-sector');
        assert.equal((canDeclareSectorWar({ ...base, sector: 26 }) as { error: string }).error, 'protected-core');
        assert.equal((canDeclareSectorWar({ ...base, sectorOwnerVillage: 'Moonshadow Village' }) as { error: string }).error, 'not-enemy-held');
        assert.equal((canDeclareSectorWar({ ...base, attackerInActiveVillageWar: true }) as { error: string }).error, 'mutual-exclusion-attacker');
        assert.equal((canDeclareSectorWar({ ...base, defenderInActiveVillageWar: true }) as { error: string }).error, 'mutual-exclusion-defender');
        assert.equal((canDeclareSectorWar({ ...base, contestAlreadyActive: true }) as { error: string }).error, 'already-contested');
        assert.equal((canDeclareSectorWar({ ...base, winCondition: 'pet', allowedWinConditions: ['combat'] }) as { error: string }).error, 'win-condition-unavailable');
        assert.equal((canDeclareSectorWar({ ...base, attackerWr: 0 }) as { error: string }).error, 'insufficient-wr');
    });

    it('lets a home village reclaim its gate from legacy captured state', () => {
        const reclaim = canDeclareSectorWar({
            ...base,
            attackerVillage: 'Frostfang Village',
            defenderVillage: 'Moonshadow Village',
            sector: 26,
            sectorOwnerVillage: 'Moonshadow Village',
        });
        assert.equal(reclaim.ok, true);
    });

    it('caps a village at MAX_ACTIVE_ATTACK_SIEGES fronts', () => {
        assert.equal(canDeclareSectorWar({ ...base, attackerActiveSieges: MAX_ACTIVE_ATTACK_SIEGES - 1 }).ok, true);
        const r = canDeclareSectorWar({ ...base, attackerActiveSieges: MAX_ACTIVE_ATTACK_SIEGES });
        assert.equal((r as { error: string }).error, 'siege-limit');
        // The overnight-conquest hole stays closed: 8 fronts can never open at once.
        let open = 0;
        for (let i = 0; i < 8; i++) if (canDeclareSectorWar({ ...base, attackerActiveSieges: open }).ok) open++;
        assert.equal(open, MAX_ACTIVE_ATTACK_SIEGES);
    });

    it('a FAILED war puts that sector on re-siege cooldown for this attacker', () => {
        const r = canDeclareSectorWar({ ...base, priorFailedSiegeActive: true });
        assert.equal((r as { error: string }).error, 'siege-cooldown');
        assert.equal(SECTOR_RESIEGE_COOLDOWN_SEC, 24 * 60 * 60, 'the terminal-record TTL is the clock');
    });
});
