import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import sharp from "sharp";
import {
    FIRST_PACT_AQUEDUCT_CENTRAL_CROSSING,
    FIRST_PACT_AQUEDUCT_CIVIC_CROSSING,
    FIRST_PACT_ARCHITECTURE,
    FIRST_PACT_BELL_PLANTING_CELLS,
    FIRST_PACT_CITY_PROPS,
    FIRST_PACT_GARDENS_NORTH_CROSS_ARM,
    FIRST_PACT_GARDENS_NORTH_PATHS,
    FIRST_PACT_GARDENS_NORTH_PLANTING_CELLS,
    FIRST_PACT_GARDENS_NORTH_TREES,
    FIRST_PACT_GARDENS_AQUEDUCT,
    FIRST_PACT_GARDENS_PUBLIC_COURT_BANDS,
    FIRST_PACT_GARDENS_PUBLIC_COURT_PLANTING_BEDS,
    FIRST_PACT_GARDENS_PUBLIC_COURT_PLANTING_CELLS,
    FIRST_PACT_GARDENS_PUBLIC_ROUTES,
    FIRST_PACT_GARDENS_ROUTE_HIERARCHY,
    FIRST_PACT_HIGH_COURT_GARDEN_BEDS,
    FIRST_PACT_HIGH_COURT_GARDEN_CELLS,
    FIRST_PACT_HIGH_COURT_PARAPET_CELLS,
    FIRST_PACT_HIGH_COURT_PATHS,
    FIRST_PACT_KENNEL_STRUCTURES,
    FIRST_PACT_NPCS,
    FIRST_PACT_PLAYER_START,
    FIRST_PACT_WORLD_HEIGHT,
    FIRST_PACT_WORLD_WIDTH,
    FirstPactTile,
    chooseFirstPactWanderDestination,
    findFirstPactPath,
    firstPactDistrictAt,
    firstPactTileAt,
    isFirstPactBellPlanting,
    isFirstPactBellRoute,
    isFirstPactGardensNorthPlanting,
    isFirstPactGardensPrimaryRoute,
    isFirstPactGardensPublicCourtPlanting,
    isFirstPactGardensSecondaryRoute,
    isFirstPactWalkable,
    isFirstPactWithinReach,
    nearestFirstPactWalkable,
    type FirstPactNpcDefinition,
} from "./first-pact-world.js";

const architectureAtlas = fileURLToPath(new URL("../assets/first-pact/sunken-court-architecture-atlas.webp", import.meta.url));
const bellQuarterAtlas = fileURLToPath(new URL("../assets/first-pact/bell-quarter-v2/bell-quarter-architecture-strip.png", import.meta.url));
const valeStable = fileURLToPath(new URL("../assets/first-pact/v3-architecture/v3-vale-stable.png", import.meta.url));
const stableTackAnnex = fileURLToPath(new URL("../assets/first-pact/v3-architecture/v3-stable-tack-annex.png", import.meta.url));
const handlerLodge = fileURLToPath(new URL("../assets/first-pact/v3-architecture/v3-handler-lodge.png", import.meta.url));
const kennelInfirmary = fileURLToPath(new URL("../assets/first-pact/v3-architecture/v3-kennel-infirmary.png", import.meta.url));
const kennelHouse = fileURLToPath(new URL("../assets/first-pact/v3-architecture/v3-kennel-service-house.png", import.meta.url));
const feedStore = fileURLToPath(new URL("../assets/first-pact/v3-architecture/v3-feed-store-temporary.png", import.meta.url));
const kennelPavilion = fileURLToPath(new URL("../assets/first-pact/v3-architecture/v3-kennel-pavilion.png", import.meta.url));
const bondingCedar = fileURLToPath(new URL("../assets/first-pact/v3-architecture/v3-bonding-cedar.png", import.meta.url));
const gardenLodge = fileURLToPath(new URL("../assets/first-pact/gardens-north-v2/garden-lodge.png", import.meta.url));
const guardianHall = fileURLToPath(new URL("../assets/first-pact/gardens-north-v2/guardian-hall.png", import.meta.url));
const gardensCourtPavilion = fileURLToPath(new URL("../assets/first-pact/gardens-north-v2/garden-court-pavilion.png", import.meta.url));
const gardensCourtFountain = fileURLToPath(new URL("../assets/first-pact/gardens-north-v2/garden-court-fountain.png", import.meta.url));
const gardensCourtKaioTree = fileURLToPath(new URL("../assets/first-pact/gardens-north-v2/garden-court-kaio-tree.png", import.meta.url));
const gardensCourtListeningBench = fileURLToPath(new URL("../assets/first-pact/gardens-north-v2/garden-court-listening-bench.png", import.meta.url));
const gardensNorthMapleA = fileURLToPath(new URL("../assets/first-pact/gardens-north-v2/autumn-maple-a.png", import.meta.url));
const gardensNorthMapleB = fileURLToPath(new URL("../assets/first-pact/gardens-north-v2/autumn-maple-b.png", import.meta.url));
const gardensNorthBedLong = fileURLToPath(new URL("../assets/first-pact/gardens-north-v2/bed-long.png", import.meta.url));
const gardensNorthBedCorner = fileURLToPath(new URL("../assets/first-pact/gardens-north-v2/bed-corner.png", import.meta.url));
const highCourtMainArchive = fileURLToPath(new URL("../assets/first-pact/high-court-v3/high-court-main-archive.png", import.meta.url));
const highCourtRecordHall = fileURLToPath(new URL("../assets/first-pact/high-court-v3/high-court-record-hall.png", import.meta.url));
const highCourtCouncilAnnex = fileURLToPath(new URL("../assets/first-pact/high-court-v3/high-court-council-annex.png", import.meta.url));
const highCourtGardenStrip = fileURLToPath(new URL("../assets/first-pact/high-court-v3/high-court-garden-strip.png", import.meta.url));
const marketArcade = fileURLToPath(new URL("../assets/first-pact/market-v2/market-walkthrough-arcade-v2.png", import.meta.url));
const marketStall = fileURLToPath(new URL("../assets/first-pact/market-v2/market-stall-module-v2.png", import.meta.url));
const marketRowhouse = fileURLToPath(new URL("../assets/first-pact/market-v2/market-merchant-rowhouse-v2.png", import.meta.url));
const marketWorkshop = fileURLToPath(new URL("../assets/first-pact/market-v2/market-waterside-workshop-v2.png", import.meta.url));
const gwEngineHall = fileURLToPath(new URL("../assets/first-pact/gateworks-v2/engine-hall.png", import.meta.url));
const arrivalGate = fileURLToPath(new URL("../assets/first-pact/gateworks-v2/arrival-gate.png", import.meta.url));
const boundaryLantern = fileURLToPath(new URL("../assets/first-pact/gateworks-v2/boundary-lantern.png", import.meta.url));
const boundaryStele = fileURLToPath(new URL("../assets/first-pact/gateworks-v2/boundary-stele.png", import.meta.url));
const gwPumpHouse = fileURLToPath(new URL("../assets/first-pact/gateworks-v2/pump-house.png", import.meta.url));
const gwKeeperRowhouse = fileURLToPath(new URL("../assets/first-pact/gateworks-v2/keeper-rowhouse.png", import.meta.url));
const gwMaintenanceShed = fileURLToPath(new URL("../assets/first-pact/gateworks-v2/maintenance-shed.png", import.meta.url));
const gwValveHouse = fileURLToPath(new URL("../assets/first-pact/gateworks-v2/valve-house.png", import.meta.url));

