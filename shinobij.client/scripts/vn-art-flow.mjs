// Exercise production VN navigation and cache contracts without an account.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve("../tmp/vn-art-audit/flows");
await mkdir(output, { recursive: true });
const inventory = JSON.parse(await readFile("../tmp/vn-art-audit/current.json", "utf8"));
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
const report = { checks: [], errors: [], writes: [] };
const origin = "http://127.0.0.1:4173";
const event = "story-ashen-leaf-village-4-0";
const rows = inventory.rows.filter((r) => r.eventId === event && !r.key.includes(":archive-"));
const lastLine = (index) => rows.find((r) => r.pageIndex === index).presentations.length - 1;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
async function newPage(options = {}) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", ...options });
    page.on("pageerror", (error) => report.errors.push(error.message));
    page.on("request", (request) => { if (/\/api\//.test(request.url()) && !["GET", "HEAD", "OPTIONS"].includes(request.method())) report.writes.push(request.url()); });
    await page.addInitScript(() => {
        localStorage.setItem("vnTextSpeed.v1", "instant");
        localStorage.setItem("vnAutoRead.v1", "0");
        localStorage.setItem("pet-music-muted", "1");
    });
    return page;
}
async function enter(page, params) {
    await page.goto(`${origin}/?${new URLSearchParams({ preview: "vn", event, ...params })}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.locator(".cvn-root").waitFor({ timeout: 90000 });
    await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
}
async function backdrop(page) { return page.locator(".cvn-backdrop").evaluate((node) => getComputedStyle(node).backgroundImage); }
async function next(page) {
    const previous = await page.locator(".cvn-dialogue-text").textContent();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.waitForFunction((before) => document.querySelector(".cvn-dialogue-text")?.textContent !== before, previous);
}
async function choice(page, text) { await page.getByRole("button", { name: new RegExp(escapeRegex(text)) }).click(); }
async function shot(page, name) {
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, name);
    await page.screenshot({ path: path.join(output, `${name}.png`) });
}

try {
    const page = await newPage();
    await enter(page, { page: "1", line: String(lastLine(1)), avatar: "wide" });
    await choice(page, '"I want to protect people."');
    await page.getByText("A Protector", { exact: true }).waitFor();
    assert.match(await backdrop(page), /ashen-register-wall/);
    await shot(page, "branch-protector");
    for (let line = 0; line < lastLine(2); line++) await next(page);
    await choice(page, "Step back from the wall.");
    await page.getByText("The Black Flower", { exact: true }).waitFor();
    await next(page);
    assert.match(await backdrop(page), /ashen-register-wall/);
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    const saved = JSON.parse(await page.getByTestId("vn-qa-save").textContent());
    assert.equal(saved.scene.pageIndex, 7);
    assert.equal(saved.scene.lineIndex, 1);
    assert.ok(saved.choices.some((c) => c.trait === "al4-become-protector"));
    await page.getByRole("button", { name: "Resume preview", exact: true }).click();
    assert.match(await backdrop(page), /ashen-register-wall/);
    await shot(page, "resumed-before-reveal");
    await next(page);
    assert.match(await backdrop(page), /ashen-black-flower-reveal-v2/);
    await shot(page, "resumed-reveal");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    assert.match(await backdrop(page), /ashen-register-wall/);
    await next(page);
    for (let line = 2; line < lastLine(7); line++) await next(page);
    await next(page);
    for (let line = 0; line < lastLine(8); line++) await next(page);
    await choice(page, "Follow Mori to the grove.");
    assert.match(await backdrop(page), /ashen-old-grove-trial/);
    for (let line = 0; line < lastLine(9); line++) await next(page);
    await choice(page, "Bow low to the roots first, and mean it.");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByText("Preview paused: battle handoff", { exact: true }).waitFor();
    const battleSave = JSON.parse(await page.getByTestId("vn-qa-save").textContent());
    assert.equal(battleSave.choices.filter((c) => c.battle).length, 1);
    await page.getByRole("button", { name: "Resume preview", exact: true }).click();
    assert.match(await backdrop(page), /ashen-old-grove-trial/);
    report.checks.push({ name: "choice → branch → serialized exit/resume → reveal/back → battle callback/return", save: battleSave });

    const archive = inventory.rows.find((r) => r.key.startsWith(event + ":archive-") && r.title === "The Black Flower");
    assert.ok(archive);
    await enter(page, { event: archive.key.split("/page:", 1)[0], page: String(archive.pageIndex), line: "2", replay: "1" });
    assert.match(await backdrop(page), /ashen-black-flower-reveal-v2/);
    assert.equal(await page.locator(".vn-choice-btn").count(), 0);
    await shot(page, "historical-archive-replay");
    report.checks.push({ name: "actual archive route replays its reveal without choices" });

    for (const [shape, viewport, motion] of [["square", { width: 390, height: 844 }, "reduce"], ["wide", { width: 844, height: 390 }, "reduce"], ["tall", { width: 1440, height: 900 }, "no-preference"]]) {
        const layout = await newPage({ viewport, reducedMotion: motion });
        await layout.addInitScript(() => localStorage.setItem("vnTextSize.v1", "xlarge"));
        await enter(layout, { event: "story-stormveil-village-4-0", page: "0", line: "0", avatar: shape });
        const avatar = layout.locator(`.cvn-actor.is-player .cvn-avatar-${shape}`);
        await avatar.waitFor();
        assert.equal(await avatar.evaluate((node) => getComputedStyle(node).objectFit), "contain");
        await shot(layout, `avatar-${shape}-${viewport.width}-xlarge`);
        report.checks.push({ name: `avatar ${shape}, ${viewport.width}x${viewport.height}, xlarge text, ${motion}` });
        await layout.close();
    }

    const lite = await newPage({ reducedMotion: 'no-preference', isMobile: true, hasTouch: true });
    await lite.addInitScript(() => {
        localStorage.setItem('liteFx.v1', '1');
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 });
    });
    await enter(lite, { event: 'story-moonshadow-village-4-0', page: '1', line: '0' });
    await lite.locator('.cvn-root.is-lite').waitFor();
    assert.equal(await lite.locator('.cvn-atmosphere').count(), 0);
    await shot(lite, 'low-end-phone');
    report.checks.push({ name: 'low-end phone: lite class, atmosphere omitted, art decodes, controls remain readable' });
    await lite.close();

    await page.evaluate(async () => {
        await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    });
    const oldArt = "/scenes/story/cinematic/ashen-black-flower-reveal.webp";
    const newArt = "/scenes/story/cinematic/ashen-black-flower-reveal-v2.webp";
    const cached = await page.evaluate(async ({ oldArt, newArt }) => {
        const oldImage = new Image(); oldImage.src = oldArt; await oldImage.decode();
        const newImage = new Image(); newImage.src = newArt; await newImage.decode();
        const cache = await caches.open("sj-game-images-v1");
        for (let attempt = 0; attempt < 40 && !(await cache.match(newArt)); attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
        return { old: !!(await cache.match(oldArt)), current: !!(await cache.match(newArt)) };
    }, { oldArt, newArt });
    assert.ok(cached.old && cached.current);
    await page.context().setOffline(true);
    const offline = await page.evaluate(async (src) => { const image = new Image(); image.src = src + "?__img_retry=cache-proof"; await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight }; }, newArt);
    assert.equal(offline.width, 1672);
    await page.context().setOffline(false);
    await shot(page, "previously-cached-reveal");
    report.checks.push({ name: "old and versioned art coexist in actual service-worker cache; current art decodes offline with retry normalization", cached, offline });
    const classic = await newPage({ viewport: { width: 1440, height: 900 } });
    await enter(classic, { page: '7', line: '2' });
    await classic.getByRole('button', { name: 'Classic', exact: true }).click();
    await classic.locator('.vn-stage').waitFor();
    assert.match(await classic.locator('.vn-stage').evaluate(node => getComputedStyle(node).backgroundImage), /ashen-black-flower-reveal-v2/);
    await shot(classic, 'classic-reader-reveal');
    await classic.getByRole('button', { name: 'Cinematic', exact: true }).click();
    await classic.locator('.cvn-root').waitFor();
    assert.match(await backdrop(classic), /ashen-black-flower-reveal-v2/);
    await classic.close();
    report.checks.push({ name: 'classic and cinematic readers preserve the same corrected reveal image and cursor' });
    await page.close();
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.writes, []);
} catch (error) {
    report.failure = error.stack || String(error);
    process.exitCode = 1;
    console.error(report.failure);
} finally {
    await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    await browser.close();
}
console.log(JSON.stringify(report, null, 2));
