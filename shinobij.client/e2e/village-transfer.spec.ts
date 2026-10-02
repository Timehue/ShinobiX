import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page, query = '', failFirstTransfer = false) {
    const purchases: Record<string, unknown>[] = [];
    const transfers: Record<string, unknown>[] = [];
    await page.route('**/api/**', async route => {
        const body = route.request().postDataJSON();
        const current = JSON.parse((await page.getByTestId('transfer-state').textContent())!);
        if (route.request().url().endsWith('/shop/purchase')) {
            purchases.push(body);
            return route.fulfill({ json: { character: { ...current, fateShards: current.fateShards - 250, inventory: [...current.inventory, 'village-transfer-scroll'] }, _saveVersion: 2 } });
        }
        transfers.push(body);
        if (failFirstTransfer && transfers.length === 1) return route.fulfill({ status: 503, json: { error: 'Temporary connection failure. Retry transfer.' } });
        return route.fulfill({ json: { character: { ...current, village: body.village, inventory: [], storyVillage: current.village }, _saveVersion: 3 } });
    });
    await page.goto(`/e2e/fixtures/village-transfer.html${query}`);
    if (!query.includes('inventory')) await expect(page.getByRole('heading', { name: 'Village Transfer Scroll', exact: true })).toBeVisible();
    return { purchases, transfers };
}

test('both progression gates and sufficient shards are required', async ({ page }) => {
    for (const query of ['?level=99', '?story=8', '?shards=249']) {
        const requests = await setup(page, query);
        await expect(page.getByRole('button', { name: 'Buy scroll · 250 Fate Shards' })).toBeDisabled();
        expect(requests.purchases).toHaveLength(0);
    }
});

test('buy, cancel without consumption, reopen, and confirm a new home', async ({ page }, info) => {
    const { purchases, transfers } = await setup(page);
    const artwork = page.getByRole('img', { name: 'Village Transfer Scroll', exact: true });
    await expect(artwork).toHaveAttribute('src', '/items/village-transfer-scroll-v1.webp');
    await expect.poll(() => artwork.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(256);
    await page.screenshot({ path: info.outputPath('marketplace.png') });
    await page.getByRole('button', { name: 'Buy scroll · 250 Fate Shards' }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose your new village' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio')).toHaveCount(3);
    await expect(dialog.getByRole('radio', { name: 'Stormveil Village' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Select a village' })).toBeDisabled();
    await dialog.getByRole('radio', { name: 'Ashen Leaf Village' }).check();
    await page.screenshot({ path: info.outputPath('village-picker.png') });
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    const confirmBox = (await dialog.getByRole('button', { name: 'Transfer to Ashen Leaf Village' }).boundingBox())!;
    expect(confirmBox.y + confirmBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(transfers).toHaveLength(0);
    await page.getByRole('button', { name: 'Use scroll · Choose village' }).click();
    await dialog.getByRole('button', { name: 'Transfer to Ashen Leaf Village' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status')).toContainText('Your home is now Ashen Leaf Village');
    const saved = JSON.parse((await page.getByTestId('transfer-state').textContent())!);
    expect(saved.fateShards).toBe(250);
    expect(saved.inventory).toEqual([]);
    expect(saved.storyProgress).toBe(9);
    expect(purchases).toHaveLength(1);
    expect(transfers).toHaveLength(1);
});

test('failed transfer keeps the scroll and retries the same destination and request', async ({ page }) => {
    const { transfers } = await setup(page, '?owned', true);
    await page.getByRole('button', { name: 'Use scroll · Choose village' }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose your new village' });
    await dialog.getByRole('radio', { name: 'Moonshadow Village' }).check();
    await dialog.getByRole('button', { name: 'Transfer to Moonshadow Village' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Temporary connection failure');
    await expect(dialog.getByRole('radio', { name: 'Frostfang Village' })).toBeDisabled();
    expect(JSON.parse((await page.getByTestId('transfer-state').textContent())!).inventory).toEqual(['village-transfer-scroll']);
    await page.reload();
    await page.getByRole('button', { name: 'Resume village transfer' }).click();
    await expect(dialog.getByRole('radio', { name: 'Moonshadow Village' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Retry transfer', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toEqual(transfers[1]);
});

test('backpack scroll opens the marketplace with the correct art and use action', async ({ page }, info) => {
    const { purchases, transfers } = await setup(page, '?owned&inventory');
    await page.getByRole('button', { name: /Village Transfer Scroll/ }).first().click();
    const use = page.getByRole('button', { name: 'Use scroll at Grand Marketplace', exact: true });
    await expect(use).toBeVisible();
    const image = page.locator('img[src="/items/village-transfer-scroll-v1.webp"]').last();
    await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(256);
    const details = page.getByRole('dialog', { name: 'Village Transfer Scroll item details' });
    await expect(details).toContainText('Marketplace price: 250 Fate Shards');
    const imageBox = (await image.boundingBox())!;
    const detailsBox = (await details.boundingBox())!;
    expect(imageBox.x).toBeGreaterThanOrEqual(detailsBox.x);
    expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(detailsBox.x + detailsBox.width);
    await page.screenshot({ path: info.outputPath('backpack-scroll.png') });
    await use.click();
    await expect(page.getByRole('heading', { name: 'Grand Marketplace', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Use scroll · Choose village' }).click();
    await expect(page.getByRole('dialog', { name: 'Choose your new village' })).toBeVisible();
    expect(purchases).toHaveLength(0);
    expect(transfers).toHaveLength(0);
});

test('an uncertain purchase keeps its request across reload and can recover with a low wallet', async ({ page }) => {
    await setup(page);
    const requests: Record<string, unknown>[] = [];
    await page.route('**/api/shop/purchase', async route => {
        requests.push(route.request().postDataJSON());
        if (requests.length === 1) return route.fulfill({ status: 503, json: { error: 'Purchase reply interrupted.' } });
        const current = JSON.parse((await page.getByTestId('transfer-state').textContent())!);
        return route.fulfill({ json: { character: { ...current, inventory: ['village-transfer-scroll'] }, _saveVersion: 2 } });
    });
    await page.getByRole('button', { name: 'Buy scroll · 250 Fate Shards' }).click();
    await expect(page.getByRole('alert')).toContainText('Purchase reply interrupted');
    await page.goto('/e2e/fixtures/village-transfer.html?shards=0');
    await page.getByRole('button', { name: 'Retry scroll purchase' }).click();
    await expect(page.getByRole('dialog', { name: 'Choose your new village' })).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
});
