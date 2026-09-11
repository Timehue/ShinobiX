import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { installUiAuditRuntime, uiAuditSave, type UiAuditSave } from "./helpers/ui-audit-runtime";
import { expectViewportSafe } from "./helpers/adaptive-assertions";

const regions = ["ashen", "gate", "frost", "storm", "central", "moon"] as const;
// The focused source runner and the standard responsive CI use different names
// for the same two phone engines; both must exercise the integration cases.
const phoneProjects = ["chromium-390x844", "webkit-390x844", "chromium-mobile", "webkit-mobile"];
type Footprint = { left: number; top: number; right: number; bottom: number };

async function bootWorldMap(page: Page, initialSave?: UiAuditSave, setup?: () => Promise<void>) {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    await installUiAuditRuntime(page, initialSave);
    // This established roaming character has already heard its level-up
    // rumors; their timed narrative popup would obscure unrelated map targets.
    await page.addInitScript(() => {
        localStorage.setItem("legacyRumors.seen.v1:auditninja", JSON.stringify([10, 20, 30, 40, 45]));
    });
    await setup?.();
    await page.goto("/#/worldMap", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "worldMap", { timeout: 45_000 });
    // A cold dev-server dependency refresh can produce a genuine browser
    // reload. The game correctly reopens the saved sector in that case; use
    // its existing Leave action to reach the atlas under test.
    await expect.poll(async () => await page.locator(".generated-world-map").count() > 0
        || await page.getByRole("button", { name: "Leave", exact: true }).isVisible(), { timeout: 45_000 }).toBe(true);
    if (await page.locator(".generated-world-map").count() === 0) {
        await page.getByRole("button", { name: "Leave", exact: true }).click();
    }
    await expect(page.locator(".generated-world-map")).toBeVisible();
    await expect(page.locator(".atlas-sector")).toHaveCount(67);
    return runtimeErrors;
}

async function settleCamera(page: Page) {
    // Wait for the actual CSS camera animation, including engines where
    // reduced-motion does not remove an inline transition.
    await page.locator(".generated-world-map").evaluate(async (map) => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        await Promise.all(map.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
    });
}

async function chooseRegion(page: Page, region: typeof regions[number]) {
    const button = page.locator(`.wm-village-chip[data-region="${region}"]`);
    await expect(button).toHaveAccessibleName({
        ashen: "Ashen Leaf", gate: "Death's Gate", frost: "Frostfang",
        storm: "Stormveil", central: "Central", moon: "Moonshadow",
    }[region]);
    // Keep mobile region selection in the same input mode as map gestures.
    await button.tap();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await settleCamera(page);
    expect(await page.locator(".generated-world-map").evaluate((map) => getComputedStyle(map).willChange),
        "the settled camera must repaint sharp labels instead of retaining a low-resolution transformed layer").toBe("auto");
    expect(await page.locator(".generated-world-map").evaluate((map) => getComputedStyle(map).filter),
        "mobile WebKit must not flatten map labels through a filtered low-resolution layer").toBe("none");
    const appearance = await page.locator(".wm-village-chip").evaluateAll((buttons) => buttons.map((chip) => {
        const style = getComputedStyle(chip);
        return { selected: chip.getAttribute("aria-pressed") === "true", paint: [style.backgroundImage, style.backgroundColor, style.borderColor] };
    }));
    expect(appearance.find((chip) => chip.selected)?.paint, "the selected region must visibly differ from the other buttons")
        .not.toEqual(appearance.find((chip) => !chip.selected)?.paint);
}

