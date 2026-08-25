import assert from "node:assert/strict";
import { test } from "node:test";
import {
    clearPetArenaNavigationHint,
    clearPetColosseumPetHint,
    openPetArenaView,
    openPetColosseum,
    readPetArenaPetHint,
    readPetArenaViewHint,
    readPetColosseumPetHint,
} from "./pet-arena-navigation";

type StorageStub = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function withSessionStorage(storage: StorageStub, run: () => void): void {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { sessionStorage: storage },
    });
    try {
        run();
    } finally {
        if (originalWindow === undefined) delete (globalThis as { window?: Window }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
}

test("Pet Yard can deep-link directly to Tactical Arena", () => {
    const values = new Map<string, string>();
    const storage: StorageStub = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value); },
        removeItem: (key) => { values.delete(key); },
    };

    withSessionStorage(storage, () => {
        let destination = "";
        openPetArenaView("tactical", (screen) => { destination = screen; }, "eclipse-kitsune");
        assert.equal(destination, "petArena");
        assert.equal(readPetArenaViewHint(), "tactical");
        assert.equal(readPetArenaPetHint(), "eclipse-kitsune");
        assert.equal(readPetArenaViewHint(), "tactical", "Strict Mode can safely initialize twice");
        assert.equal(readPetArenaPetHint(), "eclipse-kitsune", "the selected pet hint is pure too");
        clearPetArenaNavigationHint();
        assert.equal(readPetArenaViewHint(), "battle", "the committed Arena mount clears the hint");
        assert.equal(readPetArenaPetHint(), null);
    });
});

test("Pet Yard can deploy its selected contender into the Colosseum lobby", () => {
    const values = new Map<string, string>();
    const storage: StorageStub = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value); },
        removeItem: (key) => { values.delete(key); },
    };

    withSessionStorage(storage, () => {
        let destination = "";
        openPetColosseum("eclipse-kitsune", (screen) => { destination = screen; });
        assert.equal(destination, "petColiseum");
        assert.equal(readPetColosseumPetHint(), "eclipse-kitsune");
        clearPetColosseumPetHint();
        assert.equal(readPetColosseumPetHint(), null);
    });
});

test("Pet Arena safely defaults when session storage is unavailable", () => {
    const storage: StorageStub = {
        getItem: () => { throw new Error("blocked"); },
        setItem: () => { throw new Error("blocked"); },
        removeItem: () => { throw new Error("blocked"); },
    };

    withSessionStorage(storage, () => {
        let destination = "";
        openPetArenaView("tactical", (screen) => { destination = screen; });
        assert.equal(destination, "petArena");
        assert.equal(readPetArenaViewHint(), "battle");
    });
});
