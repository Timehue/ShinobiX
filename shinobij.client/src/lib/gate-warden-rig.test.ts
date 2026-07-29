import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

type GateWardenGlbJson = {
    animations?: Array<{ name?: string }>;
    meshes?: Array<{ primitives?: Array<{ attributes?: Record<string, number> }> }>;
    nodes?: Array<{ name?: string; skin?: number }>;
    skins?: Array<{ joints?: number[] }>;
};

function readGateWardenJson(): GateWardenGlbJson {
    const bytes = readFileSync(new URL("../../public/pet-models/gate-warden-rigged.glb", import.meta.url));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint32(0, true), 0x46546c67);
    assert.equal(view.getUint32(4, true), 2);
    const jsonLength = view.getUint32(12, true);
    return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as GateWardenGlbJson;
}

test("Gate Warden ships as a skinned combat rig with the full clip set", () => {
    const gltf = readGateWardenJson();
    const primitive = gltf.meshes?.[0]?.primitives?.[0];
    assert.ok(primitive?.attributes?.JOINTS_0 !== undefined);
    assert.ok(primitive?.attributes?.WEIGHTS_0 !== undefined);
    assert.ok(gltf.nodes?.some((node) => node.skin !== undefined));
    assert.ok((gltf.skins?.[0]?.joints?.length ?? 0) >= 12);

    const clips = new Set(gltf.animations?.map((animation) => animation.name));
    for (const name of ["GW_Idle", "GW_Walk", "GW_Windup", "GW_Slam", "GW_Hit"]) {
        assert.ok(clips.has(name), `missing ${name}`);
    }
});
