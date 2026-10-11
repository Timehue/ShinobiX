import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeCurrencyLedgerEvidence } from "./currency-ledger-evidence";

const days = (counts: number[]) => counts.map((count, i) => ({ date: `2026-10-0${i + 1}`, count }));

test("blocking events lead, and only they count toward the fail-closed gate", () => {
    const summary = summarizeCurrencyLedgerEvidence({
        "ledger-created": days([40, 12, 0]),
        "ledger-divergent": days([0, 0, 1]),
        "raw-save-write": days([2, 0, 0]),
        "autosave-decrease": days([0, 3, 0]),
    });
    assert.deepEqual(summary.days, ["2026-10-01", "2026-10-02", "2026-10-03"]);
    assert.equal(summary.blockers, 3, "1 divergent + 2 raw writes; creations never block");
    assert.deepEqual(summary.rows.map((row) => [row.event, row.blocksFailClosed, row.total, row.today]), [
        ["raw-save-write", true, 2, 0],
        ["ledger-divergent", true, 1, 1],
        ["ledger-created", false, 52, 0],
        ["autosave-decrease", false, 3, 0],
    ]);
    assert.match(summary.rows[1].label, /same save version/);
});

test("a clean window has zero blockers", () => {
    const summary = summarizeCurrencyLedgerEvidence({
        "ledger-divergent": days([0, 0]),
        "raw-save-write": days([0, 0]),
        "ledger-upgraded": days([5, 1]),
    });
    assert.equal(summary.blockers, 0);
});

test("an older server or a malformed payload shows nothing rather than throwing", () => {
    for (const raw of [undefined, null, [], "x", 7]) {
        assert.deepEqual(summarizeCurrencyLedgerEvidence(raw), { rows: [], days: [], blockers: 0 });
    }
    const odd = summarizeCurrencyLedgerEvidence({
        "ledger-divergent": [{ date: "2026-10-01", count: "2" }, { count: 9 }, null, { date: "2026-10-02", count: -4 }],
        "unknown-event": "nope",
        "brand-new-event": days([1]),
    });
    assert.deepEqual(odd.rows.map((row) => [row.event, row.total, row.label]), [
        ["ledger-divergent", 2, "Divergent rows (same save version, different balances)"],
        ["brand-new-event", 1, "brand-new-event"],
    ]);
    assert.equal(odd.blockers, 2);
});
