import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { installUiAuditRuntime } from "./helpers/ui-audit-runtime";

test("capture eligible mobile UI gallery", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(process.env.UI_GALLERY_CAPTURE !== "1", "UI gallery capture is opt-in");
    test.skip(testInfo.project.name !== "chromium-mobile", "390x844 is the canonical gallery viewport");

    const output = resolve(process.env.UI_GALLERY_OUTPUT_DIR ?? resolve(process.cwd(), "..", ".playwright-mcp", "ui-gallery"));
    mkdirSync(output, { recursive: true });
    await page.addInitScript(() => localStorage.setItem("shinobix:storage-notice-ack", "1"));
    await installUiAuditRuntime(page);

    const routes = [
        ["centralHub", "central-hub"],
        ["village", "village"],
        ["worldMap", "world-map"],
        ["inventory", "inventory"],
        ["profile", "profile"],
        ["home", "pet-home"],
        ["townHall", "town-hall"],
        ["shinobiTiles", "card-hall"],
        ["storyHall", "story-hall"],
    ] as const;

    for (const [screen, filename] of routes) {
        await page.goto(`/#/${screen}`);
        await page.reload({ waitUntil: "networkidle" });
        await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", screen);
        await page.waitForTimeout(300);
        await page.screenshot({
            path: resolve(output, `${filename}-390x844.png`),
            animations: "disabled",
            fullPage: false,
        });
    }

    await page.goto("/#/village");
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "village");
    const nav = page.getByRole("navigation", { name: "Primary game navigation" });
    await nav.getByRole("button", { name: /Menu/ }).click();
    await expect(page.getByRole("dialog", { name: "Shinobi menu" })).toBeVisible();
    await page.screenshot({
        path: resolve(output, "mobile-menu-390x844.png"),
        animations: "disabled",
        fullPage: false,
    });
});
