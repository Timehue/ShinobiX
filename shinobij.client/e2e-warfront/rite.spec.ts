/*
 * Hollow Warfront — the Rite. End-to-end coverage of the autobattler.
 *
 * These pin what the mode's identity depends on: the player freely deploys all
 * four pets across ten cells, scouts two enemy positions, and watches eight
 * readable 3D fighters resolve cover, sight, range, and role decisions.
 */
import { expect, test } from "@playwright/test";

const riteUrl = "/petvfx.html?rite=1&petQuality=low";

async function openRite(page: import("@playwright/test").Page, url = riteUrl) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Set your formation" })).toBeVisible({ timeout: 30_000 });
}

test("deployment exposes ten unrestricted cells and only two enemy positions", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once; responsive coverage runs separately");
    await openRite(page);

    await expect(page.getByText(/Deploy all four pets on any open cells/)).toBeVisible();

    // Two positions are scouted while the other two stay sealed, so deployment
    // is an informed read rather than a solved matchup.
    const scout = page.getByRole("region", { name: "Enemy revealed deployment" });
    await expect(scout).toBeVisible();
    await expect(scout.getByText(/other two placements stay sealed/)).toBeVisible();

    await expect(page.getByLabel("Choose a pet to place").locator("button")).toHaveCount(4);
    await expect(page.getByLabel("Your deployment grid").locator("button")).toHaveCount(10);
});

test("any pet can move to any open deployment mark", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    await openRite(page);
    const picker = page.getByLabel("Choose a pet to place").locator("button");
    const chosenName = (await picker.nth(2).locator("strong").textContent()) ?? "";
    await picker.nth(2).click();
    await page.getByRole("button", { name: new RegExp(`Place ${chosenName} at North rear`) }).click();
    await expect(picker.nth(2)).toContainText(/North rear/i);
});

test("an occupied cell swaps the two pets without benching either", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    await openRite(page);
    const picker = page.getByLabel("Choose a pet to place").locator("button");
    await picker.nth(0).click();
    await page.getByRole("button", { name: /Center rear occupied by .*tap to swap/i }).click();
    await expect(picker.nth(0)).toContainText(/Center rear/i);
    await expect(picker.nth(1)).toContainText(/North forward/i);
});

test("eight active fighters are readable with the clash score", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    await openRite(page);
    await page.getByRole("button", { name: "Lock formation" }).click();

    // Four active pets per side, with no reserve hidden outside the fight.
    await expect(page.getByRole("list", { name: "Your band" }).getByRole("listitem")).toHaveCount(4);
    await expect(page.getByRole("list", { name: "Their band" }).getByRole("listitem")).toHaveCount(4);
    await expect(page.locator(".wfr-bar-fill")).toHaveCount(8);
    await expect(page.locator(".wfr-roster .is-reserve")).toHaveCount(0);

    // The clash is numbered and the best-of-three score is shown. Scoped to the
    // HUD: the opening card carries the same "CLASH n" text, so an unscoped
    // match is a strict-mode collision rather than a real assertion.
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText(/^KAGE TACTICS \d+$/, { timeout: 20_000 });
    await expect(page.getByLabel("Clashes won")).toBeVisible();

    // The 3D stage is actually mounted — this mode exists to show the models.
    await expect(page.locator(".wfr-canvas canvas")).toBeVisible({ timeout: 30_000 });
});

test("playback advances and the fighters actually take damage", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    // CI has no GPU. The software renderer draws this eight-rig scene at a small
    // fraction of local speed, so every wait below is sized for that, not for a
    // developer machine.
    test.setTimeout(300_000);
    await openRite(page);
    await page.getByRole("button", { name: "Lock formation" }).click();
    await expect(page.locator(".wfr-canvas canvas")).toBeVisible({ timeout: 30_000 });

    const clock = page.getByTestId("wfr-clock");
    const tick = async () => Number((await clock.getAttribute("data-tick")) ?? "0");

    // The PLAYBACK CLOCK is the honest signal that the clash is running. It is a
    // ref driven by rAF and written straight to the DOM, so a frozen tick is the
    // single clearest symptom of the mode being broken — and unlike the health
    // bars it moves immediately, instead of waiting out the opening approach.
    // Assert it first so a real freeze fails fast and unambiguously.
    //
    // Assert ADVANCEMENT from an observed baseline, never an absolute tick. A
    // fixed threshold measures how fast the RENDERER is, not whether the clock
    // is running: CI's software renderer landed on exactly 30 against a
    // ">30 within 20s" bar and reported a healthy mode as frozen. The margin
    // keeps this sustained motion rather than one stray frame.
    const startTick = await tick();
    await expect.poll(tick, { timeout: 60_000, message: "the playback clock never advanced" })
        .toBeGreaterThan(startTick + 10);

    // Then the consequence: health must actually come off. Damage lands well
    // into the fight, and CI GPUs throttle rAF hard enough that wall-clock time
    // is a poor proxy for sim time — so poll the bars rather than sampling twice.
    const widths = () => page.locator(".wfr-bar-fill").evaluateAll(
        (nodes) => nodes.map((node) => (node as HTMLElement).style.width).join("|"),
    );
    const untouched = await widths();
    await expect.poll(widths, { timeout: 180_000, message: "no fighter ever took damage" })
        .not.toEqual(untouched);
});

