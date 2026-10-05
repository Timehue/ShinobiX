import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

function fieldSave() {
    const save = uiAuditSave();
    save.currentSector = 1;
    save.currentBiome = "forest";
    return save;
}

async function bootInField(page: Page, screen: string) {
    const runtime = await installUiAuditRuntime(page, fieldSave());
    await expectUiAuditBoot(page, runtime, screen);
    await expect(page.locator(`.app-shell[data-screen="${screen}"]`)).toBeVisible();
    return runtime;
}

test("desktop right menu keeps the world overview reachable across menus and reloads", async ({ page }, info: TestInfo) => {
    // Desktop-only: the right-hand menu does not exist on the touch layouts,
    // which navigate through the bottom bar instead.
    test.skip(Boolean(info.project.use.isMobile), "The right menu is not rendered on touch layouts.");
    await bootInField(page, "missions");
    const rightMenu = page.locator(".right-menu-panel");

    // The field-only World Map / Return to Village pair was removed; the World
    // group's World Map entry is the single overview shortcut.
    await expect(rightMenu.getByRole("button", { name: "World Map", exact: true })).toHaveCount(1);
    await expect(rightMenu.getByRole("button", { name: "Return to Village", exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("desktop-field-navigation.png"), animations: "disabled" });

    await rightMenu.getByRole("button", { name: "Guides", exact: true }).click();
    await expect(page.locator('.app-shell[data-screen="guides"]')).toBeVisible();
    await rightMenu.getByRole("button", { name: "Tavern", exact: true }).click();
    await expect(page.locator('.app-shell[data-screen="tavern"]')).toBeVisible();

    await rightMenu.getByRole("button", { name: "World Map", exact: true }).click();
    await expect(page.locator(".world-atlas-card")).toBeVisible();
    await expect(page.locator(".sector-image-map")).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.app-shell[data-screen="worldMap"]')).toBeVisible();
    // The map's first mount after a reload reopens the field sector. Let that
    // restore land before asking for the overview, or it can win over the click.
    await expect(page.locator(".sector-image-map, .world-atlas-card").first()).toBeVisible();
    await rightMenu.getByRole("button", { name: "World Map", exact: true }).click();
    await expect(page.locator(".world-atlas-card")).toBeVisible();
    await expect(page.locator(".sector-image-map")).toHaveCount(0);
});

test("Tavern's Village return travels home from the field", async ({ page }) => {
    await bootInField(page, "tavern");
    await page.getByRole("button", { name: "← Village", exact: true }).click();
    await expect(page.locator('.app-shell[data-screen="village"]')).toBeVisible();
});

test("mobile profile shows the live field weather and the World Map shortcut opens the overview", async ({ page }, info: TestInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await bootInField(page, "worldMap");
    await expect(page.locator(".world-atlas-card")).toBeVisible();
    await page.screenshot({ path: info.outputPath("mobile-world-overview.png"), animations: "disabled" });

    const returnToSector = page.getByRole("button", { name: /Return to Sector 1/ });
    await expect(returnToSector).toBeVisible();
    await returnToSector.click();
    await expect(page.locator(".sector-image-map")).toBeVisible();
    const hudWeather = page.locator(".sector-hud-weather");
    await expect(hudWeather).toBeVisible();
    const currentSky = await hudWeather.locator(".sector-sky-current").innerText();
    expect(currentSky, "sector HUD should expose its current sky before the forecast").not.toBe("");

    await page.getByRole("button", { name: "You", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Your shinobi" });
    const profileWeather = sheet.locator(".left-profile-stat").filter({ hasText: /^Weather/ });
    await expect(profileWeather).toHaveText(`Weather ${currentSky}`);
    await page.screenshot({ path: info.outputPath("mobile-profile-live-weather.png"), animations: "disabled" });
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "World Map", exact: true }).click();
    await expect(page.locator(".world-atlas-card")).toBeVisible();
    await expect(page.locator(".sector-image-map")).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.app-shell[data-screen="worldMap"]')).toBeVisible();
    if (await page.locator(".world-atlas-card").isVisible()) {
        await page.getByRole("button", { name: /Return to Sector 1/ }).click();
    }
    await expect(page.locator(".sector-image-map")).toBeVisible();
    const refreshedCurrentSky = await page.locator(".sector-hud-weather .sector-sky-current").innerText();
    await page.getByRole("button", { name: "You", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Your shinobi" }).locator(".left-profile-stat").filter({ hasText: /^Weather/ }))
        .toHaveText(`Weather ${refreshedCurrentSky}`);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "World Map", exact: true }).click();
    await expect(page.locator(".world-atlas-card")).toBeVisible();
    await expect(page.locator(".sector-image-map")).toHaveCount(0);
    await page.getByRole("button", { name: "Village", exact: true }).click();
    await expect(page.locator('.app-shell[data-screen="village"]')).toBeVisible();
});
