import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    test(`Academy Logbook handoff survives reload at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        const save = uiAuditSave();
        save.currentSector = 0;
        save.character = {
            ...save.character,
            level: 1,
            onboardingStep: 'logbook',
            academyTrialClaimed: true,
            academySectorVisited: false,
        };
        const runtime = await installUiAuditRuntime(page, save);
        let logbookCalls = 0;
        await page.route('**/api/player/academy-narrative', route => {
            const body = route.request().postDataJSON() as { action: string };
            if (body.action !== 'logbook') return route.fulfill({ status: 400, json: { error: 'Unexpected milestone.' } });
            logbookCalls++;
            const character = { ...save.character, onboardingStep: 'sectorReturn' };
            const version = runtime.currentVersion() + 1;
            runtime.commitServerCharacter(character, version);
            return route.fulfill({ json: { character, _saveVersion: version } });
        });
        await expectUiAuditBoot(page, runtime, 'missions');
        await page.getByRole('button', { name: 'Open Logbook' }).click();
        await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'logbook');
        await expect.poll(() => logbookCalls).toBe(1);
        await page.reload();
        await expect(page.getByRole('button', { name: 'Open World Map' })).toBeVisible();
        expect(logbookCalls).toBe(1);
    });

    test(`Supply Trail at Explore 3/3 guides the player to an enemy village at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        const missionId = 'fetch-d-supply-trail';
        const save = uiAuditSave();
        save.currentSector = 18;
        save.character = {
            ...save.character,
            level: 1,
            rankTitle: 'Academy Student',
            serverFieldMissionRuns: { [missionId]: {
                missionId,
                runId: 'e2efieldrun_supplytrail01',
                acceptedAt: Date.now() - 1_000,
            } },
        };
        save.acceptedMissionIds = [missionId];
        save.missionProgress = { [missionId]: 3, [`${missionId}:raids`]: 0 };
        const runtime = await installUiAuditRuntime(page, save);
        const travelRequests: Array<{
            method: string;
            body: Record<string, unknown>;
            headers: Record<string, string>;
        }> = [];
        await page.route('**/api/player/travel', async route => {
            const request = route.request();
            travelRequests.push({
                method: request.method(),
                body: request.postDataJSON() as Record<string, unknown>,
                headers: await request.allHeaders(),
            });
            await route.fulfill({ json: { arrivalAt: Date.now(), travelMs: 0, arrivalTile: 78 } });
        });
        await page.route('**/api/missions/field-trail', route => route.fulfill({ json: {
            ok: true,
            state: (save.character?.serverFieldMissionRuns as Record<string, unknown>)[missionId],
            character: save.character,
            acceptedMissionIds: save.acceptedMissionIds,
            missionProgress: save.missionProgress,
            _saveVersion: runtime.currentVersion(),
        } }));
        await expectUiAuditBoot(page, runtime, 'missions');
        await page.getByRole('tab', { name: 'Field' }).click();
        const card = page.locator('.mh-field-card.mh-field-accepted').filter({ hasText: 'D Rank Supply Trail Sweep' });
        await expect(card).toContainText('Explore 3/3');
        await expect(card).toContainText('Raid 0/1');
        await expect(card).toContainText('Next: Travel to one of the other three villages and raid its village guard from the outskirts.');
        await card.getByRole('button', { name: 'Go to an Enemy Village' }).click();
        await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'worldMap');
    });
}
