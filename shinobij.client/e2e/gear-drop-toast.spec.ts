import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

// A gear step drop can arrive from any fight, chest or boss. The client announces
// it by noticing the new item in the bag, so a stubbed reply that adds one stands
// in for all of them. The war crate is only the carrier here.
test('a gear step drop pops up, and items already owned at login do not', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const save = uiAuditSave();
    const character = { ...save.character, level: 100, relicRosterVersion: 1, inventory: ['legendary-war-crate', 'rustfang-kunai-s2'],
        equipment: {}, itemStacks: [], tileCards: [], ryo: 1000, fateShards: 5, boneCharms: 0 };
    save.character = character;
    save.triggeredEvents = [...save.triggeredEvents as string[],
        'story-interlude-stormveil-village-88', 'story-interlude-stormveil-village-92'];
    const runtime = await installUiAuditRuntime(page, save);
    await page.route('**/api/inventory/open-war-crate', async route => {
        const next = { ...character, inventory: ['rustfang-kunai-s2', 'training-katana-s1'], ryo: 1500, boneCharms: 1,
            itemStacks: [{ itemId: 'warforged-relic', count: 1 }] };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(next, version);
        await route.fulfill({ json: { ok: true, character: next, _saveVersion: version,
            rewards: { relic: true, ryo: 500, boneCharms: 1, honorSeals: 0, dungeonKey: false, fateShards: 15 } } });
    });
    await expectUiAuditBoot(page, runtime, 'inventory');
    // The Rustfang Kunai step was already owned when the account loaded.
    await expect(page.locator('.gear-drop-toast')).toHaveCount(0);

    await page.getByRole('button', { name: 'Inspect Legendary War Crate', exact: true }).click();
    await page.getByRole('dialog', { name: 'Legendary War Crate item details', exact: true })
        .getByRole('button', { name: 'Open Crate', exact: true }).click();

    const toast = page.locator('.gear-drop-toast');
    await expect(toast).toHaveCount(1);
    await expect(toast).toContainText('Common gear received');
    await expect(toast).toContainText('Pale Moon Katana');
    // The card says what the piece improves on, so it reads as an upgrade and not a stranger.
    await expect(toast).toContainText('Damage 14.5 EP, up from 14 on the Training Katana');
    const box = await toast.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    // A modal dialog is open underneath. Probe what a tap on the card would really
    // hit, rather than reasoning about z-index: it must be the card, not the dialog.
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.gear-drop-toast') !== null, {
        x: box!.x + box!.width / 2, y: box!.y + box!.height / 2,
    });
    expect(hit).toBe(true);
    await testInfo.attach('gear-drop-toast', { body: await page.screenshot(), contentType: 'image/png' });

    // Tapping the card dismisses it.
    await toast.click();
    await expect(toast).toHaveCount(0);
    expect(errors).toEqual([]);
});

// Coming back after earning many drops elsewhere must not queue a card per drop.
test('a flood of drops folds into two cards and one summary', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const save = uiAuditSave();
    const character = { ...save.character, level: 100, relicRosterVersion: 1, inventory: ['legendary-war-crate'],
        equipment: {}, itemStacks: [], tileCards: [], ryo: 1000, fateShards: 5, boneCharms: 0 };
    save.character = character;
    save.triggeredEvents = [...save.triggeredEvents as string[],
        'story-interlude-stormveil-village-88', 'story-interlude-stormveil-village-92'];
    const runtime = await installUiAuditRuntime(page, save);
    const six = ['cloth-hood-s1', 'cloth-hood-s2', 'cloth-hood-s3', 'cloth-robe-s1', 'cloth-robe-s2', 'cloth-robe-s3'];
    await page.route('**/api/inventory/open-war-crate', async route => {
        const next = { ...character, inventory: six, ryo: 1500, boneCharms: 1, itemStacks: [{ itemId: 'warforged-relic', count: 1 }] };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(next, version);
        await route.fulfill({ json: { ok: true, character: next, _saveVersion: version,
            rewards: { relic: true, ryo: 500, boneCharms: 1, honorSeals: 0, dungeonKey: false, fateShards: 15 } } });
    });
    await expectUiAuditBoot(page, runtime, 'inventory');
    await page.getByRole('button', { name: 'Inspect Legendary War Crate', exact: true }).click();
    await page.getByRole('dialog', { name: 'Legendary War Crate item details', exact: true })
        .getByRole('button', { name: 'Open Crate', exact: true }).click();

    const toasts = page.locator('.gear-drop-toast');
    await expect(toasts).toHaveCount(3);
    await expect(toasts.nth(0)).toContainText('Violet Shade Hood');
    await expect(toasts.nth(1)).toContainText('Mistwrap Cowl');
    await expect(toasts.nth(2)).toContainText('4 more gear pieces');
    await expect(toasts.nth(2)).toContainText('They are in your bag.');
    expect(errors).toEqual([]);
});
