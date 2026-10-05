import { expect, test } from '@playwright/test';

const fixture = '/e2e/fixtures/profession-change.html';

test('profession scroll stays beside the village scroll and enforces purchase requirements', async ({ page }, info) => {
    for (const query of ['level=19', 'profession=', 'shards=199']) {
        await page.goto(`${fixture}?${query}`);
        const scroll = page.getByRole('region', { name: 'Profession Change Scroll' });
        await expect(scroll.getByRole('button', { name: /Buy scroll/ })).toBeDisabled();
    }
    await page.goto(fixture);
    const scrolls = page.locator('.marketplace-scrolls');
    await expect(scrolls.getByRole('heading', { name: 'Village Transfer Scroll' })).toBeVisible();
    await expect(scrolls.getByRole('heading', { name: 'Profession Change Scroll' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Profession Change Scroll' }).getByRole('button', { name: /Buy scroll/ })).toBeEnabled();
    const artwork = page.getByRole('img', { name: 'Profession Change Scroll', exact: true });
    await expect(artwork).toHaveAttribute('src', '/items/profession-change-scroll-v1.webp');
    await expect.poll(() => artwork.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(320);
    const bounds = await scrolls.locator(':scope > section').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }));
    if (info.project.name === 'desktop') expect(bounds[0].top).toBe(bounds[1].top);
    else expect(bounds[1].top).toBeGreaterThanOrEqual(bounds[0].bottom);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await scrolls.screenshot({ path: info.outputPath('marketplace-scrolls.png') });
});

for (const from of ['healer', 'vanguard', 'petTamer']) {
    test(`${from} can buy a scroll and choose only the other two paths`, async ({ page }, info) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${fixture}?profession=${from}`);
        const original = JSON.parse((await page.getByTestId('profession-state').textContent())!);
        let saved = original;
        let purchases = 0;
        let changes = 0;
        await page.route('**/api/shop/purchase', async route => {
            const body = route.request().postDataJSON();
            expect(body).toMatchObject({ playerName: 'ProfessionQA', itemId: 'profession-change-approval', qty: 1 });
            expect(body.requestId).toBeTruthy();
            purchases++;
            saved = { ...saved, fateShards: saved.fateShards - 200, inventory: ['profession-change-approval'] };
            await route.fulfill({ json: { character: saved, _saveVersion: 2 } });
        });
        const to = from === 'healer' ? 'petTamer' : 'healer';
        await page.route('**/api/profession/choose', async route => {
            expect(route.request().postDataJSON()).toEqual({ playerName: 'ProfessionQA', fromProfession: from, fromProfessionChosenAt: null, profession: to, respec: true });
            changes++;
            saved = { ...saved, profession: to, professionRank: 1, professionXp: 0, masterySpec: {}, inventory: [] };
            await route.fulfill({ json: { character: saved, _saveVersion: 3 } });
        });
        const scroll = page.getByRole('region', { name: 'Profession Change Scroll' });
        await scroll.getByRole('button', { name: /Buy scroll/ }).click();
        const dialog = page.getByRole('dialog', { name: 'Choose your new profession' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('radio')).toHaveCount(2);
        await expect(dialog.locator(`input[value="${from}"]`)).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        expect(changes).toBe(0);
        await scroll.getByRole('button', { name: 'Use scroll · Choose profession' }).click();
        await dialog.locator(`input[value="${to}"]`).check();
        await expect(dialog.getByText(/Rank 1 with 0 XP and no mastery/)).toBeVisible();
        if (from === 'vanguard') await dialog.screenshot({ path: info.outputPath('profession-confirmation.png') });
        await dialog.getByRole('button', { name: /Become/ }).click();
        await expect(dialog).toHaveCount(0);
        await expect(scroll.getByRole('status')).toContainText('Rank 1 with 0 XP');
        expect(purchases).toBe(1);
        expect(changes).toBe(1);
        const state = JSON.parse((await page.getByTestId('profession-state').textContent())!);
        expect(state).toMatchObject({ profession: to, professionRank: 1, professionXp: 0, level: original.level, xp: original.xp, fateShards: 300, inventory: [] });
        expect(errors).toEqual([]);
    });
}

test('an uncertain purchase reuses its request ID after reload', async ({ page }) => {
    await page.goto(fixture);
    const original = JSON.parse((await page.getByTestId('profession-state').textContent())!);
    const ids: string[] = [];
    await page.route('**/api/shop/purchase', async route => {
        ids.push(route.request().postDataJSON().requestId);
        if (ids.length === 1) return route.abort('failed');
        return route.fulfill({ json: { character: { ...original, fateShards: 300, inventory: ['profession-change-approval'] }, _saveVersion: 2 } });
    });
    const scroll = page.getByRole('region', { name: 'Profession Change Scroll' });
    await scroll.getByRole('button', { name: /Buy scroll/ }).click();
    await expect(scroll.getByRole('alert')).toBeVisible();
    await page.reload();
    await scroll.getByRole('button', { name: 'Retry scroll purchase' }).click();
    await expect(page.getByRole('dialog', { name: 'Choose your new profession' })).toBeVisible();
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
});

test('backpack scroll shows its artwork and leads to the marketplace change action', async ({ page }, info) => {
    await page.goto(`${fixture}?owned&inventory`);
    await page.getByRole('button', { name: /Profession Change Scroll/ }).first().click();
    const details = page.getByRole('dialog', { name: 'Profession Change Scroll item details' });
    await expect(details).toContainText('Marketplace price: 200 Fate Shards');
    await expect(details.getByRole('button', { name: /^Equip/ })).toHaveCount(0);
    const artwork = details.locator('img[src="/items/profession-change-scroll-v1.webp"]');
    await expect.poll(() => artwork.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(320);
    await details.screenshot({ path: info.outputPath('backpack-scroll.png') });
    await details.getByRole('button', { name: 'Use scroll at Grand Marketplace', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Grand Marketplace', exact: true })).toBeVisible();
    // The scroll cards sit below every item group; the hand-off must land on this
    // card. Checked before any click, because a Playwright click scrolls by itself.
    const useScroll = page.getByRole('button', { name: 'Use scroll · Choose profession', exact: true });
    await expect(useScroll).toBeInViewport();
    await useScroll.click();
    await expect(page.getByRole('dialog', { name: 'Choose your new profession' }).getByRole('radio')).toHaveCount(2);
});

test('an uncertain profession change keeps its destination across reload', async ({ page }) => {
    await page.goto(`${fixture}?owned`);
    const original = JSON.parse((await page.getByTestId('profession-state').textContent())!);
    const requests: Record<string, unknown>[] = [];
    await page.route('**/api/profession/choose', async route => {
        requests.push(route.request().postDataJSON());
        if (requests.length === 1) return route.abort('failed');
        return route.fulfill({ json: { character: { ...original, profession: 'healer', professionRank: 1, professionXp: 0, masterySpec: {}, inventory: [] }, _saveVersion: 2 } });
    });
    await page.getByRole('button', { name: 'Use scroll · Choose profession', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose your new profession' });
    await dialog.getByRole('radio', { name: /Healer/ }).check();
    await dialog.getByRole('button', { name: 'Become Healer', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /Pet Tamer/ })).toBeDisabled();
    await page.reload();
    await page.getByRole('button', { name: 'Resume profession change', exact: true }).click();
    await expect(dialog.getByRole('radio', { name: /Healer/ })).toBeChecked();
    await dialog.getByRole('button', { name: 'Retry profession change', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    await expect(page.getByRole('region', { name: 'Profession Change Scroll' }).getByRole('status')).toContainText('Rank 1 with 0 XP');
});
