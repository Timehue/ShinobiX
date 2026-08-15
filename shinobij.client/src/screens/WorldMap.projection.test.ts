import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worldMapSource = readFileSync(new URL("./WorldMap.tsx", import.meta.url), "utf8");
const canvasSource = readFileSync(new URL("../components/WorldSectorCanvas.tsx", import.meta.url), "utf8");
const commandPanelSource = readFileSync(new URL("../components/WorldSectorCommandPanel.tsx", import.meta.url), "utf8");
const overlaySource = readFileSync(new URL("../components/WorldSectorOverlayLayer.tsx", import.meta.url), "utf8");

function lineCount(source: string): number {
    return source.trimEnd().split(/\r?\n/u).length;
}

function sliceBetween(source: string, startNeedle: string, endNeedle: string): string {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start + startNeedle.length);
    assert.ok(start >= 0, `Missing source-contract start: ${startNeedle}`);
    assert.ok(end > start, `Missing source-contract end after ${startNeedle}: ${endNeedle}`);
    return source.slice(start, end);
}

function assertOrdered(source: string, needles: readonly string[], contract: string): void {
    let cursor = 0;
    for (const needle of needles) {
        const found = source.indexOf(needle, cursor);
        assert.ok(found >= cursor, `${contract}: expected ${needle} after offset ${cursor}`);
        cursor = found + needle.length;
    }
}

test("WorldMap and its selected-sector leaves keep the projection line-budget ratchets", () => {
    assert.ok(
        lineCount(worldMapSource) <= 5_575,
        `WorldMap.tsx grew past 5,575 lines; selected-sector presentation belongs in its focused leaves.`,
    );
    assert.ok(
        lineCount(canvasSource) <= 220,
        `WorldSectorCanvas.tsx grew past 220 lines; overlays and controllers must remain separate.`,
    );
    assert.ok(
        lineCount(commandPanelSource) <= 285,
        `WorldSectorCommandPanel.tsx grew past 285 lines; commands and authority must remain in WorldMap.`,
    );
    assert.ok(
        lineCount(overlaySource) <= 165,
        `WorldSectorOverlayLayer.tsx grew past 165 lines; portals and workflows must remain in WorldMap.`,
    );
});

