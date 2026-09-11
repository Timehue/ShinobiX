import assert from "node:assert/strict";
import { test } from "node:test";
import { supportsPetWebGl2 } from "./pet-webgl-capability.js";

function probeCanvas(getContext: (kind: string, options?: WebGLContextAttributes) => unknown) {
    return { width: 300, height: 150, getContext } as unknown as HTMLCanvasElement;
}

test("a supported WebGL2 probe releases its context and backing surface", () => {
    let released = 0;
    const canvas = probeCanvas((kind, options) => {
        assert.equal(kind, "webgl2");
        assert.deepEqual(options, { alpha: true, antialias: true, powerPreference: "high-performance" });
        return {
            getExtension(name: string) {
                assert.equal(name, "WEBGL_lose_context");
                return { loseContext: () => { released++; } };
            },
        };
    });
    assert.equal(supportsPetWebGl2(() => canvas), true);
    assert.equal(released, 1);
    assert.equal(canvas.width, 1);
    assert.equal(canvas.height, 1);
});

test("a null WebGL2 context selects the non-WebGL stage", () => {
    const canvas = probeCanvas(() => null);
    assert.equal(supportsPetWebGl2(() => canvas), false);
    assert.equal(canvas.width, 1);
    assert.equal(canvas.height, 1);
});

test("a WebGL1-only device is not accepted by the WebGL2 renderer probe", () => {
    const requested: string[] = [];
    const canvas = probeCanvas((kind) => {
        requested.push(kind);
        return kind === "webgl" ? { getExtension: () => null } : null;
    });
    assert.equal(supportsPetWebGl2(() => canvas), false);
    assert.deepEqual(requested, ["webgl2"]);
});

test("context creation exceptions select the fallback and discard the surface", () => {
    const canvas = probeCanvas(() => { throw new Error("WebGL is disabled"); });
    assert.equal(supportsPetWebGl2(() => canvas), false);
    assert.equal(canvas.width, 1);
    assert.equal(canvas.height, 1);
});

test("an unavailable canvas factory also selects the fallback", () => {
    assert.equal(supportsPetWebGl2(() => { throw new Error("document is unavailable"); }), false);
});

test("cleanup errors cannot escape an otherwise successful capability check", () => {
    const canvas = probeCanvas(() => ({
        getExtension: () => ({ loseContext: () => { throw new Error("context already lost"); } }),
    }));
    assert.equal(supportsPetWebGl2(() => canvas), true);
    assert.equal(canvas.width, 1);
    assert.equal(canvas.height, 1);
});

test("a device without the optional context-loss extension still releases its surface", () => {
    const canvas = probeCanvas(() => ({ getExtension: () => null }));
    assert.equal(supportsPetWebGl2(() => canvas), true);
    assert.equal(canvas.width, 1);
    assert.equal(canvas.height, 1);
});
