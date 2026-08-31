/*
 * Hollow Warfront — the Rite. End-to-end coverage of the autobattler.
 *
 * These pin what the mode's identity depends on, all of which the two lane-war
 * versions got wrong: the player commits a FORMATION before anything moves, the
 * enemy's front line is revealed while its back line is not, all eight pets
 * fight at once, and the fight is presented at a camera distance where a pet is
 * actually visible.
 */
import { expect, test } from "@playwright/test";

const riteUrl = "/petvfx.html?rite=1&petQuality=low";

async function openRite(page: import("@playwright/test").Page, url = riteUrl) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Set your formation" })).toBeVisible({ timeout: 30_000 });
}

test("deployment states the Rite's rules and reveals only the enemy front line", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once; responsive coverage runs separately");
    await openRite(page);

    // The rule that makes the mode legible in five seconds.
    await expect(page.getByText(/Your front line meets them first/)).toBeVisible();

    // Only their FRONT is scouted; the back line stays sealed — that is what
    // makes the opening formation a read rather than a coin flip.
    const scout = page.getByRole("region", { name: "Enemy front line" });
    await expect(scout).toBeVisible();
    await expect(scout.getByText(/back line is sealed/)).toBeVisible();

    // Four lanes, the first two marked FRONT.
    const formation = page.getByRole("list", { name: "Your formation" }).getByRole("listitem");
    await expect(formation).toHaveCount(4);
    await expect(formation.nth(0)).toContainText("FRONT");
    await expect(formation.nth(1)).toContainText("FRONT");
    await expect(formation.nth(2)).toContainText("BACK");
    await expect(formation.nth(3)).toContainText("BACK");
});

test("reordering the formation changes who holds the front line", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    await openRite(page);
    const formation = page.getByRole("list", { name: "Your formation" }).getByRole("listitem");
    const originalFront = (await formation.first().textContent()) ?? "";

    // Promote a back-line pet all the way to the front. The front must actually
    // change — the formation is the mode's pre-match decision, so it has to be
    // real rather than decorative.
    await formation.nth(2).getByRole("button", { name: /Move .* forward/ }).click();
    await formation.nth(1).getByRole("button", { name: /Move .* forward/ }).click();
    await expect(formation.first()).not.toHaveText(originalFront);
});

test("all eight fighters are on screen at once, with the clash score", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    await openRite(page);
    await page.getByRole("button", { name: "Begin the Rite" }).click();

    // Four a side, every one of them tracked — nobody sits a clash out.
    await expect(page.getByRole("list", { name: "Your band" }).getByRole("listitem")).toHaveCount(4);
    await expect(page.getByRole("list", { name: "Their band" }).getByRole("listitem")).toHaveCount(4);
    await expect(page.locator(".wfr-bar-fill")).toHaveCount(8);

    // The clash is numbered and the best-of-three score is shown. Scoped to the
    // HUD: the opening card carries the same "CLASH n" text, so an unscoped
    // match is a strict-mode collision rather than a real assertion.
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText(/^CLASH \d+$/, { timeout: 20_000 });
    await expect(page.getByLabel("Clashes won")).toBeVisible();

    // The 3D stage is actually mounted — this mode exists to show the models.
    await expect(page.locator(".wfr-canvas canvas")).toBeVisible({ timeout: 30_000 });
});

test("playback advances and the fighters actually take damage", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    await openRite(page);
    await page.getByRole("button", { name: "Begin the Rite" }).click();
    await expect(page.locator(".wfr-canvas canvas")).toBeVisible({ timeout: 30_000 });

    const clock = page.getByTestId("wfr-clock");
    const tick = async () => Number((await clock.getAttribute("data-tick")) ?? "0");

    // The PLAYBACK CLOCK is the honest signal that the clash is running. It is a
    // ref driven by rAF and written straight to the DOM, so a frozen tick is the
    // single clearest symptom of the mode being broken — and unlike the health
    // bars it moves immediately, instead of waiting out the opening approach.
    // Assert it first so a real freeze fails fast and unambiguously.
    await expect.poll(tick, { timeout: 20_000, message: "the playback clock never advanced" })
        .toBeGreaterThan(30);

    // Then the consequence: health must actually come off. Damage lands well
    // into the fight, and CI GPUs throttle rAF hard enough that wall-clock time
    // is a poor proxy for sim time — so poll the bars rather than sampling twice.
    const widths = () => page.locator(".wfr-bar-fill").evaluateAll(
        (nodes) => nodes.map((node) => (node as HTMLElement).style.width).join("|"),
    );
    const untouched = await widths();
    await expect.poll(widths, { timeout: 90_000, message: "no fighter ever took damage" })
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
    await openRite(page, "/petvfx.html?rite=1&seed=23&petQuality=low&ritespeed=12");
    await page.getByRole("button", { name: "Begin the Rite" }).click();

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
    await panel.getByRole("list", { name: "Re-formed line" }).getByRole("listitem")
        .nth(3).getByRole("button", { name: /Move .* forward/ }).click();
    await expect(reform).toBeEnabled();
    await reform.click();

    // Committing resumes the match into the next clash rather than restarting it.
    await expect(panel).toBeHidden({ timeout: 30_000 });
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("CLASH 2", { timeout: 30_000 });
    expect(errors).toEqual([]);
});

test("Escape holds the line rather than trapping the player", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    test.setTimeout(240_000);
    await openRite(page, "/petvfx.html?rite=1&seed=23&petQuality=low&ritespeed=12");
    await page.getByRole("button", { name: "Begin the Rite" }).click();

    const panel = page.getByRole("dialog", { name: "Re-form your band" });
    await expect(panel).toBeVisible({ timeout: 180_000 });
    await page.keyboard.press("Escape");

    // Declining spends the re-form and resumes — it must not leave the match
    // paused with no way forward.
    await expect(panel).toBeHidden({ timeout: 30_000 });
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("CLASH 2", { timeout: 30_000 });
});

test("the re-form panel stays usable at phone width", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "this is the mobile layout check");
    test.setTimeout(240_000);
    await openRite(page, "/petvfx.html?rite=1&seed=23&petQuality=low&ritespeed=12");
    await page.getByRole("button", { name: "Begin the Rite" }).click();

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

test("the formation panel stays usable at phone width", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "this is the mobile layout check");
    await openRite(page);
    await expect(page.getByRole("list", { name: "Your formation" }).getByRole("listitem")).toHaveCount(4);

    // Nothing may overflow the viewport horizontally — the lane war's HUD did.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // The primary action stays reachable and meets the 44px touch target rule.
    const begin = page.getByRole("button", { name: "Begin the Rite" });
    await expect(begin).toBeVisible();
    const box = await begin.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});
