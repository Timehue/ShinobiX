import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

for (const duplicate of [false, true]) {
    test(`War crate announces ${duplicate ? 'equipped duplicate shards' : 'the rare offense relic'} after its authoritative receipt`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        const id = 'relic-duelists-red-cord';
        const save = uiAuditSave();
        const character = { ...save.character, level: 100, relicRosterVersion: 1, inventory: ['legendary-war-crate'],
            equipment: duplicate ? { relic: id } : {}, itemStacks: [], tileCards: [], ryo: 1000, fateShards: 5, boneCharms: 0 };
        save.character = character;
        // The level-100 fixture has already seen the two late story interludes.
        // Otherwise the restored inventory is correctly covered by their VN.
        save.triggeredEvents = [...save.triggeredEvents as string[],
            'story-interlude-stormveil-village-88', 'story-interlude-stormveil-village-92'];
        const runtime = await installUiAuditRuntime(page, save);
        let opens = 0;
        await page.route('**/api/inventory/open-war-crate', async route => {
            opens++;
            expect(route.request().postDataJSON()).toEqual({ playerName: 'AuditNinja' });
            const next = { ...character, inventory: duplicate ? [] : [id], ryo: 1500, fateShards: duplicate ? 20 : 5, boneCharms: 1,
                itemStacks: [{ itemId: 'warforged-relic', count: 1 }] };
            const version = runtime.currentVersion() + 1;
            runtime.commitServerCharacter(next, version);
            await route.fulfill({ json: { ok: true, character: next, _saveVersion: version,
                rewards: { relic: true, ryo: 500, boneCharms: 1, honorSeals: 0, dungeonKey: false,
                    ...(duplicate ? { fateShards: 15 } : { equippableRelicId: id }) } } });
        });
        await expectUiAuditBoot(page, runtime, 'inventory');
        await page.getByRole('button', { name: 'Inspect Legendary War Crate', exact: true }).click();
        const details = page.getByRole('dialog', { name: 'Legendary War Crate item details', exact: true });
        await expect(details).toContainText('0.10%');
        await details.getByRole('button', { name: 'Open Crate', exact: true }).click();
        const notice = page.getByRole('alertdialog', { name: 'Notice', exact: true });
        await expect(notice).toContainText(duplicate ? '+15 Fate Shards (duplicate relic)' : "+1 Duelist's Red Cord");
        await expect(notice).toContainText('+1 Warforged Relic, +500 ryo');
        await expect(details).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Inspect Legendary War Crate', exact: true })).toHaveCount(0);
        await testInfo.attach('war-crate-reward', { body: await page.screenshot(), contentType: 'image/png' });
        expect(opens).toBe(1);
        expect(errors).toEqual([]);
    });
}
