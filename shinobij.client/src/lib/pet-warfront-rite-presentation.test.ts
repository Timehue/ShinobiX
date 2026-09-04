import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import {
    RITE_REVEAL_FIGHTER_COUNT,
    allRiteFighterModelsReady,
    bucketEvents,
    createActorPoseSample,
    elementColor,
    lethalTick,
    riteCanvasGroundingAoDepthScale,
    riteCanvasLivingWaterFootAnchorY,
    riteGroundingAoCameraForwardOffset,
    riteGroundingFocusStrength,
    sampleActor,
    sampleActorByIdInto,
    sampleActorInto,
    sampleProjectiles,
    sampleProjectilesInto,
    squadFocusAt,
} from "./pet-warfront-rite-presentation";
import type { DuelEvent, DuelResult, DuelSnapshot } from "./pet-duel-sim";

/*
 * `sampleActor` IS the fix for the "jittery" complaint that killed the lane war.
 *
 * That stage floored its playback clock, took the FLOOR snapshot, and then ran
 * an exponential low-pass filter to chase the resulting 30 Hz staircase. At
 * 60fps against a 30 Hz input that filter alternates fast and slow frames and
 * lags two to three frames behind truth, which is what a viewer reads as stutter
 * and skating. These tests pin the replacement: a fractional tick returns the
 * exact interpolated position, with no smoothing anywhere.
 */

const actor = (team: "player" | "enemy", over: Partial<DuelSnapshot["actors"][number]> = {}) => ({
    id: team, team, slot: 0,
    x: 0, y: 0, faceX: 1, faceY: 0,
    hp: 100, maxHp: 100, stamina: 100, state: "idle" as const, statuses: [] as string[],
    ...over,
});

const resultFrom = (snapshots: DuelSnapshot[], events: DuelEvent[] = []): DuelResult => ({
    result: "win", winner: "player", ticks: snapshots.length, snapshots, events,
});

const twoTicks = () => resultFrom([
    { t: 0, actors: [actor("player", { x: 0, y: 0, hp: 100 }), actor("enemy", { x: 10, y: 4 })], projectiles: [] },
    { t: 1, actors: [actor("player", { x: 4, y: 2, hp: 60 }), actor("enemy", { x: 6, y: 0 })], projectiles: [] },
]);