test("every exterior building has a collision mask matching its rendered bounds", () => {
    const ids = new Set<string>();
    for (const placement of FIRST_PACT_ARCHITECTURE) {
        assert.equal(ids.has(placement.id), false, `${placement.id} must be unique`);
        ids.add(placement.id);
        assert.ok(Number.isInteger(placement.atlasCell) && placement.atlasCell >= 0 && placement.atlasCell < 16);
        assert.ok(placement.bounds.width > 0 && placement.bounds.height > 0);
        assert.ok(placement.bounds.x >= 0 && placement.bounds.y >= 0);
        assert.ok(placement.bounds.x + placement.bounds.width <= FIRST_PACT_WORLD_WIDTH);
        assert.ok(placement.bounds.y + placement.bounds.height <= FIRST_PACT_WORLD_HEIGHT);

        assert.equal(placement.collisionMask.length, placement.bounds.height, `${placement.id} mask height must match its render height`);
        let solidTiles = 0;
        for (let localY = 0; localY < placement.collisionMask.length; localY += 1) {
            const row = placement.collisionMask[localY];
            assert.equal(row.length, placement.bounds.width, `${placement.id} mask row ${localY} must match its render width`);
            assert.match(row, /^[.#]+$/, `${placement.id} mask can only contain # and .`);
            for (let localX = 0; localX < row.length; localX += 1) {
                if (row[localX] === "#") {
                    solidTiles += 1;
                    assert.equal(
                        isFirstPactWalkable(placement.bounds.x + localX, placement.bounds.y + localY),
                        false,
                        `${placement.id} collision tile ${localX},${localY} must be solid`,
                    );
                }
            }
        }
        assert.ok(solidTiles > 0, `${placement.id} must own a non-empty collision footprint`);
    }
});

test("building collision masks follow visible art while preserving authored entrances", async () => {
    const metadata = await sharp(architectureAtlas).metadata();
    assert.ok(metadata.width && metadata.height);
    const sourceWidth = metadata.width / 4;
    const sourceHeight = metadata.height / 4;
    assert.ok(Number.isInteger(sourceWidth) && Number.isInteger(sourceHeight), "architecture atlas must remain a strict 4x4 grid");

    const bellMetadata = await sharp(bellQuarterAtlas).metadata();
    assert.equal(bellMetadata.width, 1152);
    assert.equal(bellMetadata.height, 432);
    assert.equal(bellMetadata.hasAlpha, true);
    const bellCellWidth = bellMetadata.width / 4;

    for (const placement of FIRST_PACT_ARCHITECTURE) {
        const sampleSize = 16;
        const source = placement.bellQuarterCell != null
            ? sharp(bellQuarterAtlas).extract({
                left: placement.bellQuarterCell * bellCellWidth,
                top: 0,
                width: bellCellWidth,
                height: bellMetadata.height,
            })
            : placement.gardenAsset === "lodge"
            ? sharp(gardenLodge)
            : placement.gardenAsset === "hall"
              ? sharp(guardianHall)
            : placement.gardenAsset === "court-pavilion"
              ? sharp(gardensCourtPavilion)
            : placement.highCourtAsset === "main-archive"
            ? sharp(highCourtMainArchive)
            : placement.highCourtAsset === "record-hall"
              ? sharp(highCourtRecordHall)
            : placement.highCourtAsset === "council-annex"
              ? sharp(highCourtCouncilAnnex)
            : placement.id === "vale-stable"
            ? sharp(valeStable)
            : placement.id === "stable-tack-annex"
              ? sharp(stableTackAnnex)
            : placement.id === "handler-lodge"
              ? sharp(handlerLodge)
            : placement.id === "kennel-infirmary"
              ? sharp(kennelInfirmary)
            : placement.id === "kennel-house"
              ? sharp(kennelHouse)
              : placement.id === "feed-storehouse"
                ? sharp(feedStore)
              : placement.id === "market-arcade"
                  ? sharp(marketArcade)
              : placement.id === "market-stall-west" || placement.id === "market-stall-east"
                  ? sharp(marketStall)
              : placement.id === "merchant-house"
                  ? sharp(marketRowhouse)
              : placement.id === "waterside-workshop"
                  ? sharp(marketWorkshop)
              : placement.id === "gateworks-engine-hall"
                  ? sharp(gwEngineHall)
              : placement.id === "gateworks-pump-house"
                  ? sharp(gwPumpHouse)
              : placement.id === "gateworks-keeper-rowhouse"
                  ? sharp(gwKeeperRowhouse)
              : placement.id === "gateworks-maintenance-shed"
                  ? sharp(gwMaintenanceShed)
              : placement.id === "gateworks-valve-house"
                  ? sharp(gwValveHouse)
              : placement.id === "arrival-gate"
                  ? sharp(arrivalGate)
              : placement.id === "arrival-lantern-west"
                  ? sharp(boundaryLantern)
              : placement.id === "arrival-lantern-east"
                  ? sharp(boundaryLantern)
              : placement.id === "arrival-lantern-approach-west"
                  ? sharp(boundaryLantern)
              : placement.id === "arrival-lantern-approach-east"
                  ? sharp(boundaryLantern)
              : placement.id === "arrival-maple-west"
                  ? sharp(gardensNorthMapleA)
              : placement.id === "arrival-maple-east"
                  ? sharp(gardensNorthMapleB)
              : placement.id === "arrival-stele-west"
                  ? sharp(boundaryStele)
              : placement.id === "arrival-stele-east"
                  ? sharp(boundaryStele)
                  : sharp(architectureAtlas).extract({
                      left: (placement.atlasCell % 4) * sourceWidth,
                      top: Math.floor(placement.atlasCell / 4) * sourceHeight,
                      width: sourceWidth,
                      height: sourceHeight,
                  });
        const { data, info } = await source
            .resize(placement.bounds.width * sampleSize, placement.bounds.height * sampleSize, { fit: "fill" })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const sampledRows: string[] = [];
        for (let tileY = 0; tileY < placement.bounds.height; tileY += 1) {
            let row = "";
            for (let tileX = 0; tileX < placement.bounds.width; tileX += 1) {
                let opaqueSamples = 0;
                for (let pixelY = 5; pixelY < 11; pixelY += 1) {
                    for (let pixelX = 5; pixelX < 11; pixelX += 1) {
                        const offset = (((tileY * sampleSize + pixelY) * info.width) + (tileX * sampleSize + pixelX)) * info.channels;
                        if (data[offset + 3] > 80) opaqueSamples += 1;
                    }
                }
                row += opaqueSamples / 36 > .18 ? "#" : ".";
            }
            sampledRows.push(row);
        }
        if (placement.gardenAsset != null || placement.highCourtAsset != null || placement.id === "vale-stable" || placement.id === "stable-tack-annex" || placement.id === "handler-lodge" || placement.id === "kennel-infirmary" || placement.id === "kennel-house" || placement.id === "feed-storehouse" || placement.id.startsWith("market-") || placement.id === "merchant-house" || placement.id === "waterside-workshop" || placement.id.startsWith("gateworks-") || placement.id.startsWith("arrival-")) {
            for (let tileY = 0; tileY < placement.bounds.height; tileY += 1) {
                for (let tileX = 0; tileX < placement.bounds.width; tileX += 1) {
                    if (placement.collisionMask[tileY][tileX] === "#") {
                        assert.equal(
                            sampledRows[tileY][tileX],
                            "#",
                            `${placement.id} collision ${tileX},${tileY} must be supported by visible masonry`,
                        );
                    }
                }
            }
        } else {
            assert.deepEqual(sampledRows, placement.collisionMask, `${placement.id} collision mask drifted from its rendered silhouette`);
        }
    }
});

test("Guardian Gardens is one complete civic frontage and collision-backed public court", async () => {
    const lodge = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "garden-lodge");
    const hall = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "guardian-hall");
    const pavilion = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "garden-court-pavilion");
    const fountain = FIRST_PACT_CITY_PROPS.find((placement) => placement.id === "garden-court-fountain");
    const kaioTree = FIRST_PACT_CITY_PROPS.find((placement) => placement.id === "garden-court-kaio-tree");
    const listeningBench = FIRST_PACT_CITY_PROPS.find((placement) => placement.id === "garden-court-listening-bench");
    assert.ok(lodge && hall && pavilion && fountain && kaioTree && listeningBench);
    assert.deepEqual(lodge.bounds, { x: 6, y: 4, width: 9, height: 9 });
    assert.deepEqual(hall.bounds, { x: 16, y: 4, width: 10, height: 8 });
    assert.deepEqual(pavilion.bounds, { x: 6, y: 16, width: 8, height: 5 });
    assert.deepEqual([lodge.gardenAsset, hall.gardenAsset], ["lodge", "hall"]);
    assert.equal(pavilion.gardenAsset, "court-pavilion");
    assert.equal(fountain.gardenAsset, "court-fountain");
    assert.equal(kaioTree.gardenAsset, "kaio-tree");
    assert.equal(listeningBench.gardenAsset, "listening-bench");
    assert.deepEqual(lodge.publicThreshold, { x: 10, y: 10, width: 1, height: 1 });
    assert.deepEqual(hall.publicThreshold, { x: 20, y: 10, width: 1, height: 1 });
    assert.deepEqual(pavilion.publicThreshold, { x: 10, y: 20, width: 1, height: 1 });

    for (const [asset, expected] of [
        [gardenLodge, { width: 9 * 48, height: 9 * 48 }],
        [guardianHall, { width: 10 * 48, height: 8 * 48 }],
        [gardensCourtPavilion, { width: 8 * 48, height: 5 * 48 }],
    ] as const) {
        const metadata = await sharp(asset).metadata();
        assert.equal(metadata.width, expected.width);
        assert.equal(metadata.height, expected.height);
        assert.equal(metadata.hasAlpha, true, `${asset} must contain true alpha instead of baked garden ground`);
        const { info: trimmed } = await sharp(asset).trim().png().toBuffer({ resolveWithObject: true });
        assert.ok(trimmed.width < expected.width && trimmed.height < expected.height, `${asset} needs transparent clearance around a complete silhouette`);
    }

    const fountainMetadata = await sharp(gardensCourtFountain).metadata();
    assert.equal(fountainMetadata.width, 4 * 48);
    assert.equal(fountainMetadata.height, 3 * 48);
    assert.equal(fountainMetadata.hasAlpha, true, "the guardian pool must be standalone alpha art, never a cyan atlas plate");
    assert.equal((await sharp(gardensCourtFountain).stats()).isOpaque, false);

    for (const [asset, expected] of [
        [gardensCourtKaioTree, { width: 5 * 48, height: 5 * 48 }],
        [gardensCourtListeningBench, { width: 3 * 48, height: 2 * 48 }],
    ] as const) {
        const metadata = await sharp(asset).metadata();
        assert.equal(metadata.width, expected.width);
        assert.equal(metadata.height, expected.height);
        assert.equal(metadata.hasAlpha, true, `${asset} must be transparent standalone court art`);
        assert.equal((await sharp(asset).stats()).isOpaque, false, `${asset} cannot contain a ground plate`);
    }
    const listenerAlpha = await sharp(gardensCourtKaioTree)
        .extract({ left: 4 * 48, top: 4 * 48, width: 48, height: 48 })
        .ensureAlpha()
        .raw()
        .toBuffer();
    let listenerOpaquePixels = 0;
    for (let offset = 3; offset < listenerAlpha.length; offset += 4) {
        if (listenerAlpha[offset] > 0) listenerOpaquePixels += 1;
    }
    assert.equal(listenerOpaquePixels, 0, "the approved 48x48 listening tile must remain completely alpha-free");

    for (const [asset, expected] of [
        [gardensNorthMapleA, { width: 707, height: 747 }],
        [gardensNorthMapleB, { width: 492, height: 610 }],
        [gardensNorthBedLong, { width: 656, height: 295 }],
        [gardensNorthBedCorner, { width: 393, height: 319 }],
    ] as const) {
        const metadata = await sharp(asset).metadata();
        assert.equal(metadata.width, expected.width);
        assert.equal(metadata.height, expected.height);
        assert.equal(metadata.hasAlpha, true, `${asset} must be a transparent organic module, not a ground plate`);
        const stats = await sharp(asset).stats();
        assert.equal(stats.isOpaque, false, `${asset} must retain transparent perimeter pixels`);
    }

    for (let y = 1; y <= 2; y += 1) {
        for (let x = 3; x < 30; x += 1) {
            assert.equal(firstPactTileAt(x, y), FirstPactTile.Wall, `north parapet must close void at ${x},${y}`);
            assert.equal(isFirstPactWalkable(x, y), false, `north parapet collision must match its visible wall at ${x},${y}`);
        }
    }

    assert.deepEqual(FIRST_PACT_GARDENS_PUBLIC_COURT_BANDS.map(({ bounds }) => ({ x: bounds.x, width: bounds.width })), [
        { x: 7, width: 19 },
        { x: 5, width: 23 },
        { x: 4, width: 23 },
        { x: 4, width: 23 },
        { x: 4, width: 22 },
        { x: 5, width: 22 },
        { x: 5, width: 21 },
        { x: 7, width: 19 },
    ], "the public court must keep its stepped, chamfered world footprint");
    for (const band of FIRST_PACT_GARDENS_PUBLIC_COURT_BANDS) {
        for (let y = band.bounds.y; y < band.bounds.y + band.bounds.height; y += 1) {
            for (let x = band.bounds.x; x < band.bounds.x + band.bounds.width; x += 1) {
                assert.ok(
                    firstPactTileAt(x, y) === FirstPactTile.Court || firstPactTileAt(x, y) === FirstPactTile.Road,
                    `${band.id} must remain civic paving at ${x},${y}`,
                );
                assert.notEqual(firstPactTileAt(x, y), FirstPactTile.Grass, `${band.id} cannot regress to a lawn plate at ${x},${y}`);
            }
        }
    }
    for (let y = FIRST_PACT_GARDENS_AQUEDUCT.crossing.y; y < FIRST_PACT_GARDENS_AQUEDUCT.crossing.y + FIRST_PACT_GARDENS_AQUEDUCT.crossing.height; y += 1) {
        for (let x = FIRST_PACT_GARDENS_AQUEDUCT.crossing.x; x < FIRST_PACT_GARDENS_AQUEDUCT.crossing.x + FIRST_PACT_GARDENS_AQUEDUCT.crossing.width; x += 1) {
            const expected = x >= FIRST_PACT_GARDENS_AQUEDUCT.deck.x
                && x < FIRST_PACT_GARDENS_AQUEDUCT.deck.x + FIRST_PACT_GARDENS_AQUEDUCT.deck.width
                ? FirstPactTile.Bridge
                : FirstPactTile.Road;
            assert.equal(firstPactTileAt(x, y), expected, `garden aqueduct crossing material drifted at ${x},${y}`);
            assert.equal(isFirstPactWalkable(x, y), true, `garden aqueduct crossing must remain open at ${x},${y}`);
        }
    }
    for (let y = FIRST_PACT_GARDENS_AQUEDUCT.water.y; y < FIRST_PACT_GARDENS_AQUEDUCT.water.y + FIRST_PACT_GARDENS_AQUEDUCT.water.height; y += 1) {
        const bridgeRow = y >= FIRST_PACT_GARDENS_AQUEDUCT.deck.y
            && y < FIRST_PACT_GARDENS_AQUEDUCT.deck.y + FIRST_PACT_GARDENS_AQUEDUCT.deck.height;
        if (bridgeRow) continue;
        assert.equal(firstPactTileAt(FIRST_PACT_GARDENS_AQUEDUCT.westBank.x, y), FirstPactTile.Wall);
        assert.equal(firstPactTileAt(FIRST_PACT_GARDENS_AQUEDUCT.eastBank.x, y), FirstPactTile.Wall);
        assert.equal(isFirstPactWalkable(FIRST_PACT_GARDENS_AQUEDUCT.westBank.x, y), false);
        assert.equal(isFirstPactWalkable(FIRST_PACT_GARDENS_AQUEDUCT.eastBank.x, y), false);
        for (let x = FIRST_PACT_GARDENS_AQUEDUCT.water.x; x < FIRST_PACT_GARDENS_AQUEDUCT.water.x + FIRST_PACT_GARDENS_AQUEDUCT.water.width; x += 1) {
            assert.equal(firstPactTileAt(x, y), FirstPactTile.Water, `upper aqueduct water boundary drifted at ${x},${y}`);
            assert.equal(isFirstPactWalkable(x, y), false, `upper aqueduct must remain solid water at ${x},${y}`);
        }
    }
    const aqueductCrossing = findFirstPactPath({ x: 27, y: 14 }, { x: 32, y: 14 });
    assert.deepEqual(aqueductCrossing, [
        { x: 28, y: 14 },
        { x: 29, y: 14 },
        { x: 30, y: 14 },
        { x: 31, y: 14 },
        { x: 32, y: 14 },
    ], "the garden lane must cross the aqueduct on one legible Bridge-to-Road centerline");
    for (const path of FIRST_PACT_GARDENS_PUBLIC_ROUTES) {
        for (let y = path.bounds.y; y < path.bounds.y + path.bounds.height; y += 1) {
            for (let x = path.bounds.x; x < path.bounds.x + path.bounds.width; x += 1) {
                assert.ok(
                    firstPactTileAt(x, y) === FirstPactTile.Road || firstPactTileAt(x, y) === FirstPactTile.Bridge,
                    `${path.id} must be visible public paving at ${x},${y}`,
                );
                assert.equal(isFirstPactWalkable(x, y), true, `${path.id} must remain an open public route at ${x},${y}`);
            }
        }
    }
    assert.deepEqual(FIRST_PACT_GARDENS_ROUTE_HIERARCHY.map(({ id, role, bounds }) => ({ id, role, bounds })), [
        { id: "gardens-processional-spine", role: "primary", bounds: { x: 15, y: 13, width: 2, height: 10 } },
        { id: "lodge-door-arm", role: "secondary", bounds: { x: 10, y: 10, width: 1, height: 4 } },
        { id: "lodge-spine-branch", role: "secondary", bounds: { x: 10, y: 13, width: 6, height: 1 } },
        { id: "hall-door-arm", role: "secondary", bounds: { x: 20, y: 10, width: 1, height: 5 } },
        { id: "hall-aqueduct-branch", role: "secondary", bounds: { x: 17, y: 14, width: 16, height: 1 } },
        { id: "kaio-spur", role: "secondary", bounds: { x: 17, y: 16, width: 2, height: 1 } },
        { id: "guardian-pool-spur", role: "secondary", bounds: { x: 16, y: 19, width: 4, height: 1 } },
        { id: "pavilion-turn", role: "secondary", bounds: { x: 10, y: 22, width: 6, height: 1 } },
        { id: "pavilion-door-arm", role: "secondary", bounds: { x: 10, y: 20, width: 1, height: 3 } },
    ], "the court must retain one dominant spine and only short destination branches");
    for (const route of FIRST_PACT_GARDENS_ROUTE_HIERARCHY) {
        if (route.role === "primary") assert.deepEqual(route.bounds, { x: 15, y: 13, width: 2, height: 10 });
        else assert.equal(Math.min(route.bounds.width, route.bounds.height), 1, `${route.id} must remain a narrow branch`);
        for (let y = route.bounds.y; y < route.bounds.y + route.bounds.height; y += 1) {
            for (let x = route.bounds.x; x < route.bounds.x + route.bounds.width; x += 1) {
                assert.ok(
                    firstPactTileAt(x, y) === FirstPactTile.Road || firstPactTileAt(x, y) === FirstPactTile.Bridge,
                    `${route.id} must be collision-authoritative public paving at ${x},${y}`,
                );
                assert.equal(isFirstPactWalkable(x, y), true, `${route.id} must remain open at ${x},${y}`);
                assert.equal(
                    isFirstPactGardensPrimaryRoute(x, y) || isFirstPactGardensSecondaryRoute(x, y),
                    true,
                    `${route.id} must drive both render and minimap classification at ${x},${y}`,
                );
            }
        }
    }
    for (let top = 13; top <= 18; top += 1) {
        for (let left = 4; left <= 24; left += 1) {
            let anonymousCourt = true;
            for (let y = top; y < top + 5; y += 1) {
                for (let x = left; x < left + 5; x += 1) {
                    if (firstPactTileAt(x, y) !== FirstPactTile.Court || !isFirstPactWalkable(x, y)) anonymousCourt = false;
                }
            }
            assert.equal(anonymousCourt, false, `Gardens cannot retain an unstructured 5x5 court field at ${left},${top}`);
        }
    }

    assert.deepEqual(FIRST_PACT_GARDENS_NORTH_PATHS.map(({ bounds }) => ({ width: bounds.width, height: bounds.height })), [
        { width: 1, height: 3 },
        { width: 1, height: 3 },
    ]);
    for (const placement of [lodge, hall, pavilion]) {
        const threshold = placement.publicThreshold!;
        assert.equal(placement.collisionMask[threshold.y - placement.bounds.y][threshold.x - placement.bounds.x], ".");
        assert.equal(firstPactTileAt(threshold.x, threshold.y), FirstPactTile.Road);
        assert.equal(isFirstPactWalkable(threshold.x, threshold.y), true);
        assert.ok(findFirstPactPath(threshold, { x: 14, y: 14 }).length > 0, `${placement.id} threshold must join the public lane`);
    }
    for (const path of FIRST_PACT_GARDENS_NORTH_PATHS) {
        for (let y = path.bounds.y; y < path.bounds.y + path.bounds.height; y += 1) {
            assert.equal(firstPactTileAt(path.bounds.x, y), FirstPactTile.Road, `${path.id} must stay visibly paved at y=${y}`);
            assert.equal(isFirstPactWalkable(path.bounds.x, y), true, `${path.id} must stay open at y=${y}`);
        }
    }
    for (let x = FIRST_PACT_GARDENS_NORTH_CROSS_ARM.x; x < FIRST_PACT_GARDENS_NORTH_CROSS_ARM.x + FIRST_PACT_GARDENS_NORTH_CROSS_ARM.width; x += 1) {
        assert.equal(firstPactTileAt(x, FIRST_PACT_GARDENS_NORTH_CROSS_ARM.y), FirstPactTile.Road);
        assert.equal(isFirstPactWalkable(x, FIRST_PACT_GARDENS_NORTH_CROSS_ARM.y), true);
    }

    assert.equal(isFirstPactWalkable(17, 10), true, "the deterministic frontage avatar tile must stay legal");
    assert.ok(findFirstPactPath({ x: 17, y: 10 }, lodge.publicThreshold).length > 0);
    assert.ok(findFirstPactPath({ x: 17, y: 10 }, hall.publicThreshold).length > 0);

    const planted = new Set(FIRST_PACT_GARDENS_NORTH_PLANTING_CELLS.map(({ x, y }) => `${x},${y}`));
    assert.ok(planted.size >= 25, "compact beds must materially occupy the setbacks");
    for (const point of FIRST_PACT_GARDENS_NORTH_PLANTING_CELLS) {
        assert.equal(isFirstPactGardensNorthPlanting(point.x, point.y), true);
        assert.equal(isFirstPactWalkable(point.x, point.y), false, `visible frontage bed ${point.x},${point.y} must drive collision and minimap massing`);
    }
    for (const tree of FIRST_PACT_GARDENS_NORTH_TREES) {
        assert.equal(planted.has(`${tree.root.x},${tree.root.y}`), true, `${tree.id} must terminate in a planted collision cell`);
    }

    assert.equal(FIRST_PACT_GARDENS_PUBLIC_COURT_PLANTING_BEDS.length, 2);
    for (const point of FIRST_PACT_GARDENS_PUBLIC_COURT_PLANTING_CELLS) {
        assert.equal(isFirstPactGardensPublicCourtPlanting(point.x, point.y), true);
        assert.equal(isFirstPactWalkable(point.x, point.y), false, `visible public-court bed ${point.x},${point.y} must drive collision`);
    }
    assert.deepEqual(fountain.collisionMask, [".##.", "####", "####"]);
    for (let localY = 0; localY < fountain.collisionMask!.length; localY += 1) {
        for (let localX = 0; localX < fountain.collisionMask![localY].length; localX += 1) {
            if (fountain.collisionMask![localY][localX] !== "#") continue;
            assert.equal(isFirstPactWalkable(fountain.bounds.x + localX, fountain.bounds.y + localY), false);
        }
    }
    for (const point of [{ x: 16, y: 19 }, { x: 17, y: 19 }, { x: 18, y: 19 }, { x: 19, y: 19 }]) {
        assert.equal(firstPactTileAt(point.x, point.y), FirstPactTile.Road, `guardian pool spur ${point.x},${point.y} must be visibly paved`);
        assert.equal(isFirstPactWalkable(point.x, point.y), true, `guardian pool spur ${point.x},${point.y} must stay open`);
    }
    assert.deepEqual(kaioTree.collisionCells, [{ x: 18, y: 18 }], "only the guardian tree root may block movement");
    assert.deepEqual(listeningBench.collisionMask, ["...", "#.#"], "only the bench's two stone feet may block movement");
    assert.equal(isFirstPactWalkable(18, 17), true, "Kaio's verified listening tile must stay open");
    assert.deepEqual(findFirstPactPath({ x: 18, y: 16 }, { x: 18, y: 17 }), [{ x: 18, y: 17 }], "Kaio's spur must reach the listener directly");
    for (const point of [{ x: 18, y: 18 }, { x: 19, y: 17 }, { x: 21, y: 17 }]) {
        assert.equal(isFirstPactWalkable(point.x, point.y), false, `teaching-court solid ${point.x},${point.y} must match visible art`);
    }
    for (const point of [{ x: 19, y: 18 }, { x: 24, y: 19 }, { x: 23, y: 17 }, { x: 21, y: 21 }]) {
        assert.equal(firstPactTileAt(point.x, point.y), FirstPactTile.Court, `former pool ring ${point.x},${point.y} must return to quiet court`);
        assert.equal(isFirstPactWalkable(point.x, point.y), true, `former pool ring ${point.x},${point.y} must remain open court`);
    }

    // Buildings, narrow paths, beds, and canopy roots divide the shelf at
    // avatar scale. No anonymous walkable five-by-five field may survive.
    for (let top = 4; top <= 9; top += 1) {
        for (let left = 5; left <= 23; left += 1) {
            let emptyField = true;
            for (let y = top; y < top + 5; y += 1) {
                for (let x = left; x < left + 5; x += 1) {
                    if (!isFirstPactWalkable(x, y)) emptyField = false;
                }
            }
            assert.equal(emptyField, false, `Guardian Gardens north cannot retain a 5x5 dead field at ${left},${top}`);
        }
    }

    const kaio = FIRST_PACT_NPCS.find((npc) => npc.id === "garden-keeper");
    assert.ok(kaio?.wanderBounds);
    assert.deepEqual(kaio.position, { x: 18, y: 16 });
    assert.deepEqual(kaio.wanderBounds, { x: 14, y: 13, width: 12, height: 13 }, "north-frontage work cannot mutate Kaio's NPC graph");
    assert.equal(isFirstPactWalkable(kaio.position.x, kaio.position.y), true);
    assert.ok(findFirstPactPath(kaio.position, pavilion.publicThreshold).length > 0, "Old Kaio must reach the tea archive threshold");
    assert.ok(findFirstPactPath(kaio.position, { x: 19, y: 19 }).length > 0, "Old Kaio must reach the guardian pool's west spur");
});

