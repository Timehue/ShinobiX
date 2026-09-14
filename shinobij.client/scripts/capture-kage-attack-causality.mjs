import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const target = process.argv[2]
    ?? "https://127.0.0.1:5176/petvfx.html?rite=1&petQuality=high&ritespeed=0.78&autostart=1";
const outputDir = path.resolve(process.argv[3] ?? ".tmp/kage-spectacle-r11/capture");
const channel = process.argv[4] === "chrome" ? "chrome" : undefined;
const viewportMode = process.argv[5] ?? "desktop";
const captureMode = process.argv[6] ?? "full";
const viewport = viewportMode === "portrait"
    ? { width: 412, height: 915 }
    : viewportMode === "landscape"
      ? { width: 915, height: 412 }
      : { width: 1280, height: 720 };
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
    headless: true,
    channel,
    args: channel ? ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] : [],
});
const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport,
});
const page = await context.newPage();
const errors = [];
const warnings = [];
const browserDiagnostics = [];
const heroImpactSpritePath = path.resolve(import.meta.dirname, "../public/assets/warfront/kage-fire-impact-burst-v1-512.png");
const heroImpactSpriteAnchorX = 0.6;
const { data: heroImpactSpritePixels, info: heroImpactSpriteInfo } = await sharp(heroImpactSpritePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
let heroImpactAlphaTotal = 0;
let heroImpactWeightedX = 0;
let heroImpactRearAlpha = 0;
let heroImpactForwardAlpha = 0;
let heroImpactMinX = heroImpactSpriteInfo.width;
let heroImpactMaxX = -1;
const heroImpactAnchorPx = heroImpactSpriteInfo.width * heroImpactSpriteAnchorX;
for (let y = 0; y < heroImpactSpriteInfo.height; y++) {
    for (let x = 0; x < heroImpactSpriteInfo.width; x++) {
        const alpha = heroImpactSpritePixels[(y * heroImpactSpriteInfo.width + x) * heroImpactSpriteInfo.channels + 3];
        if (alpha < 8) continue;
        heroImpactAlphaTotal += alpha;
        heroImpactWeightedX += x * alpha;
        if (x < heroImpactAnchorPx) heroImpactRearAlpha += alpha;
        else heroImpactForwardAlpha += alpha;
        heroImpactMinX = Math.min(heroImpactMinX, x);
        heroImpactMaxX = Math.max(heroImpactMaxX, x);
    }
}
const heroImpactSpriteAudit = {
    width: heroImpactSpriteInfo.width,
    height: heroImpactSpriteInfo.height,
    alphaCentroidX: heroImpactAlphaTotal > 0
        ? heroImpactWeightedX / heroImpactAlphaTotal / heroImpactSpriteInfo.width
        : 0,
    rearForwardExtentRatio: heroImpactMaxX > heroImpactAnchorPx
        ? (heroImpactAnchorPx - heroImpactMinX) / (heroImpactMaxX - heroImpactAnchorPx)
        : 0,
    forwardRearAlphaRatio: heroImpactRearAlpha > 0 ? heroImpactForwardAlpha / heroImpactRearAlpha : 0,
};
if (heroImpactSpriteAudit.width !== 512
    || heroImpactSpriteAudit.height !== 512
    || heroImpactSpriteAudit.alphaCentroidX < 0.63
    || heroImpactSpriteAudit.rearForwardExtentRatio < 1.35
    || heroImpactSpriteAudit.forwardRearAlphaRatio < 1.75) {
    errors.push(`hero impact source asymmetry gate failed ${JSON.stringify(heroImpactSpriteAudit)}`);
}
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
    if (message.type() === "warning") {
        if (/^THREE\.Clock: This module has been deprecated|GL Driver Message.*ReadPixels/iu.test(message.text())) {
            browserDiagnostics.push(message.text());
            return;
        }
        warnings.push(message.text());
        errors.push(`console-warning: ${message.text()}`);
    }
});
await page.route("**/api/perf-beacon", (route) => route.fulfill({ status: 204 }));
await page.route("**/api/player/capabilities", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
        ok: true,
        capabilities: Object.fromEntries([
            "gameplay", "gameplayMutations", "registrations", "guestPlay", "villageWar",
            "clanBoss", "clanBossParties", "legacy", "petBreedingStarts", "weeklyBossGuardCycle",
        ].map((id) => [id, { state: "available", reason: "available" }]).concat([
            ["googleSignIn", { state: "temporarily-unavailable", reason: "configuration-unavailable" }],
        ])),
    }),
}));

const url = new URL(target);
url.searchParams.set("ritemotionqa", "1");
url.searchParams.set("causalitycapture", "1");
await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 35_000 });
try {
    await page.waitForFunction(() => {
        const curtain = document.querySelector('[data-testid="wfr-stage-curtain"]');
        return curtain?.getAttribute("data-stage-ready") === "true"
            && curtain?.getAttribute("data-models-ready") === "8";
    }, undefined, { timeout: 35_000 });
} catch (error) {
    await page.screenshot({ path: path.join(outputDir, "00-readiness-timeout.png"), type: "png" });
    const readiness = await page.evaluate(() => {
        const curtain = document.querySelector('[data-testid="wfr-stage-curtain"]');
        return {
            href: location.href,
            title: document.title,
            bodyText: document.body.innerText.slice(0, 600),
            modelsReady: curtain?.getAttribute("data-models-ready") ?? null,
            stageReady: curtain?.getAttribute("data-stage-ready") ?? null,
        };
    });
    throw new Error(`readiness timeout ${JSON.stringify({ readiness, errors, warnings })}`, { cause: error });
}

