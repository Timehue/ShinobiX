import { expect, test } from '@playwright/test';
import type { CardPackOpen, CardPackType } from '../../api/card-clash/_pack';
import { packArtUrl, packTheme } from '../src/lib/card-pack-reveal';

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

for (const [packType, rarity, label, cost] of [
    ['epic-five', 'epic', 'Epic Quintet Pack', 35],
    ['legendary-five', 'legendary', 'Legendary Quintet Pack', 100],
] as const) {
    test(`${label}: custom foil tears open and reveals all five cards`, async ({ page }, testInfo) => {
        const requests: Array<{ packType: string; requestId: string }> = [];
        let cards: string[] = [];
        await page.route('**/api/card-clash/open-pack', async (route) => {
            const body = route.request().postDataJSON();
            requests.push(body);
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
                ok: true, cards, currency: 'fateShards', cost, balance: 200 - cost * requests.length, _saveVersion: requests.length + 1,
                character: { name: 'PackGalleryQA', level: 20, starterCardsClaimed: true,
                    chroniclePoints: 200, fateShards: 200 - cost * requests.length, tileCards: Array(requests.length).fill(cards).flat() },
            }) });
        });
        await page.goto('/e2e/fixtures/chronicle-packs.html');
        cards = await page.evaluate((tier) => (window as Window & {
            __qaPremiumIds: Record<string, string[]>;
        }).__qaPremiumIds[tier], rarity);
        expect(cards).toHaveLength(5);
        // A five-card pack can legitimately contain five copies of one card.
        cards = Array(5).fill(cards[0]);
        const listing = page.locator(`.chronicle-pack--${packType}`);
        await listing.scrollIntoViewIfNeeded();
        await expect.poll(() => listing.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
        await listing.screenshot({ path: testInfo.outputPath(`${packType}-gallery.png`) });
        await listing.getByRole('button', { name: `Open ${label} ${cost} Fate Shards` }).click();
        await expect(page.getByTestId('adopted-version')).toHaveText('2');
        const opening = page.getByRole('dialog', { name: `${label} opening` });
        await expect(opening).toHaveCSS('--pack-art', `url("/chronicle/packs/${packType}.webp")`);
        await expect(opening.locator('.pack-foil__ribbon')).toHaveText(`${label} · 5 cards`);
        await opening.screenshot({ path: testInfo.outputPath(`${packType}-foil.png`), animations: 'disabled' });
        await opening.getByRole('button', { name: /Tear Open/ }).click();
        for (let i = 0; i < 5; i++) {
            await opening.getByRole('button', { name: 'Flip the top card', exact: true }).click();
            const revealed = opening.getByRole('button', { name: /revealed — continue/ });
            await expect(revealed).toHaveCount(1);
            // Let the existing flip lockout finish before advancing.
            await expect(opening.locator('.pack-card.is-flipped')).toHaveCSS('transform', 'none');
            await revealed.click();
        }
        await expect(opening.locator('.pack-summary__card')).toHaveCount(5);
        expect(await opening.locator('.pack-summary__card .pack-card__new').count()).toBeLessThanOrEqual(1);
        await opening.screenshot({ path: testInfo.outputPath(`${packType}-summary.png`), animations: 'disabled' });
        await opening.getByRole('button', { name: `Open another · ${cost} Fate Shards` }).click();
        await expect(page.getByTestId('adopted-version')).toHaveText('3');
        await expect(opening.getByRole('button', { name: /Tear Open/ })).toBeVisible();
        await opening.getByRole('button', { name: /Skip/ }).click();
        await expect(opening.locator('.pack-summary__card')).toHaveCount(5);
        await expect(opening.locator('.pack-summary__card .pack-card__new')).toHaveCount(0);
        await opening.getByRole('button', { name: /Done/ }).click();
        await expect(page.getByLabel('Pack balances')).toContainText(`${200 - cost * 2} Fate Shards`);
        await expect(page.getByLabel('Pack balances')).toContainText('10 owned cards');
        expect(requests).toHaveLength(2);
        expect(requests[0].packType).toBe(packType);
        expect(requests[1].packType).toBe(packType);
        expect(requests[1].requestId).not.toBe(requests[0].requestId);
        expect(requests[0].requestId).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
    });
}

test('every pack connects its listing to the server draw, foil, duplicate summary, and saved collection', async ({ page }) => {
    let character = { name: 'PackGalleryQA', level: 20, starterCardsClaimed: true,
        chroniclePoints: 200, fateShards: 200, tileCards: [] as string[] };
    let version = 1;
    const requests: string[] = [];
    await page.route('**/api/card-clash/open-pack', async (route) => {
        const { packType } = route.request().postDataJSON();
        requests.push(packType);
        const opened = await page.evaluate(({ character, packType }) => (window as Window & {
            __qaOpenPack: (character: Record<string, unknown>, type: string) => CardPackOpen;
        }).__qaOpenPack(character, packType), { character, packType });
        if (!opened.ok) throw new Error(opened.error);
        character = { ...character, ...opened.character };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            ...opened, character, _saveVersion: ++version,
        }) });
    });
    await page.goto('/e2e/fixtures/chronicle-packs.html');
    const packTypes = await page.evaluate(() => (window as Window & { __qaPackTypes: CardPackType[] }).__qaPackTypes);
    // Fund the deterministic server fixture and match it to the displayed wallet.
    // Each Basic purchase is followed by a refill in the next server response.
    for (const type of packTypes) {
        const listing = page.locator(`.chronicle-pack--${type}`);
        const label = packTheme(type).label;
        await listing.scrollIntoViewIfNeeded();
        await expect.poll(() => listing.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
        // The initial display has two Basic purchases; replenish on each settled response.
        character.chroniclePoints = 200;
        character.fateShards = 200;
        await listing.getByRole('button', { name: new RegExp(`^Open ${label}`) }).click();
        const opening = page.getByRole('dialog', { name: `${label} opening` });
        await expect(page.getByTestId('adopted-version')).toHaveText(String(version));
        await expect(opening).toHaveCSS('--pack-art', `url("${packArtUrl(type)}")`);
        const count = type === 'epic' || type === 'legendary' ? 1 : 5;
        await expect(opening.locator('.pack-foil__ribbon')).toHaveText(`${label} · ${count} ${count === 1 ? 'card' : 'cards'}`);
        await opening.getByRole('button', { name: /Tear Open/ }).click();
        await expect(opening.getByRole('button', { name: 'Flip the top card', exact: true })).toBeVisible();
        await opening.getByRole('button', { name: /Skip/ }).click();
        await expect(opening.locator('.pack-summary__card')).toHaveCount(count);
        await expect(opening.locator('.pack-card__missing')).toHaveCount(0);
        await opening.getByRole('button', { name: /Done/ }).click();
        await expect(page.getByLabel('Pack balances')).toContainText(`${character.tileCards.length} owned cards`);
    }
    expect(packTypes).toHaveLength(12);
    expect(requests).toEqual(packTypes);
});
