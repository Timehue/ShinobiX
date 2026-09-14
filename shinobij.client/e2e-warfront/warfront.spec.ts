import { expect, test } from "@playwright/test";

// Saved preview links must follow the same migration as the ranked entry:
// Beastbound Warfront now always opens the ten-cell Rite formation battle.
// Its complete gameplay, render lifecycle, and responsive contracts live in
// rite.spec.ts, rite-worker.spec.ts, and model-resource-lifecycle.spec.ts.
const legacyWarfrontUrl = "/petvfx.html?warfront=1&theme=central&stance=jungle&petQuality=low";

test("legacy Warfront links open the current formation battle across device sizes", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/perf-beacon", (route) => route.fulfill({ status: 204 }));
    await page.goto(legacyWarfrontUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    await expect(page.getByRole("heading", { name: "Set your formation" })).toBeVisible();
    await expect(page.getByLabel("Choose a pet to place").locator("button")).toHaveCount(4);
    await expect(page.getByLabel("Your deployment grid").locator("button")).toHaveCount(10);
    await expect(page.getByRole("region", { name: "Enemy revealed deployment" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Lock formation", exact: true })).toBeEnabled();
    await expect(page.locator(".wf3-shell")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Seal deployment", exact: true })).toHaveCount(0);
    await expect(page.getByText("FIRST TO TWO TOWERS", { exact: true })).toHaveCount(0);
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);

    await page.getByRole("button", { name: "Lock formation", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Set your formation" })).toBeHidden();
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("BEASTBOUND · CLASH 1");
    await expect(page.locator(".wf3-shell")).toHaveCount(0);
    expect(errors).toEqual([]);
});
