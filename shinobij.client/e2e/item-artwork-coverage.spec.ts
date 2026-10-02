import { expect, test } from "@playwright/test";
import { starterItems } from "../src/data/starter-items";
import { eventItems } from "../src/data/event-items";
import { RELIC_ROSTER } from "../../shared/relics";
import { expectUiAuditBoot, installUiAuditRuntime } from "./helpers/ui-audit-runtime";

const canonicalItemArtwork = [...starterItems, ...eventItems].map(({ id, image }) => ({ id, image }));

test("every canonical item and the Shadow Lotus bloodline ship decodable artwork", async ({ page }) => {
    // Village relics live in the event catalog, so starter-only coverage misses them.
    for (const relic of RELIC_ROSTER) {
        expect(canonicalItemArtwork.find(item => item.id === relic.id)?.image, relic.id).toBe(relic.image);
    }
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const audit = await page.evaluate(async (items) => {
        const missing = items.filter((item) => !item.image).map((item) => item.id);
        const broken: Array<{ id: string; image: string; reason: string }> = [];

        await Promise.all(items.map(async (item) => {
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
            total: items.length,
            missing,
            broken,
            shadowLotus: {
                width: shadowLotus.naturalWidth,
                height: shadowLotus.naturalHeight,
            },
        };
    }, canonicalItemArtwork);

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
