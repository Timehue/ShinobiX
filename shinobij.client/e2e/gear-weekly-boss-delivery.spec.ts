import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== 'chromium' || !['chromium-desktop', 'chromium-mobile'].includes(testInfo.project.name), 'The delivery journey covers desktop and mobile Chromium.');
});

// The Weekly Boss pays its winners inside their saves on the server, with no reply
// to carry it. A winner who stays signed in must still see the payout: the app reads
// the public boss state, notices it was credited, adopts its own save, and the gear
// piece announces itself.
test('a weekly boss winner receives the payout live, with a pop-up for the gear piece', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const save = uiAuditSave();
    save.currentSector = 0;
    save.character = { ...save.character, inventory: ['rustfang-kunai'], itemStacks: [], equipment: {}, tileCards: [] };
    const runtime = await installUiAuditRuntime(page, save);
    const credited = { ...save.character, inventory: ['rustfang-kunai', 'weekly-boss-core', 'cloth-hood-s2'] };
    let reads = 0;
    await page.route('**/api/weekly-boss', async route => {
        if (route.request().method() !== 'GET') { await route.fallback(); return; }
        reads += 1;
        // The server has credited the winner by the time the public state says so.
        runtime.commitServerCharacter(credited, runtime.currentVersion() + 1);
        await route.fulfill({ json: {
            boss: { weekKey: '2026-W41', spawnId: 'spawn-audit', rewardsDistributed: true, creditedPlayers: ['AuditNinja'], distributedAt: Date.now() },
            fightEnabled: true, fightDisabledReason: null,
        } });
    });
    await expectUiAuditBoot(page, runtime, 'inventory');

    const toast = page.locator('.gear-drop-toast');
    await expect(toast).toHaveCount(1);
    await expect(toast).toContainText('Mistwrap Cowl');
    await expect(page.locator('.game-toast-stack')).toContainText('Your Weekly Boss rewards have arrived. Check your bag.');
    // The bag really holds them now, with no refresh.
    await expect(page.getByRole('button', { name: 'Inspect Weekly Boss Core', exact: false })).toBeVisible();
    expect(reads).toBeGreaterThanOrEqual(1);
    expect(errors).toEqual([]);
});
