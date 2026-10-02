import { expect, test } from "@playwright/test";

const reportedFormation = "/petvfx.html?board=1&boardLineup=reported";

test.beforeEach(async ({ page }) => {
    page.on("pageerror", (error) => console.error(`[pageerror] ${error.stack ?? error.message}`));
    page.on("console", (message) => { if (message.type() === "error") console.error(`[browser console] ${message.text()}`); });
    page.on("requestfailed", (request) => console.error(`[requestfailed] ${request.url()}: ${request.failure()?.errorText ?? "unknown"}`));
    page.on("response", (response) => { if (response.status() >= 400) console.error(`[http ${response.status()}] ${response.url()}`); });
    await page.route("**/api/perf-beacon", (route) => route.fulfill({ status: 204, body: "" }));
});

type RoundLog = Window & { __gauntletRounds?: number[] };

test("reported formation plays consecutive rounds and settles once after WebGL context loss", async ({ page }) => {
    await page.goto(reportedFormation, { waitUntil: "commit" });
    const arena = page.getByTestId("pet-gauntlet-3d-arena");
    // Vite lazily transforms this large QA harness after the HTML document commits.
    await expect(arena).toHaveCount(1, { timeout: 180_000 });
    // Record every round the HUD shows from inside the page. CI renders this
    // board through SwiftShader at about 1 fps, and there each Playwright check
    // is slower than the 0.5 to 2 s wall-clock round dwell, so asserting
    // `Round 0`, then `Round 1`, then `Round 2` from outside raced the timer and
    // failed both attempts of run 36932997819. Rounds cannot start before the
    // entrance settles, so an observer installed now sees every one of them.
    await arena.evaluate((node) => {
        const log: number[] = [];
        (window as RoundLog).__gauntletRounds = log;
        const read = () => {
            const shown = Number(node.querySelector(".gauntlet-board-round strong")?.textContent?.match(/Round\s+(\d+)/)?.[1]);
            if (Number.isFinite(shown) && log.at(-1) !== shown) log.push(shown);
        };
        read();
        new MutationObserver(read).observe(node, { subtree: true, childList: true, characterData: true });
    });
    const latestRound = () => page.evaluate(() => (window as RoundLog).__gauntletRounds?.at(-1) ?? -1);
    await expect(arena).toHaveAttribute("data-loading", "false", { timeout: 20_000 });
    // The summon entrance counts rendered frames, not wall time: each frame
    // advances it by at most 0.05 s (PetSummon3D), so its 1.4 s needs 28+
    // frames. CI renders this headed board through SwiftShader under xvfb,
    // where a local SwiftShader run measured 1.2 fps and a 29 s summon. 12 s
    // failed on both CI attempts; 90 s leaves room for a slower runner.
    await expect(arena).toHaveAttribute("data-summoning", "false", { timeout: 90_000 });
    const canvas = arena.locator("canvas");
    await expect(canvas).toHaveCount(1);
    // Capture as early in the fight as possible, before any slower check.
    const early = await canvas.screenshot();
    await expect(arena).toContainText("Sand Snake");
    await expect(arena).toContainText("Ashen Crow");
    await expect(arena).toContainText("Marsh Eel");
    await expect(canvas).toBeVisible();

    await expect.poll(latestRound, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    const later = await canvas.screenshot();
    expect(early.equals(later), "the canvas should visibly change as combat advances").toBe(false);
    const rounds = await page.evaluate(() => (window as RoundLog).__gauntletRounds ?? []);
    expect(rounds.slice(0, 3), "the HUD must start at round 0 and advance one round at a time").toEqual([0, 1, 2]);
    expect(rounds.every((round, index) => round === index), `rounds must be consecutive: ${rounds.join(", ")}`).toBe(true);

    const contextWasLost = await arena.evaluate((node) => {
        const canvas = [...node.querySelectorAll("canvas")].find((candidate) => candidate.height > 600);
        const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
        const loseContext = gl?.getExtension("WEBGL_lose_context");
        if (!loseContext) return false;
        loseContext.loseContext();
        return true;
    });
    expect(contextWasLost, "Chromium must expose WEBGL_lose_context for this recovery regression").toBe(true);

    const continueButton = page.getByRole("button", { name: /continue the run/i });
    await expect(continueButton).toBeVisible();
    await expect(page.getByText(/your battle result is saved/i)).toBeVisible();
    const runState = page.getByTestId("pet-board-run-state");
    const initialValor = Number(await runState.getAttribute("data-valor"));
    const result = await runState.getAttribute("data-result");
    expect(result, "the recovery fixture is set up to win round one").toBe("win");
    await continueButton.click();
    await expect(page.getByTestId("pet-board-continue-count")).toHaveAttribute("data-count", "1");
    await expect(page.getByRole("button", { name: /continue the run/i })).toHaveCount(0);
    await expect(page.getByTestId("pet-gauntlet-3d-arena")).toHaveCount(0);
    await expect(runState).toHaveAttribute("data-status", "drafting");
    await expect(runState).toHaveAttribute("data-round", result === "win" ? "2" : "1");
    await expect(runState).toHaveAttribute("data-cleared", result === "win" ? "1" : "0");
    await expect(runState).toHaveAttribute("data-valor", String(initialValor + (result === "win" ? 5 : 3)));
});