async function expectMapFits(page: Page) {
    const geometry = await page.evaluate(() => {
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft ?? 0;
        const top = viewport?.offsetTop ?? 0;
        const right = left + (viewport?.width ?? innerWidth);
        const bottom = top + (viewport?.height ?? innerHeight);
        const selectors = [".world-atlas-card", ".world-atlas-frame", ".world-map-scroll", ".wm-village-bar", ".wm-village-chip", ".screen-hint-battle-trigger"];
        const outside = selectors.flatMap((selector) => [...document.querySelectorAll(selector)].flatMap((element) => {
            const rect = element.getBoundingClientRect();
            return rect.left < left - 1 || rect.right > right + 1 || rect.top < top - 1 || rect.bottom > bottom + 1
                ? [{ selector, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }]
                : [];
        }));
        const chips = [...document.querySelectorAll<HTMLElement>(".wm-village-chip")].map((button) => {
            const rect = button.getBoundingClientRect();
            return {
                region: button.dataset.region,
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height,
                clippedText: button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1,
            };
        });
        const card = document.querySelector<HTMLElement>(".world-atlas-card")!;
        const frame = document.querySelector<HTMLElement>(".world-atlas-frame")!.getBoundingClientRect();
        const nav = document.querySelector<HTMLElement>(".mobile-bottom-nav")?.getBoundingClientRect();
        const hasFloatingNotice = [...document.querySelectorAll(".mobile-notif-bar, .coach-trail-chip")]
            .some((element) => element.getBoundingClientRect().height > 0);
        const unusedBelowAtlas = innerWidth <= 430 && innerHeight >= 700 && nav?.height && !hasFloatingNotice
            ? nav.top - card.getBoundingClientRect().bottom : null;
        const tip = document.querySelector<HTMLElement>(".screen-hint-battle-trigger")?.getBoundingClientRect();
        const tipOverlaps = tip ? [...document.querySelectorAll(".wm-village-chip, .world-atlas-card .village-back-button")].flatMap((button) => {
            const rect = button.getBoundingClientRect();
            return Math.min(tip.right, rect.right) - Math.max(tip.left, rect.left) > 1
                && Math.min(tip.bottom, rect.bottom) - Math.max(tip.top, rect.top) > 1
                ? [button.textContent] : [];
        }) : [];
        return { outside, chips, tipOverlaps, unusedBelowAtlas, cardScroll: card.scrollHeight - card.clientHeight, frame: { width: frame.width, height: frame.height }, scrollX, scrollY };
    });
    expect(geometry.outside, "the whole map and all region controls must fit the visible screen").toEqual([]);
    expect(geometry.tipOverlaps, "the context tip must not cover navigation controls").toEqual([]);
    expect(geometry.cardScroll, "the atlas card must not require vertical scrolling").toBeLessThanOrEqual(2);
    expect(Math.abs(geometry.scrollX)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.scrollY)).toBeLessThanOrEqual(1);
    expect(geometry.frame.width).toBeGreaterThan(100);
    expect(geometry.frame.height).toBeGreaterThan(100);
    if (geometry.unusedBelowAtlas !== null) {
        expect(geometry.unusedBelowAtlas, "a tall phone must give its available height to the map").toBeLessThanOrEqual(32);
        expect(geometry.unusedBelowAtlas, "region controls must stay above the bottom navigation").toBeGreaterThanOrEqual(0);
    }
    expect(geometry.chips.map((chip) => chip.region)).toEqual(regions);
    for (const chip of geometry.chips) {
        expect(chip.width, `${chip.region} touch target width`).toBeGreaterThanOrEqual(44);
        expect(chip.height, `${chip.region} touch target height`).toBeGreaterThanOrEqual(44);
        expect(chip.clippedText, `${chip.region} label fits`).toBe(false);
    }
    for (const row of [geometry.chips.slice(0, 3), geometry.chips.slice(3)]) {
        expect(Math.max(...row.map((chip) => chip.y)) - Math.min(...row.map((chip) => chip.y))).toBeLessThanOrEqual(2);
    }
    expect(geometry.chips[3].y).toBeGreaterThan(geometry.chips[0].y);
    for (const start of [0, 3]) {
        expect(geometry.chips[start].x).toBeLessThan(geometry.chips[start + 1].x);
        expect(geometry.chips[start + 1].x).toBeLessThan(geometry.chips[start + 2].x);
    }
    await expectViewportSafe(page, { logicalStages: [".world-map-scroll"] });
}

