import { test } from "node:test";
import assert from "node:assert/strict";
import type { Screen } from "../types/core";
import { activateGameNotification } from "./use-notifications";
import { buildNotifications } from "./notifications-core";

function withSessionStorage<T>(run: (store: Map<string, string>) => T): T {
    const store = new Map<string, string>();
    const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } },
    });
    try {
        return run(store);
    } finally {
        if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
        else delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    }
}

const chipFor = (battle: Screen) => buildNotifications({ battle, territoryBreach: null, clanWar: null, villageWar: null, tournament: null })[0];

test("clicking the in-battle chip navigates back to the fight", () => {
    withSessionStorage((store) => {
        const visited: Screen[] = [];
        activateGameNotification(chipFor("hollowGateShrine"), (screen) => visited.push(screen));
        assert.deepEqual(visited, ["hollowGateShrine"]);
        assert.equal(store.has("worldCrisis.focus"), false);
    });
});

test("a World Crisis chip opens the Level 80 tab that resumes the fight", () => {
    withSessionStorage((store) => {
        const visited: Screen[] = [];
        activateGameNotification(chipFor("worldCrisis"), (screen) => visited.push(screen));
        assert.deepEqual(visited, ["worldCrisis"]);
        // WorldCrisis.tsx reads this once on mount to pick the "80" chronicle.
        assert.equal(store.get("worldCrisis.focus"), "80");
    });
});