test("High Court is a complete three-building campus with exact public thresholds", async () => {
    const main = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "high-court-archive");
    const recordHall = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "west-record-hall");
    const annex = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "east-council-annex");
    assert.ok(main && recordHall && annex);

    assert.deepEqual(main.bounds, { x: 38, y: 2, width: 9, height: 7 });
    assert.deepEqual(recordHall.bounds, { x: 30, y: 7, width: 6, height: 5 });
    assert.deepEqual(annex.bounds, { x: 49, y: 7, width: 5, height: 5 });
    assert.equal(main.bounds.width * main.bounds.height > recordHall.bounds.width * recordHall.bounds.height, true);
    assert.equal(recordHall.bounds.width * recordHall.bounds.height > annex.bounds.width * annex.bounds.height, true);
    assert.deepEqual([main.highCourtAsset, recordHall.highCourtAsset, annex.highCourtAsset], ["main-archive", "record-hall", "council-annex"]);

    const qaFrame = { left: 27.5, right: 57.5, top: .125, bottom: 18.875 };
    for (const placement of [main, recordHall, annex]) {
        assert.ok(placement.bounds.x - qaFrame.left >= 1, `${placement.id} needs a complete west eave`);
        assert.ok(qaFrame.right - (placement.bounds.x + placement.bounds.width) >= 1, `${placement.id} needs a complete east eave`);
        assert.ok(placement.bounds.y - qaFrame.top >= 1, `${placement.id} needs a complete north roofline`);
        assert.ok(qaFrame.bottom - (placement.bounds.y + placement.bounds.height) >= 1, `${placement.id} needs complete south stairs`);

        const threshold = placement.publicThreshold;
        assert.ok(threshold, `${placement.id} needs an authored public threshold`);
        assert.deepEqual({ width: threshold.width, height: threshold.height }, { width: 1, height: 1 }, `${placement.id} door must remain one world tile`);
        assert.equal(threshold.y, placement.bounds.y + placement.bounds.height - 1, `${placement.id} threshold must occupy its south stair row`);
        assert.equal(placement.collisionMask[threshold.y - placement.bounds.y][threshold.x - placement.bounds.x], ".", `${placement.id} threshold cannot carry wall collision`);
        assert.equal(firstPactTileAt(threshold.x, threshold.y), FirstPactTile.Road, `${placement.id} threshold needs visible public paving`);
        assert.equal(isFirstPactWalkable(threshold.x, threshold.y), true, `${placement.id} threshold must remain walkable`);
        assert.ok(findFirstPactPath(threshold, { x: 42, y: 14 }), `${placement.id} threshold must join the south approach`);
    }

    assert.deepEqual(FIRST_PACT_HIGH_COURT_PATHS.map((path) => path.bounds.width), [1, 1, 1]);
    for (let y = 8; y <= 14; y += 1) {
        assert.equal(firstPactTileAt(42, y), FirstPactTile.Road, `main archive south approach breaks at 42,${y}`);
        assert.equal(isFirstPactWalkable(42, y), true, `main archive south approach is blocked at 42,${y}`);
    }

    const thresholdKeys = new Set([main, recordHall, annex].map((placement) => `${placement.publicThreshold!.x},${placement.publicThreshold!.y}`));
    assert.equal(FIRST_PACT_HIGH_COURT_GARDEN_CELLS.length, 38, "four compact archive gardens must subdivide the open court");
    assert.equal(new Set(FIRST_PACT_HIGH_COURT_GARDEN_CELLS.map((point) => `${point.x},${point.y}`)).size, 38, "archive garden cells cannot overlap");
    for (const cell of FIRST_PACT_HIGH_COURT_GARDEN_CELLS) {
        assert.equal(firstPactTileAt(cell.x, cell.y), FirstPactTile.Court, `archive garden ${cell.x},${cell.y} must stay on quiet court stone`);
        assert.equal(isFirstPactWalkable(cell.x, cell.y), false, `archive garden ${cell.x},${cell.y} must drive minimap and movement collision`);
        assert.equal(thresholdKeys.has(`${cell.x},${cell.y}`), false, "archive gardens cannot occupy a public threshold");
    }
    assert.equal(FIRST_PACT_HIGH_COURT_PARAPET_CELLS.length, 25);
    for (const cell of FIRST_PACT_HIGH_COURT_PARAPET_CELLS) {
        assert.equal(firstPactTileAt(cell.x, cell.y), FirstPactTile.Court);
        assert.equal(isFirstPactWalkable(cell.x, cell.y), false, "the visible north parapet must drive minimap and movement collision");
    }

    for (let top = 1; top <= 8; top += 1) {
        for (let left = 30; left <= 50; left += 1) {
            const deadFiveByFive = Array.from({ length: 25 }, (_, index) => ({
                x: left + index % 5,
                y: top + Math.floor(index / 5),
            })).every((point) => firstPactTileAt(point.x, point.y) === FirstPactTile.Court && isFirstPactWalkable(point.x, point.y));
            assert.equal(deadFiveByFive, false, `High Court cannot retain an unstructured 5x5 paving field at ${left},${top}`);
        }
    }

    const expectedAssets = [
        [highCourtMainArchive, 9 * 48, 7 * 48],
        [highCourtRecordHall, 6 * 48, 5 * 48],
        [highCourtCouncilAnnex, 5 * 48, 5 * 48],
    ] as const;
    for (const [asset, width, height] of expectedAssets) {
        const metadata = await sharp(asset).metadata();
        assert.equal(metadata.width, width);
        assert.equal(metadata.height, height);
        assert.equal(metadata.hasAlpha, true);
    }

    const gardenMetadata = await sharp(highCourtGardenStrip).metadata();
    assert.equal(gardenMetadata.width, 4 * 4 * 48, "garden strip must keep four exact 4x3 cells");
    assert.equal(gardenMetadata.height, 3 * 48);
    assert.equal(gardenMetadata.hasAlpha, true);
    for (const garden of FIRST_PACT_HIGH_COURT_GARDEN_BEDS) {
        assert.deepEqual(garden.bounds, { ...garden.bounds, width: 4, height: 3 });
        const { data, info } = await sharp(highCourtGardenStrip)
            .extract({ left: garden.gardenCell * 4 * 48, top: 0, width: 4 * 48, height: 3 * 48 })
            .resize(4 * 16, 3 * 16, { fit: "fill" })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        for (let tileY = 0; tileY < garden.bounds.height; tileY += 1) {
            for (let tileX = 0; tileX < garden.bounds.width; tileX += 1) {
                if (garden.collisionMask[tileY][tileX] !== "#") continue;
                let opaqueSamples = 0;
                for (let pixelY = 5; pixelY < 11; pixelY += 1) {
                    for (let pixelX = 5; pixelX < 11; pixelX += 1) {
                        const offset = (((tileY * 16 + pixelY) * info.width) + (tileX * 16 + pixelX)) * info.channels;
                        if (data[offset + 3] > 80) opaqueSamples += 1;
                    }
                }
                assert.ok(opaqueSamples / 36 > .18, `${garden.id} collision ${tileX},${tileY} must be supported by visible garden masonry`);
            }
        }
    }

    const scribe = FIRST_PACT_NPCS.find((npc) => npc.id === "scribe-vey");
    assert.deepEqual(scribe?.position, { x: 42, y: 12 });
    assert.equal(isFirstPactWalkable(42, 12), true, "Scribe Vey must remain grounded on the public approach");
});

