import { expect, test, type Page } from "@playwright/test";

async function openGuideLibrary(page: Page) {
    await page.goto("/");
    const consent = page.getByRole("button", { name: "Got it" });
    if (await consent.isVisible()) await consent.click();
    await page.getByRole("button", { name: "Guides", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Game guides", exact: true })).toBeVisible();
}

test("public guide archive searches live systems and renders every cover", async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    await openGuideLibrary(page);

    await expect(page.getByText("11 field guides", { exact: true })).toBeVisible();
    await expect(page.locator(".guide-card")).toHaveCount(10);
    await expect(page.locator(".guide-featured")).toContainText("Your First Hour");

    const search = page.getByRole("searchbox", { name: "Search guides" });
    await search.fill("Warfront");
    await expect(page.getByText("1 guide found", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Raise a Squad You Trust" })).toBeVisible();

    await search.fill("not-a-real-system");
    await expect(page.getByText("No guides match that search", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear guide search" }).click();

    const width = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    expect(width.document).toBeLessThanOrEqual(width.viewport);
    expect(runtimeErrors).toEqual([]);
});

test("guide reader keeps navigation, focus, images, and tables responsive", async ({ page }) => {
    await openGuideLibrary(page);
    await page.getByRole("button", { name: "Read Levels, Ranks, and Daily Progress" }).click();

    await expect(page.getByRole("heading", { name: "Levels, Ranks, and Daily Progress", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The short version" })).toBeVisible();
    await expect(page.locator(".guide-reader-hero img")).toHaveJSProperty("complete", true);

    const viewportWidth = page.viewportSize()?.width ?? 0;
    const mobile = viewportWidth < 820;
    const phone = viewportWidth <= 480;
    if (mobile) await page.locator(".guide-mobile-toc summary").click();
    const toc = mobile ? page.locator(".guide-mobile-toc") : page.locator(".guide-toc");
    await toc.getByRole("button", { name: "Choosing a training timer" }).click();
    await expect(page.getByRole("heading", { name: "Choosing a training timer" })).toBeFocused();

    const layout = await page.evaluate(() => {
        const table = document.querySelector<HTMLElement>(".guide-table-wrap");
        return {
            viewport: innerWidth,
            document: document.documentElement.scrollWidth,
            tableLocalOverflow: table ? table.scrollWidth > table.clientWidth : false,
            brokenImages: [...document.images].filter((image) => image.complete && image.naturalWidth === 0).length,
        };
    });
    expect(layout.document).toBeLessThanOrEqual(layout.viewport);
    expect(layout.brokenImages).toBe(0);
    if (phone) expect(layout.tableLocalOverflow).toBe(true);

    await page.getByRole("button", { name: "All guides" }).first().click();
    await expect(page.getByRole("button", { name: "Read Levels, Ranks, and Daily Progress" })).toBeFocused();
});
