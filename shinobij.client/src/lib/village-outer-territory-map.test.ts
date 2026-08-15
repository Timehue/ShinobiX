import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { SECTOR_FLOOR_SECTORS } from "../data/sector-art-manifest";
import { sectorArtKey, VILLAGE_OUTSKIRTS } from "../../../shared/sector-geo";
import { villageOuterTerritoryMapUrl } from "./village-outer-territory-map";

const expectedUrls: Readonly<Record<string, string>> = {
    "Stormveil Village": "/sector-map/stormveil-outskirts.webp",
    "Ashen Leaf Village": "/sector-map/s40.webp",
    "Moonshadow Village": "/sector-map/moonshadow-outskirts.webp",
    "Frostfang Village": "/sector-map/frostfang-outskirts.webp",
};

test("every village outskirts resolves to an existing painted outer-territory board", () => {
    for (const [village, outskirtsSector] of Object.entries(VILLAGE_OUTSKIRTS)) {
        const url = villageOuterTerritoryMapUrl(village, outskirtsSector + 4);
        assert.equal(url, expectedUrls[village], village);
        assert.match(url, /\.webp$/u, village);
        assert.equal(existsSync(new URL(`../../public${url}`, import.meta.url)), true, `${village}: ${url}`);
    }
});

test("Ashen Leaf's generic board stays pinned to its manifest-backed historical art key", () => {
    const virtualSector = VILLAGE_OUTSKIRTS["Ashen Leaf Village"] + 4;
    const artKey = sectorArtKey(virtualSector);

    assert.equal(virtualSector, 13);
    assert.equal(artKey, 40);
    assert.equal(villageOuterTerritoryMapUrl("Ashen Leaf Village", virtualSector), `/sector-map/s${artKey}.webp`);
    assert.equal(SECTOR_FLOOR_SECTORS.has(artKey), true);
    assert.equal(existsSync(new URL(`../../public/sector-map/s${artKey}.webp`, import.meta.url)), true);
});
