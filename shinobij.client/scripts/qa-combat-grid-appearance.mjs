import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Start scripts/vite.combat-grid-qa.config.mjs on port 5213 first.
const output = resolve("test-results/combat-grid-appearance");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const geometry = page => page.locator(".hex-battlefield, .hex-grid-layer, .arena-top-panel, .dual-ap-panel, .basic-action-bar, .combat-jutsu-bar, .battle-side-panel").evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect();
    return [node.className, ...[r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10)];
}));
const tilePaint = page => page.locator(".hex-tile").first().evaluate(node => {
    const style = getComputedStyle(node);
    return { background: style.background, border: style.border, shadow: style.boxShadow };
});

try {
    for (const mode of ["solo", "pvp"]) for (const biome of ["forest", "snow", "volcano", "shadow", "central"]) for (const viewport of [{ width: 1440, height: 900 }, { width: 360, height: 800 }]) {
        const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.route("https://**/*", route => route.abort());
        await page.goto(`http://127.0.0.1:5213/combat-grid-qa.html?mode=${mode}&biome=${biome}`, { waitUntil: "domcontentloaded" });
        const board = page.locator(".hex-battlefield");
        const controls = page.getByRole("group", { name: "Battle grid appearance" });
        const newLook = controls.getByRole("button", { name: "New", exact: true });
        const oldLook = controls.getByRole("button", { name: "Old", exact: true });
        const move = page.locator(".basic-action-bar").getByRole("button", { name: /^Move/ });
        await expect(oldLook).toHaveAttribute("aria-pressed", "true");
        await expect(move).toBeEnabled();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(350);
        const before = await geometry(page);
        const originalPaint = await tilePaint(page);
        if (biome === "forest") await page.screenshot({ path: resolve(output, `${mode}-${viewport.width}-old.png`) });
        await newLook.click();
        await expect(board).toHaveAttribute("data-grid-look", "new");
        await expect(board).toHaveAttribute("data-grid-visible", "false");
        await page.waitForTimeout(350);
        await expect.poll(() => geometry(page)).toEqual(before);
        expect((await tilePaint(page)).background).toContain("rgba(0, 0, 0, 0)");
        expect((await tilePaint(page)).border).toContain("rgba(0, 0, 0, 0)");
        await expect(page.locator(".combat-grid-outline").first()).toHaveCSS("opacity", "0");
        const floor = await board.evaluate(node => getComputedStyle(node).backgroundImage);
        expect(floor).toContain(`${biome}-v1.webp`);
        const floorUrl = floor.match(/url\("?([^"\)]+)/)?.[1];
        expect(await page.evaluate(src => new Promise(resolve => {
            const image = new Image(); image.onload = () => resolve(image.naturalWidth > 0); image.onerror = () => resolve(false); image.src = src;
        }), floorUrl)).toBe(true);
        const corner = await controls.boundingBox();
        const bounds = await board.boundingBox();
        const strip = await page.locator(".combat-grid-environment").boundingBox();
        expect(corner.x).toBeGreaterThanOrEqual(strip.x);
        expect(corner.y).toBeGreaterThanOrEqual(strip.y);
        expect(corner.x + corner.width).toBeLessThanOrEqual(strip.x + strip.width);
        expect(corner.y + corner.height).toBeLessThanOrEqual(strip.y + strip.height + 1);
        expect(corner.y + corner.height).toBeLessThanOrEqual(bounds.y);
        expect(await board.getByRole("group", { name: "Battle grid appearance" }).count()).toBe(0);
        await page.screenshot({ path: resolve(output, `${mode}-${biome}-${viewport.width}-new.png`) });
        const grid = controls.getByRole("button", { name: "Grid", exact: true });
        await grid.click();
        await expect(board).toHaveAttribute("data-grid-visible", "true");
        await expect(page.locator(".combat-grid-outline").first()).toHaveCSS("opacity", "1");
        await grid.click();
        await expect(board).toHaveAttribute("data-grid-visible", "false");
        await move.click();
        await expect(board).toHaveAttribute("data-grid-visible", "true");
        if (mode === "solo" && viewport.width < 980) {
            await expect(page.locator(".combat-action-notice")).toHaveCount(0);
            await expect(page.getByText("Click a highlighted tile to move.", { exact: true })).toHaveCount(0);
        }
        const destinations = await page.locator(".dash-target-tile").count();
        expect(destinations).toBeGreaterThan(0);
        await oldLook.click();
        expect(await page.locator(".dash-target-tile").count()).toBe(destinations);
        await newLook.click();
        expect(await page.locator(".dash-target-tile").count()).toBe(destinations);
        if (biome === "forest") await page.screenshot({ path: resolve(output, `${mode}-${viewport.width}-targeting.png`) });
        await move.click();
        await expect(board).toHaveAttribute("data-grid-visible", "false");
        await page.locator(".combat-jutsu-button").first().click();
        await expect(board).toHaveAttribute("data-grid-visible", "true");
        await move.click();
        await move.click();
        await oldLook.click();
        await page.waitForTimeout(350);
        expect(await tilePaint(page)).toEqual(originalPaint);
        await expect.poll(() => geometry(page)).toEqual(before);
        await newLook.click();
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(newLook).toHaveAttribute("aria-pressed", "true");
        await expect(board).toHaveAttribute("data-grid-visible", "false");
        await expect(move).toBeEnabled();
        // The real screen must still submit a click on a highlighted move cell.
        await move.click();
        const player = page.locator('[data-battlefield-actor-id="player"], [data-battlefield-actor-id="p1"]').first();
        const positionBefore = await player.getAttribute("style");
        await page.locator(".dash-target-tile").first().click();
        await expect(board).toHaveAttribute("data-grid-visible", "false");
        await expect.poll(() => player.getAttribute("style")).not.toBe(positionBefore);
        expect(errors).toEqual([]);
        const result = { mode, biome, viewport, hudUnchanged: true, oldRestored: true, manualAndAutomaticGrid: true, moveSubmitted: true, errors };
        results.push(result);
        console.log(`PASS ${mode} ${biome} ${viewport.width}x${viewport.height}`);
        await context.close();
    }
} finally {
    await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
    await browser.close();
}
