import { expect, test } from '@playwright/test';
import { openLandingLogin } from './helpers/landing-navigation';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { PET_SCENIC_PORTRAITS } from '../src/lib/pet-portrait-assets.generated';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64');

for (const role of ['full', 'content'] as const) {
    test(`the ${role} admin sees current companion portraits and publishes card overrides`, async ({ page }, testInfo) => {
        await installUiAuditRuntime(page);
        await page.addInitScript(() => {
            for (const key of ['ninjav-admin-build-v1', 'ninjav-player-accounts-v1', 'shinobix:activePlayerPersist', 'shinobix:activeTokenPersist', 'shinobix:pinnedPetAvatars']) localStorage.removeItem(key);
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
            const url = new URL(route.request().url());
            return route.fulfill({ json: url.searchParams.get('ids') === '1' ? { version: '1', ids: [] } : {} });
        });
        await page.route('**/api/img?*', (route) => route.fulfill({ contentType: 'image/png', body: pixel }));

        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await openLandingLogin(page);
        await page.getByRole('button', { name: 'Use a name and password' }).click();
        // Admin 2 opens the admin-login flow; the mocked response selects the role/account.
        await page.getByLabel('Name', { exact: true }).fill('Admin 2');
        await page.getByPlaceholder('Enter your password').fill('qa-portrait-password');
        await page.getByRole('button', { name: /Enter village/ }).click();
        await expect(page.getByRole('heading', { name: 'Admin Login', exact: true })).toBeVisible();
        await page.getByLabel('Password', { exact: true }).fill('qa-portrait-password');
        await page.getByRole('button', { name: 'Login', exact: true }).click();
        await page.getByRole('dialog', { name: 'A Timed Issue Seal visual novel scene', exact: true }).getByRole('button', { name: 'Skip', exact: true }).click();
        await page.locator('.admin-panel-switcher').getByRole('button', { name: 'Pet Editor', exact: true }).click();
        const panel = page.locator('.admin-subpanel').filter({ has: page.getByRole('heading', { name: 'Pet Editor', exact: true }) });
        const overview = panel.locator('details').filter({ hasText: 'Avatars —' }).first();
        await expect(overview.locator('img')).toHaveCount(161);
        const displayed = await overview.locator('img').evaluateAll((images) => images.map((image) => image.getAttribute('src')).sort());
        expect(displayed).toEqual(Object.values(PET_SCENIC_PORTRAITS).sort());
        await expect.poll(() => overview.locator('img').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0))).toBe(true);

        for (const [id, name] of [['rare-3', 'Sky Falcon'], ['rare-40', 'Volt Polecat']]) {
            await panel.locator('select').first().selectOption(id);
            const portrait = page.locator('#admin-pet-editor-card').getByRole('img', { name, exact: true });
            await expect(portrait).toHaveAttribute('src', PET_SCENIC_PORTRAITS[id]);
            await portrait.scrollIntoViewIfNeeded();
            await expect(portrait).toBeVisible();
            await portrait.evaluate((image: HTMLImageElement) => image.decode());
            await expect(portrait).toHaveCSS('object-fit', 'contain');
            const bounds = await portrait.boundingBox();
            expect(Math.abs(bounds!.width - bounds!.height)).toBeLessThan(1.5);
            await portrait.screenshot({ path: testInfo.outputPath(`admin-selected-${id}-${role}-${testInfo.project.name}.png`) });
        }
        await overview.scrollIntoViewIfNeeded();
        await overview.screenshot({ path: testInfo.outputPath(`admin-overview-${role}-${testInfo.project.name}.png`) });
        await page.screenshot({ path: testInfo.outputPath(`admin-portrait-${role}-${testInfo.project.name}.png`), fullPage: true });

        const editor = page.locator('#admin-pet-editor-card');
        await page.evaluate(() => sessionStorage.setItem('imgcat:pet', 'stale-preview'));
        await editor.locator('input[type=file]').first().setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: pixel });
        await expect.poll(() => uploads.length).toBe(2);
        expect(uploads.map(({ id }) => id).sort()).toEqual(['pet:rare-40', 'petcard:rare-40'].sort());
        for (const upload of uploads) {
            expect(upload.image).toMatch(/^data:image\/(?:webp|jpeg);base64,/);
            expect(upload.credential).toBe('qa-portrait-password');
        }
        await expect(editor.getByRole('img', { name: 'Volt Polecat', exact: true })).toHaveAttribute('src', uploads[0].image);
        await expect.poll(() => page.evaluate(() => sessionStorage.getItem('imgcat:pet'))).toBeNull();
        await editor.getByRole('button', { name: /Force-Save Avatar/ }).click();
        await expect.poll(() => uploads.length).toBe(4);
        expect(uploads.slice(2).map(({ id }) => id).sort()).toEqual(['pet:rare-40', 'petcard:rare-40'].sort());
        expect(errors).toEqual([]);
    });
}
