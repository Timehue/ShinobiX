import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Character } from "../types/character";
import { __resetSettledWarClaimsForTest, claimServerWarCrates, claimServerWarRewards, hydrateSharedWorldState } from "./world-state";

const originalFetch = globalThis.fetch;
beforeEach(() => __resetSettledWarClaimsForTest());
afterEach(() => { globalThis.fetch = originalFetch; });

const character = { name: "Kaya", village: "Moonshadow Village", clan: "" } as unknown as Character;

function endedWars(count: number) {
    const others = ["Stormveil Village", "Frostfang Village", "Ashen Leaf Village", "Sunscar Village", "Mistvale Village", "Duskreach Village"];
    return others.slice(0, count).map(other => ({
        villages: ["Moonshadow Village", other] as [string, string],
        endedAt: Date.now() - 60_000,
        winnerVillage: "Moonshadow Village",
        warCrateId: `crate-${other}`,
    }));
}

describe("war reward sweep", () => {
    it("asks about each ended war once per session instead of on every world poll", async () => {
        hydrateSharedWorldState({ wars: endedWars(6) });
        const posted: string[] = [];
        globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body)) as { warId: string };
            posted.push(body.warId);
            return new Response(JSON.stringify({ ok: true, granted: false, crates: 0, character: { name: "Kaya" }, _saveVersion: 7 }), { status: 200 });
        }) as typeof fetch;

        for (let poll = 0; poll < 5; poll += 1) await claimServerWarRewards(character);

        assert.equal(posted.length, 6, "six wars, one definitive claim each — not 6 x every 15s poll");
        assert.equal(new Set(posted).size, 6);
    });

    it("does not adopt the unchanged save a no-op claim returns", async () => {
        hydrateSharedWorldState({ wars: endedWars(1) });
        globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, granted: false, character: { name: "Kaya" }, _saveVersion: 7 }), { status: 200 })) as typeof fetch;
        assert.equal(await claimServerWarRewards(character), null);
    });

    it("keeps retrying a war whose claim failed", async () => {
        hydrateSharedWorldState({ wars: endedWars(1) });
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            return calls < 3
                ? new Response(JSON.stringify({ error: "Rate limit exceeded.", retryAfterMs: 1000 }), { status: 429 })
                : new Response(JSON.stringify({ ok: true, granted: true, crates: 1, character: { name: "Kaya" }, _saveVersion: 8 }), { status: 200 });
        }) as typeof fetch;

        assert.equal(await claimServerWarRewards(character), null);
        assert.equal(await claimServerWarRewards(character), null);
        const granted = await claimServerWarRewards(character);
        assert.equal(granted?.crates, 1);
        assert.equal(granted?._saveVersion, 8);
        await claimServerWarRewards(character);
        assert.equal(calls, 3, "settled after the grant");
    });

    it("rechecks a no-grant answer after a while, so a lazily-ended clan war still pays", async (t) => {
        t.mock.timers.enable({ apis: ["Date"], now: 1_000_000_000_000 });
        hydrateSharedWorldState({ wars: endedWars(1).map(w => ({ ...w, endedAt: Date.now() - 60_000 })) });
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            return new Response(JSON.stringify({ ok: true, granted: false, character: { name: "Kaya" }, _saveVersion: 7 }), { status: 200 });
        }) as typeof fetch;
        await claimServerWarRewards(character);
        await claimServerWarRewards(character);
        assert.equal(calls, 1);
        t.mock.timers.tick(5 * 60_000 + 1);
        await claimServerWarRewards(character);
        assert.equal(calls, 2);
    });

    it("hands back the versioned save a granted crate wrote", async () => {
        hydrateSharedWorldState({ wars: endedWars(1) });
        globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, granted: true, reason: "granted",
            character: { name: "Kaya", inventory: ["legendary-war-crate"] }, _saveVersion: 12 }), { status: 200 })) as typeof fetch;
        const crates = await claimServerWarCrates(character);
        assert.deepEqual(crates.ids, ["crate-Stormveil Village"]);
        assert.equal(crates._saveVersion, 12);
        assert.ok(crates.character);
    });
});
