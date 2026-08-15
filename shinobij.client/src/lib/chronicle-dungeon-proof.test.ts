import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { startChronicleAi } from "./chronicle-duel";

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

test("Chronicle start nests the Dungeon token and preserves the proof-bearing response", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    const requests: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_url, init) => {
        requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return response({
            ok: true,
            matchId: "a".repeat(64),
            session: { status: "complete" },
            character: { name: "Rill", activeDungeonRun: { cardDefeated: true } },
            _saveVersion: 44,
        });
    }) as typeof fetch;
    try {
        const result = await startChronicleAi(
            "Rill",
            ["tc-01"],
            "hard",
            true,
            "dungeon_card_run_1",
        );
        assert.equal(result.ok, true);
        assert.equal(result.character?.name, "Rill");
        assert.equal(result._saveVersion, 44);
        assert.deepEqual(requests[0], {
            playerName: "Rill",
            deck: ["tc-01"],
            difficulty: "hard",
            externalStakes: true,
            dungeon: { token: "dungeon_card_run_1" },
        });
        assert.equal("dungeonRunToken" in requests[0]!, false);

        await startChronicleAi("Rill", ["tc-01"], "medium", true);
        assert.equal("dungeon" in requests[1]!, false,
            "ordinary external stakes must not acquire a Dungeon proof envelope");
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("Dungeon Card host waits for a versioned authoritative terminal before advancing", () => {
    const source = readFileSync(new URL("../screens/CardClashDuel.tsx", import.meta.url), "utf8");
    assert.match(source, /dungeonRunToken\?: string/);
    assert.match(source, /onVersionedCharacter\?: \(character: Character, saveVersion: number\)/);
    assert.match(source, /startChronicleAi\([\s\S]{0,220}true, dungeonRunToken\)/);
    assert.match(source, /result\.session\.status === "complete"[\s\S]{0,220}action: "state"/,
        "a completed deterministic start must reconcile a lost terminal response");
    assert.match(source, /!result\.character \|\| !Number\.isSafeInteger\(version\)/);
    assert.match(source, /onVersionedCharacter\?\.\(result\.character, version\)/);
    assert.match(source, /dungeonRunToken && !dungeonTerminalReady/);
    assert.match(source, /The Dungeon Card proof is still waiting for server confirmation/);
});
