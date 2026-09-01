import { expect, test } from "@playwright/test";
import { expectViewportSafe } from "./helpers/adaptive-assertions";
import { expectUiAuditBoot, installUiAuditRuntime } from "./helpers/ui-audit-runtime";

test("User Hub exposes manageable Friends and Blocked lists", async ({ page }) => {
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, "village");

    let users = page.getByRole("button", { name: "Users", exact: true }).filter({ visible: true });
    if (await users.count() === 0) {
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        users = page.getByRole("button", { name: "Users", exact: true }).filter({ visible: true });
    }
    await users.click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "userHub");

    const tabs = page.locator(".user-hub-tabs");
    await expect(tabs.getByRole("button", { name: "All", exact: true })).toBeVisible();
    await expect(tabs.getByRole("button", { name: /Following/ })).toBeVisible();

    await tabs.getByRole("button", { name: /Friends/ }).click();
    const friendName = page.getByLabel("Add a friend by player name");
    const addFriend = page.getByRole("button", { name: "Add Friend" });
    await expect(friendName).toHaveAttribute("placeholder", "Enter exact player name…");
    await expect(addFriend).toBeDisabled();
    await friendName.fill("RivalNinja");
    await expect(addFriend).toBeEnabled();

    await tabs.getByRole("button", { name: /Blocked/ }).click();
    const blockedName = page.getByLabel("Block a player by name");
    const blockPlayer = page.getByRole("button", { name: "Block Player" });
    await expect(blockedName).toHaveAttribute("placeholder", "Enter exact player name…");
    await expect(blockPlayer).toBeDisabled();
    await blockedName.fill("RivalNinja");
    await expect(blockPlayer).toBeEnabled();

    await expectViewportSafe(page, { horizontalScrollers: [".user-hub-tabs"] });
});
