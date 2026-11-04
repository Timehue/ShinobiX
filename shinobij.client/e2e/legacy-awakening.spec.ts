import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { visiblePageSize } from './helpers/visible-page-size';

for (const stage of [1, 2]) test(`Legacy stage ${stage} shows the correct signature access and trial guidance`, async ({ page }, testInfo) => {
    const save = uiAuditSave();
    const legacy = { legacyId: 'first-steps', stage, acceptedAt: 1, ...(stage === 2 ? { awakenedAt: 2 } : {}), titles: [] };
    save.character = { ...save.character, level: 50, legacy };
    const runtime = await installUiAuditRuntime(page, save);
    await page.route('**/api/legacy/**', async route => {
        const path = new URL(route.request().url()).pathname;
        const body = path.endsWith('/definitions') ? { minLevel: 50, legacies: [{ id: 'first-steps',
            name: 'Legacy of the First Steps', category: 'explorer', villageAffinity: null, title: 'Trailblazer',
            flavor: 'The trail marks help the next traveler find the way home.', badge: 'first-steps' }] }
            : path.endsWith('/stats') ? { level: 50, minLevelReached: true, legacy, legacyCategory: 'explorer', offer: null,
                strongest: [], eligibleCount: 0, trial: stage === 2 ? { id: 'legacy-browser-trial', legacyId: 'first-steps',
                    kind: 'bind', startedAt: 1, attempt: 1, objectives: [
                        { stat: 'gatheringClaims', delta: 30, progress: 12, done: false },
                        { stat: 'riftQuests', delta: 3, progress: 1, done: false },
                    ] } : null }
                : { spawn: false, reason: 'accepted' };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await expectUiAuditBoot(page, runtime, 'profile');
    const tabs = page.locator('.profile-mobile-tabs');
    if (await tabs.isVisible()) await tabs.getByRole('button', { name: 'Legacy', exact: true }).click();
    await expect(page.getByText('Trailblaze Dash', { exact: true })).toBeVisible();
    if (stage === 1) {
        await expect(page.getByText('Sealed until the Trial of Awakening', { exact: true })).toBeVisible();
        await expect(page.getByText(/reach Stage II \(Awakened\)/)).toBeVisible();
    } else {
        await expect(page.getByText(/mastery 20\/50/)).toBeVisible();
        await expect(page.getByText('Sealed until the Trial of Awakening', { exact: true })).toHaveCount(0);
        const guidance = page.getByText('Collect saved gathering finds or successfully finish Fishing and Mining attempts. Failed attempts do not count.', { exact: true });
        await expect(guidance).toBeVisible();
        await guidance.scrollIntoViewIfNeeded();
        const box = await guidance.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual((await visiblePageSize(page)).width + 1);
        await expect(page.getByText(/Finish the Rift run, exit it, then claim its quest/)).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('legacy-awakened-trial.png') });
    }
});
