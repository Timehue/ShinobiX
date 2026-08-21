import { expect, test } from "@playwright/test";
import { expectUiAuditBoot, installUiAuditRuntime } from "./helpers/ui-audit-runtime";

test("every canonical item and the Shadow Lotus bloodline ship decodable artwork", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const audit = await page.evaluate(async () => {
        const { starterItems } = await import("/src/data/starter-items.ts");
        const missing = starterItems.filter((item) => !item.image).map((item) => item.id);
        const broken: Array<{ id: string; image: string; reason: string }> = [];

        await Promise.all(starterItems.map(async (item) => {
            if (!item.image) return;
            try {
                const image = new Image();
                image.src = item.image;
                await image.decode();
                if (image.naturalWidth < 96 || image.naturalHeight < 96) {
                    broken.push({
                        id: item.id,
                        image: item.image,
                        reason: `${image.naturalWidth}x${image.naturalHeight}`,
                    });
                }
            } catch {
                broken.push({ id: item.id, image: item.image, reason: "decode failed" });
            }
        }));

        const shadowLotus = new Image();
        shadowLotus.src = "/bloodline-shadow-lotus-v2.webp";
        await shadowLotus.decode();

        return {
            total: starterItems.length,
            missing,
            broken,
            shadowLotus: {
                width: shadowLotus.naturalWidth,
                height: shadowLotus.naturalHeight,
            },
        };
    });

    expect(audit.total).toBeGreaterThanOrEqual(155);
    expect(audit.missing).toEqual([]);
    expect(audit.broken).toEqual([]);
    expect(audit.shadowLotus).toEqual({ width: 1024, height: 1024 });
});

test("built-in Bloodline Codex cards use authoritative artwork", async ({ page }, testInfo) => {
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, "centralHub");
    await page.getByRole("button", { name: "Ancient Archives" }).click();

    for (const image of [
        "/bloodline-ashen-eyes.webp",
        "/bloodline-inferno-cataclysm.webp",
        "/bloodline-shadow-lotus-v2.webp",
        "/bloodline-iron-fang.webp",
    ]) {
        const artwork = page.locator(`img[src="${image}"]`);
        await expect(artwork).toBeVisible();
        await expect.poll(() => artwork.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);
    }

    const shadowLotusCard = page.locator(".archives-card").filter({ hasText: "Shadow Lotus" });
    const portrait = shadowLotusCard.locator('img[src="/bloodline-shadow-lotus-v2.webp"]');
    await expect(portrait).toHaveJSProperty("naturalWidth", 1024);
    await expect(portrait).toHaveJSProperty("naturalHeight", 1024);
    await shadowLotusCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);

    if (process.env.UI_AUDIT_CAPTURE === "1") {
        await page.screenshot({ path: testInfo.outputPath("shadow-lotus-codex.png"), fullPage: false });
    }
});
