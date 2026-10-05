import { expect } from '@playwright/test';
import { test } from './helpers/reconnecting-request';
import { uiAuditSave } from '../e2e/helpers/ui-audit-runtime';

function acknowledgeLandingNotices() {
    localStorage.setItem('shinobij_cookie_notice_v1', 'accepted');
    localStorage.setItem('shinobij_age_gate_v1', 'accepted');
    localStorage.setItem('shinobij_privacy_notice_v1', 'accepted');
}

test('guest landing requests its stylesheet and renders the hero', async ({ page }) => {
    await page.addInitScript(acknowledgeLandingNotices);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('.landing-root')).toBeVisible();
    await expect.poll(() => page.evaluate(() =>
        performance.getEntriesByType('resource').some(entry =>
            entry.name.includes('/assets/landing-home-') && entry.name.endsWith('.css'),
        ),
    )).toBe(true);
});

test('fresh mobile landing keeps its complete brand and entry action usable with the storage notice', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const logo = page.locator('.landing-logo--hero .landing-logo-art');
    const notice = page.getByRole('region', { name: 'Data storage notice' });
    const enter = page.getByTestId('start-create');
    await expect(logo).toBeVisible();
    await expect(notice).toBeVisible();
    await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: info.outputPath('mobile-landing-fresh.png') });
    const initial = await page.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON();
        return {
            viewport: { width: innerWidth, height: innerHeight },
            title: rect('.landing-title'), logo: rect('.landing-logo--hero .landing-logo-art'),
            entry: rect('[data-testid="start-create"]'), notice: rect('.storage-notice'),
            explore: rect('.landing-hero-actions .landing-cta--ghost'),
            background: getComputedStyle(document.querySelector('.landing-hero')!).backgroundImage,
            horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        };
    });
    await info.attach('mobile-initial-placement', { body: JSON.stringify(initial, null, 2), contentType: 'application/json' });
    expect(initial.horizontalOverflow).toBe(false);
    expect(initial.background).toContain('hero-shinobi-mobile.webp');
    expect(initial.logo.bottom).toBeLessThanOrEqual(initial.title.bottom + 1);
    expect(initial.entry.bottom).toBeLessThan(initial.notice.top);
    expect(initial.explore.bottom, 'the secondary entry action must also fully clear the notice').toBeLessThan(initial.notice.top);
    await enter.scrollIntoViewIfNeeded();
    const hit = await enter.evaluate(button => {
        const action = button.getBoundingClientRect();
        const target = document.elementFromPoint(action.left + action.width / 2, action.top + action.height / 2);
        return button === target || button.contains(target);
    });
    expect(hit, 'the storage notice must not cover the entry action after scrolling it into view').toBe(true);
    await page.screenshot({ path: info.outputPath('mobile-landing-entry.png') });
    await enter.click();
    await expect(page.getByRole('heading', { name: 'Begin as a Shinobi' })).toBeVisible();
});

test('restored player skips landing CSS and opens the saved game screen', async ({ page, request }) => {
    const name = `cssrestore${Date.now().toString(36)}`;
    const registration = await request.post('/api/player-auth', {
        data: { action: 'register', name, password: 'LocalPerf!2941' },
    });
    expect(registration.status(), await registration.text()).toBe(200);
    const token = String((await registration.json()).token ?? '');
    expect(token).not.toBe('');

    const save = uiAuditSave();
    save.character = { ...save.character, name };
    const seeded = await request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': 'live-express-e2e-admin' },
        data: save,
    });
    expect(seeded.status(), await seeded.text()).toBe(200);
    const acknowledged = await request.post(`/api/save/${name}?ack=1`, {
        headers: { 'x-player-name': name, 'x-player-token': token },
    });
    expect(acknowledged.status(), await acknowledged.text()).toBe(200);

    await page.addInitScript(({ accountName, playerToken }) => {
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: accountName }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [accountName]: { token: playerToken } }));
        localStorage.setItem('shinobix:activePlayerPersist', accountName);
        localStorage.setItem('shinobix:activeTokenPersist', playerToken);
        localStorage.setItem('shinobij_cookie_notice_v1', 'accepted');
        localStorage.setItem('shinobij_age_gate_v1', 'accepted');
        localStorage.setItem('shinobij_privacy_notice_v1', 'accepted');
    }, { accountName: name, playerToken: token });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'village');
    const landingCssRequested = await page.evaluate(() =>
        performance.getEntriesByType('resource').some(entry =>
            entry.name.includes('/assets/landing-home-') && entry.name.endsWith('.css'),
        ),
    );
    expect(landingCssRequested).toBe(false);
});
