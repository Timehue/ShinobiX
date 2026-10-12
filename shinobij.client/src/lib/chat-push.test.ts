import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CHAT_SUBSCRIBE_EVENT, CHAT_UNSUBSCRIBE_EVENT, type ChatPush } from "../../../shared/chat-push";
import { createChatPushHub } from "./chat-push";

type Request = { event: string; payload: { channel: string; key: string }; resolve: (r: unknown) => void; reject: (e: unknown) => void };

function fakeTransport(connected = true) {
    const requests: Request[] = [];
    const emits: Array<[string, unknown]> = [];
    let push: ((p: ChatPush) => void) | null = null;
    let status: ((c: boolean) => void) | null = null;
    const state = { connected };
    return {
        state, requests, emits,
        transport: {
            isConnected: () => state.connected,
            request: (event: string, payload: unknown) => state.connected
                ? new Promise<unknown>((resolve, reject) => { requests.push({ event, payload: payload as Request["payload"], resolve, reject }); })
                : null,
            emit: (event: string, payload: unknown) => { emits.push([event, payload]); return state.connected; },
            onPush: (fn: (p: ChatPush) => void) => { push = fn; return () => { push = null; }; },
            onStatus: (fn: (c: boolean) => void) => { status = fn; return () => { status = null; }; },
        },
        push: (p: ChatPush) => push?.(p),
        setConnected: (c: boolean) => { state.connected = c; status?.(c); },
    };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("chat push hub", () => {
    it("joins once per room, routes only that room's hints, and refetches on a confirmed join", async () => {
        const t = fakeTransport();
        const watch = createChatPushHub(t.transport);
        let a = 0, b = 0;
        const stopA = watch("village", " Frostfang Village ", () => { a++; });
        const stopB = watch("village", "frostfang village", () => { b++; });
        assert.equal(t.requests.length, 1, "two watchers, one subscribe");
        assert.equal(t.requests[0].event, CHAT_SUBSCRIBE_EVENT);
        assert.deepEqual(t.requests[0].payload, { channel: "village", key: "Frostfang Village" });

        t.requests[0].resolve({ ok: true });
        await tick();
        assert.deepEqual([a, b], [1, 1], "a confirmed join catches up both watchers");

        t.push({ channel: "village", key: "frostfang-village", ts: 1 });
        t.push({ channel: "village", key: "moonshadow-village", ts: 2 });
        t.push({ channel: "clan", key: "frostfang-village", ts: 3 });
        assert.deepEqual([a, b], [2, 2], "only the watched room's hint counts");

        stopA();
        assert.equal(t.emits.length, 0, "still watched by B");
        stopB();
        assert.deepEqual(t.emits, [[CHAT_UNSUBSCRIBE_EVENT, { channel: "village", key: "Frostfang Village" }]]);
        t.push({ channel: "village", key: "frostfang-village", ts: 4 });
        assert.deepEqual([a, b], [2, 2]);
    });

    it("rejoins every watched room after a reconnect, and catches up", async () => {
        const t = fakeTransport();
        const watch = createChatPushHub(t.transport);
        let village = 0, clan = 0;
        watch("village", "Frostfang Village", () => { village++; });
        watch("clan", "Storm Clan", () => { clan++; });
        for (const r of t.requests) r.resolve({ ok: true });
        await tick();
        assert.deepEqual([village, clan], [1, 1]);

        t.setConnected(false);
        assert.equal(t.requests.length, 2, "no subscribe while down");
        t.setConnected(true);
        assert.equal(t.requests.length, 4, "both rooms rejoined");
        assert.deepEqual(t.requests.slice(2).map((r) => r.payload.channel).sort(), ["clan", "village"]);
        for (const r of t.requests.slice(2)) r.resolve({ ok: true });
        await tick();
        assert.deepEqual([village, clan], [2, 2], "each rejoin refetches what was missed");
    });

    it("waits for the socket, accepts a refusal as final, and retries a failure", async () => {
        const t = fakeTransport(false);
        const watch = createChatPushHub(t.transport, { retryMs: 5 });
        let refused = 0, failed = 0;
        watch("village", "Frostfang Village", () => { refused++; });
        watch("clan", "Storm Clan", () => { failed++; });
        assert.equal(t.requests.length, 0, "nothing to send on");
        t.setConnected(true);
        assert.equal(t.requests.length, 2);
        t.requests.find((r) => r.payload.channel === "village")!.resolve({ ok: false, reason: "forbidden" });
        t.requests.find((r) => r.payload.channel === "clan")!.reject(new Error("timeout"));
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(t.requests.length, 3, "only the failed join is retried");
        assert.equal(t.requests[2].payload.channel, "clan");
        t.requests[2].resolve({ ok: true });
        await tick();
        assert.deepEqual([refused, failed], [0, 1]);
    });

    it("ignores a join confirmed after the watcher left", async () => {
        const t = fakeTransport();
        const watch = createChatPushHub(t.transport);
        let heard = 0;
        const stop = watch("clan", "Storm Clan", () => { heard++; });
        stop();
        t.requests[0].resolve({ ok: true });
        await tick();
        assert.equal(heard, 0);
    });

    it("does nothing for a name with no usable slug", () => {
        const t = fakeTransport();
        const watch = createChatPushHub(t.transport);
        const stop = watch("clan", "  !!!  ", () => {});
        stop();
        assert.deepEqual([t.requests.length, t.emits.length], [0, 0]);
    });
});
