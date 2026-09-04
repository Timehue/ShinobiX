import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BATTLE_SCREENS, RESTORABLE_SCREENS, isUnresolvedBattle } from "./screen-guards";
import { FIRST_PACT_NPCS, isFirstPactWalkable } from "./first-pact-world.js";
import { FIRST_PACT_INTERIORS, firstPactInteriorExit } from "./first-pact-interiors.js";
import { firstPactDistrictAt } from "../../../shared/first-pact-contract.js";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const hub = readFileSync(new URL("../screens/CentralHub.tsx", import.meta.url), "utf8");
const firstPact = readFileSync(new URL("../screens/FirstPact.tsx", import.meta.url), "utf8");
const preview = readFileSync(new URL("../firstpactpreview.tsx", import.meta.url), "utf8");
const criticCapture = readFileSync(new URL("../../scripts/capture-first-pact-critic.mjs", import.meta.url), "utf8");
const highCourtReliability = readFileSync(new URL("../../scripts/capture-first-pact-high-court-reliability.mjs", import.meta.url), "utf8");
const visualVerification = readFileSync(new URL("../../scripts/verify-first-pact-visual.mjs", import.meta.url), "utf8");
const server = readFileSync(new URL("../../../server.ts", import.meta.url), "utf8");

test("The First Pact is lazy-mounted from the Celestial Tower and level-gated at 100", () => {
    assert.match(app, /const FirstPact = lazyWithRetry\(\(\) => import\("\.\/screens\/FirstPact"\)/);
    assert.match(app, /screen === "firstPact"[\s\S]{0,500}<FirstPact/);
    assert.match(app, /<FirstPact[\s\S]{0,500}onExit=\{\(\) => setScreen\("centralHub"\)\}/);
    assert.match(app, /<FirstPact[\s\S]{0,500}onBattleActiveChange=\{setPetBattleActive\}/);
    assert.match(hub, /disabled=\{character\.level < 100\}/);
    assert.match(hub, /setScreen\("firstPact"\)/);
    assert.match(hub, /two active pets plus two reserves/i);
});

test("The First Pact survives refresh but locks navigation only during its embedded battle", () => {
    assert.equal(RESTORABLE_SCREENS.has("firstPact"), true);
    assert.equal(BATTLE_SCREENS.has("firstPact"), true);
    const signals = {
        screen: "firstPact" as const,
        raidBattleKind: "none",
        pvpBattleId: "",
        pvpBattleResolved: false,
        endlessBattleActive: false,
        pendingArenaStoryBattle: false,
        pendingEventEncounter: false,
        activeDungeonEvent: false,
        hollowGateTileGameActive: false,
        pendingPetBattle: false,
        arenaBattleActive: false,
        petBattleActive: false,
        missionBattleActive: false,
    };
    assert.equal(isUnresolvedBattle(signals), false);
    assert.equal(isUnresolvedBattle({ ...signals, petBattleActive: true }), true);
});

test("both First Pact server routes are mounted in the production server", () => {
    assert.match(server, /import firstPactStateHandler from '\.\/api\/first-pact\/state\.js'/);
    assert.match(server, /route\('\/first-pact\/state',\s+firstPactStateHandler\)/);
    assert.match(server, /route\('\/pet\/showdown',\s+petShowdownHandler\)/);
});

test("the lower kennel court closes obsolete ground cutouts beneath the boulevard layer", () => {
    const lowerCourt = firstPact.match(/function drawLowerKennelCivicCourt[\s\S]*?function drawBondingCedar/)?.[0];
    assert.ok(lowerCourt, "the lower kennel court draw pass must remain present");
    assert.match(lowerCourt, /court\.rect\(sx\(17\.2\), sy\(41\.95\), 2\.85 \* size, 1\.72 \* size\)/);
    assert.match(lowerCourt, /court\.rect\(sx\(22\.95\), sy\(41\.95\), 3\.05 \* size, 2 \* size\)/);
    assert.match(lowerCourt, /drawWesternWardCobbles\(context, camera, court, \{ x: 12\.15, y: 41\.8, width: 13\.85, height: 8\.55 \}\)/);
    assert.match(firstPact, /drawLowerKennelCivicCourt\(context, camera\);\s*drawKennelBoulevardJunctions\(context, camera\);/);
});

test("the infirmary service court covers the boulevard lip without replacing its route", () => {
    const infirmaryGround = firstPact.match(/function drawKennelInfirmaryGround[\s\S]*?function drawKennelFootpaths/)?.[0];
    assert.ok(infirmaryGround, "the infirmary ground pass must remain present");
    assert.match(infirmaryGround, /serviceCourt\.moveTo\(sx\(9\.55\), sy\(45\.28\)\)/);
    assert.match(infirmaryGround, /serviceCourt\.lineTo\(sx\(15\.08\), sy\(46\.2\)\)/);
    assert.match(infirmaryGround, /connector\.rect\(sx\(8\), sy\(45\.25\), 2 \* size, 6\.75 \* size\)/);
    assert.match(infirmaryGround, /tile !== FirstPactTile\.Road && tile !== FirstPactTile\.Kennel/);
    assert.match(firstPact, /drawKennelInfirmaryGround\(context, camera\)[\s\S]*?drawKennelBoulevardJunctions\(context, camera\);/);
});

test("the handler lodge uses a localized substrate that architecture overpaints", () => {
    const lodgeLot = firstPact.match(/function drawHandlerLodgeLotGround[\s\S]*?function drawCentralKennelLotFields/)?.[0];
    assert.ok(lodgeLot, "the localized handler-lodge substrate must remain present");
    assert.match(lodgeLot, /lodgeLot\.moveTo\(sx\(10\.68\), sy\(38\.58\)\)/);
    assert.match(lodgeLot, /lodgeLot\.lineTo\(sx\(9\.85\), sy\(42\.22\)\)/);
    assert.match(lodgeLot, /lodgeLot\.lineTo\(sx\(15\.92\), sy\(43\.06\)\)/);
    assert.match(lodgeLot, /tile !== FirstPactTile\.Kennel && tile !== FirstPactTile\.Road/);
    assert.doesNotMatch(lodgeLot, /isFirstPactWalkable/);
    assert.doesNotMatch(firstPact, /lots\.moveTo\(sx\(10\.86\), sy\(35\.2\)\)/);
    assert.match(firstPact, /drawCentralKennelLotFields\(context, camera\);\s*drawHandlerLodgeLotGround\(context, camera\);/);
    assert.match(firstPact, /drawKennelFootpaths\(context, camera\);[\s\S]*?drawArchitecture\(context, camera,/);
});

test("the lower Aqueduct render follows bridge, bank, minimap, and proof truth", () => {
    const crossingDispatch = firstPact.match(/function isCanalCrossingTile[\s\S]*?const KENNEL_BOULEVARD_SHOULDER/)?.[0];
    assert.ok(crossingDispatch, "the canal crossing dispatch must remain present");
    assert.match(crossingDispatch, /firstPactTileAt\(x, y\) === FirstPactTile\.Bridge/);
    assert.doesNotMatch(crossingDispatch, /if \(x < 28|return y >= 27|y >= 43|y <= 46/, "Aqueduct decks cannot return to coordinate-only bridge paint");

    const boulevard = firstPact.match(/function drawKennelBoulevardJunctions[\s\S]*?const WESTERN_WARD_COBBLES/)?.[0];
    assert.ok(boulevard, "the boulevard render must remain present");
    assert.match(boulevard, /const aqueductNonRoute = new Path2D\(\)/);
    assert.match(boulevard, /\(aqueduct\.deck\.y - aqueduct\.control\.y\) \* size/);
    assert.match(boulevard, /aqueduct\.westBankSouth\.y \+ aqueduct\.westBankSouth\.height - deckBottom/);
    assert.match(boulevard, /globalCompositeOperation = "destination-out"/);
    assert.doesNotMatch(firstPact, /drawAqueductCivicBoulevardPavers/, "the deck cannot be reconstructed as a rectangular paver plate");
    assert.match(firstPact, /drawKennelFootpaths\(context, camera\);\s*drawBellQuarterPlantings\(context, camera\);/);

    const infrastructure = firstPact.match(/function drawAqueductCivicBoulevardInfrastructure[\s\S]*?function drawGardensAqueductEmbankment/)?.[0];
    assert.ok(infrastructure, "the lower Aqueduct needs a dedicated infrastructure pass");
    assert.match(infrastructure, /FIRST_PACT_AQUEDUCT_CIVIC_CROSSING/);
    assert.match(infrastructure, /const bankSegments/);
    assert.match(infrastructure, /Dark, chamfered mouths show the water continuing beneath the deck/);
    assert.match(infrastructure, /discrete low parapet blocks alone identify the bridge silhouette/);
    assert.match(
        firstPact,
        /drawGardensAqueductEmbankment\(context, camera\);\s*drawAqueductCentralCivicCrossing\(context, camera\);\s*drawAqueductCivicBoulevardInfrastructure\(context, camera\);\s*drawMarketCanalInfrastructure\(context, camera\);/,
    );

    const minimap = firstPact.match(/function renderMinimap[\s\S]*?function firstPactEpilogue/)?.[0];
    assert.ok(minimap, "the minimap render must remain present");
    assert.match(minimap, /tile === FirstPactTile\.Water[\s\S]{0,100}TILE_PALETTE\[FirstPactTile\.Water\]\.base[\s\S]{0,100}!isFirstPactWalkable/);
    for (const layer of ["civic-boulevard-deck", "collision-backed-banks", "banked-sluice-control"]) {
        assert.match(firstPact, new RegExp(`"${layer}"`), `${layer} must be represented in post-render proof`);
        assert.match(criticCapture, new RegExp(`"${layer}"`), `${layer} must be required by the Aqueduct capture gate`);
    }
    assert.match(firstPact, /aqueductLayers,/);
});

test("the central Aqueduct capture proves the real bridge without hiding the adjacent world", () => {
    const bridgeDeck = firstPact.match(/function drawBridgeDeck[\s\S]*?function drawCanalWater/)?.[0];
    assert.ok(bridgeDeck, "the shared bridge-deck renderer must remain present");
    assert.match(bridgeDeck, /FIRST_PACT_AQUEDUCT_CENTRAL_CROSSING\.deck/);
    assert.match(bridgeDeck, /drawRoadPavers\(context, x, y, screenX, screenY, architectureScope\)/);

    const infrastructure = firstPact.match(/function drawAqueductCentralCivicCrossing[\s\S]*?function drawAqueductCivicBoulevardInfrastructure/)?.[0];
    assert.ok(infrastructure, "the central bridge needs a dedicated infrastructure pass");
    assert.match(infrastructure, /FIRST_PACT_AQUEDUCT_CENTRAL_CROSSING/);
    assert.match(infrastructure, /const mouths = \[/);
    assert.match(infrastructure, /for \(const abutment of crossing\.abutments\)/);
    assert.match(infrastructure, /Low segmented curbs identify the span/);
    assert.doesNotMatch(infrastructure, /fillRect\(deckLeft, bridgeTop/, "the central bridge cannot be rebuilt as a giant render-only plate");

    for (const layer of [
        "tile-authoritative-central-deck",
        "continuous-central-water-mouths",
        "four-central-bank-abutments",
        "two-low-central-curbs",
        "world-aligned-central-boulevard",
        "open-central-avatar-clearance",
    ]) {
        assert.match(firstPact, new RegExp(`"${layer}"`), `${layer} must be represented in post-render proof`);
        assert.match(criticCapture, new RegExp(`"${layer}"`), `${layer} must be required by the central capture gate`);
    }
    assert.match(preview, /variant === "aqueduct-central"\s*\? \{ x: 29, y: 29 \}/);
    assert.match(preview, /variant === "aqueduct-central"\s*\? \{ x: 23, y: 29, district: "kennel-ward" \}/);
    assert.match(preview, /variant === "aqueduct-central-west"\s*\? \{ x: 24, y: 29 \}/);
    assert.match(preview, /variant === "aqueduct-central-west"\s*\? \{ x: 18, y: 29, district: "kennel-ward" \}/);
    assert.match(firstPact, /!\(visualQaPreview && qaCameraFocus\)[\s\S]{0,120}firstPactDistrictAt\(player\) === "kennel-ward"/);
    assert.match(firstPact, /cameraCenterWorld:/);
    assert.match(criticCapture, /expectedFocusX = state === "aqueduct-central" \? 29 : 24/);
    assert.match(criticCapture, /cameraCenterX - expectedFocusX/);
    assert.match(criticCapture, /proof\.architectureScope !== null/);
    assert.match(criticCapture, /approachJointDeltaPx > 3/);
    assert.match(criticCapture, /sharp\(path\)\.resize\(\{ width: 360, height: 225/);
});

test("High Court critic captures wait for a decoded, settled, layout-painted canvas", () => {
    const imagePreparation = firstPact.match(/const prepareImage = \([\s\S]*?prepareImage\(propsAtlas,[\s\S]*?\);/)?.[0];
    assert.ok(imagePreparation, "world art must share one decode-aware preparation path");
    assert.match(imagePreparation, /image\.onload = load;\s*image\.src = source;\s*if \(image\.complete\) load\(\);/);
    assert.match(imagePreparation, /void image\.decode\(\)\.then\(commit, commit\)/);
    assert.match(firstPact, /useLayoutEffect\(\(\) => \{[\s\S]*?renderWorld\(canvas, camera,[\s\S]*?canvas\.dataset\.fpRenderProof = JSON\.stringify\(proof\);\s*canvas\.dataset\.fpRenderReady/);
    for (const layer of ["high-court-archive", "west-record-hall", "east-council-annex", "archive-gardens", "archive-notice"]) {
        assert.match(firstPact, new RegExp(`"${layer}"`), `${layer} must be represented in the post-render proof`);
        assert.match(highCourtReliability, new RegExp(`"${layer}"`), `${layer} must be required by the repeated-capture gate`);
    }
    assert.match(preview, /criticCapture && \(variant === "world" \|\| variant === "full-campus"\)[\s\S]*?\? "high-court"/);
    assert.match(firstPact, /architectureScope !== "high-court"[\s\S]{0,120}architectureScope !== "gardens-north"[\s\S]{0,120}architectureScope !== "gardens-full"[\s\S]{0,120}colosseum/);
    assert.match(firstPact, /highCourtV3: highCourtMainArchiveReady && highCourtRecordHallReady && highCourtCouncilAnnexReady && highCourtGardensReady/);
    assert.match(preview, /variant === "full-campus"\s*\? \{ x: 42, y: 9 \}/);
    assert.match(preview, /variant === "bell"\s*\? \{ x: 68, y: 13 \}/);
    assert.match(preview, /qaCameraFocus=\{qaCameraFocus\}/);
    assert.match(highCourtReliability, /const runsPerState = 10;/);
    assert.match(highCourtReliability, /if \(!stats\.isOpaque\)/);
    assert.match(highCourtReliability, /high-court-reliability-contact-sheet-1440x720\.png/);
    assert.match(criticCapture, /data-fp-render-ready/);
    assert.match(visualVerification, /data-fp-render-ready/);
    assert.doesNotMatch(criticCapture, /waitForTimeout\(200\)/);
    assert.doesNotMatch(visualVerification, /waitForTimeout\(120\)/);
});

test("a lost campaign fight is answered by the opponent, not by silence", () => {
    // The shared battle component only renders an aftermath line if a mode
    // supplies one, so the campaign has to hand it over at the mount site.
    assert.match(firstPact, /resultNote=\{battleResultNote\}/);
    assert.match(firstPact, /if \(outcome !== "loss"\) return null;/);
    assert.match(firstPact, /firstPactEncounter\(battle\?\.encounterId\)\?\.defeat/);
    const battleComponent = readFileSync(new URL("../components/PetShowdownBattle.tsx", import.meta.url), "utf8");
    assert.match(battleComponent, /resultNote\?: \(outcome: "win" \| "loss"\) => string \| null \| undefined;/);
    assert.match(battleComponent, /showdown-result-note/);
    const showdownCss = readFileSync(new URL("../screens/PetShowdown.css", import.meta.url), "utf8");
    assert.match(showdownCss, /\.showdown-result-note \{/);
});

test("the Court has a face, a portrait, and a square of its own to stand in", () => {
    const arbiter = FIRST_PACT_NPCS.find((npc) => npc.id === "court-arbiter");
    assert.ok(arbiter, "the campaign's antagonist must exist as a person in the city");
    assert.equal(firstPactDistrictAt(arbiter.position), "high-court");
    assert.equal(isFirstPactWalkable(arbiter.position.x, arbiter.position.y), true);
    // Standing on a door hides the NPC and buries an enterable building.
    for (const interior of FIRST_PACT_INTERIORS) {
        const door = firstPactInteriorExit(interior);
        assert.ok(
            door.x !== arbiter.position.x || door.y !== arbiter.position.y,
            `the Arbiter is standing on ${interior.id}'s door`,
        );
    }
    // Every other named face in this cast is a painted portrait, so this one is
    // too. A letter tile for the antagonist would read as unfinished.
    assert.match(firstPact, /import arbiterPortrait from "\.\.\/assets\/first-pact\/portraits\/court-arbiter\.webp";/);
    assert.match(firstPact, /"court-arbiter": arbiterPortrait,/);
    assert.match(firstPact, /if \(npc\.id === "court-arbiter"\) \{/);
    // Orin explains the threshold. The Arbiter must not repeat him.
    assert.doesNotMatch(firstPact, /Go and be expensive[\s\S]{0,4000}Go and be expensive/);
});

test("standing is spent through the server, and the screen only reports the result", () => {
    assert.match(firstPact, /const enterFinding = async \(writId: string\): Promise<boolean> => \{/);
    assert.match(firstPact, /await enterFirstPactFinding\(character\.name, writId\)/);
    // The screen must never do the arithmetic itself.
    assert.doesNotMatch(firstPact, /courtStanding: [\s\S]{0,40}- FIRST_PACT_FINDING_COST/);
    const api = readFileSync(new URL("./first-pact-api.ts", import.meta.url), "utf8");
    assert.match(api, /"enter-finding", \{ writId \}/);
    const route = readFileSync(new URL("../../../api/first-pact/state.ts", import.meta.url), "utf8");
    assert.match(route, /action === "enter-finding"/);
    assert.match(route, /enterFirstPactFindingForPlayer\(playerName, writId\)/);
    // Spending has to be visible somewhere the player will see it drop.
    assert.match(firstPact, /Findings entered/);
    // And the harness has to exercise the same reducer the endpoint does.
    assert.match(preview, /body\.action === "enter-finding"/);
});

test("the crossing is not silent, and its ambience follows the player", () => {
    assert.match(firstPact, /primeGameAudio\(FIRST_PACT_AUDIO_CUES\)/);
    assert.match(firstPact, /startGameAmbience\("ambience-hollow"/);
    assert.match(firstPact, /startGameAmbience\(interior \? "ambience-interior" : "ambience-village"/);
    // A mounted battle owns the audio, and an ambience voice outlives its
    // component unless the screen stops it on the way out.
    assert.match(firstPact, /if \(battle\) \{\s*\r?\n\s*stopGameAmbience\(400\);/);
    assert.match(firstPact, /useEffect\(\(\) => \(\) => stopGameAmbience\(320\), \[\]\);/);
    for (const cue of ["omen", "decision", "chapter-seal", "battle-transition", "paper"]) {
        assert.ok(firstPact.includes(`playGameSfx("${cue}"`), `the ${cue} cue is declared but never played`);
    }
    // Declared cues must all be real, or priming throws on an unknown path.
    const declared = firstPact.match(/const FIRST_PACT_AUDIO_CUES[^=]*= \[([\s\S]*?)\];/)?.[1] ?? "";
    const cues = [...declared.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
    assert.ok(cues.length >= 8);
    const audio = readFileSync(new URL("./game-audio.ts", import.meta.url), "utf8");
    for (const cue of cues) assert.ok(audio.includes(`"${cue}"`), `${cue} is not a cue game-audio knows`);
});


test("the Standing Court is reachable, tracked, and only ever entered in order", () => {
    // Entry is the Arbiter, not a menu: the rerun exists because the Court lost
    // to this player, so the Court is what offers it.
    assert.match(firstPact, /const standingRound = expectedFirstPactStandingCourtRound\(progress\);/);
    assert.match(firstPact, /encounterId: standingRound\.id,/);
    assert.match(firstPact, /Open the docket: \$\{standingRound\.title\}/);
    // A lost sitting resets the run, so the rematch button has to re-ask where
    // the docket stands rather than replay the sitting that was just lost.
    assert.match(firstPact, /expectedFirstPactStandingCourtRound\(progress\)\?\.id[\s\S]{0,120}expectedFirstPactMainEncounter\(progress\)\?\.id/);
    assert.match(firstPact, /<span>The Standing Court<\/span>/);
    assert.match(preview, /state=standing-court|standingCourtVariant/);
});

test("the Court's mirrored roster is built on the server, from pets it verified", () => {
    const showdown = readFileSync(new URL("../../../api/pet/showdown.ts", import.meta.url), "utf8");
    // Derived from `chosen`, which this handler has already proved the player
    // owns and is not busy with. A roster off the request body would let the
    // player choose what the Arbiter brings.
    assert.match(showdown, /firstPactMirrorRoster\(\s*\r?\n?\s*chosen as unknown/);
    assert.doesNotMatch(showdown, /firstPactMirrorRoster\(\s*body\./);
    assert.match(showdown, /expectedFirstPactStandingCourtRound\(progress\)/);
    // The one settlement that must run on a loss as well.
    assert.match(showdown, /settleFirstPactStandingCourtBattle\(playerName, standingRound\.id, session\.outcome/);
    // And the sessions stay reward-ineligible like every other one here.
    assert.match(showdown, /rewardEligible: false/);
    const state = readFileSync(new URL("../../../api/first-pact/_state.ts", import.meta.url), "utf8");
    assert.match(state, /export async function settleFirstPactStandingCourtBattle/);
});
