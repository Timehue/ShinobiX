import assert from "node:assert/strict";
import test from "node:test";
import { clearPendingWarfrontReceipt, queueWarfrontReceipt, readPendingWarfrontReceipt, sendQueuedWarfrontReceipt } from "./warfront-pending-receipt";

test("navigation reuses one exact in-flight receipt and releases it after applying", async () => {
    const original = globalThis.fetch;
    const body = { playerName: "ReceiptQA", battleToken: "seal", reportKey: "23:tactical", warfrontPlan: { formation: [0, 1, 2, 3] } };
    const sent: unknown[] = [];
    let finish!: (response: Response) => void;
    globalThis.fetch = (async (_url, init) => { sent.push(JSON.parse(String(init?.body))); return new Promise<Response>((resolve) => { finish = resolve; }); }) as typeof fetch;
    try {
        assert.equal(queueWarfrontReceipt(body), true);
        body.warfrontPlan.formation.reverse();
        const saved = readPendingWarfrontReceipt("receiptqa")!;
        assert.deepEqual(saved.warfrontPlan.formation, [0, 1, 2, 3]);
        assert.equal(readPendingWarfrontReceipt("another-player"), null);
        assert.equal(queueWarfrontReceipt({ ...body, battleToken: "new-seal" }), false);
        const first = sendQueuedWarfrontReceipt(saved);
        const remounted = sendQueuedWarfrontReceipt(saved);
        assert.equal(sent.length, 1);
        finish(Response.json({ ok: true, character: { name: body.playerName } }));
        assert.deepEqual(await first, { ok: true, character: { name: body.playerName } });
        assert.deepEqual(await remounted, { ok: true, character: { name: body.playerName } });
        assert.deepEqual(await sendQueuedWarfrontReceipt(saved), { ok: true, character: { name: body.playerName } });
        assert.equal(sent.length, 1);
        clearPendingWarfrontReceipt({ ...body, battleToken: "wrong" });
        assert.ok(readPendingWarfrontReceipt(body.playerName));
        clearPendingWarfrontReceipt(saved);
        assert.equal(readPendingWarfrontReceipt(body.playerName), null);
    } finally { clearPendingWarfrontReceipt(body); globalThis.fetch = original; }
});

test("failed reports can be retried without changing the sealed command transcript", async () => {
    const original = globalThis.fetch;
    const body = { playerName: "RetryQA", battleToken: "retry-seal", reportKey: "24:tactical", warfrontPlan: { formation: [3, 1, 2, 0] } };
    const sent: string[] = [];
    globalThis.fetch = async (_url, init) => {
        sent.push(String(init?.body));
        return sent.length === 1 ? Response.json({ error: "Try again" }, { status: 503 }) : Response.json({ ok: true, character: { name: body.playerName } });
    };
    try {
        await assert.rejects(sendQueuedWarfrontReceipt(body), /Try again/);
        assert.ok(readPendingWarfrontReceipt(body.playerName));
        assert.deepEqual(await sendQueuedWarfrontReceipt(readPendingWarfrontReceipt(body.playerName)!), { ok: true, character: { name: body.playerName } });
        assert.deepEqual(sent, [JSON.stringify(body), JSON.stringify(body)]);
    } finally { clearPendingWarfrontReceipt(body); globalThis.fetch = original; }
});


test("invalid successful responses are not cached as completed receipts", async () => {
    const original = globalThis.fetch;
    const body = { playerName: "InvalidQA", battleToken: "invalid-seal", reportKey: "25:tactical", warfrontPlan: {} };
    try {
        globalThis.fetch = async () => Response.json({ ok: true });
        await assert.rejects(sendQueuedWarfrontReceipt(body), /recorded roster/);
        globalThis.fetch = async () => Response.json({ character: { name: "SomeoneElse" } });
        await assert.rejects(sendQueuedWarfrontReceipt(body), /recorded roster/);
        globalThis.fetch = async () => Response.json({ character: { name: body.playerName } });
        assert.deepEqual(await sendQueuedWarfrontReceipt(body), { character: { name: body.playerName } });
    } finally { clearPendingWarfrontReceipt(body); globalThis.fetch = original; }
});