test("fighter grounding is feathered AO plus a strictly transient combat rune", () => {
    assert.equal(riteGroundingFocusStrength("idle", true), 0,
        "an idle fighter must never become a board token");
    assert.equal(riteGroundingFocusStrength("dead", true), 0,
        "a KO actor must not retain a faction ring even before its body fades");
    assert.equal(riteGroundingFocusStrength("strike", false), 0,
        "health ownership wins over any stale attack state");
    assert.ok(riteGroundingFocusStrength("windup", true, 0) > 0,
        "the active attack tell may carry a thin team rune");
    assert.equal(riteGroundingFocusStrength("strike", true, 0), 1,
        "contact is the readable peak of the transient rune");
    assert.ok(riteGroundingFocusStrength("recover", true, 2) > 0,
        "the rune should visibly fade during recovery");
    assert.equal(riteGroundingFocusStrength("recover", true, 5), 0,
        "recovery must reach exact transparency before idle resumes");
    assert.equal(riteGroundingFocusStrength("recover", true, 99), 0,
        "a long terminal frame cannot resurrect a permanent pad");
    assert.equal(riteGroundingAoCameraForwardOffset("Water", 100), 10,
        "Water AO must shift camera-forward by exactly 0.10 times actor size");
    for (const element of ["Fire", "Wind", "Lightning", "Earth", "None", null, undefined]) {
        assert.equal(riteGroundingAoCameraForwardOffset(element, 100), 0,
            `${String(element)} AO must retain its unshifted center`);
    }
    assert.equal(riteCanvasGroundingAoDepthScale("Water"), 0.22,
        "Canvas Water AO must use the selected 0.22 depth scale");
    for (const element of ["Fire", "Wind", "Lightning", "Earth", "None", null, undefined]) {
        assert.equal(riteCanvasGroundingAoDepthScale(element), 0.18,
            `${String(element)} Canvas AO must retain its exact 0.18 depth scale`);
    }
    assert.equal(riteCanvasLivingWaterFootAnchorY("Water", 100, 400, 1000, true, false), 320,
        "a living portrait Water sprite must clamp its rendered foot anchor to 0.32 canvas height");
    assert.equal(riteCanvasLivingWaterFootAnchorY("Water", 400, 400, 1000, true, false), 400,
        "a living portrait Water sprite already below the line must keep its projected foot anchor");
    assert.equal(riteCanvasLivingWaterFootAnchorY("Water", 100, 1000, 400, true, false), 100,
        "landscape Water must keep its exact projected foot anchor");
    assert.equal(riteCanvasLivingWaterFootAnchorY("Water", 100, 400, 1000, false, false), 100,
        "dead Water must keep its exact projected foot anchor for a natural removal");
    assert.equal(riteCanvasLivingWaterFootAnchorY("Water", 100, 400, 1000, true, true), 100,
        "KO-exiting Water must keep its exact projected foot anchor for a natural exit");
    for (const element of ["Fire", "Wind", "Lightning", "Earth", "None", null, undefined]) {
        assert.equal(riteCanvasLivingWaterFootAnchorY(element, 100, 400, 1000, true, false), 100,
            `${String(element)} portrait sprite must keep its exact projected foot anchor`);
    }
    const canvasStage = readFileSync(new URL("../components/PetWarfrontRiteStage.tsx", import.meta.url), "utf8");
    const threeStage = readFileSync(new URL("../components/PetWarfrontRiteStage3D.tsx", import.meta.url), "utf8");
    const presentation = readFileSync(new URL("./pet-warfront-rite-presentation.ts", import.meta.url), "utf8");
    const captureHarness = readFileSync(new URL("../../scripts/capture-kage-attack-causality.mjs", import.meta.url), "utf8");
    const reloadHarness = readFileSync(new URL("../../scripts/verify-pet-animation-reloads.mjs", import.meta.url), "utf8");
    assert.match(presentation, /element === "Water" \? actorSize \* 0\.10 : 0/,
        "the shared AO offset contract must retain the selected 0.10 Water-only displacement");
    assert.match(presentation, /riteCanvasGroundingAoDepthScale[\s\S]*?element === "Water" \? 0\.22 : 0\.18/,
        "the Canvas AO depth helper must select 0.22 only for exact metadata-Water and retain 0.18 otherwise");
    assert.match(presentation, /function riteCanvasLivingWaterFootAnchorY[\s\S]*?if \(canvasHeight <= canvasWidth \|\| element !== "Water" \|\| !alive \|\| koExiting\) return projectedY;[\s\S]*?Math\.max\(projectedY, canvasHeight \* 0\.32\)/,
        "the Canvas foot-anchor contract must clamp only living portrait Water and preserve every exempt root");
    assert.doesNotMatch(canvasStage, /rgba\(0, 2, 3|baseSize \* 0\.29/,
        "Canvas must not restore the old opaque token pool");
    assert.match(threeStage, /const aoRadiusWorld = markerScale \* 0\.28[\s\S]*?circleGeometry args=\{\[0\.28, 24\]\}[\s\S]*?alphaMap=\{shadowAlphaMap\}[\s\S]*?opacity=\{0\.42\}/,
        "3D contact must use the tight feathered alpha map, not a filled disc");
    assert.match(canvasStage, /const shadowRadius = baseSize \* 0\.28[\s\S]*?contactShadow\.addColorStop\(0, `rgba\(5, 12, 13, \$\{0\.42 \* aoVisibility\}\)`[\s\S]*?addColorStop\(0\.42, `rgba\(5, 12, 13, \$\{0\.12 \* aoVisibility\}\)`[\s\S]*?addColorStop\(1, "rgba\(5, 12, 13, 0\)"\)/,
        "Canvas contact AO must use the selected 0.42 center and 0.12 shoulder while preserving an exact-transparent edge");
    assert.match(canvasStage, /const aoDepthScale = riteCanvasGroundingAoDepthScale\(fighter\.pet\.element\);[\s\S]*?context\.scale\(1, aoDepthScale\)/,
        "Canvas must apply the metadata-selected Water-only AO depth scale");
    assert.match(canvasStage, /const koExiting = actor\.phase\.koExit > 0;[\s\S]*?const renderFootY = riteCanvasLivingWaterFootAnchorY\([\s\S]*?fighter\.pet\.element, y, cssWidth, cssHeight, alive, koExiting,[\s\S]*?\);[\s\S]*?const aoForwardOffset = riteGroundingAoCameraForwardOffset\(fighter\.pet\.element, baseSize\);[\s\S]*?const aoCenterY = renderFootY \+ 5 \+ aoForwardOffset;[\s\S]*?groundingFootprints \+= [^\n]*aoCenterY\.toFixed\(2\)[^\n]*fighter\.pet\.element[^\n]*alive \? "living" : "dead"[^\n]*koExiting \? "ko-exit" : "steady"[\s\S]*?context\.translate\(x, aoCenterY\)[\s\S]*?context\.ellipse\(x, y \+ 4\.5,[\s\S]*?context\.drawImage\(actorLightSurface, x - lightOriginX, renderFootY \+ lift - lightOriginY\)/,
        "Canvas must clamp only the living portrait Water sprite and AO while leaving its rune at the simulation root");
    assert.doesNotMatch(threeStage, /riteCanvasLivingWaterFootAnchorY/,
        "the Canvas-only portrait clamp must not enter the Three renderer");
    assert.doesNotMatch(threeStage, /riteCanvasGroundingAoDepthScale/,
        "the Canvas-only AO depth helper must not enter the Three renderer");
    assert.match(threeStage, /const falloff = Math\.pow\(Math\.max\(0, 1 - Math\.hypot\(nx, ny\)\), 1\.65\)/,
        "3D contact AO must continuously feather from its center to an exact-zero texture edge");
    assert.match(threeStage, /const cameraGroundDistance = Math\.hypot\(camera\.position\.x, camera\.position\.z\);[\s\S]*?const screenDownX = cameraGroundDistance > 0 \? camera\.position\.x \/ cameraGroundDistance : 0;[\s\S]*?const screenDownZ = cameraGroundDistance > 0 \? camera\.position\.z \/ cameraGroundDistance : 0;[\s\S]*?const aoForwardOffset = riteGroundingAoCameraForwardOffset\(fighter\.pet\.element, markerScale\);[\s\S]*?const aoX = x \+ screenDownX \* aoForwardOffset;[\s\S]*?const aoZ = z \+ screenDownZ \* aoForwardOffset;[\s\S]*?transform\.position\.set\(aoX, 0\.012, aoZ\)[\s\S]*?projectedFoot\.set\(aoX, 0\.012, aoZ\)\.project\(camera\)[\s\S]*?transform\.position\.set\(x, 0\.02, z\)/,
        "Three must move only metadata-Water AO cameraward while restoring the unshifted rune center");
    assert.ok(0.42 * Math.pow(1 - 0.42, 1.65) >= 0.12,
        "3D contact AO must retain an effective shoulder at or above the selected 0.12 floor");
    assert.match(canvasStage, /riteGroundingSubmittedAoMaxAlpha = submittedAoCount \? "0\.420" : "0"/,
        "Canvas telemetry must report the selected 0.42 AO submission rather than a stale cap");
    assert.match(threeStage, /riteGroundingSubmittedAoMaxAlpha = submittedAoCount \? "0\.420" : "0"/,
        "Three telemetry must report the selected 0.42 AO submission rather than a stale cap");
    assert.match(captureHarness, /submittedAoMaxAlpha > 0\.42/,
        "the screenshot gate must enforce the selected 0.42 submission cap");
    assert.match(reloadHarness, /groundingSubmittedAoMaxAlpha > 0\.42/,
        "the reload gate must enforce the selected 0.42 submission cap");
    assert.match(captureHarness, /submittedAoMaxRadiusRatio > 0\.28/,
        "the screenshot gate must enforce the selected 0.28 silhouette-radius ratio");
    assert.match(reloadHarness, /groundingSubmittedAoMaxRadiusRatio > 0\.28/,
        "the reload gate must enforce the selected 0.28 silhouette-radius ratio");
    assert.match(captureHarness, /connected-width-over-1\.25x-foot[\s\S]*?flat-interior[\s\S]*?non-smooth-falloff[\s\S]*?nonzero-edge/,
        "the screenshot gate must enforce compact monotone zero-edge pixels");
    assert.match(threeStage, /ringGeometry args=\{\[0\.165, 0\.17, 32\]\}/,
        "the sole selected-fighter rune must remain a hairline");
    assert.doesNotMatch(threeStage, /ringGeometry args=\{\[0\.54, 0\.68|torusGeometry args=\{\[0\.9, 0\.07|circleGeometry args=\{\[0\.58|ringGeometry args=\{\[0\.34, 0\.58|ringGeometry args=\{\[0\.43, 0\.49/,
        "wide actor auras and planar impact discs/donuts must not return");
    assert.doesNotMatch(canvasStage, /baseSize \* 0\.37|context\.arc\(ox|context\.arc\(tx/,
        "Canvas attack cues must not stack circular outlines around fighters");
    assert.match(canvasStage, /riteGroundingSubmittedPlanarImpactCount = "0"/,
        "the live surface must publish its actual planar-impact submissions");
    assert.match(threeStage, /riteGroundingIdleRings = String\(idleGroundingRings\)/,
        "the live 3D surface must expose idle-ring parity data");
});

test("both hero Fire renderers submit the same target-anchored authored sprite and material residue", () => {
    const canvasStage = readFileSync(new URL("../components/PetWarfrontRiteStage.tsx", import.meta.url), "utf8");
    const canvasPainter = readFileSync(new URL("./pet-warfront-spectacle-canvas.ts", import.meta.url), "utf8");
    const threeStage = readFileSync(new URL("../components/PetWarfrontRiteStage3D.tsx", import.meta.url), "utf8");
    const spectacle = readFileSync(new URL("./pet-warfront-spectacle.ts", import.meta.url), "utf8");
    const captureHarness = readFileSync(new URL("../../scripts/capture-kage-attack-causality.mjs", import.meta.url), "utf8");
    assert.match(spectacle, /WARFRONT_HERO_FIRE_IMPACT_SPRITE_URL = "\/assets\/warfront\/kage-fire-impact-burst-v1-512\.png";[\s\S]*?WARFRONT_HERO_FIRE_IMPACT_SPRITE_SOURCE_PX = 512;[\s\S]*?WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_X = 0\.6;[\s\S]*?WARFRONT_HERO_FIRE_IMPACT_SPRITE_ASYMMETRY = "incoming-tail-left";/,
        "one shared contract must lock the optimized runtime source, hotspot, and asymmetry");
    assert.match(threeStage, /useLoader\.preload\(THREE\.TextureLoader, WARFRONT_HERO_FIRE_IMPACT_SPRITE_URL\);[\s\S]*?gl\.initTexture\(texture\);[\s\S]*?\+\+paintedFrames\.current < 2/,
        "Three must upload the decoded texture for two hidden frames before readiness");
    assert.match(threeStage, /const targetWidthPx = WARFRONT_THREE_HERO_TARGET_WIDTH_WORLD \/ Math\.max\(0\.001, impactWorldPerPixel\);[\s\S]*?const contactWidthPx = warfrontHeroContactWidthPx\(targetWidthPx\);[\s\S]*?const spriteWorldSpan = impactWorldPerPixel \* contactWidthPx;[\s\S]*?rotateZ\(impactScreenAngle\);[\s\S]*?0\.5 - WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_X[\s\S]*?scale\.set\(spriteWorldSpan, spriteWorldSpan, 1\);/,
        "Three must project the 1.65-target-width plane, rotate it to the frozen axis, and pin its authored hotspot to target");
    assert.match(threeStage, /<mesh ref=\{heroImpactSprite\}[\s\S]*?<planeGeometry args=\{\[1, 1\]\} \/>[\s\S]*?<meshBasicMaterial map=\{heroImpactTexture\}[\s\S]*?blending=\{THREE\.NormalBlending\}/,
        "Three must render the unchanged authored RGBA pixels on one non-additive plane");
    assert.doesNotMatch(threeStage, /createHeroFireDirectionalBurstShapes|shockRing|heroCore/,
        "the rejected hero ring and circular core primitives must remain absent");
    assert.match(threeStage, /<mesh ref=\{sprite\} renderOrder=\{4\}>/,
        "the actual impostor target sprite must remain at the order used by the foreground gate");
    assert.match(threeStage, /const residueSpanPx = contactWidthPx \* \(0\.84 \+ residueAge \* 0\.1\);[\s\S]*?heroResidue\.current\.scale\.set\(residueWorldSpan, residueWorldSpan \* 0\.72, 1\);[\s\S]*?smokeMaterial\.opacity = phase\.result \* 0\.68;/,
        "Three residue must remain materially scaled and visible through the shared nine-tick result");
    assert.match(canvasStage, /Promise\.all\(\[Promise\.all\(load\), loadImpostorImage\(WARFRONT_HERO_FIRE_IMPACT_SPRITE_URL\)\]\)[\s\S]*?setHeroImpactSprite\(impactSprite\)/,
        "Canvas must decode the authored impact asset alongside actor art before reveal");
    assert.match(canvasStage, /const impactSpriteImage = heroImpactSprite;[\s\S]*?if \(!canvas \|\| !images \|\| !impactSpriteImage\) return;[\s\S]*?targetScreen\?\.baseSize \?\? 64\) \* CANVAS_ACTOR_PAINTED_WIDTH_RATIO[\s\S]*?warfrontHeroContactWidthPx\(targetWidthPx\)[\s\S]*?drawWarfrontHeroFireImpact\([\s\S]*?impactSpriteImage,[\s\S]*?incomingAngle/,
        "Canvas must gate reveal on the decoded asset and pass it into the target-relative contact draw");
    assert.match(canvasPainter, /globalCompositeOperation = "source-over";[\s\S]*?context\.drawImage\([\s\S]*?WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_X[\s\S]*?WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_Y[\s\S]*?contactWidthPx,[\s\S]*?contactWidthPx/,
        "Canvas must preserve the authored RGBA material and pin the hotspot inside the shared footprint");
    assert.doesNotMatch(canvasPainter, /burstRadius|impactRadius|shockRing|directional-flame-petal-shock-ring/,
        "Canvas hero contact must not reconstruct the rejected circular ring/core geometry");
    assert.match(canvasStage, /heroTravelSpanFraction = warfrontHeroTravelSpanFraction\(travelStrength\)[\s\S]*?heroAxisTailAxis = `\$\{frozenAxisX\.toFixed\(6\)\},\$\{frozenAxisY\.toFixed\(6\)\}`/,
        "Canvas must enforce the shared longitudinal span and retain its frozen axis through contact");
    assert.match(canvasPainter, /const axisTailStrength = warfrontHeroAxisTailStrength\(contact, result\)[\s\S]*?createLinearGradient\(-WARFRONT_HERO_AXIS_TAIL_PX, 0, 2, 0\)/,
        "Canvas must paint the bounded high-luminance tail on the existing contact/result clock");
    assert.match(threeStage, /heroTravelSpanFraction = warfrontHeroTravelSpanFraction\(heroTravelStrength\)[\s\S]*?heroAxisTailStrength = warfrontHeroAxisTailStrength\(impactHold, phase\.result\)[\s\S]*?heroTravelPlume\.current\.rotateZ\(impactScreenAngle\)/,
        "Three must consume the same span and exact frozen-axis tail contract");
    assert.match(threeStage, /const WARFRONT_THREE_HERO_DAMAGE_FONT_PX = 14;[\s\S]*?const WARFRONT_THREE_HERO_DAMAGE_OUTLINE_PX = 2;[\s\S]*?context\.strokeText\(text, centerX, centerY\);[\s\S]*?context\.fillText\(text, centerX, centerY\);/,
        "the Three damage number must use a fourteen-pixel face with a real dark outline");
    assert.match(threeStage, /riteHeroDamageHoldTicks = String\(WARFRONT_HERO_DAMAGE_HOLD_TICKS\)/,
        "Three damage text must preserve its independent three-tick hold");
    assert.match(captureHarness, /heroImpactSpriteUrl[\s\S]*?heroImpactSpriteAsymmetry[\s\S]*?heroImpactSpriteRotationRad[\s\S]*?heroImpactLegacyPrimitiveDraws/,
        "capture must read exact source, asymmetry, rotation, footprint, and legacy-submission evidence from either renderer");
    assert.match(captureHarness, /state\.heroContactTargetWidthRatio < 1\.5[\s\S]*?state\.heroContactTargetWidthRatio > 1\.8/,
        "capture must reject contact silhouettes outside the bounded target-width range");
    assert.match(captureHarness, /state\.tick >= state\.heroContactTick[\s\S]*?state\.tick < state\.heroContactTick \+ 2[\s\S]*?!state\.heroImpactSpriteVisible[\s\S]*?state\.heroImpactSpriteDraws !== 1/,
        "the contact capture must prove the single authored sprite is active for the exact two-tick window");
    assert.match(captureHarness, /heroImpactSpriteAudit\.alphaCentroidX < 0\.63[\s\S]*?heroImpactSpriteAudit\.rearForwardExtentRatio < 1\.35[\s\S]*?heroImpactSpriteAudit\.forwardRearAlphaRatio < 1\.75/,
        "capture must reject a substituted radial or symmetric source image");
    assert.match(captureHarness, /state\.heroResidueTicks !== 9[\s\S]*?state\.heroResidueLayerCount !== 3[\s\S]*?!state\.heroResidueVisible[\s\S]*?state\.heroResidueMaterialStrength < 0\.35/,
        "the result capture must prove a visible nine-tick scorch/smoke/ember tail");
    assert.match(captureHarness, /state\.heroTravelSpanFraction < state\.heroTravelMinSpanFraction[\s\S]*?state\.heroAxisTailAxis !== state\.heroTravelAxis/,
        "capture must reject a short projectile or a contact tail that leaves the travel axis");
    assert.match(captureHarness, /data-rite-actors-present[\s\S]*?data-rite-hero-actor-present[\s\S]*?data-rite-hero-target-present/,
        "capture must gate every hero frame on live actor presence rather than initial framing telemetry");
    assert.match(captureHarness, /state\.heroDamageFontPx !== 14[\s\S]*?state\.heroDamageFontPx < 12[\s\S]*?state\.heroDamageOutlinePx !== 2[\s\S]*?state\.heroDamageRenderOrder !== 13[\s\S]*?state\.heroDamageHoldTicks !== 3[\s\S]*?state\.heroDamageText !== `−\$\{Math\.max\(1, Math\.round\(state\.heroHpDelta\)\)\}`/,
        "capture must fail unreadable, unoutlined, mistimed, or inexact damage text");
});

test("the authored court receives no prototype foreground dressing", () => {
    const canvasStage = readFileSync(new URL("../components/PetWarfrontRiteStage.tsx", import.meta.url), "utf8");
    const threeStage = readFileSync(new URL("../components/PetWarfrontRiteStage3D.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../styles/pet-warfront-rite.css", import.meta.url), "utf8");
    const landscapePlate = new URL("../../public/assets/warfront/kage-tactics-temple-court-v3-landscape.webp", import.meta.url);
    const portraitPlate = new URL("../../public/assets/warfront/kage-tactics-temple-court-v3-portrait.webp", import.meta.url);
    assert.match(css, /kage-tactics-temple-court-v3-landscape\.webp[\s\S]*?@media \(orientation: portrait\)[\s\S]*?kage-tactics-temple-court-v3-portrait\.webp/,
        "both responsive routes must use the cohesive v3 material edit");
    assert.doesNotMatch(css, /kage-tactics-temple-court-v2-(?:landscape|portrait)\.webp/,
        "the high-frequency v2 plates must remain archival rather than live");
    assert.doesNotMatch(css, /\.wfr-root::before\s*\{[\s\S]{0,300}?filter:/,
        "the pre-graded v3 plate must not pay for a full-screen runtime filter");
    assert.ok(statSync(landscapePlate).size <= 120_000 && statSync(portraitPlate).size <= 120_000,
        "both edited plates must stay inside the existing lightweight first-load envelope");
    assert.doesNotMatch(canvasStage, /for \(const wall of WARFRONT_MAZE_WALLS\)/,
        "Canvas collision must not become opaque paper blocker rectangles");
    assert.doesNotMatch(canvasStage, /context\.shadowColor = "rgba\(0, 0, 0, \.42\)"/,
        "Canvas must not submit the old blocker shadows over painted slate");
    assert.match(canvasStage, /riteArenaPrototypeDressingDraws = String\(staticArenaMetrics\.current\.prototypeDressingDraws\)/,
        "Canvas telemetry must describe the actual static submission result");
    assert.match(canvasStage, /prototypeDressingDraws: 0/,
        "the static Canvas submission must contain zero prototype dressing draws");
    assert.doesNotMatch(threeStage, /<BatchedKageTacticsArena \/>|<KageTacticsArena /,
        "neither Three prototype arena tree may reach the live scene");
    assert.match(threeStage, /<KageBoardCells \/>[\s\S]*?<FloorFlushRelicObjective result=\{result\} clockRef=\{routedClockRef\} \/>/,
        "Three must submit only the shared floor inlays and compact relic layer");
    assert.match(threeStage, /const ARENA_FLOOR_DECAL_ALPHA_CAP = 0\.18/,
        "all replacement floor decals need a restrained alpha cap");
    assert.match(threeStage, /const ARENA_OBJECTIVE_DECAL_RADIUS_WORLD = 0\.285/,
        "the objective state mark must remain smaller than a pet footprint");
    assert.match(threeStage, /riteArenaPrototypeDressingMeshes = "0"/,
        "Three must report zero actually submitted prototype meshes");
    assert.match(threeStage, /riteArenaGlyphDebrisMeshes = "0"/,
        "Three must report zero obsolete glyph-debris submissions");
    assert.doesNotMatch(threeStage, /ref=\{shards\}[\s\S]*?fighters\.length \* 2/,
        "per-fighter readability shards must not scatter black geometry over pets");
    assert.match(threeStage, /name="wfr-small-scroll-relic"/,
        "the objective must retain a readable, non-occluding scroll identity");
    assert.doesNotMatch(threeStage, /new THREE\.Clock|THREE\.Clock\(/,
        "the edited arena path must not instantiate deprecated THREE.Clock");
});

test("both renderer routes seat actors in the court's positional faction light", () => {
    const canvasStage = readFileSync(new URL("../components/PetWarfrontRiteStage.tsx", import.meta.url), "utf8");
    const threeStage = readFileSync(new URL("../components/PetWarfrontRiteStage3D.tsx", import.meta.url), "utf8");
    assert.match(threeStage, /pointLight position=\{\[-15, 3, 0\]\} color=\{TEAM_COLOR\.player\} intensity=\{batchedBattle \? 4\.5 : 10\}/,
        "the cyan arena light must reach the batched eight-actor renderer at modest intensity");
    assert.match(threeStage, /pointLight position=\{\[15, 3, 0\]\} color=\{TEAM_COLOR\.enemy\} intensity=\{batchedBattle \? 4\.5 : 10\}/,
        "the vermilion arena light must reach the batched eight-actor renderer at modest intensity");
    assert.doesNotMatch(threeStage, /!batchedBattle \? <pointLight/,
        "the battle batching optimization must not delete the court's positional light pair");
    assert.match(canvasStage, /globalCompositeOperation = "source-in"[\s\S]*?globalCompositeOperation = "multiply"[\s\S]*?globalCompositeOperation = "source-atop"/,
        "the lightweight renderer must alpha-mask a true multiply grade before restrained edge recovery");
    assert.match(canvasStage, /const arenaSide = Math\.max\(-1, Math\.min\(1, \(x \/ cssWidth - 0\.5\) \* 2\)\)/,
        "Canvas actor lighting must follow world position rather than team identity");
    assert.match(canvasStage, /const multiplyAlpha = 0\.10 \+ Math\.abs\(arenaSide\) \* 0\.07/,
        "the Canvas value-shaping pass must use the lowest viable sweep result and cap at seventeen percent alpha");
    assert.match(canvasStage, /riteArenaActorLightMultiplyCap = "0\.170"/,
        "Canvas telemetry must publish the exact selected multiply cap");
    assert.match(canvasStage, /const recoveryAlpha = 0\.012 \+ Math\.abs\(arenaSide\) \* 0\.018/,
        "arena-facing highlight recovery must remain capped at three percent alpha");
    assert.match(canvasStage, /riteArenaActorLightMode = "position-aware-multiply-mask"/,
        "Canvas must report the actual multiplicative actor-only light submission mode");
    assert.match(threeStage, /riteArenaSideLights = "2"/,
        "Three must report both actually submitted arena side lights");
});

test("Beastbound Warfront has one position owner, actor-first framing, and target-authoritative facing", () => {
    const source = readFileSync(new URL("../components/PetWarfrontRiteStage3D.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../styles/pet-warfront-rite.css", import.meta.url), "utf8");
    assert.doesNotMatch(source, /MathUtils\.damp\(group\.position\./,
        "the renderer must not chase the already-interpolated authoritative path with a second spring");
    assert.match(source, /locomotionActive\.current/,
        "run and idle animation need hysteresis instead of a single noisy speed threshold");
    assert.match(source, /f\.lockTargetFacing = hasLiveTarget \|\| committed \|\| !moving/,
        "a live target must own facing even while the actor is travelling");
    assert.match(source, /f\.freezeFacing = rotationFrozen/,
        "KO and stagger must stop rotation tracking");
    assert.match(source, /f\.motion = down \? "dead"[\s\S]*?pose\.state === "windup" \? "windup"[\s\S]*?pose\.state === "strike" \? "strike"[\s\S]*?pose\.state === "recover" \? "recover"/,
        "windup/contact/recovery must reach the model as distinct clip phases");
    assert.match(source, /f\.maxTurnPerFrame = 55 \* Math\.PI \/ 180/,
        "one dropped frame must not become a 180-degree body flip");
    assert.match(source, /shadows=\{renderQuality\.modelShadows \? "percentage" : false\}/,
        "the Rite must not select Three's deprecated warning-heavy boolean shadow preset");
    assert.match(source, /<KageBoardCells \/>/,
        "the live stage must retain coordinate-true tactical floor inlays");
    assert.match(source, /args=\{\[undefined, undefined, 35\]\}/,
        "the 7x5 simulation grid must have matching authored floor cells");
    assert.match(source, /const focus = actionFocus\(result, clockRef\.current\)/,
        "the 3D camera must frame authoritative living action rather than an empty board centre");
    assert.match(source, /lookRef\.current\.lerp\(desiredLook, centreAlpha\)/,
        "the actor-first camera must ease its centre instead of snapping between duels");
    assert.match(source, /camera\.position\.copy\(desiredPosition\)/,
        "the camera position must consume the smoothed actor-first shot");
    assert.match(source, /camera\.lookAt\(lookRef\.current\)/,
        "the camera must keep its view anchored to the smoothed live-action centre");
    assert.doesNotMatch(source, /frame[ZX] = .*0\.78/,
        "portrait must frame the complete board rather than a moving 78% crop");
    assert.match(source, /quality=\{quality\}/,
        "the phone scene quality decision must reach each pet model");
    assert.match(css, /kage-tactics-temple-court-v3-landscape\.webp/,
        "the mode must use the new generated fortress backdrop");
    assert.doesNotMatch(source, /shinobi-dual-scroll-courtyard-v3\.webp/,
        "retired capture-the-scroll floor art must not leak into Beastbound Warfront");
});

test("deployment remains an eight-rig tick-zero tableau until every model is ready", () => {
    const rite = readFileSync(new URL("../components/PetWarfrontRite.tsx", import.meta.url), "utf8");
    const stage = readFileSync(new URL("../components/PetWarfrontRiteStage3D.tsx", import.meta.url), "utf8");
    const rig = readFileSync(new URL("../components/PetWarfrontSkinnedModel3D.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../styles/pet-warfront-rite.css", import.meta.url), "utf8");
    assert.doesNotMatch(rite, /lazy\(\(\) => import\("\.\/PetWarfrontRiteStage3D"\)/,
        "the stage chunk must be available before the player commits deployment");
    assert.doesNotMatch(rite, /className="wfr-vs-card"/,
        "a full-screen two-portrait card must not replace the committed formation");
    assert.match(rite, /formationHold \|\| !formationRevealed/,
        "the simulation clock must remain at tick zero through hydration and reveal");
    assert.match(rite, /className=\{`wfr-stage-curtain\$\{stageReady \? " is-open" : ""\}`\}/,
        "an opaque curtain must own the cold-load frame until the atomic reveal");
    assert.match(rite, /formationHold && formationRevealed/,
        "the readable hold must begin only after the complete formation is visible");
    assert.match(stage, /initialPose\.x \* WORLD_SCALE/,
        "each rig root needs its committed pose on its very first painted frame");
    assert.match(stage, /allRiteFighterModelsReady\(fighters, readyFighters\.current, committedActorIds\)/,
        "stage readiness must pass the exact eight-rig set gate");
    assert.match(rig, /paintedFrames\.current < 2/,
        "a loaded asset must paint behind the curtain before counting ready");
    assert.match(rig, /<ModelReadySignal onReady=\{onReady\}/,
        "readiness must be emitted from inside the resolved model boundary");
    assert.match(stage, /<Suspense fallback=\{null\}>/,
        "a loading rig must stay absent behind the curtain, never become a stand-in");
    assert.doesNotMatch(stage, /PetFallback|capsuleGeometry/,
        "the formation stage must not contain a visible pet-shaped stand-in path");
    assert.match(css, /\.wfr-stage-curtain\s*\{[\s\S]*?z-index:\s*8;[\s\S]*?opacity:\s*1;/,
        "the cold-load curtain must fully occlude the stage above every gameplay layer");
    assert.match(css, /\.wfr-formation-hold\s*\{/,
        "the tick-zero formation needs a lightweight status treatment");
    assert.doesNotMatch(css, /\.wfr-vs-card\s*,\s*\.wfr-interlude/,
        "the retired opaque handoff must not share the interlude blackout");
});

test("formation readiness is false for every partial or duplicate rig set", () => {
    const fighters = (["player", "enemy"] as const).flatMap((team) =>
        Array.from({ length: 4 }, (_, lane) => ({ team, lane })),
    );
    assert.equal(fighters.length, RITE_REVEAL_FIGHTER_COUNT);
    const committed = new Set(fighters.map((fighter) => `${fighter.team}-${fighter.lane}`));
    for (let count = 0; count < RITE_REVEAL_FIGHTER_COUNT; count++) {
        const partial = new Set([...committed].slice(0, count));
        assert.equal(allRiteFighterModelsReady(fighters, partial, committed), false,
            `${count}/8 real rigs must remain behind the curtain`);
    }
    const ready = new Set(fighters.slice(0, 7).map((fighter) => `${fighter.team}-${fighter.lane}`));
    ready.add("spectator-99");
    assert.equal(allRiteFighterModelsReady(fighters, ready, committed), false, "an unrelated callback must not complete the formation");
    ready.add("enemy-3");
    assert.equal(allRiteFighterModelsReady(fighters, ready, committed), true, "all eight distinct expected rigs should reveal atomically");
    const missingCommittedActor = new Set([...committed].slice(0, 7));
    assert.equal(allRiteFighterModelsReady(fighters, ready, missingCommittedActor), false,
        "a loaded rig without its authoritative tick-zero actor must not reveal at world origin");
    const duplicated = [...fighters.slice(0, 7), fighters[0]];
    assert.equal(allRiteFighterModelsReady(duplicated, ready, committed), false, "a duplicate lane must not impersonate the eighth rig");
});

test("a fractional tick returns the exact interpolated position, not the floor snapshot", () => {
    const result = twoTicks();
    const mid = sampleActor(result, "player", 0, 0.5);
    assert.equal(mid.x, 2, "x must be halfway between the bracketing snapshots");
    assert.equal(mid.z, 1, "z must be halfway between the bracketing snapshots");
    // The old stage would have returned tick 0 here — that IS the staircase.
    assert.notEqual(mid.x, 0, "returning the floor snapshot is the retired behaviour");
});

test("render-owned actor slots are reused for self and target sampling", () => {
    const result = twoTicks();
    const slot = createActorPoseSample();
    assert.equal(sampleActorInto(result, "player", 0, 0.25, slot), slot);
    assert.equal(slot.x, 1);
    assert.equal(sampleActorByIdInto(result, "enemy", 0.5, slot), slot);
    assert.equal(slot.x, 8);
    assert.equal(slot.z, 2);
});

test("interpolation is linear and continuous across the whole tick", () => {
    const result = twoTicks();
    let previous = -Infinity;
    for (let f = 0; f <= 1.0001; f += 0.1) {
        const pose = sampleActor(result, "player", 0, f);
        assert.ok(pose.x >= previous - 1e-9, `x went backwards at f=${f.toFixed(1)}`);
        assert.ok(Math.abs(pose.x - 4 * Math.min(1, f)) < 1e-6, `x is not linear at f=${f.toFixed(1)}`);
        previous = pose.x;
    }
});

test("health interpolates too, so a bar drains smoothly instead of stepping", () => {
    const quarter = sampleActor(twoTicks(), "player", 0, 0.25);
    assert.equal(quarter.hp, 90, "hp must interpolate between 100 and 60");
});

test("projectiles travel between snapshots instead of teleporting", () => {
    const result = resultFrom([
        { t: 0, actors: [], projectiles: [{ id: 7, x: -4, y: 2, team: "player", kind: "damage", element: "Fire" }] },
        { t: 1, actors: [], projectiles: [{ id: 7, x: 2, y: -2, team: "player", kind: "damage", element: "Fire" }] },
    ]);
    const [projectile] = sampleProjectiles(result, 0.5);
    assert.equal(projectile.x, -1);
    assert.equal(projectile.y, 0);
    assert.equal(projectile.id, 7);

    const pool = [{ id: -1, x: 0, y: 0, team: "player" as const, kind: "damage" as const, element: null }];
    const identity = pool[0];
    assert.equal(sampleProjectilesInto(result, 0.5, pool), 1);
    assert.equal(pool[0], identity, "the render pool must mutate its existing slot");
    assert.equal(pool[0].x, -1);
    assert.equal(pool[0].y, 0);
});

test("facing interpolates, or a fighter snaps around between ticks", () => {
    const result = resultFrom([
        { t: 0, actors: [actor("player", { faceX: 1, faceY: 0 })], projectiles: [] },
        { t: 1, actors: [actor("player", { faceX: -1, faceY: 0 })], projectiles: [] },
    ]);
    assert.equal(sampleActor(result, "player", 0, 0.5).faceX, 0, "facing must pass through the midpoint");
});

test("discrete state takes the leading snapshot so a strike lands on its own frame", () => {
    const result = resultFrom([
        { t: 0, actors: [actor("player", { state: "idle" })], projectiles: [] },
        { t: 1, actors: [actor("player", { state: "strike" })], projectiles: [] },
    ]);
    assert.equal(sampleActor(result, "player", 0, 0.2).state, "idle");
    assert.equal(sampleActor(result, "player", 0, 0.8).state, "strike", "a state change must not arrive a frame late");
});

test("target assignments are discrete and expose a shared focus order", () => {
    const snapshot: DuelSnapshot = {
        t: 0,
        actors: [
            actor("player", { id: "player-0", slot: 0, targetId: "enemy-1" }),
            actor("player", { id: "player-1", slot: 1, targetId: "enemy-1" }),
            actor("player", { id: "player-2", slot: 2, targetId: "enemy-0" }),
            actor("enemy", { id: "enemy-0", slot: 0 }),
            actor("enemy", { id: "enemy-1", slot: 1 }),
        ],
        projectiles: [],
    };
    const result = resultFrom([snapshot]);
    assert.equal(sampleActor(result, "player", 0, 0).targetId, "enemy-1");
    assert.deepEqual(squadFocusAt(result, "player", 0), {
        team: "player",
        target: { team: "enemy", lane: 1 },
        attackers: [{ team: "player", lane: 0 }, { team: "player", lane: 1 }],
    });
    assert.equal(squadFocusAt(result, "enemy", 0), null, "one independent claim must not receive focus-fire VFX");
});

test("sampling is clamped at both ends and never returns a broken pose", () => {
    const result = twoTicks();
    assert.equal(sampleActor(result, "player", 0, -5).x, 0, "before the fight starts, hold the first snapshot");
    assert.equal(sampleActor(result, "player", 0, 99).x, 4, "past the end, hold the last snapshot");
    for (const t of [-1, 0, 0.5, 1, 50]) {
        const pose = sampleActor(result, "player", 0, t);
        assert.ok(Number.isFinite(pose.x) && Number.isFinite(pose.z), `non-finite pose at t=${t}`);
    }
});

test("an empty or unknown actor degrades to a safe pose instead of throwing", () => {
    const empty = resultFrom([]);
    assert.equal(sampleActor(empty, "player", 0, 3).maxHp, 1, "an empty result must not divide by zero downstream");
    const onlyPlayer = resultFrom([{ t: 0, actors: [actor("player")], projectiles: [] }]);
    assert.equal(sampleActor(onlyPlayer, "enemy", 0, 0).hp, 0, "a missing actor reads as down, not as a crash");
});

test("events bucket by tick so per-frame lookup is constant time", () => {
    const events = [
        { t: 3, type: "hit", side: "player", actorId: "a" },
        { t: 3, type: "hit", side: "enemy", actorId: "b" },
        { t: 9, type: "ko", side: "player", actorId: "a" },
    ] as unknown as DuelEvent[];
    const byTick = bucketEvents(events);
    assert.equal(byTick.get(3)?.length, 2, "both tick-3 events must share a bucket");
    assert.equal(byTick.get(9)?.length, 1);
    assert.equal(byTick.get(4), undefined, "empty ticks must not allocate");
});

test("the lethal tick is found so slow-mo can be armed before the blow lands", () => {
    const events = [
        { t: 4, type: "hit", side: "player", actorId: "a" },
        { t: 12, type: "ko", side: "player", actorId: "a" },
    ] as unknown as DuelEvent[];
    assert.equal(lethalTick(resultFrom([], events)), 12);
    assert.equal(lethalTick(resultFrom([], [])), null, "a fight with no KO has no lethal beat");
});

test("every element resolves to a colour, including none and unknown", () => {
    for (const element of ["Fire", "Water", "Wind", "Lightning", "Earth", "None", null, undefined, "Nonsense"]) {
        assert.match(elementColor(element as string | null | undefined), /^#[0-9a-f]{6}$/i, `no colour for ${element}`);
    }
    assert.notEqual(elementColor("Fire"), elementColor("Water"), "elements must be distinguishable");
});