async function cameraCoverage(page: Page) {
    return page.locator(".world-map-scroll").evaluate((viewport) => {
        const frame = viewport.getBoundingClientRect();
        const element = viewport as HTMLElement;
        const left = frame.left + element.clientLeft;
        const top = frame.top + element.clientTop;
        const right = left + element.clientWidth;
        const bottom = top + element.clientHeight;
        const map = viewport.querySelector<HTMLElement>(".generated-world-map")!.getBoundingClientRect();
        // clientWidth/clientHeight are integers, while transformed camera bounds
        // retain fractions; permit a single CSS pixel only at the outer edge.
        const edge = (value: number, size: number) => value < 1 / size ? 0 : value > 1 - 1 / size ? 1 : value;
        const clamp = (value: number) => Math.min(1, Math.max(0, value));
        const fullyVisible: number[] = [];
        const reachable: number[] = [];
        const blocked: { index: number; label: string | null; blockers: string[] }[] = [];
        [...viewport.querySelectorAll<HTMLElement>(".atlas-sector")].forEach((marker, index) => {
            const rect = marker.getBoundingClientRect();
            if (rect.left < left - 1 || rect.right > right + 1 || rect.top < top - 1 || rect.bottom > bottom + 1) return;
            fullyVisible.push(index);
            // A marker must expose a real hit target, not merely appear beneath
            // another sector or decorative landmark.
            const blockers = new Set<string>();
            if ([0.5, 0.15, 0.85].some((fx) => [0.5, 0.15, 0.85].some((fy) => {
                const hit = document.elementFromPoint(rect.left + rect.width * fx, rect.top + rect.height * fy);
                if (hit !== marker && hit && !marker.contains(hit)) blockers.add(hit.closest("button")?.getAttribute("aria-label") ?? hit.className.toString());
                return hit === marker || Boolean(hit && marker.contains(hit));
            }))) reachable.push(index);
            else blocked.push({ index, label: marker.getAttribute("aria-label"), blockers: [...blockers] });
        });
        return {
            footprint: {
                left: edge(clamp((left - map.left) / map.width), map.width),
                right: edge(clamp((right - map.left) / map.width), map.width),
                top: edge(clamp((top - map.top) / map.height), map.height),
                bottom: edge(clamp((bottom - map.top) / map.height), map.height),
            },
            fullyVisible,
            reachable,
            blocked,
        };
    });
}

async function expectDesktopAtlas(page: Page) {
    await expect(page.locator("html")).not.toHaveClass(/\bwm-zoom\b/);
    await expect(page.locator(".wm-village-bar")).toHaveCount(0);
    await expect(page.locator(".wm-zoom-controls")).toHaveCount(0);
    await expect.poll(() => page.locator(".generated-world-map").evaluate((map) => getComputedStyle(map).transform)).toBe("none");
    expect(await page.locator(".generated-world-map").evaluate((map) => getComputedStyle(map).filter),
        "the existing desktop map color treatment remains unchanged").toBe("saturate(1.08) contrast(1.02)");
    await expect(page.locator(".world-atlas-frame")).not.toHaveAttribute("style", /--wm-frame-height/);
    const map = (await page.locator(".generated-world-map").boundingBox())!;
    expect(map.width / map.height).toBeCloseTo(1672 / 941, 2);
    await expectViewportSafe(page, { logicalStages: [".world-map-scroll"] });
}

function uncoveredMapCells(views: Footprint[]) {
    // Partition the painting at every actual camera edge. Testing each cell's
    // midpoint proves the union covers the full artwork, including its coast.
    const xs = [...new Set([0, 1, ...views.flatMap((view) => [view.left, view.right])])].sort((a, b) => a - b);
    const ys = [...new Set([0, 1, ...views.flatMap((view) => [view.top, view.bottom])])].sort((a, b) => a - b);
    const gaps: { x: number; y: number }[] = [];
    for (let xi = 1; xi < xs.length; xi += 1) {
        for (let yi = 1; yi < ys.length; yi += 1) {
            // Ignore only subpixel camera rounding (0.01% of the painting).
            if (xs[xi] - xs[xi - 1] < 0.0001 || ys[yi] - ys[yi - 1] < 0.0001) continue;
            const x = (xs[xi] + xs[xi - 1]) / 2;
            const y = (ys[yi] + ys[yi - 1]) / 2;
            if (!views.some((view) => x >= view.left && x <= view.right && y >= view.top && y <= view.bottom)) gaps.push({ x, y });
        }
    }
    return gaps;
}

