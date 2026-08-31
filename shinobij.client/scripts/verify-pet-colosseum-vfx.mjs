import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import sharp from "sharp";

const managedPreview = !process.env.PET_VFX_QA_URL;
const previewPort = Number(process.env.PET_VFX_QA_PORT ?? 4200 + process.pid % 1000);
const baseUrl = process.env.PET_VFX_QA_URL ?? `http://127.0.0.1:${previewPort}`;
const qualityOverride = ["low", "medium", "high"].includes(process.env.PET_VFX_QA_QUALITY ?? "")
    ? process.env.PET_VFX_QA_QUALITY
    : null;
const outputDir = resolve(process.cwd(), "..", "output", "pet-colosseum-aaa");
await mkdir(outputDir, { recursive: true });

let previewProcess = null;
if (managedPreview) {
    const viteCli = resolve(process.cwd(), "node_modules", "vite", "bin", "vite.js");
    const previewLog = [];
    previewProcess = spawn(process.execPath, [viteCli, "preview", "--host", "127.0.0.1", "--port", String(previewPort), "--strictPort", "--configLoader", "runner"], {
        cwd: process.cwd(),
        env: { ...process.env, VITE_SKIP_HTTPS: "1" },
        stdio: ["ignore", "pipe", "pipe"],
    });
    previewProcess.stdout.on("data", (chunk) => previewLog.push(String(chunk)));
    previewProcess.stderr.on("data", (chunk) => previewLog.push(String(chunk)));
    const readyBy = Date.now() + 30_000;
    let ready = false;
    while (!ready && Date.now() < readyBy) {
        if (previewProcess.exitCode !== null) throw new Error(`Vite preview exited early: ${previewLog.join("")}`);
        try {
            const response = await fetch(`${baseUrl}/showdownpreview.html`);
            ready = response.ok;
        } catch { /* preview is still starting */ }
        if (!ready) await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    if (!ready) throw new Error(`Vite preview did not become ready: ${previewLog.join("")}`);
}

// Production roster coverage: all five body profiles, every elemental family,
// three rarity bands, and all graphics presets. Each case runs through the
// production PetShowdownBattle component mounted by the Showdown harness.
const cases = [
    { id: "standard-fire-quadruped", rosterPet: "standard-0", enemyPet: "rare-24", quality: "low", profile: "quadruped" },
    { id: "rare-water-biped", rosterPet: "rare-1", enemyPet: "rare-24", quality: "medium", profile: "biped" },
    { id: "legendary-wind-avian", rosterPet: "legendary-1", enemyPet: "rare-24", quality: "high", profile: "avian" },
    { id: "legendary-earth-serpentine", rosterPet: "legendary-7", enemyPet: "rare-24", quality: "medium", profile: "serpentine" },
    { id: "legendary-earth-heavy", rosterPet: "legendary-9", enemyPet: "rare-24", quality: "high", profile: "heavy" },
    { id: "mythic-lightning-biped", rosterPet: "mythic-8", enemyPet: "rare-24", quality: "high", profile: "biped" },
].map((entry) => ({ ...entry, quality: qualityOverride ?? entry.quality }));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block",
    reducedMotion: "no-preference",
});
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const vfxAssets = new Map();
const setPieceAssets = new Map();
const modelAssets = new Map();

page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("response", async (response) => {
    const pathname = new URL(response.url()).pathname;
    const projectile = pathname.match(/\/(fire|water|wind|earth|lightning)-[^/]+\.webp$/i);
    const setPiece = pathname.match(/\/(tsunami|firewall|tornado|quake|stormbolt)-[^/]+\.webp$/i);
    const headers = await response.allHeaders();
    const bytes = Number(headers["content-length"] ?? 0);
    if (projectile && bytes >= 100_000) {
        const key = projectile[1].toLowerCase();
        const current = vfxAssets.get(key);
        if (!current || bytes > current.bytes) vfxAssets.set(key, { url: response.url(), status: response.status(), bytes });
    }
    if (setPiece && bytes >= 400_000) {
        const key = setPiece[1].toLowerCase();
        setPieceAssets.set(key, { url: response.url(), status: response.status(), bytes });
    }
    if (/\/pet-models\/.*\.glb$/i.test(pathname)) modelAssets.set(pathname, { status: response.status(), bytes });
});

