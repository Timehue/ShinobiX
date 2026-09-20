import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { installUiAuditRuntime, uiAuditSave, type UiAuditSave } from "./helpers/ui-audit-runtime";
import { expectViewportSafe } from "./helpers/adaptive-assertions";
import { returnToWorldAtlas } from "./helpers/sector-navigation";

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
    // the global Travel navigation to reach the atlas under test.
    await expect.poll(async () => await page.locator(".generated-world-map").count() > 0
        || await page.locator('.sector-hud').isVisible(), { timeout: 45_000 }).toBe(true);
    if (await page.locator(".generated-world-map").count() === 0) {
        await returnToWorldAtlas(page);
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

const mapControls = "button, a, input, select, textarea, [role='button']";
// The whole world packs all 67 pins into a phone's width, so its clearest
// background point sits only 18-28px from a pin on the phone projects. 16px
// still keeps a CDP touch (1px radius) well off every pin's 6px hit ring.
const tapClearance = 16;
type ScreenPoint = { x: number; y: number };

/** The point on the painted map background farthest from every control
 * (sector, landmark, marker), with that distance as its `clearance`, so a
 * double-tap there is a camera gesture and not a press. With
 * `landmarkInWholeWorld`, only points that the whole-world view covers with a
 * landmark count. That view fits the map to the viewport and centres it, and
 * pins counter-scale with the camera, so each pin keeps its screen size and
 * only its centre moves. */
async function clearMapPoint(page: Page, landmarkInWholeWorld: boolean): Promise<(ScreenPoint & { clearance: number }) | null> {
    return page.locator(".world-map-scroll").evaluate((viewport, { controls, landmarkInWholeWorld }) => {
        const edge = 24;
        const stage = viewport as HTMLElement;
        const map = stage.querySelector<HTMLElement>(".generated-world-map")!;
        const frame = stage.getBoundingClientRect();
        const left = frame.left + stage.clientLeft;
        const top = frame.top + stage.clientTop;
        const width = stage.clientWidth;
        const height = stage.clientHeight;
        const targets = [...document.querySelectorAll(controls)].map((control) => control.getBoundingClientRect())
            .filter((rect) => rect.width > 0 && rect.height > 0);
        const clearanceAt = ({ x, y }: { x: number; y: number }) => {
            if (x < left + edge || x > left + width - edge || y < top + edge || y > top + height - edge) return -1;
            const hit = document.elementFromPoint(x, y);
            if (!hit || !map.contains(hit) || hit.closest(controls)) return -1;
            return Math.min(...targets.map((rect) => Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom))));
        };
        const candidates: { x: number; y: number }[] = [];
        if (landmarkInWholeWorld) {
            const painted = map.getBoundingClientRect();
            const camera = new DOMMatrixReadOnly(getComputedStyle(map).transform);
            const zoom = Math.min(1, height / map.offsetHeight);
            const whole = {
                left: painted.left - camera.e + (width - map.offsetWidth * zoom) / 2,
                top: painted.top - camera.f + (height - map.offsetHeight * zoom) / 2,
                width: map.offsetWidth * zoom,
                height: map.offsetHeight * zoom,
            };
            for (const landmark of map.querySelectorAll(".atlas-landmark")) {
                const pin = landmark.getBoundingClientRect();
                const x = whole.left + (pin.left + pin.width / 2 - painted.left) / painted.width * whole.width;
                const y = whole.top + (pin.top + pin.height / 2 - painted.top) / painted.height * whole.height;
                // Stay well inside the pin's predicted box.
                for (const dx of [0, -0.25, 0.25]) for (const dy of [0, -0.25, 0.25]) candidates.push({ x: x + dx * pin.width, y: y + dy * pin.height });
            }
        } else {
            for (let y = top; y <= top + height; y += 4) for (let x = left; x <= left + width; x += 4) candidates.push({ x, y });
        }
        let best: { x: number; y: number; clearance: number } | null = null;
        for (const point of candidates) {
            const clearance = clearanceAt(point);
            if (clearance >= 0 && clearance > (best?.clearance ?? -1)) best = { ...point, clearance };
        }
        return best;
    }, { controls: mapControls, landmarkInWholeWorld });
}

/** The camera zoom, and the zoom of the whole-world view it toggles with; null
 * once the atlas has closed. */
async function mapCamera(page: Page) {
    return page.evaluate(() => {
        const stage = document.querySelector<HTMLElement>(".world-map-scroll");
        const map = stage?.querySelector<HTMLElement>(".generated-world-map");
        if (!stage || !map) return null;
        return { zoom: new DOMMatrixReadOnly(getComputedStyle(map).transform).a, wholeWorld: Math.min(1, stage.clientHeight / map.offsetHeight) };
    });
}

/** Start a fresh record of each tap's click, and of the map content it reached,
 * if any. The window listener runs before React's root listener, so it sees a
 * click the viewport's capture handler swallows. The map sits below that
 * handler, so a swallowed click never reaches it. */
async function recordTapClicks(page: Page) {
    await page.evaluate(() => {
        type TapClick = { detail: number; reached: string | null };
        const scope = window as unknown as { tapClicks?: TapClick[] };
        if (scope.tapClicks) {
            scope.tapClicks.length = 0;
            return;
        }
        const clicks: TapClick[] = [];
        const entries = new WeakMap<Event, TapClick>();
        scope.tapClicks = clicks;
        window.addEventListener("click", (event) => {
            const entry: TapClick = { detail: event.detail, reached: null };
            entries.set(event, entry);
            clicks.push(entry);
        }, true);
        document.querySelector(".generated-world-map")!.addEventListener("click", (event) => {
            const target = event.target as Element;
            const entry = entries.get(event);
            if (entry) entry.reached = [target.tagName.toLowerCase(), ...(target.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)].join(".");
        }, true);
    });
    return () => page.evaluate(() => (window as unknown as { tapClicks: { detail: number; reached: string | null }[] }).tapClicks);
}

/** The map control that holds focus, if any. */
async function focusedMapControl(page: Page) {
    return page.evaluate((controls) => {
        const active = document.activeElement;
        return active?.closest(".generated-world-map") && active.closest(controls) ? active.getAttribute("aria-label") : null;
    }, mapControls);
}

