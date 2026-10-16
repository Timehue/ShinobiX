import { expect, test, type Page } from '@playwright/test';
import type { NamedRoll } from '../../api/craft/_named';

// The mocked server's spend per roll: a copy of shared/named-forge-materials.ts
// (Playwright's loader cannot follow that module's `.js` imports). The real
// recipe and debit are proven by api/craft/named-registry.integration.test.ts.
const ROLL_SPEND: Record<'weapon' | 'armor', Record<string, number>> = {
    weapon: { 'gather-iron-sand-pristine': 20, 'hunt-legendary-material': 2, 'hunt-titan-bone': 1, 'hunt-ancient-beast-core': 1, 'gather-rime-crystal-superior': 2, 'dungeon-legendary-relic': 1 },
    armor: { 'gather-iron-sand-pristine': 16, 'hunt-legendary-material': 2, 'hunt-shadow-pelt': 4, 'hunt-ancient-beast-core': 1, 'gather-rime-crystal-superior': 2, 'dungeon-legendary-relic': 1 },
};

/*
 * Owner ruling 2026-10-15: a named roll is paid (Fate Shards plus the
 * shared/named-forge-materials.ts recipe) and KEPT in one request. Name and
 * flavor text are chosen before rolling; there is no Forge step and no Discard.
 */

async function setup(page: Page, options: { shards?: number; fail?: boolean } = {}) {
    const requests: Record<string, unknown>[] = [];
    await page.route('**/api/**', async route => {
        if (new URL(route.request().url()).pathname === '/api/craft/named') {
            const body = route.request().postDataJSON();
            requests.push(body);
            if (options.fail) return route.fulfill({ status: 503, json: { error: 'The forge is unreachable.' } });
            // Hold long enough to inspect the rolling state, including keyboard dismissal.
            await new Promise(resolve => setTimeout(resolve, 450));
            const roll: NamedRoll = body.kind === 'weapon'
                ? { kind: 'weapon', ep: 26, range: 4, offenseVal: 178, tags: [{ name: 'Siphon', percent: 19 }, { name: 'Poison', percent: 12 }] }
                : { kind: 'armor', slot: body.slot, armorQuality: 'Mythic', offenseVal: 32, defenseVal: 29, special: { kind: 'Reflect', bonusKey: 'reflectPercent', value: 1.46 } };
            // Mock the server contract; the real payment/registry are tested by the API integration suite.
            const common = { id: `named-${roll.kind}-1234567890abcdef1234567890abcdef`, name: body.name,
                description: body.flavorText, flavorText: body.flavorText, levelReq: 90, cost: 0, rarity: 'legendary' };
            const item = roll.kind === 'weapon'
                ? { ...common, slot: 'hand', weaponEp: roll.ep, weaponRange: roll.range, weaponTags: roll.tags,
                    bonuses: { ninjutsuOffense: roll.offenseVal } }
                : { ...common, slot: roll.slot, name: roll.slot === 'hand' ? `${body.name} Gauntlets` : body.name,
                    ...(roll.slot === 'hand' ? {} : { armorQuality: roll.armorQuality }),
                    bonuses: { ninjutsuOffense: roll.offenseVal, ninjutsuDefense: roll.defenseVal, [roll.special.bonusKey]: roll.special.value } };
            const spend = ROLL_SPEND[roll.kind];
            const state = JSON.parse((await page.getByTestId('forge-state').textContent())!);
            const character = { ...state.character, fateShards: state.character.fateShards - 200, inventory: [...state.character.inventory, item.id],
                itemStacks: state.character.itemStacks.map((stack: { itemId: string; count: number }) => ({ ...stack, count: stack.count - (spend[stack.itemId] ?? 0) })) };
            return route.fulfill({ json: { ok: true, item, roll, character, _saveVersion: state.saveVersion + 1 } });
        }
        return route.fulfill({ json: { ok: true, bloodlines: [], images: {}, wars: [] } });
    });
    await page.goto(`/e2e/fixtures/named-forge.html?shards=${options.shards ?? 200}`);
    await expect(page.getByRole('dialog', { name: 'Crafter', exact: true })).toBeVisible();
    return requests;
}

