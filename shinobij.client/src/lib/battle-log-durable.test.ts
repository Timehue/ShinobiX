import test from "node:test";
import { strict as assert } from "node:assert";
import {
    actionCategory,
    actionLabel,
    isBattleHistorySummary,
    isDurableActionReceipt,
    BASIC_CATEGORIES,
    type DurableActionReceipt,
} from "../types/battle-log";
import { mergeOlderEntries } from "./pvp-combat-log-api";
import { mergeBattleHistory, legacyBattleId } from "./battle-history-merge";
import { groupEntriesByRound, defaultOpenRounds } from "../components/DurableBattleRoundLog";
import type { BattleHistoryEntry } from "../types/character";
import type { BattleHistorySummary } from "../types/battle-log";

// Durable receipts are read back over 90 days, so most of these guard the shapes
// that ALREADY exist in storage — a renderer that assumes today's fields will
// crash on a battle fought before they were added.

function receipt(over: Partial<DurableActionReceipt> = {}): DurableActionReceipt {
    return {
        battleId: "b1",
        seq: 1,
        round: 1,
        actorRole: "p1",
        actorName: "Alice",
        targetRole: "p2",
        targetName: "Bob",
        actionId: "fireball",
        actionName: "Fireball",
        actionType: "jutsu",
        result: "applied",
        summaryLines: ["Alice uses Fireball!", "Bob takes 100 damage."],
        actorDelta: {},
        targetDelta: { hp: -100 },
        createdAt: 1,
        ...over,
    };
}

// ─── labels ───────────────────────────────────────────────────────────────────

test("actionLabel prefers the server display label", () => {
    const r = receipt({ display: { label: "Blazing Dragon Arc", category: "jutsu" } });
    assert.equal(actionLabel(r), "Blazing Dragon Arc");
});

test("actionLabel falls back to actionName on a legacy receipt", () => {
    assert.equal(actionLabel(receipt({ display: undefined })), "Fireball");
});

test("actionLabel never surfaces a raw id as the primary label", () => {
    // The pre-fix bug: a jutsu stored its ID in BOTH actionId and actionName.
    const r = receipt({ actionId: "starter-nin-fire-2", actionName: "starter-nin-fire-2", display: undefined });
    const label = actionLabel(r);
    assert.notEqual(label, "starter-nin-fire-2");
    assert.equal(label, "Jutsu");
});

test("actionCategory infers a category when display is absent", () => {
    assert.equal(actionCategory(receipt({ actionType: "move", display: undefined })), "movement");
    assert.equal(actionCategory(receipt({ actionType: "basicAttack", display: undefined })), "basic");
    assert.equal(actionCategory(receipt({ actionType: "weapon", display: undefined })), "weapon");
    assert.equal(actionCategory(receipt({ actionType: "totally-unknown", display: undefined })), "system");
});

test("a receipt with no optional metadata still resolves label and category", () => {
    const bare = receipt({ display: undefined, apSpent: undefined, winner: undefined });
    assert.doesNotThrow(() => { actionLabel(bare); actionCategory(bare); });
});

// ─── filtering ────────────────────────────────────────────────────────────────

test("hide-basic drops turn/movement/basic beats and keeps jutsu", () => {
    const entries = [
        receipt({ seq: 1, actionType: "jutsu" }),
        receipt({ seq: 2, actionType: "move", display: undefined }),
        receipt({ seq: 3, actionType: "wait", display: undefined }),
        receipt({ seq: 4, actionType: "weapon", display: undefined }),
    ];
    const kept = entries.filter((e) => !BASIC_CATEGORIES.has(actionCategory(e)));
    assert.deepEqual(kept.map((e) => e.seq), [1, 4]);
});

test("actor filter splits by the viewer's own role", () => {
    const entries = [
        receipt({ seq: 1, actorRole: "p1" }),
        receipt({ seq: 2, actorRole: "p2" }),
        receipt({ seq: 3, actorRole: "p1" }),
    ];
    const myRole: "p1" | "p2" = "p2";
    const mine = entries.filter((e) => e.actorRole === myRole);
    const theirs = entries.filter((e) => e.actorRole !== myRole);
    assert.deepEqual(mine.map((e) => e.seq), [2]);
    assert.deepEqual(theirs.map((e) => e.seq), [1, 3]);
});

// ─── ordering + pagination ────────────────────────────────────────────────────

