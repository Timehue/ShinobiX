import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expectUiAuditBoot, installUiAuditRuntime } from './helpers/ui-audit-runtime';

for (const activation of ['keyboard', 'pointer'] as const) {
    test(`Village browsing preserves deferred routes and ${activation} entry remains usable`, async ({ page, isMobile }) => {
        const manifest = JSON.parse(readFileSync(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8'));
        const optionalPaths = ['Bank', 'TownHall', 'StoryBoss'].map(screen => `/${manifest[`src/screens/${screen}.tsx`].file}`);
        const requests = new Set<string>();
        const errors: string[] = [];
        page.on('request', request => requests.add(new URL(request.url()).pathname));
        page.on('pageerror', error => errors.push(error.message));
        const runtime = await installUiAuditRuntime(page);
        await expectUiAuditBoot(page, runtime, 'village');
        const cards = page.locator('.facility-tile');
        for (let index = 0; index < await cards.count(); index++) {
            const card = cards.nth(index);
            if (!isMobile) {
                // CI WebKit can stall in hover's geometry-stability wait. Keep
                // real pointer input and prove the tile actually receives it.
                await card.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
                await expect(card).toBeVisible();
                const box = await card.boundingBox();
                expect(box).not.toBeNull();
                await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
                await expect.poll(() => card.evaluate(element => element.matches(':hover'))).toBe(true);
            }
            await card.focus();
            await expect(card).toBeFocused();
        }
        // Leave time for an incorrectly started import's network request.
        await page.waitForTimeout(500);
        expect(optionalPaths.filter(path => requests.has(path))).toEqual([]);
        const bank = page.getByRole('button', { name: 'Enter Bank', exact: true });
        if (activation === 'keyboard') { await bank.focus(); await bank.press('Enter'); }
        else if (isMobile) await bank.tap();
        else await bank.click();
        await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'bank');
        const amount = page.locator('#bank-transfer-amount');
        await expect(amount).toBeEditable();
        await amount.fill('10');
        await expect(amount).toHaveValue('10');
        await expect(page.getByRole('button', { name: 'Deposit to vault', exact: true })).toBeEnabled();
        expect(requests.has(optionalPaths[0])).toBe(true);
        await page.getByRole('button', { name: '← Village', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Enter Bank', exact: true })).toBeVisible();
        expect(errors).toEqual([]);
    });
}
