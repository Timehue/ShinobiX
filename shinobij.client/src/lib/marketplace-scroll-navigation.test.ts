import assert from "node:assert/strict";
import test from "node:test";
import { openMarketplaceScroll, takeMarketplaceScrollHint } from "./marketplace-scroll-navigation.js";

function installSessionStorage(values: Map<string, string>) {
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { sessionStorage: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
        } },
    });
}

test("the backpack hand-off opens the marketplace and names the scroll card once", () => {
    installSessionStorage(new Map());
    let screen = "";
    openMarketplaceScroll("profession", (value) => { screen = value; });
    assert.equal(screen, "grandMarketplace");
    assert.equal(takeMarketplaceScrollHint(), "profession");
    // A later plain visit (Central Hub tile, back navigation) must land at the top.
    assert.equal(takeMarketplaceScrollHint(), null);
    Reflect.deleteProperty(globalThis, "window");
});

test("an unknown stored hint is ignored and still cleared", () => {
    const values = new Map([["shinobix:marketplace-scroll:v1", "inventory"]]);
    installSessionStorage(values);
    assert.equal(takeMarketplaceScrollHint(), null);
    assert.equal(values.size, 0);
    Reflect.deleteProperty(globalThis, "window");
});
