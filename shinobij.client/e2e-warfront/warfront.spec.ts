import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expectNoLargeOverlap, expectViewportSafe } from "../e2e/helpers/adaptive-assertions";

const warfrontUrl = "/petvfx.html?warfront=1&autobuy=balanced&theme=central";
const acceleratedWarfrontUrl = `${warfrontUrl}&wfspeed=30&petQuality=low`;
const warfrontLoader = (page: Page) => page.getByRole("status").filter({ hasText: "PREPARING WARFRONT" });

test("production Warfront stings are present and browser-decodable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-dpr1", "asset decode runs once");
    await page.goto("/petvfx.html");
    const durations = await page.evaluate(async (paths) => {
        const context = new AudioContext();
        try {
            return await Promise.all(paths.map(async (path) => {
                const response = await fetch(path);
                if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
                const bytes = await response.arrayBuffer();
                return (await context.decodeAudioData(bytes)).duration;
            }));
        } finally {
            await context.close();
        }
    }, [
        "/sfx/production/warfront-sigil-awakening-suno.mp3",
        "/sfx/production/warfront-warden-awakening-suno.mp3",
        "/sfx/production/warfront-objective-steal-suno.mp3",
    ]);
    expect(durations).toHaveLength(3);
    for (const duration of durations) expect(duration).toBeGreaterThan(3);
});

test("Warfront loads, remembers quality, restarts, and reseeds", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-dpr1", "functional lifecycle runs once; DPR coverage has its own test");
    const pageErrors: string[] = [];
    const reactKeyWarnings: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => { if ((message.type() === "warning" || message.type() === "error") && /duplicate key|unique "key"/i.test(message.text())) reactKeyWarnings.push(message.text()); });

    await page.goto(warfrontUrl);
    await expect(warfrontLoader(page)).toBeHidden({ timeout: 30_000 });
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });

    const quality = page.getByLabel("Warfront visual quality");
    await quality.selectOption("low");
    await expect(quality).toHaveValue("low");
    await page.reload();
    await expect(warfrontLoader(page)).toBeHidden({ timeout: 30_000 });
    await expect(page.getByLabel("Warfront visual quality")).toHaveValue("low");

    await page.getByRole("button", { name: /Restart/ }).first().click();
    await expect(page.locator("canvas").first()).toBeVisible();
    await page.getByRole("button", { name: /New match/ }).first().click();
    await expect(page.locator("canvas").first()).toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(reactKeyWarnings).toEqual([]);
});

test("an accelerated QA match reaches a complete post-match result", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "chromium-dpr1", "functional lifecycle runs once; DPR coverage has its own test");
    const pageErrors: string[] = [];
    const reactKeyWarnings: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => { if ((message.type() === "warning" || message.type() === "error") && /duplicate key|unique "key"/i.test(message.text())) reactKeyWarnings.push(message.text()); });
    await page.goto(acceleratedWarfrontUrl);
    await expect(warfrontLoader(page)).toBeHidden({ timeout: 30_000 });
    const takeover = page.getByRole("dialog", { name: "Hollow Warfront match" });
    const tacticalMap = page.getByRole("button", { name: /Warfront tactical map/ });
    await expect(tacticalMap).toBeVisible();
    await tacticalMap.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        element.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    });
    await expect(takeover).toHaveAttribute("data-wf-camera-effective", "free");
    await expect(page.getByText(/Shatters the Ward Seal|Wins the Judgment|Stalemate/).first()).toBeVisible({ timeout: 55_000 });
    await expect(page.getByText(/MVP/).first()).toBeVisible();
    const resultDialog = page.locator('[aria-labelledby="wf-result-title"]');
    const resultTitle = resultDialog.locator("#wf-result-title");
    await expect(resultTitle).toBeFocused();
    const resultButtons = resultDialog.locator("button:not([disabled])");
    await resultButtons.last().focus();
    await page.keyboard.press("Tab");
    await expect(resultButtons.first()).toBeFocused();

    const turningPoint = resultDialog.getByRole("button", { name: /Replay turning point/ }).nth(1);
    await expect(turningPoint).toBeVisible();
    await turningPoint.click();
    await expect.poll(() => takeover.evaluate((element) => ({
        focus: element.getAttribute("data-wf-replay-focus"),
        camera: element.getAttribute("data-wf-camera-effective"),
        chip: !!element.ownerDocument.querySelector(".wf-replay-chip"),
        cameraControlsLocked: Array.from(element.querySelectorAll(".wf-camera-modes button")).every((button) => (button as HTMLButtonElement).disabled),
        skipFocused: element.ownerDocument.activeElement === element.querySelector(".wf-replay-chip button"),
        paceLocked: (() => { const pace = element.querySelector<HTMLSelectElement>('[aria-label="Broadcast pace"]'); return !!pace?.disabled && pace.value === "1"; })(),
    }))).toEqual({ focus: "locked", camera: "story", chip: true, cameraControlsLocked: true, skipFocused: true, paceLocked: true });
    await expect(takeover).toHaveAttribute("data-wf-replay-focus", "off");
    await expect(resultTitle).toBeVisible({ timeout: 10_000 });
    await expect(takeover).toHaveAttribute("data-wf-camera-effective", "free");
    await expect(takeover.locator(".wf-camera-modes button").first()).toBeEnabled();
    await expect(page.getByLabel("Broadcast pace")).toBeEnabled();
    expect(pageErrors).toEqual([]);
    expect(reactKeyWarnings).toEqual([]);
});

