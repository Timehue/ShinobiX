import { expect, test } from "@playwright/test";

test("fighter replacement and quality changes release GPU bone textures", async ({ page }, testInfo) => {
    test.skip(!["desktop", "phone"].includes(testInfo.project.name), "resource ownership is exercised on desktop and phone");
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/petvfx.html?modelresources=1", { waitUntil: "domcontentloaded" });
    const canvas = page.locator("canvas");
    const samples: { label: string; textures: number; geometries: number }[] = [];
    async function sample(label: string) {
        const state = await page.getByTestId("model-resource-state").innerText();
        await expect(canvas).toHaveAttribute("data-resource-sample", state);
        const value = await canvas.evaluate(element => ({
            textures: Number(element.dataset.resourceTextures),
            geometries: Number(element.dataset.resourceGeometries),
        }));
        samples.push({ label, ...value });
        return value;
    }
    try {
        const active = await sample("initial");
        expect(active.textures).toBeGreaterThan(8);
        expect(active.geometries).toBeGreaterThan(0);
        await page.getByRole("button", { name: "Retire fighters", exact: true }).click();
        const retired = await sample("initial-retired");
        expect(active.textures - retired.textures).toBe(16);
        await page.getByRole("button", { name: "Mount fighters", exact: true }).click();
        expect(await sample("initial-remounted")).toEqual(active);
        const lifecycle = await page.context().newCDPSession(page);
        for (let cycle = 0; cycle < 6; cycle++) {
            await page.getByRole("button", { name: "Replace fighters", exact: true }).click();
            expect(await sample(`${cycle}-replacement`)).toEqual(active);
            for (const quality of ["low", "high", "medium"] as const) {
                await page.getByRole("button", { name: quality, exact: true }).click();
                const current = await sample(`${cycle}-${quality}`);
                expect(current.geometries).toBe(active.geometries);
                expect(current.textures).toBe(retired.textures + (quality === "low" ? 8 : 16));
            }
            await page.getByRole("button", { name: "Retire fighters", exact: true }).click();
            expect(await sample(`${cycle}-retired`)).toEqual(retired);
            await page.getByRole("button", { name: "Mount fighters", exact: true }).click();
            expect(await sample(`${cycle}-remounted`)).toEqual(active);
            if (cycle === 2) {
                // Freeze and resume the real page lifecycle without remounting
                // the renderer, as a suspended tab would do.
                await lifecycle.send("Page.setWebLifecycleState", { state: "frozen" });
                await page.waitForTimeout(250);
                await lifecycle.send("Page.setWebLifecycleState", { state: "active" });
                const previousFrame = Number(await canvas.getAttribute("data-resource-frames"));
                await expect.poll(async () => Number(await canvas.getAttribute("data-resource-frames"))).toBeGreaterThan(previousFrame);
                expect(await sample("resumed")).toEqual(active);
            }
        }
        await lifecycle.detach();
        expect(errors).toEqual([]);
    } finally {
        await testInfo.attach("model-resource-cycles", { body: JSON.stringify({ samples, errors }, null, 2), contentType: "application/json" });
    }
});
