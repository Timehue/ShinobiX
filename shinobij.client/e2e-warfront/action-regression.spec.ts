import { expect, test } from "@playwright/test";

test.use({ ignoreHTTPSErrors: true });

for (const route of ["webgl", "canvas"] as const) {
    test(`Turtle Duck actions and match exit remain responsive on ${route}`, async ({ page }, info) => {
        test.skip(route === "webgl" ? info.project.name !== "desktop" : info.project.name !== "phone");
        test.setTimeout(240_000);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        if (route === "canvas") await page.addInitScript(() => {
            const canvas = document.createElement("canvas");
            const gl = canvas.getContext("webgl2");
            if (!gl) return;
            const debug = gl.getExtension("WEBGL_debug_renderer_info");
            const renderer = String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
            localStorage.setItem("kage:warfront-render-route:v3", JSON.stringify({ version: 3, renderer, mode: "model-impostor", proof: "slow-observed", sample: null }));
            gl.getExtension("WEBGL_lose_context")?.loseContext();
        });
        await page.goto(`/petvfx.html?rite=1&riteqa=1&ritemotionqa=1&seed=23&ritespeed=3&petQuality=low&ritepets=,,mythic-7,${route === "webgl" ? "&riteforce3d=1" : ""}`);
        await page.getByRole("button", { name: "Lock formation", exact: true }).click();
        await expect(page.getByTestId("wfr-stage-curtain")).toHaveClass(/is-open/, { timeout: 90_000 });
        const actor = await page.locator('.wfr-roster.is-blue li', { hasText: "Turtle Duck" }).getAttribute("data-actor-id");
        expect(actor).toBeTruthy();
        const canvas = page.locator('canvas[data-rite-elemental-actors-seen]').first();
        await expect.poll(async () => Number(await page.getByTestId("wfr-clock").getAttribute("data-tick")), { timeout: 90_000 }).toBeGreaterThan(0);
        await expect.poll(async () => (await canvas.getAttribute("data-rite-elemental-actors-active"))?.split(",") ?? [], { timeout: 90_000, intervals: [50] }).toContain(actor);
        await page.screenshot({ path: info.outputPath(`turtle-duck-${route}.png`) });
        const report = page.getByRole("dialog", { name: "Tactical report and re-form" });
        await expect(report).toBeVisible({ timeout: 90_000 });
        await page.waitForTimeout(300);
        const idleFrame = await canvas.getAttribute("data-rite-render-frame");
        await page.waitForTimeout(700);
        expect(await canvas.getAttribute("data-rite-render-frame")).toBe(idleFrame);
        for (let clash = 0; clash < 5; clash++) {
            if (await page.locator(".wfr-result").isVisible()) break;
            const acknowledge = page.getByRole("button", { name: "Report read, re-form band" });
            if (await acknowledge.isVisible()) await acknowledge.click();
            await report.getByRole("button", { name: "Lock & rematch" }).click();
            await expect(report).toBeHidden();
            await expect.poll(async () => await page.locator(".wfr-result").isVisible() || await report.isVisible(), { timeout: 90_000 }).toBe(true);
        }
        await expect(page.locator(".wfr-result")).toBeVisible();
        await expect(page.getByTestId("rite-harness-settlement")).toHaveAttribute("data-reports", "1");
        await page.getByRole("button", { name: "Leave the Warfront", exact: true }).click();
        await expect(page.getByRole("button", { name: "Reopen Warfront" })).toBeVisible();
        await expect(page.locator("canvas")).toHaveCount(0);
        await page.getByRole("button", { name: "Reopen Warfront" }).click();
        await expect(page.getByRole("button", { name: "Lock formation", exact: true })).toBeEnabled();
        expect(errors).toEqual([]);
    });
}
