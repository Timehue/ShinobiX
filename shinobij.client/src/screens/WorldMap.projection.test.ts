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
const storyFieldRouteBoundarySource = readFileSync(new URL("../components/StoryFieldRouteBoundary.tsx", import.meta.url), "utf8");

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
        // 5,333 (+66): the shared daily pool is now legible on the board, and the
        // day's posted contracts sit on it. The last +7 is a PERFORMANCE fix, not
        // growth: the tier and the contract were being recomputed inside the
        // className and the title of every one of ~67 markers, so each render did
        // hundreds of 66-element board sorts and territory reads. They are now
        // resolved once per marker into locals. Markers
        // carry a rich/worked/spent tier, and a drained sector's Explore becomes
        // "Find richer ground", which walks the road graph for the nearest sector
        // that still pays. The projection itself lives in lib/sector-richness.ts;
        // what landed here is the owner resolver, the tier read, and the one
        // handler — screen-level wiring the ratchet has never guarded. This is a
        // new signal on the overview, not a retired layer coming back. Exact
        // achieved count, no buffer.
        // 5,355 (+22): 214815c8f highlights the tutorial's click targets, so a new
        // player can see WHICH thing on the board the Academy is asking them to
        // press. That is onboarding affordance on the existing overview, not a
        // retired drawing layer coming back — which is the only thing this number
        // guards. The structural assertions below still hold unchanged: one
        // exhaustive chest flow, no unreachable overview fallback, live charting
        // before sector markers, and the wanderer dialog still extracted. Exact
        // achieved count, no buffer, per the convention above.
        lineCount(worldMapSource) <= 5_355,
        `WorldMap.tsx grew past 5,355 lines; retired overview layers must stay retired.`,
    );
    assert.ok(
        lineCount(canvasSource) <= 220,
        `WorldSectorCanvas.tsx grew past 220 lines; overlays and controllers must remain separate.`,
    );
    assert.ok(
        // 249 (+2): the explicit presence projection makes scouting read-only.
        // 247 (+14): Explore no longer switches off on a drained pool — it changes
        // verb to "Find richer ground" — and the day's posted contract gets a card.
        // Presentation only: the richer-ground search, the contract fetch and the
        // claim all stayed in WorldMap behind onFindRicherGround/onClaimContract,
        // and the card itself is its own leaf (SectorContractCard.tsx).
        lineCount(commandPanelBody) <= 249,
        `WorldSectorCommandPanel.tsx grew past 249 lines; commands and authority must remain in WorldMap.`,
    );
    assert.ok(
        // 92 (+2): the explicit presence prop keeps remote scouting read-only.
        // 90 (+8): two more command callbacks (onFindRicherGround, onClaimContract)
        // and the posted-contract row shape, with their doc lines.
        lineCount(commandPanelTypes) <= 92,
        `WorldSectorCommandPanel.types.ts grew past 92 lines; it holds row/prop shapes only — logic belongs in the panel, and commands in WorldMap.`,
    );
    assert.ok(
        lineCount(overlaySource) <= 165,
        `WorldSectorOverlayLayer.tsx grew past 165 lines; portals and workflows must remain in WorldMap.`,
    );
    assert.ok(
        lineCount(dialogSource) <= 375,
        `WorldWandererDialog.tsx grew past 375 lines; workflows and authority must remain in WorldMap.`,
    );
    assert.ok(
        lineCount(storyFieldRouteBoundarySource) <= 20,
        `StoryFieldRouteBoundary.tsx grew past 20 lines; it owns only lazy content readiness and fallback presentation.`,
    );
});

test("field content readiness stays in its route boundary", () => {
    assert.match(worldMapSource, /<StoryFieldRouteBoundary onReturn=/u);
    assert.match(storyFieldRouteBoundarySource, /readStoryFieldContent\(\)/u);
    assert.match(storyFieldRouteBoundarySource, /<StoryFieldContentBoundary onReturn=\{onReturn\}>[\s\S]*<Suspense/u);
    assert.doesNotMatch(storyFieldRouteBoundarySource, /\bfetch\s*\(|\b(?:localStorage|sessionStorage)\b/u);
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
        "if (roadExit && isCurrent) onCrossExit(roadExit);",
        "else onSelectTile(index);",
    ], "one-click road crossing before ordinary movement");
    // Every visual that belongs to a tile must stay nested in that tile button.
    // An explicitly placed sibling grid item reserves its cell before the 144
    // auto-placed buttons are laid out, shifting every later button away from
    // its index. The result is both visual (gates drift inward) and functional
    // (clicking a square moves to a different tile).
    assert.doesNotMatch(canvasSource, /SectorGatePlate|gate-plate|gridColumn|gridRow/u);
    assertOrdered(canvasSource, [
        '<button',
        '<SectorGateMarker',
        '</button>',
    ], "gate marker stays inside its indexed tile button");
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
        '"Find richer ground" : "Explore"',
        'onClick={onHunt}',
        '<span>Recover</span>',
        '<span>Leave</span>',
    ], "selected-sector action order");
    // A drained pool changes the verb; it must never switch the slot off. The
    // pool is shared and per-sector, so "nothing here" always means "something
    // nearby" — a disabled button is a dead end that hides that fact.
    assert.doesNotMatch(actions, /disabled=\{gatherDepleted\}/u);
    assert.match(actions, /onClick=\{gatherDepleted \? onFindRicherGround : onExplore\}/u);
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