test("six spatial region views fit the screen and cover every sector and map edge", async ({ page }, testInfo) => {
    const errors = await bootWorldMap(page);
    if ((page.viewportSize()?.width ?? 0) >= 980) {
        await expectDesktopAtlas(page);
        expect(errors).toEqual([]);
        return;
    }
    await expect(page.locator(".wm-village-chip")).toHaveCount(6);
    await expect(page.locator(".wm-zoom-controls")).toHaveCount(0);
    await expectMapFits(page);
    const views: Footprint[] = [];
    const visible = new Set<number>();
    const reachable = new Set<number>();
    const blocked: { region: string; markers: Awaited<ReturnType<typeof cameraCoverage>>["blocked"] }[] = [];
    for (const region of regions) {
        await chooseRegion(page, region);
        await expectMapFits(page);
        const coverage = await cameraCoverage(page);
        views.push(coverage.footprint);
        coverage.fullyVisible.forEach((index) => visible.add(index));
        coverage.reachable.forEach((index) => reachable.add(index));
        blocked.push({ region, markers: coverage.blocked });
    }
    const coveragePath = testInfo.outputPath("camera-coverage.json");
    writeFileSync(coveragePath, JSON.stringify({ views, visible: [...visible], reachable: [...reachable], blocked }, null, 2));
    await testInfo.attach("camera-coverage", { path: coveragePath, contentType: "application/json" });
    expect(uncoveredMapCells(views), "six presets leave no uncovered artwork").toEqual([]);
    expect(visible.size, "all 67 sector buttons fit fully inside at least one preset").toBe(67);
    expect(reachable.size, "all 67 sectors expose a real touch target in at least one preset").toBe(67);
    await chooseRegion(page, "frost");
    await page.screenshot({ path: testInfo.outputPath("world-map.png") });
    expect(errors).toEqual([]);
});

test("integration: keyboard focusing off-camera sectors preserves region navigation", async ({ page }, testInfo) => {
    test.skip(!phoneProjects.includes(testInfo.project.name), "phone keyboard lifecycle in both engines");
    const errors = await bootWorldMap(page);
    await chooseRegion(page, "frost");
    const viewport = page.locator(".world-map-scroll");
    const scroll = () => viewport.evaluate((stage) => ({ left: stage.scrollLeft, top: stage.scrollTop }));
    const before = await scroll();
    const pin = page.getByRole("button", { name: /Travel to Harbor Gates \(Sector 1\)/ });
    await pin.focus();
    await settleCamera(page);
    const focused = await scroll();
    const focusedInCamera = await pin.evaluate((marker) => {
        const box = marker.getBoundingClientRect();
        const camera = marker.closest(".world-map-scroll")!.getBoundingClientRect();
        return box.left >= camera.left && box.right <= camera.right && box.top >= camera.top && box.bottom <= camera.bottom;
    });
    expect(focused, "keyboard focus must not create native camera scrolling").toEqual({ left: 0, top: 0 });
    expect(focusedInCamera, "the off-camera keyboard destination must be brought fully into view").toBe(true);
    await chooseRegion(page, "frost");
    const restored = await scroll();
    await testInfo.attach("keyboard-camera-scroll", { body: JSON.stringify({ before, focused, restored }), contentType: "application/json" });
    expect(restored, `native scroll after focus ${JSON.stringify(focused)} must not offset a selected region`).toEqual({ left: 0, top: 0 });
    await expectMapFits(page);
    // Exercise the animation race explicitly: the next region updates the
    // camera destination while the old painted frame still shows this sector.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await chooseRegion(page, "storm");
    await page.evaluate(() => {
        document.querySelector<HTMLButtonElement>('.wm-village-chip[data-region="frost"]')!.click();
        document.querySelector<HTMLButtonElement>('.atlas-sector[aria-label="Travel to Harbor Gates (Sector 1)"]')!.focus();
    });
    await settleCamera(page);
    expect(await pin.evaluate((marker) => {
        const box = marker.getBoundingClientRect();
        const camera = marker.closest(".world-map-scroll")!.getBoundingClientRect();
        return box.left >= camera.left && box.right <= camera.right && box.top >= camera.top && box.bottom <= camera.bottom;
    }), "focus during a region animation must keep the destination visible after the animation finishes").toBe(true);
    expect(await scroll()).toEqual({ left: 0, top: 0 });
    expect(errors).toEqual([]);
});

