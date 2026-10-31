import { expect, test } from "@playwright/test";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

const rootFilter = (page: import("@playwright/test").Page) =>
    page.evaluate(() => document.documentElement.style.filter);

test("the brightness slider lights the whole game, survives a reload and resets", async ({ page }) => {
    const runtime = await installUiAuditRuntime(page, uiAuditSave());
    await expectUiAuditBoot(page, runtime, "settings");
    expect(await rootFilter(page)).toBe("");

    const slider = page.locator("#settings-brightness");
    await slider.fill("140");
    await expect(page.locator('output[for="settings-brightness"]')).toHaveText("140%");
    expect(await rootFilter(page)).toContain("brightness(1.4)");

    await page.reload();
    await expect(slider).toHaveValue("140");
    expect(await rootFilter(page)).toContain("brightness(1.4)");

    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(slider).toHaveValue("100");
    expect(await rootFilter(page)).toBe("");
    await expect(page.getByRole("button", { name: "Reset to default" })).toHaveCount(0);
});

// A filter on any other element would shrink every position: fixed overlay to that
// element's box. The document root is exempt, and this holds every browser to it.
test("fixed overlays still fill the viewport while the filter is on", async ({ page }) => {
    const runtime = await installUiAuditRuntime(page, uiAuditSave());
    await page.addInitScript(() => localStorage.setItem("displayBrightness.v1", "140"));
    await expectUiAuditBoot(page, runtime, "settings");
    const box = await page.evaluate(() => {
        window.scrollTo(0, 200);
        const probe = document.createElement("div");
        probe.style.cssText = "position:fixed;inset:0";
        document.body.appendChild(probe);
        const rect = probe.getBoundingClientRect();
        probe.remove();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, viewport: [document.documentElement.clientWidth, window.innerHeight] };
    });
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.width).toBe(box.viewport[0]);
    expect(box.height).toBe(box.viewport[1]);
});

for (const width of [1024, 1280, 1440, 1920]) {
    test(`the daily caps fit the desktop rail at ${width}px`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "chromium-desktop", "the rail width is a layout fact, checked once");
        await page.setViewportSize({ width, height: 900 });
        const runtime = await installUiAuditRuntime(page, uiAuditSave());
        await expectUiAuditBoot(page, runtime, "settings");
        const cells = page.locator(".left-profile-card .left-caps-label, .left-profile-card .left-caps-value");
        await expect(cells).toHaveCount(10);
        const clipped = await cells.evaluateAll(nodes => nodes
            .filter(node => node.scrollWidth > node.clientWidth)
            .map(node => node.textContent));
        expect(clipped).toEqual([]);
    });
}