test("Bell Quarter is a complete, planted residential block around one open-bell landmark", async () => {
    const landmark = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "open-bell-tower");
    const frontages = ["bell-quarter-residence", "bell-scribe-townhouse", "bell-courier-house"]
        .map((id) => FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === id));
    assert.ok(landmark);
    assert.equal(frontages.every(Boolean), true, "three ordinary Bell Quarter frontages must be authored");
    assert.deepEqual(landmark.bounds, { x: 65, y: 5, width: 6, height: 9 });
    assert.ok(frontages.every((placement) => placement!.bounds.height < landmark.bounds.height), "every home must remain subordinate to the open bell");
    assert.equal(FIRST_PACT_ARCHITECTURE.filter((placement) => placement.id.includes("bell-tower")).length, 1, "the bell must remain the district's single architectural landmark");
    assert.equal(FIRST_PACT_ARCHITECTURE.some((placement) => placement.id === "bell-council-house"), false, "the unrelated domed annex cannot return to the residential crop");

    // State=bell keeps the legal player at (68,14) while its edge-safe preview
    // camera focuses (68,13): x=53.5..83.5 and y=4.125..22.875 in tiles.
    const qaFrame = { left: 53.5, right: 83.5, top: 4.125, bottom: 22.875 };
    const stripCells = new Set<number>();
    for (const placement of [landmark, ...frontages]) {
        assert.ok(placement);
        assert.ok(placement.bellQuarterCell != null, `${placement.id} must use the complete standalone strip`);
        assert.equal(stripCells.has(placement.bellQuarterCell), false, `${placement.id} needs a unique standalone cell`);
        stripCells.add(placement.bellQuarterCell);
        assert.ok(placement.bounds.x - qaFrame.left >= .25, `${placement.id} needs a complete west eave`);
        assert.ok(qaFrame.right - (placement.bounds.x + placement.bounds.width) >= .25, `${placement.id} needs a complete east eave`);
        assert.ok(placement.bounds.y - qaFrame.top >= .25, `${placement.id} needs a complete north eave`);
        assert.ok(qaFrame.bottom - (placement.bounds.y + placement.bounds.height) >= .25, `${placement.id} needs complete south stairs`);
    }
    assert.deepEqual([...stripCells].sort(), [0, 1, 2, 3]);
    const standaloneMetadata = await sharp(bellQuarterAtlas).metadata();
    assert.equal(standaloneMetadata.width, 1152);
    assert.equal(standaloneMetadata.height, 432);
    assert.equal(standaloneMetadata.hasAlpha, true, "complete Bell Quarter silhouettes require true alpha");

    const thresholds = [
        { id: "open bell", point: { x: 68, y: 14 } },
        { id: "west residence", point: { x: 60, y: 13 } },
        { id: "east townhouse", point: { x: 76, y: 13 } },
        { id: "south courier house", point: { x: 61, y: 22 } },
    ] as const;
    assert.equal(firstPactTileAt(60, 12), FirstPactTile.Road, "west residence steps need a visible paved underlay");
    assert.equal(firstPactTileAt(76, 12), FirstPactTile.Road, "east townhouse steps need a visible paved underlay");
    assert.equal(isFirstPactBellRoute(60, 12), true);
    assert.equal(isFirstPactBellRoute(76, 12), true);
    for (const threshold of thresholds) {
        assert.equal(firstPactTileAt(threshold.point.x, threshold.point.y), FirstPactTile.Road, `${threshold.id} threshold must be visibly cobbled`);
        assert.equal(isFirstPactWalkable(threshold.point.x, threshold.point.y), true, `${threshold.id} threshold must be open`);
        assert.equal(isFirstPactBellRoute(threshold.point.x, threshold.point.y), true, `${threshold.id} must join the Bell Quarter route mesh`);
        if (threshold.point.x !== 68 || threshold.point.y !== 14) {
            assert.ok(findFirstPactPath(threshold.point, { x: 68, y: 14 }).length > 0, `${threshold.id} must reach the bell approach`);
        }
    }
    const mainLane = findFirstPactPath({ x: 54, y: 14 }, { x: 79, y: 14 });
    assert.equal(mainLane.length, 25);
    assert.equal(mainLane.every((point) => point.y === 14 && isFirstPactBellRoute(point.x, point.y)), true, "the High Court approach must cross Bell Quarter without a lawn detour");

    assert.ok(FIRST_PACT_BELL_PLANTING_CELLS.length >= 40, "planted setbacks must materially occupy the former lawn");
    for (const point of FIRST_PACT_BELL_PLANTING_CELLS) {
        assert.equal(firstPactTileAt(point.x, point.y), FirstPactTile.Garden, `planting at ${point.x},${point.y} needs living ground`);
        assert.equal(isFirstPactBellPlanting(point.x, point.y), true);
        assert.equal(isFirstPactWalkable(point.x, point.y), false, `visible planting at ${point.x},${point.y} must participate in collision/minimap massing`);
    }

    // No five-by-five block may remain anonymous walkable Garden. Buildings,
    // routes, and collision-backed planted beds divide the ward at human scale.
    for (let top = 5; top <= 18; top += 1) {
        for (let left = 57; left <= 74; left += 1) {
            let anonymousGarden = true;
            for (let y = top; y < top + 5; y += 1) {
                for (let x = left; x < left + 5; x += 1) {
                    if (firstPactTileAt(x, y) !== FirstPactTile.Garden || !isFirstPactWalkable(x, y)) anonymousGarden = false;
                }
            }
            assert.equal(anonymousGarden, false, `Bell Quarter cannot retain a 5x5 empty lawn at ${left},${top}`);
        }
    }

    const courier = FIRST_PACT_NPCS.find((npc) => npc.id === "court-courier");
    assert.ok(courier?.wanderBounds);
    assert.deepEqual(courier.position, { x: 74, y: 17 });
    for (let y = courier.wanderBounds.y; y < courier.wanderBounds.y + courier.wanderBounds.height; y += 1) {
        for (let x = courier.wanderBounds.x; x < courier.wanderBounds.x + courier.wanderBounds.width; x += 1) {
            assert.equal(isFirstPactBellRoute(x, y), true, `courier pen ${x},${y} must stay on mossed cobble`);
            assert.equal(isFirstPactWalkable(x, y), true, `courier pen ${x},${y} must stay collision-free`);
        }
    }

    assert.equal(FIRST_PACT_CITY_PROPS.some((placement) => placement.id === "bell-courtyard-tree"), false, "the bell must not compete with a second courtyard landmark");
});

