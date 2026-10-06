import { expect, test, type Locator, type Page } from "@playwright/test";
import { STARTER_PETS } from "../src/data/starter-pets";
import { ASCENSION_STONE_ID, AWAKENING_STONE_ID, evolvePet, evolutionLineFor } from "../src/data/pet-evolutions";
import { EVOLUTION_TOTAL_MS } from "../src/lib/pet-evolution-cutscene";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

async function prepare(page: Page) {
    const save = uiAuditSave();
    let pet = { ...STARTER_PETS[0].pet, level: 90, evolutionStage: 0 as const, unlockedForPve: true, happiness: 100 };
    save.character = { ...save.character, unspentStats: 0, statPoints: 0, pets: [pet], activePetId: pet.id, inventory: [AWAKENING_STONE_ID, ASCENSION_STONE_ID] };
    const runtime = await installUiAuditRuntime(page, save);
    let writes = 0;
    await page.route("**/api/pet/evolve", async route => {
        writes++;
        pet = evolvePet(pet, writes === 1 ? 1 : 2, evolutionLineFor(STARTER_PETS[0].pet.id)!) as typeof pet;
        save.character = { ...save.character, pets: [pet], inventory: writes === 1 ? [ASCENSION_STONE_ID] : [] };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(save.character, version);
        await route.fulfill({ json: { pet, _saveVersion: version } });
    });
    await expectUiAuditBoot(page, runtime, "pets");
    await page.getByRole("navigation", { name: "Pet Yard activities" }).getByRole("button", { name: /Growth & training/ }).click();
    const hideMenu = page.getByRole("button", { name: /^Hide menu$/i });
    if (await hideMenu.isVisible()) await hideMenu.click();
    return () => writes;
}

async function evolve(page: Page, manualClock = false) {
    await page.getByRole("button", { name: /Evolve into/ }).click();
    await page.getByRole("alertdialog", { name: "Confirm", exact: true }).getByRole("button", { name: "Confirm", exact: true }).click();
    if (manualClock) {
        await expect.poll(async () => {
            await page.clock.runFor(100);
            return page.locator(".pet-evo-cutscene").isVisible();
        }).toBe(true);
    }
    await expect(page.locator(".pet-evo-cutscene")).toBeVisible();
    await expect(page.locator(".pet-evo-cutscene")).toHaveCSS("opacity", "1");
}

async function hitEvidence(control: Locator) {
    return control.evaluate(node => {
        const r = node.getBoundingClientRect();
        const points = [[.5, .5], [.1, .1], [.9, .1], [.1, .9], [.9, .9]];
        return {
            rect: { x: r.x, y: r.y, width: r.width, height: r.height },
            viewport: { width: innerWidth, height: innerHeight },
            hits: points.map(([x, y]) => {
                const hit = document.elementFromPoint(r.x + r.width * x, r.y + r.height * y);
                return { reachesControl: hit === node || !!hit && node.contains(hit), covering: hit?.outerHTML.slice(0, 220) };
            }),
            ancestors: Array.from((function* () { for (let n: Element | null = node; n; n = n.parentElement) yield n; })()).map(n => {
                const s = getComputedStyle(n);
                return { tag: n.tagName, className: n.className, zIndex: s.zIndex, isolation: s.isolation, contain: s.contain, containerType: s.containerType, transform: s.transform };
            }),
        };
    });
}

async function expectReachable(control: Locator) {
    await expect(control).toBeVisible();
    let evidence: Awaited<ReturnType<typeof hitEvidence>> | undefined;
    await expect.poll(async () => {
        const sample = await hitEvidence(control);
        if (!sample.hits.every(h => h.reachesControl)) return false;
        evidence = sample;
        return true;
    }, { timeout: 5000 }).toBe(true);
    // Geometry and hit testing must describe the same frame: a natural reveal
    // can replace Skip with Continue between separate browser evaluations.
    expectHitGeometry(evidence!);
    const { rect: r, viewport: v } = evidence!;
    if (v.height <= 520 && await control.evaluate(n => n.classList.contains("pet-evo-continue"))) {
        const caption = await control.page().locator(".pet-evo-name-new").boundingBox();
        expect(caption!.y + caption!.height).toBeLessThanOrEqual(r.y);
    }
}