test("integration: a cancelled touch drag permits keyboard sector activation", async ({ page }, testInfo) => {
    test.skip(!["chromium-390x844", "chromium-mobile"].includes(testInfo.project.name), "Chromium dispatches a real touch cancellation through CDP");
    const errors = await bootWorldMap(page);
    const destinations: number[] = [];
    await page.route("**/api/player/travel", async (route) => {
        destinations.push(Number(route.request().postDataJSON().destinationSector));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ arrivalAt: Date.now(), travelMs: 0, arrivalTile: 78 }) });
    });
    await chooseRegion(page, "storm");
    const sector = page.getByRole("button", { name: /Travel to Harbor Gates \(Sector 1\)/ });
    const rect = (await sector.boundingBox())!;
    const session = await page.context().newCDPSession(page);
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 24, y: y - 12, id: 1 }] });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await session.detach();
    expect(destinations).toEqual([]);
    await sector.focus();
    await sector.press("Enter");
    await expect.poll(() => destinations, { message: "keyboard activation must not be swallowed after a cancelled touch drag" }).toEqual([1]);
    expect(errors).toEqual([]);
});

test("integration: sector travel and atlas return restore landscape navigation", async ({ page }, testInfo) => {
    test.skip(!phoneProjects.includes(testInfo.project.name), "exercise screen lifecycle in both phone engines");
    const errors = await bootWorldMap(page);
    const destinations: number[] = [];
    await page.route("**/api/player/travel", async (route) => {
        destinations.push(Number(route.request().postDataJSON().destinationSector));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ arrivalAt: Date.now(), travelMs: 0, arrivalTile: 78 }) });
    });
    await chooseRegion(page, "storm");
    await page.getByRole("button", { name: /Travel to Harbor Gates \(Sector 1\)/ }).tap();
    await expect.poll(() => destinations).toEqual([1]);
    await expect(page.locator(".world-atlas-card")).toHaveCount(0);
    await page.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(page.locator(".world-atlas-card")).toBeVisible();
    await expectMapFits(page);
    await expect(page.getByRole("button", { name: "You are here, Harbor Gates", exact: true })).toHaveCount(1);

    await page.setViewportSize({ width: 568, height: 320 });
    await settleCamera(page);
    await expectMapFits(page);
    await expect(page.locator(".mobile-top-hud")).toBeHidden();
    await expect(page.locator(".mobile-bottom-nav")).toBeHidden();
    await page.getByRole("button", { name: /Return to Sector 1$/ }).tap();
    await expect(page.locator(".world-atlas-card")).toHaveCount(0);
    await expect(page.locator(".mobile-top-hud")).toBeVisible();
    await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
    expect(destinations, "returning to the current sector is local navigation, without another travel request").toEqual([1]);
    await page.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(page.locator(".world-atlas-card")).toBeVisible();
    await chooseRegion(page, "frost");
    await expectMapFits(page);
    await expect(page.locator(".mobile-bottom-nav")).toBeHidden();

    // Leave WorldMap entirely, then re-enter through the real global navigation.
    await page.getByRole("button", { name: /Return to Sector 1$/ }).tap();
    await page.locator(".mobile-bottom-nav").getByRole("button", { name: "Village", exact: true }).click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "village");
    await expect(page.locator("html")).not.toHaveClass(/\bwm-zoom\b/);
    await page.locator(".mobile-bottom-nav").getByRole("button", { name: "Travel", exact: true }).click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "worldMap");
    await expect(page.locator(".world-atlas-card")).toBeVisible();
    await chooseRegion(page, "moon");
    await expectMapFits(page);
    expect(errors).toEqual([]);
});