test("timeline entries render oldest-first by seq", () => {
    const entries = [receipt({ seq: 3 }), receipt({ seq: 1 }), receipt({ seq: 2 })];
    const ordered = [...entries].sort((a, b) => a.seq - b.seq);
    assert.deepEqual(ordered.map((e) => e.seq), [1, 2, 3]);
});

test("mergeOlderEntries prepends without duplicating the boundary action", () => {
    const current = [receipt({ seq: 5 }), receipt({ seq: 6 })];
    // Pagination overlaps by design — seq 5 comes back in both pages.
    const older = [receipt({ seq: 3 }), receipt({ seq: 4 }), receipt({ seq: 5 })];
    const merged = mergeOlderEntries(current, older);
    assert.deepEqual(merged.map((e) => e.seq), [3, 4, 5, 6]);
});

// ─── round grouping ───────────────────────────────────────────────────────────

test("groupEntriesByRound groups and sorts ascending", () => {
    const groups = groupEntriesByRound([
        receipt({ seq: 4, round: 2 }),
        receipt({ seq: 1, round: 1 }),
        receipt({ seq: 3, round: 2 }),
        receipt({ seq: 2, round: 1 }),
    ]);
    assert.deepEqual(groups.map((g) => g.round), [1, 2]);
    assert.deepEqual(groups[0].entries.map((e) => e.seq), [1, 2]);
    assert.deepEqual(groups[1].entries.map((e) => e.seq), [3, 4]);
});

test("the latest two rounds open by default", () => {
    const groups = groupEntriesByRound([1, 2, 3, 4].map((r) => receipt({ seq: r, round: r })));
    const open = defaultOpenRounds(groups);
    assert.ok(open.has(4) && open.has(3), "latest two open");
    assert.ok(!open.has(2) && !open.has(1), "older rounds collapsed");
});

test("a single-round battle opens that round", () => {
    const open = defaultOpenRounds(groupEntriesByRound([receipt({ round: 1 })]));
    assert.deepEqual([...open], [1]);
});

// ─── history merge (server vs legacy save) ────────────────────────────────────

function summary(over: Partial<BattleHistorySummary> = {}): BattleHistorySummary {
    return {
        battleId: "b1", opponent: "Bob", startedAt: 1, endedAt: 100, rounds: 3,
        mode: "PvP", ranked: false, outcome: "win", winner: "p1", ...over,
    };
}
function legacy(over: Partial<BattleHistoryEntry> = {}): BattleHistoryEntry {
    return {
        id: "local-1", ts: 50, self: "Alice", opponent: "Bob", outcome: "win",
        mode: "PvE", rounds: 3, actions: [],
        ...over,
    } as BattleHistoryEntry;
}

test("server record WINS over an equivalent client-save record", () => {
    const rows = mergeBattleHistory(
        [summary({ battleId: "shared" })],
        [legacy({ id: "local-1", battleId: "shared" } as Partial<BattleHistoryEntry>)],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "server");
});

test("legacy PvE rows without a battleId are always preserved", () => {
    const rows = mergeBattleHistory([summary({ battleId: "b1" })], [legacy({ id: "pve-1" })]);
    assert.equal(rows.length, 2);
    assert.ok(rows.some((r) => r.kind === "legacy"));
});

test("merged history is newest-first across both sources", () => {
    const rows = mergeBattleHistory(
        [summary({ battleId: "old", endedAt: 10 })],
        [legacy({ id: "recent", ts: 999 })],
    );
    assert.equal(rows[0].ts, 999);
});

test("duplicate server rows collapse", () => {
    const rows = mergeBattleHistory([summary({ battleId: "x" }), summary({ battleId: "x" })], []);
    assert.equal(rows.length, 1);
});

test("legacyBattleId only reports a real battleId", () => {
    assert.equal(legacyBattleId(legacy({ id: "pve-1" })), null);
    assert.equal(legacyBattleId(legacy({ battleId: "b9" } as Partial<BattleHistoryEntry>)), "b9");
});

// ─── response narrowing ───────────────────────────────────────────────────────

test("malformed rows are rejected rather than rendered", () => {
    assert.equal(isBattleHistorySummary(null), false);
    assert.equal(isBattleHistorySummary({ battleId: "" }), false);
    assert.equal(isBattleHistorySummary({ battleId: "b", opponent: "x", outcome: "nope" }), false);
    assert.equal(isBattleHistorySummary(summary()), true);

    assert.equal(isDurableActionReceipt(null), false);
    assert.equal(isDurableActionReceipt({ seq: 1 }), false);
    assert.equal(isDurableActionReceipt(receipt()), true);
});
