/*
 * Beastbound Warfront — no state may strand a player.
 *
 * The mid-battle ✕ exit was removed (797b81715) because it got players stuck,
 * so every state that used to wait on a retry now has to progress on its own:
 * a battle whose graphics fail keeps playing in the reduced view, a re-form
 * that cannot be prepared can always hold its line, and a replay viewer can
 * jump to the verdict. The harness (`src/petvfx-rite.tsx`) records each result
 * report and replays it the way the Warfront authority does, so these specs
 * can check that settlement still receives the plan that produced the result.
 */
import { expect, test, type Page } from "@playwright/test";

const verdictHeading = (page: Page) => page.getByRole("heading", { name: /The Rite is (yours|lost)/ });
const clock = async (page: Page) => Number(await page.getByTestId("wfr-clock").getAttribute("data-tick"));

/** Play every remaining interlude with the line already on the board. */
async function holdEveryReformToTheVerdict(page: Page, afterEachClash?: () => Promise<void>) {
    const verdict = verdictHeading(page);
    const panel = page.getByRole("dialog", { name: "Tactical report and re-form" });
    for (let clash = 0; clash < 3; clash += 1) {
        await expect(verdict.or(panel)).toBeVisible({ timeout: 180_000 });
        if (await verdict.isVisible()) return;
        await panel.getByRole("button", { name: "Lock & rematch", exact: true }).click();
        await expect(panel).toBeHidden({ timeout: 30_000 });
        await afterEachClash?.();
    }
    await expect(verdict).toBeVisible({ timeout: 180_000 });
}

/** The result screen and the harness's authority replay agree, exactly once. */
async function expectSettledOnce(page: Page) {
    const settlement = page.getByTestId("rite-harness-settlement");
    const line = page.locator(".wfr-result-line");
    await expect(line).toHaveText(/^Clashes \d–\d · \d fought · \d+s$/);
    const shown = (await line.textContent())?.trim() ?? "";
    await expect(settlement).toHaveAttribute("data-reports", "1");
    await expect(settlement).toHaveAttribute("data-result-line", shown);
    await expect(settlement).toHaveAttribute("data-authority-result-line", shown);
}

test("battle graphics lost mid-clash hand the match to the reduced view, which plays on to settlement", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "graphics recovery runs once");
    test.setTimeout(360_000);
    // Real-time playback, so the loss lands mid-clash rather than after a scrubbed one.
    await page.goto("/petvfx.html?rite=1&seed=23&petQuality=low&ritespeed=1&riteqa=1&ritemotionqa=1&riteforce3d=1", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
    });
    await page.getByRole("button", { name: "Lock formation", exact: true }).click();
    const curtain = page.getByTestId("wfr-stage-curtain");
    await expect(curtain).toHaveAttribute("data-stage-ready", "true", { timeout: 120_000 });
    await expect.poll(() => clock(page), { timeout: 60_000 }).toBeGreaterThan(3);

    // The GPU goes away for good: the live context is lost and no canvas of any
    // kind can get a context again, so neither the restore nor the Canvas route
    // can come back. Before this fix the battle then sat paused behind
    // "RESTORING BATTLE VIEW" (or a retry-only panel) until a reload.
    await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>(".wfr-canvas canvas");
        const context = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
        HTMLCanvasElement.prototype.getContext = function getContext() { return null; } as typeof HTMLCanvasElement.prototype.getContext;
        const loseContext = context?.getExtension("WEBGL_lose_context");
        if (loseContext) loseContext.loseContext();
        else canvas?.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });
    await expect(page.getByTestId("wfr-render-recovery")).toBeVisible();
    const pausedAt = await clock(page);

    // Bounded: the restore gives up and the lighter routes take over from the same tick.
    const reduced = page.getByTestId("wfr-reduced-stage");
    await expect(reduced).toBeVisible({ timeout: 90_000 });
    await expect(reduced.getByText("REDUCED BATTLE VIEW")).toBeVisible();
    await expect(curtain).toHaveAttribute("data-stage-ready", "true", { timeout: 30_000 });
    expect(await clock(page)).toBeGreaterThanOrEqual(pausedAt);
    await expect.poll(() => clock(page), { timeout: 60_000, message: "the clock never resumed on the reduced view" }).toBeGreaterThan(pausedAt + 3);
    await expect(page.getByRole("button", { name: "Leave the Warfront" })).toHaveCount(0);

    // Every remaining clash, re-form and the result still happen on it.
    await holdEveryReformToTheVerdict(page, async () => {
        await expect(page.getByTestId("wfr-reduced-stage")).toBeVisible();
    });
    await expectSettledOnce(page);
    await page.getByRole("button", { name: "Leave the Warfront", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reopen Warfront" })).toBeVisible();
});

