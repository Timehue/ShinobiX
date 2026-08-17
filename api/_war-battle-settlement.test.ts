import assert from "node:assert/strict";
import test from "node:test";
import { _makeMemoryKv } from "./_storage.js";
import {
    commitWarBattleSettlement,
    projectPvpVillageWarSettlement,
    type PvpVillageWarSettlementRow,
} from "./_war-battle-settlement.js";

test("a holder paused past its lease cannot erase a successor settlement", async () => {
    const store = _makeMemoryKv();
    const key = "war:moon-vs-frost";
    const initial = { hp: 5000, pvpBattleReceipts: {} as Record<string, string> };
    await store.set(key, initial);

    // Both handlers derived their candidates from the same pre-lease row. The
    // successor publishes while the first holder is paused.
    const successor = {
        hp: 4995,
        pvpBattleReceipts: { battleB: "kell" },
    };
    const stale = {
        hp: 4990,
        pvpBattleReceipts: { battleA: "aria" },
    };
    assert.equal((await commitWarBattleSettlement(store, key, initial, successor)).status, "committed");
    const staleResult = await commitWarBattleSettlement(store, key, initial, stale);
    assert.equal(staleResult.status, "conflict");
    assert.deepEqual(await store.get(key), successor);
});

test("lost CAS acknowledgement is recovered only by exact canonical readback", async () => {
    const base = _makeMemoryKv();
    const key = "war:lost-ack";
    const initial = { hp: 5000, pvpBattleReceipts: {} as Record<string, string> };
    await base.set(key, initial);
    const desired = { hp: 4995, optional: undefined, pvpBattleReceipts: { battleA: "aria" } };
    const store = {
        get: base.get.bind(base),
        async compareSet(candidate: string, expected: unknown, next: unknown) {
            assert.equal(await base.compareSet(candidate, expected, next), true);
            return false;
        },
    };
    const result = await commitWarBattleSettlement(store, key, initial, desired);
    assert.equal(result.status, "committed");
    assert.deepEqual(result.row, { hp: 4995, pvpBattleReceipts: { battleA: "aria" } });
});

function liveWar(overrides: Partial<PvpVillageWarSettlementRow> = {}): PvpVillageWarSettlementRow {
    return {
        id: "moon-vs-frost",
        villages: ["Moon", "Frost"],
        hp: { Moon: 5000, Frost: 5000 },
        warGroundSector: 40,
        warGroundHp: 1000,
        startedAt: 1_000,
        updatedAt: 1_000,
        ...overrides,
    };
}

test("reordered battle retries subtract from the fresh row and never heal", () => {
    const a = projectPvpVillageWarSettlement(liveWar(), {
        actorName: "aria",
        actorDisplayName: "Aria",
        actorVillage: "Moon",
        loserVillage: "Frost",
        pvpDamage: 30,
        raidDamage: 0,
        captureAuthorized: false,
        terminalAt: 2_000,
        settlementAt: 3_000,
    });
    const b = projectPvpVillageWarSettlement(a.row, {
        actorName: "boris",
        actorDisplayName: "Boris",
        actorVillage: "Moon",
        loserVillage: "Frost",
        pvpDamage: 20,
        raidDamage: 0,
        captureAuthorized: false,
        terminalAt: 2_100,
        settlementAt: 3_100,
    });
    assert.equal(a.row.hp.Frost, 4970);
    assert.equal(b.row.hp.Frost, 4950);

    // Terminal chronology is eligibility evidence, not ordering authority. A
    // distinct older terminal arriving later applies to the current live row.
    const retriedA = projectPvpVillageWarSettlement(b.row, {
        actorName: "aria",
        actorDisplayName: "Aria",
        actorVillage: "Moon",
        loserVillage: "Frost",
        pvpDamage: 30,
        raidDamage: 0,
        captureAuthorized: false,
        terminalAt: 2_000,
        settlementAt: 3_200,
    });
    assert.equal(retriedA.row.hp.Frost, 4920);
});