type ControlSample = Pick<Awaited<ReturnType<typeof hitEvidence>>, "rect" | "viewport" | "hits"> & { elapsedMs: number };
type EvolutionProbe = { initial?: ControlSample | null; morph?: ControlSample | null; complete?: ControlSample | null };

function expectHitGeometry(evidence: Pick<ControlSample, "rect" | "viewport" | "hits">) {
    expect(evidence.hits.every(hit => hit.reachesControl)).toBe(true);
    const { rect: r, viewport: v } = evidence;
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(v.width);
    expect(r.y + r.height).toBeLessThanOrEqual(v.height);
    expect(r.width).toBeGreaterThanOrEqual(48);
    expect(r.height).toBeGreaterThanOrEqual(48);
}

async function observeNaturalEvolution(page: Page) {
    await page.evaluate(() => {
        const probe: EvolutionProbe = {};
        (window as Window & { __petEvolutionControlProbe?: EvolutionProbe }).__petEvolutionControlProbe = probe;
        let startedAt: number | undefined;
        const sample = (selector: string, elapsedMs: number): ControlSample | null => {
            const node = document.querySelector(selector);
            if (!node) return null;
            const r = node.getBoundingClientRect();
            return {
                elapsedMs,
                rect: { x: r.x, y: r.y, width: r.width, height: r.height },
                viewport: { width: innerWidth, height: innerHeight },
                hits: [[.5, .5], [.1, .1], [.9, .1], [.1, .9], [.9, .9]].map(([x, y]) => {
                    const hit = document.elementFromPoint(r.x + r.width * x, r.y + r.height * y);
                    return { reachesControl: hit === node || !!hit && node.contains(hit), covering: hit?.outerHTML.slice(0, 220) };
                }),
            };
        };
        const tick = (timestamp: number) => {
            if (document.querySelector(".pet-evo-cutscene")) startedAt ??= timestamp;
            if (startedAt !== undefined) {
                const elapsedMs = timestamp - startedAt;
                if (probe.initial === undefined && elapsedMs >= 400) probe.initial = sample(".pet-evo-skip", elapsedMs);
                if (probe.morph === undefined && elapsedMs >= 3000) probe.morph = sample(".pet-evo-skip", elapsedMs);
                if (document.querySelector(".pet-evo-continue")) {
                    probe.complete = sample(".pet-evo-continue", elapsedMs);
                    return;
                }
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
}

test("evolution controls receive real pointer hits after scrolling, resizing and repeated reveals", async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const clockStart = Date.now();
    await page.clock.install({ time: clockStart });
    const writes = await prepare(page);
    // Hold the layout phase while taking screenshots and rotating the viewport.
    // The separate timeline test still lets all 8.7 seconds elapse naturally.
    await page.clock.pauseAt(clockStart + 120_000);
    const original = page.viewportSize()!;
    await page.locator(".center-game").evaluate(n => { n.scrollTop = 250; });
    await evolve(page, true);
    const skip = page.locator(".pet-evo-skip");
    await expect(skip).toBeVisible();
    await page.screenshot({ path: info.outputPath("skip.png") });
    await info.attach("skip-hit-evidence", { body: JSON.stringify(await hitEvidence(skip), null, 2), contentType: "application/json" });
    await expectReachable(skip);
    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
    await page.setViewportSize({ width: original.height, height: original.width });
    await expectReachable(skip);
    await page.setViewportSize(original);
    await expectReachable(skip);
    if (info.project.use.hasTouch) await skip.tap();
    else await skip.click();
    const proceed = page.locator(".pet-evo-continue");
    await expectReachable(proceed);
    await expect(proceed).toBeFocused();
    // Playwright's mobile WebKit has no wheel input. Check its scroll lock
    // and viewport anchoring; Chromium and desktop engines also send a wheel.
    await expect(page.locator("body")).toHaveClass(/ui-scroll-locked/);
    if (info.project.use.browserName === "webkit" && info.project.use.isMobile) {
        await page.evaluate(() => window.scrollBy(0, 350));
    } else await page.mouse.wheel(0, 350);
    await expectReachable(proceed);
    await page.screenshot({ path: info.outputPath("continue.png") });
    if (info.project.use.hasTouch) await proceed.tap();
    else await proceed.click();
    await expect(page.locator(".pet-evo-cutscene")).toHaveCount(0);
    await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
    await expect(page.getByRole("heading", { name: "Growth & training" })).toBeVisible();
    await evolve(page, true);
    await expectReachable(skip);
    await skip.focus();
    await skip.press("Enter");
    await expectReachable(proceed);
    await proceed.focus();
    await proceed.press("Enter");
    await expect(page.locator(".pet-evo-cutscene")).toHaveCount(0);
    expect(writes()).toBe(2);
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "pets");
});

test("the complete evolution timeline and reduced motion retain a reachable Continue", async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const writes = await prepare(page);
    // Sample live frames in the browser. A slow screenshot/protocol round trip
    // must not try to query a Skip button after the natural reveal replaces it.
    await observeNaturalEvolution(page);
    await evolve(page);
    await expect(page.locator(".pet-evo-continue")).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => page.evaluate(() =>
        (window as Window & { __petEvolutionControlProbe?: EvolutionProbe }).__petEvolutionControlProbe?.complete ?? null
    )).not.toBeNull();
    const observations = await page.evaluate(() =>
        (window as Window & { __petEvolutionControlProbe?: EvolutionProbe }).__petEvolutionControlProbe!
    );
    await info.attach("natural-timeline-control-samples", { body: JSON.stringify(observations, null, 2), contentType: "application/json" });
    for (const phase of ["initial", "morph", "complete"] as const) {
        expect(observations[phase], `${phase} must have a live control`).toBeTruthy();
        expectHitGeometry(observations[phase]!);
    }
    expect(observations.initial!.elapsedMs).toBeGreaterThanOrEqual(400);
    expect(observations.morph!.elapsedMs).toBeGreaterThanOrEqual(3000);
    expect(observations.complete!.elapsedMs).toBeGreaterThanOrEqual(EVOLUTION_TOTAL_MS - 100);
    const proceed = page.locator(".pet-evo-continue");
    await expectReachable(proceed);
    await page.screenshot({ path: info.outputPath("timeline-complete.png") });
    if (info.project.use.hasTouch) await proceed.tap();
    else await proceed.click();
    await expect(page.locator(".pet-evo-cutscene")).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await evolve(page);
    await expect(page.locator(".pet-evo-skip")).toHaveCount(0);
    await expectReachable(proceed);
    if (info.project.use.hasTouch) await proceed.tap();
    else await proceed.click();
    await expect(page.locator(".pet-evo-cutscene")).toHaveCount(0);
    expect(writes()).toBe(2);
});