test("integration: phone desktop phone transitions retain a working camera", async ({ page }, testInfo) => {
    test.skip(!phoneProjects.includes(testInfo.project.name), "exercise live viewport activation in both phone engines");
    await page.addInitScript(() => localStorage.setItem("worldMapZoom.v1", "1"));
    const errors = await bootWorldMap(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "the desktop-width boundary case must still have touch input").toBe(true);
    await chooseRegion(page, "moon");
    await page.setViewportSize({ width: 979, height: 900 });
    await expect(page.locator("html")).toHaveClass(/\bwm-zoom\b/);
    await chooseRegion(page, "frost");
    await expectMapFits(page);
    for (const width of [980, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectDesktopAtlas(page);
    }
    await page.screenshot({ path: testInfo.outputPath("desktop-width-touch-map.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("html")).toHaveClass(/\bwm-zoom\b/);
    await expect(page.locator(".wm-village-chip")).toHaveCount(6);
    await chooseRegion(page, "storm");
    const storm = await page.locator(".generated-world-map").evaluate((map) => getComputedStyle(map).transform);
    await chooseRegion(page, "frost");
    expect(await page.locator(".generated-world-map").evaluate((map) => getComputedStyle(map).transform)).not.toBe(storm);
    await expectMapFits(page);
    await page.screenshot({ path: testInfo.outputPath("after-desktop-return.png") });
    expect(errors).toEqual([]);
});

test("integration: Academy trail focus remains visible and tappable on the smallest phone", async ({ page }, testInfo) => {
    test.skip(!phoneProjects.includes(testInfo.project.name), "exercise Academy handoff in both phone engines");
    await page.setViewportSize({ width: 320, height: 568 });
    const save = uiAuditSave();
    save.currentSector = 0;
    save.character = { ...save.character, onboardingStep: "sectorReturn", academySectorVisited: false, equipment: {} };
    const destinations: number[] = [];
    const errors = await bootWorldMap(page, save, async () => {
        await page.route("**/api/player/travel", async (route) => {
            destinations.push(Number(route.request().postDataJSON().destinationSector));
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ arrivalAt: Date.now(), travelMs: 0, arrivalTile: 78 }) });
        });
    });
    const coach = page.locator(".coach-trail-chip");
    const pin = page.locator(".atlas-sector.academy-click-target");
    await expect(coach).toBeVisible();
    await expect(pin).toHaveCount(1);
    const targetSector = Number((await pin.getAttribute("aria-label"))?.match(/\(Sector (\d+)\)/)?.[1]);
    expect(targetSector).toBeGreaterThan(0);
    const state = () => pin.evaluate((marker) => {
        const viewport = marker.closest<HTMLElement>(".world-map-scroll")!;
        const camera = viewport.getBoundingClientRect();
        const box = marker.getBoundingClientRect();
        const ring = getComputedStyle(marker, "::after");
        const ringInset = ring.display !== "none" && ring.content !== "none" ? Math.max(0, -Number.parseFloat(ring.left || "0")) : 0;
        const targetScale = box.width / (marker as HTMLElement).offsetWidth;
        const banner = document.querySelector<HTMLElement>(".coach-trail-chip-pill")!.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y);
        const overlap = (rect: DOMRect) => rect.left < banner.right && rect.right > banner.left && rect.top < banner.bottom && rect.bottom > banner.top;
        return {
            inCamera: box.left >= camera.left && box.right <= camera.right && box.top >= camera.top && box.bottom <= camera.bottom,
            exposed: hit === marker || Boolean(hit && marker.contains(hit)),
            underCoach: overlap(box),
            coveredControls: [...document.querySelectorAll(".wm-village-chip")].filter((button) => overlap(button.getBoundingClientRect())).map((button) => button.textContent),
            width: box.width + 2 * ringInset * targetScale,
            height: box.height + 2 * ringInset * targetScale,
            scrollLeft: viewport.scrollLeft,
            scrollTop: viewport.scrollTop,
        };
    });
    await expect.poll(async () => (await state()).coveredControls).toEqual([]);
    await expect.poll(async () => (await state()).inCamera).toBe(true);
    await chooseRegion(page, "frost");
    await expect.poll(async () => (await state()).inCamera).toBe(false);
    await page.getByRole("button", { name: "Find the trail", exact: true }).click();
    await settleCamera(page);
    await expect.poll(async () => {
        const result = await state();
        return { inCamera: result.inCamera, exposed: result.exposed, underCoach: result.underCoach, scrollLeft: result.scrollLeft, scrollTop: result.scrollTop };
    }).toEqual({ inCamera: true, exposed: true, underCoach: false, scrollLeft: 0, scrollTop: 0 });
    const target = await state();
    expect(target.width, "the Academy highlighted pin keeps its existing 44px target").toBeGreaterThanOrEqual(43.5);
    expect(target.height).toBeGreaterThanOrEqual(43.5);
    await expectMapFits(page);
    await page.screenshot({ path: testInfo.outputPath("academy-trail.png") });
    await page.setViewportSize({ width: 568, height: 320 });
    await settleCamera(page);
    await page.screenshot({ path: testInfo.outputPath("academy-landscape.png") });
    await expect.poll(async () => (await state()).coveredControls, { message: "the Academy chip must leave landscape region buttons unobstructed" }).toEqual([]);
    await expectMapFits(page);
    await page.getByRole("button", { name: "Find the trail", exact: true }).click();
    await settleCamera(page);
    await expect.poll(async () => (await state()).exposed).toBe(true);
    await page.setViewportSize({ width: 320, height: 568 });
    await settleCamera(page);
    await page.getByRole("button", { name: "Find the trail", exact: true }).click();
    await settleCamera(page);
    await pin.tap();
    await expect.poll(() => destinations).toEqual([targetSector]);
    expect(errors).toEqual([]);
});

