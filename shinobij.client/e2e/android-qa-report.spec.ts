import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test.describe('touch scrolling', () => {
    test.use({ hasTouch: true });
    test('You sheet accepts a finger swipe after rotating to landscape', async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'CDP touch injection is Chromium-specific.');
        await page.setViewportSize({ width: 360, height: 640 });
        const runtime = await installUiAuditRuntime(page);
        await expectUiAuditBoot(page, runtime, 'profile');
        await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'You', exact: true }).tap();
        await page.setViewportSize({ width: 844, height: 390 });
        const body = page.locator('.mobile-profile-sheet-body');
        const box = (await body.boundingBox())!;
        const session = await page.context().newCDPSession(page);
        const x = box.x + box.width / 2;
        const y = box.y + box.height - 20;
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let i = 1; i <= 6; i++) {
            await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 22 }] });
            await page.waitForTimeout(30);
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => body.evaluate(e => e.scrollTop)).toBeGreaterThan(30);
        await page.getByRole('dialog', { name: 'Your shinobi' }).getByRole('button', { name: 'Close', exact: true }).tap();
        await expect(page.locator('body')).not.toHaveClass(/ui-scroll-locked/);
        await session.detach();
    });
});

for (const viewport of [{ width: 844, height: 390 }, { width: 667, height: 320 }, { width: 360, height: 640 }]) {
    test(`You sheet scrolls its body and keeps Close reachable at ${viewport.width}x${viewport.height}`, async ({ page, browserName, isMobile }) => {
        await page.setViewportSize(viewport);
        const runtime = await installUiAuditRuntime(page);
        await expectUiAuditBoot(page, runtime, 'profile');
        await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'You', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Your shinobi' });
        const body = dialog.locator('.mobile-profile-sheet-body');
        await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
        const box = (await body.boundingBox())!;
        if (browserName === 'webkit' && isMobile) {
            // Playwright's mobile WebKit protocol has no wheel input. Keep the
            // overflow/close geometry check; Android gestures are covered above.
            await body.locator(':scope > *').last().scrollIntoViewIfNeeded();
        } else {
            await page.mouse.move(box.x + box.width / 2, box.y + Math.min(80, box.height / 2));
            await page.mouse.wheel(0, 600);
        }
        await expect.poll(() => body.evaluate(e => e.scrollTop)).toBeGreaterThan(20);
        await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
        await page.screenshot({ path: test.info().outputPath('you-sheet.png') });
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.locator('body')).not.toHaveClass(/ui-scroll-locked/);
    });
}

test('account rename applies a versioned save and survives a reload on the same account', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    const save = uiAuditSave();
    const runtime = await installUiAuditRuntime(page, save);
    await page.route('**/api/player/account-name', async route => {
        expect(route.request().postDataJSON()).toEqual({ playerName: 'AuditNinja', accountName: 'RenamedNinja' });
        const character = { ...save.character, accountName: 'RenamedNinja' };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(character, version);
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, character, _saveVersion: version }) });
    });
    await expectUiAuditBoot(page, runtime, 'profile');
    await page.getByLabel('Account name', { exact: true }).fill('RenamedNinja');
    await page.getByRole('button', { name: 'Save Account Name', exact: true }).click();
    await expect(page.locator('.account-name-card [role=status]')).toContainText('Sign in with RenamedNinja');
    await expect(page.locator('.shinobi-identity-card h3')).toHaveText('RenamedNinja');
    await page.reload();
    await expect(page.locator('.shinobi-identity-card h3')).toHaveText('RenamedNinja');
    await expect(page.getByRole('complementary', { name: 'Device and server saves diverged' })).toHaveCount(0);
});

