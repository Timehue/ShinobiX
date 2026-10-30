import { expect, test } from "@playwright/test";

test.use({ contextOptions: { reducedMotion: "no-preference" } });

test("a completed team action identifies its participants without covering the arena", async ({ page }, info) => {
    test.skip(!["desktop", "phone"].includes(info.project.name));
    test.setTimeout(180_000);
    await page.goto("/petvfx.html?rite=1&riteqa=1&ritemotionqa=1&seed=23&ritespeed=.75&petQuality=high");
    await page.getByRole("button", { name: "Lock formation", exact: true }).click();
    await expect(page.getByTestId("wfr-stage-curtain")).toHaveClass(/is-open/, { timeout: 90_000 });
    const badge = page.getByTestId("wfr-teamwork");
    await expect(badge).toHaveText(/FOCUS|ALLY/, { timeout: 80_000 });
    const participants = page.locator('.wfr-roster li[data-tactic="ally"]');
    expect(await participants.count()).toBeGreaterThanOrEqual(1);
    await expect(page.locator('.wfr-roster li[data-tactic="target"]')).toHaveCount(1);
    const bounds = await badge.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({ path: info.outputPath("teamwork.png") });
});
