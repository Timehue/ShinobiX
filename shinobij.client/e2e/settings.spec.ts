import { expect, test, type Page } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime } from './helpers/ui-audit-runtime';

async function setup(page: Page, ready = false) {
    const runtime = await installUiAuditRuntime(page);
    let requestedAt: number | null = ready ? Date.now() - 86_400_000 : null;
    const calls: string[] = [];
    await page.route('**/api/player/account-status', route => route.fulfill({ json: {
        ok: true, account: { name: 'auditninja', guest: false, google: false, hasPassword: true, socialLocked: false },
    } }));
    await page.route('**/api/player/account-deletion', route => {
        const action = route.request().method() === 'GET' ? 'status' : route.request().postDataJSON().action;
        calls.push(action);
        if (action === 'request') requestedAt ??= Date.now();
        if (action === 'cancel') requestedAt = null;
        return route.fulfill({ json: { ok: true, name: 'auditninja', requestedAt,
            availableAt: requestedAt === null ? null : requestedAt + 86_400_000,
            serverNow: Date.now(), ready: requestedAt !== null && Date.now() >= requestedAt + 86_400_000 } });
    });
    return { runtime, calls };
}

test('Settings sits beside Logout, replaces Character account cards, and preserves device preferences', async ({ page }, info) => {
    const { runtime } = await setup(page);
    await expectUiAuditBoot(page, runtime, 'profile');
    await expect(page.locator('.profile-page-card')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Change Password', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Recovery Code', exact: true })).toHaveCount(0);
    const desktop = page.locator('.right-menu-section--system');
    const mobileMenu = page.getByRole('button', { name: 'Menu', exact: true });
    await expect.poll(async () => await desktop.isVisible() || await mobileMenu.isVisible()).toBe(true);
    if (await desktop.isVisible()) {
        await expect(desktop.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();
        await desktop.getByRole('button', { name: 'Settings', exact: true }).click();
    } else {
        await mobileMenu.click();
        const system = page.locator('.mobile-menu-section').filter({ has: page.getByRole('heading', { name: 'System', exact: true }) });
        await expect(system.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();
        await system.getByRole('button', { name: 'Settings', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByLabel('Visual novel reader')).toHaveValue('cinematic');
    await page.getByLabel('Visual novel reader').selectOption('classic');
    await page.getByLabel('Master volume').fill('37');
    await page.getByLabel('Mute all audio').check();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('audioVolume.v1'))).toBe('0.37');
    await page.screenshot({ path: info.outputPath('settings-presentation-audio.png') });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Visual novel reader')).toHaveValue('classic');
    await expect(page.getByLabel('Master volume')).toHaveValue('37');
    await expect(page.getByLabel('Mute all audio')).toBeChecked();
    await page.getByLabel('Visual novel reader').selectOption('cinematic');
    await page.getByRole('heading', { name: 'Recovery Code', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('heading', { name: 'Change Password', exact: true })).toBeAttached();
    await expect(page.getByRole('heading', { name: 'Google sign-in', exact: true })).toBeAttached();
    await page.screenshot({ path: info.outputPath('settings-account.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('guest restrictions direct account management to Settings without duplicate link controls', async ({ page }) => {
    const { runtime } = await setup(page);
    await page.route('**/api/player/account-status', route => route.fulfill({ json: {
        ok: true, account: { name: 'auditninja', guest: true, google: false, hasPassword: false, socialLocked: true },
    } }));
    await expectUiAuditBoot(page, runtime, 'tavern');
    await expect(page.getByText('Open Settings beside Logout in the menu to link a Google account or set a password.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Link Google account', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Change Password', exact: true })).toHaveCount(0);
    const desktopSettings = page.locator('.right-menu-section--system').getByRole('button', { name: 'Settings', exact: true });
    const mobileMenu = page.getByRole('button', { name: 'Menu', exact: true });
    await expect.poll(async () => await desktopSettings.isVisible() || await mobileMenu.isVisible()).toBe(true);
    if (await desktopSettings.isVisible()) await desktopSettings.click();
    else {
        await mobileMenu.click();
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Link Google account', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Change Password', exact: true })).toBeVisible();
});

test('a deletion request persists across reload and remains cancellable during the wait', async ({ page }, info) => {
    const { runtime, calls } = await setup(page);
    await expectUiAuditBoot(page, runtime, 'settings');
    await page.getByRole('button', { name: 'Request account deletion', exact: true }).click();
    await page.getByRole('button', { name: 'Start 24-hour wait', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Delete account permanently', exact: true })).toBeDisabled();
    await expect(page.getByText(/Waiting period: 24h 0m remaining/)).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Cancel deletion request' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Delete account permanently', exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath('settings-deletion-wait.png') });
    await page.getByRole('button', { name: 'Cancel deletion request' }).click();
    await expect(page.getByRole('button', { name: 'Request account deletion', exact: true })).toBeVisible();
    expect(calls.filter(action => action === 'request')).toHaveLength(1);
    expect(calls).toContain('cancel');
});

test('after the wait, deletion still requires explicit confirmation and a masked password', async ({ page }) => {
    const { runtime } = await setup(page, true);
    let deletes = 0;
    await page.route('**/api/save/auditninja', async route => {
        if (route.request().method() === 'DELETE') { deletes++; return route.fulfill({ status: 503, json: { error: 'Test fixture: no account removed.' } }); }
        return route.fallback();
    });
    await expectUiAuditBoot(page, runtime, 'settings');
    const finalDelete = page.getByRole('button', { name: 'Delete account permanently', exact: true });
    await expect(finalDelete).toBeEnabled();
    await finalDelete.click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('dialog').or(page.getByRole('alertdialog'));
    await expect(dialog.locator('input[type=password]')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Delete Forever', exact: true })).toBeVisible();
    expect(deletes).toBe(0);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(deletes).toBe(0);
});

test('moved account controls still start Google linking, change passwords, and reveal recovery codes once', async ({ page }) => {
    const { runtime } = await setup(page);
    const actions: Record<string, unknown>[] = [];
    await page.route('**/api/auth/google/start', route => {
        actions.push(route.request().postDataJSON());
        return route.fulfill({ status: 503, json: { error: 'Google test service unavailable.' } });
    });
    await page.route('**/api/player-auth', route => {
        const body = route.request().postDataJSON();
        actions.push(body);
        return route.fulfill({ json: body.action === 'recovery-issue'
            ? { ok: true, recoveryCode: 'ABCDE12345FGHJK67890' }
            : { ok: true, token: 'settings-test-session-token' } });
    });
    await expectUiAuditBoot(page, runtime, 'settings');
    await page.getByRole('button', { name: 'Link Google account', exact: true }).click();
    await expect(page.getByText('Google test service unavailable.')).toBeVisible();
    expect(actions[0]?.mode).toBe('link');
    const password = page.locator('.change-password-card').filter({ has: page.getByRole('heading', { name: 'Change Password', exact: true }) });
    await password.getByLabel('Current password', { exact: true }).fill('OldTestPassword47');
    await password.getByLabel('New password', { exact: true }).fill('NewTestPassword47');
    await password.getByLabel('Confirm new password', { exact: true }).fill('NewTestPassword47');
    await password.getByRole('button', { name: 'Update Password', exact: true }).click();
    await expect(password.getByText('Password changed.', { exact: true })).toBeVisible();
    await expect(password.getByLabel('New password', { exact: true })).toHaveValue('');
    const recovery = page.locator('.recovery-code-card');
    await recovery.getByRole('button', { name: 'Generate a recovery code', exact: true }).click();
    await recovery.getByRole('button', { name: 'Yes, replace it', exact: true }).click();
    await expect(recovery.getByRole('group', { name: 'Your recovery code' })).toBeVisible();
    await recovery.getByRole('button', { name: 'I have saved it', exact: true }).click();
    await expect(recovery.getByRole('group', { name: 'Your recovery code' })).toHaveCount(0);
    expect(actions.map(action => action.action).filter(Boolean)).toEqual(['change', 'recovery-issue']);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('NewTestPassword47');
});
