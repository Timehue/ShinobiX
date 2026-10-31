import { expect, test } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import type { Pet } from '../src/types/pet';

test('a different retry presents and persists only the server-owned starter', async ({ page }) => {
    test.setTimeout(120_000);
    const save = uiAuditSave();
    save.character = { ...save.character, level: 1, onboardingStep: 'academyIntro', pets: [], activePetId: undefined };
    const runtime = await installUiAuditRuntime(page, save);
    page.on('dialog', dialog => dialog.accept());
    let owned: Pet | undefined;
    let attempts = 0;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/pet/choose-starter', async route => {
        attempts++;
        const requested = route.request().postDataJSON().pet as Pet;
        if (!owned) {
            // The endpoint committed A, but this client never received its reply.
            owned = { ...requested, trait: 'Loyal' };
            return route.abort('failed');
        }
        expect(requested.id).not.toBe(owned.id);
        await pending;
        const character = { ...runtime.serverSave().character, pets: [owned], activePetId: owned.id };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(character, version);
        return route.fulfill({ json: { character, _saveVersion: version } });
    });
    await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^Skip/ }).click();
    await page.getByRole('button', { name: /Remain Unbound/ }).click();
    await page.getByRole('button', { name: /^Skip/ }).click();
    await page.locator('.icx-pet-card').first().click();
    await page.getByRole('button', { name: /^Take / }).click();
    await expect(page.locator('.game-alert-card')).toContainText('Your companion choice could not reach the server');
    await page.locator('.game-alert-ok').click();
    await expect(page.getByRole('heading', { name: 'Choose Your Companion' })).toBeVisible();
    await page.locator('.icx-pet-card').nth(1).click();
    await page.getByRole('button', { name: /^Take / }).click();
    await expect(page.getByRole('button', { name: 'Saving companion…' })).toBeDisabled();
    expect(runtime.serverSave().character?.pets).toEqual([]);
    await expect(page.locator('.icx-root.is-companion')).toHaveCount(0);
    release();
    await page.getByRole('button', { name: /^Skip/ }).click();
    await expect(page.locator('.icx-root.is-companion')).toBeVisible();
    await expect(page.locator('.icx-root.is-companion')).toContainText(owned!.name);
    await page.getByRole('button', { name: /^Skip/ }).click();
    await expect.poll(() => runtime.serverSave().character?.onboardingStep).toBe('training');
    expect(attempts).toBe(2);
    expect(runtime.serverSave().character?.pets).toEqual([owned]);
    expect(runtime.serverSave().character?.activePetId).toBe(owned!.id);
});
