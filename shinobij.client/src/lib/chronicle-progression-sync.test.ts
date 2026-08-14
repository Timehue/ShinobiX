import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { syncChronicleProgression } from "./chronicle-progression-sync";

describe("Living Chronicle progression sync client", () => {
  it("accepts only the authoritative character and granted ids", async () => {
    let body: unknown;
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        ok: true,
        granted: ["story-boss-1", 42, null],
        character: { name: "alpha", tileCards: ["story-boss-1"] },
        _saveVersion: 9,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const result = await syncChronicleProgression("alpha", fetchImpl as typeof fetch);
    assert.deepEqual(body, { playerName: "alpha" });
    assert.deepEqual(result.granted, ["story-boss-1"]);
    assert.equal(result._saveVersion, 9);
    assert.deepEqual(result.character.tileCards, ["story-boss-1"]);
  });

  it("surfaces server and network failures without inventing local grants", async () => {
    const rejected = async () => new Response(JSON.stringify({ error: "chronicle-locked" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
    await assert.rejects(syncChronicleProgression("alpha", rejected as typeof fetch), /chronicle-locked/);
    const offline = async () => { throw new TypeError("offline"); };
    await assert.rejects(syncChronicleProgression("alpha", offline as typeof fetch), /could not be reached/i);
  });
});