async function imageContract(path) {
    const image = sharp(path);
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) throw new Error(`Screenshot has no dimensions: ${path}`);
    const stats = await image.stats();
    const rgb = stats.channels.slice(0, 3);
    const mean = rgb.reduce((sum, channel) => sum + channel.mean, 0) / rgb.length;
    const deviation = rgb.reduce((sum, channel) => sum + channel.stdev, 0) / rgb.length;
    const bandTop = Math.round(metadata.height * 0.2);
    const bandHeight = Math.round(metadata.height * 0.55);
    const bandWidth = Math.round(metadata.width * 0.36);
    // sharp.stats() describes the input image, so materialize each crop before
    // measuring it; otherwise both fighter bands silently report whole-frame data.
    const leftBuffer = await sharp(path).extract({ left: Math.round(metadata.width * 0.07), top: bandTop, width: bandWidth, height: bandHeight }).png().toBuffer();
    const rightBuffer = await sharp(path).extract({ left: Math.round(metadata.width * 0.57), top: bandTop, width: bandWidth, height: bandHeight }).png().toBuffer();
    const left = await sharp(leftBuffer).stats();
    const right = await sharp(rightBuffer).stats();
    const regionRead = (region) => ({
        mean: region.channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3,
        deviation: region.channels.slice(0, 3).reduce((sum, channel) => sum + channel.stdev, 0) / 3,
    });
    const fighterBands = [regionRead(left), regionRead(right)];
    if (mean < 24 || deviation < 18 || fighterBands.some((band) => band.mean < 20 || band.deviation < 13)) {
        throw new Error(`Dark/blank/untextured screenshot heuristic failed: ${JSON.stringify({ path, mean, deviation, fighterBands })}`);
    }
    return { width: metadata.width, height: metadata.height, mean: Number(mean.toFixed(2)), deviation: Number(deviation.toFixed(2)), fighterBands };
}