/** A finger's double-tap: two 40ms touches that start 160ms apart. The explicit
 * timestamps become each pointer event's `timeStamp`, which both Chromium's
 * gesture detector and the hook's 320ms window read, so the touches go out back
 * to back and neither a slow CDP round trip nor a long task can stretch the
 * gesture. `lateMs` holds the second tap back in real time, as a long task
 * would, while its timestamps keep the spacing. The schedule is backdated so
 * no timestamp lies in the future. */
async function doubleTap(session: CDPSession, { x, y }: ScreenPoint, lateMs = 0) {
    const start = Date.now() / 1000 - 0.2 - lateMs / 1000;
    for (const at of [0, 0.16]) {
        if (at && lateMs) await new Promise((resolve) => setTimeout(resolve, lateMs));
        await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }], timestamp: start + at });
        await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [], timestamp: start + at + 0.04 });
    }
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

/** A travel sector that the region camera clips at its edge, with a visible
 * point on it that a finger can press. The camera must be able to move toward
 * the clipped side, so a keyboard focus there pans; a marker that sticks out
 * past the painting's own edge cannot be revealed and would prove nothing. */
async function clippedSector(page: Page) {
    return page.locator(".world-map-scroll").evaluate((viewport) => {
        const inset = 4;
        const stage = viewport as HTMLElement;
        const frame = stage.getBoundingClientRect();
        const left = frame.left + stage.clientLeft;
        const top = frame.top + stage.clientTop;
        const right = left + stage.clientWidth;
        const bottom = top + stage.clientHeight;
        const map = stage.querySelector<HTMLElement>(".generated-world-map")!.getBoundingClientRect();
        let best: { label: string; sector: number; x: number; y: number; visible: number } | null = null;
        for (const marker of stage.querySelectorAll<HTMLElement>(".atlas-sector")) {
            const label = marker.getAttribute("aria-label") ?? "";
            const sector = Number(label.match(/^Travel to .*\(Sector (\d+)\)$/)?.[1]);
            if (!sector) continue;
            const box = marker.getBoundingClientRect();
            const clipped = { left: box.left < left, right: box.right > right, top: box.top < top, bottom: box.bottom > bottom };
            if (!Object.values(clipped).some(Boolean)) continue;
            if ((clipped.left && map.left > left - 8) || (clipped.right && map.right < right + 8)
                || (clipped.top && map.top > top - 8) || (clipped.bottom && map.bottom < bottom + 8)) continue;
            const shown = {
                left: Math.max(box.left, left + inset), right: Math.min(box.right, right - inset),
                top: Math.max(box.top, top + inset), bottom: Math.min(box.bottom, bottom - inset),
            };
            if (shown.right - shown.left < 8 || shown.bottom - shown.top < 8) continue;
            const x = (shown.left + shown.right) / 2;
            const y = (shown.top + shown.bottom) / 2;
            const hit = document.elementFromPoint(x, y);
            if (!hit || (hit !== marker && !marker.contains(hit))) continue;
            const visible = (shown.right - shown.left) * (shown.bottom - shown.top);
            if (!best || visible > best.visible) best = { label, sector, x, y, visible };
        }
        return best;
    });
}

/** Select the first region view (Stormveil first) that clips a travel sector,
 * prove that a focus without a pointer would pan the camera to that sector,
 * even straight after a tap on the map, and then restore the region view.
 * Returns the sector and that camera. */
async function openClippedSector(page: Page) {
    const camera = () => page.locator(".generated-world-map").evaluate((map) => getComputedStyle(map).transform);
    let region: typeof regions[number] | null = null;
    let target: Awaited<ReturnType<typeof clippedSector>> = null;
    for (const candidate of ["storm", ...regions.filter((name) => name !== "storm")] as const) {
        await chooseRegion(page, candidate);
        target = await clippedSector(page);
        if (target) { region = candidate; break; }
    }
    expect(target, "some region view must clip a travel sector at the camera edge").not.toBeNull();
    const regionCamera = await camera();
    // Tap the painted background first. Its compatibility mousedown and mouseup
    // reach the map, but there is nothing there to focus, so only the mouseup
    // can end the press they mark. A press left open would swallow the reveal.
    const background = await clearMapPoint(page, false);
    expect(background?.clearance, "a clear background point in the region view").toBeGreaterThanOrEqual(tapClearance);
    const pressLog = await recordPress(page);
    await page.touchscreen.tap(background!.x, background!.y);
    await expect.poll(async () => (await pressLog()).some((entry) => entry.type === "click"), { message: "the background tap clicks" }).toBe(true);
    expect(await camera(), "a single background tap leaves the camera alone").toBe(regionCamera);
    await page.getByRole("button", { name: target!.label, exact: true }).focus();
    expect(await camera(), "focusing the clipped sector without a pointer pans it into view, even right after a tap on the map").not.toBe(regionCamera);
    await chooseRegion(page, region!);
    expect(await camera(), "the region view is restored").toBe(regionCamera);
    expect((await clippedSector(page))?.label, "the same sector is clipped again").toBe(target!.label);
    return { ...target!, region: region!, camera: regionCamera };
}

type PressEvent = { type: string; target: string | null; inMap: boolean; transform: string; scroll: number[] };

/** Start a fresh record of a press's mouse events and focus, with the camera
 * each one saw. The listeners run on window in the capture phase, ahead of the
 * map's own, and look the map up per event because travel remounts it. */
async function recordPress(page: Page) {
    await page.evaluate(() => {
        const scope = window as unknown as { pressLog?: PressEvent[] };
        if (scope.pressLog) {
            scope.pressLog.length = 0;
            return;
        }
        const log: PressEvent[] = [];
        scope.pressLog = log;
        for (const type of ["mousedown", "focus", "mouseup", "click"]) {
            window.addEventListener(type, (event) => {
                const stage = document.querySelector<HTMLElement>(".world-map-scroll");
                const map = stage?.querySelector<HTMLElement>(".generated-world-map");
                const element = event.target instanceof Element ? event.target : null;
                log.push({
                    type,
                    target: element?.getAttribute("aria-label") ?? element?.tagName.toLowerCase() ?? null,
                    inMap: Boolean(stage && element && stage.contains(element)),
                    transform: map ? getComputedStyle(map).transform : "unmounted",
                    scroll: stage ? [stage.scrollLeft, stage.scrollTop] : [],
                });
            }, true);
        }
    });
    return () => page.evaluate(() => (window as unknown as { pressLog: PressEvent[] }).pressLog);
}

/** A point 12px past the map edge nearest to `point`, inside the page and off
 * the map, where a released mouse lands outside the map. */
