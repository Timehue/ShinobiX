import { afterEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { settleClanBossAssault } from "./clan-boss-api";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const reply = (status: number, body: unknown) => { globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch; };

describe("settleClanBossAssault", () => {
    it("returns the settled body, including the character the drop landed in", async () => {
        reply(200, { ok: true, character: { name: "Rill" }, _saveVersion: 9 });
        assert.deepEqual(await settleClanBossAssault("run", "rill"), { ok: true, character: { name: "Rill" }, _saveVersion: 9 });
    });

    it("throws on a server error, so the fight screen offers a retry instead of leaving as settled", async () => {
        reply(503, { error: "Legacy combat credit pending. Try again." });
        await assert.rejects(() => settleClanBossAssault("run", "rill"), /Legacy combat credit pending/);
        reply(500, {});
        await assert.rejects(() => settleClanBossAssault("run", "rill"), /could not be confirmed/);
        reply(429, { error: "Slow down." });
        await assert.rejects(() => settleClanBossAssault("run", "rill"), /Slow down/);
    });

    it("throws when the connection drops", async () => {
        globalThis.fetch = (async () => { throw new TypeError("network"); }) as typeof fetch;
        await assert.rejects(() => settleClanBossAssault("run", "rill"), /could not be confirmed/);
    });

    it("still returns a refusal that a retry cannot change", async () => {
        reply(404, { error: "That assault has expired." });
        assert.deepEqual(await settleClanBossAssault("run", "rill"), { error: "That assault has expired." });
        reply(403, { error: "You were not in this assault." });
        assert.deepEqual(await settleClanBossAssault("run", "rill"), { error: "You were not in this assault." });
    });
});