const read = () => page.evaluate(() => {
    const canvas = document.querySelector(".wfr-canvas canvas");
    const clock = document.querySelector('[data-testid="wfr-clock"]');
    const hud = document.querySelector('[data-testid="wfr-premium-hud"]');
    const audioGate = document.querySelector('[data-testid="wfr-audio-gate"]');
    const bounds = (node) => {
        if (!(node instanceof HTMLElement)) return null;
        const rect = node.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    };
    const fontSize = (node) => node instanceof HTMLElement
        ? Number.parseFloat(getComputedStyle(node).fontSize)
        : Number.NaN;
    const rosterNames = [...document.querySelectorAll(".wfr-roster-meta strong")];
    return {
        tick: Number(clock?.getAttribute("data-tick") ?? "0"),
        active: Number(canvas?.getAttribute("data-rite-attack-causality-active") ?? "0"),
        contacts: Number(canvas?.getAttribute("data-rite-attack-contacts-active") ?? "0"),
        maxActive: Number(canvas?.getAttribute("data-rite-attack-causality-max-active") ?? "0"),
        longestDistance: Number(canvas?.getAttribute("data-rite-attack-longest-distance") ?? "0"),
        longestEndpoints: canvas?.getAttribute("data-rite-attack-longest-endpoints"),
        calls: Number(canvas?.getAttribute("data-rite-render-calls") ?? "NaN"),
        actorMode: canvas?.getAttribute("data-rite-actor-render-mode"),
        actorsVisible: Number(canvas?.getAttribute("data-rite-initial-actors-visible") ?? "NaN"),
        actorsPresent: Number(canvas?.getAttribute("data-rite-actors-present") ?? "NaN"),
        heroActorPresent: canvas?.getAttribute("data-rite-hero-actor-present") === "true",
        heroTargetPresent: canvas?.getAttribute("data-rite-hero-target-present") === "true",
        boardVisible: canvas?.getAttribute("data-rite-board-visible"),
        cameraDelta: Number(canvas?.getAttribute("data-rite-camera-max-delta") ?? "NaN"),
        submittedAoCount: Number(canvas?.getAttribute("data-rite-grounding-submitted-ao-count") ?? "NaN"),
        submittedAoMaxAlpha: Number(canvas?.getAttribute("data-rite-grounding-submitted-ao-max-alpha") ?? "NaN"),
        submittedAoMaxRadiusPx: Number(canvas?.getAttribute("data-rite-grounding-submitted-ao-max-radius-px") ?? "NaN"),
        submittedAoMaxRadiusRatio: Number(canvas?.getAttribute("data-rite-grounding-submitted-ao-max-radius-ratio") ?? "NaN"),
        submittedRimCount: Number(canvas?.getAttribute("data-rite-grounding-submitted-rim-count") ?? "NaN"),
        submittedRimMaxAlpha: Number(canvas?.getAttribute("data-rite-grounding-submitted-rim-max-alpha") ?? "NaN"),
        submittedPlanarImpactCount: Number(canvas?.getAttribute("data-rite-grounding-submitted-planar-impact-count") ?? "NaN"),
        authoritativeActor: canvas?.getAttribute("data-rite-grounding-authoritative-actor") ?? "",
        prototypeDressingDraws: Number(canvas?.getAttribute("data-rite-arena-prototype-dressing-draws") ?? "NaN"),
        prototypeDressingMeshes: Number(canvas?.getAttribute("data-rite-arena-prototype-dressing-meshes") ?? "NaN"),
        glyphDebrisDraws: Number(canvas?.getAttribute("data-rite-arena-glyph-debris-draws") ?? "NaN"),
        glyphDebrisMeshes: Number(canvas?.getAttribute("data-rite-arena-glyph-debris-meshes") ?? "NaN"),
        floorDecalDraws: Number(canvas?.getAttribute("data-rite-arena-floor-decal-draws") ?? "NaN"),
        floorDecalMaxAlpha: Number(canvas?.getAttribute("data-rite-arena-floor-decal-max-alpha") ?? "NaN"),
        floorDecalMaxRadiusWorld: Number(canvas?.getAttribute("data-rite-arena-floor-decal-max-radius-world") ?? "NaN"),
        scrollPropDraws: Number(canvas?.getAttribute("data-rite-arena-scroll-prop-draws") ?? "NaN"),
        scrollPropMeshes: Number(canvas?.getAttribute("data-rite-arena-scroll-prop-meshes") ?? "NaN"),
        actorLightMode: canvas?.getAttribute("data-rite-arena-actor-light-mode") ?? "",
        actorLightOverlays: Number(canvas?.getAttribute("data-rite-arena-actor-light-overlays") ?? "NaN"),
        actorLightMaxAlpha: Number(canvas?.getAttribute("data-rite-arena-actor-light-max-alpha") ?? "NaN"),
        actorLightMultiplyMaxAlpha: Number(canvas?.getAttribute("data-rite-arena-actor-light-multiply-max-alpha") ?? "NaN"),
        actorLightMultiplyCap: Number(canvas?.getAttribute("data-rite-arena-actor-light-multiply-cap") ?? "NaN"),
        actorLightEdgeRecoveryMaxAlpha: Number(canvas?.getAttribute("data-rite-arena-actor-light-edge-recovery-max-alpha") ?? "NaN"),
        arenaSideLights: Number(canvas?.getAttribute("data-rite-arena-side-lights") ?? "NaN"),
        arenaSideLightIntensity: Number(canvas?.getAttribute("data-rite-arena-side-light-intensity") ?? "0"),
        bodyKoExitSeen: canvas?.getAttribute("data-rite-body-ko-exit-seen") === "true",
        groundingFootprints: canvas?.getAttribute("data-rite-grounding-footprints") ?? "",
        spectacleGrammar: canvas?.getAttribute("data-rite-spectacle-grammar") ?? "",
        spectacleOverlapCap: Number(canvas?.getAttribute("data-rite-spectacle-overlap-cap") ?? "NaN"),
        spectacleTellActive: Number(canvas?.getAttribute("data-rite-spectacle-tell-active") ?? "NaN"),
        spectacleContactActive: Number(canvas?.getAttribute("data-rite-spectacle-contact-active") ?? "NaN"),
        spectacleResultActive: Number(canvas?.getAttribute("data-rite-spectacle-result-active") ?? "NaN"),
        spectacleParticlesActive: Number(canvas?.getAttribute("data-rite-spectacle-particles-active") ?? "NaN"),
        spectacleParticlesMax: Number(canvas?.getAttribute("data-rite-spectacle-particles-max") ?? "NaN"),
        spectacleElementsSeen: canvas?.getAttribute("data-rite-spectacle-elements-seen") ?? "",
        heroElement: canvas?.getAttribute("data-rite-hero-element") ?? "",
        heroActor: canvas?.getAttribute("data-rite-hero-actor") ?? "",
        heroTarget: canvas?.getAttribute("data-rite-hero-target") ?? "",
        heroTellTick: Number(canvas?.getAttribute("data-rite-hero-tell-tick") ?? "NaN"),
        heroContactTick: Number(canvas?.getAttribute("data-rite-hero-contact-tick") ?? "NaN"),
        heroStage: canvas?.getAttribute("data-rite-hero-stage") ?? "idle",
        heroVfxGrammar: canvas?.getAttribute("data-rite-hero-vfx-grammar") ?? "",
        heroShape: canvas?.getAttribute("data-rite-hero-shape") ?? "",
        heroOriginAnchor: canvas?.getAttribute("data-rite-hero-origin-anchor") ?? "",
        heroTargetAnchor: canvas?.getAttribute("data-rite-hero-target-anchor") ?? "",
        heroCorridorLength: Number(canvas?.getAttribute("data-rite-hero-corridor-length") ?? "NaN"),
        heroHpDelta: Number(canvas?.getAttribute("data-rite-hero-hp-delta") ?? "NaN"),
        heroLocalHpVisible: canvas?.getAttribute("data-rite-hero-local-hp-visible") === "true",
        heroTargetRecoil: Number(canvas?.getAttribute("data-rite-hero-target-recoil") ?? "NaN"),
        heroFlareMinPx: Number(canvas?.getAttribute("data-rite-hero-flare-min-px") ?? "NaN"),
        heroTravelCorePx: Number(canvas?.getAttribute("data-rite-hero-travel-core-px") ?? "NaN"),
        heroTravelPlumePx: Number(canvas?.getAttribute("data-rite-hero-travel-plume-px") ?? "NaN"),
        heroTravelMinSpanFraction: Number(canvas?.getAttribute("data-rite-hero-travel-min-span-fraction") ?? "NaN"),
        heroTravelSpanFraction: Number(canvas?.getAttribute("data-rite-hero-travel-span-fraction") ?? "0"),
        heroTravelAxis: canvas?.getAttribute("data-rite-hero-travel-axis") ?? "",
        heroAxisTailPx: Number(canvas?.getAttribute("data-rite-hero-axis-tail-px") ?? "NaN"),
        heroAxisTailVisible: canvas?.getAttribute("data-rite-hero-axis-tail-visible") === "true",
        heroAxisTailStrength: Number(canvas?.getAttribute("data-rite-hero-axis-tail-strength") ?? "0"),
        heroAxisTailAxis: canvas?.getAttribute("data-rite-hero-axis-tail-axis") ?? "",
        heroBurstPx: Number(canvas?.getAttribute("data-rite-hero-burst-px") ?? "NaN"),
        heroBurstHoldTicks: Number(canvas?.getAttribute("data-rite-hero-burst-hold-ticks") ?? "NaN"),
        heroImpactMinPx: Number(canvas?.getAttribute("data-rite-hero-impact-min-px") ?? "NaN"),
        heroImpactHoldTicks: Number(canvas?.getAttribute("data-rite-hero-impact-hold-ticks") ?? "NaN"),
        heroFlareVisiblePx: Number(canvas?.getAttribute("data-rite-hero-flare-visible-px") ?? "0"),
        heroTravelCoreVisiblePx: Number(canvas?.getAttribute("data-rite-hero-travel-core-visible-px") ?? "0"),
        heroTravelPlumeVisiblePx: Number(canvas?.getAttribute("data-rite-hero-travel-plume-visible-px") ?? "0"),
        heroBurstVisiblePx: Number(canvas?.getAttribute("data-rite-hero-burst-visible-px") ?? "0"),
        heroBurstHoldActive: canvas?.getAttribute("data-rite-hero-burst-hold-active") === "true",
        heroImpactVisiblePx: Number(canvas?.getAttribute("data-rite-hero-impact-visible-px") ?? "0"),
        heroImpactHoldActive: canvas?.getAttribute("data-rite-hero-impact-hold-active") === "true",
        heroContactRenderer: canvas?.getAttribute("data-rite-hero-contact-renderer") ?? "",
        heroContactTargetWidthPx: Number(canvas?.getAttribute("data-rite-hero-contact-target-width-px") ?? "0"),
        heroContactSpanPx: Number(canvas?.getAttribute("data-rite-hero-contact-span-px") ?? "0"),
        heroContactTargetWidthRatio: Number(canvas?.getAttribute("data-rite-hero-contact-target-width-ratio") ?? "0"),
        heroContactLayerCount: Number(canvas?.getAttribute("data-rite-hero-contact-layer-count") ?? "NaN"),
        heroContactLayers: canvas?.getAttribute("data-rite-hero-contact-layers") ?? "",
        heroContactTargetWidths: Number(canvas?.getAttribute("data-rite-hero-contact-target-widths") ?? "NaN"),
        heroContactLayer: canvas?.getAttribute("data-rite-hero-contact-layer") ?? "",
        heroContactFrontHoldTicks: Number(canvas?.getAttribute("data-rite-hero-contact-front-hold-ticks") ?? "NaN"),
        heroContactFrontActive: canvas?.getAttribute("data-rite-hero-contact-front-active") === "true",
        heroImpactSpriteUrl: canvas?.getAttribute("data-rite-hero-impact-sprite-url") ?? "",
        heroImpactSpriteLoaded: canvas?.getAttribute("data-rite-hero-impact-sprite-loaded") === "true",
        heroImpactSpriteSourceWidth: Number(canvas?.getAttribute("data-rite-hero-impact-sprite-source-width") ?? "NaN"),
        heroImpactSpriteSourceHeight: Number(canvas?.getAttribute("data-rite-hero-impact-sprite-source-height") ?? "NaN"),
        heroImpactSpriteAnchor: canvas?.getAttribute("data-rite-hero-impact-sprite-anchor") ?? "",
        heroImpactSpriteAsymmetry: canvas?.getAttribute("data-rite-hero-impact-sprite-asymmetry") ?? "",
        heroImpactSpriteLeftRightReachRatio: Number(canvas?.getAttribute("data-rite-hero-impact-sprite-left-right-reach-ratio") ?? "NaN"),
        heroImpactSpriteVisible: canvas?.getAttribute("data-rite-hero-impact-sprite-visible") === "true",
        heroImpactSpriteDraws: Number(canvas?.getAttribute("data-rite-hero-impact-sprite-draws") ?? "NaN"),
        heroImpactSpriteRotationRad: Number(canvas?.getAttribute("data-rite-hero-impact-sprite-rotation-rad") ?? "NaN"),
        heroImpactSpriteAxis: canvas?.getAttribute("data-rite-hero-impact-sprite-axis") ?? "",
        heroImpactSpriteFootprintPx: Number(canvas?.getAttribute("data-rite-hero-impact-sprite-footprint-px") ?? "NaN"),
        heroImpactSpriteTargetWidthRatio: Number(canvas?.getAttribute("data-rite-hero-impact-sprite-target-width-ratio") ?? "NaN"),
        heroImpactSpritePrewarmed: canvas?.getAttribute("data-rite-hero-impact-sprite-prewarmed") === "true",
        heroImpactLegacyPrimitiveDraws: Number(canvas?.getAttribute("data-rite-hero-impact-legacy-primitive-draws") ?? "NaN"),
        heroContactCoreRenderOrder: Number(canvas?.getAttribute("data-rite-hero-contact-core-render-order") ?? "NaN"),
        heroContactBurstRenderOrder: Number(canvas?.getAttribute("data-rite-hero-contact-burst-render-order") ?? "NaN"),
        heroContactCoreBackRenderOrder: Number(canvas?.getAttribute("data-rite-hero-contact-core-back-render-order") ?? "NaN"),
        heroContactCoreFrontRenderOrder: Number(canvas?.getAttribute("data-rite-hero-contact-core-front-render-order") ?? "NaN"),
        heroContactBurstFrontRenderOrder: Number(canvas?.getAttribute("data-rite-hero-contact-burst-front-render-order") ?? "NaN"),
        heroContactTargetRenderOrder: Number(canvas?.getAttribute("data-rite-hero-contact-target-render-order") ?? "NaN"),
        heroContactCoreDepthTest: canvas?.getAttribute("data-rite-hero-contact-core-depth-test") === "true",
        heroContactBurstDepthTest: canvas?.getAttribute("data-rite-hero-contact-burst-depth-test") === "true",
        heroContactDepthOffsetWorld: Number(canvas?.getAttribute("data-rite-hero-contact-depth-offset-world") ?? "NaN"),
        heroResidueLayer: canvas?.getAttribute("data-rite-hero-residue-layer") ?? "",
        heroResidueRenderOrder: Number(canvas?.getAttribute("data-rite-hero-residue-render-order") ?? "NaN"),
        heroResidueDepthTest: canvas?.getAttribute("data-rite-hero-residue-depth-test") === "true",
        heroResidueSmokeRenderOrder: Number(canvas?.getAttribute("data-rite-hero-residue-smoke-render-order") ?? "NaN"),
        heroResidueSmokeDepthTest: canvas?.getAttribute("data-rite-hero-residue-smoke-depth-test") === "true",
        heroResidueTicks: Number(canvas?.getAttribute("data-rite-hero-residue-ticks") ?? "NaN"),
        heroResidueLayerCount: Number(canvas?.getAttribute("data-rite-hero-residue-layer-count") ?? "NaN"),
        heroResidueLayers: canvas?.getAttribute("data-rite-hero-residue-layers") ?? "",
        heroResidueVisible: canvas?.getAttribute("data-rite-hero-residue-visible") === "true",
        heroResidueSpanPx: Number(canvas?.getAttribute("data-rite-hero-residue-span-px") ?? "0"),
        heroResidueMaterialStrength: Number(canvas?.getAttribute("data-rite-hero-residue-material-strength") ?? "0"),
        heroDamageFontPx: Number(canvas?.getAttribute("data-rite-hero-damage-font-px") ?? "NaN"),
        heroDamageOutlinePx: Number(canvas?.getAttribute("data-rite-hero-damage-outline-px") ?? "NaN"),
        heroDamageRenderOrder: Number(canvas?.getAttribute("data-rite-hero-damage-render-order") ?? "NaN"),
        heroDamageHoldTicks: Number(canvas?.getAttribute("data-rite-hero-damage-hold-ticks") ?? "NaN"),
        heroDamageText: canvas?.getAttribute("data-rite-hero-damage-text") ?? "",
        heroDamageVisible: canvas?.getAttribute("data-rite-hero-damage-visible") === "true",
        audioArmed: hud?.getAttribute("data-audio-armed") === "true",
        audioEvents: Number(audioGate?.getAttribute("data-rite-audio-events") ?? "NaN"),
        audioOverlapCap: Number(audioGate?.getAttribute("data-rite-audio-overlap-cap") ?? "NaN"),
        audioGateBounds: bounds(audioGate),
        audioGateFontPx: fontSize(audioGate),
        hudBounds: bounds(hud),
        hudHeightRatio: hud instanceof HTMLElement
            ? Number((hud.getBoundingClientRect().height / innerHeight).toFixed(4))
            : Number.NaN,
        rosterNameMinFontPx: rosterNames.length
            ? Math.min(...rosterNames.map(fontSize))
            : Number.NaN,
        stateFontPx: fontSize(document.querySelector(".wfr-rule-state")),
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        canvasBounds: canvas instanceof HTMLCanvasElement ? (() => {
            const bounds = canvas.getBoundingClientRect();
            return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
        })() : null,
};
});

