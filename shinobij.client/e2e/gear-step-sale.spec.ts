import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== 'chromium' || !['chromium-desktop', 'chromium-mobile'].includes(testInfo.project.name), 'The sale journey covers desktop and mobile Chromium.');
});

// A gear step drop costs 0, so the usual half cost rule would give nothing and hide
// the Sell button. It sells for one flat 500 ryo instead, and the server pays the same.
test('a gear step drop can be sold for 500 ryo', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const save = uiAuditSave();
    save.currentSector = 0;
    save.character = { ...save.character, ryo: 100, inventory: ['training-katana-s2', 'rustfang-kunai'], itemStacks: [], equipment: {}, tileCards: [] };
    const runtime = await installUiAuditRuntime(page, save);
    const requests: Record<string, unknown>[] = [];
    await page.route('**/api/inventory/sell', async route => {
        requests.push(route.request().postDataJSON());
        const character = { ...save.character, inventory: ['rustfang-kunai'], ryo: 600 };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(character, version);
        await route.fulfill({ json: { ok: true, character, settlement: { kind: 'inventory-sale', itemId: 'training-katana-s2', quantity: 1, ryo: 500 }, _saveVersion: version } });
    });
    await expectUiAuditBoot(page, runtime, 'inventory');

    await page.getByRole('button', { name: 'Inspect Scarlet Reed Katana', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Scarlet Reed Katana item details', exact: true });
    // Step 2 of a common weapon: 14 EP plus two half points.
    await expect(dialog).toContainText('Damage: 15 EP');
    // It is its own named piece, and the description says which item it outclasses.
    await expect(dialog).toContainText('A prized find that outclasses the Training Katana.');
    await expect(dialog).toContainText('Damage 15 EP');
    await expect(dialog).toContainText('Sell Value: 500 ryo');
    const sell = dialog.getByRole('button', { name: 'Sell for 500 ryo', exact: true });
    await expect(sell).toBeEnabled();
    await sell.click();

    await expect(page.locator('.game-toast-stack')).toContainText('for 500 ryo');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ itemId: 'training-katana-s2', source: 'backpack', quantity: 1 });
    await expect(page.getByRole('button', { name: 'Inspect Scarlet Reed Katana', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
});
