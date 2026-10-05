import { expect, test } from "@playwright/test";

const reportedFormation = "/petvfx.html?board=1&boardLineup=reported";

test.beforeEach(async ({ page }) => {
    page.on("pageerror", (error) => console.error(`[pageerror] ${error.stack ?? error.message}`));
    page.on("console", (message) => { if (message.type() === "error") console.error(`[browser console] ${message.text()}`); });
    page.on("requestfailed", (request) => console.error(`[requestfailed] ${request.url()}: ${request.failure()?.errorText ?? "unknown"}`));
    page.on("response", (response) => { if (response.status() >= 400) console.error(`[http ${response.status()}] ${response.url()}`); });
    await page.route("**/api/perf-beacon", (route) => route.fulfill({ status: 204, body: "" }));
});

test("reported formation plays consecutive rounds and settles once after WebGL context loss", async ({ page }) => {
    await page.goto(reportedFormation, { waitUntil: "commit" });
    const arena = page.getByTestId("pet-gauntlet-3d-arena");
    // Vite lazily transforms this large QA harness after the HTML document commits.
    await expect(arena).toHaveCount(1, { timeout: 180_000 });
    await expect(arena).toHaveAttribute("data-loading", "false", { timeout: 20_000 });
    await expect(arena).toHaveAttribute("data-summoning", "false", { timeout: 12_000 });
    await expect(arena).toContainText("Sand Snake");
    await expect(arena).toContainText("Ashen Crow");
    await expect(arena).toContainText("Marsh Eel");

    const canvas = arena.locator("canvas");
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toBeVisible();
    const hud = arena.locator(".gauntlet-board-hud");
    await expect(hud).toContainText(/Round\s+0\s*\//);
    await expect(hud).toContainText(/Round\s+1\s*\//);
    const roundOne = await canvas.screenshot();
    await expect(hud).toContainText(/Round\s+2\s*\//);
    const roundTwo = await canvas.screenshot();
    expect(roundOne.equals(roundTwo), "the canvas should visibly change as combat advances").toBe(false);

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
