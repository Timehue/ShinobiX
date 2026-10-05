import { expect, test, type Page } from '@playwright/test';
import type { NamedRoll } from '../../api/craft/_named';

async function setup(page: Page, options: { shards?: number; fail?: boolean } = {}) {
    const requests: Record<string, unknown>[] = [];
    const rolls = new Map<string, NamedRoll>();
    await page.route('**/api/**', async route => {
        if (new URL(route.request().url()).pathname === '/api/craft/named') {
            const body = route.request().postDataJSON();
            requests.push(body);
            if (options.fail) return route.fulfill({ status: 503, json: { error: 'The forge is unreachable.' } });
            if (body.action === 'forge') {
                const roll = rolls.get(body.token);
                if (!roll) return route.fulfill({ status: 409, json: { error: 'invalid-or-spent-roll' } });
                // Mock the server contract; the real builder/payment/registry are tested by the API integration suite.
                const common = { id: `named-${roll.kind}-1234567890abcdef1234567890abcdef`, name: body.name,
                    description: body.flavorText, flavorText: body.flavorText, levelReq: 90, cost: 0, rarity: 'legendary' };
                const item = roll.kind === 'weapon'
                    ? { ...common, slot: 'hand', weaponEp: roll.ep, weaponRange: roll.range, weaponTags: roll.tags,
                        bonuses: { ninjutsuOffense: roll.offenseVal } }
                    : { ...common, slot: roll.slot, name: roll.slot === 'hand' ? `${body.name} Gauntlets` : body.name,
                        ...(roll.slot === 'hand' ? {} : { armorQuality: roll.armorQuality }),
                        bonuses: { ninjutsuOffense: roll.offenseVal, ninjutsuDefense: roll.defenseVal, [roll.special.bonusKey]: roll.special.value } };
                const state = JSON.parse((await page.getByTestId('forge-state').textContent())!);
                const character = { ...state.character, fateShards: state.character.fateShards - 200, inventory: [...state.character.inventory, item.id] };
                return route.fulfill({ json: { ok: true, item, character, _saveVersion: state.saveVersion + 1 } });
            }
            // Hold long enough to inspect the rolling state, including keyboard dismissal.
            await new Promise(resolve => setTimeout(resolve, 450));
            const roll: NamedRoll = body.kind === 'weapon'
                ? { kind: 'weapon', ep: 26, range: 4, offenseVal: 178, tags: [{ name: 'Siphon', percent: 19 }, { name: 'Poison', percent: 12 }] }
                : { kind: 'armor', slot: body.slot, armorQuality: 'Mythic', offenseVal: 32, defenseVal: 29, special: { kind: 'Reflect', bonusKey: 'reflectPercent', value: 1.46 } };
            const token = `namedForgeTestToken123456${rolls.size}`;
            rolls.set(token, roll);
            return route.fulfill({ json: { ok: true, token, roll } });
        }
        return route.fulfill({ json: { ok: true, bloodlines: [], images: {}, wars: [] } });
    });
    await page.goto(`/e2e/fixtures/named-forge.html?shards=${options.shards ?? 200}`);
    await expect(page.getByRole('dialog', { name: 'Crafter', exact: true })).toBeVisible();
    return requests;
}

test('Fate Shards alone determine eligibility for both named forge kinds', async ({ page }) => {
    const requests = await setup(page, { shards: 199 });
    for (const kind of ['Weapons', 'Armor']) {
        await page.locator('.cf-tabs').getByRole('button', { name: kind, exact: true }).click();
        const wallet = page.locator('.nw-wallet');
        await expect(wallet).toContainText('Fate Shards');
        await expect(wallet).toContainText('200 Fate Shards');
        await expect(wallet).not.toContainText(/Bone Charms|Aura Stones|Mythic Seals|forge pts/);
        await expect(page.getByRole('button', { name: /^Roll Named/ })).toBeDisabled();
    }
    expect(requests).toEqual([]);
});

test('weapon pop-out shows the sealed roll, stays open, and restores the Crafter', async ({ page }, testInfo) => {
    await setup(page);
    await page.locator('.cf-tabs').getByRole('button', { name: 'Weapons', exact: true }).click();
    const odds = page.locator('.nw-odds');
    await expect(odds).toContainText('25%');
    await expect(odds).toContainText('12.5% to appear per roll');
    const opener = page.getByRole('button', { name: 'Roll Named Weapon', exact: true });
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
    await expect(page.getByRole('button', { name: 'Forge Weapon', exact: true })).toBeVisible();
});

test('armor reveals the selected slot and omits damage reduction for gloves', async ({ page }, testInfo) => {
    const requests = await setup(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.cf-tabs').getByRole('button', { name: 'Armor', exact: true }).click();
    for (const [slot, label] of [['body', 'Chest'], ['hand', 'Gloves']]) {
        await page.locator('select.nw-input').selectOption(slot);
        await page.getByRole('button', { name: 'Roll Named Armor', exact: true }).click();
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
    await page.getByRole('button', { name: 'Roll Named Weapon', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Named Weapon Roll', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Roll Named Weapon', exact: true })).toBeEnabled();
});

for (const [kind, tab, slot] of [['Weapon', 'Weapons', 'hand'], ['Armor', 'Armor', 'body'], ['Armor', 'Armor', 'hand']] as const) {
    test(`${kind} ${slot}: reveal, name, forge, and accept the versioned inventory`, async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());
        const requests = await setup(page);
        await page.locator('.cf-tabs').getByRole('button', { name: tab, exact: true }).click();
        if (kind === 'Armor') await page.locator('select.nw-input').selectOption(slot);
        await page.getByRole('button', { name: `Roll Named ${kind}`, exact: true }).click();
        const reveal = page.getByRole('dialog', { name: `Named ${kind} Roll`, exact: true });
        await reveal.getByRole('button', { name: 'Continue to Forge' }).click();
        await page.locator('.nw-result input[type="text"], .nw-result input:not([type])').fill('Integration Relic');
        await page.locator('.nw-result textarea').fill('Sealed by the forge.');
        await page.getByRole('button', { name: `Forge ${kind}`, exact: true }).click();
        await expect.poll(async () => JSON.parse((await page.getByTestId('forge-state').textContent())!).character.fateShards).toBe(0);
        const { character, creatorItems, saveVersion } = JSON.parse((await page.getByTestId('forge-state').textContent())!);
        expect(saveVersion).toBe(2);
        expect(creatorItems).toHaveLength(1);
        const [item] = creatorItems;
        expect(character.inventory).toEqual([item.id]);
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
        expect(requests.map(request => request.action)).toEqual(['roll', 'forge']);
        expect(requests[1]).toMatchObject({ token: 'namedForgeTestToken1234560', name: 'Integration Relic', flavorText: 'Sealed by the forge.' });
        expect(requests[1]).not.toHaveProperty('roll');
        await expect(page.locator('.nw-result')).toBeHidden();
        await expect(page.getByRole('button', { name: `Roll Named ${kind}`, exact: true })).toBeDisabled();
    });
}
