import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { expectViewportSafe } from "./helpers/adaptive-assertions";
test.use({ contextOptions: { reducedMotion: "no-preference" } });

// Bundle just the production ceremony and modal. This keeps timing/focus tests
// independent of the full game's API and dependency scanning.
let script: string;
let styles: string;
test.beforeAll(async () => {
    const bundle = await build({
        absWorkingDir: process.cwd(), entryPoints: ["e2e/fixtures/bloodline-ritual.tsx"],
        bundle: true, write: false, outdir: "out", platform: "browser", format: "esm", jsx: "automatic",
        external: ["/fonts/*"],
        plugins: [{ name: "local-image-urls", setup(builder) {
            builder.onLoad({ filter: /\.webp$/ }, args => ({
                contents: `export default ${JSON.stringify("/" + relative(process.cwd(), args.path).replaceAll("\\", "/"))};`, loader: "js",
            }));
        } }],
    });
    script = bundle.outputFiles!.find(f => f.path.endsWith(".js"))!.text;
    styles = bundle.outputFiles!.find(f => f.path.endsWith(".css"))!.text;
});
test.beforeEach(async ({ page }) => {
    const clientRoot = process.cwd();
    await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.hostname !== "ritual.local") return route.abort();
        if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body:
            '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0;background:#050910"><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>' });
        if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: script });
        if (url.pathname === "/fixture.css") return route.fulfill({ contentType: "text/css", body: styles });
        const root = url.pathname.startsWith("/src/") ? clientRoot : resolve(clientRoot, "public");
        const path = resolve(root, "." + url.pathname);
        if (!path.startsWith(root + sep)) return route.abort();
        try { return route.fulfill({ body: await readFile(path), contentType: path.endsWith(".webp") ? "image/webp" : path.endsWith(".woff2") ? "font/woff2" : "audio/wav" }); }
        catch { return route.abort(); }
    });
});

for (const rank of ["B Rank", "A Rank", "S Rank"]) {
    test(`${rank} reveals its relic then opens the builder once`, async ({ page }, info) => {
        await page.goto(`http://ritual.local/?rank=${encodeURIComponent(rank)}`);
        await page.clock.install();
        await page.getByRole("button", { name: "Begin ritual" }).click();
        const dialog = page.getByRole("dialog", { name: `${rank} Attuned` });
        await expect(dialog).toBeVisible();
        await expect(page.getByLabel("Builder opens")).toHaveText("0");
        const img = dialog.locator("img");
        await expect.poll(() => img.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(768);
        await page.clock.fastForward(900);
        await expect(dialog.locator(".bl-ritual")).toHaveAttribute("data-phase", "surge");
        await page.clock.fastForward(900);
        await expect(dialog.locator(".bl-ritual")).toHaveAttribute("data-phase", "revealed");
        await expectViewportSafe(page);
        // Playwright's clock advances JS timers; align the CSS animations too
        // so the screenshot depicts the same point in the real ceremony.
        await page.evaluate(() => document.getAnimations().forEach(animation => { animation.currentTime = 1800; }));
        await page.screenshot({ path: info.outputPath(`${rank[0]}-ritual.png`) });
        await page.clock.fastForward(2300);
        await expect(dialog).toHaveCount(0);
        await expect(page.getByLabel("Builder opens")).toHaveText("1");
        await page.clock.fastForward(5000);
        await expect(page.getByLabel("Builder opens")).toHaveText("1");
        await expect(page.locator("#root")).not.toHaveAttribute("inert");
        await expect(page.locator("body")).not.toHaveClass(/ui-scroll-locked/);
    });
}

test("skip and Escape enter the builder once and release focus", async ({ page }) => {
    await page.goto("http://ritual.local/?resumed");
    await page.clock.install();
    for (let count = 1; count <= 2; count++) {
        // Open with the keyboard so WebKit pointer-click blur does not replace
        // the opener whose keyboard focus this test checks after dismissal.
        await page.getByRole("button", { name: "Begin ritual" }).focus();
        await page.getByRole("button", { name: "Begin ritual" }).press("Enter");
        const dialog = page.getByRole("dialog", { name: "S Rank Rekindled" });
        await expect(dialog).toBeVisible();
        await page.keyboard.press("Tab");
        await expect(dialog.getByRole("button", { name: "Skip to builder" })).toBeFocused();
        if (count === 1) await dialog.getByRole("button", { name: "Skip to builder" }).click();
        else await page.keyboard.press("Escape");
        await page.clock.fastForward(4500);
        await expect(dialog).toHaveCount(0);
        await expect(page.getByLabel("Builder opens")).toHaveText(String(count));
        await expect(page.getByRole("button", { name: "Begin ritual" })).toBeFocused();
    }
});

test("reduced motion enters the builder immediately without a moving overlay", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("http://ritual.local/");
    await page.getByRole("button", { name: "Begin ritual" }).click();
    await expect(page.getByLabel("Builder opens")).toHaveText("1");
    await expect(page.locator(".bl-ritual")).toHaveCount(0);
});