const audioBeforeArm = await read();
if (audioBeforeArm.audioArmed || audioBeforeArm.audioEvents !== 0) {
    errors.push(`audio played before user gesture ${JSON.stringify({
        armed: audioBeforeArm.audioArmed,
        events: audioBeforeArm.audioEvents,
    })}`);
}
await page.getByTestId("wfr-audio-gate").click();
await page.waitForFunction(() => document.querySelector('[data-testid="wfr-premium-hud"]')
    ?.getAttribute("data-audio-armed") === "true", undefined, { timeout: 2_000 });

const freezePlayback = (immediate = false) => page.evaluate(async (freezeImmediately) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    if (!freezeImmediately) {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
}, immediate);

const resumePlayback = () => page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
});

function parseFootprints(value) {
    if (!value) return [];
    return value.split(";").map((entry) => {
        const [id, x, y, footWidth] = entry.split(",");
        return { id, x: Number(x), y: Number(y), footWidth: Number(footWidth) };
    }).filter((entry) => entry.id && [entry.x, entry.y, entry.footWidth].every(Number.isFinite));
}

function parseUnitAxis(value) {
    const [x, y, extra] = String(value).split(",");
    if (extra !== undefined) return null;
    const axis = { x: Number(x), y: Number(y) };
    if (!Number.isFinite(axis.x) || !Number.isFinite(axis.y)) return null;
    const length = Math.hypot(axis.x, axis.y);
    return Math.abs(length - 1) <= 0.00001 ? axis : null;
}