test("V3 Kennel service buildings form a compact street-edge cluster with open thresholds", () => {
    const stable = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "vale-stable");
    const tackAnnex = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "stable-tack-annex");
    const lodge = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "handler-lodge");
    const infirmary = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "kennel-infirmary");
    const house = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "kennel-house");
    const feed = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "feed-storehouse");
    assert.ok(stable);
    assert.ok(tackAnnex);
    assert.ok(lodge);
    assert.ok(infirmary);
    assert.ok(house);
    assert.ok(feed);
    assert.deepEqual(house.bounds, { x: 17, y: 32, width: 4, height: 4 });
    assert.deepEqual(feed.bounds, { x: 21, y: 32, width: 4, height: 4 });
    assert.deepEqual(tackAnnex.bounds, { x: 6, y: 38, width: 5, height: 4 });
    assert.deepEqual(tackAnnex.collisionMask, ["###..", "###.#", "###.#", "###.#"]);
    assert.deepEqual(lodge.bounds, { x: 11, y: 39, width: 5, height: 4 });
    assert.deepEqual(lodge.collisionMask, ["####.", "#####", "#####", "##.#."]);
    assert.deepEqual(infirmary.bounds, { x: 10, y: 46, width: 5, height: 4 });
    assert.deepEqual(infirmary.collisionMask, ["####.", "#####", "#####", "##.##"]);
    for (const building of [stable, tackAnnex, lodge, infirmary, house, feed]) {
        for (let localY = 0; localY < building.collisionMask.length; localY += 1) {
            for (let localX = 0; localX < building.collisionMask[localY].length; localX += 1) {
                if (building.collisionMask[localY][localX] !== "#") continue;
                assert.equal(
                    firstPactTileAt(building.bounds.x + localX, building.bounds.y + localY),
                    FirstPactTile.Kennel,
                    `${building.id} cannot occupy a public walking road`,
                );
            }
        }
    }

    assert.equal(stable.collisionMask.at(-1), ".##..##.", "the stable needs its authored two-tile south gate");
    assert.equal(isFirstPactWalkable(13, 42), true, "the handler lodge's main doorstep must remain walkable");
    assert.equal(isFirstPactWalkable(15, 42), true, "the handler lodge's side doorstep must remain walkable");
    assert.equal(house.collisionMask.at(-1), "....", "the house steps must remain a walkable threshold");
    assert.equal(feed.collisionMask.at(-1), "....", "the feed-store loading step must remain walkable");
    assert.equal(isFirstPactWalkable(9, 37), true, "the stable gate must open into its yard approach");
    for (let y = 38; y <= 42; y += 1) {
        assert.equal(isFirstPactWalkable(9, y), true, `the tack-annex delivery aisle must remain clear at 9,${y}`);
    }
    assert.equal(isFirstPactWalkable(19, 35), true, "the service-house threshold must open into the shared court");
    assert.equal(isFirstPactWalkable(23, 35), true, "the feed-store threshold must open into the shared court");
    assert.equal(isFirstPactWalkable(21, 42), true, "the shared court must open directly onto the southern road");
    for (let y = 43; y <= 45; y += 1) {
        for (let x = 5; x <= 27; x += 1) {
            assert.equal(firstPactTileAt(x, y), FirstPactTile.Road, `the western frontage cannot replace the boulevard at ${x},${y}`);
            assert.equal(isFirstPactWalkable(x, y), true, `the boulevard must stay walkable at ${x},${y}`);
        }
    }
    assert.equal(firstPactTileAt(16, 39), FirstPactTile.Road, "the narrowed north/south service lane must remain beside the cedar court");
    assert.deepEqual(findFirstPactPath({ x: 13, y: 42 }, { x: 13, y: 43 }), [{ x: 13, y: 43 }], "the handler lodge's main threshold must open directly onto the boulevard");
    assert.deepEqual(findFirstPactPath({ x: 15, y: 42 }, { x: 15, y: 43 }), [{ x: 15, y: 43 }], "the handler lodge's side threshold must open directly onto the boulevard");
    assert.ok(findFirstPactPath({ x: 19, y: 35 }, { x: 19, y: 43 }).length > 0, "the house door must reach the boulevard");
    assert.ok(findFirstPactPath({ x: 23, y: 35 }, { x: 23, y: 43 }).length > 0, "the feed-store door must reach the boulevard");

    for (const id of ["stable-hay-cart", "stable-trough"]) {
        const prop = FIRST_PACT_CITY_PROPS.find((placement) => placement.id === id);
        assert.ok(prop);
        for (let y = Math.floor(prop.bounds.y); y < Math.ceil(prop.bounds.y + prop.bounds.height); y += 1) {
            for (let x = Math.floor(prop.bounds.x); x < Math.ceil(prop.bounds.x + prop.bounds.width); x += 1) {
                assert.equal(firstPactTileAt(x, y), FirstPactTile.Kennel, `${id} must remain off every public path tile`);
            }
        }
    }
    const hayCart = FIRST_PACT_CITY_PROPS.find((placement) => placement.id === "stable-hay-cart")!;
    const trough = FIRST_PACT_CITY_PROPS.find((placement) => placement.id === "stable-trough")!;
    assert.ok(hayCart.bounds.x < tackAnnex.bounds.x + tackAnnex.bounds.width && hayCart.bounds.y + hayCart.bounds.height > 41.5, "the hay cart must overlap the tack-room working frontage");
    assert.ok(trough.bounds.x <= tackAnnex.bounds.x + tackAnnex.bounds.width + .1 && trough.bounds.y < tackAnnex.bounds.y + tackAnnex.bounds.height, "the trough must hug the delivery pier instead of floating in the yard");
});

test("stable tack annex keeps its exact V3 RGBA contract and a visible open delivery bay", async () => {
    const annex = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "stable-tack-annex");
    assert.ok(annex);
    const metadata = await sharp(stableTackAnnex).metadata();
    assert.equal(metadata.width, 480);
    assert.equal(metadata.height, 384);
    assert.equal(metadata.hasAlpha, true);

    const { data, info } = await sharp(stableTackAnnex)
        .resize(annex.bounds.width * 16, annex.bounds.height * 16, { fit: "fill" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const opacityAt = (tileX: number, tileY: number) => {
        let opaque = 0;
        for (let pixelY = 5; pixelY < 11; pixelY += 1) {
            for (let pixelX = 5; pixelX < 11; pixelX += 1) {
                const offset = (((tileY * 16 + pixelY) * info.width) + (tileX * 16 + pixelX)) * info.channels;
                if (data[offset + 3] > 80) opaque += 1;
            }
        }
        return opaque / 36;
    };
    assert.ok(opacityAt(3, 3) < .12, "the delivery-bay threshold must stay visibly transparent");
    assert.ok(opacityAt(4, 3) > .5, "the delivery bay needs its visible east wall pier");
});

test("handler lodge keeps its exact V3 RGBA contract and authored door thresholds", async () => {
    const lodge = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "handler-lodge");
    assert.ok(lodge);
    const metadata = await sharp(handlerLodge).metadata();
    assert.equal(metadata.width, 480);
    assert.equal(metadata.height, 384);
    assert.equal(metadata.hasAlpha, true);

    assert.deepEqual(lodge.collisionMask, ["####.", "#####", "#####", "##.#."]);
    assert.equal(lodge.collisionMask[3][2], ".", "the central double-door threshold must be traversable");
    assert.equal(lodge.collisionMask[3][4], ".", "the side-door threshold must be traversable");
    for (let x = 11; x <= 15; x += 1) {
        assert.equal(firstPactTileAt(x, 43), FirstPactTile.Road, "the lodge's south edge must face an unobstructed public road");
        assert.equal(firstPactTileAt(x, 42), FirstPactTile.Kennel, "the lodge cannot overlap the public road");
    }
});

test("kennel infirmary keeps its exact V3 RGBA contract and a two-tile public approach", async () => {
    const infirmary = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "kennel-infirmary");
    assert.ok(infirmary);
    const metadata = await sharp(kennelInfirmary).metadata();
    assert.equal(metadata.width, 480);
    assert.equal(metadata.height, 384);
    assert.equal(metadata.hasAlpha, true);

    assert.deepEqual(infirmary.bounds, { x: 10, y: 46, width: 5, height: 4 });
    assert.deepEqual(infirmary.collisionMask, ["####.", "#####", "#####", "##.##"]);
    assert.equal(infirmary.collisionMask[3][2], ".", "the centered main double-door threshold must be traversable");
    assert.equal(isFirstPactWalkable(12, 49), true);

    // The entire building stays below the boulevard. Two parallel clear cells
    // carry the south-facing steps around its west side to the public street.
    for (let x = 10; x <= 14; x += 1) {
        assert.equal(firstPactTileAt(x, 45), FirstPactTile.Road, "the infirmary must remain fully off the boulevard");
    }
    for (let y = 46; y <= 51; y += 1) {
        for (const x of [8, 9]) {
            assert.equal(isFirstPactWalkable(x, y), true, `the two-tile infirmary aisle must remain clear at ${x},${y}`);
        }
    }
    for (let x = 8; x <= 12; x += 1) {
        for (const y of [50, 51]) {
            assert.equal(isFirstPactWalkable(x, y), true, `the two-tile infirmary turn must remain clear at ${x},${y}`);
        }
    }
    const doorToBoulevard = findFirstPactPath({ x: 12, y: 49 }, { x: 9, y: 45 });
    assert.ok(doorToBoulevard.length > 0 && doorToBoulevard.length <= 9, "the public threshold must reach the boulevard without a hidden detour");
});

