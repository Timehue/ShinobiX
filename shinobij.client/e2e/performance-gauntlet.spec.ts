import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime } from './helpers/ui-audit-runtime';

test('the bloodline gallery loads on demand and stops polling after the archive closes', async ({ page }) => {
    // Shorten only the five-minute poll (including its 10% jitter). Keep native
    // animation frames and input timing: a global fake clock can stall WebKit's
    // pointer-action stability checks and React's post-paint effect scheduling.
    await page.addInitScript(() => {
        const nativeSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (handler: TimerHandler, delay?: number, ...args: unknown[]) =>
            nativeSetTimeout(handler, delay !== undefined && delay >= 270_000 && delay <= 330_000
                ? delay / 1_000 : delay, ...args);
    });
    const runtime = await installUiAuditRuntime(page);
    let galleryRequests = 0;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/bloodlines/list', route => {
        galleryRequests++;
        return route.fulfill({ json: { bloodlines: [{
            id: 'performance-gallery', name: 'Measured Bloodline', rank: 'B Rank',
            jutsus: [], totalPoints: 0, ownerName: 'RivalNinja', ownerKey: 'rivalninja',
        }] } });
    });
    await expectUiAuditBoot(page, runtime, 'centralHub');
    const archiveButton = page.locator('.central-card').filter({ hasText: 'Ancient Archives' });
    expect(galleryRequests).toBe(0);
    await archiveButton.click();
    const archive = page.getByRole('dialog', { name: 'Ancient Archives' });
    await expect(archive.getByText('Measured Bloodline', { exact: true })).toBeVisible();
    // Prove the shortened recurring poll runs before testing its cleanup.
    await expect.poll(() => galleryRequests).toBeGreaterThanOrEqual(2);
    await archive.getByRole('button', { name: /close/i }).first().click();
    await expect(archive).toBeHidden();
    const requestsWhenClosed = galleryRequests;
    // Observe more than three maximum poll intervals with the archive closed.
    await page.waitForTimeout(1_000);
    expect(galleryRequests).toBe(requestsWhenClosed);
    await archiveButton.click();
    await expect.poll(() => galleryRequests).toBeGreaterThan(requestsWhenClosed);
    await expect(archive.getByText('Measured Bloodline', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
});

test('sector travel does not restart the full public-roster request', async ({ page }) => {
    const runtime = await installUiAuditRuntime(page);
    let rosterRequests = 0;
    let travels = 0;
    page.on('request', request => {
        const pathname = new URL(request.url()).pathname;
        if (pathname === '/api/player/roster') rosterRequests++;
        if (pathname === '/api/player/travel') travels++;
    });
    await expectUiAuditBoot(page, runtime, 'worldMap');
    await expect.poll(() => rosterRequests).toBeGreaterThan(0);
    const initialRequests = rosterRequests;
    const destination = page.getByRole('button', { name: /Travel to.*\(Sector 39\)/ });
    // Keyboard focus reveals destinations outside the mobile camera before
    // the same player-facing travel button is activated.
    await destination.focus();
    await destination.click();
    await expect.poll(() => travels).toBe(1);
    await expect(page.getByRole('complementary', { name: 'Sector 39 command panel' })).toBeVisible();
    expect(rosterRequests).toBe(initialRequests);
});
