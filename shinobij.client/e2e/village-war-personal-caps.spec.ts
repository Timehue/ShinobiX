import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

for (const name of ['constructor', '__proto__']) test(`Town Hall personal limits remain usable for account ${name}`, async ({ page }) => {
    const save = uiAuditSave(); save.character = { ...save.character, name };
    const runtime = await installUiAuditRuntime(page, save, false, name);
    const village = String(save.character.village), enemy = 'Moonshadow Village';
    const startsAt = Date.now() - 3_600_000, endsAt = startsAt + 5 * 86_400_000;
    const campaign = { version: 2, startsAt, endsAt, shrine: [], strongholds: [], scores: {}, intel: 0, hiddenStrongholds: 3,
        operationAllowance: { total: 200, categories: { supply: 50 }, players: {} }, operationResetAt: startsAt + 86_400_000 };
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/world-state', route => route.fulfill({ json: { territories: [], standings: [], wars: [{
        id: 'moonshadowvillage-vs-stormveilvillage', villages: [village, enemy], startedAt: startsAt, updatedAt: startsAt,
        campaignVersion: 2, campaignEndsAt: endsAt, warGroundSector: 47,
        hp: { [village]: 5000, [enemy]: 5000 }, warPoints: { [village]: 0, [enemy]: 0 } }] } }));
    await page.route('**/api/village/war-campaign', route => route.fulfill({ json: { campaign, mission: null, run: null, defense: null } }));
    await expectUiAuditBoot(page, runtime, 'townHall');
    await page.getByRole('navigation', { name: 'Town Hall sections' }).getByRole('button', { name: 'War', exact: true }).click();
    const orders = page.getByRole('region', { name: 'Field missions and intelligence' });
    await expect(orders.getByText(/Your attempts today: 0\/4/)).toBeVisible();
    await expect(orders.getByText('You 0/1 attempts', { exact: true })).toBeVisible();
    for (const kind of ['Supply', 'Sabotage', 'Espionage']) await expect(orders.getByRole('button', { name: `Accept ${kind}`, exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
});