async function pointOutsideMap(page: Page, point: ScreenPoint) {
    return page.locator(".world-map-scroll").evaluate((viewport, { x, y }) => {
        const r = viewport.getBoundingClientRect();
        return [
            { gap: x - r.left, x: r.left - 12, y },
            { gap: r.right - x, x: r.right + 12, y },
            { gap: y - r.top, x, y: r.top - 12 },
            { gap: r.bottom - y, x, y: r.bottom + 12 },
        ].filter((edge) => edge.x > 1 && edge.x < innerWidth - 1 && edge.y > 1 && edge.y < innerHeight - 1
            && !viewport.contains(document.elementFromPoint(edge.x, edge.y)))
            .sort((a, b) => a.gap - b.gap)[0] ?? null;
    }, point);
}

test("integration: a touch or mouse tap on an edge-clipped sector travels without moving the camera", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("chromium") || !testInfo.project.use.hasTouch || (page.viewportSize()?.width ?? 0) >= 980,
        "Chromium turns CDP touches into taps, and only a phone or tablet map zooms");
    const errors = await bootWorldMap(page);
    const destinations: number[] = [];
    await page.route("**/api/player/travel", async (route) => {
        destinations.push(Number(route.request().postDataJSON().destinationSector));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ arrivalAt: Date.now(), travelMs: 0, arrivalTile: 78 }) });
    });
    const travelled: number[] = [];
    // Keep the input session alive through the whole press: detaching directly
    // after touchEnd can interrupt Chromium's compatibility-event completion.
    const session = await page.context().newCDPSession(page);
    try {
        for (const input of ["touch", "mouse"] as const) {
            if (input === "mouse") {
                await returnToWorldAtlas(page);
                await expect(page.locator(".world-atlas-card")).toBeVisible();
            }
            // Travel makes the first sector the current one, so the mouse
            // presses a different clipped sector.
            const target = await openClippedSector(page);
            const pressLog = await recordPress(page);
            if (input === "touch") {
                // A 40ms finger tap. The explicit timestamps become the pointer
                // events' timeStamps, so neither the CDP round trip nor a long
                // task can stretch it into a long press. They are backdated so
                // that neither lies in the future. The browser sends the
                // compatibility mousedown, which focuses the sector, only after
                // the pointer-up.
                const start = Date.now() / 1000 - 0.04;
                await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: target.x, y: target.y, id: 1 }], timestamp: start });
                await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [], timestamp: start + 0.04 });
            } else {
                await page.mouse.click(target.x, target.y);
            }
            await expect.poll(async () => (await pressLog()).some((entry) => entry.type === "click"), { message: `the ${input} press clicks` }).toBe(true);
            const log = await pressLog();
            await testInfo.attach(`clipped-${input}-press`, { body: JSON.stringify({ target, log }, null, 2), contentType: "application/json" });
            const events = log.filter((entry) => entry.type !== "focus" || entry.target === target.label);
            expect(events.map((entry) => entry.type), `${input}: one press, one focus of the sector, one release and one click`).toEqual(["mousedown", "focus", "mouseup", "click"]);
            expect(events.map((entry) => entry.target), `${input}: every event of the press lands on the sector`).toEqual(Array(4).fill(target.label));
            expect(events.map((entry) => entry.transform), `${input}: the press must not move the camera`).toEqual(Array(4).fill(target.camera));
            expect(events.map((entry) => entry.scroll), `${input}: nor scroll the camera natively`).toEqual(Array(4).fill([0, 0]));
            travelled.push(target.sector);
            await expect.poll(() => destinations, { message: `one ${input} press on a clipped sector travels there` }).toEqual(travelled);
            await expect(page.locator(".world-atlas-card")).toHaveCount(0);
        }
        expect(errors).toEqual([]);
    } finally {
        await session.detach();
    }
});

test("integration: a mouse press released outside the map still lets focus reveal an off-camera sector", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch || (page.viewportSize()?.width ?? 0) >= 980,
        "only a phone or tablet map zooms, and the setup taps the map");
    const errors = await bootWorldMap(page);
    const destinations: number[] = [];
    await page.route("**/api/player/travel", async (route) => {
        destinations.push(Number(route.request().postDataJSON().destinationSector));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ arrivalAt: Date.now(), travelMs: 0, arrivalTile: 78 }) });
    });
    const camera = () => page.locator(".generated-world-map").evaluate((map) => getComputedStyle(map).transform);
    const target = await openClippedSector(page);
    const release = await pointOutsideMap(page, target);
    expect(release, "a point just outside the map, beside the clipped sector").not.toBeNull();
    // Press the sector with a mouse and release it just past the map's edge. The
    // pointer never moves past the tap slop inside the map, so the pan never
    // claims it, and a press on a map control is never captured: nothing in the
    // map receives this pointer-up.
    const pressLog = await recordPress(page);
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.mouse.move(release!.x, release!.y);
    await page.mouse.up();
    await expect.poll(async () => (await pressLog()).some((entry) => entry.type === "mouseup"), { message: "the press is released" }).toBe(true);
    const log = await pressLog();
    await testInfo.attach("released-outside-press", { body: JSON.stringify({ target, release, log }, null, 2), contentType: "application/json" });
    expect(log.filter((entry) => entry.type === "mousedown").map((entry) => [entry.target, entry.inMap]), "the press starts on the sector").toEqual([[target.label, true]]);
    expect(log.filter((entry) => entry.type === "mouseup").map((entry) => entry.inMap), "and ends outside the map").toEqual([false]);
    expect(destinations, "a press released off the sector does not travel").toEqual([]);
    expect(await camera(), "the press itself moves no camera").toBe(target.camera);
    // Chromium and Firefox focused the sector on the press, so blur it first.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const sector = page.getByRole("button", { name: target.label, exact: true });
    await sector.focus();
    expect(await camera(), "after a press released outside the map, a focus without a pointer still pans the sector into view").not.toBe(target.camera);
    // A pointer left behind would also make the next touch press the second
    // finger of a pinch, whose click the map swallows. The focus has brought
    // the sector fully into view, so tap it.
    await sector.tap();
    await expect.poll(() => destinations, { message: "the next touch tap is a tap, not half a pinch, and travels" }).toEqual([target.sector]);
    expect(errors).toEqual([]);
});

