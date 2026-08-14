import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
    TRANSIENT_FX_DECODE_TIMEOUT_MS,
    TRANSIENT_FX_TEXTURE_CACHE_LIMIT,
    transientFxTextureSequenceKey,
} from "./transient-fx-textures.ts";

test("transient FX cache keys preserve frame order and sequence identity", () => {
    assert.equal(transientFxTextureSequenceKey(["a.png", "b.png"]), "a.png\u0000b.png");
    assert.notEqual(transientFxTextureSequenceKey(["a.png", "b.png"]), transientFxTextureSequenceKey(["b.png", "a.png"]));
});

test("transient FX pooling is bounded and cold decode cannot hang forever", () => {
    assert.ok(TRANSIENT_FX_TEXTURE_CACHE_LIMIT >= 8 && TRANSIENT_FX_TEXTURE_CACHE_LIMIT <= 16);
    assert.ok(TRANSIENT_FX_DECODE_TIMEOUT_MS >= 1_000 && TRANSIENT_FX_DECODE_TIMEOUT_MS <= 5_000);
});

test("the transient layer isolates stage reconciliation and completes each item once", () => {
    const source = readFileSync(new URL("../components/PetArena3DStage.tsx", import.meta.url), "utf8");
    assert.match(source, /export function TransientFx3DLayer/);
    assert.match(source, /<TransientFx3DLayer apiRef=\{transientFxRef\}/);
    assert.match(source, /p >= 1 && !done\.current/);
    assert.match(source, /elapsed >= durationMs && !done\.current/);
    assert.match(source, /instMesh\.geometry\.dispose\(\)/);
    assert.match(source, /instMesh\.dispose\(\)/);
});