test("reduced motion keeps broadcast calls readable and forces predictable 1x pacing", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-dpr1", "canonical reduced-motion broadcast runs once");
    await page.addInitScript(() => {
        localStorage.setItem("wfReducedMotion.v1", "true");
        localStorage.setItem("wfPace.v1", "smart");
    });
    await page.goto(acceleratedWarfrontUrl);
    await expect(warfrontLoader(page)).toBeHidden({ timeout: 30_000 });

    const takeover = page.getByRole("dialog", { name: "Hollow Warfront match" });
    const pace = page.getByLabel("Broadcast pace");
    await expect(takeover).toHaveAttribute("data-wf-motion", "reduced");
    await expect(pace).toHaveValue("1");
    expect(await page.evaluate(() => localStorage.getItem("wfPace.v1"))).toBe("1");
    await pace.selectOption("smart");
    await expect(pace).toHaveValue("1");

    const banner = page.locator(".wf-banner[role='status']").first();
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => banner.evaluate((node) => {
        const style = getComputedStyle(node);
        return { animated: !["", "none"].includes(style.animationName), opacity: Number(style.opacity) };
    }), { timeout: 15_000 }).toEqual({ animated: false, opacity: 1 });
});

test("automatic Councils produce a two-sided readable broadcast recap", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-dpr1", "canonical Council recap runs once");
    await page.goto(`${warfrontUrl}&wfspeed=10&petQuality=low`);
    await expect(warfrontLoader(page)).toBeHidden({ timeout: 30_000 });
    const recaps = page.locator(".wf-council-recap[role='status']").filter({ hasText: /COUNCIL 1/ });
    await expect(recaps.first()).toBeVisible({ timeout: 20_000 });
    await expect(recaps.first()).toContainText(/COUNCIL 1/);
    expect(await recaps.count()).toBeGreaterThanOrEqual(2);
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
    await expect(warfrontLoader(page)).toBeHidden({ timeout: 30_000 });
    await expect(page.locator("canvas").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Restart/ }).first()).toBeEnabled();
    expect(pageErrors).toEqual([]);
    expect(reactKeyWarnings).toEqual([]);
});

