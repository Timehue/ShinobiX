import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test('a restored phone zoom recovers its menu scale and keeps controls clickable', async ({ page, context }, info) => {
    test.skip(!['chromium-mobile', 'chromium-compact'].includes(info.project.name), 'Chromium phone history zoom regression');
    const runtime = await installUiAuditRuntime(page, uiAuditSave());
    await expectUiAuditBoot(page, runtime, 'settings');
    const session = await context.newCDPSession(page);
    await page.reload({ waitUntil: 'load' });
    // Reproduce Chrome restoring a previously saved 1.0 zoom after load.
    await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await expect.poll(() => page.evaluate(() => Math.abs((visualViewport?.scale ?? 1) - 0.85))).toBeLessThan(0.02);
    await expect(page.locator('meta[name="viewport"]')).not.toHaveAttribute('content', /maximum-scale/);
    const control = page.locator('.settings-page button:enabled').first();
    await expect(control).toBeVisible();
    await control.click({ trial: true });
    const mute = page.getByRole('checkbox', { name: 'Mute all audio', exact: true });
    const wasMuted = await mute.isChecked();
    await mute.tap();
    await expect(mute).toBeChecked({ checked: !wasMuted });
    await expect.poll(() => page.evaluate(() => localStorage.getItem('audioMuted'))).toBe(wasMuted ? '0' : '1');
    await info.attach('recovered-phone-zoom', { body: await page.screenshot(), contentType: 'image/png' });
    await session.detach();
});
