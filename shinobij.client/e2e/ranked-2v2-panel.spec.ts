import { expect, test, type Route } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

const json = (route: Route, body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });

test('Ranked 2v2 discovers an incoming invite, accepts it, and queues the duo', async ({ page }, testInfo) => {
    test.setTimeout(45_000);
    // Arena District is restorable from the player's last screen but is not
    // deep-linkable by URL hash alone.
    await page.addInitScript(() => localStorage.setItem('lastScreen.v1', 'arenaDistrict'));
    const save = uiAuditSave();
    save.character = { ...save.character, level: 40, ranked2v2Rating: 1000 };
    const runtime = await installUiAuditRuntime(page, save);
    let statusPolls = 0;
    let accepted = false;
    let queued = false;
    const duo = () => ({
        id: 'r2v2-11111111111111111111111111111111',
        status: accepted ? queued ? 'queued' : 'ready' : 'forming',
        expiresAt: Date.now() + 120_000,
        members: [
            { slug: 'rival', displayName: 'Rival', rating: 1000, accepted: true },
            { slug: 'auditninja', displayName: 'AuditNinja', rating: 1000, accepted },
        ],
    });
    await page.route('**/api/pvp/ranked-2v2', route => {
        const body = route.request().postDataJSON();
        if (body.action === 'status') statusPolls += 1;
        if (body.action === 'accept') accepted = true;
        if (body.action === 'queue') queued = true;
        return json(route, {
            duo: statusPolls >= 2 || accepted ? duo() : null,
            queue: queued ? { state: 'queued', position: 1, waiting: 1, rating: 1000 } : { state: 'idle' },
            match: null,
        });
    });

    await expectUiAuditBoot(page, runtime, 'arenaDistrict');
    const panel = page.getByTestId('ranked-2v2-panel');
    await expect(panel.getByText('Rival invited you to a ranked duo.')).toBeVisible({ timeout: 12_000 });
    await panel.getByRole('button', { name: 'Accept' }).click();
    await expect(panel.getByRole('button', { name: 'Find ranked match' })).toBeEnabled();
    await panel.getByRole('button', { name: 'Find ranked match' }).click();
    await expect(panel).toContainText('Searching for a pair near 1000 Elo');
    await page.screenshot({ path: testInfo.outputPath('ranked-2v2-duo-queue.png') });
});
