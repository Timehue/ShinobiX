import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requireFromClient = createRequire(new URL("../shinobij.client/package.json", import.meta.url));
const { chromium } = requireFromClient("@playwright/test");

const url = process.env.BROWSER_VERIFY_URL ?? "https://127.0.0.1:35181/";
const screenshotPath = fileURLToPath(new URL("./clan-integrity-preview.png", import.meta.url));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1366, height: 768 } });
const runtimeErrors = [];
const failedResponses = [];
// A static Vite preview has no API process. Stub the one public boot read so
// this check measures the built UI rather than logging the expected preview
// 404; the real API/data journey is covered by verify-clan-integrity.ts.
await page.route("**/api/player/capabilities", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, capabilities: {} }),
}));
page.on("pageerror", (error) => runtimeErrors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()); });
page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
});

try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator("body").waitFor({ state: "visible" });
    await page.waitForTimeout(750);
    const result = await page.evaluate(() => ({
        title: document.title,
        bodyTextLength: document.body.innerText.trim().length,
        hasErrorOverlay: Boolean(document.querySelector("vite-error-overlay, .vite-error-overlay, #webpack-dev-server-client-overlay")),
        hasRootContent: Boolean(document.querySelector("#root")?.children.length),
    }));
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(JSON.stringify({
        ok: response?.ok() === true && result.bodyTextLength > 0 && result.hasRootContent && !result.hasErrorOverlay && runtimeErrors.length === 0,
        status: response?.status() ?? null,
        ...result,
        runtimeErrors,
        failedResponses,
        screenshotPath,
    }, null, 2));
} finally {
    await browser.close();
}
