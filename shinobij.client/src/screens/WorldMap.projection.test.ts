import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worldMapSource = readFileSync(new URL("./WorldMap.tsx", import.meta.url), "utf8");
const canvasSource = readFileSync(new URL("../components/WorldSectorCanvas.tsx", import.meta.url), "utf8");
const commandPanelBody = readFileSync(new URL("../components/WorldSectorCommandPanel.tsx", import.meta.url), "utf8");
// The panel's row/prop shapes live in a sibling module. BOTH halves are
// budgeted and BOTH are searched for authority, because the split did not
// remove lines — it moved them, and added a header plus imports on top. A
// single combined budget would have had to be LOOSER than the one it replaced;
// two tight ones cannot be dodged by moving code across the pair.
const commandPanelTypes = readFileSync(new URL("../components/WorldSectorCommandPanel.types.ts", import.meta.url), "utf8");
const commandPanelSource = commandPanelBody + "\n" + commandPanelTypes;
const overlaySource = readFileSync(new URL("../components/WorldSectorOverlayLayer.tsx", import.meta.url), "utf8");
const dialogSource = readFileSync(new URL("../components/WorldWandererDialog.tsx", import.meta.url), "utf8");

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
    // 5,258 RAISED from 5,190 at the origin/main merge. This screen was 5,176
    // on this branch and gained ~84 lines of main's own World Map work (the
    // sealed hunt launch carrying enemyAvatar, the relic-survey walkthrough,
    // quest-metric labelling). None of that is a retired overview layer coming
    // back, which is what this ratchet actually guards — the structural
    // assertions in this file still hold (one exhaustive chest flow, no
    // unreachable overview fallback, live charting before sector markers), and
    // the wanderer dialog stayed extracted in WorldWandererDialog.tsx instead of
    // returning inline. Set to the exact achieved count with no buffer.
    assert.ok(
        // 5,264: the accessible scrim extraction paid back 2 lines, and two
        // encounter fixes spent 8 — Escape/role/label on the one dialog that can
        // open unbidden, and a Fight button that no longer swallows the click
        // when admission is closed. The budget guards re-inlining retired map
        // layers, not bug fixes; it is the exact achieved count, with no buffer.
        lineCount(worldMapSource) <= 5_264,
        `WorldMap.tsx grew past 5,264 lines; retired overview layers must stay retired.`,
    );
    assert.ok(
        lineCount(canvasSource) <= 220,
        `WorldSectorCanvas.tsx grew past 220 lines; overlays and controllers must remain separate.`,
    );
    assert.ok(
        lineCount(commandPanelBody) <= 233,
        `WorldSectorCommandPanel.tsx grew past 233 lines; commands and authority must remain in WorldMap.`,
    );
    assert.ok(
        lineCount(commandPanelTypes) <= 82,
        `WorldSectorCommandPanel.types.ts grew past 82 lines; it holds row/prop shapes only — logic belongs in the panel, and commands in WorldMap.`,
    );
    assert.ok(
        lineCount(overlaySource) <= 165,
        `WorldSectorOverlayLayer.tsx grew past 165 lines; portals and workflows must remain in WorldMap.`,
    );
    assert.ok(
        lineCount(dialogSource) <= 375,
        `WorldWandererDialog.tsx grew past 375 lines; workflows and authority must remain in WorldMap.`,
    );
});

test("WorldMap keeps one exhaustive early chest flow and no unreachable overview fallback", () => {
    const chestVnBranch = "if (activeChest && !chestVnDone) {";
    const chestRevealBranch = "if (activeChest && chestVnDone) {";
    const travelingBranch = "if (isTraveling) {";

    assert.equal(worldMapSource.split(chestVnBranch).length - 1, 1);
    assert.equal(worldMapSource.split(chestRevealBranch).length - 1, 1);
    assertOrdered(worldMapSource, [chestVnBranch, chestRevealBranch, travelingBranch], "early chest returns before travel");

    const overviewStart = worldMapSource.indexOf("{wmZoom.active ? (");
    assert.ok(overviewStart > worldMapSource.indexOf(travelingBranch), "final overview must follow the traveling return");
    const finalOverview = worldMapSource.slice(overviewStart);
    assert.doesNotMatch(finalOverview, /\bactiveChest\b/u);
});

test("world overview keeps live charting before sector markers without retired drawing layers", () => {
    const overviewStart = worldMapSource.indexOf("{wmZoom.active ? (");
    assert.ok(overviewStart >= 0, "missing final world overview");
    const finalOverview = worldMapSource.slice(overviewStart);

    assertOrdered(finalOverview, ["<WorldRoadsOverlay />", "<WorldPoiPlates />", "{sectorPoints.map"], "world overview charting order");
    assert.doesNotMatch(finalOverview, /\b(?:sea-label|atlas-landmass|atlas-region-label)\b/u);
});

