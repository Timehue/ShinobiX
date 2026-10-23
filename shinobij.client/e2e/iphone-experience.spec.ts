import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime } from './helpers/ui-audit-runtime';
import { openLandingLogin } from './helpers/landing-navigation';

test('iPhone install instructions are discoverable before signing in', async ({ page }) => {
    await installUiAuditRuntime(page);
    await page.addInitScript(() => {
        localStorage.clear();
        localStorage.setItem('shinobix:storage-notice-ack', '1');
    });
    await page.goto('/');
    const guide = page.locator('.iphone-install-guide');
    await guide.locator('summary').click();
    await expect(guide).toContainText('Add to Home Screen');
    await expect(guide).toContainText('Open as Web App');
    await expect(guide).toContainText('guest shinobi');
    await expect(guide.locator('a')).toHaveAttribute('href', 'https://shinobijourney.com/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('Settings keeps installation help reachable and recognises Apple Home Screen mode', async ({ page }, testInfo) => {
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, 'settings');
    const guide = page.locator('.iphone-install-guide');
    await guide.locator('summary').click();
    await expect(guide).toContainText('Add to Home Screen');
    await page.screenshot({ path: testInfo.outputPath('settings.png'), scale: 'css' });
    if (testInfo.project.name === 'android-parity') return;
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }));
    await page.reload();
    await expect(guide.locator('summary')).toHaveText('Playing from your Home Screen');
    await guide.locator('summary').click();
    await expect(guide).toContainText('already using the Home Screen version');
});

test('phone resources have readable named bars and navigation survives rotation', async ({ page }, testInfo) => {
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, 'inventory');
    const hud = page.locator('.mobile-top-hud');
    const portrait = (page.viewportSize()?.width ?? 1000) < 560;
    if (portrait) {
        for (const name of ['HP', 'Chakra', 'Stamina']) await expect(hud.locator('.mthd-bar-name', { hasText: name })).toBeVisible();
        expect(await hud.locator('.mthd-bar-label').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
        expect(await hud.locator('.mthd-bar-label').evaluateAll(labels => labels.every(el => el.scrollWidth <= el.clientWidth))).toBe(true);
        const overlaps = await page.locator('.center-game').evaluate(el => el.getBoundingClientRect().top + parseFloat(getComputedStyle(el).paddingTop)
            < document.querySelector('.mobile-top-hud')!.getBoundingClientRect().bottom);
        expect(overlaps).toBe(false);
    }
    await page.screenshot({ path: testInfo.outputPath('inventory.png'), scale: 'css' });
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('.mobile-bottom-nav')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(hud.locator('.mthd-bar-name').first()).toBeVisible();
});

test('chat follows the visible keyboard viewport without treating pinch zoom as a keyboard', async ({ page }, testInfo) => {
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, 'tavern');
    const input = page.getByRole('textbox', { name: 'Message the tavern' });
    await input.fill('Testing the iPhone keyboard');
    // Desktop WebKit cannot summon an iOS keyboard. Exercise the actual
    // VisualViewport event path with the geometry supplied by that keyboard.
    await page.evaluate(() => {
        const viewport = window.visualViewport!;
        Object.defineProperties(viewport, {
            height: { value: window.innerHeight - Math.min(300, Math.floor(window.innerHeight * 0.45)), configurable: true },
            offsetTop: { value: 30, configurable: true },
            scale: { value: 1, configurable: true },
        });
        viewport.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('html')).toHaveAttribute('data-keyboard-open', '');
    await expect(page.locator('.mobile-bottom-nav')).toBeHidden();
    const geometry = await input.evaluate(el => ({ bottom: el.getBoundingClientRect().bottom, visibleBottom: visualViewport!.offsetTop + visualViewport!.height }));
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.visibleBottom);
    await expect(input).toHaveValue('Testing the iPhone keyboard');
    await page.screenshot({ path: testInfo.outputPath('keyboard-chat.png'), scale: 'css' });
    await page.evaluate(() => {
        Object.defineProperty(window.visualViewport, 'scale', { value: 1.5, configurable: true });
        window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('html')).not.toHaveAttribute('data-keyboard-open');
    await expect(page.locator('.mobile-bottom-nav')).toBeVisible();
    await page.evaluate(() => {
        for (const key of ['height', 'offsetTop', 'scale']) Reflect.deleteProperty(window.visualViewport!, key);
        (document.activeElement as HTMLElement)?.blur();
        window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('html')).not.toHaveAttribute('data-keyboard-open');
});

test('the destination menu stays readable, scrollable and dismissible on Safari', async ({ page }, testInfo) => {
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, 'village');
    const menu = page.getByRole('navigation', { name: 'Primary game navigation' }).getByRole('button', { name: /Menu/ });
    await menu.click();
    const dialog = page.getByRole('dialog', { name: 'Shinobi menu' });
    await expect(dialog).toBeVisible();
    const training = dialog.getByRole('button', { name: 'Training', exact: true });
    expect(await training.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(15);
    await training.scrollIntoViewIfNeeded();
    await expect(training).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('menu.png'), scale: 'css' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(menu).toBeFocused();
});

test('the Android app does not show an iPhone install promotion', async ({ page }) => {
    await installUiAuditRuntime(page);
    await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: navigator.userAgent + ' ShinobiJourneyApp/1' }));
    await page.goto('/#/settings');
    await expect(page.locator('.settings-page')).toBeVisible();
    await expect(page.locator('.iphone-install-guide')).toHaveCount(0);
});

