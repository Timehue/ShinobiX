import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { firefox, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "../output/training-guide");
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: false, cacheDir: "node_modules/.vite-training-guide", plugins: [react()],
    optimizeDeps: { entries: ["e2e/fixtures/training-guide.html"] }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
await server.listen();
console.log("Training fixture ready", server.resolvedUrls.local[0]);
const browser = await firefox.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const starts = [];
let acceptTraining = false;
await page.route("**/api/training/start", async route => {
    const request = route.request().postDataJSON();
    starts.push(request);
    if (acceptTraining) {
        const character = await page.evaluate(() => window.trainingFixtureCharacter);
        const now = Date.now();
        await route.fulfill({ json: { token: "qa-training", _saveVersion: 1,
            character: { ...character, level: 2, stamina: character.stamina - 5 },
            activeTraining: { token: "qa-training", label: `15 Minutes ${request.stat} Training`, stat: request.stat,
                xp: 0, statGain: 15, staminaCost: 5, startedAt: now, endsAt: now + 900000, durationMs: 900000 },
        } });
        return;
    }
    // An intentional local rejection lets us inspect the selected stat/tier without granting anything.
    await route.fulfill({ status: 400, json: { error: "QA: no training was started" } });
});
page.on("dialog", dialog => dialog.dismiss());
try {
    for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: width === 320 ? 568 : width === 390 ? 844 : 1000 });
        for (const [bloodline, stat, label, discipline, secondGeneral] of [
            ["Ashen Eyes", "intelligence", "Intelligence", "Genjutsu", "Willpower"], ["Inferno Cataclysm", "willpower", "Willpower", "Ninjutsu", "Speed"],
            ["Shadow Lotus", "intelligence", "Intelligence", "Bukijutsu", "Strength"], ["Iron Fang", "strength", "Strength", "Taijutsu", "Speed"],
        ]) {
            acceptTraining = false;
            console.log(`Checking ${bloodline} at ${width}px`);
            await page.goto(`${server.resolvedUrls.local[0]}e2e/fixtures/training-guide.html?bloodline=${encodeURIComponent(bloodline)}`, { timeout: 90000 });
            const recommended = page.locator('.stat-grid .academy-click-target');
            await expect(recommended).toHaveCount(1);
            await expect(recommended).toHaveAttribute("data-training-stat", stat);
            await expect(recommended).toContainText("Recommended");
            expect(await page.locator(".training-stat-name").evaluateAll(labels => labels.every(label => {
                const name = label.getBoundingClientRect();
                const tile = label.closest("button").getBoundingClientRect();
                return name.left >= tile.left && name.right <= tile.right;
            }))).toBe(true);
            const banner = page.locator(".onboarding-coach-banner");
            await expect(banner).toContainText("Ripple Seal");
            await expect(banner).toContainText(`I'd start with ${label} or ${secondGeneral}`);
            await expect(banner).toContainText(`Your ${bloodline} bloodline uses ${discipline} offense.`);
            await expect.poll(async () => {
                const control = await recommended.boundingBox();
                const speech = await banner.boundingBox();
                return !!control && !!speech && control.y >= 0 && control.y + control.height <= speech.y;
            }).toBe(true);
            await expect(banner).toBeVisible();
            await page.screenshot({ path: path.join(output, `${bloodline.replaceAll(" ", "-")}-${width}.png`) });
            if (width <= 390) {
                // Let font layout and the coach's 180ms initial reveal finish
                // before deliberately scrolling the target under the bubble.
                await page.evaluate(() => document.fonts.ready);
                await page.waitForTimeout(250);
                const originalScroll = await page.evaluate(() => window.scrollY);
                await recommended.evaluate(control => {
                    const target = control.getBoundingClientRect();
                    const guide = document.querySelector(".onboarding-coach-banner").getBoundingClientRect();
                    window.scrollBy(0, target.top + target.height / 2 - guide.top - guide.height / 2);
                });
                await expect(banner).toBeHidden();
                // This is a real click where the opaque pet bubble would otherwise paint over the stat.
                await recommended.click();
                await expect(page.getByRole("dialog", { name: `Train ${label}` })).toBeVisible();
                await page.keyboard.press("Escape");
                await page.evaluate(top => window.scrollTo(0, top), originalScroll);
                await expect(banner).toBeVisible();
            }
            await recommended.click();
            const modal = page.getByRole("dialog", { name: `Train ${label}` });
            await expect(modal).toBeVisible();
            await expect(banner).toBeHidden();
            await expect(modal.locator(".academy-click-target")).toHaveCount(1);
            await expect(modal.locator(".academy-click-target")).toContainText("Start 15 Minutes");
            await page.keyboard.press("Escape");
            await expect(banner).toBeVisible();
            // Advice never locks the player to that stat or starts training on selection.
            const before = starts.length;
            await page.locator('[data-training-stat="speed"]').click();
            await expect(page.getByRole("dialog", { name: "Train Speed" })).toBeVisible();
            expect(starts.length).toBe(before);
            await page.getByRole("button", { name: /Start 15 Minutes/ }).click();
            await expect.poll(() => starts.length).toBe(before + 1);
            expect(starts.at(-1)).toMatchObject({ stat: "speed", tierId: "15m" });
            await expect(page.getByRole("button", { name: /Start 15 Minutes/ })).toBeEnabled();
            await expect(page.locator("main")).toHaveAttribute("data-onboarding-step", "training");
            await page.keyboard.press("Escape");
            await expect(banner).toBeVisible();
            // A successful response binds the selected stat to the running timer and advances the coach.
            await recommended.click();
            acceptTraining = true;
            await page.getByRole("button", { name: /Start 15 Minutes/ }).click();
            await expect(page.getByRole("dialog")).toHaveCount(0);
            expect(starts.at(-1)).toMatchObject({ stat, tierId: "15m" });
            await expect(page.locator(".summary-box")).toContainText(`15 Minutes ${stat} Training`);
            await expect(page.locator("main")).toHaveAttribute("data-onboarding-step", "jutsu");
            await expect(page.locator(".stat-grid .academy-click-target")).toHaveCount(0);
            await expect(banner).toContainText("Pick any untrained jutsu");
        }
    }
    expect(errors).toEqual([]);
    console.log("Training recommendations passed: four bloodlines, matching companion and tile, 15m prompt, player override, desktop/mobile, no banner occlusion.");
} catch (error) {
    await page.screenshot({ path: path.join(output, "failure.png") });
    throw error;
} finally {
    await browser.close();
    await server.close();
}
