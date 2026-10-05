import { expect, test } from "@playwright/test";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

test("controller can move through and change the real story and audio settings", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "the focused Settings controller integration runs once on Chromium desktop");
    await page.setViewportSize({ width: 1024, height: 768 });
    const save = uiAuditSave();
    const runtime = await installUiAuditRuntime(page, save);
    await page.addInitScript(() => {
        localStorage.setItem("audioVolume.v1", "0.5");
        localStorage.setItem("audioMuted", "0");
        const pad = {
            id: "Standard test controller", index: 0, mapping: "standard", connected: true, timestamp: 0,
            axes: [0, 0],
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
        (window as Window & { testGamepad?: typeof pad }).testGamepad = pad;
    });
    const press = async (index: number) => {
        await page.evaluate((button) => {
            const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
            pad.buttons[button] = { pressed: true, value: 1 };
        }, index);
        await page.waitForTimeout(50);
        await page.evaluate((button) => {
            const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
            pad.buttons[button] = { pressed: false, value: 0 };
        }, index);
        await page.waitForTimeout(50);
    };

    await expectUiAuditBoot(page, runtime, "settings");
    await expect(page.locator("html")).toHaveAttribute("data-gamepad-connected", "true");
    await expect(page.getByText("Controller: D-pad up/down moves between settings", { exact: false })).toBeVisible();

    const reader = page.locator("#settings-reader");
    await press(14); // D-pad left enters controller focus from the page's initial center.
    await expect(reader).toBeFocused();
    await expect(reader).toHaveValue("cinematic");
    await press(15); // D-pad right changes the focused choice.
    await expect(reader).toHaveValue("classic");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("vnReaderMode.v1"))).toBe("classic");

    const volume = page.locator("#settings-volume");
    await press(13); // D-pad down leaves the choice and focuses the next setting.
    await expect(volume).toBeFocused();
    await press(15); // D-pad right changes the focused range.
    await expect(volume).toHaveValue("51");
    await expect(page.locator(".settings-volume-label output")).toHaveText("51%");

    const mute = page.getByRole("checkbox", { name: "Mute all audio" });
    await press(13);
    await expect(mute).toBeFocused();
    await press(0); // A toggles the focused setting.
    await expect(mute).toBeChecked();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("audioMuted"))).toBe("1");
    await page.screenshot({ path: test.info().outputPath("gamepad-settings.png"), fullPage: true });
});


test("controller can open Settings from the real in-game menu", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "the focused Settings controller integration runs once on Chromium desktop");
    await page.setViewportSize({ width: 1024, height: 768 });
    const runtime = await installUiAuditRuntime(page, uiAuditSave());
    await page.addInitScript(() => {
        const pad = {
            id: "Standard test controller", index: 0, mapping: "standard", connected: true, timestamp: 0,
            axes: [0, 0],
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
        (window as Window & { testGamepad?: typeof pad }).testGamepad = pad;
    });
    const press = async (index: number) => {
        await page.evaluate((button) => {
            const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
            pad.buttons[button] = { pressed: true, value: 1 };
        }, index);
        await page.waitForTimeout(50);
        await page.evaluate((button) => {
            const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
            pad.buttons[button] = { pressed: false, value: 0 };
        }, index);
        await page.waitForTimeout(50);
    };

    await expectUiAuditBoot(page, runtime, "profile");
    await expect(page.locator("html")).toHaveAttribute("data-gamepad-connected", "true");
    const settings = page.getByRole("button", { name: "Settings", exact: true });
    await expect(settings).toBeVisible();
    await press(15); // Enter the right-side menu from the page center.
    for (let step = 0; step < 10; step += 1) {
        if (await settings.evaluate(element => element === document.activeElement)) break;
        await press(13);
    }
    await expect(settings).toBeFocused();
    await press(0);
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "settings");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
});