/** Pixel gate for the regression that telemetry missed in round three. Besides
 * rejecting oversized near-black ellipses, the normal/ground-reference delta
 * is sampled radially at every submitted foot. Its aggregate profile must be
 * visible, continuously diminish from center to edge, reach zero outside the
 * footprint, and never form a flat-interior token pad. */
async function auditNearBlackGroundEllipses(file, referenceFile, state) {
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const reference = await sharp(referenceFile).removeAlpha().raw().toBuffer();
    const bounds = state.canvasBounds ?? { left: 0, top: 0 };
    const footprints = parseFootprints(state.groundingFootprints);
    const violations = [];
    const inspected = [];
    const contactProfiles = [];
    const pixelDarkening = (offset) => {
        const referenceLuma = (reference[offset] + reference[offset + 1] + reference[offset + 2]) / 3;
        const actualLuma = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
        return Math.max(0, referenceLuma - actualLuma);
    };
    const pixelIsNearBlackSubmission = (offset) => {
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        const actualLuma = (red + green + blue) / 3;
        return Math.max(red, green, blue) <= 32
            && actualLuma <= 24
            && pixelDarkening(offset) >= 12;
    };

    for (const footprint of footprints) {
        const centerX = Math.round(bounds.left + footprint.x);
        const centerY = Math.round(bounds.top + footprint.y);
        const footWidth = Math.max(12, footprint.footWidth);
        const halfWidth = Math.ceil(Math.max(28, footWidth * 2.2));
        const bandAbove = Math.ceil(Math.max(4, footWidth * 0.38));
        const bandBelow = Math.ceil(Math.max(7, footWidth * 0.62));
        const left = Math.max(0, centerX - halfWidth);
        const right = Math.min(info.width - 1, centerX + halfWidth);
        const top = Math.max(0, centerY - bandAbove);
        const bottom = Math.min(info.height - 1, centerY + bandBelow);
        const width = right - left + 1;
        const height = bottom - top + 1;
        const mask = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const source = ((top + y) * info.width + left + x) * info.channels;
                if (pixelIsNearBlackSubmission(source)) mask[y * width + x] = 1;
            }
        }
        const components = [];
        const queueX = new Int16Array(width * height);
        const queueY = new Int16Array(width * height);
        for (let seedY = 0; seedY < height; seedY++) {
            for (let seedX = 0; seedX < width; seedX++) {
                const seed = seedY * width + seedX;
                if (mask[seed] !== 1) continue;
                let head = 0;
                let tail = 1;
                queueX[0] = seedX;
                queueY[0] = seedY;
                mask[seed] = 2;
                let minX = seedX;
                let maxX = seedX;
                let minY = seedY;
                let maxY = seedY;
                let area = 0;
                while (head < tail) {
                    const x = queueX[head];
                    const y = queueY[head++];
                    area++;
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y);
                    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue;
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                        const next = ny * width + nx;
                        if (mask[next] !== 1) continue;
                        mask[next] = 2;
                        queueX[tail] = nx;
                        queueY[tail++] = ny;
                    }
                }
                const boxWidth = maxX - minX + 1;
                const boxHeight = maxY - minY + 1;
                const absoluteMinX = left + minX;
                const absoluteMaxX = left + maxX;
                const spansFoot = absoluteMinX <= centerX - footWidth * 0.38
                    && absoluteMaxX >= centerX + footWidth * 0.38;
                const ellipseLike = boxHeight >= Math.max(3, footWidth * 0.12)
                    && boxHeight <= boxWidth * 0.82
                    && area / (boxWidth * boxHeight) >= 0.12;
                const oversized = boxWidth > footWidth * 1.25;
                if (spansFoot && ellipseLike && oversized) {
                    components.push({ width: boxWidth, height: boxHeight, area, limit: footWidth * 1.25 });
                }
            }
        }
        const physicalFootWidth = Math.max(3, footprint.footWidth);
        const contactRadius = physicalFootWidth * 0.5;
        const profileHalfHeight = Math.ceil(Math.max(2, physicalFootWidth * 0.13));
        let centerDarkening = 0;
        let middleDarkening = 0;
        let edgeDarkening = 0;
        let outsideDarkening = 0;
        let activeRun = 0;
        let maxConnectedWidth = 0;
        const profileExtent = Math.ceil(contactRadius * 1.35);
        for (let dx = -profileExtent; dx <= profileExtent; dx++) {
            const sampleX = centerX + dx;
            if (sampleX < 0 || sampleX >= info.width) continue;
            let columnDarkening = 0;
            for (let dy = -profileHalfHeight; dy <= profileHalfHeight; dy++) {
                const sampleY = centerY + dy;
                if (sampleY < 0 || sampleY >= info.height) continue;
                const offset = (sampleY * info.width + sampleX) * info.channels;
                columnDarkening = Math.max(columnDarkening, pixelDarkening(offset));
            }
            const normalizedRadius = Math.abs(dx) / contactRadius;
            if (normalizedRadius <= 0.25) centerDarkening = Math.max(centerDarkening, columnDarkening);
            else if (normalizedRadius >= 0.35 && normalizedRadius <= 0.65) middleDarkening = Math.max(middleDarkening, columnDarkening);
            else if (normalizedRadius >= 0.8 && normalizedRadius <= 1.05) edgeDarkening = Math.max(edgeDarkening, columnDarkening);
            else if (normalizedRadius >= 1.12) outsideDarkening = Math.max(outsideDarkening, columnDarkening);
            if (columnDarkening >= 0.66) {
                activeRun++;
                maxConnectedWidth = Math.max(maxConnectedWidth, activeRun);
            } else {
                activeRun = 0;
            }
        }
        const contactPatch = {
            centerDarkening: Number(centerDarkening.toFixed(2)),
            middleDarkening: Number(middleDarkening.toFixed(2)),
            edgeDarkening: Number(edgeDarkening.toFixed(2)),
            outsideDarkening: Number(outsideDarkening.toFixed(2)),
            connectedWidthPx: maxConnectedWidth,
            connectedWidthRatio: Number((maxConnectedWidth / physicalFootWidth).toFixed(3)),
        };
        contactProfiles.push(contactPatch);
        inspected.push({
            id: footprint.id,
            footWidth: Number(footWidth.toFixed(2)),
            oversizedNearBlackEllipses: components.length,
            contactPatch,
        });
        if (components.length) violations.push({ id: footprint.id, components });
    }
    const median = (values) => {
        if (!values.length) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
    };
    // A model can cover the exact center of its sub-foot patch, especially at
    // the four-pixel S25 3D projection. Validate the radial shape on patches
    // whose center and shoulder remain visible in the paired screenshots, and
    // separately require enough independently visible patches. A flat pad
    // cannot qualify merely by being dark because its center/shoulder do not
    // diminish toward the edge.
    const featheredPatches = contactProfiles.filter((profile) => (
        profile.centerDarkening >= 0.66
        && profile.centerDarkening > profile.middleDarkening * 1.03
        && profile.middleDarkening > profile.edgeDarkening + 0.05
    ));
    const profileSource = featheredPatches.length ? featheredPatches : contactProfiles;
    const featherProfile = {
        verifiedFeatheredPatches: featheredPatches.length,
        // Two independent pixel-resolved patches are the robust floor on the
        // 412px-wide 3D KO frame; the remaining submissions are still checked
        // individually by the oversized-component and width gates above.
        requiredFeatheredPatches: Math.min(2, contactProfiles.length),
        medianCenterDarkening: Number(median(profileSource.map((profile) => profile.centerDarkening)).toFixed(2)),
        medianMiddleDarkening: Number(median(profileSource.map((profile) => profile.middleDarkening)).toFixed(2)),
        medianEdgeDarkening: Number(median(profileSource.map((profile) => profile.edgeDarkening)).toFixed(2)),
        medianOutsideDarkening: Number(median(contactProfiles.map((profile) => profile.outsideDarkening)).toFixed(2)),
        maxOutsideDarkening: Number(Math.max(0, ...contactProfiles.map((profile) => profile.outsideDarkening)).toFixed(2)),
        maxConnectedWidthRatio: Number(Math.max(0, ...contactProfiles.map((profile) => profile.connectedWidthRatio)).toFixed(3)),
    };
    const profileViolations = [];
    if (featherProfile.maxConnectedWidthRatio > 1.25) profileViolations.push("connected-width-over-1.25x-foot");
    if (featherProfile.verifiedFeatheredPatches < featherProfile.requiredFeatheredPatches) {
        profileViolations.push("insufficient-visible-feathered-patches");
    }
    if (featherProfile.medianCenterDarkening < 0.66) profileViolations.push("contact-not-visible");
    if (featherProfile.medianMiddleDarkening >= featherProfile.medianCenterDarkening * 0.97) profileViolations.push("flat-interior");
    if (featherProfile.medianCenterDarkening <= featherProfile.medianMiddleDarkening * 1.03
        || featherProfile.medianMiddleDarkening <= featherProfile.medianEdgeDarkening + 0.05) {
        profileViolations.push("non-smooth-falloff");
    }
    // A moving mesh can change one outside pixel between the paired frames;
    // the median still has to be exact zero across the submitted patches.
    if (featherProfile.medianOutsideDarkening > 0.67) profileViolations.push("nonzero-edge");
    if (profileViolations.length) violations.push({ kind: "feather-profile", profileViolations, featherProfile });
    return { footprints: footprints.length, inspected, featherProfile, profileViolations, violations };
}

