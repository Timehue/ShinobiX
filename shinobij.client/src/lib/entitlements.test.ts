import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canCustomAvatar, maxLoadout, maxPets, maxStoredBloodlines } from "./entitlements";

describe("client supporter entitlement mirror", () => {
    const supporter: Parameters<typeof maxLoadout>[0] = {
        patreon: {
            userId: "entitlement-test-supporter",
            tier: "shinobi-supporter",
            active: true,
            entitledCents: 1_500,
            updatedAt: 1,
        },
    };

    it("matches the canonical jutsu and carried-pet caps", () => {
        assert.equal(maxLoadout({}), 12);
        assert.equal(maxLoadout(supporter), 15);
        assert.equal(maxPets({}), 3);
        assert.equal(maxPets(supporter), 5);
    });

    it("matches the canonical avatar and bloodline perks", () => {
        assert.equal(canCustomAvatar({}), false);
        assert.equal(canCustomAvatar(supporter), true);
        assert.equal(maxStoredBloodlines({}), 1);
        assert.equal(maxStoredBloodlines(supporter), 2);
    });
});
