import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

for (const scenario of [
    { treasury: 11_661, personal: 0, affordable: true },
    { treasury: 9_999, personal: 50_000, affordable: false },
]) {
    test(`Hollow Gate uses ${scenario.treasury} treasury seals with ${scenario.personal} personal seals`, async ({ page }) => {
        const save = uiAuditSave();
        save.character = { ...save.character, honorSeals: scenario.personal };
        const runtime = await installUiAuditRuntime(page, save);
        const village = save.character.village;
        const state = { treasury: { honorSeals: scenario.treasury }, hollowGateUnlockedUntil: 0 };
        await page.route('**/api/game-state', route => route.fulfill({ json: { villageStates: {}, arenaActiveFights: [] } }));
        await page.route(url => url.pathname === '/api/village/state', route => route.fulfill({ json: { ok: true, village, state } }));
        await page.route(url => url.pathname === '/api/village/kage', route => route.fulfill({ json: { kageSystemUnlocked: true, seatedKage: save.character.name, challenge: null } }));
        let purchases = 0;
        await page.route('**/api/village/hollow-gate-unlock', async route => {
            purchases++;
            expect(route.request().postDataJSON().requestId).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
            state.treasury.honorSeals -= 10_000;
            state.hollowGateUnlockedUntil = Date.now() + 30 * 86_400_000;
            await route.fulfill({ json: { ok: true, character: save.character, _saveVersion: 1,
                treasuryHonorSeals: state.treasury.honorSeals, hollowGateUnlockedUntil: state.hollowGateUnlockedUntil } });
        });
        await expectUiAuditBoot(page, runtime, 'townHall');
        await page.getByRole('navigation', { name: 'Town Hall sections' }).getByRole('button', { name: 'Upgrades', exact: true }).click();
        const card = page.locator('.hollow-gate-card');
        await expect(card).toContainText('village treasury');
        if (!scenario.affordable) {
            await expect(card.getByRole('button')).toBeDisabled();
            await expect(card.getByRole('button')).toContainText('Treasury needs 10,000');
            expect(purchases).toBe(0);
            return;
        }
        await expect(card.getByRole('button')).toBeEnabled();
        await card.getByRole('button').click();
        const dialog = page.getByRole('alertdialog');
        await expect(dialog).toContainText('10,000 Honor Seals from the village treasury');
        await dialog.getByRole('button', { name: 'Open Gate', exact: true }).click();
        await expect(card).toContainText('Open until');
        await expect(page.locator('.town-upgrade-overview')).toContainText('1,661 seals');
        await expect(card.getByRole('button')).toBeDisabled();
        expect(purchases).toBe(1);
    });
}
