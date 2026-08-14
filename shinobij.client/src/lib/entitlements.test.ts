import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { activeCarriedPetIds, activeCarriedPets, canCustomAvatar, maxLoadout, maxPets, maxStoredBloodlines, PET_CAP_BASE } from "./entitlements";
import { TACTICAL_ARENA_PET_REQUIREMENT } from "./pet";

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
        assert.equal(maxPets({}), 4);
        assert.equal(maxPets(supporter), 6);
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
        assert.deepEqual(activeCarriedPetIds(character), ["pet-6", "pet-5", "pet-1", "pet-2"]);
        assert.deepEqual(activeCarriedPets(character).map(({ id }) => id), ["pet-6", "pet-5", "pet-1", "pet-2"]);
        assert.equal(activeCarriedPets({ ...character, ...supporter }).length, 6);
        assert.equal(character.pets.length, 6);
    });
});