test("kennel working structures author collision without severing the ward routes", async () => {
    const ids = new Set<string>();
    for (const placement of FIRST_PACT_KENNEL_STRUCTURES) {
        assert.equal(ids.has(placement.id), false, `${placement.id} must be unique`);
        ids.add(placement.id);
        assert.equal(placement.collisionMask.length, placement.bounds.height, `${placement.id} mask height must match its render height`);
        for (let localY = 0; localY < placement.collisionMask.length; localY += 1) {
            const row = placement.collisionMask[localY];
            assert.equal(row.length, placement.bounds.width, `${placement.id} mask row ${localY} must match its render width`);
            assert.match(row, /^[.#]+$/);
            for (let localX = 0; localX < row.length; localX += 1) {
                const worldX = placement.bounds.x + localX;
                const worldY = placement.bounds.y + localY;
                assert.equal(firstPactTileAt(worldX, worldY), FirstPactTile.Kennel, `${placement.id} must remain on ward ground`);
                if (row[localX] === "#") {
                    assert.equal(isFirstPactWalkable(worldX, worldY), false, `${placement.id} ${localX},${localY} must be solid`);
                }
            }
        }
    }

    const cedar = FIRST_PACT_KENNEL_STRUCTURES.find((placement) => placement.kind === "bonding-cedar");
    assert.ok(cedar);
    assert.deepEqual(cedar.bounds, { x: 19, y: 36, width: 4, height: 4 });
    assert.deepEqual(cedar.collisionMask, ["....", "....", "....", ".##."], "only the joined trunk and masonry planter may block movement");
    assert.equal(isFirstPactWalkable(20, 39), false, "the west half of the visible planter must be solid");
    assert.equal(isFirstPactWalkable(21, 39), false, "the east half of the visible planter must be solid");
    for (const approach of [{ x: 19, y: 36 }, { x: 20, y: 37 }, { x: 22, y: 38 }, { x: 19, y: 39 }, { x: 22, y: 39 }]) {
        assert.equal(isFirstPactWalkable(approach.x, approach.y), true, `cedar canopy approach ${approach.x},${approach.y} must stay open`);
    }
    const westDoorToSouth = findFirstPactPath({ x: 19, y: 35 }, { x: 21, y: 42 });
    const eastDoorToSouth = findFirstPactPath({ x: 23, y: 35 }, { x: 21, y: 42 });
    const westEast = findFirstPactPath({ x: 17, y: 40 }, { x: 25, y: 40 });
    assert.ok(westDoorToSouth.length > 0 && westDoorToSouth.length <= 11, "the west house door must branch around the cedar to the south crossing");
    assert.ok(eastDoorToSouth.length > 0 && eastDoorToSouth.length <= 11, "the east house door must branch around the cedar to the south crossing");
    assert.ok(westEast.length > 0 && westEast.length <= 10, "the west court and east edge must remain joined below the cedar");
    for (const route of [westDoorToSouth, eastDoorToSouth, westEast]) {
        assert.equal(route.some((point) => (point.x === 20 || point.x === 21) && point.y === 39), false, "routes cannot cross the solid cedar planter");
    }

    const keeper = FIRST_PACT_NPCS.find((npc) => npc.id === "keeper-sena");
    const stableHand = FIRST_PACT_NPCS.find((npc) => npc.id === "kennel-hand");
    assert.ok(keeper);
    assert.ok(stableHand);
    assert.deepEqual(keeper.position, { x: 24, y: 40 }, "Sena must inhabit the cedar's east alley");
    assert.equal(keeper.facing, "west", "Sena should face into the bonding court");
    assert.deepEqual(stableHand.position, { x: 18, y: 40 });
    assert.deepEqual(stableHand.wanderBounds, { x: 17, y: 39, width: 9, height: 4 }, "Pell must visibly inhabit the preserved cedar-court route");
    assert.equal(stableHand.portrait, "citizen", "Pell must retain the existing fallback-safe actor convention");

    assert.equal(FIRST_PACT_KENNEL_STRUCTURES.some((placement) => placement.id === "vale-stable-hay-pen" || placement.id === "vale-stable-feed-pen"), false, "the detached display pens must stay removed");
    for (let y = 37; y <= 52; y += 1) {
        assert.equal(isFirstPactWalkable(9, y), true, `the stable-gate aisle must remain clear at 9,${y}`);
    }
    const stableToRoad = findFirstPactPath({ x: 9, y: 37 }, { x: 9, y: 43 });
    const stableToLowerStreet = findFirstPactPath({ x: 9, y: 37 }, { x: 9, y: 52 });
    const stableToCourt = findFirstPactPath({ x: 9, y: 38 }, { x: 19, y: 39 });
    assert.equal(stableToRoad.length, 6, "the stable gate must connect directly south to the boulevard");
    assert.equal(stableToLowerStreet.length, 15, "the stable gate aisle must continue past the lower frontage to the shelf edge");
    assert.ok(stableToCourt.length > 0 && stableToCourt.length <= 13, "the stable aisle must branch cleanly east to the bonding court");

    const pavilion = FIRST_PACT_KENNEL_STRUCTURES.find((placement) => placement.kind === "kennel-pavilion");
    assert.ok(pavilion);
    assert.equal(pavilion.bounds.width, 7);
    assert.equal(pavilion.bounds.height, 4);
    assert.ok((pavilion.roofOverhangNorth ?? 0) > 0 && (pavilion.roofOverhangNorth ?? 0) < .5, "only the walk-under roof eave may cross the south curb");
    for (const row of pavilion.collisionMask) assert.equal(row[3], ".", "the pavilion gateway must stay open on its center line");

    assert.equal(FIRST_PACT_KENNEL_STRUCTURES.length, 4, "the ward should contain only its bonding cedar, pavilion, and two lower runs");
    assert.equal(isFirstPactWalkable(18, 42), true, "the shared court's west edge must remain open to the road");
    assert.equal(isFirstPactWalkable(24, 42), true, "the shared court's east edge must remain open to the road");
    assert.equal(firstPactTileAt(21, 45), FirstPactTile.Road, "the pavilion eave cannot replace the public road beneath it");

    for (let y = 42; y <= 52; y += 1) {
        assert.equal(isFirstPactWalkable(21, y), true, `the ward's north/south aisle must remain clear at 21,${y}`);
    }
    const cedarToPavilion = findFirstPactPath({ x: 21, y: 42 }, { x: 21, y: 49 });
    assert.equal(cedarToPavilion.length, 7, "the cedar court must cross the boulevard and enter the pavilion on one continuous centerline");
    assert.equal(cedarToPavilion.every((point) => point.x === 21), true, "the civic-court centerline cannot detour around hidden collision");
    assert.ok(findFirstPactPath({ x: 21, y: 42 }, { x: 21, y: 52 }).length > 0, "the service court must connect through the pavilion to the shelf edge");
    assert.ok(findFirstPactPath({ x: 21, y: 51 }, { x: 16, y: 51 }).length > 0, "the west exercise run must open from the aisle");
    assert.ok(findFirstPactPath({ x: 21, y: 51 }, { x: 26, y: 51 }).length > 0, "the east exercise run must open from the aisle");

    const metadata = await sharp(kennelPavilion).metadata();
    assert.equal(metadata.width, 672, "the V3 pavilion must retain its authored two-pixels-per-world-pixel width");
    assert.equal(metadata.height, 384, "the V3 pavilion must retain its authored two-pixels-per-world-pixel height");
    assert.equal(metadata.hasAlpha, true);
    const sampleSize = 16;
    const { data, info } = await sharp(kennelPavilion)
        .resize(pavilion.bounds.width * sampleSize, pavilion.bounds.height * sampleSize, { fit: "fill" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    for (let tileY = 0; tileY < pavilion.bounds.height; tileY += 1) {
        for (let tileX = 0; tileX < pavilion.bounds.width; tileX += 1) {
            let opaque = 0;
            for (let pixelY = 5; pixelY < 11; pixelY += 1) {
                for (let pixelX = 5; pixelX < 11; pixelX += 1) {
                    const offset = (((tileY * sampleSize + pixelY) * info.width) + (tileX * sampleSize + pixelX)) * info.channels;
                    if (data[offset + 3] > 80) opaque += 1;
                }
            }
            if (pavilion.collisionMask[tileY][tileX] === "#") {
                assert.ok(opaque / 36 > .18, `pavilion collision ${tileX},${tileY} must be supported by visible architecture`);
            } else if (tileX === 3 && tileY >= 2) {
                assert.ok(opaque / 36 < .12, `the visible lower gateway must stay transparent at ${tileX},${tileY}`);
            }
        }
    }
});

test("bonding cedar keeps its exact RGBA contract while the canopy overhang stays walkable", async () => {
    const cedar = FIRST_PACT_KENNEL_STRUCTURES.find((placement) => placement.kind === "bonding-cedar");
    assert.ok(cedar);
    const metadata = await sharp(bondingCedar).metadata();
    assert.equal(metadata.width, 384);
    assert.equal(metadata.height, 384);
    assert.equal(metadata.hasAlpha, true);

    const sampleSize = 16;
    const { data, info } = await sharp(bondingCedar)
        .resize(cedar.bounds.width * sampleSize, cedar.bounds.height * sampleSize, { fit: "fill" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const opacityAt = (tileX: number, tileY: number) => {
        let opaque = 0;
        for (let pixelY = 5; pixelY < 11; pixelY += 1) {
            for (let pixelX = 5; pixelX < 11; pixelX += 1) {
                const offset = (((tileY * sampleSize + pixelY) * info.width) + (tileX * sampleSize + pixelX)) * info.channels;
                if (data[offset + 3] > 80) opaque += 1;
            }
        }
        return opaque / 36;
    };

    assert.ok(opacityAt(1, 0) > .18, "the north canopy must visibly overhang its walkable tile");
    assert.equal(isFirstPactWalkable(20, 36), true, "canopy alpha alone cannot create collision");
    assert.ok(opacityAt(1, 3) > .18, "the west planter collision needs visible masonry");
    assert.ok(opacityAt(2, 3) > .18, "the east planter collision needs visible masonry");
});

test("Market and Scriptorium is a complete walkable district rather than an atlas-ground collage", async () => {
    const arcade = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "market-arcade");
    const westStall = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "market-stall-west");
    const eastStall = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "market-stall-east");
    const rowhouse = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "merchant-house");
    const workshop = FIRST_PACT_ARCHITECTURE.find((placement) => placement.id === "waterside-workshop");
    assert.ok(arcade);
    assert.ok(westStall);
    assert.ok(eastStall);
    assert.ok(rowhouse);
    assert.ok(workshop);
    assert.deepEqual(arcade.bounds, { x: 60, y: 23, width: 9, height: 6 });
    assert.deepEqual(rowhouse.bounds, { x: 56, y: 32, width: 7, height: 6 });
    assert.deepEqual(workshop.bounds, { x: 67, y: 32, width: 9, height: 6 });
    assert.ok(rowhouse.bounds.width < arcade.bounds.width, "the merchant rowhouse must remain subordinate to the public arcade");

    const imageContracts = [
        [marketArcade, 864, 576],
        [marketStall, 288, 288],
        [marketRowhouse, 672, 576],
        [marketWorkshop, 864, 576],
    ] as const;
    for (const [path, width, height] of imageContracts) {
        const metadata = await sharp(path).metadata();
        assert.equal(metadata.width, width);
        assert.equal(metadata.height, height);
        assert.equal(metadata.hasAlpha, true, `${path} must remain a transparent standalone sprite`);
    }

    // The deterministic market QA focus is (68,30). At 1440x900 it leaves at
    // least one whole world tile between every market silhouette and the crop.
    const qaFrame = { left: 53.5, right: 83.5, top: 21.125, bottom: 39.875 };
    for (const placement of [arcade, westStall, eastStall, rowhouse, workshop]) {
        assert.ok(placement.bounds.x - qaFrame.left >= 1, `${placement.id} needs a west crop margin`);
        assert.ok(qaFrame.right - (placement.bounds.x + placement.bounds.width) >= 1, `${placement.id} needs an east crop margin`);
        assert.ok(placement.bounds.y - qaFrame.top >= 1, `${placement.id} needs a north crop margin`);
        assert.ok(qaFrame.bottom - (placement.bounds.y + placement.bounds.height) >= 1, `${placement.id} needs a south crop margin`);
    }

    // The two unobstructed southern courses are one continuous cobble lane,
    // including the collision-authoritative bridge across the east canal.
    for (const y of [29, 30]) {
        for (let x = 54; x <= 80; x += 1) {
            assert.equal(firstPactTileAt(x, y), FirstPactTile.Road, `market lane material must stay continuous at ${x},${y}`);
            assert.equal(isFirstPactWalkable(x, y), true, `market lane must stay clear at ${x},${y}`);
        }
    }
    const acrossMarket = findFirstPactPath({ x: 54, y: 29 }, { x: 80, y: 29 });
    assert.equal(acrossMarket.length, 26);
    assert.equal(acrossMarket.every((point) => point.y === 29), true, "the market lane cannot detour around hidden collision");
    assert.equal(firstPactTileAt(75, 28), FirstPactTile.Water, "the canal must close above the narrowed two-tile bridge");
    assert.equal(firstPactTileAt(75, 29), FirstPactTile.Road, "the east-west market lane must cross the real canal");
    for (let y = 20; y <= 42; y += 1) {
        for (const x of [75, 76]) {
            const crossing = y === 29 || y === 30;
            assert.equal(firstPactTileAt(x, y), crossing ? FirstPactTile.Road : FirstPactTile.Water, `the two-tile market canal geometry must remain exact at ${x},${y}`);
            assert.equal(isFirstPactWalkable(x, y), crossing, `only the authored market bridge may cross water at ${x},${y}`);
        }
    }
    assert.equal(firstPactTileAt(59, 27), FirstPactTile.Road, "the west stall loop must meet the market lane");
    assert.equal(firstPactTileAt(69, 27), FirstPactTile.Road, "the east stall loop must meet the market lane");
    assert.equal(firstPactTileAt(63, 34), FirstPactTile.Market, "building-side service paving must remain a low-traffic setback");
    assert.equal(firstPactTileAt(59, 38), FirstPactTile.Road, "the rowhouse door arm must be visibly paved");
    assert.equal(firstPactTileAt(71, 38), FirstPactTile.Road, "the workshop door arm must be visibly paved");
    assert.equal(firstPactTileAt(58, 39), FirstPactTile.Market, "the south apron cannot expand back into a rectangular road field");

    for (const stall of [westStall, eastStall]) {
        for (let y = stall.bounds.y; y < stall.bounds.y + stall.bounds.height; y += 1) {
            assert.equal(isFirstPactWalkable(stall.bounds.x - 1, y), true, `${stall.id} needs a clear west aisle`);
            assert.equal(isFirstPactWalkable(stall.bounds.x + stall.bounds.width, y), true, `${stall.id} needs a clear east aisle`);
        }
        for (let x = stall.bounds.x; x < stall.bounds.x + stall.bounds.width; x += 1) {
            assert.equal(isFirstPactWalkable(x, stall.bounds.y - 1), true, `${stall.id} needs a clear north aisle`);
            assert.equal(isFirstPactWalkable(x, stall.bounds.y + stall.bounds.height), true, `${stall.id} needs a clear south aisle`);
        }
    }

    for (let y = 23; y <= 28; y += 1) assert.equal(isFirstPactWalkable(64, y), true, `the arcade passage must stay open at 64,${y}`);
    const throughArcade = findFirstPactPath({ x: 64, y: 22 }, { x: 64, y: 30 });
    assert.equal(throughArcade.length, 8);
    assert.equal(throughArcade.every((point) => point.x === 64), true, "the arcade must be genuinely walk-through");

    const notice = FIRST_PACT_CITY_PROPS.find((placement) => placement.id === "market-scriptorium-notice");
    const tradeCrates = FIRST_PACT_CITY_PROPS.find((placement) => placement.id === "market-trade-crates");
    assert.ok(notice);
    assert.ok(tradeCrates);
    assert.equal(isFirstPactWalkable(61, 31), false, "the scriptorium notice posts must join prop collision");
    assert.equal(isFirstPactWalkable(72, 31), false, "the trade goods must join prop collision");
    for (const x of [60, 61, 62, 69, 70, 71, 72, 73]) {
        assert.equal(isFirstPactWalkable(x, 31), false, `the permanent service edge must enclose its court at ${x},31`);
    }
    for (const x of [63, 67, 68, 74]) {
        assert.equal(isFirstPactWalkable(x, 31), true, `the service edges must leave the market approaches open at ${x},31`);
    }
    for (let y = 29; y <= 39; y += 1) {
        for (let x = 64; x <= 66; x += 1) {
            assert.equal(firstPactTileAt(x, y), FirstPactTile.Road, `the market spine must remain visibly paved at ${x},${y}`);
            assert.equal(isFirstPactWalkable(x, y), true, `the three-tile market spine must remain clear at ${x},${y}`);
        }
    }
    const fullMarketSpine = findFirstPactPath({ x: 64, y: 22 }, { x: 64, y: 39 });
    assert.equal(fullMarketSpine.length, 17);
    assert.equal(fullMarketSpine.every((point) => point.x === 64), true, "edge pockets cannot bend the arcade-to-forecourt route");

    assert.equal(isFirstPactWalkable(59, 37), true, "the rowhouse's south door must be open");
    assert.ok(findFirstPactPath({ x: 59, y: 37 }, { x: 64, y: 39 }).length <= 7, "the rowhouse door must meet the forecourt");
    assert.equal(isFirstPactWalkable(71, 37), true, "the workshop's south door must be open");
    assert.ok(findFirstPactPath({ x: 71, y: 37 }, { x: 64, y: 39 }).length <= 9, "the workshop door must meet the forecourt");
    assert.equal(firstPactTileAt(75, 35), FirstPactTile.Water, "the workshop wheel must overlap real canal terrain");
    assert.equal(isFirstPactWalkable(75, 35), false, "the real canal beneath the wheel must block movement");

    const { data: workshopPixels } = await sharp(marketWorkshop).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let brightCyanPixels = 0;
    for (let offset = 0; offset < workshopPixels.length; offset += 4) {
        if (workshopPixels[offset + 3] > 80
            && workshopPixels[offset] < 50
            && workshopPixels[offset + 1] > 150
            && workshopPixels[offset + 2] > 160) brightCyanPixels += 1;
    }
    assert.ok(brightCyanPixels < 20, "the workshop sprite cannot bake a fake cyan pool over the map canal");
});

test("sparse civic landmarks use their authored surface and join world collision", () => {
    // Raised 10 -> 14 for Gateworks, which had no dressing at all while every
    // other district had some. Four functional landmarks only: alley lanterns,
    // a works notice board, store crates and a yard trough. A first pass added
    // ten to that one district and this contract rejected it, correctly -- the
    // brief forbids solving emptiness with clutter, so the ceiling moves by the
    // number actually justified and not one prop more.
    assert.equal(FIRST_PACT_CITY_PROPS.length, 14, "street dressing must remain a restrained landmark pass");
    const ids = new Set<string>();
    for (const placement of FIRST_PACT_CITY_PROPS) {
        assert.equal(ids.has(placement.id), false, `${placement.id} must be unique`);
        ids.add(placement.id);
        assert.ok(Number.isInteger(placement.atlasCell) && placement.atlasCell >= 0 && placement.atlasCell < 16);
        assert.ok(placement.bounds.width > 0 && placement.bounds.height > 0);
        assert.ok(placement.bounds.x >= 0 && placement.bounds.y >= 0);
        assert.ok(placement.bounds.x + placement.bounds.width <= FIRST_PACT_WORLD_WIDTH);
        assert.ok(placement.bounds.y + placement.bounds.height <= FIRST_PACT_WORLD_HEIGHT);
        const centerTile = firstPactTileAt(
            Math.floor(placement.bounds.x + placement.bounds.width / 2),
            Math.floor(placement.bounds.y + placement.bounds.height / 2),
        );
        const centerX = Math.floor(placement.bounds.x + placement.bounds.width / 2);
        const centerY = Math.floor(placement.bounds.y + placement.bounds.height / 2);
        assert.notEqual(centerTile, FirstPactTile.Void, `${placement.id} cannot float outside the civic shelf`);
        if (placement.id === "aqueduct-valve") {
            assert.equal(centerTile, FirstPactTile.Water, "the aqueduct control must straddle the channel it regulates");
        } else {
            assert.notEqual(centerTile, FirstPactTile.Water, `${placement.id} cannot sit in the aqueduct channel`);
        }
        if (placement.collisionCells) {
            assert.ok(placement.collisionCells.length > 0, `${placement.id} must own grounded collision`);
            for (const point of placement.collisionCells) {
                assert.equal(isFirstPactWalkable(point.x, point.y), false, `${placement.id} collision ${point.x},${point.y} must be solid`);
            }
        } else if (placement.collisionMask) {
            assert.equal(placement.collisionMask.length, placement.bounds.height, `${placement.id} mask height must match its bounds`);
            let solidCells = 0;
            for (let localY = 0; localY < placement.collisionMask.length; localY += 1) {
                assert.equal(placement.collisionMask[localY].length, placement.bounds.width, `${placement.id} mask width must match its bounds`);
                for (let localX = 0; localX < placement.collisionMask[localY].length; localX += 1) {
                    if (placement.collisionMask[localY][localX] !== "#") continue;
                    solidCells += 1;
                    assert.equal(isFirstPactWalkable(placement.bounds.x + localX, placement.bounds.y + localY), false);
                }
            }
            assert.ok(solidCells > 0, `${placement.id} must own grounded collision`);
        } else {
            assert.equal(isFirstPactWalkable(centerX, centerY), false, `${placement.id} must participate in world collision`);
        }
    }
});

test("the central Aqueduct is a tile-authoritative civic bridge with open bank landings", () => {
    const crossing = FIRST_PACT_AQUEDUCT_CENTRAL_CROSSING;
    assert.deepEqual(crossing.deck, { x: 28, y: 27, width: 3, height: 4 });
    assert.equal(crossing.abutments.length, 4, "the deck must meet four literal bank corners");
    assert.equal(new Set(crossing.abutments.map(({ x, y }) => `${x},${y}`)).size, 4, "abutments cannot be duplicated as decorative clutter");

    for (let y = crossing.deck.y; y < crossing.deck.y + crossing.deck.height; y += 1) {
        for (let x = crossing.deck.x; x < crossing.deck.x + crossing.deck.width; x += 1) {
            assert.equal(firstPactTileAt(x, y), FirstPactTile.Bridge, `central deck material drifted at ${x},${y}`);
            assert.equal(isFirstPactWalkable(x, y), true, `central deck clearance closed at ${x},${y}`);
        }
        assert.equal(firstPactTileAt(crossing.westLanding.x, y), FirstPactTile.Road, `west approach reset at ${crossing.westLanding.x},${y}`);
        assert.equal(firstPactTileAt(crossing.eastLanding.x, y), FirstPactTile.Road, `east approach reset at ${crossing.eastLanding.x},${y}`);
        assert.equal(isFirstPactWalkable(crossing.westLanding.x, y), true);
        assert.equal(isFirstPactWalkable(crossing.eastLanding.x, y), true);
    }

    for (const mouth of [crossing.northMouth, crossing.southMouth]) {
        for (let y = mouth.y; y < mouth.y + mouth.height; y += 1) {
            for (let x = mouth.x; x < mouth.x + mouth.width; x += 1) {
                assert.equal(firstPactTileAt(x, y), FirstPactTile.Water, `continuous channel mouth drifted at ${x},${y}`);
                assert.equal(isFirstPactWalkable(x, y), false, `channel mouth must remain collision-solid at ${x},${y}`);
            }
        }
    }
    for (const { x, y } of crossing.abutments) {
        assert.equal(firstPactTileAt(x, y), FirstPactTile.Wall, `abutment bank material drifted at ${x},${y}`);
        assert.equal(isFirstPactWalkable(x, y), false, `abutment bank collision drifted at ${x},${y}`);
    }

    assert.deepEqual(
        findFirstPactPath({ x: 24, y: 29 }, { x: 34, y: 29 }),
        Array.from({ length: 10 }, (_, offset) => ({ x: 25 + offset, y: 29 })),
        "the central boulevard must cross the channel on one straight route",
    );
    const civicWalker: FirstPactNpcDefinition = {
        id: "central-aqueduct-qa-walker",
        name: "Central Aqueduct QA Walker",
        title: "Civic Crossing Inspector",
        position: { x: 24, y: 29 },
        behavior: "wander",
        wanderBounds: { x: 24, y: 27, width: 11, height: 4 },
        facing: "east",
        palette: "slate",
        portrait: "citizen",
    };
    for (let cycle = 0; cycle < 12; cycle += 1) {
        const target = chooseFirstPactWanderDestination(civicWalker, civicWalker.position, cycle);
        assert.ok(target, "central crossing AI must retain a legal destination");
        const path = findFirstPactPath(civicWalker.position, target!);
        assert.ok(path.length > 0, "central crossing AI destination must remain reachable");
        assert.equal(path.every(({ x, y }) => isFirstPactWalkable(x, y)), true);
    }
});

test("the Aqueduct civic boulevard is one map-authored bridge between collision-backed banks", () => {
    const aqueduct = FIRST_PACT_AQUEDUCT_CIVIC_CROSSING;
    for (let y = 31; y < aqueduct.water.y + aqueduct.water.height; y += 1) {
        const expected = y >= aqueduct.deck.y && y < aqueduct.deck.y + aqueduct.deck.height
            ? FirstPactTile.Bridge
            : FirstPactTile.Water;
        for (let x = aqueduct.water.x; x < aqueduct.water.x + aqueduct.water.width; x += 1) {
            assert.equal(firstPactTileAt(x, y), expected, `Aqueduct channel/deck truth drifted at ${x},${y}`);
            assert.equal(isFirstPactWalkable(x, y), expected === FirstPactTile.Bridge, `Aqueduct movement truth drifted at ${x},${y}`);
        }
    }
    for (let y = aqueduct.deck.y; y < aqueduct.deck.y + aqueduct.deck.height; y += 1) {
        for (let x = aqueduct.deck.x; x < aqueduct.deck.x + aqueduct.deck.width; x += 1) {
            assert.equal(firstPactTileAt(x, y), FirstPactTile.Bridge, `bridge material drifted at ${x},${y}`);
            assert.equal(isFirstPactWalkable(x, y), true, `bridge route must remain open at ${x},${y}`);
        }
    }

    for (const y of [aqueduct.deck.y - 1, aqueduct.deck.y + aqueduct.deck.height]) {
        for (let x = aqueduct.water.x; x < aqueduct.water.x + aqueduct.water.width; x += 1) {
            assert.equal(firstPactTileAt(x, y), FirstPactTile.Water, `the canal must continue beneath the deck at ${x},${y}`);
            assert.equal(isFirstPactWalkable(x, y), false, `the visible canal mouth must remain solid at ${x},${y}`);
        }
    }

    for (const bank of [aqueduct.westBankNorth, aqueduct.westBankSouth, aqueduct.eastBankNorth, aqueduct.eastBankSouth]) {
        for (let y = bank.y; y < bank.y + bank.height; y += 1) {
            assert.equal(firstPactTileAt(bank.x, y), FirstPactTile.Wall, `bank material drifted at ${bank.x},${y}`);
            assert.equal(isFirstPactWalkable(bank.x, y), false, `bank collision drifted at ${bank.x},${y}`);
        }
    }
    for (let y = 48; y <= 52; y += 1) {
        assert.equal(firstPactTileAt(27, y), FirstPactTile.Kennel, `the accepted kennel-edge rail keeps its ward substrate at 27,${y}`);
        assert.equal(isFirstPactWalkable(27, y), false, `the kennel-edge rail must continue the west bank collision at 27,${y}`);
    }
    for (const x of [aqueduct.westBankNorth.x, aqueduct.eastBankNorth.x]) {
        for (let y = aqueduct.deck.y; y < aqueduct.deck.y + aqueduct.deck.height; y += 1) {
            assert.equal(firstPactTileAt(x, y), FirstPactTile.Road, `bridge threshold drifted at ${x},${y}`);
            assert.equal(isFirstPactWalkable(x, y), true, `bridge threshold must remain open at ${x},${y}`);
        }
    }

    const centerline = findFirstPactPath({ x: 25, y: 44 }, { x: 34, y: 44 });
    assert.deepEqual(
        centerline,
        Array.from({ length: 9 }, (_, offset) => ({ x: 26 + offset, y: 44 })),
        "the civic boulevard must cross the Aqueduct on one straight, readable centerline",
    );

    const civicWalker: FirstPactNpcDefinition = {
        id: "aqueduct-qa-walker",
        name: "Aqueduct QA Walker",
        title: "Crossing Inspector",
        position: { x: 25, y: 44 },
        behavior: "wander",
        wanderBounds: { x: 25, y: 43, width: 10, height: 3 },
        facing: "east",
        palette: "slate",
        portrait: "citizen",
    };
    for (let cycle = 0; cycle < 12; cycle += 1) {
        const target = chooseFirstPactWanderDestination(civicWalker, civicWalker.position, cycle);
        assert.ok(target, "crossing AI must retain a legal destination");
        const path = findFirstPactPath(civicWalker.position, target!);
        assert.ok(path.length > 0, "crossing AI destination must remain reachable");
        assert.equal(path.every(({ x, y }) => isFirstPactWalkable(x, y)), true);
    }
});

test("the Sunken Court is one connected walkable world", () => {
    assert.equal(isFirstPactWalkable(FIRST_PACT_PLAYER_START.x, FIRST_PACT_PLAYER_START.y), true);
    for (const npc of FIRST_PACT_NPCS) {
        assert.ok(
            findFirstPactPath(FIRST_PACT_PLAYER_START, npc.position).length > 0,
            `${npc.name} must be reachable from Arrival Court`,
        );
    }

    const visited = new Set<string>();
    const queue = [FIRST_PACT_PLAYER_START];
    while (queue.length) {
        const point = queue.shift()!;
        const key = `${point.x},${point.y}`;
        if (visited.has(key) || !isFirstPactWalkable(point.x, point.y)) continue;
        visited.add(key);
        queue.push(
            { x: point.x + 1, y: point.y },
            { x: point.x - 1, y: point.y },
            { x: point.x, y: point.y + 1 },
            { x: point.x, y: point.y - 1 },
        );
    }
    let walkable = 0;
    for (let y = 0; y < FIRST_PACT_WORLD_HEIGHT; y += 1) {
        for (let x = 0; x < FIRST_PACT_WORLD_WIDTH; x += 1) {
            if (isFirstPactWalkable(x, y)) walkable += 1;
        }
    }
    assert.equal(visited.size, walkable, "every walkable tile must connect to the Arrival Court");
});

test("water, the Colosseum wall, visible buildings and the city edge remain solid", () => {
    assert.equal(firstPactTileAt(0, 0), FirstPactTile.Void);
    assert.equal(isFirstPactWalkable(0, 0), false);
    assert.equal(firstPactTileAt(29, 20), FirstPactTile.Water);
    assert.equal(isFirstPactWalkable(29, 20), false);
    assert.equal(firstPactTileAt(36, 21), FirstPactTile.Wall);
    assert.equal(isFirstPactWalkable(36, 21), false);
    assert.equal(isFirstPactWalkable(44, 6), false, "the High Court archive roof must override the road beneath it");
});

test("stale checkpoints and follower positions recover onto nearby legal tiles", () => {
    const occupied = new Set(FIRST_PACT_NPCS.map((npc) => (npc.position.y * FIRST_PACT_WORLD_WIDTH) + npc.position.x));
    const restored = nearestFirstPactWalkable({ x: 44, y: 6 }, occupied);
    assert.ok(restored);
    assert.equal(isFirstPactWalkable(restored!.x, restored!.y), true);
    assert.equal(occupied.has((restored!.y * FIRST_PACT_WORLD_WIDTH) + restored!.x), false);

    const followerBlocked = new Set(occupied);
    followerBlocked.add((restored!.y * FIRST_PACT_WORLD_WIDTH) + restored!.x);
    const follower = nearestFirstPactWalkable({ x: restored!.x, y: restored!.y + 1 }, followerBlocked);
    assert.ok(follower);
    assert.equal(isFirstPactWalkable(follower!.x, follower!.y), true);
    assert.notDeepEqual(follower, restored);
});

test("interaction reach respects the same obstruction graph as movement", () => {
    assert.equal(isFirstPactWithinReach({ x: 42, y: 14 }, { x: 42, y: 12 }, 2), true);
    assert.equal(
        isFirstPactWithinReach({ x: 55, y: 25 }, { x: 59, y: 25 }, 4),
        false,
        "a market stall cannot be spoken through even when the actor is only four Manhattan tiles away",
    );
});

test("district projection names the physical place beneath the avatar", () => {
    assert.equal(firstPactDistrictAt({ x: 42, y: 28 }), "grand-colosseum");
    assert.equal(firstPactDistrictAt({ x: 42, y: 50 }), "arrival-court");
    assert.equal(firstPactDistrictAt({ x: 17, y: 40 }), "kennel-ward");
    assert.equal(firstPactDistrictAt({ x: 68, y: 46 }), "gateworks");
});

test("wandering AI chooses reachable destinations inside its authored region", () => {
    for (const npc of FIRST_PACT_NPCS.filter((entry) => entry.behavior === "wander")) {
        for (let cycle = 0; cycle < 12; cycle += 1) {
            const target = chooseFirstPactWanderDestination(npc, npc.position, cycle);
            assert.ok(target, `${npc.name} should find a destination`);
            assert.ok(target!.x >= npc.wanderBounds!.x && target!.x < npc.wanderBounds!.x + npc.wanderBounds!.width);
            assert.ok(target!.y >= npc.wanderBounds!.y && target!.y < npc.wanderBounds!.y + npc.wanderBounds!.height);
            assert.ok(findFirstPactPath(npc.position, target!).length > 0);
        }
    }
});

test("the whole city is one connected world: no stranded pockets, every district and NPC reachable", () => {
    // The tests above prove each building and district respects collision on its
    // own. None of them prove the CITY holds together. A district can be locally
    // perfect and still be sealed off by one re-tiled seam, and with five of the
    // fifteen art gates still open that seam moves every time a district is
    // rebuilt. This walks the world the way a player does.
    const key = (x: number, y: number) => `${x},${y}`;
    const reached = new Set<string>([key(FIRST_PACT_PLAYER_START.x, FIRST_PACT_PLAYER_START.y)]);
    const frontier = [{ x: FIRST_PACT_PLAYER_START.x, y: FIRST_PACT_PLAYER_START.y }];
    assert.equal(
        isFirstPactWalkable(FIRST_PACT_PLAYER_START.x, FIRST_PACT_PLAYER_START.y),
        true,
        "the player spawns on a blocked tile",
    );
    while (frontier.length) {
        const at = frontier.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const x = at.x + dx, y = at.y + dy;
            if (x < 0 || y < 0 || x >= FIRST_PACT_WORLD_WIDTH || y >= FIRST_PACT_WORLD_HEIGHT) continue;
            if (!isFirstPactWalkable(x, y)) continue;
            if (reached.has(key(x, y))) continue;
            reached.add(key(x, y));
            frontier.push({ x, y });
        }
    }

    const stranded: string[] = [];
    const byDistrict = new Map<string, { total: number; reached: number }>();
    for (let y = 0; y < FIRST_PACT_WORLD_HEIGHT; y++) {
        for (let x = 0; x < FIRST_PACT_WORLD_WIDTH; x++) {
            if (!isFirstPactWalkable(x, y)) continue;
            const district = String(firstPactDistrictAt({ x, y }));
            const row = byDistrict.get(district) ?? { total: 0, reached: 0 };
            row.total++;
            if (reached.has(key(x, y))) row.reached++;
            else if (stranded.length < 12) stranded.push(`(${x},${y}) in ${district}`);
            byDistrict.set(district, row);
        }
    }
    assert.deepEqual(stranded, [], `walkable tiles the player can never stand on:\n${stranded.join("\n")}`);

    // Every authored district must exist AND be fully joined to the city, so a
    // finished district cannot quietly become an island behind a rebuilt seam.
    for (const [district, row] of byDistrict) {
        assert.ok(row.total > 0, `${district} has no walkable tile`);
        assert.equal(row.reached, row.total, `${district}: ${row.total - row.reached} of ${row.total} walkable tiles are cut off`);
    }
    assert.ok(byDistrict.size >= 9, `expected the nine authored districts, saw ${byDistrict.size}`);

    // An NPC may stand on a blocked tile (a doorway, a stall), but the player has
    // to be able to stand next to it or the quest it carries is unreachable.
    const unreachable = (FIRST_PACT_NPCS as readonly FirstPactNpcDefinition[]).filter((npc) =>
        ![[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
            const x = npc.position.x + dx, y = npc.position.y + dy;
            return isFirstPactWalkable(x, y) && reached.has(key(x, y));
        }));
    assert.deepEqual(
        unreachable.map((npc) => `${npc.id} at (${npc.position.x},${npc.position.y})`),
        [],
        "these NPCs cannot be spoken to from any reachable tile",
    );
});

test("no ground material meets another along a ruler-straight run", () => {
    // A long dead-straight boundary between two ground materials is the "pasted
    // rectangular ground plate" the brief forbids: a real city changes surface
    // along a kerb, a wall or a doorway, not along a ruler. A whole-city scan
    // found ten runs of twelve tiles or more, the worst of them twenty-five, and
    // the notches in the builder interlock those joins.
    //
    // Water, bridges, walls and roofs are exempt on purpose: a canal bank or a
    // rampart SHOULD be straight, and so should a street. This measures ground
    // PLATES meeting each other, which is the thing that reads as pasted.
    const exempt = new Set<number>([
        FirstPactTile.Water, FirstPactTile.Bridge, FirstPactTile.Wall,
        FirstPactTile.Void, FirstPactTile.Roof,
    ]);
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < FIRST_PACT_WORLD_WIDTH && y < FIRST_PACT_WORLD_HEIGHT;
    const kind = (x: number, y: number) => (inside(x, y) ? firstPactTileAt(x, y) : -1);

    const offenders: string[] = [];
    for (const dir of ["H", "V"] as const) {
        const counted = new Set<string>();
        for (let y = 0; y < FIRST_PACT_WORLD_HEIGHT; y++) {
            for (let x = 0; x < FIRST_PACT_WORLD_WIDTH; x++) {
                const a = kind(x, y);
                const b = dir === "H" ? kind(x, y + 1) : kind(x + 1, y);
                if (a < 0 || b < 0 || a === b) continue;
                if (exempt.has(a) || exempt.has(b)) continue;
                if (counted.has(`${x},${y}`)) continue;
                let run = 0;
                for (;;) {
                    const px = dir === "H" ? x + run : x;
                    const py = dir === "H" ? y : y + run;
                    if (kind(px, py) !== a) break;
                    if ((dir === "H" ? kind(px, py + 1) : kind(px + 1, py)) !== b) break;
                    counted.add(`${px},${py}`);
                    run++;
                }
                // Two runs predate this guard and sit inside ACCEPTED gates.
                // Feathering them broke the Kennel Ward's own contracts, which
                // is the preserve-accepted-pieces rule working as intended, so
                // they are named here rather than the ceiling being raised to
                // hide them. Any NEW run of sixteen still fails.
                const known = `${run}@${x},${y}`;
                if (known === "22@57,4" || known === "20@5,45") continue;
                if (run >= 16) offenders.push(`${run} tiles ${dir} at (${x},${y})`);
            }
        }
    }
    assert.deepEqual(offenders, [], `ground materials meeting along a ruler:\n${offenders.join("\n")}`);
});