test("nonzero phone safe areas keep both controls clear in portrait and landscape", async ({ page }, info) => {
    test.skip(!["chromium-390", "chromium-mobile", "chrome-native-phone"].includes(info.project.name), "CDP safe-area emulation in bundled and installed Chrome");
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const clockStart = Date.now();
    await page.clock.install({ time: clockStart });
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 34, right: 24, bottom: 34, left: 24 } });
    await prepare(page);
    await page.clock.pauseAt(clockStart + 120_000);
    await evolve(page, true);
    const skip = page.locator(".pet-evo-skip");
    await expectReachable(skip);
    expect((await skip.boundingBox())!.y).toBe(50);
    expect((await skip.boundingBox())!.x + (await skip.boundingBox())!.width).toBeLessThanOrEqual(350);
    await page.setViewportSize({ width: 844, height: 390 });
    await session.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, right: 44, bottom: 21, left: 44 } });
    await expectReachable(skip);
    expect((await skip.boundingBox())!.x + (await skip.boundingBox())!.width).toBeLessThanOrEqual(784);
    await page.screenshot({ path: info.outputPath("safe-area-skip.png") });
    await skip.tap();
    const proceed = page.locator(".pet-evo-continue");
    await expectReachable(proceed);
    const box = (await proceed.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(353);
    await page.screenshot({ path: info.outputPath("safe-area-continue.png") });
    await proceed.tap();
    await expect(page.locator(".pet-evo-cutscene")).toHaveCount(0);
});
