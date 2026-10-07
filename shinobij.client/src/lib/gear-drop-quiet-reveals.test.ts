/**
 * The chest, the clan cache and the Sunscar Exchange each show the item themselves,
 * so the gear pop-up must stay quiet for it instead of announcing it a second time.
 * The chest is driven for real (its API call, then the store). The other two live
 * inside components, so they are source scans that also prove they still find the
 * code they guard.
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { openAncientChest } from "./world-reward-api";
import { getGearDropsSnapshot, observeGearCounts, resetGearDropStore } from "./gear-drop-store";

const realFetch = globalThis.fetch;
const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } }; };
beforeEach(() => resetGearDropStore({ storage: memory() }));
afterEach(() => { globalThis.fetch = realFetch; });

const chestReply = (itemId: string) => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ loot: { xp: 0, itemId }, character: { name: "Rill" }, _saveVersion: 3 }), { status: 200 })) as typeof fetch;
};

describe("the chest keeps the gear pop-up quiet for the item it reveals", () => {
    it("announces nothing for a step item the chest just revealed", async () => {
        observeGearCounts("Rill", new Map(), 1_000);
        chestReply("cloth-hood-s1");
        const opened = await openAncientChest("rill", 1, "chest-op-0001", "explore-op-0001");
        assert.equal(opened.loot?.itemId, "cloth-hood-s1");
        observeGearCounts("Rill", new Map([["cloth-hood-s1", 1]]), 2_000);
        assert.deepEqual(getGearDropsSnapshot(), []);
    });

    it("still announces the same item when it arrives some other way", async () => {
        observeGearCounts("Rill", new Map(), 1_000);
        observeGearCounts("Rill", new Map([["cloth-hood-s1", 1]]), 2_000);
        assert.deepEqual(getGearDropsSnapshot().map((drop) => drop.itemId), ["cloth-hood-s1"]);
    });

    it("does nothing special for an ordinary chest item", async () => {
        observeGearCounts("Rill", new Map(), 1_000);
        chestReply("pet-treat");
        await openAncientChest("rill", 1, "chest-op-0002", "explore-op-0002");
        observeGearCounts("Rill", new Map([["cloth-hood-s1", 1]]), 2_000);
        assert.deepEqual(getGearDropsSnapshot().map((drop) => drop.itemId), ["cloth-hood-s1"], "an unrelated drop is not swallowed");
    });
});

describe("the clan cache and Sunscar Exchange ask for quiet before they adopt the new save", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

    it("clan cache: the reveal item is registered before the character is committed", () => {
        const source = read("../components/ClanExchange.tsx");
        const start = source.indexOf("function applyExchangeResponse(");
        assert.ok(start >= 0, "applyExchangeResponse moved; update this guard");
        const quiet = source.indexOf("expectGearDropReveal(result.reveal.itemId)", start);
        const commit = source.indexOf("onVersionedCharacter(result.character, result._saveVersion)", start);
        assert.ok(quiet > start && commit > start, "the cache hookup is no longer where this guard expects");
        assert.ok(quiet < commit, "ask for quiet before adopting the character that holds the item");
    });

    it("Sunscar Exchange: a buy or cancel registers the listed item before the request", () => {
        const source = read("../components/SunscarExchange.tsx");
        const start = source.indexOf("async function run(action: ExchangeRequest)");
        assert.ok(start >= 0, "run moved; update this guard");
        const quiet = source.indexOf("expectGearDropReveal(selected.asset.id)", start);
        const request = source.indexOf("await requestExchange(character.name, action, signal, marketQuery)", start);
        assert.ok(quiet > start && request > start, "the Exchange hookup is no longer where this guard expects");
        assert.ok(quiet < request, "ask for quiet before the request that delivers the goods");
        const condition = source.slice(source.lastIndexOf("if (", quiet), quiet);
        assert.match(condition, /'buy'/);
        assert.match(condition, /'cancel'/);
    });
});