test("an overtaken battle projects a receipt-only no-op onto an ended war", () => {
    const ended = liveWar({ hp: { Moon: 4900, Frost: 0 }, endedAt: 4_000, winnerVillage: "Moon" });
    const result = projectPvpVillageWarSettlement(ended, {
        actorName: "aria",
        actorDisplayName: "Aria",
        actorVillage: "Moon",
        loserVillage: "Frost",
        pvpDamage: 30,
        raidDamage: 30,
        captureAuthorized: true,
        terminalAt: 3_900,
        settlementAt: 4_100,
    });
    assert.deepEqual(result.row.hp, ended.hp);
    assert.equal(result.row.winnerVillage, "Moon");
    assert.equal(result.row.endedAt, 4_000);
    assert.equal(result.enemyDamage, 0);
    assert.equal(result.groundDamage, 0);
});

test("raid and PvP effects are combined deterministically in one candidate", () => {
    const result = projectPvpVillageWarSettlement(liveWar({ warGroundHp: 20 }), {
        actorName: "aria",
        actorDisplayName: "Aria",
        actorVillage: "Moon",
        loserVillage: "Frost",
        pvpDamage: 30,
        raidDamage: 20,
        captureAuthorized: true,
        terminalAt: 2_000,
        settlementAt: 3_000,
    });
    assert.equal(result.row.hp.Frost, 4850, "30 PvP + 20 raid + 100 capture");
    assert.equal(result.row.warGroundHp, 500);
    assert.equal(result.row.capturedBy, "Moon");
    assert.equal(result.captured, true);
});

test("a later-arriving older terminal still applies in exact-CAS order", () => {
    const current = liveWar({
        hp: { Moon: 5000, Frost: 10 },
        updatedAt: 2_100,
        lastPvpBattleEndedAt: 2_100,
    });
    const result = projectPvpVillageWarSettlement(current, {
        actorName: "aria",
        actorDisplayName: "Aria",
        actorVillage: "Moon",
        loserVillage: "Frost",
        pvpDamage: 30,
        raidDamage: 0,
        captureAuthorized: false,
        terminalAt: 2_000,
        settlementAt: 2_200,
    });
    assert.equal(result.row.endedAt, 2_200);
    assert.equal(result.row.updatedAt, 2_200);
    assert.equal(result.row.hp.Frost, 0);
    assert.equal(result.enemyDamage, 10);
});

test("the ending blow uses its server settlement clock, not row or terminal chronology", () => {
    const result = projectPvpVillageWarSettlement(liveWar({
        hp: { Moon: 5000, Frost: 10 },
        updatedAt: 9_000,
    }), {
        actorName: "aria",
        actorDisplayName: "Aria",
        actorVillage: "Moon",
        loserVillage: "Frost",
        pvpDamage: 30,
        raidDamage: 0,
        captureAuthorized: false,
        terminalAt: 2_000,
        settlementAt: 10_000,
    });
    assert.equal(result.row.endedAt, 10_000);
    assert.equal(result.row.updatedAt, 10_000);
});

test("a transferred fighter cannot reattribute prior contribution to the other side", () => {
    const current = liveWar({
        contributions: {
            aria: { damage: 90, raids: 1, pvpKills: 2, side: "Moon", name: "Aria" },
        },
    });
    const result = projectPvpVillageWarSettlement(current, {
        actorName: "aria",
        actorDisplayName: "Aria",
        actorVillage: "Frost",
        loserVillage: "Moon",
        pvpDamage: 30,
        raidDamage: 0,
        captureAuthorized: false,
        terminalAt: 2_000,
        settlementAt: 3_000,
    });
    assert.equal(result.row.hp.Moon, 4970);
    assert.deepEqual(result.row.contributions?.aria, current.contributions?.aria);
});

test("a rematch ending blow stamps generation-unique reward ids", () => {
    const result = projectPvpVillageWarSettlement(liveWar({
        declarationGeneration: 2,
        hp: { Moon: 5_000, Frost: 5 },
    }), {
        actorName: "aria",
        actorDisplayName: "Aria",
        actorVillage: "Moon",
        loserVillage: "Frost",
        pvpDamage: 5,
        raidDamage: 0,
        captureAuthorized: false,
        terminalAt: 2_000,
        settlementAt: 3_000,
    });
    assert.equal(result.ended, true);
    assert.equal(result.row.warCrateId, "war-crate-moon-vs-frost-g2");
    assert.equal(result.row.loserCrateId, "loser-crate-moon-vs-frost-g2");
});
