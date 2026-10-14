import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { installUiAuditRuntime, uiAuditSave } from '../e2e/helpers/ui-audit-runtime';
import { RESTORABLE_SCREENS } from '../src/lib/screen-guards';

// Local screenshot review. Uses isolated saves; never connects a player account.
const baseURL = process.env.UI_AUDIT_BASE_URL ?? 'http://127.0.0.1:5198';
const output = 'test-results/presentation-review';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const sizes = [
    { name: 'phone', width: 360, height: 640, touch: true },
    { name: 'landscape', width: 844, height: 390, touch: true },
    { name: 'tablet', width: 768, height: 1024, touch: true },
    { name: 'desktop', width: 1440, height: 900, touch: false },
];
const screens = [...RESTORABLE_SCREENS].filter(screen => ![
    'clanWarPet', 'tilecardsDuel', 'sectorCard', 'sectorPet', 'sectorGarrison',
    'clanWar2v2', 'cardClashFreePlay', 'petShowdown', 'petColiseum', 'storyBoss',
].includes(screen));
const report: Array<Record<string, unknown>> = [];
for (const size of sizes.filter(size => !process.env.REVIEW_SIZE || size.name === process.env.REVIEW_SIZE)) {
    for (const screen of screens.filter(screen => !process.env.REVIEW_SCREEN || screen === process.env.REVIEW_SCREEN)) {
        const context = await browser.newContext({ viewport: size, isMobile: size.touch, hasTouch: size.touch, serviceWorkers: 'block', reducedMotion: 'reduce' });
        const page = await context.newPage();
        const save = uiAuditSave();
        save.character = { ...save.character, starterCardsClaimed: true, cardClashTutorialVersion: 999 };
        await installUiAuditRuntime(page, save);
        await page.addInitScript(screen => localStorage.setItem('lastScreen.v1', screen), screen);
        await page.route('**/api/village/war-map', route => route.fulfill({ json: { ok: true, enabled: true, villages: [], contests: [] } }));
        try {
            await page.goto(`${baseURL}/#/${screen}`, { waitUntil: 'domcontentloaded' });
            await page.locator(`.app-shell[data-screen="${screen}"]`).waitFor({ timeout: 20_000 });
            await page.locator('.lazy-screen-fallback').waitFor({ state: 'hidden' });
            if (await page.getByRole('heading', { name: /This screen hit a snag|Something went wrong/ }).count()) throw new Error('Screen rendered its error boundary');
            await page.evaluate(() => document.fonts.ready);
            await page.waitForTimeout(250);
            const metrics = await page.evaluate(() => {
                const main = document.querySelector('.center-game')!;
                const issues: unknown[] = [];
                const controls = main.querySelectorAll('button, input, select, textarea, h1, h2, h3');
                for (const element of controls) {
                    if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
                    const el = element as HTMLElement;
                    const r = el.getBoundingClientRect();
                    if (!r.width || !r.height) continue;
                    const s = getComputedStyle(el);
                    const label = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 80);
                    // Native inputs scroll their values; map pins belong to a pannable stage.
                    if (!el.matches('input, textarea, select') && el.scrollWidth > el.clientWidth + 2 && ['hidden', 'clip'].includes(s.overflowX)) issues.push({ type: 'own-clipping', label, class: el.className, width: r.width, scroll: el.scrollWidth });
                    for (let parent = el.parentElement; parent && parent !== main; parent = parent.parentElement) {
                        if (parent.matches('.world-map-scroll')) break;
                        const ps = getComputedStyle(parent);
                        const pr = parent.getBoundingClientRect();
                        if (['hidden', 'clip'].includes(ps.overflowX) && (r.left < pr.left - 2 || r.right > pr.right + 2)) {
                            issues.push({ type: 'parent-clipping', label, class: el.className, parent: parent.className, rect: [r.left, r.top, r.width, r.height] });
                            break;
                        }
                    }
                }
                return { issues, text: main.textContent?.trim().slice(0, 200), screen: document.querySelector('.app-shell')?.getAttribute('data-screen') };
            });
            await page.screenshot({ path: `${output}/${size.name}-${screen}.png`, animations: 'disabled' });
            report.push({ size: size.name, screen, ...metrics });
            console.log(`${size.name} ${screen}: ${metrics.issues.length} observations`);
        } catch (error) {
            report.push({ size: size.name, screen, error: String(error) });
            console.log(`${size.name} ${screen}: ${String(error).slice(0, 150)}`);
        }
        await context.close();
        await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
    }
}
await browser.close();
if (report.some(row => row.error)) process.exitCode = 1;