test("WorldSectorCanvas stays hook-free, network-free, and persistence-free", () => {
    assert.doesNotMatch(canvasSource, /\buse(?:State|Effect|LayoutEffect|Reducer|Ref|Memo|Callback|ImperativeHandle)\s*\(/u);
    assert.doesNotMatch(canvasSource, /\bfetch\s*\(/u);
    assert.doesNotMatch(canvasSource, /\b(?:localStorage|sessionStorage)\b/u);
    assert.doesNotMatch(canvasSource, /\bDate\.now\s*\(/u);
    assert.doesNotMatch(canvasSource, /\bcreatePortal\s*\(/u);
});

test("WorldSectorCommandPanel stays hook-free, network-free, persistence-free, and authority-free", () => {
    assert.doesNotMatch(commandPanelSource, /\buse(?:State|Effect|LayoutEffect|Reducer|Ref|Memo|Callback|ImperativeHandle)\s*\(/u);
    assert.doesNotMatch(commandPanelSource, /\bfetch\s*\(/u);
    assert.doesNotMatch(commandPanelSource, /\b(?:localStorage|sessionStorage)\b/u);
    assert.doesNotMatch(commandPanelSource, /\bcreatePortal\s*\(/u);
    assert.doesNotMatch(commandPanelSource, /\bDate\.now\s*\(|\b(?:setInterval|setTimeout)\s*\(/u);
    assert.doesNotMatch(commandPanelSource, /\b(?:mutationAvailability|capabilityAdmissionAllowed|launchAiGuardRaid|startPvpRaid)\b/u);
});

test("WorldSectorOverlayLayer stays wrapper-free, hook-free, network-free, persistence-free, and authority-free", () => {
    assert.doesNotMatch(overlaySource, /\buse(?:State|Effect|LayoutEffect|Reducer|Ref|Memo|Callback|ImperativeHandle)\s*\(/u);
    assert.doesNotMatch(overlaySource, /\bfetch\s*\(/u);
    assert.doesNotMatch(overlaySource, /\b(?:localStorage|sessionStorage)\b/u);
    assert.doesNotMatch(overlaySource, /\bcreatePortal\s*\(/u);
    assert.doesNotMatch(overlaySource, /\bDate\.now\s*\(|\b(?:setInterval|setTimeout)\s*\(/u);
    assert.doesNotMatch(overlaySource, /\b(?:mutationAvailability|capabilityAdmissionAllowed|loadSectorTerritory|isSectorTracesEnabled|isWeeklyBossRoamEnabled|weeklyBossRoamState)\b/u);
    assert.match(overlaySource, /return \(\s*<>/u);
    assert.doesNotMatch(overlaySource, /return \(\s*<(?:div|main|section|aside)\b/u);
});

test("WorldSectorOverlayLayer preserves direct-grid actor and marker order", () => {
    assertOrdered(overlaySource, [
        "wanderers.map",
        'className="atlas-landmark atlas-hollowRift sector-rift-structure"',
        'className="atlas-landmark sector-rift-structure"',
        "<SectorTraceMarkers",
        "<SectorShrineStandee",
        "<SectorWeeklyBossActor",
    ], "selected-sector overlay order");
});

test("selected-sector canvas preserves stage and stacking order", () => {
    assert.match(canvasSource, /const GRID_SIZE = 12;/u);
    assert.match(canvasSource, /const TILE_COUNT = GRID_SIZE \* GRID_SIZE;/u);
    assertOrdered(canvasSource, [
        '<main className="tile-scene sector-stage-panel">',
        "<RegionSplash",
        "<SectorMap",
        "<SceneAmbience",
        "<SceneCritters",
        "Array.from({ length: TILE_COUNT })",
        "<SectorPeersLive",
        "<SectorAvatar",
        "{overlayLayer}",
        "<SectorForeground",
        "{encounterLayer}",
    ], "selected-sector stage order");
    assertOrdered(canvasSource, [
        "if (roadExit && isPlayer && isCurrent) onCrossExit(roadExit);",
        "else onSelectTile(index);",
    ], "road crossing before ordinary movement");
});

test("WorldMap retains controller and portal ownership around the canvas slots", () => {
    const projection = sliceBetween(worldMapSource, "<WorldSectorCanvas", "<WorldSectorCommandPanel");
    assertOrdered(projection, [
        "onSelectTile={setSectorPlayerPos}",
        "onCrossExit={crossSectorExit}",
        "overlayLayer={",
        "<WorldSectorOverlayLayer",
        "createPortal(",
        "encounterLayer={",
    ], "WorldMap canvas projection");
    assert.doesNotMatch(projection, /<(?:RegionSplash|SectorGateMarker|SectorPeersLive|SectorWanderer|SectorTraceMarkers|SectorShrineStandee|SectorWeeklyBossActor)\b/u);
    assert.match(projection, /vaultRaid && createPortal\([\s\S]*<AnbuVaultRaid/u);
    assert.match(projection, /bossDialog && createPortal\([\s\S]*onClick=\{standBossFight\}/u);
    assert.match(projection, /<SageOfferModal/u);
    assert.doesNotMatch(overlaySource, /\b(?:AnbuVaultRaid|SageOfferModal|standBossFight|createPortal)\b/u);
});

test("WorldMap projects overlay time, storage, and capability decisions before rendering", () => {
    const projection = sliceBetween(worldMapSource, "const sectorOverlayWanderers", "<WorldSectorCanvas");
    assert.match(projection, /const sectorOverlayRift/u);
    assert.match(projection, /const sectorOverlayVault[\s\S]*anbuViewOpen[\s\S]*territory\.ownerVillage/u);
    assert.match(projection, /const sectorOverlayShrine[\s\S]*isSectorTracesEnabled\(\)[\s\S]*shrineForSector/u);
    assert.match(projection, /const sectorOverlayBoss[\s\S]*isWeeklyBossRoamEnabled\(\)[\s\S]*weeklyBossRoamState\(roamingBoss, Date\.now\(\)\)/u);
});

test("WorldSectorCommandPanel preserves command hierarchy and action order", () => {
    assertOrdered(commandPanelSource, [
        '<aside className="instance-actions sector-command-panel"',
        '<header className="sector-panel-heading">',
        '{territory && (',
        '<SectorTracesCard',
        '<h4>Players Here</h4>',
        '{hunt && (',
        '<div className="sector-action-grid" aria-label="Sector actions">',
    ], "selected-sector command hierarchy");
    const actions = commandPanelSource.slice(commandPanelSource.indexOf('<div className="sector-action-grid"'));
    assertOrdered(actions, [
        '<span>Explore</span>',
        'onClick={onHunt}',
        '<span>Recover</span>',
        '<span>Leave</span>',
    ], "selected-sector action order");
    assert.match(commandPanelSource, /aria-label=\{`Sector \$\{sector\} command panel`\}/u);
    assert.match(commandPanelSource, /player\.status === "Traveling"[\s\S]*player\.status === "Fighting"[\s\S]*"Attack"/u);
});

test("WorldMap keeps live Village War admission checks around command-panel async work", () => {
    const raidController = sliceBetween(
        worldMapSource,
        "async function handleSelectedSectorVillageWarRaid",
        "function handleSelectedSectorPlayerAttack",
    );
    assertOrdered(raidController, [
        'mutationAvailability("villageWar")',
        "await fetchSavedPlayerCharacter(guard.name)",
        'mutationAvailability("villageWar")',
        "await startPvpRaid",
        "await launchAiGuardRaid",
        "function handleSelectedSectorControlledRaid",
        'mutationAvailability("villageWar")',
        "void launchAiGuardRaid",
    ], "selected-sector Village War authority");
    assert.match(worldMapSource, /onRaidEnemyVillage=\{handleSelectedSectorVillageWarRaid\}/u);
    assert.match(worldMapSource, /onAttackPlayer=\{handleSelectedSectorPlayerAttack\}/u);
});