test("selected enemy-village territory uses its total SectorMap path without retired scene fallbacks", () => {
    const selectedVillage = sliceBetween(worldMapSource, "if (selectedVillageTerritory) {", "if (selectedLandmark) {");

    assert.match(selectedVillage, /const sectorMapSrc = villageOuterTerritoryMapUrl\(loc\.name, virtualSector\);/u);
    assert.match(selectedVillage, /<div className="pixel-map walkable-sector-map sector-image-map">\s*<SectorMap image=\{sectorMapSrc\} \/>/u);
    assert.doesNotMatch(selectedVillage, /\b(?:sectorMapMode|territoryBg|villageTerritorySectorBg)\b/u);
    assert.doesNotMatch(selectedVillage, /<(?:SectorScene|SectorScene3D|SectorScatter|SceneAmbience3D|SectorForeground)\b/u);
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

test("WorldWandererDialog stays hook-free, network-free, persistence-free, portal-free, and authority-free", () => {
    assert.doesNotMatch(dialogSource, /\buse(?:State|Effect|LayoutEffect|Reducer|Ref|Memo|Callback|ImperativeHandle)\s*\(/u);
    assert.doesNotMatch(dialogSource, /\bfetch\s*\(/u);
    assert.doesNotMatch(dialogSource, /\b(?:localStorage|sessionStorage)\b/u);
    assert.doesNotMatch(dialogSource, /\bcreatePortal\s*\(/u);
    assert.doesNotMatch(dialogSource, /\bDate\.now\s*\(|\bnew Date\s*\(|\b(?:setInterval|setTimeout)\s*\(/u);
    assert.doesNotMatch(dialogSource, /\b(?:mutationAvailability|capabilityAdmissionAllowed|postWandererService|engageMerc|coolWanderer)\b/u);
    assert.match(dialogSource, /return \(\s*<div className="card"/u);
    assert.doesNotMatch(dialogSource, /position:\s*"fixed"|inset:\s*0|zIndex:\s*9999/u);
});

test("WorldWandererDialog preserves forced-choice dismissal and button order", () => {
    const attackChoices = sliceBetween(dialogSource, 'wandererDialog.w.verb === "attack"', ') : !wandererDialog.msg && wandererDialog.w.verb === "bountyHunter"');
    assertOrdered(attackChoices, [
        'onClick={dismissWandererDialog}>Pass in peace</button>',
        'onClick={() => startWandererAttack(wandererDialog.w, false)}',
        '>Fight anyway</button>',
        'onClick={() => startWandererAttack(wandererDialog.w, !!wandererDialog.nemesis)}',
        '>Fight</button>',
        'onClick={dismissWandererDialog}>Flee</button>',
    ], "wanderer attack choice order");
    const bountyChoices = sliceBetween(dialogSource, 'wandererDialog.w.verb === "bountyHunter"', ') : !wandererDialog.msg && wandererDialog.w.verb === "merchant"');
    assertOrdered(bountyChoices, [
        'startBountyHunterFight(wandererDialog.w)',
        '"Stand & Fight"',
        'onClick={dismissWandererDialog}>Flee</button>',
    ], "bounty hunter forced-choice order");
    assert.match(dialogSource, /wandererDialog\.w\.verb === "merchant"[\s\S]*onClick=\{closeWandererDialog\}>Leave<\/button>/u);
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
    assert.match(projection, /const sectorOverlayBoss[\s\S]*isWeeklyBossRoamEnabled\(\)[\s\S]*weeklyBossRoamState\(roamingBoss, serverNow\(\)\)/u);
});

test("WorldMap owns the wanderer portal, backdrop policy, actions, and projected contextual decisions", () => {
    const projections = sliceBetween(worldMapSource, "const wandererDialogEmissary", "return (");
    assert.match(projections, /const wandererLegacyTrial = legacyAvailable && character\.legacy && wandererDialogEmissary \? \([\s\S]*<EmissaryTrialPanel[\s\S]*onVersionedCharacter=\{onVersionedCharacter\}/u);
    assert.match(projections, /const wandererDialogNow[\s\S]*Date\.now\(\)/u);
    assert.match(projections, /const wandererDialogDayBucket[\s\S]*currentWandererDayBucket\(\)/u);
    assert.match(projections, /const wandererDialogAtWar[\s\S]*activeVillageWarsFor\(character\.village\)/u);

    const portal = sliceBetween(worldMapSource, "{wandererDialog && createPortal(", "document.body,");
    assertOrdered(portal, [
        "onBackdrop={handleWandererBackdropClick}",
        "<WorldWandererDialog",
        "now={wandererDialogNow}",
        "emissaryDayBucket={wandererDialogDayBucket}",
        "atWar={wandererDialogAtWar}",
        "legacyTrial={wandererLegacyTrial}",
        "dismissWandererDialog={dismissWandererDialog}",
        "handleStoryReckoningAbandon={handleStoryReckoningAbandon}",
    ], "wanderer portal projection");
    assert.match(worldMapSource, /function handleWandererBackdropClick\(\)[\s\S]*requiresWandererChoice\(wandererDialog\)[\s\S]*dismissWandererDialog\(\)/u);
    // The encounter dialog is the ONLY one in the game that can open with no
    // player action (a bandit arms itself and walks to you), so it must not go
    // back to being a bare div: announced, focusable, and escapable even when
    // the backdrop deliberately refuses a forced choice.
    assert.match(portal, /<ModalDialogScrim label=\{`\$\{wandererDialog\.w\.name\}/u,
        "the wanderer portal must render through the accessible scrim, labelled with the wanderer");
    assert.match(portal, /onEscape=\{dismissWandererDialog\}/u,
        "Escape must be a real exit — fleeing already costs the wanderer cooldown");
    assert.doesNotMatch(portal, /zIndex:\s*9999/u,
        "the scrim's own styling belongs in ModalDialogScrim, not inline here");
    assert.match(worldMapSource, /async function tradeWithWanderer[\s\S]*postWandererService/u);
    assert.match(worldMapSource, /async function acceptEpic[\s\S]*fetch\("\/api\/sector\/questbook"/u);
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
