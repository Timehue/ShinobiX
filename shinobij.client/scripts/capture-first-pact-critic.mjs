import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5186";
const state = process.argv[3] ?? "stable";
const name = process.argv[4] ?? `critic-${state}`;
const outputDir = resolve("output", "first-pact-qa");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    const response = await page.goto(`${baseUrl}/firstpactpreview.html?state=${encodeURIComponent(state)}&capture=critic`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? "no response"}`);
    const canvas = page.locator("canvas.fp-world-canvas");
    await canvas.waitFor();
    await page.waitForFunction(() => document.querySelector("canvas.fp-world-canvas")?.getAttribute("data-fp-render-ready") === "true", undefined, { timeout: 60_000 });
    await canvas.evaluate((element) => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
    const proof = JSON.parse(await canvas.getAttribute("data-fp-render-proof") ?? "{}");
    let requiredLayers = [];
    if (state === "aqueduct") {
        requiredLayers = ["civic-boulevard-deck", "collision-backed-banks", "banked-sluice-control"];
        const missing = requiredLayers.filter((layer) => !proof.aqueductLayers?.includes(layer));
        if (missing.length) throw new Error(`Aqueduct render proof is missing: ${missing.join(", ")}`);
    }
    if (state === "aqueduct-central" || state === "aqueduct-central-west") {
        const expectedFocusX = state === "aqueduct-central" ? 29 : 24;
        const expectedPlayerX = state === "aqueduct-central" ? 23 : 18;
        requiredLayers = [
            "tile-authoritative-central-deck",
            "continuous-central-water-mouths",
            "four-central-bank-abutments",
            "two-low-central-curbs",
            "world-aligned-central-boulevard",
            "open-central-avatar-clearance",
        ];
        const missing = requiredLayers.filter((layer) => !proof.centralAqueductLayers?.includes(layer));
        if (missing.length) throw new Error(`Central Aqueduct render proof is missing: ${missing.join(", ")}`);
        if (proof.focus?.x !== expectedFocusX || proof.focus?.y !== 29) throw new Error(`Central Aqueduct focus drifted: ${JSON.stringify(proof.focus)}`);
        const cameraCenterX = proof.cameraCenterWorld?.x;
        const cameraCenterY = proof.cameraCenterWorld?.y;
        if (!Number.isFinite(cameraCenterX) || !Number.isFinite(cameraCenterY)
            || Math.abs(cameraCenterX - expectedFocusX) > 0.001 || Math.abs(cameraCenterY - 29) > 0.001) {
            throw new Error(`Central Aqueduct camera is not truly centered at ${expectedFocusX},29: ${JSON.stringify(proof.cameraCenterWorld)}`);
        }
        if (proof.architectureScope !== null) throw new Error(`Central Aqueduct capture cannot hide production architecture: ${proof.architectureScope}`);
        const central = proof.centralAqueduct;
        if (!central || central.deck?.tiles?.length !== 12 || central.deck.tiles.some((tile) => tile !== central.deck.expectedTile)) {
            throw new Error("Central Aqueduct capture does not contain twelve authoritative Bridge cells");
        }
        for (const mouth of [central.northMouth, central.southMouth]) {
            if (!mouth?.tiles?.length || mouth.tiles.some((tile) => tile !== mouth.expectedTile)) {
                throw new Error("Central Aqueduct water-mouth truth drifted");
            }
        }
        if (central.abutmentCount !== 4 || central.abutmentTiles?.length !== 4
            || central.abutmentTiles.some((tile) => tile !== central.expectedAbutmentTile)) {
            throw new Error("Central Aqueduct no longer meets four collision-backed bank corners");
        }
        if (!Number.isFinite(central.approachJointDeltaPx) || central.approachJointDeltaPx > 3) {
            throw new Error(`Central Aqueduct approach joint drift is ${central.approachJointDeltaPx}px`);
        }
        if (!central.avatarClear) throw new Error("Central Aqueduct avatar corridor is not fully walkable");
        if (!central.playerOffDeck) throw new Error("Central Aqueduct QA player obscures the bridge deck");
        if (proof.player?.x !== expectedPlayerX || proof.player?.y !== 29) throw new Error(`Central Aqueduct QA player drifted: ${JSON.stringify(proof.player)}`);
    }
    // Remove comparison labels and controls, but keep the real player/NPC actors:
    // the supplied city bar includes its inhabitants and the production map must
    // be judged as an inhabited play space rather than an empty background plate.
    await page.addStyleTag({ content: ".fp-district-toast,.fp-hud,.fp-minimap,.fp-world-actions,.fp-dpad{display:none!important}" });
    const path = resolve(outputDir, `${name}-1440x900.png`);
    await canvas.screenshot({ path });
    if (consoleErrors.length) throw new Error(`Capture console errors:\n${consoleErrors.join("\n")}`);
    const thumbnailPath = resolve(outputDir, `${name}-25pct-360x225.png`);
    await sharp(path).resize({ width: 360, height: 225, fit: "fill", kernel: "lanczos3" }).png().toFile(thumbnailPath);
    const pngSha256 = createHash("sha256").update(await readFile(path)).digest("hex");
    const thumbnailSha256 = createHash("sha256").update(await readFile(thumbnailPath)).digest("hex");
    const proofPath = resolve(outputDir, `${name}-proof.json`);
    await writeFile(proofPath, `${JSON.stringify({
        schemaVersion: 1,
        state,
        viewport: { width: 1440, height: 900 },
        sourceUrl: `${baseUrl}/firstpactpreview.html?state=${encodeURIComponent(state)}&capture=critic`,
        requiredLayers,
        consoleErrors,
        captures: {
            native: { path, width: 1440, height: 900, sha256: pngSha256 },
            quarter: { path: thumbnailPath, width: 360, height: 225, sha256: thumbnailSha256 },
        },
        renderProof: proof,
    }, null, 2)}\n`, "utf8");
    process.stdout.write(`${path}\n${thumbnailPath}\n${proofPath}\nsha256 ${pngSha256}\nsha256-quarter ${thumbnailSha256}\n`);
} finally {
    await browser.close();
}
