import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== 'chromium' || !['chromium-desktop', 'chromium-mobile'].includes(testInfo.project.name), 'The equip journey covers desktop and mobile Chromium.');
});

// A gear step drop must be a normal, equippable piece: it shows its own exact
// numbers, equips into its slot, and survives the save the equip triggers.
test('a gear step armor piece shows its exact reduction and equips', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const save = uiAuditSave();
    save.currentSector = 0;
    save.character = { ...save.character, inventory: ['cloth-hood-s2', 'cloth-hood'], itemStacks: [], equipment: {}, tileCards: [] };
    const runtime = await installUiAuditRuntime(page, save);
    await expectUiAuditBoot(page, runtime, 'inventory');

    // The piece shows its own art (not the Cloth Hood's), and the file really loads.
    const art = page.getByRole('button', { name: 'Inspect Mistwrap Cowl', exact: true }).locator('img').first();
    await expect(art).toHaveAttribute('src', /step-cloth-hood-s2-v1\.webp/);
    await expect.poll(() => art.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

    await page.getByRole('button', { name: 'Inspect Mistwrap Cowl', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Mistwrap Cowl item details', exact: true });
    // Standard armor is 1 percent, and step 2 adds a full point.
    await expect(dialog).toContainText('Damage Reduction: 2%');
    await expect(dialog).toContainText('A prized find that outclasses the Cloth Hood: 2% damage reduction, up from 1%.');
    await expect(dialog).toContainText('Sell Value: 500 ryo');
    await dialog.getByRole('button', { name: /^Equip to Head/ }).click();

    await expect(page.getByRole('button', { name: 'Head equipment slot, equipped with Mistwrap Cowl', exact: true })).toBeVisible();
    // The plain Cloth Hood is still in the bag, untouched.
    await expect(page.getByRole('button', { name: 'Inspect Cloth Hood', exact: true })).toBeVisible();
    // The equip is saved: a reload reads the stored character back.
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Head equipment slot, equipped with Mistwrap Cowl', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
});
