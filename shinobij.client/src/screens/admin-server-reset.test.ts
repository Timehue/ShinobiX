/*
 * The reset's confirmation is the last thing standing between the admin and an
 * irreversible wipe, so the property that matters is: nothing is destroyed
 * until a dry run has succeeded AND the admin has said yes to numbers that came
 * from that dry run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatResetNamespaces, resetConfirmMessage, runServerReset, type ResetPreview } from "./admin-server-reset.js";

type Call = { dryRun: boolean };

function harness(responses: Array<{ ok: boolean; status?: number; body: unknown }>) {
    const calls: Call[] = [];
    const messages: string[] = [];
    let confirmedWith: string | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { dryRun?: boolean };
        calls.push({ dryRun: body.dryRun === true });
        const next = responses.shift();
        if (!next) throw new Error("unexpected extra fetch");
        return { ok: next.ok, status: next.status ?? (next.ok ? 200 : 500), json: async () => next.body } as Response;
    }) as typeof globalThis.fetch;
    return {
        calls,
        messages,
        get confirmedWith() { return confirmedWith; },
        restore() { globalThis.fetch = originalFetch; },
        deps: (confirmAnswer: boolean) => ({
            adminPw: "pw",
            setMessage: (m: string) => { messages.push(m); },
            onPlayersCleared: () => {},
            confirm: async (message: string) => { confirmedWith = message; return confirmAnswer; },
        }),
    };
}

const PREVIEW: ResetPreview = {
    ok: true,
    totalKeys: 10369,
    deletedCount: 1161,
    preservedCount: 9208,
    wouldDeleteByNamespace: { receipt: 449, save: 127, auth: 125 },
    wouldPreserveByNamespace: { "save-snapshot": 6329, shared: 1360 },
};

test("a failed preview destroys nothing and never asks for confirmation", async () => {
    const h = harness([{ ok: false, status: 500, body: { error: "boom" } }]);
    try {
        await runServerReset(h.deps(true));
    } finally { h.restore(); }
    assert.deepEqual(h.calls, [{ dryRun: true }], "only the dry run may be sent");
    assert.equal(h.confirmedWith, null, "must not confirm against numbers it never got");
    assert.match(h.messages.at(-1) ?? "", /nothing was deleted/);
});

test("declining the confirmation destroys nothing", async () => {
    const h = harness([{ ok: true, body: PREVIEW }]);
    try {
        await runServerReset(h.deps(false));
    } finally { h.restore(); }
    assert.deepEqual(h.calls, [{ dryRun: true }], "the real reset must not be sent");
});

test("confirming sends exactly one real reset after the dry run", async () => {
    const h = harness([
        { ok: true, body: PREVIEW },
        { ok: true, body: { ...PREVIEW, sessionsRevoked: 125 } },
    ]);
    try {
        await runServerReset(h.deps(true));
    } finally { h.restore(); }
    assert.deepEqual(h.calls, [{ dryRun: true }, { dryRun: false }]);
    assert.match(h.messages.at(-1) ?? "", /1161 records wiped, 9208 kept, 125 sessions revoked/);
    assert.match(h.messages.at(-1) ?? "", /start a new Ranked Season/);
});

test("the confirmation quotes the dry run's real counts", () => {
    const message = resetConfirmMessage(PREVIEW);
    assert.match(message, /1161 of 10369 stored records will be DELETED/);
    assert.match(message, /9208 will be KEPT/);
    assert.match(message, /receipt — 449/);
    assert.match(message, /save-snapshot — 6329/);
    assert.match(message, /CANNOT be undone/);
});

test("namespace formatting ranks by size and caps the list", () => {
    const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`ns${i}`, i]));
    const formatted = formatResetNamespaces(many);
    assert.equal(formatted.split("\n").length, 9, "8 rows plus an overflow line");
    assert.match(formatted, /ns11 — 11/);
    assert.match(formatted, /…and 4 more groups/);
    assert.equal(formatResetNamespaces(undefined), "  (none)");
    assert.equal(formatResetNamespaces({}), "  (none)");
});
