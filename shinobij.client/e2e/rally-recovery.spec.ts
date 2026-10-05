import { expect, test } from '@playwright/test';

test('a failed 3D download falls back to battery saver and survives race-desk retry', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    });
    let blocked = 0;
    await page.route('**/RallyCanvas.tsx*', route => { blocked++; return route.abort(); });
    await page.goto('/e2e/fixtures/rally-recovery.html');
    await expect(page.getByText('Battery saver active', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ready to race' })).toBeEnabled();
    expect(blocked).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Race desk', exact: true }).click();
    await page.getByRole('button', { name: 'Start practice' }).click();
    await expect(page.getByText('Battery saver active', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ready to race' })).toBeEnabled();
});

test('battery saver can recover from a drawing-surface failure without refreshing', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('petRally.render.v1', 'economy');
        // Force low-end mode independent of the device running this check.
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 });
        const original = HTMLCanvasElement.prototype.getContext;
        let failed = false;
        HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof original>) {
            if (args[0] === '2d' && !failed) { failed = true; return null; }
            return original.apply(this, args);
        } as typeof original;
    });
    await page.goto('/e2e/fixtures/rally-recovery.html');
    await expect(page.getByRole('alert')).toContainText('The race graphics could not load');
    await expect(page.getByRole('button', { name: 'Ready to race' })).toBeDisabled();
    await page.getByRole('button', { name: 'Race desk', exact: true }).click();
    await page.getByRole('button', { name: 'Start practice' }).click();
    await expect(page.getByRole('button', { name: 'Ready to race' })).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
});
