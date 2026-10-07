import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== 'chromium' || !['chromium-desktop', 'chromium-mobile'].includes(testInfo.project.name), 'The sale journey covers desktop and mobile Chromium.');
});

// Named gear costs 0, so the usual half cost rule gave no Sell button at all. It sells
// for a flat 500 ryo, but it is one of a kind, so the first click only asks to confirm.
test('a named weapon asks for a second click, then sells to the shop for 500 ryo', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const namedId = 'named-weapon-123456781234123412341234567890ab';
    const save = uiAuditSave();
    save.currentSector = 0;
    save.creatorItems = [{ id: namedId, name: 'Ash of the First Sun', slot: 'hand', rarity: 'legendary', cost: 0, levelReq: 90, weaponEp: 20, apCost: 40, weaponRange: 4, weaponCooldown: 5, description: 'Forged beneath the red sun.', bonuses: { bukijutsuOffense: 40 } }];
    save.character = { ...save.character, ryo: 100, inventory: [namedId], itemStacks: [], equipment: {}, tileCards: [] };
    const runtime = await installUiAuditRuntime(page, save);
    const requests: Record<string, unknown>[] = [];
    await page.route('**/api/inventory/sell', async route => {
        requests.push(route.request().postDataJSON());
        const character = { ...save.character, inventory: [], ryo: 600 };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(character, version);
        await route.fulfill({ json: { ok: true, character, settlement: { kind: 'inventory-sale', itemId: namedId, quantity: 1, ryo: 500, source: 'backpack' }, _saveVersion: version } });
    });
    await expectUiAuditBoot(page, runtime, 'inventory');

    await page.getByRole('button', { name: 'Inspect Ash of the First Sun', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Ash of the First Sun item details', exact: true });
    await dialog.getByRole('button', { name: 'Sell for 500 ryo', exact: true }).click();
    expect(requests, 'the first click only arms the sale').toHaveLength(0);
    const confirm = dialog.getByRole('button', { name: 'Confirm: sell this named piece for 500 ryo', exact: true });
    await expect(confirm).toBeVisible();
    await confirm.click();

    await expect(page.locator('.game-toast-stack')).toContainText('for 500 ryo');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ itemId: namedId, source: 'backpack', quantity: 1 });
    await expect(page.getByRole('button', { name: 'Inspect Ash of the First Sun', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
});