test("integration: a press held on a marker while the map leaves zoom mode leaves the next tap working", async ({ page }, testInfo) => {
    test.skip(!phoneProjects.includes(testInfo.project.name), "exercise the zoom-mode boundary in both phone engines");
    const errors = await bootWorldMap(page);
    const destinations: number[] = [];
    await page.route("**/api/player/travel", async (route) => {
        destinations.push(Number(route.request().postDataJSON().destinationSector));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ arrivalAt: Date.now(), travelMs: 0, arrivalTile: 78 }) });
    });
    await chooseRegion(page, "storm");
    const sector = page.getByRole("button", { name: /Travel to Harbor Gates \(Sector 1\)/ });
    const box = (await sector.boundingBox())!;
    // Press the marker with a mouse, cross into the desktop layout, where zoom
    // mode is off and endPointer ignores pointer-ups, and release off the map.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(page.locator("html")).not.toHaveClass(/\bwm-zoom\b/);
    await page.mouse.move(4, 4);
    await page.mouse.up();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("html")).toHaveClass(/\bwm-zoom\b/);
    expect(destinations, "the held press travels nowhere").toEqual([]);
    await chooseRegion(page, "storm");
    // A pointer still tracked from before the boundary would make this touch
    // the second finger of a pinch, whose click the map swallows.
    await sector.tap();
    await expect.poll(() => destinations, { message: "the first touch tap after the boundary travels" }).toEqual([1]);
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

test("integration: a background double-tap moves the camera without pressing what lands under the finger", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("chromium") || !testInfo.project.use.hasTouch || (page.viewportSize()?.width ?? 0) >= 980,
        "Chromium turns CDP touches into taps, and only a phone or tablet map zooms");
    const errors = await bootWorldMap(page);
    const destinations: number[] = [];
    await page.route("**/api/player/travel", async (route) => {
        destinations.push(Number(route.request().postDataJSON().destinationSector));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ arrivalAt: Date.now(), travelMs: 0, arrivalTile: 78 }) });
    });
    await chooseRegion(page, "storm");
    const region = (await mapCamera(page))!;
    expect(region.zoom, "a region view sits above the whole-world zoom").toBeGreaterThan(region.wholeWorld + 0.05);
    const outward = await clearMapPoint(page, true);
    expect(outward?.clearance, "a clear background point that the whole-world view covers with a landmark").toBeGreaterThanOrEqual(tapClearance);
    const atlas = page.locator(".generated-world-map");
    const session = await page.context().newCDPSession(page);
    try {
        // Zoom out. The camera changes on the second tap's pointer-up, and the
        // compatibility mouse events and click Chromium sends for that same tap
        // then land on whatever the whole-world view put under the finger:
        // here, a landmark.
        let tapClicks = await recordTapClicks(page);
        await doubleTap(session, outward!);
        await expect.poll(async () => (await tapClicks()).length, { message: "Chromium synthesizes a click for each tap" }).toBe(2);
        expect((await tapClicks())[1].reached, "the double-tap's own click must not press what the new camera put under the finger").toBeNull();
        expect(await focusedMapControl(page), "the double-tap must not focus what the new camera put under the finger").toBeNull();
        await expect(atlas, "the atlas stays open").toBeVisible();
        const whole = (await mapCamera(page))!;
        expect(whole.zoom, "a double-tap on a region returns to the whole world").toBeCloseTo(whole.wholeWorld, 2);
        await expect(page.locator('.wm-village-chip[data-region="storm"]')).toHaveAttribute("aria-pressed", "false");
        expect(await page.evaluate(({ x, y, controls }) => Boolean(document.elementFromPoint(x, y)?.closest(controls)), { ...outward!, controls: mapControls }),
            "the whole-world view must put a control under the finger, or this double-tap proves nothing").toBe(true);

        // Zoom back in, toward the detail view, with the second tap reaching
        // the page 400ms late: past the 320ms window in real time, but not by
        // its own timestamps. The clearest point lies at the map's edge, where
        // the zoom clamps its pan and can slide a pin under the finger (at
        // 390x844 and 844x390 it does).
        const inward = await clearMapPoint(page, false);
        expect(inward?.clearance, "a clear background point in the whole-world view").toBeGreaterThanOrEqual(tapClearance);
        tapClicks = await recordTapClicks(page);
        await doubleTap(session, inward!, 400);
        await expect.poll(async () => (await tapClicks()).length, { message: "Chromium synthesizes a click for each tap" }).toBe(2);
        expect((await mapCamera(page))?.zoom, "a late double-tap on the whole world still zooms in to detail").toBeCloseTo(2.6, 2);
        expect((await tapClicks())[1].reached, "the zoom-in double-tap's own click must not reach the map either").toBeNull();
        expect(await focusedMapControl(page), "the zoom-in double-tap must not focus a pin either").toBeNull();
        await expect(atlas).toBeVisible();
        expect(destinations, "no double-tap travels").toEqual([]);

        // Keyboard activation still works after the gesture.
        const harbor = page.getByRole("button", { name: /Travel to Harbor Gates \(Sector 1\)/ });
        await harbor.focus();
        await harbor.press("Enter");
        await expect.poll(() => destinations, { message: "keyboard activation after a double-tap" }).toEqual([1]);
        expect(errors).toEqual([]);
    } finally {
        await session.detach();
    }
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
    await returnToWorldAtlas(page);
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
    await returnToWorldAtlas(page);
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

test("region hover feedback keeps its touch target stationary", async ({ page }, testInfo) => {
    test.skip(!phoneProjects.includes(testInfo.project.name), "region controls belong to the mobile atlas");
    const errors = await bootWorldMap(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await chooseRegion(page, "storm");
    await page.mouse.move(0, 0);
    const chip = page.locator('.wm-village-chip[data-region="gate"]');
    const before = await chip.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height, filter: getComputedStyle(element).filter };
    });
    await chip.hover();
    const samples = await chip.evaluate(async (element) => {
        const result = [];
        for (let frame = 0; frame < 12; frame += 1) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            const box = element.getBoundingClientRect();
            result.push({ x: box.x, y: box.y, width: box.width, height: box.height });
        }
        return result;
    });
    for (const sample of samples) {
        expect(sample).toEqual({ x: before.x, y: before.y, width: before.width, height: before.height });
        expect(sample.height).toBeGreaterThanOrEqual(44);
        expect(sample.width).toBeGreaterThanOrEqual(44);
    }
    if (await page.evaluate(() => matchMedia("(hover: hover)").matches)) {
        await expect.poll(() => chip.evaluate((element) => getComputedStyle(element).filter),
            { message: "hover-capable pointers retain visible brightness feedback" }).not.toBe(before.filter);
    } else {
        expect(await chip.evaluate((element) => getComputedStyle(element).filter),
            "touch-only devices retain main's deliberate absence of sticky hover feedback").toBe(before.filter);
    }
    await chip.tap();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await settleCamera(page);
    await expectMapFits(page);
    expect(errors).toEqual([]);
});

