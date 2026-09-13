import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Instrument the existing persisted Academy journey without editing its test.
const root = resolve(import.meta.dirname, '..');
const work = resolve(root, 'test-results/ux-journey-work');
mkdirSync(work, { recursive: true });
let source = readFileSync(resolve(root, 'e2e-live/first-session-onboarding-express.spec.ts'), 'utf8');
source = source.replace('for (const grantDelayMs of [0, 500])', 'for (const grantDelayMs of [0])');
source = source.replace('test.setTimeout(240_000)', 'test.setTimeout(420_000)');
source = source.replace("import { expect, test, type Page } from '@playwright/test';", `import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
async function captureJourney(page: Page, name: string) {
    const original = page.viewportSize()!;
    const directory = resolve('..', 'docs/audits/ux-journey-2026-09-13', process.env.UX_AUDIT_PHASE ?? 'after');
    mkdirSync(directory, { recursive: true });
    for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(450);
        await page.screenshot({ path: resolve(directory, name + '-' + viewport.width + '.png') });
        writeFileSync(resolve(directory, name + '-' + viewport.width + '.txt'), await page.locator('body').innerText());
        const notice = await page.locator('.storage-notice').count() ? await page.locator('.storage-notice').boundingBox() : null;
        const guide = await page.locator('.onboarding-coach-banner').count() ? await page.locator('.onboarding-coach-banner').boundingBox() : null;
        if (notice && guide) expect(guide.y + guide.height, 'The guide must not cover the data storage notice').toBeLessThanOrEqual(notice.y);
    }
    await page.setViewportSize(original);
}
`);
const captures = [
    ["await page.getByRole('button', { name: 'Choose Village' }).click();", '01-creator'],
    ["await expect(page.getByRole('button', { name: 'Go to Training Grounds' })).toBeVisible();", '02-academy-training-handoff'],
    ["await expect(page.getByRole('heading', { name: 'Training Grounds' })).toBeVisible();", '03-training'],
    ["await expect(page.getByRole('button', { name: 'Go to Jutsu Training' })).toBeVisible();", '04-training-started'],
    ["await jutsuList.getByText('Flicker', { exact: true }).click();", '05-jutsu-acquisition'],
    ["await page.getByRole('searchbox', { name: 'Search jutsu' }).fill('Flicker');", '06-jutsu-equip'],
    ["await expect(itemDialog).toBeVisible();", '07-item-details'],
    ["await expect(page.locator('.mission-arena-fight')).toBeVisible();", '08-first-combat'],
    ["await expect(sparResult).toContainText(/stat points/);", '09-first-win'],
    ["await expect(page.getByRole('heading', { name: 'Cafeteria' })).toBeVisible();", '10-cafeteria'],
    ["await expect(page.getByRole('heading', { name: 'Mission Hall' })).toBeVisible();", '11-first-mission'],
    ["await expect(page.getByRole('heading', { name: 'Logbook' })).toBeVisible();", '12-logbook'],
    ["await page.getByRole('button', { name: 'Stormveil', exact: true }).click();", '13-world-sector'],
    ["await expect(nextStep).toBeVisible();", '14-progression-handoff'],
];
for (const [needle, name] of captures) {
    if (!source.includes(needle)) throw new Error('Missing checkpoint: ' + name);
    source = source.replace(needle, needle + `\n    await captureJourney(page, '${name}');`);
}
writeFileSync(resolve(work, 'academy.spec.ts'), source);
writeFileSync(resolve(work, 'surfaces.spec.ts'), "import '../../e2e/player-journey-ux.spec';\n");
writeFileSync(resolve(work, 'later.spec.ts'), "import '../../e2e/first-contract.spec';\nimport '../../e2e/first-contract-handoffs.spec';\n");
writeFileSync(resolve(work, 'recheck.spec.ts'), "import '../../e2e/player-journey-ux-recheck.spec';\n");
writeFileSync(resolve(work, 'playwright.config.ts'), `import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir: '.', testMatch: '*.spec.ts', workers: 1, retries: 0,
 timeout: 420000, expect: { timeout: 15000 }, reporter: 'line',
 outputDir: '../ux-journey-results',
 use: { baseURL: 'http://127.0.0.1:25413', contextOptions: { reducedMotion: 'reduce' }, serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 30000 },
 projects: [{ name: 'chromium-desktop-live', use: { browserName: 'chromium', viewport: process.env.UX_AUDIT_MOBILE ? { width: 390, height: 844 } : { width: 1366, height: 768 }, isMobile: Boolean(process.env.UX_AUDIT_MOBILE), hasTouch: Boolean(process.env.UX_AUDIT_MOBILE) } }],
 webServer: { command: 'node ../dist/server.js', cwd: ${JSON.stringify(root)}, url: 'http://127.0.0.1:25413/health', reuseExistingServer: false, timeout: 120000,
 env: { NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1', PORT: '25413', STATIC_DIR: ${JSON.stringify(resolve(root, '.ux-audit-dist'))}, SESSION_SECRET: 'live-express-e2e-session-secret-32-bytes-minimum', ADMIN_PASSWORD: 'live-express-e2e-admin', DISABLE_SCHEDULED_JOBS: '1', DISABLE_REALTIME: '1', DISABLE_SNAPSHOT_CRON: '1', SENTRY_DSN: '' } }
});`);
console.log('Prepared instrumented Academy journey in ' + work);
