import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inNpcLayer, layerNpcByDepth, npcBoard } from "./sector-npc-layer";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const overlay = (inLayer: boolean) => ({
    parentElement: { classList: { contains: (name: string) => inLayer && name === "sector-npc-layer" } },
    style: { zIndex: "" },
}) as unknown as HTMLElement;

test("an NPC lower on the board draws in front of one above it", () => {
    const back = overlay(true), front = overlay(true);
    layerNpcByDepth(back, 3.2);
    layerNpcByDepth(front, 3.6);
    assert.ok(Number(front.style.zIndex) > Number(back.style.zIndex), "a step south moves an NPC in front");
    const top = overlay(true), bottom = overlay(true);
    layerNpcByDepth(top, -1.5);
    layerNpcByDepth(bottom, 12.5);
    assert.ok(Number(top.style.zIndex) > 0 && Number(bottom.style.zIndex) < 99999, "rows off the board stay under the hover raise");
});

test("outside the shared layer an NPC keeps its stylesheet band", () => {
    // Without the layer, a z-index from the row would lift it over landmarks.
    const alone = overlay(false);
    layerNpcByDepth(alone, 9);
    assert.equal(alone.style.zIndex, "");
    assert.equal(inNpcLayer(undefined, "npc"), "npc", "no board layer: draws in place");
    assert.equal(inNpcLayer(null, "npc"), null, "board layer pending: waits a commit");
    assert.equal(npcBoard(null, { parentElement: "board" } as unknown as HTMLElement), "board");
});

test("every NPC and both boards use the one layer", () => {
    for (const actor of ["../components/SectorWanderer.tsx", "../components/SectorWeeklyBossActor.tsx"]) {
        const source = read(actor);
        assert.match(source, /return inNpcLayer\(npcLayer,/u, `${actor} mounts in the shared layer`);
        assert.match(source, /layerNpcByDepth\(wrapRef\.current,\s*posRef\.current\.row\)/u, `${actor} layers by its foot row`);
        assert.match(source, /npcBoard\(wrapRef\.current, npcLayer\)/u, `${actor} measures the board, not the layer`);
    }
    const host = read("../components/SectorNpcLayerHost.tsx");
    assert.match(host, /className="sector-npc-layer" ref=\{setLayer\}/u, "the host renders the layer");
    assert.match(host, /<SectorNpcLayer\.Provider value=\{layer\}>/u, "and provides it to the board's NPCs");
    for (const board of ["../components/WorldSectorCanvas.tsx", "../components/ContinuousWorldSector.tsx"]) {
        assert.match(read(board), /<SectorNpcLayerHost>[\s\S]*\{(?:props\.)?overlayLayer\}[\s\S]*<\/SectorNpcLayerHost>/u, `${board} hosts its NPCs in the layer`);
    }
});
