import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sectorWandererHomeTile } from "./wanderer-placement";
import { synthChronicleScribe } from "./chronicle-scribe";
import { synthSageWanderer } from "./legacy";
import { synthRiftGiver } from "./hollow-rifts";
import { synthStoryReckoningWanderer } from "./story-reckonings";
import { synthRoadWanderer } from "./story-road-events";
import { petMentorWandererFor } from "./pet-tutorial-mentor";
import { hollowRifts } from "../data/hollow-rifts";
import { storyReckonings } from "../data/story-reckonings";
import { storyRoadEvents } from "../data/story-road-events";
import type { Character } from "../types/character";
import type { Wanderer } from "./wanderers";

describe("recurring wanderer placement", () => {
    it("varies across sectors while remaining stable and inside the map", () => {
        for (const id of ["chronicle-scribe", "legacy-sage", "story-road-test", "pet-mentor-tomoe:1"]) {
            const tiles = Array.from({ length: 64 }, (_, sector) => sectorWandererHomeTile(id, sector + 1));
            assert.equal(new Set(tiles).size, 64, `${id} should not return to the same area on nearby maps`);
            for (let sector = 1; sector <= 64; sector++) {
                const tile = tiles[sector - 1];
                assert.equal(tile, sectorWandererHomeTile(id, sector));
                assert.ok(tile % 12 >= 2 && tile % 12 <= 9);
                assert.ok(Math.floor(tile / 12) >= 2 && Math.floor(tile / 12) <= 9);
            }
        }
    });

    it("is used by each formerly fixed-row story and service character", () => {
        const mentorCharacter = { level: 100, pets: [{}] } as unknown as Pick<Character, "level" | "pets" | "petTutorialProgress">;
        const sources: Record<string, (sector: number) => Wanderer> = {
            scribe: synthChronicleScribe,
            sage: synthSageWanderer,
            rift: (sector) => synthRiftGiver(hollowRifts[0], sector),
            reckoning: (sector) => synthStoryReckoningWanderer(storyReckonings[0], sector),
            road: (sector) => synthRoadWanderer(storyRoadEvents[0], sector),
            mentor: (sector) => petMentorWandererFor(mentorCharacter, sector)[0],
        };
        for (const [name, create] of Object.entries(sources)) {
            const wanderers = Array.from({ length: 8 }, (_, index) => create(index + 1));
            assert.equal(new Set(wanderers.map((wanderer) => wanderer.homeTile)).size, 8,
                `${name} should appear in different areas on consecutive maps`);
            for (const wanderer of wanderers) {
                assert.equal(wanderer.movement, "stationary", `${name} should stay passive`);
                assert.deepEqual(wanderer.waypoints, [wanderer.homeTile]);
            }
        }
    });
});
