import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5186";
const outputDir = resolve("output", "first-pact-qa", "high-court-render-reliability");
const runsPerState = 10;
const expectedHighCourtLayers = [
    "high-court-archive",
    "west-record-hall",
    "east-council-annex",
    "archive-gardens",
    "archive-notice",
];
const targets = [
    {
        state: "world",
        player: { x: 42, y: 14 },
        focus: { x: 42, y: 14 },
        camera: { x: 1320, y: 246 },
        terrainSample: { left: 696, top: 426, width: 48, height: 48 },
    },
    {
        state: "full-campus",
        player: { x: 42, y: 14 },
        focus: { x: 42, y: 9 },
        camera: { x: 1320, y: 6 },
        terrainSample: { left: 696, top: 666, width: 48, height: 48 },
    },
];

await mkdir(outputDir, { recursive: true });

function samePoint(actual, expected) {
    return actual?.x === expected.x && actual?.y === expected.y;
}

function assertProof(proof, target) {
    if (!samePoint(proof.player, target.player)) {
        throw new Error(`${target.state}: player did not settle at ${target.player.x},${target.player.y}: ${JSON.stringify(proof.player)}`);
    }
    if (!samePoint(proof.focus, target.focus)) {
        throw new Error(`${target.state}: camera focus did not settle at ${target.focus.x},${target.focus.y}: ${JSON.stringify(proof.focus)}`);
    }
    if (Math.abs(proof.camera?.x - target.camera.x) >= .01 || Math.abs(proof.camera?.y - target.camera.y) >= .01) {
        throw new Error(`${target.state}: camera did not settle at ${target.camera.x},${target.camera.y}: ${JSON.stringify(proof.camera)}`);
    }
    if (proof.camera?.width !== 1440 || proof.camera?.height !== 900) {
        throw new Error(`${target.state}: expected a 1440x900 canvas camera: ${JSON.stringify(proof.camera)}`);
    }
    if (proof.terrain !== "painted") throw new Error(`${target.state}: terrain paint proof is missing`);
    if (!proof.sources?.highCourtV3 || !proof.sources?.propsAtlas) {
        throw new Error(`${target.state}: decoded High Court source proof is incomplete: ${JSON.stringify(proof.sources)}`);
    }
    const missing = expectedHighCourtLayers.filter((layer) => !proof.highCourtLayers?.includes(layer));
    if (missing.length) throw new Error(`${target.state}: expected High Court layers were not drawn: ${missing.join(", ")}`);
}

async function inspectCapture(path, target) {
    const image = sharp(path);
    const metadata = await image.metadata();
    if (metadata.width !== 1440 || metadata.height !== 900) {
        throw new Error(`${target.state}: capture is ${metadata.width}x${metadata.height}, expected 1440x900`);
    }
    const stats = await image.stats();
    if (!stats.isOpaque) throw new Error(`${target.state}: transparent pixels found in final canvas`);
    if (stats.entropy < 2) throw new Error(`${target.state}: frame entropy ${stats.entropy.toFixed(3)} indicates a blank frame`);

    const { data, info } = await image.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let whitePixels = 0;
    for (let index = 0; index < data.length; index += info.channels) {
        if (data[index] >= 250 && data[index + 1] >= 250 && data[index + 2] >= 250) whitePixels += 1;
    }
    const whiteRatio = whitePixels / (info.width * info.height);
    if (whiteRatio >= .02) throw new Error(`${target.state}: ${(whiteRatio * 100).toFixed(2)}% near-white pixels indicate a failed frame`);

    const terrainStats = await image.clone().extract(target.terrainSample).stats();
    if (!terrainStats.isOpaque || terrainStats.entropy < .25) {
        throw new Error(`${target.state}: public terrain sample is blank or transparent`);
    }
    return { entropy: stats.entropy, whiteRatio, terrainEntropy: terrainStats.entropy };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
});
const captures = [];

try {
    for (const target of targets) {
        for (let run = 1; run <= runsPerState; run += 1) {
            const page = await context.newPage();
            const errors = [];
            page.on("pageerror", (error) => errors.push(String(error)));
            page.on("console", (message) => {
                if (message.type() === "error") errors.push(message.text());
            });
            try {
                const url = `${baseUrl}/firstpactpreview.html?state=${target.state}&capture=critic&reliabilityRun=${run}`;
                const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
                if (!response?.ok()) throw new Error(`${target.state}-${run}: HTTP ${response?.status() ?? "no response"}`);
                const canvas = page.locator("canvas.fp-world-canvas");
                await canvas.waitFor({ state: "visible", timeout: 60_000 });
                await page.waitForFunction(({ player, focus, layers }) => {
                    const element = document.querySelector("canvas.fp-world-canvas");
                    if (element?.getAttribute("data-fp-render-ready") !== "true") return false;
                    try {
                        const proof = JSON.parse(element.getAttribute("data-fp-render-proof") ?? "{}");
                        return proof.player?.x === player.x
                            && proof.player?.y === player.y
                            && proof.focus?.x === focus.x
                            && proof.focus?.y === focus.y
                            && layers.every((layer) => proof.highCourtLayers?.includes(layer));
                    } catch {
                        return false;
                    }
                }, { player: target.player, focus: target.focus, layers: expectedHighCourtLayers }, { timeout: 60_000 });
                await canvas.evaluate((element) => new Promise((resolveFrame) => {
                    requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame(element.getAttribute("data-fp-render-proof"))));
                }));

                const proof = JSON.parse(await canvas.getAttribute("data-fp-render-proof") ?? "{}");
                assertProof(proof, target);
                const fileName = `high-court-reliability-${target.state}-${String(run).padStart(2, "0")}-1440x900.png`;
                const path = resolve(outputDir, fileName);
                await canvas.screenshot({ path });
                const pixels = await inspectCapture(path, target);
                const sha256 = createHash("sha256").update(await readFile(path)).digest("hex").toUpperCase();
                captures.push({ state: target.state, run, path, sha256, proof, pixels });
                process.stdout.write(`PASS ${target.state} ${String(run).padStart(2, "0")}: ${path}\n`);
                if (errors.length) throw new Error(`${target.state}-${run}: console/page errors: ${errors.join(" | ")}`);
            } finally {
                await page.close();
            }
        }
    }

    const thumbWidth = 288;
    const thumbHeight = 180;
    const columns = 5;
    const contactSheetPath = resolve(outputDir, "high-court-reliability-contact-sheet-1440x720.png");
    const composites = await Promise.all(captures.map(async (capture, index) => ({
        input: await sharp(capture.path).resize(thumbWidth, thumbHeight, { fit: "fill" }).png().toBuffer(),
        left: (index % columns) * thumbWidth,
        top: Math.floor(index / columns) * thumbHeight,
    })));
    await sharp({
        create: {
            width: thumbWidth * columns,
            height: thumbHeight * Math.ceil(captures.length / columns),
            channels: 4,
            background: { r: 3, g: 7, b: 17, alpha: 1 },
        },
    }).composite(composites).png().toFile(contactSheetPath);

    const manifestPath = resolve(outputDir, "high-court-reliability-proof.json");
    await writeFile(manifestPath, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        baseUrl,
        runsPerState,
        expectedHighCourtLayers,
        captures,
        contactSheetPath,
    }, null, 2)}\n`);
    process.stdout.write(`CONTACT SHEET: ${contactSheetPath}\nPROOF: ${manifestPath}\n`);
} finally {
    await context.close();
    await browser.close();
}
