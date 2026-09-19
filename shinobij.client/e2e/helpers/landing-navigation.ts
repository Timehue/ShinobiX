import { expect, type Page } from '@playwright/test';

/** Use the sign-in entry that the responsive landing actually exposes. */
export async function openLandingLogin(page: Page) {
    await expect(page.locator('#landing-home')).toBeVisible();
    const desktopLogin = page.locator('.landing-desktop-login');
    const mobileMenu = page.getByRole('button', { name: 'Open navigation', exact: true });
    await expect.poll(async () => await desktopLogin.isVisible() || await mobileMenu.isVisible()).toBe(true);
    if (await desktopLogin.isVisible()) await desktopLogin.click();
    else {
        await mobileMenu.click();
        await page.locator('#landing-navigation').getByRole('button', { name: 'Log In', exact: true }).click();
    }
}