test("the mid-match re-form gates the handoff and is committable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message.slice(0, 200)));

    // A whole clash has to elapse before the re-form is offered, so scrub
    // playback. The simulation is already resolved — this only changes how fast
    // the resolved fight is drawn, never its outcome.
    await openRite(page, "/petvfx.html?rite=1&seed=23&petQuality=low&ritespeed=12&riteqa=1");
    await page.getByRole("button", { name: "Lock formation" }).click();

    // The panel GATES the handoff: it stays up until answered, so there is no
    // race against an auto-advance.
    const panel = page.getByRole("dialog", { name: "Re-form your band" });
    await expect(panel).toBeVisible({ timeout: 180_000 });
    await expect(panel.getByRole("button", { name: "Hold the line" })).toBeVisible();

    // It halts the match, so it must behave like a modal: focused on open, or a
    // keyboard user is stranded tabbing the dimmed HUD behind it.
    await expect(panel).toBeFocused();
    await expect(panel).toHaveAttribute("aria-modal", "true");

    // Re-form is inert until the line actually changes — the button should never
    // let a player spend their one adjustment on nothing.
    const reform = panel.getByRole("button", { name: "Re-form" });
    await expect(reform).toBeDisabled();
    const picker = panel.getByLabel("Choose a pet to place").locator("button");
    await picker.nth(2).click();
    await panel.getByRole("button", { name: /Place .* at North rear/ }).click();
    await expect(reform).toBeEnabled();
    await reform.click();

    // Committing resumes the match into the next clash rather than restarting it.
    await expect(panel).toBeHidden({ timeout: 30_000 });
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("KAGE TACTICS 2", { timeout: 30_000 });
    expect(errors).toEqual([]);
});

test("Escape holds the line rather than trapping the player", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    test.setTimeout(240_000);
    await openRite(page, "/petvfx.html?rite=1&seed=23&petQuality=low&ritespeed=12&riteqa=1");
    await page.getByRole("button", { name: "Lock formation" }).click();

    const panel = page.getByRole("dialog", { name: "Re-form your band" });
    await expect(panel).toBeVisible({ timeout: 180_000 });
    await page.keyboard.press("Escape");

    // Declining spends the re-form and resumes — it must not leave the match
    // paused with no way forward.
    await expect(panel).toBeHidden({ timeout: 30_000 });
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("KAGE TACTICS 2", { timeout: 30_000 });
});

test("the re-form panel stays usable at phone width", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "this is the mobile layout check");
    test.setTimeout(240_000);
    await openRite(page, "/petvfx.html?rite=1&seed=23&petQuality=low&ritespeed=12&riteqa=1");
    await page.getByRole("button", { name: "Lock formation" }).click();

    const panel = page.getByRole("dialog", { name: "Re-form your band" });
    await expect(panel).toBeVisible({ timeout: 180_000 });

    // The panel must fit the viewport and never push the page sideways.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const box = await panel.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(page.viewportSize()!.width);

    // Both answers stay reachable and meet the touch-target minimum.
    for (const name of ["Hold the line", "Re-form"]) {
        const button = panel.getByRole("button", { name });
        await expect(button).toBeVisible();
        const bounds = await button.boundingBox();
        expect(bounds?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
});

test("the deployment panel stays usable at phone width", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "this is the mobile layout check");
    await openRite(page);
    await expect(page.getByLabel("Choose a pet to place").locator("button")).toHaveCount(4);
    await expect(page.getByLabel("Your deployment grid").locator("button")).toHaveCount(10);

    // Nothing may overflow the viewport horizontally.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // The primary action stays reachable and meets the 44px touch target rule.
    const lock = page.getByRole("button", { name: "Lock formation" });
    await expect(lock).toBeVisible();
    const box = await lock.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("the live clash fits a Galaxy S25+ without shrinking the battle into the HUD", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "galaxy-s25-plus", "device-specific release check");
    await openRite(page);
    await page.getByRole("button", { name: "Lock formation" }).click();

    const root = page.locator(".wfr-root");
    const hud = page.locator(".wfr-hud");
    await expect(hud).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("list", { name: "Your band" }).getByRole("listitem")).toHaveCount(4);
    await expect(page.getByRole("list", { name: "Their band" }).getByRole("listitem")).toHaveCount(4);

    const viewport = page.viewportSize()!;
    const rootBox = await root.boundingBox();
    expect(rootBox?.width ?? 0).toBeLessThanOrEqual(viewport.width + 1);
    expect(rootBox?.height ?? 0).toBeLessThanOrEqual(viewport.height + 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // The two rosters share a dedicated row under the score. They may use the
    // top fifth of the phone, but cannot cover the stage like the desktop HUD did.
    const hudBox = await hud.boundingBox();
    expect(hudBox?.height ?? viewport.height).toBeLessThan(viewport.height * 0.28);
    for (const roster of [page.getByRole("list", { name: "Your band" }), page.getByRole("list", { name: "Their band" })]) {
        const box = await roster.boundingBox();
        expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? viewport.width + 1)).toBeLessThanOrEqual(viewport.width + 1);
    }

    // WebGL gets the full scene; a device without WebGL gets an intentional
    // reduced battle view instead of a blank screen.
    await expect(page.locator(".wfr-canvas canvas, .wfr-canvas-fallback").first()).toBeVisible({ timeout: 30_000 });
});
