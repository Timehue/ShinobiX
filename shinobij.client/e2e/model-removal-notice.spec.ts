import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test('a player receives and acknowledges the model removal notice', async ({ page }, info) => {
    test.setTimeout(100_000);
    const runtime = await installUiAuditRuntime(page, uiAuditSave());
    const notice = { id: 'removed-model', kind: 'world-model-removed', by: 'moderation', sector: 0, at: Date.now() };
    let acknowledged = false;
    await page.route('**/api/player/heartbeat', route => {
        const request = route.request().postDataJSON();
        if (request.worldModelNotices === true && request.ackNotices?.includes(notice.id)) acknowledged = true;
        return route.fulfill({ json: { sectorMates: [], allPlayers: [], pendingChallenges: [],
            ...(request.worldModelNotices === true && !acknowledged ? { pendingNotices: [notice] } : {}) } });
    });
    await expectUiAuditBoot(page, runtime, 'townHall');
    const digest = page.getByRole('alertdialog', { name: 'While you were away' });
    await expect(digest.getByText('Your custom player model was removed by a moderator. Your character is back to the default.')).toBeVisible();
    const screenshot = info.outputPath('model-removal-notice.png');
    await digest.screenshot({ path: screenshot });
    await info.attach('model-removal-notice', { path: screenshot, contentType: 'image/png' });
    await expect.poll(() => acknowledged, { timeout: 35_000 }).toBe(true);
});
