import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { activeCarriedPetIds, activeCarriedPets, activeTrainingPetIds, canCustomAvatar, maxLoadout, maxPets, maxStoredBloodlines, PET_CAP_BASE } from "./entitlements";
import { TACTICAL_ARENA_PET_REQUIREMENT } from "./pet";
import { maxLoadout as serverMaxLoadout } from "../../../api/_entitlements";

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
        assert.equal(maxLoadout({}), 14);
        assert.equal(maxLoadout(supporter), 15);
        assert.equal(maxPets({}), 5);
        assert.equal(maxPets(supporter), 6);
    });

    it("matches the server's 14/15 capacity for missing, inactive and expired subscriptions", () => {
        for (const character of [undefined, null, {}, supporter,
            { patreon: { ...supporter.patreon!, active: false } },
            { patreon: { ...supporter.patreon!, expiresAt: Date.now() - 1 } },
            { patreon: { ...supporter.patreon!, expiresAt: Date.now() + 60_000 } }]) {
            assert.equal(maxLoadout(character), serverMaxLoadout(character));
        }
    });

    it("ends the fifteenth regular slot at the exact expiry on both client and server", (t) => {
        let now = 9_999;
        t.mock.method(Date, "now", () => now);
        const character = { patreon: { ...supporter.patreon!, expiresAt: 10_000 } };
        for (const [at, cap] of [[9_999, 15], [10_000, 14], [10_001, 14]] as const) {
            now = at;
            assert.equal(maxLoadout(character), cap);
            assert.equal(serverMaxLoadout(character), cap);
        }
    });

    it("lets every account carry the full Tactical Arena team", () => {
        assert.ok(PET_CAP_BASE >= TACTICAL_ARENA_PET_REQUIREMENT);
    });

    it("matches the canonical avatar and bloodline perks", () => {
        assert.equal(canCustomAvatar({}), false);
        assert.equal(canCustomAvatar(supporter), true);
        assert.equal(maxStoredBloodlines({}), 1);
        assert.equal(maxStoredBloodlines(supporter), 2);
    });

    it("keeps six owned pets while projecting only the entitled carried roster", () => {
        const pets = Array.from({ length: 6 }, (_, index) => ({ id: `pet-${index + 1}` }));
        const character = { pets, activePetId: "pet-6", activePetId2v2: "pet-5" };
        assert.deepEqual(activeCarriedPetIds(character), ["pet-6", "pet-5", "pet-1", "pet-2", "pet-3"]);
        assert.deepEqual(activeCarriedPets(character).map(({ id }) => id), ["pet-6", "pet-5", "pet-1", "pet-2", "pet-3"]);
        assert.equal(activeCarriedPets({ ...character, ...supporter }).length, 6);
        assert.deepEqual(activeTrainingPetIds({ ...character, ...supporter }), ["pet-6", "pet-5", "pet-1", "pet-2", "pet-3"]);
        assert.equal(character.pets.length, 6);
    });
});
