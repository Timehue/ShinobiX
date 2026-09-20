import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

function contractSave(firstContract: Record<string, unknown>) {
    const save = uiAuditSave();
    return { ...save, currentSector: 0, character: { ...save.character, level: 2, rankTitle: 'Academy Student', firstContract, academyVow: 'unbound' } };
}
const offered = () => ({ version: 1, offeredAt: Date.now(), source: 'skip' });

test('first contract is optional, accessible, responsive and survives a failed route save', async ({ page }, testInfo) => {
    test.setTimeout(90_000); // includes axe, keyboard traversal, a failed request and a reload on every engine
    const save = contractSave(offered());
    const runtime = await installUiAuditRuntime(page, save);
    let rejectNext = true;
    await page.route('**/api/player/academy-narrative', async (route) => {
        if (rejectNext) { rejectNext = false; return route.fulfill({ status: 503, json: { error: 'Connection interrupted. Try again.' } }); }
        const latest = runtime.lastCommit();
        const current = latest ? JSON.parse(latest.postedState).character : save.character;
        const action = route.request().postDataJSON().action as string;
        expect(['combat', 'discovery', 'companion']).toContain(action);
        // This fixture tests presentation/retry/version adoption. The real
        // authority rules are exercised by the shared and built-Express suites.
        const character = { ...current, firstContract: { ...current.firstContract, route: action, selectedAt: Date.now() } };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(character, version);
        return route.fulfill({ json: { character, _saveVersion: version } });
    });
    await expectUiAuditBoot(page, runtime, 'village');
    const journal = page.getByRole('dialog', { name: 'First Contract field journal' });
    await expect(journal).toHaveCount(0);
    const trigger = page.locator('.fc-ribbon').getByRole('button', { name: /Choose a route/ });
    await trigger.click();
    await expect(journal).toBeVisible();
    await expect(journal.getByRole('heading', { name: 'Your legend starts here.' })).toBeVisible();
    await expect(journal.locator('.fc-route-art')).toHaveCount(3);
    await expect.poll(() => journal.locator('.fc-route-art').evaluateAll((images) => images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
    await expect(journal.getByRole('button', { name: /Companion needed/ })).toBeDisabled();
    await expect(journal.getByRole('button', { name: /Companion needed/ })).toHaveCSS('opacity', '1');
    const viewport = page.viewportSize();
    if (viewport && viewport.width >= 1100 && viewport.height >= 768) {
        await expect(journal.getByRole('button', { name: /Two-minute refresher/ })).toBeInViewport({ ratio: 1 });
    }
    await journal.getByRole('button', { name: /Two-minute refresher/ }).click();
    await expect(journal.getByText('Prepare.', { exact: true })).toBeVisible();
    await journal.locator('.fc-journal-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(journal.getByRole('button', { name: 'Close field journal' })).toBeInViewport({ ratio: 1 });
    expect(await journal.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const audit = await new AxeBuilder({ page }).include('.fc-journal').analyze();
    expect(audit.violations).toEqual([]);
    await journal.getByRole('button', { name: /Two-minute refresher/ }).click();
    await journal.locator('.fc-journal-scroll').evaluate((el) => { el.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath('first-contract-routes.png') });
    await journal.getByRole('button', { name: 'Close field journal' }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(journal.getByRole('button', { name: /Two-minute refresher/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(journal.getByRole('button', { name: 'Close field journal' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(journal).toHaveCount(0);
    await expect(trigger).toBeFocused();
    const railTrigger = page.locator('.fc-rail');
    if (await railTrigger.isVisible()) {
        await railTrigger.click();
        await expect(journal).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(journal).toHaveCount(0);
        await expect(railTrigger).toBeFocused();
    }
    await trigger.click();
    await journal.getByRole('button', { name: /Combat Prove your technique/ }).click();
    await expect(journal.getByRole('alert')).toHaveText('Connection interrupted. Try again.');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'village');
    await journal.getByRole('button', { name: /Combat Prove your technique/ }).click();
    await expect(journal).toHaveCount(0);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'missions');
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.fc-ribbon')).toContainText('Prove your technique');
    await page.locator('.fc-ribbon').getByRole('button').click();
    await expect(journal.getByRole('button', { name: 'Open Mission Hall' })).toBeVisible();
    await expect(journal.getByRole('button', { name: 'Choose another route' })).toBeVisible();
});

test('a saved completion shows a factual recap and the player’s vow, never a new payout', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const save = contractSave({ ...offered(), route: 'discovery', selectedAt: Date.now(), completedAt: Date.now(), evidence: { kind: 'field-explore', sector: 4 } });
    const runtime = await installUiAuditRuntime(page, { ...save, activeTraining: { label: 'Training', stat: 'strength', endsAt: Date.now() - 1000, xp: 0, statGain: 1, staminaCost: 0 } });
    await expectUiAuditBoot(page, runtime, 'village');
    await page.locator('.fc-ribbon').getByRole('button', { name: 'Read your entry' }).click();
    const journal = page.getByRole('dialog', { name: 'First Contract field journal' });
    await expect(journal).toContainText('You explored a field tile beyond the village.');
    await expect(journal).toContainText('Field record: Sector 4.');
    await expect(journal).toContainText('Your answer to Shiranui');
    await expect(journal).not.toContainText('bonus reward');
    await page.screenshot({ path: testInfo.outputPath('first-contract-recap.png') });
});

test('return handoff appears on a later UTC day and stays off the Arena gateway', async ({ page }) => {
    test.setTimeout(90_000);
    const save = contractSave({ ...offered(), route: 'combat', completedAt: Date.now() - 86_400_000, acknowledgedAt: Date.now() - 86_400_000, evidence: { kind: 'combat-claim' } });
    const runtime = await installUiAuditRuntime(page, save);
    await expectUiAuditBoot(page, runtime, 'village');
    await page.locator('.fc-ribbon').getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back to the road.' })).toBeVisible();
    await page.getByRole('button', { name: 'Close field journal' }).click();
    // Arena lobbies are restorable, but deliberately not hash-deep-linkable.
    // Restore through the real last-screen contract on a fresh document.
    await page.addInitScript(() => localStorage.setItem('lastScreen.v1', 'battleArena'));
    await page.goto('/?first-contract-arena-check=1#/battleArena', { waitUntil: 'domcontentloaded' });
    await page.locator('.app-shell[data-screen="battleArena"]').waitFor({ state: 'visible' });
    await expect(page.locator('.fc-ribbon')).toHaveCount(0);
    await expect(page.locator('.fc-journal')).toHaveCount(0);
});
