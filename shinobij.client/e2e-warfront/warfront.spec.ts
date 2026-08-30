import { expect, test } from "@playwright/test";

const warfrontUrl = "/petvfx.html?warfront=1&theme=central&stance=jungle";
const lowWarfrontUrl = `${warfrontUrl}&petQuality=low`;

async function openWarfront(page: import("@playwright/test").Page, url = lowWarfrontUrl) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
}

async function deploy(page: import("@playwright/test").Page) {
    await expect(page.getByRole("heading", { name: "Commit your squad" })).toBeVisible();
    await page.getByRole("button", { name: "Seal deployment" }).click();
    await expect(page.getByText("FIRST TO TWO TOWERS", { exact: true })).toBeVisible();
}

test("deployment communicates the complete three-lane contract and enforces 2–1–1", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once; responsive coverage runs separately");
    await openWarfront(page);
    const deploymentDialog = page.getByRole("dialog", { name: "Commit your squad" });
    await expect(deploymentDialog).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Seal deployment" })).toBeFocused();
    await expect(page.getByText("Three fronts. Two towers. One command.")).toBeVisible();
    await expect(page.getByText("HOLLOW OMEN", { exact: true })).toBeVisible();
    await expect(page.getByText("WARFRONT DIRECTIVE", { exact: true })).toBeVisible();
    await expect(page.getByText("ARENA HAZARD", { exact: true })).toBeVisible();
    await expect(page.getByText("SEALED BATTLE PLAN", { exact: true })).toBeVisible();
    await expect(page.getByText("Crescent 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Hollow 2", { exact: true })).toBeVisible();
    await expect(page.getByText("Ember 1", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("deployment.png"), fullPage: true });

    const emberAssignments = page.getByRole("button", { name: "Ember", exact: true });
    await emberAssignments.nth(0).click();
    await emberAssignments.nth(1).click();
    await expect(page.getByRole("button", { name: "Assign at least one pet to every lane" })).toBeDisabled();
    await page.getByRole("button", { name: "Crescent", exact: true }).nth(0).click();
    await expect(page.getByRole("button", { name: "Seal deployment" })).toBeEnabled();
    await page.getByRole("button", { name: "Seal deployment" }).click();
    await expect(page.getByText("FIRST TO TWO TOWERS", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pause Warfront" })).toBeVisible();
    await expect(page.locator(".wf3-pet").first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: testInfo.outputPath("tactical-board.png"), fullPage: true });
});

test("the two-minute Lane Command supports Hold and one explicit transfer", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once; responsive coverage runs separately");
    await openWarfront(page, `${lowWarfrontUrl}&wfspeed=30`);
    await deploy(page);
    const heading = page.getByRole("heading", { name: /Shift the pressure|Answer the fracture/ });
    await expect(heading).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("dialog", { name: /Shift the pressure|Answer the fracture/ })).toBeFocused();
    await expect(page.getByText(/TWO-MINUTE LANE COMMAND|STORM-GATE COMMAND|SHATTERED-WARD REACTION/)).toBeVisible();
    await expect(page.getByLabel("Warden summon lane")).toBeVisible();
    await expect(page.getByLabel("Authorize a pet signature ultimate")).toBeVisible();
    await expect(page.getByText("SIGNATURE AUTHORIZATION", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Breaker/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sentinel/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Harrier/ })).toBeVisible();
    const petSelect = page.getByLabel("Pet to transfer");
    const destination = page.getByLabel("Destination");
    await petSelect.selectOption({ index: 1 });
    await destination.selectOption("m");
    await page.getByRole("button", { name: "Lock command" }).click();
    await expect(heading).toBeHidden();
});

test("an accelerated battle reaches a scored post-match result", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "lifecycle runs once; responsive coverage runs separately");
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
    await page.route("**/api/perf-beacon", (route) => route.fulfill({ status: 204 }));
    await openWarfront(page, `${lowWarfrontUrl}&wfspeed=30`);
    await deploy(page);

    const result = page.getByRole("dialog", { name: /VICTORY|DEFEAT|STALEMATE/ });
    for (let guard = 0; guard < 12 && !(await result.isVisible().catch(() => false)); guard++) {
        const lock = page.getByRole("button", { name: "Lock command" });
        await expect(lock.or(result)).toBeVisible({ timeout: 20_000 });
        if (await result.isVisible().catch(() => false)) break;
        await lock.click({ timeout: 3_000 }).catch(async (error) => {
            // The match may resolve in the single frame between the visibility
            // check and the click; that is a successful terminal transition.
            if (!(await result.isVisible().catch(() => false))) throw error;
        });
    }
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toBeFocused();
    await expect(result.getByText(/towers/)).toBeVisible();
    await expect(result.getByText("DECISIVE BREAK", { exact: true })).toBeVisible();
    await expect(result.getByText("MOST INFLUENTIAL COMMAND", { exact: true })).toBeVisible();
    await expect(result.getByText("WARFRONT MVP", { exact: true })).toBeVisible();
    await expect(result.getByText("TURNING-POINT TIMELINE", { exact: true })).toBeVisible();
    await result.getByRole("button", { name: "Replay turning point" }).click();
    await expect(result).toBeHidden();
    await expect(result).toBeVisible({ timeout: 20_000 });
    expect(errors).toEqual([]);
});

