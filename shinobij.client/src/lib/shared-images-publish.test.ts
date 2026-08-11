import assert from "node:assert/strict";
import test from "node:test";
import { publishSharedImage } from "./shared-images";

test("image publishing surfaces the authoritative server denial", async () => {
    const originalFetch = globalThis.fetch;
    const originalWarn = console.warn;
    let failure: { message: string; status?: number } | null = null;
    globalThis.fetch = async () => new Response(
        JSON.stringify({ error: "Custom avatars require an active Shinobi Supporter entitlement." }),
        { status: 403, headers: { "content-type": "application/json" } },
    );
    console.warn = () => undefined;
    try {
        const published = await publishSharedImage("avatar:test", "data:image/png;base64,AA==", (message, status) => {
            failure = { message, status };
        });
        assert.equal(published, false);
        assert.deepEqual(failure, {
            message: "Custom avatars require an active Shinobi Supporter entitlement.",
            status: 403,
        });
    } finally {
        globalThis.fetch = originalFetch;
        console.warn = originalWarn;
    }
});
