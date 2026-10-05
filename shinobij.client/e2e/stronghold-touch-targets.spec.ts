import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const strongholdCss = readFileSync(new URL("../src/features/anbuInfiltration/stronghold.css", import.meta.url), "utf8");

const strongholdFixture = `
  <section class="stronghold-shell" aria-label="Anbu stronghold">
    <header class="stronghold-header"><div><h2>ANBU VAULT</h2></div><button class="stronghold-leave">Leave stronghold</button></header>
    <div class="stronghold-body">
      <div class="stronghold-viewport">
        <button class="stronghold-peer" aria-label="Inspect shinobi" style="left:120px;top:120px;width:44px;height:44px">R</button>
        <button class="stronghold-zoom">View full map</button>
      </div>
    </div>
    <footer class="stronghold-footer">
      <div class="stronghold-guidance"><span>Tap a floor tile or use the movement controls.</span></div>
      <div class="stronghold-dpad" aria-label="Movement controls">
        <button aria-label="Move up">↑</button><button aria-label="Move left">←</button>
        <button aria-label="Move down">↓</button><button aria-label="Move right">→</button>
      </div>
    </footer>
  </section>
  <dialog class="stronghold-dialog" open><div class="stronghold-dialog-actions">
    <button class="stronghold-attack">Challenge</button><button>Cancel</button>
  </div></dialog>
`;

test("Stronghold touch buttons meet 48px targets in portrait and short landscape", async ({ browser, browserName }) => {
    test.skip(browserName === "firefox", "Playwright Firefox does not support Android-style isMobile emulation.");
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        reducedMotion: "reduce",
    });
    try {
        const page = await context.newPage();
        await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1">${strongholdFixture}`);
        await page.addStyleTag({ content: strongholdCss });
        await expect.poll(() => page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

        const expectTouchTargets = async () => {
            const dimensions = await page.locator(".stronghold-shell button, .stronghold-dialog button").evaluateAll(buttons =>
                buttons.map(button => {
                    const rect = button.getBoundingClientRect();
                    return { width: rect.width, height: rect.height };
                }));
            expect(dimensions).toHaveLength(9);
            for (const rect of dimensions) {
                expect(rect.width).toBeGreaterThanOrEqual(48);
                expect(rect.height).toBeGreaterThanOrEqual(48);
            }
        };

        await expectTouchTargets();
        await page.setViewportSize({ width: 844, height: 390 });
        await expectTouchTargets();
    } finally {
        await context.close();
    }
});
