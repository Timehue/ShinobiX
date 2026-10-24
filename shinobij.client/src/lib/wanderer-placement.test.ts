import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sectorStrideTile, sectorWandererHomeTile } from "./wanderer-placement";
import { loiterRouteTiles } from "./wanderer-loiter";
import { synthChronicleScribe } from "./chronicle-scribe";
import { synthSageWanderer } from "./legacy";
import { synthRiftGiver } from "./hollow-rifts";
import { synthStoryReckoningWanderer } from "./story-reckonings";
import { synthRoadWanderer } from "./story-road-events";
import { petMentorWandererFor } from "./pet-tutorial-mentor";
import { rollEmissarySpawn, EMISSARY_DEFS } from "./legacy-emissaries";
import { hollowRifts } from "../data/hollow-rifts";
import { storyReckonings } from "../data/story-reckonings";
import { storyRoadEvents } from "../data/story-road-events";
import { lifeStandingTiles } from "../../../shared/sector-life-standing";
import { isWalkableTile, nearestWalkableTile } from "../../../shared/sector-walk-mask";
import { PLAYABLE_WILD_SECTOR_IDS, WILD_SECTOR_IDS } from "../../../shared/sector-geo";
import { wandererDayBucketFromMs } from "../../../shared/wanderer-roster";
import type { Character } from "../types/character";
import type { Wanderer } from "./wanderers";

const gap = (a: number, b: number) => Math.max(Math.abs(a % 12 - b % 12), Math.abs(Math.floor(a / 12) - Math.floor(b / 12)));
/** The nearest resident standing tile, in tiles (1 = beside it, 0 = on it). */
const residentGap = (sector: number, tile: number) => lifeStandingTiles(sector).reduce((least, other) => Math.min(least, gap(tile, other)), Infinity);

const walkGap = (id: string, sector: number, home: number) =>
    Math.min(...loiterRouteTiles(id, home, (tile) => isWalkableTile(sector, tile)).map((tile) => residentGap(sector, tile)));
const INTERIOR = Array.from({ length: 64 }, (_, i) => (2 + Math.floor(i / 8)) * 12 + 2 + i % 8);

/** The actor never stands on or beside a resident's standing tile, and never walks
 *  onto one. Wherever the sector has room for it, the whole walk keeps a free tile
 *  between the actor and every resident. */
function assertClearOfResidents(wanderer: Wanderer, sector: number) {
    const label = `${wanderer.name} (${wanderer.id}) at tile ${wanderer.homeTile} in sector ${sector}`;
    assert.ok(isWalkableTile(sector, wanderer.homeTile), `${label} stands on walkable ground`);
    assert.ok(residentGap(sector, wanderer.homeTile) >= 2, `${label} stands on or beside a resident`);
    const walk = walkGap(wanderer.id, sector, wanderer.homeTile);
    assert.ok(walk >= 1, `${label} walks onto a resident's tile`);
    const room = INTERIOR.some((tile) => isWalkableTile(sector, tile) && walkGap(wanderer.id, sector, tile) >= 2);
    if (room) assert.ok(walk >= 2, `${label} walks beside a resident although the sector has room`);
}

describe("recurring wanderer placement", () => {
    it("varies across sectors while remaining stable and inside the map", () => {
        for (const id of ["chronicle-scribe", "legacy-sage", "story-road-test", "pet-mentor-tomoe:1"]) {
            const tiles = Array.from({ length: 64 }, (_, sector) => sectorStrideTile(id, sector + 1));
            assert.equal(new Set(tiles).size, 64, `${id} should not return to the same area on nearby maps`);
            for (let sector = 1; sector <= 64; sector++) {
                const tile = tiles[sector - 1];
                assert.equal(tile, sectorStrideTile(id, sector));
                assert.equal(sectorWandererHomeTile(id, sector), sectorWandererHomeTile(id, sector));
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
            // Stepping off a resident can land two maps five apart on one tile
            // (adjacent stride tiles), so only neighbouring maps must differ here.
            for (let i = 1; i < wanderers.length; i++) assert.notEqual(wanderers[i].homeTile, wanderers[i - 1].homeTile,
                `${name} should appear in different areas on consecutive maps`);
            for (const wanderer of wanderers) {
                assert.equal(wanderer.movement, "stationary", `${name} should stay passive`);
                assert.deepEqual(wanderer.waypoints, [wanderer.homeTile]);
            }
        }
    });

    it("keeps the stride tile wherever no resident is near it", () => {
        for (const sector of WILD_SECTOR_IDS) for (const id of ["chronicle-scribe", "legacy-sage", ...storyRoadEvents.map((event) => event.id)]) {
            const stride = nearestWalkableTile(sector, sectorStrideTile(id, sector));
            const walk = loiterRouteTiles(id, stride, (tile) => isWalkableTile(sector, tile));
            if (walk.every((tile) => residentGap(sector, tile) >= 2)) assert.equal(sectorWandererHomeTile(id, sector), stride, `${id} in sector ${sector}`);
        }
    });
});

describe("quest givers and sector residents", () => {
    it("never put a story, rift, reckoning or service giver on or beside a resident's standing tile", () => {
        const mentorCharacter = { level: 100, pets: [{}] } as unknown as Pick<Character, "level" | "pets" | "petTutorialProgress">;
        for (const sector of PLAYABLE_WILD_SECTOR_IDS) {
            const givers = [
                synthChronicleScribe(sector),
                synthSageWanderer(sector),
                ...petMentorWandererFor(mentorCharacter, sector),
                ...hollowRifts.map((rift) => synthRiftGiver(rift, sector)),
                ...storyReckonings.map((quest) => synthStoryReckoningWanderer(quest, sector)),
                ...storyRoadEvents.map((event) => synthRoadWanderer(event, sector)),
            ];
            for (const giver of givers) assertClearOfResidents(giver, sector);
        }
    });

    it("never put a Legacy Emissary on or beside a resident's standing tile, in either spawn mode", () => {
        let roaming = 0, fixed = 0;
        for (let bucket = 9000; bucket < 9120; bucket++) {
            for (const sector of PLAYABLE_WILD_SECTOR_IDS) {
                const spawn = rollEmissarySpawn("aki", 60, null, bucket, sector);
                if (!spawn) continue;
                roaming++;
                assertClearOfResidents(spawn.wanderer, spawn.sector);
            }
            for (const def of EMISSARY_DEFS) {
                const spawn = rollEmissarySpawn("aki", 60, def.categories[0], bucket);
                if (!spawn) continue;
                fixed++;
                if (PLAYABLE_WILD_SECTOR_IDS.includes(spawn.sector)) assertClearOfResidents(spawn.wanderer, spawn.sector);
            }
        }
        assert.ok(roaming > 50 && fixed > 50, `probe range exercised both modes (${roaming} roaming, ${fixed} fixed)`);
    });

    it("moves Mapless Ojii off Gen's road stop in sector 55 (2026-10-23, 18:00-24:00 UTC)", () => {
        const bucket = wandererDayBucketFromMs(Date.UTC(2026, 9, 23, 18));
        const spawn = rollEmissarySpawn("auditninja", 85, null, bucket, 55);
        assert.ok(spawn);
        assert.equal(spawn.def.slug, "mapless-ojii");
        assert.ok(lifeStandingTiles(55).includes(70), "Gen rests at tile 70");
        assert.ok(gap(spawn.wanderer.homeTile, 70) >= 2, `Ojii stands at ${spawn.wanderer.homeTile}, beside Gen's 70`);
        assertClearOfResidents(spawn.wanderer, 55);
    });
});
