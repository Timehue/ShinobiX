import { expect, test, type Page } from '@playwright/test';

// A neutral age screen (COPPA): the creator asks a birth year without hinting at
// the cutoff, refuses an under-13 answer, and remembers it in this browser so
// picking another year after a reload does not reopen the door. The year is
// never sent anywhere.
async function openIdentityStep(page: Page) {
    await page.route('**/api/**', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
    await page.addInitScript(() => localStorage.setItem('shinobix:storage-notice-ack', '1'));
    await page.goto('/');
    await page.getByTestId('start-create').click();
    await page.getByRole('button', { name: 'Choose village', exact: true }).click();
    await page.locator('.cc-village-card').first().click();
    await page.getByRole('button', { name: 'Choose bloodline', exact: true }).click();
    await page.locator('.cc-bloodline-card').first().click();
    await page.getByRole('button', { name: 'Choose avatar', exact: true }).click();
    await page.locator('.cc-avatar-card').first().click();
    await page.getByRole('button', { name: 'Preview shinobi', exact: true }).click();
    await page.getByRole('button', { name: 'Name and password', exact: true }).click();
}

test('the creator asks a neutral birth year and refuses an under-13 answer for good', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => { if (request.method() !== 'GET') requests.push(`${request.url()} ${request.postData() ?? ''}`); });
    await openIdentityStep(page);
    const year = page.locator('#cc-birth-year');
    await expect(year).toHaveValue('');
    await expect(page.locator('.cc-flow')).not.toContainText('13 or older');
    await page.locator('#cc-name').fill('Agecheck');
    await page.locator('#cc-password').fill('a-long-test-password-1');
    await page.locator('#cc-confirm-password').fill('a-long-test-password-1');
    await page.getByRole('button', { name: 'Enter the world', exact: true }).click();
    await expect(page.locator('#cc-birth-year-error')).toHaveText('Choose your birth year.');

    const thisYear = new Date().getFullYear();
    await year.selectOption(String(thisYear - 10));
    await page.getByRole('button', { name: 'Enter the world', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText("Sorry, you can't create an account right now.");
    await expect(page.getByRole('button', { name: 'Enter the world', exact: true })).toBeDisabled();
    await expect(year).toBeDisabled();
    expect(requests.filter((line) => line.includes(String(thisYear - 10))), 'the year is never sent').toEqual([]);

    await page.reload();
    await openIdentityStep(page);
    await expect(page.locator('#cc-birth-year')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Enter the world', exact: true })).toBeDisabled();
});
