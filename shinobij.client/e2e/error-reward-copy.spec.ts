import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test('the Academy reward instruction preserves the dummy incident', async ({ page }, info) => {
    const save = uiAuditSave();
    save.character = { ...save.character, onboardingStep: 'firstMission', academyTrialClaimed: false,
        academyIncidentSeen: true, academySparClaimed: true };
    const runtime = await installUiAuditRuntime(page, save);
    await expectUiAuditBoot(page, runtime, 'missions');
    const guide = page.locator('.coach-guide-line');
    await expect(guide).toBeVisible();
    await expect(guide).toContainText('I heard the voice from that dummy repeat your vow, too.');
    await expect(guide).toContainText('Open the Mission Hall and claim your Academy Trial reward.');
    await page.screenshot({ path: info.outputPath('academy-reward-and-dummy.png'), fullPage: true });
});

test('an unreadable response explains uncertain progress in the error modal', async ({ page }, info) => {
    const runtime = await installUiAuditRuntime(page, uiAuditSave());
    await expectUiAuditBoot(page, runtime, 'inventory');
    await page.evaluate(() => window.alert("Unexpected token '<', invalid JSON"));
    const notice = page.locator('.game-alert-backdrop');
    await expect(notice).toContainText('The server response could not be read.');
    await expect(notice).toContainText('Check your current progress before trying the action again.');
    await expect(notice).not.toContainText('Unexpected token');
    await page.screenshot({ path: info.outputPath('unconfirmed-error.png'), fullPage: true });
    await notice.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(notice).toBeHidden();
});
