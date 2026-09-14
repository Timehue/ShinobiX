import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STARTING_STAT_POINTS } from "../constants/game";
import { starterSavedBloodlines } from "../data/jutsu";
import { maxChakraForLevel, maxHpForLevel, maxStaminaForLevel } from "./stats";
import { createAdminCharacter, createCharacter } from "./create-character";

/*
 * Characterization tests for the client-side first-save grant.
 *
 * These pin current behaviour rather than preferred behaviour: the values below
 * are an economy surface (starting ryo, stat pool, starter loadout) that the
 * server deliberately mirrors in api/save/_first-save-baseline.ts, so a diff
 * here should be a deliberate, visible balance change on both sides.
 *
 * Like normalizeCharacter next door, this shipped with no direct coverage for as
 * long as it lived in App.tsx — App imports a .webp, so node:test could never
 * load it. It can now.
 */

const NEW = () => createCharacter("Rookie", "Stormveil Village", "Ninjutsu", "Ashen Eyes");

describe("createCharacter — the starting grant", () => {
    it("grants the economy values the server baseline mirrors", () => {
        const c = NEW();
        assert.equal(c.ryo, 100);
        assert.deepEqual(c.inventory, ["rustfang-kunai", "shinobi-vest"]);
        assert.equal(c.unspentStats, STARTING_STAT_POINTS);
        assert.equal(c.bankRyo, 0);
        assert.equal(c.honorSeals, 0);
        assert.equal(c.fateShards, 0);
        assert.equal(c.auraDust, 0);
        assert.equal(c.auraSphereLevel, 1);
    });

    it("starts at level 1 with full vitals from the level curve", () => {
        const c = NEW();
        assert.equal(c.level, 1);
        assert.equal(c.rankTitle, "Academy Student");
        assert.equal(c.hp, maxHpForLevel(1));
        assert.equal(c.maxHp, maxHpForLevel(1));
        assert.equal(c.chakra, maxChakraForLevel(1));
        assert.equal(c.maxChakra, maxChakraForLevel(1));
        assert.equal(c.stamina, maxStaminaForLevel(1));
        assert.equal(c.maxStamina, maxStaminaForLevel(1));
    });

    it("opens onboarding in the intro cinematic", () => {
        assert.equal(NEW().onboardingStep, "academyIntro");
    });

    it("seeds the bloodline's jutsu at mastery 1 but equips only three", () => {
        const bloodline = starterSavedBloodlines.find((b) => b.name === "Ashen Eyes");
        assert.ok(bloodline, "fixture bloodline 'Ashen Eyes' must exist");
        const ids = bloodline.jutsus.map((j) => j.id);
        const c = NEW();

        assert.deepEqual(c.jutsuMastery, ids.map((id) => ({ jutsuId: id, level: 1, xp: 0 })));
        assert.deepEqual(c.equippedJutsuIds, ids.slice(0, 3));
        // The universal "Flicker" is deliberately NOT seeded — the guided first
        // session has the player free-unlock it ("first jutsu is free").
        assert.ok(!c.equippedJutsuIds.some((id) => id.includes("flicker")));
    });

    it("maps the 'Blue Blade Eyes' pick onto the Ashen Eyes loadout", () => {
        const aliased = createCharacter("Rookie", "Stormveil Village", "Ninjutsu", "Blue Blade Eyes");
        // The stored bloodline keeps the player's pick; only the loadout aliases.
        assert.equal(aliased.bloodline, "Blue Blade Eyes");
        assert.deepEqual(aliased.equippedJutsuIds, NEW().equippedJutsuIds);
    });

    it("leaves an unknown bloodline with an empty loadout rather than throwing", () => {
        const c = createCharacter("Rookie", "Stormveil Village", "Ninjutsu", "No Such Bloodline");
        assert.deepEqual(c.equippedJutsuIds, []);
        assert.deepEqual(c.jutsuMastery, []);
    });

    it("carries the requested identity through", () => {
        const c = createCharacter("Rookie", "Emberfall Village", "Taijutsu", "Ashen Eyes");
        assert.equal(c.name, "Rookie");
        assert.equal(c.village, "Emberfall Village");
        assert.equal(c.storyVillage, "Emberfall Village");
        assert.equal(c.specialty, "Taijutsu");
    });
});

describe("createAdminCharacter — overrides layered on the grant", () => {
    it("skips onboarding and arrives maxed", () => {
        const a = createAdminCharacter();
        assert.equal(a.onboardingStep, "done");
        assert.equal(a.level, 100);
        assert.equal(a.rankTitle, "Admin");
        assert.equal(a.unspentStats, 0);
        assert.equal(a.hp, maxHpForLevel(100));
        assert.equal(a.maxChakra, maxChakraForLevel(100));
        assert.equal(a.maxStamina, maxStaminaForLevel(100));
    });

    it("defaults to Admin 1 and honours an explicit account", () => {
        assert.equal(createAdminCharacter().name, "Admin 1");
        assert.equal(createAdminCharacter("Admin 2").name, "Admin 2");
    });

    it("keeps the base grant's fields where it does not override them", () => {
        // Inventory is not in the override list, so it must still be the starter kit.
        assert.deepEqual(createAdminCharacter().inventory, ["rustfang-kunai", "shinobi-vest"]);
    });
});
