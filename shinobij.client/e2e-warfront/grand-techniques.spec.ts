import { expect, test } from "@playwright/test";

test("named elemental techniques have Colosseum-scale effects while the battlefield stays readable", async ({ page }, info) => {
    test.skip(!["desktop", "phone"].includes(info.project.name));
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    const desktop = info.project.name === "desktop";
    await page.goto(`/petvfx.html?rite=1&riteqa=1&ritemotionqa=1&seed=23&ritespeed=1&petQuality=low${desktop ? "&riteforce3d=1" : ""}`);
    await page.getByRole("button", { name: "Lock formation", exact: true }).click();
    const canvas = page.locator("canvas[data-rite-grand-techniques]").first();
    await expect.poll(async () => Number(await page.getByTestId("wfr-clock").getAttribute("data-tick")), {
        timeout: 120_000,
    }).toBeGreaterThan(90);
    await expect.poll(async () => (await canvas.getAttribute("data-rite-grand-techniques", { timeout: 90_000 })) ?? "", {
        timeout: 120_000, intervals: [50],
    }).toMatch(/Fire|Water|Wind|Earth|Lightning/);
    const active = (await canvas.getAttribute("data-rite-grand-techniques"))?.split(",").filter(Boolean) ?? [];
    expect(active.length).toBeLessThanOrEqual(2);
    if (!desktop) await expect(canvas).toHaveAttribute("data-rite-actors-in-safe-viewport", "8");
    await page.screenshot({ path: info.outputPath(`grand-techniques-${info.project.name}.png`) });
    await expect(page.locator(".wfr-roster li")).toHaveCount(8);
    expect(errors).toEqual([]);
});

for (const [element, template] of [
    ["Fire", "mythic-3"], ["Water", "mythic-2"], ["Wind", "mythic-7"],
    ["Earth", "mythic-4"], ["Lightning", "mythic-1"],
] as const) {
    test(`${element} grand technique fits the actual eight-pet battlefield`, async ({ page }, info) => {
        test.skip(!["desktop", "phone"].includes(info.project.name));
        test.setTimeout(180_000);
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => {
            if (message.type() === "error" && /WebGLProgram|shader error|VALIDATE_STATUS/i.test(message.text())) errors.push(message.text());
        });
        const pets = Array(4).fill(template).join(",");
        await page.goto(`/petvfx.html?rite=1&riteqa=1&ritemotionqa=1&seed=23&ritespeed=0.6&petQuality=low&ritepets=${pets}${info.project.name === "desktop" ? "&riteforce3d=1" : ""}`);
        await page.getByRole("button", { name: "Lock formation", exact: true }).click();
        const canvas = page.locator("canvas[data-rite-grand-techniques]").first();
        await expect.poll(async () => Number(await page.getByTestId("wfr-clock").getAttribute("data-tick")), {
            timeout: 120_000,
        }).toBeGreaterThan(90);
        await expect.poll(async () => await canvas.getAttribute("data-rite-grand-techniques"), {
            timeout: 60_000, intervals: [50],
        }).toContain(element);
        await page.screenshot({ path: info.outputPath(`${element.toLowerCase()}-${info.project.name}.png`) });
        await expect(page.locator(".wfr-roster li")).toHaveCount(8);
        expect(errors).toEqual([]);
    });
}

test.describe("calm elemental presentation", () => {
    test.use({ contextOptions: { reducedMotion: "reduce" } });
    test("lightning remains visible with reduced motion", async ({ page }, info) => {
        test.skip(info.project.name !== "desktop");
        test.setTimeout(180_000);
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => {
            if (message.type() === "error" && /WebGLProgram|shader error|VALIDATE_STATUS/i.test(message.text())) errors.push(message.text());
        });
        await page.goto("/petvfx.html?rite=1&riteqa=1&ritemotionqa=1&riteforce3d=1&seed=23&ritespeed=0.6&petQuality=low&ritepets=mythic-1,mythic-1,mythic-1,mythic-1");
        await page.getByRole("button", { name: "Lock formation", exact: true }).click();
        await expect(page.getByTestId("wfr-stage-curtain")).toHaveCSS("opacity", "0", { timeout: 120_000 });
        await expect.poll(async () => Number(await page.getByTestId("wfr-clock").getAttribute("data-tick")), {
            timeout: 120_000,
        }).toBeGreaterThan(90);
        const canvas = page.locator("canvas[data-rite-grand-techniques]").first();
        await expect.poll(async () => await canvas.getAttribute("data-rite-grand-techniques"), {
            timeout: 120_000, intervals: [50],
        }).toContain("Lightning");
        await page.screenshot({ path: info.outputPath("lightning-reduced-motion.png") });
        expect(errors).toEqual([]);
    });
});
