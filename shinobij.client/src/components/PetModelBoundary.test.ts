import assert from "node:assert/strict";
import test from "node:test";
import { PetModelBoundary } from "./PetModelBoundary";

/*
 * The boundary's job is narrow: when a pet's GLB fails to load, swallow the
 * throw, tell the caller once, and render the fallback instead of letting the
 * error reach ScreenErrorBoundary (which blanks the whole screen — how the
 * stage-0 starters took down the Pet Coliseum).
 *
 * These assert the class contract without a DOM. The wiring itself — React
 * calling getDerivedStateFromError/componentDidCatch on a throwing child — is
 * React's own guarantee, and the same pattern already ships in
 * features/intro-cinematic/IntroCompanion3D.tsx (ModelBoundary). What is worth
 * pinning here is the behaviour that is EASY to regress: defaulting to null
 * (never DOM, which would break inside a Canvas) and firing onFail so the
 * caller can drop to its 2D standee.
 */

const info = { componentStack: "\n    at PetModel3D" };

function boundary(props: Partial<Parameters<typeof PetModelBoundary.prototype.render>[0]> = {}) {
    const instance = new PetModelBoundary({ children: "model", ...props } as never);
    instance.state = { failed: false };
    return instance;
}

test("a thrown model error flips the boundary to its failed state", () => {
    assert.deepEqual(PetModelBoundary.getDerivedStateFromError(), { failed: true });
});

test("healthy models render their children untouched", () => {
    const instance = boundary();
    assert.equal(instance.render(), "model");
});

test("a failed model renders null by default — never DOM, which would break inside a Canvas", () => {
    const instance = boundary();
    instance.state = { failed: true };
    assert.equal(instance.render(), null);
});

test("a failed model renders an explicit fallback when one is given", () => {
    const instance = boundary({ fallback: "standee" } as never);
    instance.state = { failed: true };
    assert.equal(instance.render(), "standee");
});

test("componentDidCatch notifies the caller so it can switch to 2D art", () => {
    let fired = 0;
    const warn = console.warn;
    console.warn = () => {};
    try {
        const instance = boundary({ onFail: () => { fired += 1; } } as never);
        instance.componentDidCatch(new Error("Could not load /pet-models/x.glb: 404"), info as never);
    } finally {
        console.warn = warn;
    }
    assert.equal(fired, 1);
});

test("onFail is optional — a portrait that degrades to nothing needs no callback", () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
        const instance = boundary();
        assert.doesNotThrow(() => instance.componentDidCatch(new Error("boom"), info as never));
    } finally {
        console.warn = warn;
    }
});
