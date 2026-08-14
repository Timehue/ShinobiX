import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { activeCarriedPetIds, activeCarriedPets, activeJutsuLoadoutIds, activeStoredBloodlineIds, canCustomAvatar, maxLoadout, maxPets, maxStoredBloodlines, storedBloodlinesAfterCreate } from "./entitlements";

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

    it("keeps lapsed jutsu preferences dormant without deleting them", () => {
        const equippedJutsuIds = Array.from({ length: 15 }, (_, index) => `jutsu-${index + 1}`);
        assert.deepEqual(activeJutsuLoadoutIds({ equippedJutsuIds }), equippedJutsuIds.slice(0, 12));
        assert.deepEqual(
            activeJutsuLoadoutIds({ ...supporter, equippedJutsuIds }),
            equippedJutsuIds,
        );
        assert.equal(equippedJutsuIds.length, 15, "the projection must not mutate saved preferences");
    });

    it("matches the canonical avatar and bloodline perks", () => {
        assert.equal(canCustomAvatar({}), false);
        assert.equal(canCustomAvatar(supporter), true);
        assert.equal(maxStoredBloodlines({}), 1);
        assert.equal(maxStoredBloodlines(supporter), 2);
    });

    it("mirrors equipped-first active storage while preserving overflow", () => {
        const stored = [{ id: "first" }, { id: "equipped" }, { id: "legacy-overflow" }];
        assert.deepEqual(activeStoredBloodlineIds({ equippedBloodlineId: "equipped" }, stored), ["equipped"]);
        assert.deepEqual(
            activeStoredBloodlineIds({ ...supporter, equippedBloodlineId: "equipped" }, stored),
            ["equipped", "first"],
        );
        assert.equal(stored.length, 3);
    });

    it("keeps lapsed overflow in local state when a Base account replaces its active bloodline", () => {
        const stored = [{ id: "active" }, { id: "preserved-overflow" }];
        assert.deepEqual(
            storedBloodlinesAfterCreate({ equippedBloodlineId: "active" }, stored, { id: "replacement" }),
            [{ id: "replacement" }, { id: "preserved-overflow" }],
        );
        assert.deepEqual(
            storedBloodlinesAfterCreate(supporter, [{ id: "first" }], { id: "second" }),
            [{ id: "second" }, { id: "first" }],
        );
    });

    it("mirrors the stable 4/6 carried-pet projection without dropping overflow", () => {
        const pets = Array.from({ length: 6 }, (_, index) => ({ id: `pet-${index + 1}` }));
        const lapsed = { activePetId: "pet-6", activePetId2v2: "pet-5", pets };
        assert.deepEqual(activeCarriedPetIds(lapsed), ["pet-6", "pet-5", "pet-1", "pet-2"]);
        assert.deepEqual(activeCarriedPets(lapsed).map(({ id }) => id), ["pet-6", "pet-5", "pet-1", "pet-2"]);
        assert.equal(pets.length, 6);
        assert.equal(activeCarriedPets({ ...lapsed, ...supporter }).length, 6);
    });
});