test("pinch preserves landmark targets and panning does not rewrite inherited marker scale", async ({ page }, testInfo) => {
    test.skip(!["chromium-390x844", "chromium-mobile"].includes(testInfo.project.name), "real two-finger input through Chromium CDP");
    const errors = await bootWorldMap(page);
    await chooseRegion(page, "storm");
    const map = page.locator(".generated-world-map");
    const session = await page.context().newCDPSession(page);
    const expectTargets = async () => {
        const sizes = await page.locator('button.atlas-landmark[data-landmark-art="true"]').evaluateAll((elements) =>
            elements.map((element) => {
                const rect = element.getBoundingClientRect();
                const base = element as HTMLElement;
                return { label: element.getAttribute("aria-label"), width: rect.width, height: rect.height, baseWidth: base.offsetWidth, baseHeight: base.offsetHeight };
            }));
        expect(sizes.length).toBeGreaterThan(0);
        for (const size of sizes) {
            expect(size.width, `${size.label} width`).toBeGreaterThanOrEqual(44);
            expect(size.height, `${size.label} height`).toBeGreaterThanOrEqual(44);
            // Main intentionally paints 46px targets. Preserve that settled
            // size and the same less-than-one-pixel inverse-bucket allowance.
            expect(size.width, `${size.label} retains its painted width`).toBeGreaterThanOrEqual(size.baseWidth);
            expect(size.height, `${size.label} retains its painted height`).toBeGreaterThanOrEqual(size.baseHeight);
            expect(size.width, `${size.label} remains visually compact`).toBeLessThan(size.baseWidth + 1);
            expect(size.height, `${size.label} remains visually compact`).toBeLessThan(size.baseHeight + 1);
        }
    };
    try {
        for (const viewport of [{ width: 430, height: 932 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(viewport);
            await chooseRegion(page, "storm");
            await expectTargets();
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await chooseRegion(page, "storm");
        const stage = (await page.locator(".world-map-scroll").boundingBox())!;
        const center = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
        const points = (distance: number) => [{ x: center.x - distance, y: center.y, id: 1 }, { x: center.x + distance, y: center.y, id: 2 }];
        const originalTransform = await map.evaluate((element) => element.style.transform);
        await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(40) });
        for (const distance of [44, 48, 52, 48, 44, 40, 36, 32]) {
            await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(distance) });
            await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
            await expectTargets();
        }
        await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        expect(await map.evaluate((element) => element.style.transform), "the gesture must actually zoom").not.toBe(originalTransform);

        await chooseRegion(page, "central");
        await map.evaluate((element) => {
            const style = (element as HTMLElement).style;
            const original = style.setProperty.bind(style);
            const originalRemove = style.removeProperty.bind(style);
            (element as HTMLElement).dataset.markerScaleWrites = "0";
            (element as HTMLElement).dataset.mapVariableWrites = "0";
            style.setProperty = (property, value, priority) => {
                if (property.startsWith("--wm-")) {
                    const target = element as HTMLElement;
                    target.dataset.mapVariableWrites = String(Number(target.dataset.mapVariableWrites) + 1);
                }
                if (property === "--wm-marker-scale") {
                    const target = element as HTMLElement;
                    target.dataset.markerScaleWrites = String(Number(target.dataset.markerScaleWrites) + 1);
                }
                original(property, value, priority);
            };
            style.removeProperty = (property) => {
                if (property.startsWith("--wm-")) {
                    const target = element as HTMLElement;
                    target.dataset.mapVariableWrites = String(Number(target.dataset.mapVariableWrites) + 1);
                }
                return originalRemove(property);
            };
        });
        const beforePan = await map.evaluate((element) => element.style.transform);
        await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...center, id: 1 }] });
        for (let step = 1; step <= 8; step += 1) {
            await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: center.x - step * 5, y: center.y - step * 3, id: 1 }] });
            await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
        }
        await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await expect.poll(() => map.evaluate((element) => element.style.transform)).not.toBe(beforePan);
        await expect(map).toHaveAttribute("data-marker-scale-writes", "0");
        await expect(map).toHaveAttribute("data-map-variable-writes", "0");
        await expectTargets();
        expect(errors).toEqual([]);
    } finally {
        await session.detach();
    }
});

