import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium" || !["chromium-desktop", "chromium-mobile"].includes(testInfo.project.name), "download ownership runs on desktop and phone");
});

test("village restoration defers PvP until entering a combat gateway", async ({ page }) => {
    const manifest = JSON.parse(readFileSync(new URL("../dist/.vite/manifest.json", import.meta.url), "utf8"));
    const pvpPath = `/${manifest["src/screens/PvpBattleScreen.tsx"].file}`;
    const requests: string[] = [];
    page.on("request", request => requests.push(request.url()));
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, "village");
    // Cover the old 650ms post-restore timer, including a slow initial render.
    await page.waitForTimeout(1_500);
    const pvpRequests = () => requests.filter(url => new URL(url).pathname === pvpPath);
    expect(pvpRequests()).toEqual([]);
    await page.getByRole("button", { name: "Enter World Map", exact: true }).click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "worldMap");
    await expect.poll(() => pvpRequests().length).toBeGreaterThan(0);
});

test("cinematic story styles load with the reader after a normal village visit", async ({ page }) => {
    const save = uiAuditSave();
    save.character = { ...save.character, storyProgress: 0, storyTraits: [] };
    const runtime = await installUiAuditRuntime(page, save);
    await page.addInitScript(() => {
        localStorage.setItem("vnReaderMode.v1", "classic");
        localStorage.setItem("vnTextSpeed.v1", "instant");
        localStorage.setItem("vnAutoRead.v1", "0");
    });
    await expectUiAuditBoot(page, runtime, "village");
    const classic = page.locator(".visual-novel.admin-vn-play");
    await expect(classic).toBeVisible();
    await classic.getByRole("button", { name: /cinematic/i }).click();
    const stage = page.locator(".cvn-root.is-immersive");
    await expect(stage).toBeVisible();
    await expect(stage).toHaveCSS("position", "fixed");
    await expect(stage).toHaveCSS("z-index", "1000000");
    await expect(stage).toHaveCSS("background-color", "rgb(7, 9, 12)");
    const bounds = await stage.boundingBox();
    expect(bounds?.width).toBe(page.viewportSize()!.width);
    expect(bounds?.height).toBe(page.viewportSize()!.height);
});
