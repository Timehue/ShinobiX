import { expect, test } from '@playwright/test';

test('saved continuous-duel preview links cannot mount a retired battle', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/petvfx.html?duel=1&cine=1&quick=1&dueltick=5000&settlementqa=1&petQuality=low', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('This preview has been retired. Open Pet Arena in the game.', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open game' })).toHaveAttribute('href', '/');
    await expect(page.getByTestId('pet-duel-root')).toHaveCount(0);
    await expect(page.getByText('Choose the Fight Plan', { exact: true })).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(errors).toEqual([]);
});
