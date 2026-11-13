import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
};

test("2D/3D avatar choice is saved on this device and 3D is the default", async () => {
    const { saveWorldAvatar2d } = await import("./sector-obstacles");
    assert.equal(store.get("worldAvatarMode.v1"), undefined);
    saveWorldAvatar2d(true);
    assert.equal(store.get("worldAvatarMode.v1"), "2d");
    saveWorldAvatar2d(false);
    assert.equal(store.get("worldAvatarMode.v1"), "3d");
});

test("every world view reads the model art through the 2D/3D preference", () => {
    const worldViews = [
        "../components/ContinuousWorldSector.tsx", "../components/ContinuousWorldPeers.tsx",
        "../components/SectorWanderer.tsx", "../components/SectorWeeklyBossActor.tsx",
        "../features/anbuInfiltration/StrongholdExplore.tsx", "../features/anbuInfiltration/StrongholdDefender.tsx",
        "../features/hollowGate/HollowGateShrineView.tsx",
    ];
    for (const file of worldViews) {
        const source = readFileSync(new URL(file, import.meta.url), "utf8");
        assert.match(source, /useWorldModelArtBase\(\)/, file);
        assert.doesNotMatch(source, /useSectorModelArtBase/, file);
    }
});
