import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime } from './helpers/ui-audit-runtime';

test('the bloodline gallery loads on demand and stops polling after the archive closes', async ({ page }) => {
    await page.clock.install();
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
    expect(galleryRequests).toBe(0);
    await page.locator('.central-card').filter({ hasText: 'Ancient Archives' }).click();
    const archive = page.getByRole('dialog', { name: 'Ancient Archives' });
    await expect(archive.getByText('Measured Bloodline', { exact: true })).toBeVisible();
    expect(galleryRequests).toBe(1);
    await archive.getByRole('button', { name: /close/i }).first().click();
    await expect(archive).toBeHidden();
    // Fast-forward installed browser timers instead of sleeping five minutes.
    await page.clock.fastForward(301_000);
    expect(galleryRequests).toBe(1);
    await page.locator('.central-card').filter({ hasText: 'Ancient Archives' }).click();
    await expect.poll(() => galleryRequests).toBe(2);
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
    await page.getByRole('button', { name: /Travel to.*\(Sector 39\)/ }).click();
    await expect.poll(() => travels).toBe(1);
    await expect(page.getByRole('complementary', { name: 'Sector 39 command panel' })).toBeVisible();
    expect(rosterRequests).toBe(initialRequests);
});
