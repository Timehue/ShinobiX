import { test } from "node:test";
import assert from "node:assert/strict";
import { isSectorLivePeersEnabled } from "../components/sector-peers-flag";
import { isVillageWarMapEnabled } from "./village-war-map";
import { isLegacyEnabled, isLegacyMutationEnabled } from "./legacy";
import { liveCapabilitiesStore } from "./live-capabilities";
import { petAccuracyEnabled, petDuelEngineEnabled, petArenaV2Enabled, petPlayerControlEnabled, petRankedChallengeEnabled, PET_ACCURACY_DEFAULT } from "./pet-coliseum-flag";

/*
 * Gameplay layers and combat rules are NOT per-device. Each of these used to be a
 * localStorage kill switch, which let one browser see a different world (no
 * peers, no war, no legacy) or resolve the same seeded fight under different
 * rules than everyone else — and than the server's Node replay. They are now
 * constants; these tests pin that a stored opt-out is ignored, in Node (no
 * localStorage) AND with a fake localStorage carrying every retired "off" value.
 */

function withFakeLocalStorage<T>(values: Record<string, string>, run: () => T): T {
    const g = globalThis as unknown as { localStorage?: unknown; window?: unknown };
    const hadLs = Object.prototype.hasOwnProperty.call(g, "localStorage");
    const hadWin = Object.prototype.hasOwnProperty.call(g, "window");
    const prevLs = g.localStorage;
    const prevWin = g.window;
    const store = new Map(Object.entries(values));
    const fake = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
        removeItem: (k: string) => { store.delete(k); },
    };
    g.localStorage = fake;
    g.window = { localStorage: fake };
    try {
        return run();
    } finally {
        if (hadLs) g.localStorage = prevLs; else delete g.localStorage;
        if (hadWin) g.window = prevWin; else delete g.window;
    }
}

const RETIRED_OPT_OUTS = {
    "sectorPeers.v1": "off",
    "villageWarMap.v1": "0",
    "legacy.v1": "off",
    "petAccuracy.v1": "0",
    "petDuelEngine.v1": "0",
    "petArenaV2.v1": "0",
    "petPlayerControl.v1": "0",
};

test("gameplay layers are always on in Node (no window / localStorage)", () => {
    assert.equal(isSectorLivePeersEnabled(), true);
    assert.equal(isVillageWarMapEnabled(), true);
});

test("gameplay layers ignore every retired per-device opt-out", () => {
    withFakeLocalStorage(RETIRED_OPT_OUTS, () => {
        assert.equal(isSectorLivePeersEnabled(), true, "sectorPeers.v1=off is dead");
        assert.equal(isVillageWarMapEnabled(), true, "villageWarMap.v1=0 is dead");
    });
});

test("legacy: the client preference is gone — only the SERVER capability gates it", () => {
    // Default store snapshot → capability unknown/unavailable → off, regardless of storage.
    withFakeLocalStorage({}, () => {
        assert.equal(isLegacyEnabled(), isLegacyEnabled(), "deterministic");
    });
    const before = liveCapabilitiesStore.getSnapshot();
    const on = withFakeLocalStorage({ "legacy.v1": "off" }, () => ({ view: isLegacyEnabled(), mutate: isLegacyMutationEnabled() }));
    const off = withFakeLocalStorage({}, () => ({ view: isLegacyEnabled(), mutate: isLegacyMutationEnabled() }));
    assert.deepEqual(on, off, "legacy.v1=off must change nothing — the server decides");
    assert.equal(liveCapabilitiesStore.getSnapshot(), before, "reading the flag never touches the capability store");
});

test("combat rules are constants: identical in Node and under a retired opt-out", () => {
    const inNode = [petAccuracyEnabled(), petDuelEngineEnabled(), petArenaV2Enabled(), petPlayerControlEnabled()];
    assert.deepEqual(inNode, [true, true, true, true]);
    assert.equal(PET_ACCURACY_DEFAULT, true);
    withFakeLocalStorage(RETIRED_OPT_OUTS, () => {
        assert.deepEqual(
            [petAccuracyEnabled(), petDuelEngineEnabled(), petArenaV2Enabled(), petPlayerControlEnabled()],
            inNode,
            "a browser with every retired kill switch set must resolve fights exactly like Node",
        );
    });
    assert.equal(petRankedChallengeEnabled(), false, "ranked pet challenges stay hard-off");
});
