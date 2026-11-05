import { expect, test, type Page } from "@playwright/test";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

// The Training Hall's jutsu library carries the same grid/list switch as the
// Profile's learned-jutsu page. Phones used to be locked to a one-column list;
// now either view works at every width, and the choice is remembered.

const columns = (page: Page) => page.locator(".jutsu-training-screen .technique-grid").evaluate(
    (grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length,
);

test("the Jutsu Hall library switches between grid and list and remembers the choice", async ({ page }, testInfo) => {
    const runtime = await installUiAuditRuntime(page, uiAuditSave());
    await expectUiAuditBoot(page, runtime, "jutsuTraining");

    const toggle = page.getByRole("group", { name: "Library view" });
    const gridButton = toggle.getByRole("button", { name: "Grid view" });
    const listButton = toggle.getByRole("button", { name: "List view" });
    await expect(toggle).toBeVisible();
    const library = page.locator(".jutsu-training-screen .technique-grid");
    await expect(library.locator(".technique-card").first()).toBeVisible();

    await gridButton.click();
    await expect(gridButton).toHaveAttribute("aria-pressed", "true");
    await expect(library).toHaveClass(/is-grid-view/);
    expect(await columns(page), "grid view lays the cards out side by side").toBeGreaterThanOrEqual(2);
    // In grid view the art sits above the name, not beside it.
    const card = library.locator(".technique-card").first();
    const thumb = await card.locator(".technique-thumb").boundingBox();
    const name = await card.locator(".technique-name").boundingBox();
    expect(thumb && name && name.y >= thumb.y + thumb.height - 1, "the name sits under the art").toBe(true);
    await library.screenshot({ path: testInfo.outputPath("library-grid.png") });
    expect(await sidewaysScroll(page), "grid view never scrolls the page sideways").toBeLessThanOrEqual(1);
    expect(await longNameCollisions(page), "a long name stays clear of the AP badge and the ?").toEqual([]);

    await listButton.click();
    await expect(listButton).toHaveAttribute("aria-pressed", "true");
    await expect(library).toHaveClass(/is-list-view/);
    expect(await columns(page), "list view is one row per jutsu").toBe(1);
    const rowThumb = await card.locator(".technique-thumb").boundingBox();
    const rowName = await card.locator(".technique-name").boundingBox();
    expect(rowThumb && rowName && rowName.x >= rowThumb.x + rowThumb.width - 1, "the name sits beside the art").toBe(true);
    await library.screenshot({ path: testInfo.outputPath("library-list.png") });
    expect(await sidewaysScroll(page), "list view never scrolls the page sideways").toBeLessThanOrEqual(1);
    expect(await longNameCollisions(page), "a long name stays clear of the AP badge and the ?").toEqual([]);

    // The choice survives a reload. Both directions, because the first-visit
    // default differs by width (list on phones, grid wider), so a single
    // direction passes without storage on half the projects.
    const pressed = (name: string) => page.getByRole("group", { name: "Library view" }).getByRole("button", { name });
    await page.reload();
    await expect(pressed("List view")).toHaveAttribute("aria-pressed", "true");
    await pressed("Grid view").click();
    await page.reload();
    await expect(pressed("Grid view")).toHaveAttribute("aria-pressed", "true");
});

const sidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * Gives the first card a long name and reports any overlap between the name's
 * text and the AP badge or the "?" circle. jutsu-frames.css's layered
 * !important padding defeats ordinary padding overrides, so this is measured,
 * not assumed.
 */
function longNameCollisions(page: Page) {
    return page.evaluate(() => {
        const card = document.querySelector<HTMLElement>(".jutsu-training-screen .technique-card")!;
        const name = card.querySelector<HTMLElement>(".technique-name")!;
        const original = name.textContent;
        name.textContent = "Thousand Crimson Mirror Hallucination Nightmare Rupture Technique";
        const range = document.createRange();
        range.selectNodeContents(name);
        const lines = [...range.getClientRects()];
        const found: string[] = [];
        const dot = card.closest(".technique-card-slot")?.querySelector<HTMLElement>(".technique-info-btn > span");
        const targets: Array<[string, Element | null | undefined]> = [["AP badge", card.querySelector(".technique-cost")], ["?", dot]];
        for (const [label, el] of targets) {
            if (!el || getComputedStyle(el).display === "none" || el.getClientRects().length === 0) continue;
            const b = el.getBoundingClientRect();
            if (lines.some((r) => Math.min(r.right, b.right) > Math.max(r.left, b.left) && Math.min(r.bottom, b.bottom) > Math.max(r.top, b.top))) found.push(label);
        }
        name.textContent = original;
        return found;
    });
}
