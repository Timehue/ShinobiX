import { expect, test } from '@playwright/test';

test.use({ contextOptions: { reducedMotion: 'no-preference' } });

test('landing sections begin their reveal before entering the viewport', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('shinobix:storage-notice-ack', '1'));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#landing-home')).toBeVisible();
    const sections = page.locator('#landing-home [data-landing-reveal]');
    const index = await sections.evaluateAll(elements => elements.findIndex(element =>
        element.getBoundingClientRect().top > window.innerHeight + 180));
    expect(index).toBeGreaterThanOrEqual(0);
    const section = sections.nth(index);

    // Approach an unseen section while it is still below the fold. Starting
    // its entrance only after it becomes visible produces the reported flash.
    await section.evaluate(element => window.scrollTo({
        top: window.scrollY + element.getBoundingClientRect().top - window.innerHeight - 60,
        behavior: 'instant',
    }));
    await expect(section).toHaveClass(/is-revealed/);
    expect(await section.evaluate(element => element.getBoundingClientRect().top >= window.innerHeight)).toBe(true);
});
