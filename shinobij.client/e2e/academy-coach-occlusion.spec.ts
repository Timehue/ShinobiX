import { expect, test, type Locator } from "@playwright/test";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

/*
 * The Academy companion banner is FIXED to the bottom of the viewport at
 * z-index 9000 — far above --z-modal (1100) and the mobile Shinobi Menu
 * (z 2000). Every dialog opened during the tutorial therefore had the coach's
 * own speech bubble painted across it: on a phone the bubble lay over the
 * Inventory popup's "Equip to Body" button during the very beat that tells the
 * player to equip their starter gear.
 *
 * This measures PAINT, not taps, and that distinction is the whole point. The
 * banner is pointer-events:none, so document.elementFromPoint looks straight
 * through it and every click-based assertion passes while the bubble sits on
 * top of the button — "you can still click around the cat", as the bug report
 * put it. What broke was reading the screen, so what is asserted here is that
 * no visible banner box overlaps a dialog's controls.
 *
 * Scoped to one phone and one desktop project for the same reason the screen
 * walk is (see playwright.config.ts): this measures layering at a viewport, and
 * two viewports answer that question — the other five would pay for the same
 * answer.
 */
const MEASURED_PROJECTS = new Set(["chromium-mobile", "chromium-desktop"]);
const PHONE_PROJECTS = new Set(["chromium-mobile"]);

const COACH_BANNER = ".onboarding-coach-banner";

/** Is the coaching banner painted over this control's box? */
async function bannerOverlap(locator: Locator): Promise<{ obstructed: boolean; detail: string }> {
    await locator.scrollIntoViewIfNeeded();
    return locator.evaluate((element) => {
        const banner = document.querySelector<HTMLElement>(".onboarding-coach-banner");
        if (!banner) return { obstructed: false, detail: "no banner mounted" };
        const style = getComputedStyle(banner);
        const painted = style.visibility !== "hidden"
            && style.display !== "none"
            && Number(style.opacity || "1") > 0.01;
        const control = element.getBoundingClientRect();
        const bubble = banner.getBoundingClientRect();
        const overlaps = control.left < bubble.right && bubble.left < control.right
            && control.top < bubble.bottom && bubble.top < control.bottom;
        return {
            obstructed: painted && overlaps,
            detail: `control ${Math.round(control.top)}..${Math.round(control.bottom)}`
                + ` vs banner ${Math.round(bubble.top)}..${Math.round(bubble.bottom)}`
                + ` (painted=${painted})`,
        };
    });
}

async function expectUnobstructed(locator: Locator, label: string) {
    await expect(locator, `${label} must be on screen`).toBeVisible();
    const { obstructed, detail } = await bannerOverlap(locator);
    expect(obstructed, `the coaching banner is painted over ${label} — ${detail}`).toBe(false);
}

function academySave(onboardingStep: string) {
    const save = uiAuditSave();
    return {
        ...save,
        character: {
            ...save.character,
            onboardingStep,
            // No pet: the bubble runs under a plain "Academy Guide" label
            // without one, which keeps the live 3D companion out of a layering
            // measurement.
            equipment: {},
        },
    };
}

test("the Academy banner stands down for the Inventory popup it tells you to use", async ({ page }, testInfo) => {
    test.skip(!MEASURED_PROJECTS.has(testInfo.project.name), "layering is measured on one phone and one desktop viewport");

    const runtime = await installUiAuditRuntime(page, academySave("inventory"));
    await expectUiAuditBoot(page, runtime, "inventory");

    // The fixture is only meaningful if the tutorial banner is actually up.
    const banner = page.locator(COACH_BANNER);
    await expect(banner).toBeVisible();

    const gearTile = page.locator(".backpack-item.academy-click-target").first();
    await expectUnobstructed(gearTile, "the highlighted starter gear tile");
    await gearTile.click();

    const popup = page.locator(".item-popup-modal");
    await expect(popup).toBeVisible();
    // The banner must be out of the way for as long as the dialog owns the screen.
    await expect(banner).toBeHidden();
    await expectUnobstructed(popup.getByRole("button", { name: /^Equip to / }), "the Equip button");
    await expectUnobstructed(popup.getByRole("button", { name: "Close item details" }), "the popup's Close button");

    await page.getByRole("button", { name: "Close item details" }).click();
    await expect(popup).toBeHidden();
    // ...and it must come straight back, or the player loses the next instruction.
    await expect(banner).toBeVisible();
});

test("the Academy banner stands down for the Jutsu Hall's mobile lesson dialog", async ({ page }, testInfo) => {
    test.skip(!PHONE_PROJECTS.has(testInfo.project.name), "the jutsu info dialog is the phone-only branch of this screen");

    const runtime = await installUiAuditRuntime(page, academySave("jutsu"));
    await expectUiAuditBoot(page, runtime, "jutsuTraining");

    const banner = page.locator(COACH_BANNER);
    await expect(banner).toBeVisible();

    await page.getByRole("listbox", { name: "Jutsu library" }).locator(".technique-card").first().click();

    const lesson = page.locator(".jutsu-mobile-info-modal");
    await expect(lesson).toBeVisible();
    await expect(banner).toBeHidden();
    await expectUnobstructed(lesson.locator(".jutsu-mobile-train-action"), "the jutsu lesson button");
});

test("the Academy banner stands down for the mobile Shinobi Menu", async ({ page }, testInfo) => {
    test.skip(!PHONE_PROJECTS.has(testInfo.project.name), "the Shinobi Menu is the phone shell's navigation");

    const runtime = await installUiAuditRuntime(page, academySave("training"));
    await expectUiAuditBoot(page, runtime, "village");

    const banner = page.locator(COACH_BANNER);
    await expect(banner).toBeVisible();

    await page.getByRole("button", { name: "Menu", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "Shinobi menu" });
    await expect(menu).toBeVisible();
    await expect(banner).toBeHidden();

    // The menu scrolls, and its own bottom padding reserves nothing for the
    // banner — so the last destination is the one that used to sit under it.
    const destinations = menu.locator(".mobile-menu-btn");
    await expect(destinations.first()).toBeVisible();
    await expectUnobstructed(destinations.last(), "the last Shinobi Menu destination");
});
