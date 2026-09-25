import { expect, test, type Page } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test('Mission Hall remains quiet for two minutes after equal-version adoption and parent renders', async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'This test opens both desktop and mobile pages itself.');
    test.setTimeout(165_000);
    const ids = ['fetch-d-supply-trail', 'fetch-c-border-scout'];
    const pages: Array<{ page: Page; counts: Map<string, number>; missionIds: string[] }> = [];
    try {
        // Keep one accepted contract per save. This fixture covers two mission
        // IDs across two mounted views without inventing an impossible combined
        // accepted-mission state in the player save.
        const selections: string[][] = [[ids[0]], [ids[1]]];
        for (const [index, missionIds] of selections.entries()) {
            const page = await context.newPage();
            await page.setViewportSize(index === 0 ? { width: 390, height: 844 } : { width: 1366, height: 768 });
            const save = uiAuditSave();
            save.currentSector = 18;
            save.acceptedMissionIds = missionIds;
            save.missionProgress = Object.fromEntries(missionIds.flatMap(id => [[id, 0], [`${id}:raids`, 0]]));
            save.character = {
                ...save.character,
                serverFieldMissionRuns: Object.fromEntries(missionIds.map(id => [id, {
                    missionId: id, runId: `e2efieldrun_${id}`, acceptedAt: Date.now() - 1_000,
                }])),
            };
            const runtime = await installUiAuditRuntime(page, save);
            const counts = new Map<string, number>();
            await page.route('**/api/missions/field-trail', async route => {
                const body = route.request().postDataJSON() as { action: string; missionId: string };
                if (body.action !== 'state') return route.fulfill({ status: 400, json: { error: 'Unexpected mutation in read-loop test.' } });
                counts.set(body.missionId, (counts.get(body.missionId) ?? 0) + 1);
                // A slow successful response forces the real Missions effect to
                // adopt a character after its parent has already rendered.
                await new Promise(resolve => setTimeout(resolve, 350));
                await route.fulfill({ json: {
                    ok: true,
                    state: (save.character?.serverFieldMissionRuns as Record<string, unknown>)[body.missionId],
                    character: save.character,
                    acceptedMissionIds: missionIds,
                    missionProgress: save.missionProgress,
                    _saveVersion: runtime.currentVersion(),
                } });
            });
            await expectUiAuditBoot(page, runtime, 'missions');
            await page.getByRole('tab', { name: 'Field' }).click();
            await expect(page.locator('.mh-field-card.mh-field-accepted')).toHaveCount(missionIds.length);
            pages.push({ page, counts, missionIds });
        }
        await expect.poll(() => pages.every(({ counts, missionIds }) => missionIds.every(id => (counts.get(id) ?? 0) >= 1))).toBe(true);
        for (const { page } of pages) {
            await page.setViewportSize({ width: 800, height: 800 });
            await page.setViewportSize({ width: 390, height: 844 });
        }
        await Promise.all(pages.map(({ page }) => page.waitForTimeout(120_000)));
        for (const { counts, missionIds } of pages) {
            for (const id of missionIds) {
                // Strict Mode can abort its first mount read and issue one
                // replacement. A self-sustaining feedback loop exceeds two.
                expect(counts.get(id) ?? 0).toBeLessThanOrEqual(2);
            }
        }
    } finally {
        await Promise.all(pages.map(({ page }) => page.close()));
    }
});