test('Fate Shards gate both named roll kinds even when every material is held', async ({ page }) => {
    const requests = await setup(page, { shards: 199 });
    for (const kind of ['Weapons', 'Armor']) {
        await page.locator('.cf-tabs').getByRole('button', { name: kind, exact: true }).click();
        const wallet = page.locator('.nw-wallet');
        await expect(wallet).toContainText('Fate Shards');
        await expect(wallet).toContainText('200 Fate Shards');
        await expect(wallet).not.toContainText(/Bone Charms|Aura Stones|Mythic Seals|forge pts/);
        await expect(page.getByRole('button', { name: /^Roll named/ })).toBeDisabled();
    }
    expect(requests).toEqual([]);
});

test('each roll lists its full price, apex materials included', async ({ page }) => {
    await setup(page);
    await page.locator('.cf-tabs').getByRole('button', { name: 'Weapons', exact: true }).click();
    const cost = page.locator('.nw-cost');
    for (const label of ['Fate Shards', 'Pristine Iron Sand', 'Legendary Material', 'Titan Bone', 'Ancient Beast Core', 'relic']) await expect(cost).toContainText(label);
    await expect(cost).toContainText('Sunscar Exchange');
    await page.locator('.cf-tabs').getByRole('button', { name: 'Armor', exact: true }).click();
    await expect(page.locator('.nw-cost')).toContainText('Shadow Pelt');
});

test('weapon pop-out shows the kept roll, stays open, and restores the Crafter', async ({ page }, testInfo) => {
    // Shards for a second roll, so the Roll button stays enabled and can take focus back.
    await setup(page, { shards: 400 });
    await page.locator('.cf-tabs').getByRole('button', { name: 'Weapons', exact: true }).click();
    const odds = page.locator('.nw-odds');
    // Seven half-point EP values (24, 24.5 … 27), one in seven each.
    await expect(odds).toContainText('24.5');
    await expect(odds).toContainText('14.3%');
    await expect(odds).toContainText('12.5% to appear per roll');
    const opener = page.getByRole('button', { name: 'Roll named weapon', exact: true });
    await opener.click();
    const reveal = page.getByRole('dialog', { name: 'Named Weapon Roll', exact: true });
    await expect(reveal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(reveal).toBeVisible();
    await expect(reveal).toContainText('Named Weapon Awakened');
    await expect(reveal).toContainText('26');
    await expect(reveal).toContainText('+178');
    await expect(reveal).toContainText('Siphon · 19%');
    await expect(reveal).toContainText('Poison · 12%');
    await expect.poll(() => page.locator('.ui-modal-backdrop').first().evaluate(el => (el as HTMLElement).inert)).toBe(true);
    await page.waitForTimeout(3400);
    await expect(reveal).toBeVisible();
    const box = await reveal.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.height).toBeLessThanOrEqual(viewport.height);
    await expect.poll(() => reveal.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('weapon-reveal.png') });
    await reveal.getByRole('button', { name: 'Continue to Forge' }).click();
    await expect(reveal).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page.locator('.nw-result')).toContainText('26');
    await expect(page.locator('.nw-result')).toContainText('kept in your inventory');
    await expect(page.getByRole('button', { name: /Forge weapon|Discard roll/ })).toHaveCount(0);
});

