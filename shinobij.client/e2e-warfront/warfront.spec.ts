import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expectViewportSafe } from "../e2e/helpers/adaptive-assertions";

const warfrontUrl = "/petvfx.html?warfront=1&autobuy=balanced&theme=central";
const acceleratedWarfrontUrl = `${warfrontUrl}&wfspeed=30&petQuality=low`;

test("Warfront loads, remembers quality, restarts, and reseeds", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-dpr1", "functional lifecycle runs once; DPR coverage has its own test");
    const pageErrors: string[] = [];
    const reactKeyWarnings: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => { if ((message.type() === "warning" || message.type() === "error") && /duplicate key|unique "key"/i.test(message.text())) reactKeyWarnings.push(message.text()); });

    await page.goto(warfrontUrl);
    await expect(page.getByRole("status")).toBeHidden({ timeout: 30_000 });
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });

    const quality = page.getByLabel("Warfront visual quality");
    await quality.selectOption("low");
    await expect(quality).toHaveValue("low");
    await page.reload();
    await expect(page.getByRole("status")).toBeHidden({ timeout: 30_000 });
    await expect(page.getByLabel("Warfront visual quality")).toHaveValue("low");

    await page.getByRole("button", { name: /Restart/ }).first().click();
    await expect(page.locator("canvas").first()).toBeVisible();
    await page.getByRole("button", { name: /New match/ }).first().click();
    await expect(page.locator("canvas").first()).toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(reactKeyWarnings).toEqual([]);
});

test("an accelerated QA match reaches a complete post-match result", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-dpr1", "functional lifecycle runs once; DPR coverage has its own test");
    const pageErrors: string[] = [];
    const reactKeyWarnings: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => { if ((message.type() === "warning" || message.type() === "error") && /duplicate key|unique "key"/i.test(message.text())) reactKeyWarnings.push(message.text()); });
    await page.goto(acceleratedWarfrontUrl);
    await expect(page.getByRole("status")).toBeHidden({ timeout: 12_000 });
    await expect(page.getByText(/Shatters the Ward Seal|Wins the Judgment|Stalemate/).first()).toBeVisible({ timeout: 55_000 });
    await expect(page.getByText(/MVP/).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(reactKeyWarnings).toEqual([]);
});

test("a missing hound rig falls back without crashing the match", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-dpr1", "functional lifecycle runs once; DPR coverage has its own test");
    const pageErrors: string[] = [];
    const reactKeyWarnings: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => { if ((message.type() === "warning" || message.type() === "error") && /duplicate key|unique "key"/i.test(message.text())) reactKeyWarnings.push(message.text()); });
    await page.route("**/pet-models/roster/mythic-4.glb*", (route) =>
        route.fulfill({ status: 404, contentType: "application/octet-stream", body: "" }));

    await page.goto(`${acceleratedWarfrontUrl}`);
    await expect(page.getByRole("status")).toBeHidden({ timeout: 12_000 });
    await expect(page.locator("canvas").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Restart/ }).first()).toBeEnabled();
    expect(pageErrors).toEqual([]);
    expect(reactKeyWarnings).toEqual([]);
});

test("the WebGL canvas survives a recoverable context-loss cycle", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-dpr1", "functional lifecycle runs once; DPR coverage has its own test");
    await page.goto(`${acceleratedWarfrontUrl}`);
    await expect(page.getByRole("status")).toBeHidden({ timeout: 12_000 });
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();

    await canvas.evaluate(async (node) => {
        const element = node as HTMLCanvasElement;
        const gl = element.getContext("webgl2") ?? element.getContext("webgl");
        const extension = gl?.getExtension("WEBGL_lose_context");
        if (extension) {
            extension.loseContext();
            await new Promise((resolve) => setTimeout(resolve, 250));
            extension.restoreContext();
            return;
        }
        // Software WebGL runners may omit WEBGL_lose_context; exercise the same
        // canvas lifecycle handlers with the standardized cancelable events.
        element.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 250));
        element.dispatchEvent(new Event("webglcontextrestored"));
    });
    await page.waitForTimeout(900);
    await expect(canvas).toBeVisible();
    await expect(page.getByRole("button", { name: /Restart/ }).first()).toBeEnabled();
});

