/*
 * The Showdown warm-up on a device without WebGL2.
 *
 * The battle mounts no Canvas there (it draws a 2D stage), so warming its
 * models is a download and decode nobody can use, spent in front of the stage.
 * Warming is also asked before every Showdown, and WebKit keeps a released
 * probe context counted against the page's context limit until garbage
 * collection, so the question is asked once per page.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { warmShowdownModels } from "./pet-model-preload.js";

test("without WebGL2 the warm-up fetches no model and probes the device once per page", async () => {
    const globals = globalThis as Record<string, unknown>;
    const originalFetch = globals.fetch;
    const requested: string[] = [];
    let probes = 0;
    globals.document = {
        createElement: (tag: string) => {
            assert.equal(tag, "canvas");
            return {
                width: 300,
                height: 150,
                getContext: (kind: string) => { probes += 1; assert.equal(kind, "webgl2"); return null; },
            };
        },
    };
    globals.fetch = async (input: unknown) => {
        requested.push(String(input));
        throw new Error("model fetches are not expected without WebGL2");
    };
    try {
        // Both of these resolve to approved roster GLBs on a capable device.
        const state = {
            player: [{ id: "viewer", templateId: "standard-1", name: "Viewer", rarity: "standard", element: "Fire" }],
            enemy: [{ id: "showdown-ai-0-rare-24", templateId: "rare-24", name: "Young Direwolf", rarity: "rare", element: "Earth" }],
        } as unknown as Parameters<typeof warmShowdownModels>[0];
        await warmShowdownModels(state);
        await warmShowdownModels(state);
        assert.deepEqual(requested, []);
        assert.equal(probes, 1);
    } finally {
        delete globals.document;
        globals.fetch = originalFetch;
    }
});