const capture = async (name) => {
    // Freeze synchronously at every authoritative phase. On software-GL, even
    // the travel window can advance past contact while Playwright crosses the
    // evaluate/screenshot boundary, which would make the shape gate sample the
    // next phrase rather than the frame that satisfied its telemetry predicate.
    await freezePlayback(true);
    const state = await read();
    const file = path.join(outputDir, `${name}.png`);
    await page.screenshot({ path: file });
    await page.evaluate(() => {
        const canvas = document.querySelector(".wfr-canvas canvas");
        if (canvas instanceof HTMLCanvasElement) canvas.dataset.riteGroundingQaHide = "1";
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const referenceFile = path.join(outputDir, `${name}.ground-reference.png`);
    await page.screenshot({ path: referenceFile });
    await page.evaluate(() => {
        const canvas = document.querySelector(".wfr-canvas canvas");
        if (canvas instanceof HTMLCanvasElement) delete canvas.dataset.riteGroundingQaHide;
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const pixelMask = await auditNearBlackGroundEllipses(file, referenceFile, state);
    if (state.submittedAoMaxAlpha > 0.42 || state.submittedAoMaxRadiusRatio > 0.28
        || state.submittedRimCount > 1 || state.submittedPlanarImpactCount !== 0
        || pixelMask.violations.length > 0) {
        errors.push(`${name}: grounding gate failed ${JSON.stringify({
            aoAlpha: state.submittedAoMaxAlpha,
            aoRadiusRatio: state.submittedAoMaxRadiusRatio,
            rims: state.submittedRimCount,
            planarImpacts: state.submittedPlanarImpactCount,
            pixelViolations: pixelMask.violations,
        })}`);
    }
    if (state.prototypeDressingDraws !== 0 || state.prototypeDressingMeshes !== 0
        || state.glyphDebrisDraws !== 0 || state.glyphDebrisMeshes !== 0
        || state.floorDecalDraws < 1 || state.floorDecalMaxAlpha > 0.18
        || state.floorDecalMaxRadiusWorld > 0.285 || state.scrollPropDraws < 4
        || state.actorsVisible !== 8 || state.boardVisible !== "true") {
        errors.push(`${name}: arena dressing gate failed ${JSON.stringify({
            prototypeDraws: state.prototypeDressingDraws,
            prototypeMeshes: state.prototypeDressingMeshes,
            glyphDebrisDraws: state.glyphDebrisDraws,
            glyphDebrisMeshes: state.glyphDebrisMeshes,
            floorDecalDraws: state.floorDecalDraws,
            floorDecalAlpha: state.floorDecalMaxAlpha,
            floorDecalRadiusWorld: state.floorDecalMaxRadiusWorld,
            scrollPropDraws: state.scrollPropDraws,
            scrollPropMeshes: state.scrollPropMeshes,
            actorsVisible: state.actorsVisible,
            boardVisible: state.boardVisible,
        })}`);
    }
    const canvasLightInvalid = state.actorLightMode === "position-aware-multiply-mask"
        && (state.actorLightMode !== "position-aware-multiply-mask"
            || state.actorLightOverlays < 1 || state.actorLightOverlays > 8
            || state.actorLightMaxAlpha > 0.17
            || state.actorLightMultiplyMaxAlpha > 0.17
            || state.actorLightMultiplyCap !== 0.17
            || state.actorLightEdgeRecoveryMaxAlpha > 0.03
            || state.arenaSideLights !== 0);
    const threeLightInvalid = state.actorLightMode === "three-positional-pair"
        && (state.actorLightMode !== "three-positional-pair"
            || state.actorLightOverlays !== 0 || state.arenaSideLights !== 2
            || state.arenaSideLightIntensity !== 4.5);
    if (canvasLightInvalid || threeLightInvalid) {
        errors.push(`${name}: actor arena-light submission failed ${JSON.stringify({
            actorMode: state.actorMode,
            lightMode: state.actorLightMode,
            overlays: state.actorLightOverlays,
            maxAlpha: state.actorLightMaxAlpha,
            multiplyMaxAlpha: state.actorLightMultiplyMaxAlpha,
            multiplyCap: state.actorLightMultiplyCap,
            edgeRecoveryMaxAlpha: state.actorLightEdgeRecoveryMaxAlpha,
            sideLights: state.arenaSideLights,
            sideLightIntensity: state.arenaSideLightIntensity,
        })}`);
    }
    const particleCap = state.viewportWidth <= 720 ? 8 : 16;
    const spectacleInvalid = state.spectacleGrammar !== "elemental-v1"
        || state.spectacleOverlapCap !== 4
        || state.active > state.spectacleOverlapCap
        || state.maxActive > state.spectacleOverlapCap
        || state.spectacleTellActive > state.spectacleOverlapCap
        || state.spectacleContactActive > state.spectacleOverlapCap
        || state.spectacleResultActive > state.spectacleOverlapCap
        || state.spectacleParticlesActive > particleCap
        || state.spectacleParticlesMax > particleCap;
    if (spectacleInvalid) {
        errors.push(`${name}: spectacle budget gate failed ${JSON.stringify({
            grammar: state.spectacleGrammar,
            overlapCap: state.spectacleOverlapCap,
            active: state.active,
            maxActive: state.maxActive,
            tells: state.spectacleTellActive,
            contacts: state.spectacleContactActive,
            results: state.spectacleResultActive,
            particles: state.spectacleParticlesActive,
            particleMax: state.spectacleParticlesMax,
            particleCap,
        })}`);
    }
    const hudInvalid = state.hudHeightRatio > 0.2
        || state.rosterNameMinFontPx < 11.9
        || state.stateFontPx < 11.9
        || state.audioGateFontPx < 11.9
        || !state.audioGateBounds
        || state.audioGateBounds.width < 44
        || state.audioGateBounds.height < 44
        || !state.audioArmed
        || state.audioOverlapCap !== 1;
    if (hudInvalid) {
        errors.push(`${name}: HUD/audio gate failed ${JSON.stringify({
            hudHeightRatio: state.hudHeightRatio,
            rosterNameMinFontPx: state.rosterNameMinFontPx,
            stateFontPx: state.stateFontPx,
            audioGateFontPx: state.audioGateFontPx,
            audioGateBounds: state.audioGateBounds,
            audioArmed: state.audioArmed,
            audioOverlapCap: state.audioOverlapCap,
        })}`);
    }
    if (captureMode === "hero" && (state.heroElement !== "Fire"
        || !state.heroActor.startsWith("player-")
        || !state.heroTarget.startsWith("enemy-")
        || !state.heroOriginAnchor
        || !state.heroTargetAnchor
        || !(state.heroCorridorLength > 0)
        || !(state.heroHpDelta > 0)
        || state.heroFlareMinPx !== 48
        || state.heroTravelCorePx !== 12
        || state.heroTravelPlumePx !== 24
        || Math.abs(state.heroTravelMinSpanFraction - 1 / 3) > 0.000001
        || state.heroAxisTailPx !== 28
        || state.actorsPresent < 2
        || !state.heroActorPresent
        || !state.heroTargetPresent
        || state.heroBurstPx !== 68
        || state.heroBurstHoldTicks !== 2
        || state.heroImpactMinPx !== 44
        || state.heroImpactHoldTicks !== 2
        || state.heroContactTargetWidths !== 1.65
        || state.heroContactLayerCount !== 3
        || state.heroContactLayers !== "incoming-axis-tail,authored-asymmetric-fire-impact-sprite,ember-smoke-scorch-residue"
        || state.heroImpactSpriteUrl !== "/assets/warfront/kage-fire-impact-burst-v1-512.png"
        || !state.heroImpactSpriteLoaded
        || state.heroImpactSpriteSourceWidth !== 512
        || state.heroImpactSpriteSourceHeight !== 512
        || state.heroImpactSpriteAnchor !== "0.600000,0.500000"
        || state.heroImpactSpriteAsymmetry !== "incoming-tail-left"
        || state.heroImpactSpriteLeftRightReachRatio < 1.5
        || !state.heroImpactSpritePrewarmed
        || state.heroImpactLegacyPrimitiveDraws !== 0
        || state.heroResidueTicks !== 9
        || state.heroResidueLayerCount !== 3
        || state.heroResidueLayers !== "scorch,smoke,embers")) {
        errors.push(`${name}: representative hero contract failed ${JSON.stringify({
            element: state.heroElement,
            actor: state.heroActor,
            target: state.heroTarget,
            stage: state.heroStage,
            origin: state.heroOriginAnchor,
            targetAnchor: state.heroTargetAnchor,
            corridorLength: state.heroCorridorLength,
            hpDelta: state.heroHpDelta,
            flareMinPx: state.heroFlareMinPx,
            travelCorePx: state.heroTravelCorePx,
            travelPlumePx: state.heroTravelPlumePx,
            travelMinSpanFraction: state.heroTravelMinSpanFraction,
            travelSpanFraction: state.heroTravelSpanFraction,
            travelAxis: state.heroTravelAxis,
            axisTailPx: state.heroAxisTailPx,
            axisTailVisible: state.heroAxisTailVisible,
            axisTailStrength: state.heroAxisTailStrength,
            axisTailAxis: state.heroAxisTailAxis,
            actorsPresent: state.actorsPresent,
            heroActorPresent: state.heroActorPresent,
            heroTargetPresent: state.heroTargetPresent,
            burstPx: state.heroBurstPx,
            burstHoldTicks: state.heroBurstHoldTicks,
            impactMinPx: state.heroImpactMinPx,
            impactHoldTicks: state.heroImpactHoldTicks,
            targetWidths: state.heroContactTargetWidths,
            contactLayerCount: state.heroContactLayerCount,
            contactLayers: state.heroContactLayers,
            impactSpriteUrl: state.heroImpactSpriteUrl,
            impactSpriteLoaded: state.heroImpactSpriteLoaded,
            impactSpriteSource: `${state.heroImpactSpriteSourceWidth}x${state.heroImpactSpriteSourceHeight}`,
            impactSpriteAnchor: state.heroImpactSpriteAnchor,
            impactSpriteAsymmetry: state.heroImpactSpriteAsymmetry,
            impactSpriteLeftRightReachRatio: state.heroImpactSpriteLeftRightReachRatio,
            impactSpritePrewarmed: state.heroImpactSpritePrewarmed,
            legacyPrimitiveDraws: state.heroImpactLegacyPrimitiveDraws,
            residueTicks: state.heroResidueTicks,
            residueLayerCount: state.heroResidueLayerCount,
            residueLayers: state.heroResidueLayers,
        })}`);
    }
    const heroTravelAxis = parseUnitAxis(state.heroTravelAxis);
    const heroTailAxis = parseUnitAxis(state.heroAxisTailAxis);
    const heroImpactSpriteAxis = parseUnitAxis(state.heroImpactSpriteAxis);
    const heroImpactSpriteAngleAligned = heroImpactSpriteAxis
        && Number.isFinite(state.heroImpactSpriteRotationRad)
        && Math.cos(state.heroImpactSpriteRotationRad) * heroImpactSpriteAxis.x
            + Math.sin(state.heroImpactSpriteRotationRad) * heroImpactSpriteAxis.y >= 0.999999;
    const isHeroContactFrame = name === "03-fire-contact-hp-recoil";
    const heroSpriteLifecycleInvalid = captureMode === "hero" && (isHeroContactFrame
        ? (!state.heroImpactSpriteVisible
            || state.heroImpactSpriteDraws !== 1
            || !heroImpactSpriteAxis
            || state.heroImpactSpriteAxis !== state.heroTravelAxis
            || !heroImpactSpriteAngleAligned
            || Math.abs(state.heroImpactSpriteFootprintPx - state.heroContactSpanPx) > 0.2
            || state.heroImpactSpriteTargetWidthRatio < 1.5
            || state.heroImpactSpriteTargetWidthRatio > 1.8)
        : (state.heroImpactSpriteVisible
            || state.heroImpactSpriteDraws !== 0
            || Math.abs(state.heroImpactSpriteFootprintPx) > 0.01));
    if (heroSpriteLifecycleInvalid) {
        errors.push(`${name}: authored hero impact sprite lifecycle/axis/footprint gate failed ${JSON.stringify({
            visible: state.heroImpactSpriteVisible,
            draws: state.heroImpactSpriteDraws,
            axis: state.heroImpactSpriteAxis,
            travelAxis: state.heroTravelAxis,
            angleRad: state.heroImpactSpriteRotationRad,
            angleAligned: heroImpactSpriteAngleAligned,
            footprintPx: state.heroImpactSpriteFootprintPx,
            contactSpanPx: state.heroContactSpanPx,
            targetWidthRatio: state.heroImpactSpriteTargetWidthRatio,
        })}`);
    }
    const heroStageSizeInvalid = captureMode === "hero" && (
        (name === "01-fire-owner-windup" && state.heroFlareVisiblePx !== 48)
        || (name === "02-fire-travel-corridor"
            && (state.heroTravelCoreVisiblePx !== 12
                || state.heroTravelPlumeVisiblePx !== 24
                || state.heroTravelSpanFraction < state.heroTravelMinSpanFraction
                || state.heroTravelSpanFraction > 1
                || !heroTravelAxis))
        || (name === "03-fire-contact-hp-recoil"
            && (!(state.heroContactTargetWidthPx > 0)
                || !(state.heroContactSpanPx > 0)
                || state.heroContactTargetWidthRatio < 1.5
                || state.heroContactTargetWidthRatio > 1.8
                || Math.abs(state.heroContactSpanPx - state.heroContactTargetWidthPx * state.heroContactTargetWidthRatio) > 0.3
                || Math.abs(state.heroBurstVisiblePx - state.heroContactSpanPx) > 0.2
                || state.heroImpactVisiblePx < 44
                || state.heroImpactVisiblePx > state.heroContactSpanPx + 0.2
                || !state.heroBurstHoldActive || !state.heroImpactHoldActive || !state.heroContactFrontActive
                || !state.heroAxisTailVisible
                || !(state.heroAxisTailStrength > 0)
                || !heroTailAxis
                || state.heroAxisTailAxis !== state.heroTravelAxis))
        || (name === "04-fire-ember-residue" && (state.heroBurstHoldActive
            || state.heroImpactHoldActive
            || state.heroResidueTicks !== 9
            || state.heroResidueLayerCount !== 3
            || state.heroResidueLayers !== "scorch,smoke,embers"
            || !state.heroResidueVisible
            || state.heroResidueSpanPx < state.heroContactTargetWidthPx * 1.35
            || state.heroResidueMaterialStrength < 0.35
            || !state.heroAxisTailVisible
            || !(state.heroAxisTailStrength > 0 && state.heroAxisTailStrength < 1)
            || !heroTailAxis
            || state.heroAxisTailAxis !== state.heroTravelAxis))
    );
    if (heroStageSizeInvalid) {
        errors.push(`${name}: representative hero screen-size gate failed ${JSON.stringify({
            flareVisiblePx: state.heroFlareVisiblePx,
            travelCoreVisiblePx: state.heroTravelCoreVisiblePx,
            travelPlumeVisiblePx: state.heroTravelPlumeVisiblePx,
            burstVisiblePx: state.heroBurstVisiblePx,
            burstHoldActive: state.heroBurstHoldActive,
            impactVisiblePx: state.heroImpactVisiblePx,
            impactHoldActive: state.heroImpactHoldActive,
            contactTargetWidthPx: state.heroContactTargetWidthPx,
            contactSpanPx: state.heroContactSpanPx,
            contactTargetWidthRatio: state.heroContactTargetWidthRatio,
            contactLayerCount: state.heroContactLayerCount,
            contactLayers: state.heroContactLayers,
            contactFrontActive: state.heroContactFrontActive,
            impactSpriteVisible: state.heroImpactSpriteVisible,
            impactSpriteDraws: state.heroImpactSpriteDraws,
            impactSpriteFootprintPx: state.heroImpactSpriteFootprintPx,
            impactSpriteTargetWidthRatio: state.heroImpactSpriteTargetWidthRatio,
            residueVisible: state.heroResidueVisible,
            residueSpanPx: state.heroResidueSpanPx,
            residueMaterialStrength: state.heroResidueMaterialStrength,
        })}`);
    }
    const isThreeHeroResidueFrame = name === "04-fire-ember-residue";
    const threeHeroContactInvalid = captureMode === "hero"
        && state.actorLightMode === "three-positional-pair"
        && (state.heroContactRenderer !== "three"
            || state.heroContactLayer !== "target-anchored-authored-sprite"
            || state.heroContactFrontHoldTicks !== 2
            || state.heroContactTargetRenderOrder !== 4
            || state.heroContactDepthOffsetWorld !== 0.18
            || state.heroResidueLayer !== "behind-target"
            || state.heroResidueRenderOrder !== 3
            || !state.heroResidueDepthTest
            || (isHeroContactFrame && (!(state.tick >= state.heroContactTick
                    && state.tick < state.heroContactTick + 2)
                || !state.heroContactFrontActive
                || !state.heroImpactSpriteVisible
                || state.heroImpactSpriteDraws !== 1))
            || (!isHeroContactFrame && state.heroContactFrontActive)
            || (isThreeHeroResidueFrame && (!state.heroResidueVisible
                || state.heroResidueSmokeRenderOrder !== 3
                || !state.heroResidueSmokeDepthTest))
            || state.heroDamageFontPx !== 14
            || state.heroDamageFontPx < 12
            || state.heroDamageOutlinePx !== 2
            || state.heroDamageRenderOrder !== 13
            || state.heroDamageHoldTicks !== 3
            || state.heroDamageText !== `−${Math.max(1, Math.round(state.heroHpDelta))}`
            || (name === "03-fire-contact-hp-recoil" ? !state.heroDamageVisible : state.heroDamageVisible));
    if (threeHeroContactInvalid) {
        errors.push(`${name}: Three hero two-tick front/residue-depth/text gate failed ${JSON.stringify({
            renderer: state.heroContactRenderer,
            layer: state.heroContactLayer,
            frontHoldTicks: state.heroContactFrontHoldTicks,
            frontActive: state.heroContactFrontActive,
            targetOrder: state.heroContactTargetRenderOrder,
            depthOffsetWorld: state.heroContactDepthOffsetWorld,
            residueLayer: state.heroResidueLayer,
            residueOrder: state.heroResidueRenderOrder,
            residueDepthTest: state.heroResidueDepthTest,
            residueSmokeOrder: state.heroResidueSmokeRenderOrder,
            residueSmokeDepthTest: state.heroResidueSmokeDepthTest,
            residueVisible: state.heroResidueVisible,
            damageFontPx: state.heroDamageFontPx,
            damageOutlinePx: state.heroDamageOutlinePx,
            damageOrder: state.heroDamageRenderOrder,
            damageHoldTicks: state.heroDamageHoldTicks,
            damageText: state.heroDamageText,
            damageVisible: state.heroDamageVisible,
            hpDelta: state.heroHpDelta,
            travelMinSpanFraction: state.heroTravelMinSpanFraction,
            travelSpanFraction: state.heroTravelSpanFraction,
            travelAxis: state.heroTravelAxis,
            axisTailPx: state.heroAxisTailPx,
            axisTailVisible: state.heroAxisTailVisible,
            axisTailStrength: state.heroAxisTailStrength,
            axisTailAxis: state.heroAxisTailAxis,
            impactSpriteVisible: state.heroImpactSpriteVisible,
            impactSpriteDraws: state.heroImpactSpriteDraws,
            impactSpriteAxis: state.heroImpactSpriteAxis,
            impactSpriteAngleRad: state.heroImpactSpriteRotationRad,
            impactSpriteFootprintPx: state.heroImpactSpriteFootprintPx,
            legacyPrimitiveDraws: state.heroImpactLegacyPrimitiveDraws,
            actorsPresent: state.actorsPresent,
            heroActorPresent: state.heroActorPresent,
            heroTargetPresent: state.heroTargetPresent,
        })}`);
    }
    const expectedHeroShape = {
        "01-fire-owner-windup": "licking-flame-cone",
        "02-fire-travel-corridor": "tapered-ember-bolt",
        "03-fire-contact-hp-recoil": "authored-asymmetric-fire-impact-sprite",
        "04-fire-ember-residue": "smoke-ember-scorch",
    }[name];
    if (captureMode === "hero" && (state.heroVfxGrammar !== "fire-material-v4"
        || state.heroShape !== expectedHeroShape)) {
        errors.push(`${name}: representative hero material-shape gate failed ${JSON.stringify({
            grammar: state.heroVfxGrammar,
            stage: state.heroStage,
            shape: state.heroShape,
            expectedShape: expectedHeroShape,
        })}`);
    }
    await resumePlayback();
    return { name, ...state, pixelMask, afterCapture: await read() };
};

const samples = [];
if (captureMode === "hero") {
    for (const [stage, name] of [
        ["windup", "01-fire-owner-windup"],
        ["travel", "02-fire-travel-corridor"],
        ["contact", "03-fire-contact-hp-recoil"],
        ["result", "04-fire-ember-residue"],
    ]) {
        await page.waitForFunction((wanted) => {
            const canvas = document.querySelector(".wfr-canvas canvas");
            if (canvas?.getAttribute("data-rite-hero-stage") !== wanted) return false;
            if (Number(canvas.getAttribute("data-rite-actors-present") ?? "0") < 2
                || canvas.getAttribute("data-rite-hero-actor-present") !== "true"
                || canvas.getAttribute("data-rite-hero-target-present") !== "true") return false;
            if (canvas.getAttribute("data-rite-hero-impact-sprite-url") !== "/assets/warfront/kage-fire-impact-burst-v1-512.png"
                || canvas.getAttribute("data-rite-hero-impact-sprite-loaded") !== "true"
                || canvas.getAttribute("data-rite-hero-impact-sprite-prewarmed") !== "true"
                || Number(canvas.getAttribute("data-rite-hero-impact-sprite-source-width") ?? "0") !== 512
                || Number(canvas.getAttribute("data-rite-hero-impact-sprite-source-height") ?? "0") !== 512
                || canvas.getAttribute("data-rite-hero-impact-sprite-asymmetry") !== "incoming-tail-left"
                || Number(canvas.getAttribute("data-rite-hero-impact-legacy-primitive-draws") ?? "-1") !== 0) return false;
            const tick = Number(document.querySelector('[data-testid="wfr-clock"]')?.getAttribute("data-tick") ?? "0");
            const tellTick = Number(canvas.getAttribute("data-rite-hero-tell-tick") ?? "0");
            const contactTick = Number(canvas.getAttribute("data-rite-hero-contact-tick") ?? "0");
            // Capture the readable middle of each phrase instead of the first
            // rAF where a stage crosses zero strength. This remains driven by
            // authoritative ticks and does not alter playback or render timing.
            let ready = false;
            if (wanted === "windup") ready = tick >= tellTick
                && Number(canvas.getAttribute("data-rite-hero-flare-visible-px") ?? "0") === 48;
            // Stop two ticks before the contact boundary so a React commit
            // already queued by the producing rAF cannot replace the bolt with
            // the impact frame after this DOM sample has matched.
            else if (wanted === "travel") ready = tick >= contactTick - 4
                && Number(canvas.getAttribute("data-rite-hero-travel-core-visible-px") ?? "0") === 12
                && Number(canvas.getAttribute("data-rite-hero-travel-plume-visible-px") ?? "0") === 24
                && Number(canvas.getAttribute("data-rite-hero-travel-span-fraction") ?? "0")
                    >= Number(canvas.getAttribute("data-rite-hero-travel-min-span-fraction") ?? "1")
                && Boolean(canvas.getAttribute("data-rite-hero-travel-axis"));
            else if (wanted === "result") ready = tick >= contactTick + 4
                && tick <= contactTick + 6
                && canvas.getAttribute("data-rite-hero-impact-sprite-visible") !== "true"
                && Number(canvas.getAttribute("data-rite-hero-impact-sprite-draws") ?? "-1") === 0
                && canvas.getAttribute("data-rite-hero-burst-hold-active") !== "true"
                && canvas.getAttribute("data-rite-hero-impact-hold-active") !== "true"
                && canvas.getAttribute("data-rite-hero-axis-tail-visible") === "true"
                && Number(canvas.getAttribute("data-rite-hero-axis-tail-strength") ?? "0") > 0
                && canvas.getAttribute("data-rite-hero-axis-tail-axis")
                    === canvas.getAttribute("data-rite-hero-travel-axis")
                && canvas.getAttribute("data-rite-hero-residue-visible") === "true"
                && Number(canvas.getAttribute("data-rite-hero-residue-span-px") ?? "0")
                    >= Number(canvas.getAttribute("data-rite-hero-contact-target-width-px") ?? "0") * 1.35
                && Number(canvas.getAttribute("data-rite-hero-residue-material-strength") ?? "0") >= 0.35;
            else if (wanted === "contact") ready = tick >= contactTick
                && tick < contactTick + 2
                && canvas.getAttribute("data-rite-hero-impact-sprite-visible") === "true"
                && Number(canvas.getAttribute("data-rite-hero-impact-sprite-draws") ?? "0") === 1
                && canvas.getAttribute("data-rite-hero-impact-sprite-axis")
                    === canvas.getAttribute("data-rite-hero-travel-axis")
                && Math.abs(
                    Number(canvas.getAttribute("data-rite-hero-impact-sprite-footprint-px") ?? "0")
                    - Number(canvas.getAttribute("data-rite-hero-contact-span-px") ?? "0"),
                ) <= 0.2
                && Number(canvas.getAttribute("data-rite-hero-impact-sprite-target-width-ratio") ?? "0") >= 1.5
                && Number(canvas.getAttribute("data-rite-hero-impact-sprite-target-width-ratio") ?? "0") <= 1.8
                && canvas.getAttribute("data-rite-hero-axis-tail-visible") === "true"
                && Number(canvas.getAttribute("data-rite-hero-axis-tail-strength") ?? "0") > 0
                && canvas.getAttribute("data-rite-hero-axis-tail-axis")
                    === canvas.getAttribute("data-rite-hero-travel-axis")
                && canvas.getAttribute("data-rite-hero-contact-front-active") === "true"
                && canvas.getAttribute("data-rite-hero-local-hp-visible") === "true"
                && Number(canvas.getAttribute("data-rite-hero-hp-delta") ?? "0") > 0
                && Number(canvas.getAttribute("data-rite-hero-target-recoil") ?? "0") > 0.5
                && Number(canvas.getAttribute("data-rite-hero-contact-target-width-px") ?? "0") > 0
                && Number(canvas.getAttribute("data-rite-hero-contact-target-width-ratio") ?? "0") >= 1.5
                && Number(canvas.getAttribute("data-rite-hero-contact-target-width-ratio") ?? "0") <= 1.8
                && Math.abs(
                    Number(canvas.getAttribute("data-rite-hero-burst-visible-px") ?? "0")
                    - Number(canvas.getAttribute("data-rite-hero-contact-span-px") ?? "0"),
                ) <= 0.2
                && Number(canvas.getAttribute("data-rite-hero-impact-visible-px") ?? "0") >= 44
                && canvas.getAttribute("data-rite-hero-burst-hold-active") === "true"
                && canvas.getAttribute("data-rite-hero-impact-hold-active") === "true";
            if (ready) {
                // Stop the simulation in the same browser task that observes
                // the matching frame so the narrow travel/contact phrases
                // cannot roll into their successor before capture() executes.
                Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
                document.dispatchEvent(new Event("visibilitychange"));
            }
            return ready;
        }, stage, { polling: "raf", timeout: 45_000 });
        samples.push(await capture(name));
    }
    const [windupSample, travelSample, contactSample, resultSample] = samples;
    const expectedAxis = travelSample?.heroTravelAxis;
    if (!parseUnitAxis(expectedAxis)
        || windupSample?.heroTravelAxis !== expectedAxis
        || contactSample?.heroTravelAxis !== expectedAxis
        || resultSample?.heroTravelAxis !== expectedAxis
        || contactSample?.heroImpactSpriteAxis !== expectedAxis
        || contactSample?.heroAxisTailAxis !== expectedAxis
        || resultSample?.heroAxisTailAxis !== expectedAxis) {
        errors.push(`hero frozen-axis continuity gate failed ${JSON.stringify({
            windup: windupSample?.heroTravelAxis,
            travel: expectedAxis,
            contact: contactSample?.heroTravelAxis,
            contactSprite: contactSample?.heroImpactSpriteAxis,
            contactTail: contactSample?.heroAxisTailAxis,
            result: resultSample?.heroTravelAxis,
            resultTail: resultSample?.heroAxisTailAxis,
        })}`);
    }
} else {
    await page.waitForFunction(() => {
        const clock = Number(document.querySelector('[data-testid="wfr-clock"]')?.getAttribute("data-tick") ?? "0");
        const canvas = document.querySelector(".wfr-canvas canvas");
        return clock >= 15 && Number(canvas?.getAttribute("data-rite-spectacle-tell-active") ?? "0") > 0;
    }, undefined, { timeout: 12_000 });
    samples.push(await capture("01-element-tell"));

    await page.waitForFunction(() => Number(document.querySelector(".wfr-canvas canvas")
        ?.getAttribute("data-rite-attack-contacts-active") ?? "0") > 0, undefined, { polling: "raf", timeout: 12_000 });
    samples.push(await capture("02-element-contact"));

    await page.waitForFunction(() => {
        const canvas = document.querySelector(".wfr-canvas canvas");
        return Number(canvas?.getAttribute("data-rite-spectacle-result-active") ?? "0") > 0
            && Number(canvas?.getAttribute("data-rite-spectacle-contact-active") ?? "0") === 0;
    }, undefined, { polling: "raf", timeout: 2_000 });
    samples.push(await capture("03-element-result"));

    // A fixed 0.8-second cadence makes causality review reproducible without
    // relying on labels or hand-picked cosmetic timestamps.
    for (let index = 0; index < 5; index += 1) {
        await page.waitForTimeout(800);
        samples.push(await capture(`sample-${String(index + 1).padStart(2, "0")}`));
    }

    await page.waitForFunction(() => document.querySelector(".wfr-canvas canvas")
        ?.getAttribute("data-rite-body-ko-exit-seen") === "true", undefined, { polling: "raf", timeout: 25_000 });
    samples.push(await capture("04-ko-exit"));
}

const finalState = await read();
const seenElements = finalState.spectacleElementsSeen.split(",").filter(Boolean).sort();
if (captureMode !== "hero" && seenElements.join(",") !== "Earth,Fire,Water,Wind") {
    errors.push(`element coverage gate failed ${JSON.stringify({ seenElements })}`);
}
if (!finalState.audioArmed || finalState.audioEvents < 1 || finalState.audioOverlapCap !== 1) {
    errors.push(`audio dispatch gate failed ${JSON.stringify({
        armed: finalState.audioArmed,
        events: finalState.audioEvents,
        overlapCap: finalState.audioOverlapCap,
    })}`);
}

await page.close();
await context.close();
await browser.close();

console.log(JSON.stringify({ outputDir, viewport, captureMode, heroImpactSpriteAudit, audioBeforeArm, finalState, samples, warnings, browserDiagnostics, errors }, null, 2));
if (errors.length) process.exitCode = 1;
