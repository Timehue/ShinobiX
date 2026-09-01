import { expect, test } from "@playwright/test";
import { expectViewportSafe } from "./helpers/adaptive-assertions";
import { expectUiAuditBoot, installUiAuditRuntime } from "./helpers/ui-audit-runtime";

test("User Hub exposes manageable Friends and Blocked lists", async ({ page }) => {
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, "village");

    // The desktop rail offers Users directly; the mobile shell keeps it inside
    // the Menu sheet. count() does not auto-wait, and the rail can mount up to
    // ~1.9s after expectUiAuditBoot resolves, so sampling it straight away used
    // to read zero on a slow boot and then wait out the test clicking a "Menu"
    // trigger the desktop shell never renders. Wait for whichever shell booted
    // before branching on it.
    const users = page.getByRole("button", { name: "Users", exact: true }).filter({ visible: true });
    const menuTrigger = page.getByRole("button", { name: "Menu", exact: true }).filter({ visible: true });
    await expect(users.or(menuTrigger).first()).toBeVisible();
    if (await users.count() === 0) {
        await menuTrigger.click();
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
