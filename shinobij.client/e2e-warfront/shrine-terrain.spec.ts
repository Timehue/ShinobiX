import { expect, test } from "@playwright/test";
import { WARFRONT_TERRAIN } from "../src/lib/pet-warfront-contract";

test("shrine obstacles and cover match the battlefield on desktop and phone", async ({ page }, info) => {
    test.skip(!["desktop", "phone"].includes(info.project.name));
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/petvfx.html?rite=1&riteqa=1&ritemotionqa=1&seed=23&ritespeed=.75&petQuality=high${info.project.name === "desktop" ? "&riteforce3d=1" : ""}`);
    await page.getByRole("button", { name: "Lock formation", exact: true }).click();
    await expect(page.getByTestId("wfr-stage-curtain")).toHaveCSS("opacity", "0", { timeout: 120_000 });
    const canvas = page.locator("canvas[data-rite-terrain]");
    await expect(canvas).toHaveAttribute("data-rite-arena-floor-decal-draws", "0");
    await expect(canvas).toHaveAttribute("data-rite-terrain", WARFRONT_TERRAIN.map(cell => `${cell.kind}:${cell.col},${cell.row}`).join(";"));
    await expect.poll(async () => Number(await page.getByTestId("wfr-clock").getAttribute("data-tick")), { timeout: 90_000 }).toBeGreaterThan(90);
    await page.screenshot({ path: info.outputPath(`shrine-opening-${info.project.name}.png`) });
    await expect.poll(async () => Number(await page.getByTestId("wfr-clock").getAttribute("data-tick")), { timeout: 90_000 }).toBeGreaterThan(240);
    await page.screenshot({ path: info.outputPath(`shrine-battle-${info.project.name}.png`) });
    await expect(page.locator(".wfr-roster li")).toHaveCount(8);
    if (info.project.name === "phone") {
        // These counters describe living actors. Coordinated attacks can score
        // a knockout before this capture; every survivor must remain visible.
        await expect.poll(() => canvas.evaluate(element => {
            const present = Number(element.getAttribute("data-rite-actors-present"));
            const safe = Number(element.getAttribute("data-rite-actors-in-safe-viewport"));
            return present > 0 && safe === present;
        })).toBe(true);
    }
    expect(errors).toEqual([]);
});
