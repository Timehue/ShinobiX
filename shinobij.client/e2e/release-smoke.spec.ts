import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    // Vite preview is intentionally static; the real Express server owns this
    // best-effort telemetry endpoint. Stub it so frontend smoke tests do not
    // mistake the absent backend for a browser regression.
    await page.route('**/api/perf-beacon', (route) => route.fulfill({ status: 204 }));
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

test('production error reporting stays lazy and fails open', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'one production-bundle assertion is sufficient');

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
