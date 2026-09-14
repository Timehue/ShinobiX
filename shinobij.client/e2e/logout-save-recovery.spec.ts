import { expect, test, type Page } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

function completedContractSave() {
    const save = uiAuditSave();
    return {
        ...save,
        currentSector: 0,
        character: {
            ...save.character, level: 2, rankTitle: 'Academy Student',
            firstContract: {
                version: 1, source: 'skip', offeredAt: Date.now(), selectedAt: Date.now(),
                route: 'discovery', completedAt: Date.now(), evidence: { kind: 'field-explore', sector: 4 },
            },
        },
    };
}

async function logout(page: Page) {
    const desktop = page.locator('.right-menu-logout');
    if (await desktop.isVisible()) await desktop.click();
    else {
        await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'Menu', exact: true }).click();
        await page.getByRole('dialog', { name: 'Shinobi menu' }).getByRole('button', { name: 'Logout', exact: true }).click();
    }
}

for (const retryAfterMs of [2501, undefined]) {
    test(`a throttled logout preserves the contract and session until retry is acknowledged (hint ${retryAfterMs ?? 'missing'})`, async ({ page }, testInfo) => {
        test.setTimeout(90_000);
        const save = completedContractSave();
        const runtime = await installUiAuditRuntime(page, save);
        await expectUiAuditBoot(page, runtime, 'village');
        const savedVersion = runtime.currentVersion();
        const token = await page.evaluate(() => localStorage.getItem('shinobix:activeTokenPersist'));
        let reject = true;
        let interceptedRetry!: () => void;
        const retryStarted = new Promise<void>((resolve) => { interceptedRetry = resolve; });
        let releaseRetry!: () => void;
        const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
        await page.route('**/api/save/auditninja', async (route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            if (reject) return route.fulfill({ status: 429, json: { error: 'Rate limit exceeded.', retryAfterMs } });
            interceptedRetry();
            await retryGate;
            await route.fallback();
        });

        await logout(page);
        const dialog = page.getByRole('alertdialog', { name: 'Save temporarily paused' });
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(retryAfterMs === undefined ? 'wait a little' : 'wait about 3 seconds');
        await expect(dialog).toContainText('choose Logout again to retry');
        await expect(dialog).toContainText('Progress already saved on the server is still there');
        await expect(dialog).not.toContainText('lose everything');
        await expect(dialog.getByRole('button', { name: 'Stay logged in' })).toBeInViewport({ ratio: 1 });
        expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        await page.screenshot({ path: testInfo.outputPath('logout-save-paused.png') });
        await dialog.getByRole('button', { name: 'Stay logged in' }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'village');
        expect(await page.evaluate(() => localStorage.getItem('shinobix:activeTokenPersist'))).toBe(token);
        expect(runtime.currentVersion()).toBe(savedVersion);
        await expect(page.locator('.fc-ribbon').getByRole('button', { name: 'Read your entry' })).toBeVisible();

        // Release the fixture's rate limit, then hold the real save promise to
        // prove logout still requires an acknowledgement before session teardown.
        reject = false;
        try {
            await logout(page);
            await retryStarted;
            await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'village');
            expect(await page.evaluate(() => localStorage.getItem('shinobix:activeTokenPersist'))).toBe(token);
        } finally { releaseRetry(); }
        await expect(page.getByTestId('start-create')).toBeVisible();
        expect(runtime.acknowledgedVersion()).toBeGreaterThan(savedVersion);
        expect(JSON.parse(runtime.lastCommit()!.postedState).character.firstContract).toEqual(save.character.firstContract);
        expect(await page.evaluate(() => localStorage.getItem('shinobix:activeTokenPersist'))).toBeNull();

        // Re-enter through the login UI and load the fixture's persisted save.
        await page.locator('.landing-topnav').getByRole('button', { name: 'Log In', exact: true }).click();
        await page.getByRole('button', { name: 'Use a name and password' }).click();
        await page.getByLabel('Name').fill('AuditNinja');
        await page.getByPlaceholder('Enter your password').fill('fixture-password');
        await page.getByRole('button', { name: 'Enter Village' }).click();
        await page.locator('.fc-ribbon').getByRole('button', { name: 'Read your entry' }).click();
        await expect(page.getByRole('dialog', { name: 'First Contract field journal' })).toContainText('Field record: Sector 4.');
    });
}

test('a non-throttling save failure retains the existing stay-or-leave guard', async ({ page }) => {
    const runtime = await installUiAuditRuntime(page, completedContractSave());
    await expectUiAuditBoot(page, runtime, 'village');
    await page.route('**/api/save/auditninja', async (route) => route.request().method() === 'POST'
        ? route.fulfill({ status: 503, json: { error: 'Service unavailable' } }) : route.fallback());
    await logout(page);
    const dialog = page.getByRole('alertdialog', { name: 'Save Failed' });
    await expect(dialog).toContainText('since your last successful save');
    await expect(dialog).not.toContainText('temporarily limiting');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'village');
});

test('leaving after a throttled save still requires the explicit Log out anyway choice', async ({ page }) => {
    const runtime = await installUiAuditRuntime(page, completedContractSave());
    await expectUiAuditBoot(page, runtime, 'village');
    const savedVersion = runtime.currentVersion();
    await page.route('**/api/save/auditninja', async (route) => route.request().method() === 'POST'
        ? route.fulfill({ status: 429, json: { retryAfterMs: 3000 } }) : route.fallback());
    await logout(page);
    await page.getByRole('alertdialog', { name: 'Save temporarily paused' }).getByRole('button', { name: 'Log out anyway' }).click();
    await expect(page.getByTestId('start-create')).toBeVisible();
    expect(runtime.currentVersion()).toBe(savedVersion);
});