test("animated zoom keeps intermediate landmark targets compact and tappable", async ({ page }, testInfo) => {
    test.skip(!phoneProjects.includes(testInfo.project.name), "animated mobile camera in both phone engines");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const save = uiAuditSave();
    // The lifecycle check returns to Sector 40. Use the same real-character
    // cooldown fixture as adaptive-shell/story-field-work so a roaming bandit
    // cannot open an unrelated Fight/Flee modal over the global Travel action.
    // shared/wanderer-roster.ts pins six-hour buckets and roster indices 0–1;
    // adjacent buckets cover a clock boundary without freezing browser time.
    const now = Date.now();
    const bucket = Math.floor(now / (6 * 60 * 60 * 1000));
    const cooldowns: Record<string, number> = {};
    for (const offset of [-1, 0, 1]) {
        for (const index of [0, 1]) cooldowns[`w-40-${bucket + offset}-${index}`] = now + 30 * 24 * 60 * 60 * 1000;
    }
    save.character = { ...save.character, wandererCooldowns: cooldowns };
    const errors = await bootWorldMap(page, save);
    await chooseRegion(page, "storm");
    const map = page.locator(".generated-world-map");
    // Sample real CSS transition timelines deterministically: WebKit's mobile
    // headless RAF cadence can skip most of a 140ms transition. Both engines
    // still compute the actual browser transforms and hit geometry at each time.
    const evidence = await map.evaluate(async (element) => {
        const viewport = element.closest<HTMLElement>(".world-map-scroll")!;
        const bounds = viewport.getBoundingClientRect();
        const baseSizes = [...element.querySelectorAll<HTMLElement>('button.atlas-landmark[data-landmark-art="true"]')]
            .flatMap((marker) => [marker.offsetWidth, marker.offsetHeight]);
        const sample = () => ({
            zoom: new DOMMatrix(getComputedStyle(element).transform).a,
            sizes: [...element.querySelectorAll('button.atlas-landmark[data-landmark-art="true"]')]
                .flatMap((marker) => { const box = marker.getBoundingClientRect(); return [box.width, box.height]; }),
        });
        const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const wheel = (deltaY: number) => viewport.dispatchEvent(new WheelEvent("wheel", {
            deltaY, bubbles: true, cancelable: true, clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2,
        }));
        const transitions = () => {
            void getComputedStyle(element).transform;
            return element.getAnimations({ subtree: true }).filter((animation) =>
                animation instanceof CSSTransition && animation.transitionProperty === "transform");
        };
        const result = [];
        for (const scenario of [{ action: "wheel out", delta: 100 }, { action: "wheel in", delta: -100 }, { action: "reverse in flight", delta: 100 }]) {
            wheel(scenario.delta);
            let running = transitions();
            for (const animation of running) { animation.pause(); animation.currentTime = 0; }
            let interruptedZoom: number | null = null;
            if (scenario.action === "reverse in flight") {
                for (const animation of running) animation.currentTime = 35;
                await frame();
                interruptedZoom = sample().zoom;
                wheel(-scenario.delta);
                running = transitions();
                for (const animation of running) { animation.pause(); animation.currentTime = 0; }
            }
            const camera = running.find((animation) => (animation.effect as KeyframeEffect)?.target === element);
            const samples = [];
            for (const time of [0, 7, 17, 35, 70, 105, 133, 140]) {
                for (const animation of running) animation.currentTime = time;
                await frame();
                samples.push({ time, ...sample() });
            }
            result.push({ action: scenario.action, duration: camera?.effect?.getTiming().duration, interruptedZoom, baseSizes, samples });
            for (const animation of running) { try { animation.finish(); } catch { /* A completion handler may already cancel a marker transition. */ } }
            await frame();
            await frame();
        }
        return result;
    });
    await testInfo.attach("animated-camera-targets", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
    for (const { action, duration, interruptedZoom, baseSizes, samples } of evidence) {
        expect(duration, `${action} retains the 140ms camera animation`).toBe(140);
        expect(new Set(samples.map((sample) => sample.zoom)).size, `${action} must exercise intermediate camera scales`).toBeGreaterThan(2);
        if (interruptedZoom !== null) expect(Math.abs(samples[0].zoom - interruptedZoom), "reversal starts from the painted camera").toBeLessThan(.00001);
        const startSizes = samples[0].sizes;
        const endSizes = samples.at(-1)!.sizes;
        for (const endpoint of [startSizes, endSizes]) {
            for (let index = 0; index < endpoint.length; index += 1) {
                expect(endpoint[index], "settled camera preserves main's intrinsic target size").toBeGreaterThanOrEqual(baseSizes[index]);
                expect(endpoint[index], "settled inverse bucket adds less than one pixel").toBeLessThan(baseSizes[index] + 1);
            }
        }
        for (const sample of samples) {
            expect(sample.sizes.length).toBeGreaterThan(0);
            for (let index = 0; index < sample.sizes.length; index += 1) {
                const size = sample.sizes[index];
                expect(size, `${action} at camera scale ${sample.zoom} retains its target`).toBeGreaterThanOrEqual(44);
                expect(size, `${action} stays above its settled endpoint band`).toBeGreaterThanOrEqual(Math.min(startSizes[index], endSizes[index]) - .01);
                expect(size, `${action} stays below its settled endpoint band`).toBeLessThanOrEqual(Math.max(startSizes[index], endSizes[index]) + .01);
            }
        }
    }
    await expect.poll(() => map.evaluate((element) => element.style.getPropertyValue("--wm-marker-motion"))).toBe("");
    const pauseZoom = () => map.evaluate((element) => {
        const viewport = element.closest<HTMLElement>(".world-map-scroll")!;
        const box = viewport.getBoundingClientRect();
        viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }));
        void getComputedStyle(element).transform;
        for (const animation of element.getAnimations({ subtree: true })) {
            if (animation instanceof CSSTransition && animation.transitionProperty === "transform") {
                animation.pause(); animation.currentTime = 35;
            }
        }
    });
    await pauseZoom();
    await page.setViewportSize({ width: 1200, height: 800 });
    await expect.poll(() => map.evaluate((element) => element.style.getPropertyValue("--wm-marker-motion")), { message: "desktop deactivation cancels marker motion" }).toBe("");
    await page.setViewportSize({ width: 390, height: 844 });
    await settleCamera(page);
    await pauseZoom();
    const oldMap = (await map.elementHandle())!;
    await page.getByRole("button", { name: /Return to Sector 40$/ }).tap();
    await expect(page.locator(".world-atlas-card")).toHaveCount(0);
    expect(await oldMap.evaluate((element) => element.style.getPropertyValue("--wm-marker-motion")), "unmount clears the old transition").toBe("");
    await returnToWorldAtlas(page);
    await expect(map).toBeVisible();
    await settleCamera(page);
    await expect.poll(() => map.evaluate((element) => element.style.getPropertyValue("--wm-marker-motion")), { message: "old completion cannot clear or retain a new camera transition" }).toBe("");
    await oldMap.dispose();
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
    await returnToWorldAtlas(page);
    await expect(page.locator(".world-atlas-card")).toBeVisible();
    await expect(notifications).toBeHidden();
    await page.setViewportSize({ width: 320, height: 568 });
    await settleCamera(page);
    await expect(notifications).toBeVisible();
    await expectMapFits(page);
    await expect.poll(overlap).toEqual([]);
    expect(errors).toEqual([]);
});

// A touch browser keeps :hover on whatever a tap last hit, so hover styles are
// mouse-only: the pin hovers in atlas-skin.css and 02-world-map.css, and the
// global button:hover in 01-base-app-chrome.css and 08-polish-nav-passes.css.
// A mouse move puts a control under :hover exactly as a tap does, without
// pressing it. The atlas back button has no hover rule of its own, so it shows
// what the global rule alone does.
const HOVER_PAINT = ["filter", "box-shadow", "text-shadow", "transform", "border-top-color", "opacity", "z-index"];
type HoverTarget = "landmark" | "sector" | "back button";
const BACK_BUTTON = ".world-atlas-card .village-back-button";

