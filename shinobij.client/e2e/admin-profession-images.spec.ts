import { expect, test } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64');

for (const role of ['full', 'content'] as const) {
    test(`the ${role} admin can replace profession art through the shared publisher`, async ({ page }, testInfo) => {
        test.skip(!['chromium-desktop', 'chromium-mobile'].includes(testInfo.project.name), 'desktop and mobile cover this browser file-upload workflow');
        await installUiAuditRuntime(page);
        await page.addInitScript(() => {
            for (const key of ['ninjav-admin-build-v1', 'ninjav-player-accounts-v1', 'shinobix:activePlayerPersist', 'shinobix:activeTokenPersist']) localStorage.removeItem(key);
        });
        const account = role === 'full' ? 'Admin 1' : 'Admin 2';
        let version = 1;
        const uploads: Array<{ id: string; image: string; credential?: string }> = [];
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/api/admin-auth', (route) => route.fulfill({ json: { success: true, account, role, token: null } }));
        await page.route(/\/api\/save\/admin[^/]*$/i, (route) => route.fulfill({ json: route.request().method() === 'GET'
            ? { ...uiAuditSave(), character: { ...uiAuditSave().character, name: account, level: 1 }, _saveVersion: version }
            : { ok: true, _saveVersion: ++version } }));
        await page.route('**/api/images*', async (route) => {
            if (route.request().method() === 'POST') {
                uploads.push({ ...route.request().postDataJSON(), credential: route.request().headers()['x-admin-password'] });
                return route.fulfill({ json: { ok: true } });
            }
            return route.fulfill({ json: { version: '1', ids: ['profession:backdrop'] } });
        });
        await page.route('**/api/img?*', (route) => route.fulfill({ contentType: 'image/png', body: pixel }));

        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.locator('.landing-topnav').getByRole('button', { name: 'Log In', exact: true }).click();
        await page.getByRole('button', { name: 'Use a name and password' }).click();
        await page.getByLabel('Name', { exact: true }).fill('Admin 2');
        await page.getByPlaceholder('Enter your password').fill('qa-profession-password');
        await page.getByRole('button', { name: /Enter Village/ }).click();
        await expect(page.getByRole('heading', { name: 'Admin Login', exact: true })).toBeVisible();
        await page.getByLabel('Password', { exact: true }).fill('qa-profession-password');
        await page.getByRole('button', { name: 'Login', exact: true }).click();
        // Admin login creates its own max-level character; finish its existing
        // built-in reward scene before exercising the content editor.
        const issueSeal = page.getByRole('dialog', { name: 'A Timed Issue Seal visual novel scene', exact: true });
        await issueSeal.getByRole('button', { name: 'Skip', exact: true }).click();
        await page.locator('.admin-panel-switcher').getByRole('button', { name: /Professions/ }).click();
        const panel = page.locator('.admin-subpanel').filter({ has: page.getByRole('heading', { name: /Profession Picker/ }) });
        await expect(panel.locator('input[type=file]')).toHaveCount(5);
        await expect(panel.getByRole('img', { name: 'Village backdrop (intro + choose pages)' })).toBeVisible();
        await expect(page.locator('.admin-panel-switcher').getByRole('button', { name: /Players/ })).toHaveCount(role === 'full' ? 1 : 0);
        await page.screenshot({ path: testInfo.outputPath(`profession-editor-${role}-${testInfo.project.name}.png`), fullPage: true });

        const input = panel.locator('input[type=file]').first();
        for (let attempt = 1; attempt <= 2; attempt += 1) {
            await page.evaluate(() => sessionStorage.setItem('imgcat:misc', 'stale-preview'));
            await input.setInputFiles({ name: `profession-${attempt}.png`, mimeType: 'image/png', buffer: pixel });
            await expect.poll(() => uploads.length).toBe(attempt);
            expect(uploads[attempt - 1].id).toBe('profession:backdrop');
            expect(uploads[attempt - 1].image).toMatch(/^data:image\/(?:webp|jpeg);base64,/);
            expect(uploads[attempt - 1].credential).toBe('qa-profession-password');
            await expect.poll(() => page.evaluate(() => sessionStorage.getItem('imgcat:misc'))).toBeNull();
        }
        expect(errors).toEqual([]);
    });
}