test("integration: active notifications fit portrait and restore after landscape atlas exit", async ({ page }, testInfo) => {
    test.skip(!phoneProjects.includes(testInfo.project.name), "exercise active global notifications in both phone engines");
    await page.setViewportSize({ width: 320, height: 568 });
    const errors = await bootWorldMap(page, undefined, async () => {
        await page.route("**/api/game-state", (route) => route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ villageStates: {}, arenaActiveFights: [], arenaTournament: {
                id: "map-layout-tournament", name: "Map layout tournament", createdBy: "AuditNinja",
                startsAt: Date.now() - 60_000, endsAt: Date.now() + 3_600_000, matchDeadline: Date.now() + 3_600_000,
                participants: [], advancedPlayers: [],
            } }),
        }));
    });
    const notifications = page.locator(".mobile-notif-bar");
    await expect(notifications).toBeVisible();
    await expect(notifications).toContainText("Map layout tournament");
    await expectMapFits(page);
    const overlap = () => notifications.evaluate((bar) => {
        const notice = bar.getBoundingClientRect();
        return [...document.querySelectorAll(".world-map-scroll, .wm-village-chip")].filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.left < notice.right && rect.right > notice.left && rect.top < notice.bottom && rect.bottom > notice.top;
        }).map((element) => element.className);
    });
    await expect.poll(overlap, { message: "the notification strip must clear both map and region buttons" }).toEqual([]);
    await page.setViewportSize({ width: 568, height: 320 });
    await settleCamera(page);
    await expect(notifications).toBeHidden();
    await expectMapFits(page);
    await page.getByRole("button", { name: /Return to Sector 40$/ }).tap();
    await expect(page.locator(".world-atlas-card")).toHaveCount(0);
    await expect(notifications).toBeVisible();
    await expect(page.locator(".mobile-top-hud")).toBeVisible();
    await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
    await page.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(page.locator(".world-atlas-card")).toBeVisible();
    await expect(notifications).toBeHidden();
    await page.setViewportSize({ width: 320, height: 568 });
    await settleCamera(page);
    await expect(notifications).toBeVisible();
    await expectMapFits(page);
    await expect.poll(overlap).toEqual([]);
    expect(errors).toEqual([]);
});

