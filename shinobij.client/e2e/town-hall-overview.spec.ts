import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

// One screen serves every village, so each one proves the leader row shows
// tracked values and never the invented citizen and strength totals.
const villages = ['Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village'];

for (const village of villages) {
    test(`${village} overview shows tracked stats only`, async ({ page }) => {
        const save = uiAuditSave();
        save.character = { ...save.character, village };
        const runtime = await installUiAuditRuntime(page, save);
        const stored = { contributionPoints: 240_130 };
        await page.route('**/api/game-state', route => {
            if (route.request().method() !== 'GET') return route.fulfill({ json: { ok: true } });
            return route.fulfill({ json: { villageStates: { [village.toLowerCase().replace(/[^a-z]/g, '')]: stored }, arenaActiveFights: [] } });
        });
        await page.route(url => url.pathname === '/api/village/state', route => route.fulfill({ json: { ok: true, village, state: stored } }));
        await page.route('**/api/village-guard/list', route => route.fulfill({ json: [{ name: 'Ren', level: 40 }, { name: 'Kai', level: 52 }] }));
        await expectUiAuditBoot(page, runtime, 'townHall');
        const leader = page.locator('.town-leader-row');
        await expect(leader).toContainText('2 guards on duty · 240,130 contribution points');
        await expect(leader).not.toContainText(/citizens|strength/i);
    });

    test(`${village} vacant seat shows the empty seat art and no invented ranking`, async ({ page }, testInfo) => {
        const save = uiAuditSave();
        save.character = { ...save.character, village };
        const runtime = await installUiAuditRuntime(page, save);
        await page.route(url => url.pathname === '/api/village/kage', route => route.fulfill({ json: { kageSystemUnlocked: true, seatedKage: null, challenge: null } }));
        await expectUiAuditBoot(page, runtime, 'townHall');
        const leader = page.locator('.town-leader-row').first();
        await expect(leader).toContainText('Unclaimed');
        await expect(leader.locator('img')).toHaveAttribute('src', '/portraits/cinematic/storywide/kage-seat-vacant-v1.webp');
        await expect.poll(() => leader.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
        await leader.screenshot({ path: testInfo.outputPath('vacant-seat.png') });
        await page.getByRole('navigation', { name: 'Town Hall sections' }).getByRole('button', { name: 'Council', exact: true }).click();
        await expect(page.getByText('Account 7+ days old')).toBeVisible();
        await expect(page.getByText(/· Candidate/)).toHaveCount(0);
        await expect(page.getByText(/^\d+ points$/)).toHaveCount(0);
    });
}