test("selected-sector scouting is read-only and never impersonates travel", () => {
    const launch = sliceBetween(worldMapSource, "function launchWorldMapFight", "async function launchAiGuardRaid");
    assertOrdered(launch, ["sameSector(currentSector, sector)", "capabilityAdmissionAllowed", "requestAiFight"], "World fight location guard");
    assert.doesNotMatch(launch, /setCurrentSector\(/u);

    const projection = sliceBetween(worldMapSource, "<WorldSectorCanvas", "onLeave={handleLeaveSelectedSector}");
    assert.match(projection, /wanderers=\{sectorIsCurrent \? sectorOverlayWanderers : \[\]\}/u);
    assert.match(projection, /rift=\{sectorIsCurrent \? sectorOverlayRift : null\}/u);
    assert.match(projection, /vault=\{sectorIsCurrent \? sectorOverlayVault : null\}/u);
    assert.match(projection, /encounterLayer=\{sectorIsCurrent \? \(/u);
    assert.match(projection, /<WorldSectorCommandPanel[\s\S]*present=\{sectorIsCurrent\}/u);

    assert.match(canvasSource, /disabled=\{!isCurrent\}[\s\S]*onClick/u);
    assert.match(canvasSource, /\{isCurrent && \(\s*<SectorAvatar/u);
    assert.match(commandPanelSource, /disabled=\{!present \|\| !villageWarAdmissionOpen/u);
    assert.match(commandPanelSource, /disabled=\{!present \|\| player\.actionDisabled\}/u);
    assert.match(commandPanelSource, /disabled=\{!present\} onClick=\{onHunt\}/u);
    assert.match(commandPanelSource, /disabled=\{!present\} onClick=\{onRecover\}/u);

    const keyboard = sliceBetween(worldMapSource, "// ── WASD / E keyboard controls", "// Clear the edge-crossing slide class");
    assertOrdered(keyboard, ["!sameSector(currentSector, selectedSector)", "const activeSector = selectedSector", "void exploreSector(activeSector)", "setSectorPlayerPos"], "remote scouting keyboard guard");
    const combatEnvironment = sliceBetween(worldMapSource, "function selectedSectorCombatEnvironment", "function focusSectorCombat");
    assert.match(combatEnvironment, /!sameSector\(currentSector, sector\)/u);
    assert.match(worldMapSource, /function handleExploreSelectedSector\(\)[\s\S]*sameSector\(currentSector, selectedSector\)[\s\S]*exploreSector\(selectedSector\)/u);
    assert.match(worldMapSource, /async function handleClaimContract\(\)[\s\S]*!sameSector\(currentSector, selectedSector\)/u);
});

test("the village Outskirts control uses authoritative travel", () => {
    const outskirts = sliceBetween(worldMapSource, "const outskirtsSector = villageOutskirtsSector", "Outskirts");
    assert.match(outskirts, /triggerTravelPoint\(outskirtsSector\)/u);
    assert.doesNotMatch(outskirts, /set(?:CurrentSector|SelectedSector|CurrentBiome|CurrentWeather)\(/u);
});

test("a current-sector gate click atomically moves to and crosses its shared road exit", () => {
    const crossing = sliceBetween(worldMapSource, "function crossSectorExit", "// ── WASD / E keyboard controls");
    assertOrdered(crossing, [
        "sameSector(currentSector, exit.sector)",
        "setSectorPlayerPos(exit.tile)",
        "beginSectorTravel(exit.destinationSector",
        'mode: "edge"',
        "originSector: exit.sector",
        "originTile: exit.tile",
        "exitId: exit.id",
    ], "atomic gate activation");
    assert.doesNotMatch(crossing, /sectorPlayerPos !== exit\.tile/u);
    assert.match(canvasSource, /title=\{roadExit[\s\S]*\? `\$\{isCurrent \? "Cross" : "Road"\}/u);
    assert.match(canvasSource, /ready=\{isCurrent\}/u);
});
