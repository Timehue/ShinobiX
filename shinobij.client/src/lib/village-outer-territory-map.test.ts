import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { VILLAGE_OUTSKIRTS } from "../../../shared/sector-geo";
import { villageOuterTerritoryMapSector, villageOuterTerritoryMapUrl } from "./village-outer-territory-map";
import { sectorFloorLayout, sectorFloorImage } from "./sector-floor-layout";
import { isWalkableTile, nearestWalkableTile, walkPath } from "../../../shared/sector-walk-mask";

const compoundArtKeys: Readonly<Record<string, number>> = {
    "Stormveil Village": 31,
    "Ashen Leaf Village": 38,
    "Moonshadow Village": 11,
    "Frostfang Village": 47,
};

test("every village outer territory shows its gate compound, including rival visits", () => {
    for (const [village, outskirtsSector] of Object.entries(VILLAGE_OUTSKIRTS)) {
        const url = villageOuterTerritoryMapUrl(village, outskirtsSector + 4);
        assert.equal(villageOuterTerritoryMapSector(village, outskirtsSector + 4), outskirtsSector);
        assert.equal(url, sectorFloorImage(outskirtsSector), village);
        assert.equal(sectorFloorLayout(outskirtsSector)?.village?.name, village);
        const pathname = url.split('?')[0];
        assert.equal(pathname, `/sector-map/s${compoundArtKeys[village]}.webp`);
        assert.equal(existsSync(new URL(`../../public${pathname}`, import.meta.url)), true, `${village}: ${url}`);
        // The target village owns the artwork even when gameplay uses another sector.
        assert.equal(villageOuterTerritoryMapUrl(village, 99), url);
        const arrival = nearestWalkableTile(outskirtsSector, 78);
        assert.equal(isWalkableTile(outskirtsSector, 78), false, 'compound roof is blocked');
        assert.equal(isWalkableTile(outskirtsSector, arrival), true);
        assert.ok(walkPath(outskirtsSector, arrival, sectorFloorLayout(outskirtsSector)!.village!.approach), `${village}: arrival reaches the gate`);
    }
});

test("unknown villages retain the virtual sector artwork fallback", () => {
    assert.equal(villageOuterTerritoryMapSector("Unknown Village", 13), 13);
    assert.equal(villageOuterTerritoryMapUrl("Unknown Village", 13), sectorFloorImage(13));
    assert.equal(villageOuterTerritoryMapUrl("Unknown Village", 999), "/sector-map/s999.webp");
});
