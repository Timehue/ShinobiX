import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let sentryBundlePresent = false;
let sentryBundleEnabled = false;
// A lazy Sentry chunk is part of the module graph even when Vite was built
// without VITE_SENTRY_DSN. Only an enabled build should run the network smoke;
// otherwise a normal local build would fail while correctly omitting capture.
test.beforeAll(() => {
    const port = process.env.PLAYWRIGHT_PORT ?? '4173';
    const previewRoot = `.playwright-dist-${port.replace(/[^a-z0-9_-]/gi, '_')}`;
    const assetsDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', previewRoot, 'assets');
    if (!existsSync(assetsDirectory)) return;
    const assets = readdirSync(assetsDirectory);
    sentryBundlePresent = assets.some((name) => /^sentry-vendor-.*\.js$/.test(name));
    sentryBundleEnabled = assets
        .filter((name) => /^index-.*\.js$/.test(name))
        .some((name) => /public@example\.invalid/.test(readFileSync(join(assetsDirectory, name), 'utf8')));
});

test.beforeEach(async ({ page }) => {
    // Vite preview is intentionally static; the real Express server owns this
    // best-effort telemetry endpoint. Stub it so frontend smoke tests do not
    // mistake the absent backend for a browser regression.
    await page.route('**/api/perf-beacon', (route) => route.fulfill({ status: 204 }));
    await page.route('**/api/player/capabilities', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            ok: true,
            capabilities: Object.fromEntries([
                'gameplay', 'gameplayMutations', 'registrations', 'villageWar', 'anbuInfiltration', 'clanBoss',
                'clanBossParties', 'legacy', 'petBreedingStarts', 'weeklyBossGuardCycle',
            ].map((id) => [id, { state: 'available', reason: 'available' }])),
        }),
    }));
});

function captureRuntimeFailures(page: Page): string[] {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().includes('Failed to load resource')) failures.push(`console: ${message.text()}`);
    });
    page.on('response', (response) => {
        if (response.status() >= 400) failures.push(`http ${response.status()}: ${response.url()}`);
    });
    return failures;
}

function startCreateButton(page: Page): Locator {
    // The visible marketing copy can evolve without changing this journey.
    return page.getByTestId('start-create');
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
    const dimensions = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth, `page overflowed by ${dimensions.scrollWidth - dimensions.clientWidth}px`).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function expectLoadedVisibleImages(page: Page): Promise<void> {
    const images = page.locator('img');
    for (let index = 0; index < await images.count(); index++) {
        await images.nth(index).scrollIntoViewIfNeeded();
    }
    await expect.poll(async () => images.evaluateAll((nodes) => nodes.filter((image) =>
        !(image as HTMLImageElement).complete || (image as HTMLImageElement).naturalWidth === 0).length), { timeout: 10_000 }).toBe(0);
    const broken = await images.evaluateAll((images) => images
        .filter((image) => !(image as HTMLImageElement).complete || (image as HTMLImageElement).naturalWidth === 0)
        .map((image) => (image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src));
    expect(broken).toEqual([]);
}

test('landing and creator journey render without runtime, image, or responsive failures', async ({ page }) => {
    const runtimeFailures = captureRuntimeFailures(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(startCreateButton(page)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectLoadedVisibleImages(page);

    await startCreateButton(page).click();
    await expect(page.getByRole('heading', { name: 'Begin as a Shinobi' })).toBeVisible();
    await page.getByRole('button', { name: 'Choose Village' }).click();
    await page.locator('.cc-village-card').first().click();
    await page.getByRole('button', { name: 'Choose Bloodline' }).click();
    await page.locator('.cc-bloodline-card').first().click();
    await page.getByRole('button', { name: 'Choose Avatar' }).click();
    await page.locator('.cc-avatar-card').first().click();
    await page.getByRole('button', { name: 'Preview Shinobi' }).click();
    await page.getByRole('button', { name: 'Name and Password' }).click();
    await expect(page.getByLabel('Name')).toBeVisible();
    await expect(page.locator('#cc-password')).toBeVisible();
    await expect(page.locator('#cc-confirm-password')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(runtimeFailures).toEqual([]);
});

test('landing and creator have no serious WCAG A/AA axe violations', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const landing = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
    expect(landing.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);

    await startCreateButton(page).click();
    await expect(page.getByRole('heading', { name: 'Begin as a Shinobi' })).toBeVisible();
    const creator = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
    expect(creator.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);
});

test('footer policy links open public, responsive, accessible pages', async ({ page }) => {
    const runtimeFailures = captureRuntimeFailures(page);
    await page.goto('/', { waitUntil: 'networkidle' });

    const policyNav = page.getByRole('navigation', { name: 'Legal and player policies' });
    await expect(policyNav.getByRole('link', { name: 'Terms', exact: true })).toBeVisible();
    await expect(policyNav.getByRole('link', { name: 'Privacy', exact: true })).toBeVisible();
    await expect(policyNav.getByRole('link', { name: 'Rules', exact: true })).toBeVisible();
    await expect(policyNav.getByRole('link', { name: 'Privacy Request', exact: true })).toBeVisible();

    await policyNav.getByRole('link', { name: 'Terms', exact: true }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to Shinobi Journey home' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const termsAccessibility = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
    expect(termsAccessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);

    await page.goto('/privacy', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(runtimeFailures).toEqual([]);
});

test('themed alerts trap focus and restore the invoking control', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const opener = startCreateButton(page);
    await opener.focus();

    await page.evaluate(() => window.alert('Focus safety check'));
    const dialog = page.getByRole('alertdialog', { name: 'Notice' });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'OK' })).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'OK' })).toBeFocused();
    await page.keyboard.press('Escape');

    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
});

test('production error reporting stays lazy and fails open', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'one production-bundle assertion is sufficient');
    test.skip(!process.env.CI && (!sentryBundlePresent || !sentryBundleEnabled), 'local bundle was built without VITE_SENTRY_DSN; CI always exercises the enabled path');

    const sentryChunks: string[] = [];
    const envelopes: string[] = [];
    page.on('request', (request) => {
        if (/\/assets\/sentry-(?:runtime|vendor)-/.test(request.url())) sentryChunks.push(request.url());
    });
    await page.route('https://example.invalid/**', (route) => {
        envelopes.push(route.request().url());
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(startCreateButton(page)).toBeVisible();
    expect(sentryChunks).toEqual([]);

    await page.evaluate(() => {
        window.dispatchEvent(new ErrorEvent('error', {
            message: 'release-sentry-smoke',
            error: new Error('release-sentry-smoke'),
        }));
    });

    await expect.poll(() => sentryChunks.some((url) => url.includes('/assets/sentry-vendor-'))).toBe(true);
    await expect.poll(() => envelopes.length).toBeGreaterThan(0);
    await expect(startCreateButton(page)).toBeVisible();
});
