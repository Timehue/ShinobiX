import { expect, test } from "@playwright/test";
import { expectUiAuditBoot, installUiAuditRuntime } from "./helpers/ui-audit-runtime";

// src/lib/imageErrorGuard.ts hides a failed same-origin image and retries it.
// The DOM leaves Window out of a "load" event's path, so a guard that listened
// for the retry's load on window never saw it. Every image that recovered then
// stayed hidden until its element was replaced, so a phone that dropped one
// request kept a blank slot where the artwork belonged.
test("a same-origin image that recovers on retry is shown again", async ({ page }) => {
    const runtime = await installUiAuditRuntime(page);
    const attempts: string[] = [];
    await page.route((url) => url.searchParams.has("guard-probe"), (route) => {
        attempts.push(new URL(route.request().url()).search);
        return attempts.length === 1 ? route.abort("failed") : route.continue();
    });
    await expectUiAuditBoot(page, runtime, "village");

    await page.evaluate(() => {
        const img = document.createElement("img");
        img.id = "image-guard-probe";
        img.alt = "";
        img.width = 64;
        img.height = 64;
        img.src = "/bloodline-ashen-eyes.webp?guard-probe=1";
        document.body.append(img);
    });

    const image = page.locator("#image-guard-probe");
    await expect.poll(() => attempts.length, "the guard should retry the failed image once").toBe(2);
    expect(attempts[1]).toContain("__img_retry=1");
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(image, "the recovered image must not stay hidden").toBeVisible();
});
