import { expect, test, type Page } from "@playwright/test";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave, type UiAuditSave } from "./helpers/ui-audit-runtime";

// Shinobi Supporter perk: the Profile "Build" dossier swaps the active
// bloodline from a dropdown. Players without the subscription keep the plain
// name, and the swap only lands once the save endpoint acknowledges it.

const STARTER_ID = "starter-bloodline-ashen-eyes";
const CUSTOM_ID = "bl-audit-wood";

function pickerSave(patreon: Record<string, unknown> | null): UiAuditSave {
    const save = uiAuditSave();
    save.character = {
        ...save.character,
        equippedBloodlineId: CUSTOM_ID,
        ...(patreon ? { patreon } : {}),
    };
    save.savedBloodlines = [{
        id: CUSTOM_ID,
        name: "Branks Pegger",
        rank: "A Rank",
        specialElement: "Wood",
        jutsus: [],
        totalPoints: 0,
    }];
    return save;
}

function buildRow(page: Page) {
    return page.locator(".profile-dossier-section")
        .filter({ hasText: "Build" })
        .locator(".profile-dossier-row")
        .filter({ hasText: "Bloodline" })
        .first();
}

test("a supporter swaps the active bloodline from the Profile build dossier", async ({ page }, testInfo) => {
    const runtime = await installUiAuditRuntime(page, pickerSave({ active: true }));
    const equipIntents: string[] = [];
    page.on("request", (request) => {
        const intent = request.headers()["x-bloodline-equip-intent"];
        if (intent && request.method() === "POST") equipIntents.push(intent);
    });
    await expectUiAuditBoot(page, runtime, "profile");

    const picker = buildRow(page).getByRole("combobox", { name: "Active bloodline" });
    await expect(picker).toBeVisible();
    await expect(picker).toHaveValue(CUSTOM_ID);
    await expect(picker.locator("option")).toHaveText(["Ashen Eyes · A Rank", "Branks Pegger · A Rank"]);

    // The control is a real touch target on a phone, like every other one.
    const minimum = (page.viewportSize()?.width ?? 1366) <= 979 ? 44 : 24;
    const box = await picker.boundingBox();
    expect(Math.min(box?.width ?? 0, box?.height ?? 0)).toBeGreaterThanOrEqual(minimum);
    // The row stacks so the dropdown spans it; beside its label it cut the name off.
    const rowBox = await buildRow(page).boundingBox();
    expect(box?.width ?? 0, "the bloodline dropdown should span its dossier row").toBeGreaterThanOrEqual((rowBox?.width ?? 0) * 0.85);
    await page.locator(".profile-dossier-section").filter({ hasText: "Build" })
        .screenshot({ path: testInfo.outputPath("profile-bloodline-picker.png"), animations: "disabled" });

    await picker.selectOption(STARTER_ID);
    const confirm = page.getByRole("alertdialog", { name: "Swap bloodline" });
    await expect(confirm).toContainText("Equip Ashen Eyes?");
    await confirm.getByRole("button", { name: "Equip" }).click();

    await expect(picker).toHaveValue(STARTER_ID);
    expect(equipIntents).toContain(STARTER_ID);
    await expect(page.getByRole("complementary", { name: "Device and server saves diverged" })).toHaveCount(0);
});

test("cancelling the swap keeps the current bloodline", async ({ page }) => {
    const runtime = await installUiAuditRuntime(page, pickerSave({ active: true }));
    await expectUiAuditBoot(page, runtime, "profile");

    const picker = buildRow(page).getByRole("combobox", { name: "Active bloodline" });
    await picker.selectOption(STARTER_ID);
    const confirm = page.getByRole("alertdialog", { name: "Swap bloodline" });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(picker).toHaveValue(CUSTOM_ID);
});

test("a player without the subscription sees the bloodline name, not a dropdown", async ({ page }) => {
    const runtime = await installUiAuditRuntime(page, pickerSave(null));
    await expectUiAuditBoot(page, runtime, "profile");

    const row = buildRow(page);
    await expect(row).toContainText("Branks Pegger");
    await expect(row).toContainText("A Rank");
    await expect(row).not.toContainText("A Rank rank");
    await expect(row.getByRole("combobox")).toHaveCount(0);
});