test("the production 3D renderer loads every battlefield asset and preserves DPR geometry", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("desktop"), "the compact layouts intentionally use the responsive DOM battlefield");
    const errors: string[] = [];
    const failedAssets: string[] = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("response", (response) => {
        if (/\/pet-models\/(?:ward-totem|wf-boulder|wf-lantern|gate-warden-rigged|roster\/)/.test(response.url()) && response.status() >= 400) {
            failedAssets.push(`${response.status()} ${response.url()}`);
        }
    });
    await page.route("**/api/perf-beacon", (route) => route.fulfill({ status: 204 }));
    await openWarfront(page, `${warfrontUrl}&petQuality=high&wfperf=geometry&wfspeed=4`);
    await deploy(page);

    const stage = page.getByRole("img", { name: "Three-dimensional Hollow Warfront battlefield" });
    const canvas = stage.locator("canvas");
    await expect(stage).toHaveAttribute("data-theme", "central");
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await expect(stage).toHaveAttribute("data-scene-ready", "true", { timeout: 30_000 });
    await expect(page.locator(".wf3-worldplate--tower")).toHaveCount(6);
    await expect(page.locator(".wf3-worldplate--fighter")).toHaveCount(8);
    await expect(page.locator(".wf3-pet")).toHaveCount(0);
    // Read every rectangle in one browser-thread snapshot. Repeated Playwright
    // boundingBox calls can starve behind the continuously rendered WebGL scene
    // on software-GPU CI runners even though the DOM is already scene-ready.
    const renderState = await page.locator(".wf3-shell").evaluate((element) => {
        const laneRail = element.querySelector(".wf3-lanes")?.getBoundingClientRect() ?? null;
        const blueTowers = Array.from(element.querySelectorAll(".wf3-worldplate--tower.is-blue"), (tower) => {
            const bounds = tower.getBoundingClientRect();
            return { x: bounds.x, width: bounds.width };
        });
        const sceneCanvas = element.querySelector<HTMLCanvasElement>("canvas");
        const canvasBounds = sceneCanvas?.getBoundingClientRect() ?? null;
        return {
            laneRail: laneRail ? { x: laneRail.x, width: laneRail.width } : null,
            blueTowers,
            impactCount: element.querySelectorAll(".wf3-float-number").length,
            metrics: sceneCanvas && canvasBounds ? {
                cssWidth: canvasBounds.width,
                cssHeight: canvasBounds.height,
                backingWidth: sceneCanvas.width,
                backingHeight: sceneCanvas.height,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                scrollWidth: document.documentElement.scrollWidth,
                scrollHeight: document.documentElement.scrollHeight,
            } : null,
        };
    });
    expect(renderState.laneRail).not.toBeNull();
    expect(renderState.blueTowers).toHaveLength(3);
    for (const bounds of renderState.blueTowers) {
        expect(bounds.x).toBeGreaterThanOrEqual(renderState.laneRail!.x + renderState.laneRail!.width + 2);
    }
    expect(renderState.impactCount, "the 3D battle must surface simulation-driven impact feedback").toBeGreaterThan(0);
    expect(renderState.metrics).not.toBeNull();
    const metrics = renderState.metrics!;
    const deviceDpr = Number(testInfo.project.use.deviceScaleFactor ?? 1);
    const rendererDpr = Math.min(deviceDpr, 1.75);
    expect(metrics.backingWidth / metrics.cssWidth).toBeCloseTo(rendererDpr, 1);
    expect(metrics.backingHeight / metrics.cssHeight).toBeCloseTo(rendererDpr, 1);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 2);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.viewportHeight + 2);
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    if (testInfo.project.name === "desktop") {
        await page.screenshot({ path: testInfo.outputPath("production-3d-warfront.png"), animations: "disabled" });
    }
    expect(failedAssets).toEqual([]);
    expect(errors).toEqual([]);
});

test("deployment and tactical board remain viewport-safe across real device sizes", async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    await page.route("**/api/perf-beacon", (route) => route.fulfill({ status: 204 }));
    await openWarfront(page);
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    const shell = page.locator(".wf3-shell");
    await expect(shell).toBeVisible();
    const bounds = await shell.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
    }));
    expect(bounds.width).toBeLessThanOrEqual(bounds.viewportWidth);
    expect(bounds.height).toBeLessThanOrEqual(bounds.viewportHeight);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.viewportWidth + 2);
    expect(bounds.scrollHeight).toBeLessThanOrEqual(bounds.viewportHeight + 2);
    await page.getByRole("button", { name: "Seal deployment" }).click();
    await expect(page.locator(".wf3-pet").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".wf3-clock")).toBeVisible();
    const towerBounds = await page.locator(".wf3-tower").evaluateAll((towers) => towers.map((tower) => {
        const rect = tower.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }));
    expect(towerBounds).toHaveLength(6);
    for (const tower of towerBounds) {
        expect(tower.left).toBeGreaterThanOrEqual(-1);
        expect(tower.right).toBeLessThanOrEqual(bounds.viewportWidth + 1);
        expect(tower.top).toBeGreaterThanOrEqual(55);
        expect(tower.bottom).toBeLessThanOrEqual(bounds.viewportHeight + 1);
    }
    if (testInfo.project.name === "phone" || testInfo.project.name === "tablet") {
        await expect(page.locator(".wf3-board")).toHaveCSS("background-size", "100% 100%");
        await expect(page.locator(".wf3-board")).toHaveCSS("background-image", /ground-portrait/);
    }
    await page.screenshot({ path: testInfo.outputPath("tactical-viewport.png"), fullPage: true });
    expect(errors).toEqual([]);
});
