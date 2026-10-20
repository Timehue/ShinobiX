import { test, expect } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test('the free Awakening summons ends as a conversation without offering a battle', async ({ page }) => {
    const save = uiAuditSave();
    save.character = { ...save.character, level: 2, elements: [], storyProgress: 0 };
    save.triggeredEvents = save.triggeredEvents.filter(id => id !== 'builtin-awakening-lv2');
    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => {
        localStorage.setItem('vnReaderMode.v1', 'cinematic');
        localStorage.setItem('vnTextSpeed.v1', 'instant');
        localStorage.setItem('vnAutoRead.v1', '0');
    });
    await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Enter World Map', exact: true }).click();
    const reader = page.getByRole('dialog', { name: 'The Pull Toward Central visual novel scene' });
    await expect(reader).toBeVisible();
    for (let line = 0; line < 6; line++) {
        const before = await reader.innerText();
        await reader.getByRole('button', { name: 'Next', exact: true }).click();
        await expect.poll(() => reader.innerText()).not.toBe(before);
    }
    await expect(reader.getByRole('button', { name: 'Begin battle', exact: true })).toHaveCount(0);
    await reader.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(reader).not.toContainText('shinobi challenger');
    await expect(reader.getByRole('button', { name: /Enter battle|Leave - no reward/ })).toHaveCount(0);
    await reader.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(reader).toHaveCount(0);
});