async function inspect(testCase) {
    const url = `${baseUrl}/showdownpreview.html?rosterpet=${testCase.rosterPet}&enemypet=${testCase.enemyPet}&heavy=1&meter=1&glass=1&capture=1&petQuality=${testCase.quality}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const quality = page.getByLabel("Pet battle graphics quality");
    try {
        await quality.waitFor({ state: "visible", timeout: 30_000 });
    } catch (error) {
        const diagnostic = await page.evaluate(() => ({
            title: document.title,
            body: document.body.innerText.slice(0, 1_200),
            scripts: [...document.scripts].map((script) => script.src),
            overlay: document.querySelector("vite-error-overlay,.vite-error-overlay,[data-nextjs-dialog],#webpack-dev-server-client-overlay")?.textContent?.slice(0, 2_000) ?? null,
        }));
        throw new Error(`${testCase.id} harness did not mount: ${JSON.stringify({ diagnostic, consoleErrors, pageErrors })}`, { cause: error });
    }
    await quality.selectOption(testCase.quality);
    await page.waitForTimeout(3_700);
    const evidence = await page.evaluate(() => {
        const root = document.querySelector("[data-testid='pet-showdown-root']");
        const rawAudit = root?.getAttribute("data-pet-visual-audit") ?? "";
        return {
            bodyCharacters: document.body.innerText.trim().length,
            canvasCount: document.querySelectorAll("canvas").length,
            quality: document.querySelector('select[aria-label="Pet battle graphics quality"]')?.value ?? null,
            overlay: Boolean(document.querySelector("vite-error-overlay,.vite-error-overlay,[data-nextjs-dialog],#webpack-dev-server-client-overlay")),
            audit: rawAudit ? JSON.parse(rawAudit) : null,
        };
    });
    const restScreenshotPath = resolve(outputDir, `${testCase.id}-${testCase.quality}-rest.png`);
    await page.screenshot({ path: restScreenshotPath, fullPage: false });
    if (evidence.bodyCharacters === 0 || evidence.canvasCount === 0 || evidence.quality !== testCase.quality || evidence.overlay || !evidence.audit) {
        throw new Error(`${testCase.id} visual contract failed: ${JSON.stringify(evidence)}`);
    }
    if (evidence.audit.renderer !== "PetShowdownBattle" || evidence.audit.quality !== testCase.quality) {
        throw new Error(`${testCase.id} wrong production renderer/quality: ${JSON.stringify(evidence.audit)}`);
    }
    const player = evidence.audit.fighters?.find((fighter) => fighter.templateId === testCase.rosterPet);
    if (!player?.modelUrl || player.profile !== testCase.profile || !player.calibration) {
        throw new Error(`${testCase.id} model/profile contract failed: ${JSON.stringify(player)}`);
    }
    const visibleHeight = player.targetHeight * player.presentationScale;
    if (visibleHeight < 1.2 || visibleHeight > 4 || Math.abs(player.calibration.groundOffset) > 0.025) {
        throw new Error(`${testCase.id} clipped/floating/wrong-scale contract failed: ${JSON.stringify({ visibleHeight, player })}`);
    }
    const budget = evidence.audit.budgets;
    if (!budget || budget.impactDebris < 3 || budget.impactSparks < 3 || budget.aftermathLayers < 1 || budget.decalLimit < 3) {
        throw new Error(`${testCase.id} VFX budget contract failed: ${JSON.stringify(budget)}`);
    }
    const expectedBudget = testCase.quality === "low"
        ? {
            modelShadows: false, outline: false, textureAnisotropy: 2,
            ambientParticles: 12, identityParticles: 3, setPieceParticles: 16,
            dynamicPetLight: false, translucentLayers: 1, distortion: false,
            impactDebris: 4, impactSparks: 3, aftermathLayers: 1, decalLimit: 3, bloomIntensity: 0,
        }
        : testCase.quality === "medium"
            ? {
                modelShadows: false, outline: true, textureAnisotropy: 6,
                ambientParticles: 20, identityParticles: 5, setPieceParticles: 28,
                dynamicPetLight: false, translucentLayers: 2, distortion: false,
                impactDebris: 7, impactSparks: 7, aftermathLayers: 2, decalLimit: 6, bloomIntensity: 0.28,
            }
            : {
                modelShadows: true, outline: true, textureAnisotropy: 8,
                ambientParticles: 42, identityParticles: 12, setPieceParticles: 52,
                dynamicPetLight: true, translucentLayers: 3, distortion: true,
                impactDebris: 12, impactSparks: 12, aftermathLayers: 3, decalLimit: 10, bloomIntensity: 0.48,
            };
    for (const [key, value] of Object.entries(expectedBudget)) {
        if (budget[key] !== value) throw new Error(`${testCase.id} ${key} budget drifted: ${JSON.stringify(budget)}`);
    }

    await page.getByRole("button", { name: /Overdrive/i }).click();
    await page.waitForFunction(() => {
        const raw = document.querySelector("[data-testid='pet-showdown-root']")?.getAttribute("data-pet-visual-audit");
        if (!raw) return false;
        const audit = JSON.parse(raw);
        return audit.attackRhythm && audit.activeEffects?.setPieces > 0 && audit.activeEffects?.scars > 0;
    }, undefined, { timeout: 20_000 });
    // Capture after the hero layer has faded in, not on the React frame that
    // merely mounted it. This makes the stored evidence useful for a human
    // composition review as well as the structural asset-load assertions.
    await page.waitForTimeout(320);
    const actionAudit = await page.evaluate(() => JSON.parse(document.querySelector("[data-testid='pet-showdown-root']")?.getAttribute("data-pet-visual-audit") ?? "null"));
    if (!(actionAudit.attackRhythm.windupStart < actionAudit.attackRhythm.contact
        && actionAudit.attackRhythm.contact < actionAudit.attackRhythm.contactEnd
        && actionAudit.attackRhythm.contactEnd < actionAudit.attackRhythm.recoverEnd)) {
        throw new Error(`${testCase.id} attack rhythm is not ordered: ${JSON.stringify(actionAudit.attackRhythm)}`);
    }
    const actionScreenshotPath = resolve(outputDir, `${testCase.id}-${testCase.quality}-action.png`);
    await page.screenshot({ path: actionScreenshotPath, fullPage: false });
    return {
        ...testCase,
        restScreenshotPath,
        actionScreenshotPath,
        audit: actionAudit,
        restImage: await imageContract(restScreenshotPath),
        actionImage: await imageContract(actionScreenshotPath),
    };
}

try {
    const results = [];
    for (const testCase of cases) results.push(await inspect(testCase));
    // Vite preview may stream public GLBs without Content-Length, which makes
    // the response event report zero bytes even though Three loaded the model.
    // Re-fetch those exact successful URLs and measure the response body so the
    // coverage gate validates real payloads instead of an optional HTTP header.
    for (const [pathname, asset] of modelAssets) {
        if (asset.status >= 400 || asset.bytes >= 50_000) continue;
        const response = await fetch(new URL(pathname, baseUrl));
        const bytes = (await response.arrayBuffer()).byteLength;
        modelAssets.set(pathname, { status: response.status, bytes });
    }
    const failedVfx = [...vfxAssets.entries()].filter(([, asset]) => asset.status >= 400);
    const failedSetPieces = [...setPieceAssets.entries()].filter(([, asset]) => asset.status >= 400);
    const failedModels = [...modelAssets.entries()].filter(([, asset]) => asset.status >= 400 || asset.bytes < 50_000);
    const travelingElements = ["fire", "water", "wind", "earth"];
    const heroSetPieces = ["tsunami", "firewall", "tornado", "quake", "stormbolt"];
    if (travelingElements.some((key) => !vfxAssets.has(key)) || failedVfx.length) {
        throw new Error(`High-resolution projectile coverage failed: ${JSON.stringify({ assets: [...vfxAssets], failedVfx })}`);
    }
    if (heroSetPieces.some((key) => !setPieceAssets.has(key)) || failedSetPieces.length) {
        throw new Error(`Elemental set-piece coverage failed: ${JSON.stringify({ assets: [...setPieceAssets], failedSetPieces })}`);
    }
    if (modelAssets.size < cases.length + 1 || failedModels.length) throw new Error(`Model asset coverage failed: ${JSON.stringify({ count: modelAssets.size, failedModels })}`);
    if (new Set(results.map((result) => result.audit.fighters[0].profile)).size < 5) throw new Error("Body-profile coverage is incomplete");
    if (!qualityOverride && new Set(results.map((result) => result.quality)).size < 3) throw new Error("Low/medium/high quality coverage is incomplete");
    if (consoleErrors.length || pageErrors.length) throw new Error(`Browser runtime errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
    console.log(JSON.stringify({ ok: true, cases: results, vfxAssets: [...vfxAssets.entries()], setPieceAssets: [...setPieceAssets.entries()], modelAssets: [...modelAssets.entries()] }, null, 2));
} finally {
    await context.close();
    await browser.close();
    if (previewProcess && previewProcess.exitCode === null) {
        const exited = new Promise((resolveExit) => previewProcess.once("exit", resolveExit));
        previewProcess.kill();
        await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 2_000))]);
    }
}