test("a re-form the battle worker cannot prepare holds its line and the match still settles", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    test.setTimeout(300_000);
    await page.goto("/petvfx.html?rite=1&seed=23&petQuality=low&ritespeed=12&riteqa=1", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByRole("button", { name: "Lock formation", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Tactical report and re-form" });
    await expect(panel).toBeVisible({ timeout: 180_000 });

    // A deploy lands mid-match: the battle worker's chunk no longer loads.
    let workerRequests = 0;
    await page.route("**/*pet-rite.worker*", (route) => { workerRequests += 1; return route.abort(); });
    const picker = panel.getByLabel("Choose a pet to place").locator("button");
    await picker.nth(2).click();
    await panel.getByRole("button", { name: /Place .* at North rear/ }).click();
    await panel.getByRole("button", { name: "Lock & rematch", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("could not be prepared");
    expect(workerRequests, "one fresh worker is tried before the panel asks").toBe(2);
    await expect.poll(() => page.workers().length).toBe(0);
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("BEASTBOUND · CLASH 1");

    // Holding needs no simulation, so it always moves the match forward.
    await panel.getByRole("button", { name: "Hold formation", exact: true }).click();
    await expect(panel).toBeHidden({ timeout: 30_000 });
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("BEASTBOUND · CLASH 2", { timeout: 30_000 });
    await holdEveryReformToTheVerdict(page);
    await expectSettledOnce(page);
    await expect(page.getByTestId("rite-harness-settlement")).toHaveAttribute("data-reforms", "0");
    await expect.poll(() => page.workers().length).toBe(0);
});

test("a shared replay whose re-form cannot be prepared holds its line and reaches the verdict", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    test.setTimeout(240_000);
    // Seed 23: blue loses the opening clash, so the automatic seat must re-form.
    await page.goto("/petvfx.html?rite=1&autostart=1&seed=23&petQuality=low&ritespeed=12&riteqa=1", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("BEASTBOUND · CLASH 1", { timeout: 60_000 });
    await page.route("**/*pet-rite.worker*", (route) => route.abort());
    await expect(page.getByText(/RE-FORM UNAVAILABLE · holding the current formation/)).toBeVisible({ timeout: 180_000 });
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("BEASTBOUND · CLASH 2", { timeout: 30_000 });
    await expect(verdictHeading(page)).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId("rite-harness-settlement")).toHaveAttribute("data-reports", "0");
    await page.getByRole("button", { name: "Leave the Warfront", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reopen Warfront" })).toBeVisible();
});

for (const replay of [
    // Seed 20260601: the opening result alone reads 2–1, but the automatic
    // re-form after clash one turns the match 0–2. Skipping must land there.
    { label: "a shared co-op replay", query: "autostart=1&seed=20260601" },
    { label: "a sealed ranked replay", query: "autostart=1&sealedreplay=1&seed=23" },
]) {
    test(`${replay.label} can skip to the verdict its playback reaches`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "desktop", "interaction runs once");
        test.setTimeout(120_000);
        await page.goto(`/petvfx.html?rite=1&${replay.query}&petQuality=low&riteqa=1`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("BEASTBOUND · CLASH 1", { timeout: 60_000 });
        // Not an exit: nothing leaves a replay before its result screen.
        await expect(page.getByRole("button", { name: "Leave the Warfront" })).toHaveCount(0);
        const skip = page.getByRole("button", { name: "Skip to result", exact: true });
        const box = await skip.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        await skip.click();
        await expect(verdictHeading(page)).toBeVisible({ timeout: 30_000 });
        const expected = await page.getByTestId("rite-harness-settlement").getAttribute("data-expected-result-line");
        expect(expected).toMatch(/^Clashes \d–\d · \d fought · \d+s$/);
        await expect(page.locator(".wfr-result-line")).toHaveText(expected!);
        // A replay settles nowhere.
        await expect(page.getByTestId("rite-harness-settlement")).toHaveAttribute("data-reports", "0");
        await page.getByRole("button", { name: "Leave the Warfront", exact: true }).click();
        await expect(page.getByRole("button", { name: "Reopen Warfront" })).toBeVisible();
    });
}

test("the player's own Warfront never offers a skip", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    await page.goto("/petvfx.html?rite=1&seed=23&petQuality=low&riteqa=1", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByRole("button", { name: "Lock formation", exact: true }).click();
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("BEASTBOUND · CLASH 1", { timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Skip to result" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Leave the Warfront" })).toHaveCount(0);
});