test('armor reveals the selected slot and omits damage reduction for gloves', async ({ page }, testInfo) => {
    // Two paid rolls (chest, then gloves).
    const requests = await setup(page, { shards: 400 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.cf-tabs').getByRole('button', { name: 'Armor', exact: true }).click();
    for (const [slot, label] of [['body', 'Chest'], ['hand', 'Gloves']]) {
        await page.locator('select.nw-input').selectOption(slot);
        await page.getByRole('button', { name: 'Roll named armor', exact: true }).click();
        const reveal = page.getByRole('dialog', { name: 'Named Armor Roll', exact: true });
        await expect(reveal).toContainText('Named Armor Awakened');
        await expect(reveal).toContainText(label);
        await expect(reveal).toContainText('+32');
        await expect(reveal).toContainText('+29');
        await expect(reveal).toContainText('Reflect 1.46%');
        if (slot === 'hand') await expect(reveal).not.toContainText('Damage reduction');
        else await expect(reveal).toContainText('8% · Mythic');
        await page.screenshot({ path: testInfo.outputPath(`armor-${slot}-reveal.png`) });
        await reveal.getByRole('button', { name: 'Continue to Forge' }).click();
    }
    expect(requests.map(request => request.slot)).toEqual(['body', 'hand']);
});

test('failed rolls close the pop-out and permit a retry', async ({ page }) => {
    page.on('dialog', dialog => dialog.accept());
    await setup(page, { fail: true });
    await page.locator('.cf-tabs').getByRole('button', { name: 'Weapons', exact: true }).click();
    await page.getByRole('button', { name: 'Roll named weapon', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Named Weapon Roll', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Roll named weapon', exact: true })).toBeEnabled();
});

for (const [kind, tab, slot] of [['Weapon', 'Weapons', 'hand'], ['Armor', 'Armor', 'body'], ['Armor', 'Armor', 'hand']] as const) {
    test(`${kind} ${slot}: name first, one paid roll, and accept the versioned inventory`, async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());
        const requests = await setup(page);
        await page.locator('.cf-tabs').getByRole('button', { name: tab, exact: true }).click();
        if (kind === 'Armor') await page.locator('select.nw-input').selectOption(slot);
        await page.getByPlaceholder(kind === 'Weapon' ? 'e.g. Void Fang' : 'e.g. Stormveil Plate').fill('Integration Relic');
        await page.locator('.nw-forge textarea').fill('Sealed by the forge.');
        await page.getByRole('button', { name: `Roll named ${kind.toLowerCase()}`, exact: true }).click();
        const reveal = page.getByRole('dialog', { name: `Named ${kind} Roll`, exact: true });
        await reveal.getByRole('button', { name: 'Continue to Forge' }).click();
        await expect.poll(async () => JSON.parse((await page.getByTestId('forge-state').textContent())!).character.fateShards).toBe(0);
        const { character, creatorItems, saveVersion } = JSON.parse((await page.getByTestId('forge-state').textContent())!);
        expect(saveVersion).toBe(2);
        expect(creatorItems).toHaveLength(1);
        const [item] = creatorItems;
        expect(character.inventory).toEqual([item.id]);
        expect(character.itemStacks).toContainEqual({ itemId: 'gather-iron-sand-pristine', count: kind === 'Weapon' ? 80 : 84 });
        expect(character.itemStacks).toContainEqual({ itemId: 'hunt-legendary-material', count: 8 });
        expect(character.itemStacks).toContainEqual({ itemId: 'dungeon-legendary-relic', count: 4 });
        expect([character.boneCharms, character.auraStones, character.mythicSeals]).toEqual([5000, 5000, 5000]);
        expect(item.name).toBe(slot === 'hand' && kind === 'Armor' ? 'Integration Relic Gauntlets' : 'Integration Relic');
        expect(item.slot).toBe(slot);
        if (kind === 'Weapon') {
            expect(item.weaponEp).toBe(26);
            expect(item.weaponTags).toEqual([{ name: 'Siphon', percent: 19 }, { name: 'Poison', percent: 12 }]);
        } else {
            expect(item.bonuses.reflectPercent).toBe(1.46);
            if (slot === 'hand') expect(item.armorQuality).toBeUndefined();
            else expect(item.armorQuality).toBe('Mythic');
        }
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ action: 'roll', name: 'Integration Relic', flavorText: 'Sealed by the forge.' });
        expect(String(requests[0].requestId)).toMatch(/^[a-f0-9]{32}$/);
        expect(requests[0]).not.toHaveProperty('roll');
        await expect(page.locator('.nw-result')).toContainText('kept in your inventory');
        await expect(page.getByRole('button', { name: `Roll named ${kind.toLowerCase()}`, exact: true })).toBeDisabled();
    });
}
