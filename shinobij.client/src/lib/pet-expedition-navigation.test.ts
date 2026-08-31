import assert from "node:assert/strict";
import test from "node:test";
import { clearPetExpeditionPetHint, openPetExpedition, readPetExpeditionPetHint } from "./pet-expedition-navigation.js";

test("expedition timer navigation selects the intended pet and opens the Yard", () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { sessionStorage: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
        } },
    });
    let screen = "";
    openPetExpedition("pet-ready", (value) => { screen = value; });
    assert.equal(screen, "pets");
    assert.equal(readPetExpeditionPetHint(), "pet-ready");
    clearPetExpeditionPetHint();
    assert.equal(readPetExpeditionPetHint(), null);
    Reflect.deleteProperty(globalThis, "window");
});
