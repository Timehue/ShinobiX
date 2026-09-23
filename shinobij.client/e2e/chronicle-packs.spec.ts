import { expect, test } from '@playwright/test';

test('elemental purchase adopts the save, uses its wrapper art, and opens the existing reveal', async ({ page }) => {
    const requests: Array<{ packType: string; requestId: string }> = [];
    let fireIds: string[] = [];
    await page.route('**/api/card-clash/open-pack', async (route) => {
        const body = route.request().postDataJSON() as { packType: string; requestId: string };
        requests.push(body);
        const version = requests.length + 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            ok: true, cards: fireIds, currency: 'chroniclePoints', cost: 100,
            balance: 200 - requests.length * 100, _saveVersion: version,
            character: {
                name: 'PackGalleryQA', level: 20, starterCardsClaimed: true,
                chroniclePoints: 200 - requests.length * 100, fateShards: 30,
                tileCards: fireIds,
            },
        }) });
    });
    await page.goto('/e2e/fixtures/chronicle-packs.html');
    fireIds = await page.evaluate(() => (window as Window & { __qaFireIds: string[] }).__qaFireIds);
    expect(fireIds).toHaveLength(5);
    await expect(page.getByRole('heading', { name: 'Choose your next draw' })).toBeVisible();
    const fire = page.locator('.chronicle-pack--fire');
    await fire.scrollIntoViewIfNeeded();
    await expect.poll(() => fire.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await fire.getByRole('button', { name: /Open Fire Pack/ }).click();
    await expect(page.getByTestId('adopted-version')).toHaveText('2');
    const opening = page.getByRole('dialog', { name: 'Fire Pack opening' });
    await expect(opening).toBeVisible();
    await expect(opening).toHaveCSS('--pack-art', 'url("/chronicle/packs/fire.webp")');
    expect(requests).toHaveLength(1);
    expect(requests[0].packType).toBe('fire');
    expect(requests[0].requestId).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
    await opening.getByRole('button', { name: /Skip/ }).click();
    await expect(opening.getByRole('button', { name: /Done/ })).toBeVisible();
    await opening.getByRole('button', { name: /Done/ }).click();
    await expect(opening).toHaveCount(0);
    await expect(page.getByLabel('Pack balances')).toContainText('100 Chronicle Points');
    await expect(page.getByLabel('Pack balances')).toContainText('5 owned cards');

    for (const art of ['random', 'water', 'earth', 'wind', 'lightning', 'elite-cardgame', 'legendary-cardgame']) {
        const response = await page.request.get(`/chronicle/packs/${art}.webp`);
        expect(response.ok(), art).toBe(true);
        expect(response.headers()['content-type'], art).toContain('image/webp');
    }
});