test("rotation retains the region and dragging a sector never starts travel", async ({ page }, testInfo) => {
    test.skip(!phoneProjects.includes(testInfo.project.name), "exercise interaction and orientation in both phone engines");
    const errors = await bootWorldMap(page);
    const destinations: number[] = [];
    await page.route("**/api/player/travel", async (route) => {
        destinations.push(Number(route.request().postDataJSON().destinationSector));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ arrivalAt: Date.now(), travelMs: 0, arrivalTile: 78 }) });
    });
    await chooseRegion(page, "storm");
    await page.getByRole("button", { name: "Review World Map tip" }).click();
    const tipDialog = page.getByRole("dialog", { name: "World Map tip" });
    await expect(tipDialog).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await settleCamera(page);
    await expectViewportSafe(page, { logicalStages: [".world-map-scroll"] });
    await tipDialog.getByRole("button", { name: /close/i }).click();
    await expect(tipDialog).toHaveCount(0);
    await expect(page.locator('.wm-village-chip[data-region="storm"]')).toHaveAttribute("aria-pressed", "true");
    await expectMapFits(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await settleCamera(page);
    await expectMapFits(page);
    await chooseRegion(page, "storm");
    const sector = page.getByRole("button", { name: /Travel to Harbor Gates \(Sector 1\)/ });
    await expect(sector).toBeVisible();
    const rect = await sector.boundingBox();
    expect(rect).not.toBeNull();
    const before = await page.locator(".generated-world-map").evaluate((map) => getComputedStyle(map).transform);
    const start = { x: rect!.x + rect!.width / 2, y: rect!.y + rect!.height / 2 };
    // Keep the input session alive through subsequent taps: detaching directly
    // after touchEnd can interrupt Chromium's compatibility-event completion.
    const session = testInfo.project.name.startsWith("chromium") ? await page.context().newCDPSession(page) : null;
    try {
        if (session) {
            await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 1 }] });
            for (let step = 1; step <= 6; step += 1) {
                await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x - step * 9, y: start.y - step * 5, id: 1 }] });
                await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
            }
            // Come to rest before lifting. A touch that leaves while still
            // moving makes Chromium start a fling, and the next tap only stops
            // that fling, so by design it produces no click. These steps are
            // frame-paced, so the release speed depends on how light the page
            // is: under Reduce Motion (the lite presentation) the drag took
            // ~280ms instead of ~500ms, flung, and the region tap below was
            // swallowed in about 7 runs of 10.
            await page.waitForTimeout(200);
            await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x - 54, y: start.y - 30, id: 1 }] });
            await page.waitForTimeout(50);
            await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        } else {
            await page.mouse.move(start.x, start.y);
            await page.mouse.down();
            await page.mouse.move(start.x - 55, start.y - 30, { steps: 6 });
            await page.mouse.up();
        }
        await expect.poll(() => page.locator(".generated-world-map").evaluate((map) => getComputedStyle(map).transform)).not.toBe(before);
        expect(destinations, "a drag originating on a sector must not travel").toEqual([]);
        await chooseRegion(page, "storm");
        await sector.tap();
        await expect.poll(() => destinations).toEqual([1]);
        await expect(page.locator(".world-atlas-card")).toHaveCount(0);
        expect(errors).toEqual([]);
    } finally {
        await session?.detach();
    }
});
