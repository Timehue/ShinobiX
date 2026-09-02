import assert from "node:assert/strict";
import test from "node:test";
import { PetBattleRenderBoundary } from "./PetBattleRenderBoundary";

test("a failed battle renderer stays inside its local boundary", () => {
    assert.deepEqual(PetBattleRenderBoundary.getDerivedStateFromError(), { failed: true });
    const boundary = new PetBattleRenderBoundary({ children: "canvas", fallback: "recovery" });
    boundary.state = { failed: true };
    assert.equal(boundary.render(), "recovery");
});

test("the battle boundary reports the failure once without rethrowing", () => {
    let message = "";
    const boundary = new PetBattleRenderBoundary({
        children: "canvas",
        onFail: (error) => { message = error.message; },
    });
    const warn = console.warn;
    console.warn = () => {};
    try {
        assert.doesNotThrow(() => boundary.componentDidCatch(new Error("context lost"), { componentStack: "\n at Canvas" }));
    } finally {
        console.warn = warn;
    }
    assert.equal(message, "context lost");
});
