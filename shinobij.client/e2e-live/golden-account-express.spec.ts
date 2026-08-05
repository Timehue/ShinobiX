import { expect, test, type Page } from '@playwright/test';

const PLAYER_NAME = 'GoldenNinja';
const PASSWORD = 'Golden!Pass1234';

async function expectHealthyViewport(page: Page) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'the golden journey must not create horizontal document overflow').toBeLessThanOrEqual(1);

    const brokenVisibleImages = await page.locator('img:visible').evaluateAll((images) => images
        .filter((image) => {
            const element = image as HTMLImageElement;
            return element.complete && element.naturalWidth === 0;
        })
        .map((image) => (image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src));
    expect(brokenVisibleImages, 'visible images must load successfully').toEqual([]);
}

async function createCharacter(page: Page) {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('start-create')).toBeVisible();
    await expectHealthyViewport(page);

    await page.getByTestId('start-create').click();
    await page.getByRole('button', { name: 'Choose Village' }).click();
    await page.locator('.cc-village-card').first().click();
    await page.getByRole('button', { name: 'Choose Bloodline' }).click();
    await page.locator('.cc-bloodline-card').first().click();
    await page.getByRole('button', { name: 'Choose Avatar' }).click();
    await page.locator('.cc-avatar-card').first().click();
    await page.getByRole('button', { name: 'Preview Shinobi' }).click();
    await page.getByRole('button', { name: 'Name and Password' }).click();
    await page.getByLabel('Name').fill(PLAYER_NAME);
    await page.locator('#cc-password').fill(PASSWORD);
    await page.locator('#cc-confirm-password').fill(PASSWORD);

    const firstSave = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && new URL(response.url()).pathname.toLowerCase() === `/api/save/${PLAYER_NAME.toLowerCase()}`,
    );
    await page.getByRole('button', { name: 'Enter the World' }).click();
    expect((await firstSave).status()).toBe(200);

    await expect.poll(() => page.evaluate(() => {
        const raw = localStorage.getItem('ninjav-admin-build-v1');
        return raw ? JSON.parse(raw).currentAccountName : '';
    })).toBe(PLAYER_NAME);
    await expectHealthyViewport(page);
}

test('registration survives refresh and a clean-device login against real Express storage', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop-live', 'one desktop run covers the storage authority seam');

    const runtimeErrors: string[] = [];
    const serverFailures: string[] = [];
    let intentionallyResettingClient = false;
    page.on('pageerror', (error) => {
        if (intentionallyResettingClient && error.message === 'Failed to fetch') return;
        runtimeErrors.push(error.message);
    });
    page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
            runtimeErrors.push(message.text());
        }
    });
    page.on('response', (response) => {
        if (response.url().includes('/api/') && response.status() >= 500) {
            serverFailures.push(`${response.status()} ${new URL(response.url()).pathname}`);
        }
    });

    await createCharacter(page);

    const persisted = await page.evaluate(async (name) => {
        const response = await fetch(`/api/save/${encodeURIComponent(name.toLowerCase())}`);
        return { status: response.status, body: await response.json() as Record<string, unknown> };
    }, PLAYER_NAME);
    expect(persisted.status).toBe(200);
    expect((persisted.body.character as { name?: string }).name).toBe(PLAYER_NAME);

    await page.reload({ waitUntil: 'networkidle' });
    await expect.poll(() => page.evaluate(() => {
        const raw = localStorage.getItem('ninjav-admin-build-v1');
        return raw ? JSON.parse(raw).currentAccountName : '';
    })).toBe(PLAYER_NAME);

    intentionallyResettingClient = true;
    await page.evaluate(() => localStorage.clear());
    await page.goto('/', { waitUntil: 'networkidle' });
    intentionallyResettingClient = false;
    await page.getByRole('button', { name: 'Log In' }).click();
    await page.getByLabel('Name').fill(PLAYER_NAME);
    await page.getByPlaceholder('Enter your password').fill(PASSWORD);

    const restoredSave = page.waitForResponse((response) =>
        response.request().method() === 'GET'
        && new URL(response.url()).pathname.toLowerCase() === `/api/save/${PLAYER_NAME.toLowerCase()}`,
    );
    await page.getByRole('button', { name: 'Enter Village' }).click();
    expect((await restoredSave).status()).toBe(200);
    await expect.poll(() => page.evaluate(() => {
        const raw = localStorage.getItem('ninjav-admin-build-v1');
        return raw ? JSON.parse(raw).currentAccountName : '';
    })).toBe(PLAYER_NAME);
    await expectHealthyViewport(page);

    expect(runtimeErrors).toEqual([]);
    expect(serverFailures).toEqual([]);
});
