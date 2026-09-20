import { expect, type Page } from '@playwright/test';

/** Use the same global Travel navigation on desktop and mobile. */
export async function returnToWorldAtlas(page: Page) {
    const info = page.getByRole('dialog', { name: 'Sector Info', exact: true });
    if (await info.isVisible()) {
        await info.getByRole('button', { name: 'Close Sector Info', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Travel', exact: true }).click();
    await expect(page.locator('.world-atlas-card')).toBeVisible();
}
