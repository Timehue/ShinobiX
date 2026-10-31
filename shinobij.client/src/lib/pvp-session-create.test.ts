import assert from "node:assert/strict";
import { test } from "node:test";
import { PVP_OPPONENT_UNAVAILABLE } from "../../../shared/pvp-cancellation";
import { createPvpSessionWithRecovery } from "./pvp-session-create";

const BODY = JSON.stringify({ battleId: "stable-battle" });

function server(createResponse: () => Response) {
    const creates: number[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") { creates.push(1); return createResponse(); }
        assert.match(String(input), /pending=1/);
        return new Response(null, { status: 204 });
    }) as typeof fetch;
    return { creates, fetchFn };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

test("a refusal about where the opponent stands is asked once and reported", async () => {
    const { creates, fetchFn } = server(() => json(409, {
        error: "World attacks are disabled in safe zones.", errorCode: PVP_OPPONENT_UNAVAILABLE,
    }));
    const result = await createPvpSessionWithRecovery(fetchFn, "Caius", BODY, { wait: async () => undefined });
    assert.equal(creates.length, 1);
    assert.deepEqual(result, { kind: "rejected", error: "World attacks are disabled in safe zones." });
});

test("a bare 409 is still retried, because the create may have landed", async () => {
    const { creates, fetchFn } = server(() => json(409, { error: "Finish the pending PvP battle settlement." }));
    const result = await createPvpSessionWithRecovery(fetchFn, "Caius", BODY, { wait: async () => undefined });
    assert.equal(creates.length, 4);
    assert.equal(result.kind, "ambiguous");
});