for (const viewport of [{ width: 844, height: 390 }, { width: 667, height: 320 }]) {
    test(`opening cinematic keeps actors and scrollable choices usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const save = uiAuditSave();
        save.character = { ...save.character, level: 1, onboardingStep: 'academyIntro', academyChecklistClaimed: false, avatarImage: '/starter-avatar-two.webp?v=2' };
        await installUiAuditRuntime(page, save);
        await page.goto('/#/village');
        const dialogue = page.locator('.icx-dialogue');
        await expect(dialogue).toBeVisible();
        for (let i = 0; i < 3; i++) {
            await expect(page.locator('.icx-advance')).toBeVisible();
            await dialogue.click();
        }
        await expect(page.locator('.icx-fox-base')).toBeVisible();
        await expect(page.locator('.icx-advance')).toBeVisible();
        const panel = (await dialogue.boundingBox())!;
        for (const selector of ['.icx-fox-base', '.icx-avatar img']) {
            const actor = (await page.locator(selector).boundingBox())!;
            expect(actor.y).toBeGreaterThanOrEqual(-1);
            expect(actor.y + actor.height).toBeLessThanOrEqual(panel.y + 1);
        }
        expect(panel.y + panel.height).toBeLessThanOrEqual(viewport.height);
        await page.screenshot({ path: test.info().outputPath('cinematic-landscape.png') });
        await page.getByRole('button', { name: 'Skip' }).click();
        const choices = page.locator('.icx-vow-card');
        await choices.last().scrollIntoViewIfNeeded();
        await choices.last().click();
        await page.getByRole('button', { name: 'Skip' }).click();
        const pets = page.locator('.icx-pet-card');
        await pets.last().scrollIntoViewIfNeeded();
        await pets.last().click();
        await expect(page.locator('.icx-btn-take')).toBeInViewport();
        await page.screenshot({ path: test.info().outputPath('cinematic-confirm.png') });
        await page.locator('.icx-btn-take').click();
        for (let i = 0; i < 5 && !await page.locator('.icx-root.is-beat-world').count(); i++) {
            await expect(page.locator('.icx-advance')).toBeVisible();
            await dialogue.click();
        }
        await expect(page.locator('.icx-root.is-beat-world')).toBeVisible();
        await expect(page.locator('.icx-world-title')).toBeInViewport();
        const worldPanel = (await dialogue.boundingBox())!;
        for (const selector of ['.icx-fox-base', '.icx-avatar img', '.icx-gift-pet']) {
            const actor = (await page.locator(selector).boundingBox())!;
            expect(actor.y).toBeGreaterThanOrEqual(-1);
            expect(actor.y + actor.height).toBeLessThanOrEqual(worldPanel.y + 1);
        }
        await page.screenshot({ path: test.info().outputPath('cinematic-world.png') });
    });
}

for (const viewport of [{ width: 360, height: 640 }, { width: 844, height: 390 }, { width: 1024, height: 600 }]) {
    test(`profile explains avatar access and scrolls at ${viewport.width}x${viewport.height}`, async ({ page, browserName, isMobile }) => {
        await page.setViewportSize(viewport);
        const runtime = await installUiAuditRuntime(page);
        await expectUiAuditBoot(page, runtime, 'profile');
        await expect(page.getByRole('button', { name: 'Upload Avatar', exact: true })).toBeDisabled();
        await expect(page.locator('#profile-avatar-restriction')).toBeVisible();
        await expect(page.locator('.profile-avatar-upload input[type=file]')).toHaveCount(0);
        const scrollPosition = () => page.evaluate(() =>
            (document.scrollingElement?.scrollTop ?? 0) + (document.querySelector('.center-game')?.scrollTop ?? 0));
        const beforeScroll = await scrollPosition();
        const account = page.getByRole('heading', { name: 'Change Password', exact: true });
        const content = (await page.locator('.center-game').boundingBox())!;
        if (browserName === 'webkit' && isMobile) await account.scrollIntoViewIfNeeded();
        else {
            await page.mouse.move(content.x + content.width / 2, Math.min(viewport.height - 100, content.y + 180));
            await page.mouse.wheel(0, 450);
        }
        await expect.poll(scrollPosition).toBeGreaterThan(beforeScroll);
        await account.scrollIntoViewIfNeeded();
        await expect(account).toBeInViewport();
        const showPasswords = page.getByRole('checkbox', { name: 'Show passwords', exact: true });
        const toggleLabel = page.locator('.change-password-card label').filter({ has: showPasswords });
        await toggleLabel.scrollIntoViewIfNeeded();
        const toggleBox = (await toggleLabel.boundingBox())!;
        expect(Math.round(toggleBox.width)).toBeGreaterThanOrEqual(44);
        expect(Math.round(toggleBox.height)).toBeGreaterThanOrEqual(44);
        // Activate the label's far edge, outside the compact checkbox artwork.
        await toggleLabel.click({ position: { x: toggleBox.width - 4, y: toggleBox.height / 2 } });
        await expect(showPasswords).toBeChecked();
        await expect(page.locator('.change-password-card').getByLabel('Current password', { exact: true })).toHaveAttribute('type', 'text');
        await showPasswords.uncheck();
        const checkboxBox = (await showPasswords.boundingBox())!;
        expect(checkboxBox.width).toBeLessThanOrEqual(22);
        expect(checkboxBox.height).toBeLessThanOrEqual(22);
        await page.getByRole('button', { name: 'Update Password', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: test.info().outputPath('profile-account.png') });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
}

test('renamed login loads the original save and keeps primary navigation connected', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    const save = uiAuditSave();
    save.character = { ...save.character, accountName: 'LoginAlias' };
    const runtime = await installUiAuditRuntime(page, save);
    await expectUiAuditBoot(page, runtime, 'profile');
    await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await page.route('**/api/player-auth', async route => {
        const body = route.request().postDataJSON();
        if (body.action === 'verify') expect(body.name).toBe('loginalias');
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, token: 'ui-audit-token', name: 'AuditNinja' }) });
    });
    await page.getByRole('button', { name: 'Log In', exact: true }).click();
    await page.getByRole('button', { name: 'Use a name and password', exact: true }).click();
    await page.getByPlaceholder('Enter existing shinobi name', { exact: true }).fill('LoginAlias');
    await page.getByPlaceholder('Enter your password', { exact: true }).fill('ExamplePass123');
    await page.getByRole('button', { name: /Enter Village/ }).click();
    await expect(page.locator('.app-shell')).toBeVisible();
    const nav = page.locator('.mobile-bottom-nav');
    for (const [label, screen] of [['Items', 'inventory'], ['Village', 'village'], ['Travel', 'worldMap']]) {
        await nav.getByRole('button', { name: label, exact: true }).click();
        await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', screen);
        await expect(nav.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    }
    // The loaded world map owns fullscreen chrome. Return via its actual
    // control instead of racing the lazy mount to click a disappearing navbar.
    await page.getByRole('button', { name: '← Village', exact: true }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'village');
    await nav.getByRole('button', { name: 'You', exact: true }).click();
    await expect(page.locator('.mobile-profile-sheet .left-profile-name')).toHaveText('LoginAlias');
    await page.getByRole('dialog', { name: 'Your shinobi' }).getByTitle('View character profile').click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'profile');
});

test('supporters can open the avatar picker from the profile button', async ({ page }) => {
    const save = uiAuditSave();
    save.character = { ...save.character, patreon: { active: true, tier: 'shinobi-supporter' } };
    const runtime = await installUiAuditRuntime(page, save);
    await expectUiAuditBoot(page, runtime, 'profile');
    const picker = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload Avatar', exact: true }).click();
    expect((await picker).isMultiple()).toBe(false);
});

for (const viewport of [{ width: 360, height: 640 }, { width: 844, height: 390 }]) {
    test(`creator password controls stay within their fields at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.addInitScript(() => localStorage.setItem('shinobix:storage-notice-ack', '1'));
        await page.route('**/api/**', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
        await page.goto('/');
        await page.getByTestId('start-create').click();
        for (const label of ['Choose Village', 'Choose Bloodline', 'Choose Avatar', 'Preview Shinobi', 'Name and Password']) {
            await page.getByRole('button', { name: label, exact: true }).click();
        }
        for (const id of ['cc-password', 'cc-confirm-password']) {
            const field = page.locator(`#${id}`);
            await field.fill('ExamplePass123');
            const wrap = page.locator('.cc-password-wrap').filter({ has: field });
            const toggle = wrap.getByRole('button');
            await toggle.click();
            await expect(field).toHaveAttribute('type', 'text');
            await toggle.click();
            await expect(field).toHaveAttribute('type', 'password');
            const inputBox = (await field.boundingBox())!;
            const buttonBox = (await toggle.boundingBox())!;
            // Firefox reports an exact 44px box as 43.999969px at some offsets.
            expect(Math.round(buttonBox.width)).toBeGreaterThanOrEqual(44);
            expect(Math.round(buttonBox.height)).toBeGreaterThanOrEqual(44);
            expect(buttonBox.y).toBeGreaterThanOrEqual(inputBox.y);
            expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(inputBox.y + inputBox.height + 1);
            expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(inputBox.x + inputBox.width);
        }
        await page.getByRole('button', { name: 'Enter the World', exact: true }).scrollIntoViewIfNeeded();
        await expect(page.getByRole('button', { name: 'Enter the World', exact: true })).toBeInViewport();
        await page.getByRole('button', { name: 'Enter the World', exact: true }).click({ trial: true });
        await page.screenshot({ path: test.info().outputPath('creator-passwords.png') });
    });

    test(`login password toggle remains centered on hover at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.addInitScript(() => localStorage.setItem('shinobix:storage-notice-ack', '1'));
        await page.route('**/api/**', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
        await page.goto('/');
        const openLogin = page.getByRole('button', { name: 'Log In', exact: true });
        await openLogin.click();
        await page.getByRole('button', { name: 'Use a name and password', exact: true }).click();
        const field = page.getByPlaceholder('Enter your password', { exact: true });
        const toggle = page.getByRole('button', { name: 'Show password', exact: true });
        await field.fill('ExamplePass123');
        await toggle.hover();
        await expect.poll(async () => {
            const inputBox = (await field.boundingBox())!;
            const buttonBox = (await toggle.boundingBox())!;
            return Math.abs((inputBox.y + inputBox.height / 2) - (buttonBox.y + buttonBox.height / 2));
        }).toBeLessThan(1);
        await toggle.click();
        await expect(field).toHaveAttribute('type', 'text');
        await page.getByRole('button', { name: 'Hide password', exact: true }).click();
        await expect(field).toHaveAttribute('type', 'password');
        await page.screenshot({ path: test.info().outputPath('login-password.png') });
    });
}
