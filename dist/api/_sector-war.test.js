"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _sector_war_js_1 = require("./_sector-war.js");
const _war_state_js_1 = require("./_war-state.js");
const NOW = Date.UTC(2026, 5, 29, 4, 0, 0);
function fresh(winCondition = 'combat') {
    return (0, _sector_war_js_1.newSectorWarSession)({
        sector: 8, attackerVillage: 'Moonshadow Village', defenderVillage: 'Frostfang Village',
        winCondition, now: NOW,
    });
}
(0, node_test_1.describe)('sector-war: id + session shape', () => {
    (0, node_test_1.it)('builds a stable, slugged id', () => {
        node_assert_1.strict.equal((0, _sector_war_js_1.sectorWarId)(8, 'Moonshadow Village', 'Frostfang Village'), '8:moonshadowvillage-vs-frostfangvillage');
    });
    (0, node_test_1.it)('a fresh session starts at full Control HP', () => {
        const s = fresh();
        node_assert_1.strict.equal(s.controlHp, _war_state_js_1.SECTOR_CONTROL_HP_MAX);
        node_assert_1.strict.equal(s.controlHpMax, _war_state_js_1.SECTOR_CONTROL_HP_MAX);
        node_assert_1.strict.equal(s.flipped, false);
        node_assert_1.strict.equal(s.sector, 8);
    });
    (0, node_test_1.it)('honors a Watchtower-boosted Control HP cap', () => {
        const s = (0, _sector_war_js_1.newSectorWarSession)({ sector: 8, attackerVillage: 'A Village', defenderVillage: 'B Village', winCondition: 'card', now: NOW, controlHpMax: 690 });
        node_assert_1.strict.equal(s.controlHpMax, 690);
        node_assert_1.strict.equal(s.controlHp, 690);
    });
});
(0, node_test_1.describe)('sector-war: normalize', () => {
    (0, node_test_1.it)('clamps Control HP into [0, max] and validates the win-condition', () => {
        const s = (0, _sector_war_js_1.normalizeSectorWarSession)({ sector: 8, attackerVillage: 'A', defenderVillage: 'B', winCondition: 'hax', controlHp: 99999, controlHpMax: 600 });
        node_assert_1.strict.ok(s);
        node_assert_1.strict.equal(s.controlHp, 600);
        node_assert_1.strict.equal(s.winCondition, 'combat');
    });
    (0, node_test_1.it)('rejects a malformed / self-targeting session', () => {
        node_assert_1.strict.equal((0, _sector_war_js_1.normalizeSectorWarSession)(null), null);
        node_assert_1.strict.equal((0, _sector_war_js_1.normalizeSectorWarSession)({ attackerVillage: 'A', defenderVillage: 'A' }), null);
        node_assert_1.strict.equal((0, _sector_war_js_1.normalizeSectorWarSession)({ attackerVillage: 'A' }), null);
    });
});
(0, node_test_1.describe)('sector-war: applySectorBattleResult', () => {
    (0, node_test_1.it)('an attacker win chips Control HP by the role-scaled swing', () => {
        const out = (0, _sector_war_js_1.applySectorBattleResult)(fresh(), true, { now: NOW, swing: 55 });
        node_assert_1.strict.equal(out.hpDealt, 55);
        node_assert_1.strict.equal(out.session.controlHp, _war_state_js_1.SECTOR_CONTROL_HP_MAX - 55);
        node_assert_1.strict.equal(out.captured, false);
    });
    (0, node_test_1.it)('flips the sector when Control HP drains to 0', () => {
        let s = fresh();
        let captured = false;
        // swing 500 → 4 wins drain a full 2000 pool to 0.
        for (let i = 0; i < 4; i++) {
            const out = (0, _sector_war_js_1.applySectorBattleResult)(s, true, { now: NOW, swing: 500 });
            s = out.session;
            captured = out.captured;
        }
        node_assert_1.strict.equal(s.controlHp, 0);
        node_assert_1.strict.equal(s.flipped, true);
        node_assert_1.strict.equal(captured, true); // flipped on the 4th
    });
    (0, node_test_1.it)('a defender win HEALS half the swing (capped at max)', () => {
        // chip 200, then a defender win with swing 80 heals floor(80 * 0.5) = 40.
        const chipped = (0, _sector_war_js_1.applySectorBattleResult)(fresh(), true, { now: NOW, swing: 200 }).session;
        const d1 = (0, _sector_war_js_1.applySectorBattleResult)(chipped, false, { now: NOW, swing: 80 });
        node_assert_1.strict.equal(d1.hpRegen, 40);
        node_assert_1.strict.equal(d1.session.controlHp, _war_state_js_1.SECTOR_CONTROL_HP_MAX - 200 + 40);
        // From full, a defender win cannot exceed the cap.
        const atMax = (0, _sector_war_js_1.applySectorBattleResult)(fresh(), false, { now: NOW, swing: 80 });
        node_assert_1.strict.equal(atMax.session.controlHp, _war_state_js_1.SECTOR_CONTROL_HP_MAX);
        node_assert_1.strict.equal(atMax.hpRegen, 0);
    });
    (0, node_test_1.it)('a player repelling a MERCENARY heals only the merc fraction of the swing', () => {
        const chipped = (0, _sector_war_js_1.applySectorBattleResult)(fresh(), true, { now: NOW, swing: 300 }).session;
        const merc = (0, _sector_war_js_1.applySectorBattleResult)(chipped, false, { now: NOW, swing: 80, mercBattle: true });
        node_assert_1.strict.equal(merc.hpRegen, Math.floor(80 * _sector_war_js_1.MERC_DEFENDER_REGEN_FRACTION)); // 20
        const normal = (0, _sector_war_js_1.applySectorBattleResult)(chipped, false, { now: NOW, swing: 80 });
        node_assert_1.strict.equal(normal.hpRegen, Math.floor(80 * 0.5)); // 40 — a real player win heals more
    });
    (0, node_test_1.it)('an already-flipped session is inert', () => {
        const flipped = { ...fresh(), controlHp: 0, flipped: true };
        const out = (0, _sector_war_js_1.applySectorBattleResult)(flipped, true, { now: NOW + 1000, swing: 100 });
        node_assert_1.strict.equal(out.captured, false);
        node_assert_1.strict.equal(out.hpDealt, 0);
        node_assert_1.strict.equal(out.session, flipped); // unchanged reference
    });
});
(0, node_test_1.describe)('sector-war: storage keys + single-use battle token', () => {
    (0, node_test_1.it)('keys the contest + token records under shared:', () => {
        node_assert_1.strict.equal((0, _sector_war_js_1.sectorWarKey)('8:a-vs-b'), 'shared:sector-war:8:a-vs-b');
        node_assert_1.strict.equal((0, _sector_war_js_1.sectorWarTokenKey)('battle-123'), 'shared:sector-war-token:battle-123');
    });
    (0, node_test_1.it)('mints + round-trips a battle token', () => {
        const t = (0, _sector_war_js_1.newSectorWarBattleToken)({
            battleId: 'b1', sectorWarId: '8:moonshadowvillage-vs-frostfangvillage',
            sector: 8, attackerVillage: 'Moonshadow Village', defenderVillage: 'Frostfang Village',
            registeredBy: 'alice', winCondition: 'combat', now: NOW,
        });
        node_assert_1.strict.equal(t.expiresAt, NOW + 60 * 60 * 1000);
        node_assert_1.strict.deepEqual((0, _sector_war_js_1.normalizeSectorWarBattleToken)(JSON.parse(JSON.stringify(t))), t);
    });
    (0, node_test_1.it)('rejects a malformed / self-targeting token', () => {
        node_assert_1.strict.equal((0, _sector_war_js_1.normalizeSectorWarBattleToken)(null), null);
        node_assert_1.strict.equal((0, _sector_war_js_1.normalizeSectorWarBattleToken)({ battleId: 'b', sectorWarId: 's', attackerVillage: 'A', defenderVillage: 'A' }), null);
        node_assert_1.strict.equal((0, _sector_war_js_1.normalizeSectorWarBattleToken)({ sectorWarId: 's', attackerVillage: 'A', defenderVillage: 'B' }), null); // no battleId
    });
});
(0, node_test_1.describe)('sector-war: canDeclareSectorWar', () => {
    const base = {
        attackerVillage: 'Moonshadow Village',
        defenderVillage: 'Frostfang Village',
        sector: 47, // a Frostfang home sector
        sectorOwnerVillage: 'Frostfang Village',
        winCondition: 'combat',
        attackerInActiveVillageWar: false,
        defenderInActiveVillageWar: false,
        contestAlreadyActive: false,
        attackerWr: 1000,
        attackerSectorsHeld: 8,
    };
    (0, node_test_1.it)('allows a well-formed declaration and returns the discounted cost', () => {
        const r = (0, _sector_war_js_1.canDeclareSectorWar)(base);
        node_assert_1.strict.equal(r.ok, true);
        node_assert_1.strict.equal(r.cost, 250); // 8 sectors held → full price
    });
    (0, node_test_1.it)('is free at 0 sectors held (comeback discount)', () => {
        const r = (0, _sector_war_js_1.canDeclareSectorWar)({ ...base, attackerSectorsHeld: 0, attackerWr: 0 });
        node_assert_1.strict.equal(r.ok, true);
        node_assert_1.strict.equal(r.cost, 0);
    });
    (0, node_test_1.it)('rejects self / non-war village / non-war sector', () => {
        node_assert_1.strict.equal((0, _sector_war_js_1.canDeclareSectorWar)({ ...base, defenderVillage: 'Moonshadow Village' }).error, 'self');
        node_assert_1.strict.equal((0, _sector_war_js_1.canDeclareSectorWar)({ ...base, attackerVillage: 'Konoha' }).error, 'not-war-village');
        node_assert_1.strict.equal((0, _sector_war_js_1.canDeclareSectorWar)({ ...base, sector: 57 }).error, 'not-war-sector'); // central, not a war sector
    });
    (0, node_test_1.it)('requires the target sector to currently be held by the defender', () => {
        node_assert_1.strict.equal((0, _sector_war_js_1.canDeclareSectorWar)({ ...base, sectorOwnerVillage: 'Moonshadow Village' }).error, 'not-enemy-held');
    });
    (0, node_test_1.it)('enforces the village-war mutual exclusion on both sides', () => {
        node_assert_1.strict.equal((0, _sector_war_js_1.canDeclareSectorWar)({ ...base, attackerInActiveVillageWar: true }).error, 'mutual-exclusion-attacker');
        node_assert_1.strict.equal((0, _sector_war_js_1.canDeclareSectorWar)({ ...base, defenderInActiveVillageWar: true }).error, 'mutual-exclusion-defender');
    });
    (0, node_test_1.it)('blocks a second contest on an already-contested sector', () => {
        node_assert_1.strict.equal((0, _sector_war_js_1.canDeclareSectorWar)({ ...base, contestAlreadyActive: true }).error, 'already-contested');
    });
    (0, node_test_1.it)('blocks win-conditions not wired this build (card/pet until their phase), opt-in allows card', () => {
        node_assert_1.strict.equal((0, _sector_war_js_1.canDeclareSectorWar)({ ...base, winCondition: 'pet' }).error, 'win-condition-unavailable');
        node_assert_1.strict.equal((0, _sector_war_js_1.canDeclareSectorWar)({ ...base, winCondition: 'card' }).error, 'win-condition-unavailable');
        node_assert_1.strict.equal((0, _sector_war_js_1.canDeclareSectorWar)({ ...base, winCondition: 'card', allowedWinConditions: ['combat', 'card'] }).ok, true);
    });
    (0, node_test_1.it)('rejects an unaffordable declaration and surfaces the cost', () => {
        const r = (0, _sector_war_js_1.canDeclareSectorWar)({ ...base, attackerWr: 10 });
        node_assert_1.strict.equal(r.ok, false);
        node_assert_1.strict.equal(r.error, 'insufficient-wr');
        node_assert_1.strict.equal(r.cost, 250);
    });
});
(0, node_test_1.describe)('sector-war: applyContestBattleByWinner (Card by-side mapping)', () => {
    function fresh() {
        return (0, _sector_war_js_1.newSectorWarSession)({
            sector: 8, attackerVillage: 'Moonshadow Village', defenderVillage: 'Frostfang Village',
            winCondition: 'card', now: NOW,
        });
    }
    (0, node_test_1.it)('p1 (attacker) win chips Control HP by the swing', () => {
        const out = (0, _sector_war_js_1.applyContestBattleByWinner)(fresh(), 'p1', { now: NOW, swing: 55 });
        node_assert_1.strict.ok(out);
        node_assert_1.strict.equal(out.hpDealt, 55);
        node_assert_1.strict.equal(out.session.controlHp, _war_state_js_1.SECTOR_CONTROL_HP_MAX - 55);
    });
    (0, node_test_1.it)('p2 (defender) win heals half the swing (held line)', () => {
        const chipped = (0, _sector_war_js_1.applyContestBattleByWinner)(fresh(), 'p1', { now: NOW, swing: 200 }).session;
        const out = (0, _sector_war_js_1.applyContestBattleByWinner)(chipped, 'p2', { now: NOW, swing: 80 });
        node_assert_1.strict.ok(out);
        node_assert_1.strict.equal(out.hpRegen, 40); // floor(80 * 0.5)
        node_assert_1.strict.equal(out.session.controlHp, _war_state_js_1.SECTOR_CONTROL_HP_MAX - 200 + 40);
    });
    (0, node_test_1.it)('a draw leaves Control HP untouched (null outcome)', () => {
        node_assert_1.strict.equal((0, _sector_war_js_1.applyContestBattleByWinner)(fresh(), 'draw', { now: NOW, swing: 100 }), null);
    });
});