test("Warfront preserves renderer and overlay alignment across device scale factors", async ({ page }, testInfo) => {
    // SwiftShader/WebGL input dispatch can exceed six minutes at high or
    // fractional DPR on contended CI hosts; the assertions are deterministic
    // once the stage is responsive, so give the real renderer/input path
    // enough headroom without weakening any interaction assertion.
    test.setTimeout(480_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${warfrontUrl}&petQuality=high&wfperf=fixed`);
    await expect(page.getByRole("status")).toBeHidden({ timeout: 30_000 });
    const stage = page.locator(".pet-warfront-canvas-stage");
    const canvas = stage.locator("canvas").first();
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    const metrics = await canvas.evaluate((node) => {
        const element = node as HTMLCanvasElement;
        const box = element.getBoundingClientRect();
        return {
            cssWidth: box.width,
            cssHeight: box.height,
            backingWidth: element.width,
            backingHeight: element.height,
            devicePixelRatio: window.devicePixelRatio,
        };
    });
    const expectedDeviceDpr = Number(testInfo.project.use.deviceScaleFactor ?? 1);
    expect(metrics.devicePixelRatio).toBe(expectedDeviceDpr);
    const expectedRendererDpr = Math.min(expectedDeviceDpr, 1.75);
    expect(metrics.backingWidth / metrics.cssWidth).toBeCloseTo(expectedRendererDpr, 1);
    expect(metrics.backingHeight / metrics.cssHeight).toBeCloseTo(expectedRendererDpr, 1);

    const [stageBox, objectiveBox] = await Promise.all([
        stage.boundingBox(),
        page.locator(".wf-objective-strip").boundingBox(),
    ]);
    expect(stageBox).not.toBeNull();
    expect(objectiveBox).not.toBeNull();
    if (stageBox && objectiveBox) {
        expect(objectiveBox.x).toBeGreaterThanOrEqual(stageBox.x);
        expect(objectiveBox.x + objectiveBox.width).toBeLessThanOrEqual(stageBox.x + stageBox.width);
        expect(objectiveBox.y).toBeGreaterThanOrEqual(stageBox.y);
        expect(objectiveBox.y + objectiveBox.height).toBeLessThanOrEqual(stageBox.y + stageBox.height);
    }

    const findCanvasHitPoint = () => canvas.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        for (const yRatio of [0.72, 0.62, 0.52, 0.82]) {
            for (const xRatio of [0.45, 0.35, 0.55, 0.25, 0.65]) {
                const x = rect.left + rect.width * xRatio;
                const y = rect.top + rect.height * yRatio;
                if (document.elementFromPoint(x, y) === node) return { x, y };
            }
        }
        return null;
    });
    const canvasHitPoint = await findCanvasHitPoint();
    expect(canvasHitPoint, "the rendered canvas must expose a real pointer target outside its DOM overlays").not.toBeNull();
    if (canvasHitPoint) {
        await page.mouse.move(canvasHitPoint.x, canvasHitPoint.y);
        await page.mouse.down();
        await page.mouse.move(canvasHitPoint.x + 24, canvasHitPoint.y + 18, { steps: 4 });
        await page.mouse.up();
        const freeCamera = page.locator(".wf-free-camera");
        await expect(freeCamera).toBeVisible();
        await freeCamera.click();
        await expect(freeCamera).toBeHidden();
        const wheelHitPoint = await findCanvasHitPoint();
        expect(wheelHitPoint, "wheel zoom must begin on a currently hittable canvas point").not.toBeNull();
        if (!wheelHitPoint) throw new Error("Warfront canvas lost every user-hittable wheel target");
        await page.mouse.move(wheelHitPoint.x, wheelHitPoint.y);
        expect(await canvas.evaluate((node, point) => document.elementFromPoint(point.x, point.y) === node, wheelHitPoint),
            "live Warfront overlays must not intercept the sampled wheel point").toBe(true);
        await page.mouse.wheel(0, -120);
        await expect(freeCamera).toBeVisible();
    }

    await expect(canvas).toBeVisible();
    expect(errors).toEqual([]);
});

test("capture fitted pet canvas evidence", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(process.env.ADAPTIVE_CAPTURE !== "1", "visual evidence capture is opt-in");
    test.skip(testInfo.project.name !== "chromium-dpr1", "canonical screenshots use DPR 1; DPR metrics run separately");
    const output = resolve(process.cwd(), "..", ".playwright-mcp", "aaa-adaptive");
    mkdirSync(output, { recursive: true });
    const capture = async (query: string, label: string, viewport: { width: number; height: number }) => {
        await page.setViewportSize(viewport);
        await page.goto(`/petvfx.html?${query}`, { waitUntil: "networkidle" });
        await expect(page.locator(".pet-combat-takeover canvas").first()).toBeVisible({ timeout: 30_000 });
        // The production PetArena host installs this isolation class. The
        // dev-only harness mounts the renderer directly, so mirror that host
        // boundary before measuring document overflow.
        await page.evaluate(() => document.body.classList.add("pet-combat-active"));
        await page.waitForTimeout(1_200);
        await expectViewportSafe(page, {
            overlays: [".pet-combat-takeover"],
            logicalStages: [".pet-warfront-canvas-stage"],
            // Drei's transformed Html labels can add two CSS pixels of rounded
            // scrollWidth while their canvas stage is paint-contained/clipped.
            documentOverflowAllowance: 2,
        });
        await page.screenshot({ path: resolve(output, `after-${label}-${viewport.width}x${viewport.height}.png`), animations: "disabled" });
    };
    await capture("warfront=1&autobuy=balanced&wfspeed=4", "pet-warfront", { width: 1366, height: 768 });
    await capture("warfront=1&autobuy=balanced&wfspeed=4", "pet-warfront", { width: 390, height: 844 });
    await capture("arena4=1", "pet-tactical", { width: 390, height: 844 });
    await capture("board=1", "pet-board", { width: 1366, height: 768 });
});