/** Finds a control of this kind whose centre hits the control itself, and
 *  returns a selector for it and that point. Sectors whose paint is inline
 *  (war-map owner tint) or animated (boss, Death's Gate) would hide a hover
 *  change, so only plain sectors qualify. */
async function exposedTarget(page: Page, kind: HoverTarget, scrollIntoView: boolean) {
    const find = () => page.evaluate(({ kind, scrollIntoView, backButton }) => {
        const candidates = kind === "back button"
            ? [...document.querySelectorAll<HTMLElement>(backButton)]
            : [...document.querySelectorAll<HTMLElement>(`.generated-world-map .atlas-${kind}`)]
                .filter((pin) => pin.getAnimations().length === 0 && !pin.style.boxShadow
                    && !pin.classList.contains("atlas-sector-current") && !pin.classList.contains("atlas-current-location"));
        for (const target of candidates) {
            if (scrollIntoView) target.scrollIntoView({ block: "center", inline: "center" });
            const box = target.getBoundingClientRect();
            const x = box.left + box.width / 2;
            const y = box.top + box.height / 2;
            const hit = document.elementFromPoint(x, y);
            if (hit !== target && !(hit && target.contains(hit))) continue;
            const label = target.getAttribute("aria-label");
            return label
                ? { selector: `.generated-world-map [aria-label="${label}"]`, label, x, y }
                : { selector: backButton, label: target.textContent!.trim(), x, y };
        }
        return null;
    }, { kind, scrollIntoView, backButton: BACK_BUTTON });
    if (kind === "back button" || scrollIntoView || !(await page.locator(".wm-village-chip").count())) return find();
    // The zoomed map shows one region at a time, and not every region has a plain sector in view.
    for (const region of regions) {
        await chooseRegion(page, region);
        const target = await find();
        if (target) return target;
    }
    return null;
}

/** The control's paint and whether it matched :hover, read in one synchronous
 *  snapshot. They must be read together: a hover style that moves a control off
 *  the pointer makes WebKit drop :hover on its next hit test, so a separate
 *  :hover check could pass while the paint was read at rest. */
function hoverPaint(page: Page, selector: string) {
    return page.locator(selector).evaluate(async (target, properties) => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        // Candidates have no animation at rest, so anything running now is a hover transition.
        target.getAnimations().forEach((animation) => animation.finish());
        const style = getComputedStyle(target);
        return {
            hovered: target.matches(":hover"),
            paint: Object.fromEntries(properties.map((property) => [property, style.getPropertyValue(property)])),
        };
    }, HOVER_PAINT);
}

async function hoverTarget(page: Page, kind: HoverTarget, scrollIntoView: boolean) {
    const target = await exposedTarget(page, kind, scrollIntoView);
    expect(target, `a ${kind} with its own hit target must be reachable`).not.toBeNull();
    const rest = await hoverPaint(page, target!.selector);
    expect(rest.hovered, `${target!.label} must start outside :hover`).toBe(false);
    let hovered = rest.paint;
    const samples: Array<{ x: number; y: number; hovered: boolean; paint: typeof rest.paint }> = [];
    try {
        await expect.poll(async () => {
            // Boot layout can re-fit the camera after exposedTarget found the
            // pin. Aim where it is now, as the desktop zoom-hover test does;
            // polling paint at a stale mouse position can never establish hover.
            const box = await page.locator(target!.selector).boundingBox();
            expect(box, `${target!.label} must retain a measurable hit target`).not.toBeNull();
            const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
            await page.mouse.move(point.x, point.y);
            const sample = await hoverPaint(page, target!.selector);
            samples.push({ ...point, ...sample });
            hovered = sample.paint;
            return sample.hovered;
        }, { message: `${target!.label} must be under :hover when it is measured, or this test proves nothing` }).toBe(true);
    } finally {
        writeFileSync(test.info().outputPath(`hover-${kind.replaceAll(" ", "-")}.json`), JSON.stringify({
            label: target!.label, foundAt: { x: target!.x, y: target!.y }, rest, samples,
        }, null, 2));
    }
    await page.mouse.move(0, 0);
    return { label: target!.label, rest: rest.paint, hovered };
}

for (const map of ["zoomed", "scroll"] as const) {
    test(`integration: on the ${map} map a pin a tap left under :hover paints as it did at rest`, async ({ page }, testInfo) => {
        test.skip(!phoneProjects.includes(testInfo.project.name), "touch :hover in both phone engines");
        const errors = await bootWorldMap(page, undefined, map === "scroll"
            ? () => page.addInitScript(() => localStorage.setItem("worldMapZoom.v1", "0"))
            : undefined);
        if (map === "zoomed") await expect(page.locator("html")).toHaveClass(/\bwm-zoom\b/);
        else await expect(page.locator("html")).not.toHaveClass(/\bwm-zoom\b/);
        expect(await page.evaluate(() => matchMedia("(hover: none)").matches), "a phone project must report no hover").toBe(true);
        for (const kind of ["landmark", "sector", "back button"] as const) {
            const { label, rest, hovered } = await hoverTarget(page, kind, map === "scroll");
            expect(hovered, `${label} must not keep hover styling after a tap`).toEqual(rest);
        }
        expect(errors).toEqual([]);
    });
}

test("integration: a desktop mouse still lights the pin it hovers", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "mouse hover on the desktop atlas");
    const errors = await bootWorldMap(page);
    await expect(page.locator("html")).not.toHaveClass(/\bwm-zoom\b/);
    expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(true);
    for (const kind of ["landmark", "sector", "back button"] as const) {
        const { label, rest, hovered } = await hoverTarget(page, kind, true);
        expect(hovered.filter, `${label} hover glow`).not.toBe(rest.filter);
        // A sector's hover border, like the back button's, comes from the global button:hover.
        if (kind !== "landmark") expect(hovered["border-top-color"], `${label} hover border`).not.toBe(rest["border-top-color"]);
    }
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
            // Come to rest before lifting, so this stays a plain pan however
            // light the page is: the steps are frame-paced, so their release
            // speed depends on the page. A release while still moving is
            // covered by "a flick released mid-motion leaves the next tap
            // working". Before the map cancelled its pan's touchmoves, such a
            // release started a hidden Chromium fling, and under Reduce Motion
            // the region tap below was swallowed in about 7 runs of 10.
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

