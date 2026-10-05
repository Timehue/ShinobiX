import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave, type UiAuditSave } from './helpers/ui-audit-runtime';
import { returnToWorldAtlas } from './helpers/sector-navigation';

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

    test(`Supply Trail at Explore 3/3 leads to a rival-village raid at ${viewport.width}px`, async ({ page }) => {
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
        const postedSave = () => JSON.parse(runtime.lastCommit()?.postedState ?? '{}') as UiAuditSave;
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
        const raidRequests: Array<Record<string, unknown>> = [];
        let battleLaunches = 0;
        await page.route('**/api/missions/ai-fight-start', async route => {
            const request = route.request();
            const headers = await request.allHeaders();
            const body = request.postDataJSON() as Record<string, unknown> | null;
            const recoveryProbe = body && Object.keys(body).length === 3
                && body.playerName === 'AuditNinja'
                && body.recoveryProbeVersion === 2
                && (body.resumeWorldFight === true || body.resumeAiFight === true);
            if (request.method() === 'POST' && recoveryProbe
                && headers['x-player-name'] === 'AuditNinja'
                && headers['x-player-token'] === 'ui-audit-token') {
                return route.fulfill({ status: 204 });
            }
            battleLaunches++;
            return route.fulfill({ status: 409, json: { error: 'A rejected raid must not start a fresh battle.' } });
        });
        await page.route('**/api/missions/raid-start', route => {
            raidRequests.push(route.request().postDataJSON() as Record<string, unknown>);
            return route.fulfill({ status: 409, json: {
                reason: 'location-mismatch',
                error: 'Return to Ashen Leaf Village outskirts (Sector 13) and try again.',
            } });
        });

        await expectUiAuditBoot(page, runtime, 'missions');
        await page.getByRole('tab', { name: 'Field' }).click();
        const card = page.locator('.mh-field-card.mh-field-accepted').filter({ hasText: 'D Rank Supply Trail Sweep' });
        await expect(card).toContainText('Explore 3/3');
        await expect(card).toContainText('Raid 0/1');
        await expect(card).toContainText('Next: Travel to one of the other three villages and raid its village guard from the outskirts.');
        await card.getByRole('button', { name: 'Go to an Enemy Village' }).click();
        await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'worldMap');
        await expect(page.locator('.sector-hud')).toBeVisible();
        await expect(page.locator('.sector-hud')).toContainText('Sector 18');
        await returnToWorldAtlas(page);
        const ashenRegion = page.locator('.wm-village-chip[data-region="ashen"]');
        if (await ashenRegion.isVisible()) {
            await ashenRegion.click();
            await expect(ashenRegion).toHaveAttribute('aria-pressed', 'true');
        }
        await page.getByRole('button', { name: 'Enter Ashen Leaf Village', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Ashen Leaf Village', exact: true })).toBeVisible();
        expect(travelRequests).toEqual([{
            method: 'POST',
            body: { destinationSector: 13 },
            headers: expect.objectContaining({
                'x-player-name': 'AuditNinja',
                'x-player-token': 'ui-audit-token',
            }),
        }]);
        await expect.poll(() => postedSave().currentSector).toBe(13);
        const arrivalCommit = runtime.lastCommit()!;
        await expect.poll(runtime.acknowledgedVersion).toBe(arrivalCommit.version);
        expect(arrivalCommit.baseVersion).toBe(arrivalCommit.version - 1);
        expect(runtime.currentVersion()).toBe(arrivalCommit.version);
        expect(runtime.persistedStateMatchesLastPost()).toBe(true);
        expect(postedSave().character?.village).toBe('Stormveil Village');
        expect(postedSave().character?.serverFieldMissionRuns).toEqual(save.character?.serverFieldMissionRuns);
        expect(postedSave().acceptedMissionIds).toEqual([missionId]);
        expect(postedSave().missionProgress).toEqual(save.missionProgress);
        await expect(page.locator('.territory-raid-guidance')).toContainText('Wins here count toward your field mission raid objectives.');
        const action = page.getByRole('button', { name: 'Raid Village Garrison', exact: true });
        await expect(action).toBeVisible();
        await expect(action).toBeEnabled();
        await action.click();
        await expect(page.getByRole('alertdialog', { name: 'Notice' })).toContainText('Return to Ashen Leaf Village outskirts (Sector 13) and try again.');
        expect(raidRequests).toHaveLength(1);
        expect(raidRequests[0]).toMatchObject({ playerName: 'AuditNinja', sector: 13, aiId: 'builtin-ai-mist-sentinel' });
        expect(raidRequests[0].requestId).toMatch(/^[A-Za-z0-9_-]{8,96}$/);
        expect(raidRequests[0]).not.toHaveProperty('missionId');
        expect(battleLaunches).toBe(0);
        await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'worldMap');
        expect(postedSave().currentSector).toBe(13);
        expect(postedSave().character?.serverFieldMissionRuns).toEqual(save.character?.serverFieldMissionRuns);
        expect(postedSave().acceptedMissionIds).toEqual([missionId]);
        expect(postedSave().missionProgress).toEqual(save.missionProgress);
        expect(postedSave().character?.ryo).toBe(save.character?.ryo);
        await expect(page.getByRole('complementary', { name: 'Device and server saves diverged' })).toHaveCount(0);
    });
}
