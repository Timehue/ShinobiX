import assert from "node:assert/strict";
import test from "node:test";
import { warfrontElementSignature } from "./pet-warfront-spectacle";
import { drawWarfrontElementResult, drawWarfrontElementTell, drawWarfrontElementTravel } from "./pet-warfront-spectacle-canvas";

function recordingContext() {
    const calls: { method: string; args: unknown[] }[] = [];
    const state: Record<string, unknown> = {};
    const context = new Proxy(state, {
        get(target, key: string) {
            if (key in target) return target[key];
            return (...args: unknown[]) => { calls.push({ method: key, args }); };
        },
    }) as unknown as CanvasRenderingContext2D;
    return { context, calls };
}

test("lightning draws stable branching geometry while water retains ripples", () => {
    const lightning = recordingContext();
    const repeat = recordingContext();
    const water = recordingContext();
    drawWarfrontElementTell(lightning.context, warfrontElementSignature("Lightning"), 40, 20, 24, 0.8, 3);
    drawWarfrontElementTell(repeat.context, warfrontElementSignature("Lightning"), 40, 20, 24, 0.8, 3);
    drawWarfrontElementTell(water.context, warfrontElementSignature("Water"), 40, 20, 24, 0.8, 3);
    assert.deepEqual(lightning.calls, repeat.calls, "pausing/replaying a move must not randomize its branches");
    assert.equal(lightning.calls.filter((call) => call.method === "lineTo").length, 15);
    assert.equal(lightning.calls.filter((call) => call.method === "ellipse").length, 0);
    assert.equal(water.calls.filter((call) => call.method === "ellipse").length, 2);
});

test("wind travel has a filled crescent and a readable core that arrives at the target", () => {
    const { context, calls } = recordingContext();
    drawWarfrontElementTravel(context, warfrontElementSignature("Wind"), 0, 0, 100, 30, 1, 1, 3);
    assert.ok(calls.some((call) => call.method === "fill"), "a filled blade remains legible at arena scale");
    assert.ok(calls.filter((call) => call.method === "stroke").length >= 3);
    assert.ok(calls.some((call) => call.method === "lineTo" && call.args[0] === 100 && call.args[1] === 30));
});

test("all move families clear completely and keep draw state balanced", () => {
    for (const element of ["Fire", "Water", "Wind", "Earth", "Lightning", "None"]) {
        const signature = warfrontElementSignature(element);
        const cleared = recordingContext();
        drawWarfrontElementTell(cleared.context, signature, 0, 0, 20, 0, 3);
        drawWarfrontElementTravel(cleared.context, signature, 0, 0, 100, 30, 0, 0, 3);
        drawWarfrontElementResult(cleared.context, signature, 100, 30, 20, 0, 0, 4, 3);
        assert.equal(cleared.calls.length, 0, `${element} must not leave residual graphics`);
        const active = recordingContext();
        drawWarfrontElementResult(active.context, signature, 100, 30, 20, 1, 0.5, 4, 3);
        assert.equal(active.calls.filter((call) => call.method === "save").length, active.calls.filter((call) => call.method === "restore").length);
        for (const { args } of active.calls) for (const argument of args) {
            if (typeof argument === "number") assert.ok(Number.isFinite(argument));
        }
    }
});