test("a flick released mid-motion leaves the next tap working", async ({ page }, testInfo) => {
    // Chromium starts a fling when a pan ends with the finger still moving, even
    // on this `touch-action: none` map, and the touch-down that stops a fling is
    // never a tap. Unless the map stops that fling from starting, the first
    // region-chip tap after a flick gets its pointerdown but no click.
    test.skip(!testInfo.project.name.startsWith("chromium") || !phoneProjects.includes(testInfo.project.name),
        "drives Chromium's own touch gesture pipeline through CDP");
    const errors = await bootWorldMap(page);
    const destinations: number[] = [];
    await page.route("**/api/player/travel", async (route) => {
        destinations.push(Number(route.request().postDataJSON().destinationSector));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ arrivalAt: Date.now(), travelMs: 0, arrivalTile: 78 }) });
    });
    await chooseRegion(page, "storm");
    const sector = page.getByRole("button", { name: /Travel to Harbor Gates \(Sector 1\)/ });
    await expect(sector).toBeVisible();
    const rect = (await sector.boundingBox())!;
    const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const before = await page.locator(".generated-world-map").evaluate((map) => getComputedStyle(map).transform);
    const session = await page.context().newCDPSession(page);
    try {
        // A finger's timing: six moves 16ms apart, lifted 8ms after the last.
        // Explicit timestamps set the release speed, so it does not depend on
        // the CDP round trip or on how heavy the page is.
        const t0 = Date.now();
        const at = async (ms: number) => {
            const wait = t0 + ms - Date.now();
            if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
            return (t0 + ms) / 1000;
        };
        const sent: Promise<unknown>[] = [session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 1 }], timestamp: await at(0) })];
        for (let step = 1; step <= 6; step += 1) {
            const timestamp = await at(step * 16);
            sent.push(session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x - step * 9, y: start.y - step * 5, id: 1 }], timestamp }));
        }
        sent.push(session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [], timestamp: await at(6 * 16 + 8) }));
        await Promise.all(sent);
        await expect.poll(() => page.locator(".generated-world-map").evaluate((map) => getComputedStyle(map).transform)).not.toBe(before);
        const frost = page.locator('.wm-village-chip[data-region="frost"]');
        await frost.tap();
        await expect(frost, "the first tap after a flick must still activate the region chip").toHaveAttribute("aria-pressed", "true");
        expect(destinations, "a flick originating on a sector must not travel").toEqual([]);
        expect(errors).toEqual([]);
    } finally {
        await session.detach();
    }
});

test("integration: a mouse on the zoomed map lifts a landmark without losing its counter-scale", async ({ page }, testInfo) => {
    // Zoom mode follows the window width alone, so a desktop window of 979px or
    // less has counter-scaled pins AND a mouse. atlas-skin.css's landmark :hover
    // and :active each replaced that counter-scale with a bare scale, which drew
    // the hovered landmark at about 3x its size.
    test.skip(!testInfo.project.name.endsWith("-desktop"), "mouse hover on the zoomed map, in each desktop engine");
    await page.setViewportSize({ width: 800, height: 900 });
    const errors = await bootWorldMap(page);
    await expect(page.locator("html")).toHaveClass(/\bwm-zoom\b/);
    expect(await page.evaluate(() => matchMedia("(hover: hover)").matches), "a desktop project must report a hovering pointer").toBe(true);
    const exposedLandmark = () => page.evaluate(() => {
        for (const pin of document.querySelectorAll<HTMLElement>(".generated-world-map button.atlas-landmark")) {
            const box = pin.getBoundingClientRect();
            const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
            if (hit === pin || (hit && pin.contains(hit))) return pin.getAttribute("aria-label")!;
        }
        return null;
    });
    await settleCamera(page);
    let label = await exposedLandmark();
    for (const region of regions) {
        if (label) break;
        await page.locator(`.wm-village-chip[data-region="${region}"]`).click();
        await settleCamera(page);
        label = await exposedLandmark();
    }
    expect(label, "some region must show a landmark with its own hit target").not.toBeNull();
    const landmark = page.locator(`.generated-world-map button.atlas-landmark[aria-label="${label}"]`);
    // The camera can still re-fit after boot, which moves and rescales every
    // pin. So each sample measures the pin against itself: its on-screen width
    // over the width the current camera zoom and counter-scale give it at rest,
    // which is 1 at rest. It is read in the same snapshot as :hover and :active,
    // because WebKit drops :hover after a style moves a pin off the pointer.
    const sample = () => landmark.evaluate(async (pin) => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        pin.getAnimations().forEach((animation) => animation.finish());
        const map = pin.closest<HTMLElement>(".generated-world-map")!;
        const cameraZoom = map.getBoundingClientRect().width / Number.parseFloat(getComputedStyle(map).width);
        const style = getComputedStyle(pin);
        const restWidth = Number.parseFloat(style.width) * Number.parseFloat(style.getPropertyValue("--wm-marker-scale")) * cameraZoom;
        return {
            hovered: pin.matches(":hover"),
            pressed: pin.matches(":active"),
            scale: pin.getBoundingClientRect().width / restWidth,
            filter: style.filter,
        };
    });
    // Aims at the pin where it is now, not where it was found.
    const pinCentre = async () => {
        const box = (await landmark.boundingBox())!;
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    await page.mouse.move(0, 0);
    const rest = await sample();
    expect(rest.hovered, `${label} must start outside :hover`).toBe(false);
    expect(rest.scale, `${label} at rest is exactly counter-scaled`).toBeCloseTo(1, 2);
    let hovered = rest;
    await expect.poll(async () => {
        const centre = await pinCentre();
        await page.mouse.move(centre.x, centre.y);
        return (hovered = await sample()).hovered;
    }, { message: `${label} must be under :hover when it is measured` }).toBe(true);
    expect(hovered.filter, `${label} still glows under a mouse`).not.toBe(rest.filter);
    expect(hovered.scale, `${label} hover lift, as a share of its on-screen size at rest`).toBeCloseTo(1.12, 2);
    await page.mouse.down();
    let pressed = hovered;
    await expect.poll(async () => (pressed = await sample()).pressed, { message: `${label} must be under :active when it is measured` }).toBe(true);
    expect(pressed.scale, `${label} press, as a share of its on-screen size at rest`).toBeCloseTo(1.04, 2);
    // Drag off before letting go: a pan swallows the click, so the press never enters the village.
    const pressedAt = await pinCentre();
    await page.mouse.move(pressedAt.x + 60, pressedAt.y + 60, { steps: 6 });
    await page.mouse.up();
    expect(errors).toEqual([]);
});
