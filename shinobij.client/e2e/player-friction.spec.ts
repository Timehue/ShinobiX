import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test('built Guild disables level 30 contracts for a level 16 player', async ({ page }, info) => {
    const save = uiAuditSave();
    Object.assign(save.character!, { level: 16, hunterRank: 3, dailyHuntsCompleted: 23, lastHuntReset: new Date().toISOString().slice(0, 10) });
    const runtime = await installUiAuditRuntime(page, save);
    await expectUiAuditBoot(page, runtime, 'hunting');
    await expect(page.getByRole('button', { name: 'Requires level 30' }).first()).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Accept Hunt' }).first()).toBeEnabled();
    await expect(page.getByText('23 / 23', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('guild-built.png') });
});

test('built map separates capped personal allowance from shared gathering pool', async ({ page }, info) => {
    const save = uiAuditSave();
    save.currentSector = 22;
    Object.assign(save.character!, { level: 17, dailyTilesExplored: 100, lastDailyReset: new Date().toISOString().slice(0, 10), serverExploresToday: 100, serverExploreDate: new Date().toISOString().slice(0, 10) });
    const runtime = await installUiAuditRuntime(page, save);
    await page.route('**/api/world-state*', route => route.fulfill({ json: { territories: [], wars: [], standings: [],
        sectorPools: { '22': { explores: 25, chests: 0 } }, sectorPoolCaps: { explores: 1500, chests: 225, ownerBonus: 0.5 } } }));
    await expectUiAuditBoot(page, runtime, 'worldMap');
    await page.getByRole('button', { name: /Return to Sector 22/ }).click();
    await expect(page.getByRole('button', { name: 'Explore', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Explore', exact: true })).toContainText('Daily 100/100');
    await expect(page.getByRole('button', { name: 'Explore', exact: true })).toHaveAccessibleDescription('Your daily exploration: 100/100 · Resets at midnight UTC');
    await expect(page.getByText(/Shared sector pool:/).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('daily-cap-built.png') });
});