test("the WebGL canvas survives a recoverable context-loss cycle", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-dpr1", "functional lifecycle runs once; DPR coverage has its own test");
    await page.goto(`${acceleratedWarfrontUrl}`);
    await expect(warfrontLoader(page)).toBeHidden({ timeout: 30_000 });
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
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${warfrontUrl}&petQuality=high&wfperf=geometry`);
    await expect(warfrontLoader(page)).toBeHidden({ timeout: 30_000 });
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

test("mobile Warfront HUD exposes readable motion, scale, pause, and camera controls without collisions", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-dpr1", "canonical mobile UX runs once");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
        localStorage.removeItem("wfUiScale.v1");
        localStorage.setItem("audioMuted", "1");
        localStorage.setItem("petSfxMuted", "1");
    });
    await page.goto(`${warfrontUrl}&petQuality=low&wfperf=geometry`);
    await expect(warfrontLoader(page)).toBeHidden({ timeout: 30_000 });

    const takeover = page.getByRole("dialog", { name: "Hollow Warfront match" });
    await expect(takeover).toHaveAttribute("data-wf-ui-scale", "large");
    expect(await page.locator(".wf-score-strip").evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(18);
    for (const control of await page.locator(".wf-top-controls button").all()) {
        const box = await control.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const motionBox = await page.getByRole("button", { name: /reduced motion/ }).boundingBox();
    expect(motionBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(motionBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    const audio = page.getByRole("button", { name: /Warfront sound/ });
    await expect(audio).toHaveAttribute("aria-label", "Enable Warfront sound");
    await audio.click();
    await expect(audio).toHaveAttribute("aria-label", "Mute Warfront sound");
    await expect(audio).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => ({ master: localStorage.getItem("audioMuted"), cues: localStorage.getItem("petSfxMuted") }))).toEqual({ master: "0", cues: "0" });

    const reducedMotion = page.getByRole("button", { name: /reduced motion/ });
    const wasReduced = await reducedMotion.getAttribute("aria-pressed") === "true";
    if (!wasReduced) await reducedMotion.click();
    await expect(takeover).toHaveAttribute("data-wf-motion", "reduced");
    await expect(page.getByRole("button", { name: /Calm —/ })).toHaveAttribute("aria-pressed", "true");

    const pause = page.getByRole("button", { name: /Pause battle/ });
    await expect(pause).toBeEnabled({ timeout: 5_000 });
    await pause.click();
    const pausedStatus = page.getByText("BATTLE PAUSED");
    await expect(pausedStatus).toBeVisible();
    const resume = page.getByRole("button", { name: /Resume battle/ });
    await expect(resume).toHaveAttribute("aria-pressed", "true");
    await resume.click();
    await expect(pausedStatus).toBeHidden();
    await expect(page.getByRole("button", { name: /My Team —/ })).toHaveAttribute("aria-pressed", /true|false/);
    const liveFocusable = takeover.locator("button:not([disabled]):visible, select:not([disabled]):visible, a[href]:visible, input:not([disabled]):visible, [tabindex]:not([tabindex='-1']):visible");
    await liveFocusable.last().focus();
    await page.keyboard.press("Tab");
    await expect(liveFocusable.first()).toBeFocused();
    await Promise.all([
        expectNoLargeOverlap(page.locator(".wf-top-controls"), page.locator(".wf-score-strip")),
        expectNoLargeOverlap(page.locator(".wf-score-strip"), page.locator(".wf-objective-strip")),
        expectNoLargeOverlap(page.locator(".wf-objective-strip"), page.locator(".wf-minimap")),
        expectNoLargeOverlap(page.locator(".wf-camera-modes"), page.locator(".wf-minimap")),
        expectNoLargeOverlap(page.locator(".wf-minimap"), page.locator(".wf-top-meta")),
    ]);
    await expectViewportSafe(page, {
        overlays: [".pet-combat-takeover"],
        logicalStages: [".pet-warfront-canvas-stage"],
        documentOverflowAllowance: 2,
    });
});

test("mobile Medium keeps the live story PiP and convoy clear of broadcast controls", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-dpr1", "canonical live Medium layout runs once");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${warfrontUrl}&wfspeed=10&petQuality=medium&wfperf=fixed`);
    await expect(warfrontLoader(page)).toBeHidden({ timeout: 30_000 });

    const storyPip = page.locator(".wf-story-pip");
    const convoy = page.locator(".wf-convoy-follow");
    await expect(storyPip).toBeVisible({ timeout: 30_000 });
    await expect(convoy).toBeVisible({ timeout: 45_000 });
    const pause = page.getByRole("button", { name: /Pause battle/ });
    await pause.click();

    await expect(page.locator(".wf-multicam-wall")).toHaveAttribute("data-wf-pip-count", "1");
    await Promise.all([
        expectNoLargeOverlap(page.locator(".wf-score-strip"), page.locator(".wf-objective-strip")),
        expectNoLargeOverlap(page.locator(".wf-objective-strip"), page.locator(".wf-camera-modes")),
        expectNoLargeOverlap(page.locator(".wf-objective-strip"), page.locator(".wf-minimap")),
        expectNoLargeOverlap(convoy, page.locator(".wf-top-meta")),
        expectNoLargeOverlap(page.locator(".wf-multicam-wall"), page.locator(".wf-top-meta")),
        expectNoLargeOverlap(page.locator(".wf-multicam-wall"), page.locator(".wf-right-stack")),
    ]);
    const feedOverlap = await page.evaluate(() => {
        const meta = document.querySelector(".wf-top-meta")?.getBoundingClientRect();
        if (!meta) return -1;
        return [...document.querySelectorAll<HTMLElement>(".wf-feed-item")].reduce((max, item) => {
            const box = item.getBoundingClientRect();
            if (!box.width || !box.height) return max;
            const width = Math.max(0, Math.min(box.right, meta.right) - Math.max(box.left, meta.left));
            const height = Math.max(0, Math.min(box.bottom, meta.bottom) - Math.max(box.top, meta.top));
            return Math.max(max, width * height);
        }, 0);
    });
    expect(feedOverlap).toBe(0);
    await expectViewportSafe(page, {
        overlays: [".pet-combat-takeover"],
        logicalStages: [".pet-warfront-canvas-stage"],
        documentOverflowAllowance: 2,
    });
});

