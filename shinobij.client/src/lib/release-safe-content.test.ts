import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { CreatorEvent } from "../types/vn";
import { isReleaseSafeClientEvent } from "./release-safe-content";

const narrative = (overrides: Partial<CreatorEvent> = {}): CreatorEvent => ({
    id: "event-test",
    name: "Test Event",
    biome: "forest",
    icon: "T",
    eventKind: "visualNovel",
    levelReq: 1,
    xpReward: 0,
    ryoReward: 0,
    staminaReward: 0,
    dialogue: ["Hello"],
    vnPages: [{ title: "Page", scene: "", speaker: "Guide", dialogue: ["Hello"], choices: [] }],
    ...overrides,
});

describe("release-safe creator content", () => {
    it("allows a presentation-only visual novel", () => {
        assert.equal(isReleaseSafeClientEvent(narrative()), true);
    });

    it("rejects every unsupported reward or progression hook", () => {
        assert.equal(isReleaseSafeClientEvent(narrative({ ryoReward: 1 })), false);
        assert.equal(isReleaseSafeClientEvent(narrative({ currencyRewards: { fateShards: 1 } })), false);
        assert.equal(isReleaseSafeClientEvent(narrative({ kageFinale: true })), false);
        assert.equal(isReleaseSafeClientEvent(narrative({ vnPages: [{ title: "", scene: "", speaker: "", dialogue: [], choices: [{ text: "Grow", nextPage: 0, trait: "power" }] }] })), false);
        assert.equal(isReleaseSafeClientEvent(narrative({ vnPages: [{ title: "", scene: "", speaker: "", dialogue: [], choices: [{ text: "Fight", nextPage: 0, battle: { encounterType: "ai" } }] }] })), false);
    });
});
