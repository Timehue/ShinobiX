import { expect, test } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

for (const failure of ['world-ambush-ineligible', 'world-sector-mismatch', 'lost-response'] as const) {
    test(`rejected pending chain pauses, permits Return and manual Retry: ${failure}`, async ({ page }) => {
        // This covers two cold app loads plus three start attempts. Keep the
        // individual assertions strict while allowing browser startup time.
        test.setTimeout(90_000);
        await installUiAuditRuntime(page, { ...uiAuditSave(), currentSector: 60 });
        const pending = { request: { kind: 'wanderer-ambush', sourceId: 'wanderer-ambush', sector: 60,
            stage: 3, chainId: 'recovery_chain' }, displayName: 'Road Bandit', createdAt: 1 };
        let starts = 0;
        await page.route('**/api/missions/ai-fight-start', async route => {
            const body = route.request().postDataJSON();
            if (body.resumeWorldFight) return route.fulfill({ json: { resumed: true, pendingWorldChain: pending } });
            if (body.resumeAiFight) return route.fulfill({ status: 204 });
            starts++;
            if (failure === 'lost-response') return route.abort('failed');
            return route.fulfill({ status: 409, json: { error: failure } });
        });
        await page.goto('/#/worldMap', { waitUntil: 'domcontentloaded' });
        const failureHeading = page.getByRole('heading', { name: 'Fight unavailable', exact: true });
        await expect(failureHeading).toBeVisible();
        await expect(page.getByText(failure === 'world-sector-mismatch'
            ? /This encounter belongs to sector 60/
            : failure === 'world-ambush-ineligible'
                ? /This ambush is no longer available/
                : /The next fight could not be confirmed/)).toBeVisible();
        // Long enough to catch both the immediate recovery loop and its queued start.
        await page.waitForTimeout(1200);
        expect(starts).toBe(1);
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await expect.poll(() => starts).toBe(2);
        await expect(failureHeading).toBeVisible();
        await page.getByRole('button', { name: 'Return', exact: true }).click();
        await expect(page.locator('.app-shell[data-screen="worldMap"][data-sealed-fight-engaged="false"]')).toBeVisible();
        await expect(failureHeading).toHaveCount(0);
        await page.waitForTimeout(1200);
        expect(starts).toBe(2);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(failureHeading).toBeVisible();
        await page.waitForTimeout(1200);
        expect(starts).toBe(3);
    });
}
