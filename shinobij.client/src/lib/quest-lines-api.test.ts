import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadCoastWorld, questRefusal, type QuestLine, type QuestLinesList } from "./quest-lines-api";
import { questStepHere } from "./use-quest-lines";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) sources(path, out);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(path);
    }
    return out;
}

test("the client never bundles the coast's map or the quest catalogue", () => {
    // Both are the server's (api/coast/world.ts, api/quests/_catalog.ts). A static
    // import of either would add its whole weight to the bundle and a second copy to drift.
    // Type-only imports are erased by the build, and shared/coast-world-rules holds
    // types and small pure rules with no map data, so neither counts.
    const data = /^import\s+(?!type\b)[^;]*?from\s+["'][^"']*(shared\/coast-world(\.json)?|shared\/quest-sites|api\/quests\/[^"']*)["']/m;
    const offenders = sources(SRC).filter(path => data.test(readFileSync(path, "utf8")));
    assert.deepEqual(offenders.map(path => path.slice(SRC.length + 1)), []);
});

test("a refused quest action is told to the player as a sentence", () => {
    // The server words every refusal (api/quests/_refusals.ts, tested there); the client shows what it is sent.
    assert.equal(questRefusal({ ok: false, reason: "wrong-place", error: "You are not there yet." }), "You are not there yet.");
    assert.match(questRefusal({ ok: false, reason: "something-new" }), /could not be done/, "a reply with no words still says something");
});

test("a sector has a quest step when a quest can be advanced, remade or taken there", () => {
    const line = (patch: Partial<QuestLine>): QuestLine => ({
        id: "q", series: "s", title: "Q", world: "coast", marks: 1, stages: 6, state: "active",
        needLevel: 50, needMarks: 0, giver: "keeper", giverName: "Keeper", ...patch,
    });
    const list = (...lines: QuestLine[]): QuestLinesList => ({ ok: true, marks: 0, lines, sites: [], coast: { level: 50, boat: true, region: 1 } });
    const at = (sector: number) => ({ sector, sectorName: `Sector ${sector}` });
    const step = { index: 3, kind: "gather" as const, text: "Harvest.", place: at(102) };

    assert.equal(questStepHere(list(line({ stage: step })), 102), true);
    assert.equal(questStepHere(list(line({ stage: step })), 105), false);
    assert.equal(questStepHere(list(line({ stage: { ...step, place: at(107) }, remake: { stageKey: "order", place: at(105), inputs: [], output: { itemId: "x", name: "X", count: 1 } } })), 105), true);
    assert.equal(questStepHere(list(line({ state: "open", offerAt: at(101) })), 101), true);
    assert.equal(questStepHere(list(line({ state: "done", stage: step })), 102), false);
    assert.equal(questStepHere(list(line({ stage: step })), null), false, "a town is no sector");
    assert.equal(questStepHere(null, 102), false);
});

test("the coast's map is fetched once, and a failed fetch is tried again", async () => {
    const original = globalThis.fetch;
    let calls = 0, fail = true;
    globalThis.fetch = (async () => {
        calls += 1;
        if (fail) throw new Error("offline");
        return new Response(JSON.stringify({ version: "v", atlas: { width: 1, height: 1, image: "a.webp" }, regions: [], points: [], roads: [], sectors: {} }), { status: 200 });
    }) as typeof fetch;
    try {
        assert.equal(await loadCoastWorld(), null);
        fail = false;
        assert.equal((await loadCoastWorld())?.version, "v", "the failure was not remembered");
        assert.equal((await loadCoastWorld())?.version, "v");
        assert.equal(calls, 2, "a good answer is kept for the session");
    } finally {
        globalThis.fetch = original;
    }
});