test('Safari sign-in fields remain readable and the password toggle keeps the entered value', async ({ page }, testInfo) => {
    await installUiAuditRuntime(page);
    await page.addInitScript(() => {
        localStorage.clear();
        localStorage.setItem('shinobix:storage-notice-ack', '1');
    });
    await page.goto('/');
    await openLandingLogin(page);
    await page.getByRole('button', { name: 'Use a name and password' }).click();
    const name = page.getByPlaceholder('Enter existing shinobi name');
    const password = page.getByPlaceholder('Enter your password');
    await name.fill('AuditNinja');
    await password.fill('local-audit-password');
    expect(await password.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    await page.getByRole('button', { name: 'Show password', exact: true }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(password).toHaveValue('local-audit-password');
    await page.getByRole('button', { name: 'Hide password', exact: true }).click();
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveValue('local-audit-password');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('sign-in.png'), scale: 'css' });
});

test('the install guide is backed by a standalone manifest and a real Apple icon', async ({ page }) => {
    await installUiAuditRuntime(page);
    await page.goto('/#/settings');
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Shinobi');
    const manifestPath = await page.locator('link[rel="manifest"]').getAttribute('href');
    const response = await page.request.get(manifestPath!);
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    const iconPath = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
    const icon = await page.request.get(iconPath!);
    expect(icon.ok()).toBe(true);
    expect(icon.headers()['content-type']).toContain('image/png');
    expect((await icon.body()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
});

test('core mobile header clearance survives a missing optional presentation stylesheet', async ({ page }) => {
    await page.route('**/*mobile-noncombat-aaa*', route => route.abort());
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, 'inventory');
    const hud = page.locator('.mobile-top-hud');
    await expect(hud).toBeVisible();
    const geometry = await page.locator('.center-game').evaluate(el => {
        const style = getComputedStyle(el);
        const hudBottom = document.querySelector('.mobile-top-hud')!.getBoundingClientRect().bottom;
        return { contentTop: el.getBoundingClientRect().top + parseFloat(style.paddingTop), hudBottom };
    });
    expect(geometry.contentTop).toBeGreaterThanOrEqual(geometry.hudBottom);
    await expect(page.locator('.mobile-bottom-nav')).toBeVisible();
    if ((page.viewportSize()?.width ?? 1000) < 560) {
        await expect(hud.locator('.mthd-bar-name').first()).toBeVisible();
        expect(await hud.locator('.mthd-bar-label').evaluateAll(labels => labels.every(el => el.scrollWidth <= el.clientWidth))).toBe(true);
    }
});

test('returning to Safari refreshes keyboard geometry without losing the typed message', async ({ page }) => {
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, 'tavern');
    const input = page.getByRole('textbox', { name: 'Message the tavern' });
    await input.fill('Keep this message when I return');
    await page.evaluate(() => {
        Object.defineProperties(window.visualViewport!, {
            height: { value: window.innerHeight - Math.min(300, Math.floor(window.innerHeight * 0.45)), configurable: true },
            scale: { value: 1, configurable: true },
        });
        // A BFCache/app return need not emit a resize event.
        window.dispatchEvent(new Event('pageshow'));
    });
    await expect(page.locator('html')).toHaveAttribute('data-keyboard-open', '');
    await expect(page.locator('.mobile-bottom-nav')).toBeHidden();
    await page.evaluate(() => {
        for (const key of ['height', 'scale']) Reflect.deleteProperty(window.visualViewport!, key);
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('html')).not.toHaveAttribute('data-keyboard-open');
    await expect(page.locator('.mobile-bottom-nav')).toBeVisible();
    await expect(input).toHaveValue('Keep this message when I return');
});
