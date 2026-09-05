import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5186";
const outputDir = resolve("output", "first-pact-qa");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const findings = [];

async function waitForExteriorArt(page) {
    const canvas = page.locator("canvas.fp-world-canvas");
    await canvas.waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector("canvas.fp-world-canvas")?.getAttribute("data-fp-render-ready") === "true", undefined, { timeout: 60_000 });
    await canvas.evaluate((element) => new Promise((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame(element.getAttribute("data-fp-render-proof"))));
    }));
    const proof = JSON.parse(await canvas.getAttribute("data-fp-render-proof") ?? "{}");
    if (!proof.sources?.architectureAtlas || !proof.sources?.highCourtAnnex || !proof.sources?.propsAtlas || !proof.sources?.colosseum) {
        throw new Error(`decoded exterior-art proof is incomplete: ${JSON.stringify(proof.sources)}`);
    }
}

async function openVariant(name, viewport, check, state = name, reducedMotion = "reduce") {
    const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true, reducedMotion });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const response = await page.goto(`${baseUrl}/firstpactpreview.html?state=${state}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    if (!response?.ok()) throw new Error(`${name}: HTTP ${response?.status() ?? "no response"}`);
    await page.locator(".first-pact-screen").waitFor();
    if (await page.locator("vite-error-overlay, .vite-error-overlay").count()) throw new Error(`${name}: Vite error overlay present`);
    if ((await page.locator("body").innerText()).trim().length < 80) throw new Error(`${name}: page appears blank`);
    await check(page);
    const accessibility = await new AxeBuilder({ page }).analyze();
    const blockingViolations = accessibility.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
    if (blockingViolations.length) {
        throw new Error(`${name}: serious accessibility violations: ${blockingViolations.map((violation) => `${violation.id} (${violation.nodes.map((node) => node.target.join(" ")).join(" | ")})`).join(", ")}`);
    }
    await page.screenshot({ path: resolve(outputDir, `${name}-${viewport.width}x${viewport.height}.png`), fullPage: true });
    if (errors.length) throw new Error(`${name}: console/page errors: ${errors.join(" | ")}`);
    findings.push(`${name} ${viewport.width}x${viewport.height}: pass`);
    await context.close();
}

try {
    await openVariant("world", { width: 1440, height: 900 }, async (page) => {
        await page.locator("canvas.fp-world-canvas").waitFor();
        await waitForExteriorArt(page);
        const painted = await page.locator("canvas.fp-world-canvas").evaluate((canvas) => canvas.toDataURL().length > 10_000);
        if (!painted) throw new Error("world: tile canvas did not paint meaningful pixels");
        await page.screenshot({ path: resolve(outputDir, "world-map-1440x900.png"), fullPage: true });
        await page.keyboard.press("e");
        await page.getByRole("dialog", { name: /Conversation with Scribe Vey/i }).waitFor();
        const portraitLoaded = await page.locator(".fp-dialogue-portrait img").evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0);
        if (!portraitLoaded) throw new Error("world: Scribe Vey portrait did not load");
        await page.screenshot({ path: resolve(outputDir, "world-dialogue-1440x900.png"), fullPage: true });
        while (await page.getByRole("button", { name: "Continue" }).count()) {
            await page.getByRole("button", { name: "Continue" }).click();
        }
        await page.getByRole("button", { name: "Open the unedited chronicle" }).click();
        await page.getByText("What the Animals Know").waitFor();
        await page.getByRole("button", { name: "Chronicle" }).click();
        await page.getByRole("dialog", { name: "First Pact Chronicle" }).waitFor();
        if (await page.locator(".fp-journal article").count() !== 4) throw new Error("world: Chronicle does not expose all four chapters");
        await page.screenshot({ path: resolve(outputDir, "world-chronicle-1440x900.png"), fullPage: true });
    });

    for (const district of ["gardens", "stable", "market", "gateworks", "bell", "aqueduct"]) {
        await openVariant(`city-${district}`, { width: 1440, height: 900 }, async (page) => {
            await page.locator("canvas.fp-world-canvas").waitFor();
            await waitForExteriorArt(page);
            const painted = await page.locator("canvas.fp-world-canvas").evaluate((canvas) => canvas.toDataURL().length > 50_000);
            if (!painted) throw new Error(`${district}: exterior city art did not paint meaningful pixels`);
            const humanoidCount = await page.locator(".fp-player, .fp-npc").count();
            const groundedPinCount = await page.locator(".fp-player > .fp-actor-pin, .fp-npc > .fp-actor-pin").count();
            if (groundedPinCount !== humanoidCount) throw new Error(`${district}: every player/NPC marker must terminate in a grounded pin`);
        }, district);
    }

    await openVariant("tournament", { width: 1440, height: 900 }, async (page) => {
        await waitForExteriorArt(page);
        await page.keyboard.press("e");
        await page.getByRole("dialog", { name: /Conversation with Registrar Orin/i }).waitFor();
        while (await page.getByRole("button", { name: "Continue" }).count()) {
            await page.getByRole("button", { name: "Continue" }).click();
        }
        await page.getByRole("button", { name: "Prepare four-pet squad" }).click();
        await page.getByRole("dialog", { name: "Prepare tournament squad" }).waitFor();
        if (await page.locator(".fp-formation-slot").count() !== 4) throw new Error("tournament: formation does not expose four slots");
        if (await page.locator(".fp-formation-slot.active").count() !== 2 || await page.locator(".fp-formation-slot.reserve").count() !== 2) {
            throw new Error("tournament: expected two active slots and two reserves");
        }
    });

    await openVariant("crossing", { width: 390, height: 844 }, async (page) => {
        await page.getByRole("dialog", { name: "Enter The First Pact" }).waitFor();
        await page.getByRole("button", { name: "Cross into the Sunken Court" }).waitFor();
    });

    await openVariant("locked", { width: 390, height: 844 }, async (page) => {
        await page.getByText("Requires character level 100").waitFor();
    });

    await openVariant("world-mobile", { width: 390, height: 844 }, async (page) => {
        await page.locator("canvas.fp-world-canvas").waitFor();
        if (await page.locator(".fp-dpad button").count() !== 5) throw new Error("world-mobile: five movement controls are not available");
        const worldCanvas = page.locator("canvas.fp-world-canvas");
        const beforeMove = await worldCanvas.screenshot();
        await page.getByRole("button", { name: "Move north" }).focus();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(180);
        const afterMove = await worldCanvas.screenshot();
        if (beforeMove.equals(afterMove)) throw new Error("world-mobile: keyboard activation did not move the camera through the world");
        await page.getByRole("button", { name: "Chronicle" }).click();
        await page.getByRole("dialog", { name: "First Pact Chronicle" }).waitFor();
        await page.getByRole("button", { name: "Close" }).waitFor();
    }, "world");

    await openVariant("world-camera-motion", { width: 900, height: 600 }, async (page) => {
        const worldCanvas = page.locator("canvas.fp-world-canvas");
        await worldCanvas.waitFor();
        await waitForExteriorArt(page);
        const beforeMove = await worldCanvas.screenshot();
        await page.keyboard.press("ArrowUp");
        await page.waitForTimeout(40);
        const duringMove = await worldCanvas.screenshot();
        await page.waitForTimeout(180);
        const afterMove = await worldCanvas.screenshot();
        if (beforeMove.equals(duringMove)) throw new Error("world-camera-motion: camera did not begin moving");
        if (duringMove.equals(afterMove)) throw new Error("world-camera-motion: camera did not reach a distinct settled frame");
    }, "world", "no-preference");

    await openVariant("pact", { width: 1440, height: 900 }, async (page) => {
        await page.keyboard.press("e");
        await page.getByRole("dialog", { name: /Conversation with Sena Vale/i }).waitFor();
        while (await page.getByRole("button", { name: "Continue" }).count()) {
            await page.getByRole("button", { name: "Continue" }).click();
        }
        const choices = page.locator(".fp-dialogue-choices button");
        if (await choices.count() !== 3) throw new Error("pact: expected exactly three player-voiced promises");
        await page.screenshot({ path: resolve(outputDir, "pact-choices-1440x900.png"), fullPage: true });
        await page.getByRole("button", { name: "I tell them why I fight. Trust is theirs to give." }).click();
        await page.getByText("Four Wills, One Answer").waitFor();
    });

    await openVariant("pact-mobile", { width: 390, height: 844 }, async (page) => {
        await page.keyboard.press("e");
        const dialogue = page.getByRole("dialog", { name: /Conversation with Sena Vale/i });
        await dialogue.waitFor();
        while (await page.getByRole("button", { name: "Continue" }).count()) {
            await page.getByRole("button", { name: "Continue" }).click();
        }
        if (await page.locator(".fp-dialogue-choices button").count() !== 3) throw new Error("pact-mobile: promises are missing");
        const box = await dialogue.boundingBox();
        if (!box || box.y < 0 || box.y + box.height > 844) throw new Error("pact-mobile: dialogue choices overflow the viewport");
    });

    await openVariant("final", { width: 1440, height: 900 }, async (page) => {
        await page.keyboard.press("e");
        await page.getByRole("dialog", { name: /Conversation with Registrar Orin/i }).waitFor();
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText(/Court heard your reason and shaped its opening exchange/i).waitFor();
        await page.screenshot({ path: resolve(outputDir, "final-argument-1440x900.png"), fullPage: true });
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByRole("button", { name: "Enter: The First Pact" }).waitFor();
    });

    await openVariant("retry", { width: 390, height: 844 }, async (page) => {
        await page.getByRole("alert").waitFor();
        await page.getByText("The temporal seal lost its place.").waitFor();
        await page.getByRole("button", { name: "Retry crossing" }).click();
        await page.locator("canvas.fp-world-canvas").waitFor();
        await page.getByText("The First Pact").first().waitFor();
    });

    await openVariant("epilogue", { width: 1440, height: 900 }, async (page) => {
        await page.getByRole("button", { name: "Complete the crossing" }).click();
        const ending = page.getByRole("dialog", { name: "The First Pact epilogue" });
        await ending.waitFor();
        await page.getByText("The city does not become a refuge.").waitFor();
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText("History keeps its shape. The proof survives.").waitFor();
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText("Four witnesses cross home with you.").waitFor();
        await page.screenshot({ path: resolve(outputDir, "epilogue-final-1440x900.png"), fullPage: true });
        await page.getByRole("button", { name: "Return to the present" }).click();
        await page.getByText("Chronicle preserved").waitFor();
    });

    await openVariant("epilogue-mobile", { width: 390, height: 844 }, async (page) => {
        await page.getByRole("button", { name: "Complete the crossing" }).click();
        await page.getByRole("dialog", { name: "The First Pact epilogue" }).waitFor();
        await page.getByText("The city does not become a refuge.").waitFor();
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByRole("button", { name: "Return to the present" }).waitFor();
    }, "epilogue");

    await openVariant("epilogue-open-road", { width: 1440, height: 900 }, async (page) => {
        await page.getByRole("button", { name: "Complete the crossing" }).click();
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText(/choosing your road again/i).waitFor();
    });

    await openVariant("epilogue-kept-future", { width: 1440, height: 900 }, async (page) => {
        await page.getByRole("button", { name: "Complete the crossing" }).click();
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText(/Four futures leave the city together/i).waitFor();
    });

    process.stdout.write(`${findings.join("\n")}\nScreenshots: ${outputDir}\n`);
} finally {
    await browser.close();
}
