import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { firefox, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "../output/academy-guide");
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: false, cacheDir: "node_modules/.vite-academy-guide", plugins: [react()],
    optimizeDeps: { entries: ["e2e/fixtures/academy-guide.html"] },
    server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
await server.listen();
console.log("Academy fixture server ready", server.resolvedUrls.local[0]);
const browser = await firefox.launch({ headless: true });
console.log("Browser ready");
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
await page.clock.install();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const url = `${server.resolvedUrls.local[0]}e2e/fixtures/academy-guide.html`;
console.log(url);
const guide = page.getByRole("dialog", { name: "Academy Flame" });
const coach = page.getByRole("dialog", { name: "Academy guide", exact: true });
const clickGuide = page.locator(".academy-click-guide");
async function expectStep(selector, description) {
    await expect(clickGuide).toHaveAttribute("data-target", selector);
    await expect(clickGuide.locator(".academy-click-bubble")).toBeVisible();
    await expect(clickGuide).toContainText(description);
    const target = page.locator(selector);
    await expect(target).toBeEnabled();
    await expect(target).toHaveAttribute("aria-describedby", /academy-click-description/);
    const box = await target.boundingBox();
    const bubble = await clickGuide.locator(".academy-click-bubble").boundingBox();
    expect(bubble.y + bubble.height <= box.y || bubble.y >= box.y + box.height).toBe(true);
    expect(bubble.x).toBeGreaterThanOrEqual(0);
    expect(bubble.x + bubble.width).toBeLessThanOrEqual(page.viewportSize().width);
    expect(await target.evaluate(control => {
        const rect = control.getBoundingClientRect();
        return control.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
    })).toBe(true);
    const ring = await clickGuide.locator(".academy-click-ring").boundingBox();
    expect(Math.abs(ring.x + 3 - box.x)).toBeLessThan(2);
    expect(Math.abs(ring.y + 3 - box.y)).toBeLessThan(2);
}
async function readHint(text) {
    await page.getByRole("button", { name: "Open Academy guide" }).click();
    await expect(coach).toContainText(text);
    await coach.getByRole("button", { name: "Back to battle" }).click();
}
async function start(query = "") {
    console.log(`Checking ${query || "tutorial"}`);
    await page.goto(url + query, { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log("Fixture document loaded");
    await expect(page.locator("#mission-jutsu-select-qa-strike")).toBeVisible();
}
async function noCasts() { expect(await page.evaluate(() => window.submitted.length)).toBe(0); }
try {
    await start();
    await expect(page.locator(".combat-action-tray .academy-guide-prompt")).toHaveCount(0);
    await readHint("Selecting the card spends nothing");
    await expectStep("#mission-jutsu-select-qa-strike", "Selecting the card spends nothing");
    await page.clock.runFor(76000);
    await noCasts(); // The whole Academy practice turn is untimed, even before opening a lesson.
    await page.locator("#mission-jutsu-select-qa-strike").click();
    await expect(guide).toBeVisible();
    await expect(clickGuide).toHaveCount(0);
    await expect(guide.locator(".is-spotlight")).toContainText("Effect power");
    await expect(guide.locator(".academy-guide-metrics")).toContainText("8 / 50"); // sealed, not live-save 50
    await noCasts();
    await page.clock.runFor(76000);
    await noCasts(); // Reading must not auto-submit Wait when the normal clock expires.
    await page.screenshot({ path: path.join(output, "desktop-power.png") });
    await guide.getByRole("button", { name: "Next", exact: true }).click();
    await expect(guide).toContainText("Ninjutsu offense + Willpower + Speed");
    await expect(guide.locator(".is-spotlight")).toContainText("Jutsu mastery");
    await page.screenshot({ path: path.join(output, "desktop-scaling.png") });
    await guide.getByRole("button", { name: "Next", exact: true }).click();
    await expect(guide).toContainText("100 AP available − 60 AP = 40 AP left");
    await expect(guide).toContainText("53 CP");
    await guide.getByRole("button", { name: "Back", exact: true }).click();
    await expect(guide).toContainText("See what makes it stronger");
    await guide.getByRole("button", { name: "Next", exact: true }).click();
    await guide.getByRole("button", { name: "Choose target" }).click();
    await expect(guide).toHaveCount(0);
    await expectStep('#combat .hex-tile[data-tile="54"]', "Cast Academy Flame");
    await noCasts();
    await expect(page.locator("#mission-jutsu-select-qa-strike")).toBeFocused();
    await page.getByRole("button", { name: "View Academy Flame jutsu details", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Level 8 / 50");
    await page.getByRole("button", { name: "Close combat details", exact: true }).click();
    await page.evaluate(() => { window.rejectNext = true; });
    await page.locator(".hex-enemy.jutsu-target-tile").click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expectStep('#combat .hex-tile[data-tile="54"]', "Cast Academy Flame");
    await expect(page.locator("#mission-jutsu-select-qa-strike")).toHaveClass(/selected-action/);
    await page.locator(".hex-enemy.jutsu-target-tile").click();
    await expect(page.locator(".academy-guide-prompt")).toContainText("Tap Move");
    await expect(page.getByRole("button", { name: "Review battle log" })).toBeVisible();
    await expect(page.locator("#mission-jutsu-select-qa-strike")).toBeDisabled();
    expect(await page.evaluate(() => window.submitted.length)).toBe(2);
    await expect(clickGuide).toHaveCount(0);
    await coach.getByRole("button", { name: "Back to battle" }).click();
    await expectStep('#combat [data-academy-action="move"]', "Tap Move");
    await page.locator('[data-academy-action="move"]').click();
    const moveSelector = await clickGuide.getAttribute("data-target");
    await expectStep(moveSelector, "Move here for 30 AP");
    await page.locator(moveSelector).click();
    await expect.poll(() => page.evaluate(() => window.submitted.at(-1)?.type)).toBe("move");
    await expectStep('#combat [data-academy-action="wait"]', "Tap Wait");
    await page.locator('[data-academy-action="wait"]').click();
    await expectStep('#combat [data-academy-action="attack"]', "strike immediately");
    await page.locator('[data-academy-action="attack"]').click();
    await expect.poll(() => page.evaluate(() => window.submitted.at(-1)?.type)).toBe("attack");
    await expect(coach).toHaveCount(0);

    await start();
    await page.locator("#mission-jutsu-select-qa-guard").click();
    const guard = page.getByRole("dialog", { name: "Academy Guard" });
    await expect(guard).toContainText("deals no direct damage");
    await guard.getByRole("button", { name: "Next", exact: true }).click();
    await guard.getByRole("button", { name: "Next", exact: true }).click();
    await expect(guard).toContainText("Choose your own ninja");
    await page.keyboard.press("Escape");
    await expectStep('#combat .hex-tile[data-tile="52"]', "on yourself");
    await noCasts();
    await page.locator(".jutsu-self-target-tile").click();
    expect(await page.evaluate(() => window.submitted[0].targetId)).toBe("player");

    await start();
    await page.locator("#mission-jutsu-select-qa-flicker").click();
    await expect(page.getByRole("dialog")).toContainText("deals no direct damage");
    await page.getByRole("dialog").getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("highlighted empty tile");
    await page.getByRole("dialog").getByRole("button", { name: "Choose target" }).click();
    await expectStep(await clickGuide.getAttribute("data-target"), "Move here with Flicker");
    await noCasts();
    await page.getByRole("button", { name: /empty, jutsu move destination/ }).first().click();
    expect(await page.evaluate(() => typeof window.submitted[0].tile)).toBe("number");

    await start("?ground");
    await page.locator("#mission-jutsu-select-qa-flicker").click();
    await page.keyboard.press("Escape");
    const groundSelector = await clickGuide.getAttribute("data-target");
    await expectStep(groundSelector, "Place Practice Zone");
    await expect(page.locator(groundSelector)).toHaveClass(/ground-target-tile/);
    await noCasts();
    await page.locator(groundSelector).click();
    expect(await page.evaluate(() => window.submitted[0].type)).toBe("jutsu");

    await start("?actions");
    await expectStep('#combat [data-academy-action="wait"]', "Tap Wait");
    await expect(page.locator("#mission-jutsu-select-qa-strike")).toBeDisabled();

    await start();
    await page.locator("#mission-jutsu-select-qa-flicker").click();
    await page.getByRole("dialog").getByRole("button", { name: "Skip lessons" }).click();
    await expect(clickGuide).toHaveCount(0);
    await noCasts();
    await page.locator("#mission-jutsu-select-qa-strike").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Open Academy guide" }).click();
    await page.getByRole("button", { name: "Resume lessons" }).click();
    await expect(guide).toBeVisible();
    // Modal keyboard focus stays inside, including reverse tab from close.
    await expect(guide.getByRole("button", { name: "Close jutsu lesson" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(guide.getByRole("button", { name: "Next", exact: true })).toBeFocused();

    await start("?far");
    await page.locator("#mission-jutsu-select-qa-strike").click();
    await guide.getByRole("button", { name: "Next", exact: true }).click();
    await guide.getByRole("button", { name: "Next", exact: true }).click();
    await expect(guide).toContainText("out of range");
    await guide.getByRole("button", { name: "Return to battle" }).click();
    await expectStep('#combat [data-academy-action="move"]', "dummy is out of range");
    await readHint("Out of range");
    await expect(page.locator(".combat-action-notice")).toContainText("Out of range");
    await noCasts();

    await start("?spent");
    await expect(page.locator("#mission-jutsu-select-qa-strike")).toBeDisabled();
    await readHint("Tap Wait");
    await expectStep('#combat [data-academy-action="wait"]', "Tap Wait");
    await page.getByRole("button", { name: "Wait End turn", exact: true }).click();
    await expect(page.locator("#mission-jutsu-select-qa-strike")).toBeEnabled();
    await readHint("Selecting the card spends nothing");

    await start("?enemy");
    await readHint("Watch the dummy");
    await expectStep("#academy-coach-trigger", "dummy’s turn");
    await expect(page.locator("#mission-jutsu-select-qa-strike")).toBeDisabled();
    await noCasts();

    await start("?blocked");
    await page.locator("#mission-jutsu-select-qa-flicker").click();
    await page.getByRole("dialog").getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("no open destination");
    await page.getByRole("dialog").getByRole("button", { name: "Return to battle" }).click();
    await readHint("No open destination");
    await expectStep("#mission-jutsu-select-qa-strike", "no open destination");

    await start("?win");
    await page.locator("#mission-jutsu-select-qa-strike").click();
    await page.keyboard.press("Escape");
    await page.locator(".hex-enemy.jutsu-target-tile").click();
    await page.clock.fastForward(3000);
    await expect(page.getByRole("heading", { name: "Victory!", exact: true })).toBeVisible();
    await expect(page.locator(".academy-guide-prompt")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(clickGuide).toHaveCount(0);
    expect(await page.evaluate(() => window.settlements)).toBe(1);

    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
        await page.setViewportSize(viewport);
        await start();
        const trayBefore = await page.locator(".combat-action-tray").boundingBox();
        await expectStep("#mission-jutsu-select-qa-strike", "Selecting the card spends nothing");
        const focusedUnderHint = await page.evaluate(() => {
            const bubble = document.querySelector(".academy-click-bubble").getBoundingClientRect();
            const control = [...document.querySelectorAll(".shinobi-command-bar button:not(:disabled)")].find(button => {
                const rect = button.getBoundingClientRect();
                return rect.left < bubble.right && rect.right > bubble.left && rect.top < bubble.bottom && rect.bottom > bubble.top;
            });
            control?.focus({ preventScroll: true });
            return !!control;
        });
        if (focusedUnderHint) {
            await expect.poll(() => page.evaluate(() => {
                const hint = document.querySelector(".academy-click-bubble");
                if (hint.hidden) return true;
                const bubble = hint.getBoundingClientRect();
                const control = document.activeElement.getBoundingClientRect();
                return bubble.bottom <= control.top || bubble.top >= control.bottom || bubble.right <= control.left || bubble.left >= control.right;
            })).toBe(true);
            await noCasts();
            await page.locator("#mission-jutsu-select-qa-strike").focus();
            await expectStep("#mission-jutsu-select-qa-strike", "Selecting the card spends nothing");
        }
        await page.screenshot({ path: path.join(output, `mobile-${viewport.width}-click-jutsu.png`) });
        await expect(page.locator(".combat-action-tray .academy-guide-prompt")).toHaveCount(0);
        await page.locator("#mission-jutsu-select-qa-strike").click();
        await expect(guide).toBeVisible();
        const box = await guide.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
        expect(await guide.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await page.screenshot({ path: path.join(output, `mobile-${viewport.width}-power.png`) });
        await guide.getByRole("button", { name: "Next", exact: true }).click();
        await guide.getByRole("button", { name: "Next", exact: true }).click();
        await page.screenshot({ path: path.join(output, `mobile-${viewport.width}-target.png`) });
        await guide.getByRole("button", { name: "Choose target" }).click();
        await expectStep('#combat .hex-tile[data-tile="54"]', "Cast Academy Flame");
        // The anchor must follow a live resize, not just work on the initial viewport.
        await page.setViewportSize({ width: viewport.width + 20, height: viewport.height + 30 });
        await expectStep('#combat .hex-tile[data-tile="54"]', "Cast Academy Flame");
        await page.setViewportSize(viewport);
        await expectStep('#combat .hex-tile[data-tile="54"]', "Cast Academy Flame");
        await page.screenshot({ path: path.join(output, `mobile-${viewport.width}-click-target.png`) });
        await noCasts();
        await page.locator(".hex-enemy.jutsu-target-tile").click();
        expect(await page.evaluate(() => window.submitted.length)).toBe(1);
        await expect(coach).toBeVisible();
        await expect(clickGuide).toHaveCount(0);
        const popupBox = await coach.boundingBox();
        expect(popupBox.x).toBeGreaterThanOrEqual(0);
        expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(viewport.width);
        expect(popupBox.y + popupBox.height).toBeLessThanOrEqual(viewport.height);
        await page.screenshot({ path: path.join(output, `mobile-${viewport.width}-coach-popup.png`) });
        await page.getByRole("button", { name: "Review battle log" }).click();
        await expect(coach).toHaveCount(0);
        await expect(page.locator(".combat-main-area")).toHaveClass(/bt-log/);
        await expect(page.locator(".combat-log-scroll-region")).toBeFocused();
        await expectStep('#combat .battle-tabbar [role="tab"]:first-child', "Read the result below");
        await page.getByRole("tab", { name: "Actions", exact: true }).click();
        await expect(page.locator(".academy-guide-prompt")).toHaveCount(0);
        await expect.poll(() => page.locator(".combat-action-tray").evaluate(el => el.scrollTop)).toBe(0);
        const trayAfter = await page.locator(".combat-action-tray").boundingBox();
        expect(Math.abs(trayAfter.height - trayBefore.height)).toBeLessThan(1);
        await page.screenshot({ path: path.join(output, `mobile-${viewport.width}-follow-up.png`) });
        await page.getByRole("button", { name: "Open Academy guide" }).click();
        await expect(coach).toBeVisible();
        await coach.getByRole("button", { name: "Skip lessons" }).click();
        await expect(coach).toHaveCount(0);
        await expect(clickGuide).toHaveCount(0);
        await page.getByRole("button", { name: "Open Academy guide" }).click();
        await expect(coach.getByRole("button", { name: "Resume lessons" })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: "Open Academy guide" })).toBeFocused();
    }
    await start("?ordinary");
    await expect(clickGuide).toHaveCount(0);
    await expect(page.locator(".academy-guide-prompt")).toHaveCount(0);
    await page.locator("#mission-jutsu-select-qa-strike").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await noCasts();
    await page.clock.runFor(76000);
    await expect.poll(() => page.evaluate(() => window.submitted[0]?.type)).toBe("wait"); // Ordinary battles retain their clock.
    expect(errors).toEqual([]);
    console.log("Academy guide QA passed: power/scaling/cost, sealed values, explicit casting, rejection, self/movement utility, skip/resume, focus, range, 390px/320px layouts, ordinary-fight isolation.");
} catch (error) {
    console.error("Browser errors:", errors);
    console.error(error);
    throw error;
} finally {
    await browser.close();
    await server.close();
}