test("Warfront takeover has no serious automated accessibility violations", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-dpr1", "canonical accessibility scan runs once");
    await page.goto(`${warfrontUrl}&petQuality=low&wfperf=geometry`);
    await expect(warfrontLoader(page)).toBeHidden({ timeout: 30_000 });
    const report = await new AxeBuilder({ page }).include(".pet-warfront-takeover").analyze();
    const serious = report.violations
        .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
        .map((violation) => ({ id: violation.id, impact: violation.impact, targets: violation.nodes.map((node) => node.target) }));
    expect(serious).toEqual([]);
});

test("mobile Coach Council exposes reachable choices without horizontal overflow", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-dpr1", "Council interaction runs once");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/petvfx.html?warfront=1&autobuy=off&wfspeed=30&petQuality=low");
    await expect(warfrontLoader(page)).toBeHidden({ timeout: 30_000 });

    const council = page.getByRole("dialog", { name: /Coach Council/ });
    await expect(council).toBeVisible({ timeout: 20_000 });
    await expect(council.locator("#wf-council-title")).toBeFocused();
    await expect(council.locator("#wf-council-title")).toContainText("round 1");
    await expect(council.getByRole("button", { name: /Hold the Line/ })).toBeVisible();
    await expect(council.getByRole("button", { name: /Blood Hunt/ })).toBeVisible();
    await expect(council.getByRole("button", { name: /Escort Rite/ })).toBeVisible();
    await expect(council.getByRole("button", { name: /Contest/ })).toBeVisible();
    await expect(council.getByRole("button", { name: /Cross-map Trade/ })).toBeVisible();
    await expect(council.getByRole("button", { name: /Ambush/ })).toBeVisible();

    const techniques = council.locator('[aria-label="Special tactics"] > div:first-child button');
    await expect(techniques).toHaveCount(3);
    expect(await techniques.evaluateAll((buttons) => buttons.every((button) => button.getAttribute("aria-pressed") === "false"))).toBe(true);
    await expect(council.getByText("Unlocks after your first structure falls.")).toBeVisible();
    await techniques.first().click();
    await expect(techniques.first()).toHaveAttribute("aria-pressed", "true");
    await expect(council.getByLabel("Formation after Council")).toBeVisible();

    const hold = council.getByRole("button", { name: "Hold timer" });
    await hold.click();
    await expect(council.getByRole("button", { name: "Resume timer" })).toHaveAttribute("aria-pressed", "true");
    const timer = council.locator("#wf-council-help strong");
    await expect(timer).toHaveText("Timer held");
    await page.waitForTimeout(1_100);
    await expect(timer).toHaveText("Timer held");

    const sizing = await council.evaluate((dialog) => ({ clientWidth: dialog.clientWidth, scrollWidth: dialog.scrollWidth }));
    expect(sizing.scrollWidth).toBeLessThanOrEqual(sizing.clientWidth + 1);
    for (const control of await council.locator("button:visible, select:visible").all()) {
        const box = await control.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    await council.getByRole("button", { name: "Commit & resume" }).click();
    await expect(council).toBeHidden();
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
