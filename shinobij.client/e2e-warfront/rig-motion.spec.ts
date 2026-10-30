import { expect, test } from "@playwright/test";

test.use({ contextOptions: { reducedMotion: "no-preference" } });

test("eight authored rigs play approach, cast and recovery on the garden", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop");
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/petvfx.html?rite=1&riteqa=1&ritemotionqa=1&riteforce3d=1&seed=23&ritespeed=.75&petQuality=high");
    await page.getByRole("button", { name: "Lock formation", exact: true }).click();
    const curtain = page.getByTestId("wfr-stage-curtain");
    await expect(curtain).toHaveAttribute("data-models-ready", "8", { timeout: 90_000 });
    await expect(curtain).toHaveClass(/is-open/);
    const canvas = page.locator("canvas[data-rite-actor-render-mode]");
    test.skip(/swiftshader|llvmpipe|software raster|microsoft basic render|lavapipe/i.test(await canvas.getAttribute("data-rite-renderer") ?? ""),
        "Skeletal motion requires a GPU; software-renderer fallback is covered by the readability checks.");
    await expect(canvas).toHaveAttribute("data-rite-actor-render-mode", "skinned-3d");
    await expect(canvas).toHaveAttribute("data-rite-arena", "training-garden-v1");
    const tick = async () => Number(await page.getByTestId("wfr-clock").getAttribute("data-tick"));
    for (const at of [45, 135, 270]) {
        await expect.poll(tick, { timeout: 60_000 }).toBeGreaterThan(at);
        await page.screenshot({ path: info.outputPath(`rigs-${at}.png`) });
    }
    await expect(canvas).toHaveAttribute("data-rite-actor-render-mode", "skinned-3d");
    expect(errors).toEqual([]);
});
