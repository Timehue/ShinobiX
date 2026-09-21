import { expect, test, type Page } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test.setTimeout(90_000);

async function setup(page: Page, patch: Record<string, unknown> = {}, screen = 'village') {
    const original = uiAuditSave();
    const save = { ...original, currentSector: 0, character: { ...original.character, level: 2, rankTitle: 'Academy Student', firstContract: { version: 1, offeredAt: Date.now(), source: 'skip' }, ...patch } };
    const runtime = await installUiAuditRuntime(page, save);
    await page.route('**/api/player/academy-narrative', async (route) => {
        const action = route.request().postDataJSON().action;
        expect(['combat', 'discovery', 'companion']).toContain(action);
        const character = { ...save.character, firstContract: { ...save.character.firstContract as object, route: action, selectedAt: Date.now() } };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(character, version);
        await route.fulfill({ json: { character, _saveVersion: version } });
    });
    await page.goto(`/#/${screen}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', screen, { timeout: 30_000 });
}
async function chooseCombat(page: Page) {
    await page.locator('.fc-ribbon button').click();
    await page.getByRole('button', { name: /Combat Prove your technique/ }).click();
}

test('Mission Hall help stays in the header and leaves the first mission action uncovered', async ({ page }, info) => {
    test.setTimeout(180_000);
    await setup(page, { firstContract: { version: 1, source: 'skip', offeredAt: Date.now(), route: 'combat' } }, 'missions');
    const tip = page.getByRole('button', { name: 'Review Mission Hall tip' });
    const action = page.locator('.mh-combat-card').filter({ hasText: 'E-Rank Drill' }).getByRole('button', { name: 'Begin Mission' });
    await expect(page.locator('body > .screen-hint-missions')).toHaveCount(0);
    await expect(page.locator('.mh-header-copy .screen-hint-docked')).toHaveCount(1);
    for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport);
        await tip.scrollIntoViewIfNeeded();
        await tip.click();
        const dialog = page.getByRole('dialog', { name: 'Mission Hall tip' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Got it' })).toBeInViewport({ ratio: .99 });
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(tip).toBeFocused();
        await action.scrollIntoViewIfNeeded();
        await action.evaluate((element) => {
            const nav = document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect();
            if (!nav || !nav.height) return;
            const delta = element.getBoundingClientRect().bottom - (nav.top - 8);
            let scroller = element.parentElement;
            while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
            if (scroller) scroller.scrollTop += delta;
            else window.scrollBy(0, delta);
        });
        await expect(action).toBeInViewport({ ratio: .99 });
        expect(await action.evaluate((element) => {
            const r = element.getBoundingClientRect();
            return [[.15, .15], [.5, .5], [.85, .85]].every(([dx, dy]) => {
                const hit = document.elementFromPoint(r.left + r.width * dx, r.top + r.height * dy);
                return hit === element || Boolean(hit && element.contains(hit));
            });
        }), 'mission action must be uncovered across its tap area').toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
        await page.screenshot({ path: info.outputPath(`mission-help-clear-${viewport.width}.png`) });
    }
    await tip.click();
    await page.getByRole('dialog', { name: 'Mission Hall tip' }).getByRole('button', { name: 'Got it' }).click();
    await expect(tip).toHaveCount(0);
    await action.click({ trial: true });
});

test('first combat choice prepares an empty loadout before opening missions', async ({ page }) => {
    await setup(page, { equippedJutsuIds: [], jutsuMastery: [{ jutsuId: 'ashen-eyes-blood-gaze', level: 1, xp: 0 }] });
    await chooseCombat(page);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'profile');
    const collection = page.locator('#jutsu-workspace-tab-collection');
    await expect(collection).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.jutsu-quick-equip:not(:disabled)').first()).toBeVisible();
    await page.locator('#jutsu-workspace-tab-loadout').click();
    await expect(collection).toHaveAttribute('aria-selected', 'false');
    const overview = page.locator('.pmtab').filter({ hasText: /^Profile$/ });
    if (await overview.isVisible()) await overview.click();
    await expect(page.locator('.fc-ribbon')).toContainText('Prove your technique');
    await page.locator('.fc-ribbon button').click();
    await expect(page.getByRole('button', { name: 'Prepare your loadout' })).toBeVisible();
    await page.getByRole('button', { name: 'Prepare your loadout' }).click();
    await expect(collection).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.jutsu-quick-equip:not(:disabled)').first()).toBeVisible();
    await page.locator('#jutsu-workspace-tab-loadout').click();
    await expect(collection).toHaveAttribute('aria-selected', 'false');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(collection).toHaveAttribute('aria-selected', 'true');
});
test('a skipper without any learned jutsu goes to the Jutsu Hall, not an empty loadout', async ({ page }) => {
    await setup(page, { equippedJutsuIds: [], jutsuMastery: [] });
    await chooseCombat(page);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'jutsuTraining');
    await page.locator('.fc-ribbon button').click();
    await expect(page.getByRole('button', { name: 'Learn your first jutsu' })).toBeVisible();
});
test('combat handoffs select Combat for profession players, including an already mounted Mission Hall', async ({ page }) => {
    await setup(page);
    await chooseCombat(page);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'missions');
    await expect(page.locator('#mission-tab-combat')).toHaveAttribute('aria-selected', 'true');
    await page.locator('#mission-tab-profession').click();
    await expect(page.locator('#mission-tab-profession')).toHaveAttribute('aria-selected', 'true');
    await page.locator('.fc-ribbon button').click();
    await page.getByRole('button', { name: 'Open Mission Hall' }).click();
    await expect(page.locator('#mission-tab-combat')).toHaveAttribute('aria-selected', 'true');
    await page.locator('#mission-tab-profession').click();
    await expect(page.locator('#mission-tab-profession')).toHaveAttribute('aria-selected', 'true');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#mission-tab-combat')).toHaveAttribute('aria-selected', 'true');
});
test('Inventory can open the journal in place and restores keyboard focus', async ({ page }) => {
    await setup(page, {}, 'inventory');
    // adaptive-shell.css swaps the desktop rails for the phone nav at 980px, so
    // the width decides which trigger exists. A one-shot isVisible() sample
    // usually ran before the lazy rail mounted and fell back to the ribbon,
    // which hid a dropped rail click at boot. click() waits for the rail.
    const trigger = (page.viewportSize()?.width ?? 0) >= 980 ? page.locator('.fc-rail') : page.locator('.fc-ribbon button');
    await trigger.click();
    const journal = page.getByRole('dialog', { name: 'First Contract field journal' });
    await expect(journal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(journal).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'inventory');
});
test('Discovery keeps a readable journal shortcut on the World Map without covering its controls', async ({ page }, info) => {
    await setup(page, { firstContract: { version: 1, source: 'skip', offeredAt: Date.now(), route: 'discovery' } }, 'worldMap');
    const hint = page.getByRole('button', { name: 'First Contract: open your field journal' });
    await expect(hint).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const hintBox = await hint.boundingBox();
    const mapBox = await page.locator('.world-atlas-card').boundingBox();
    expect(hintBox && mapBox
        && hintBox.x >= mapBox.x
        && hintBox.y >= mapBox.y
        && hintBox.x + hintBox.width <= mapBox.x + mapBox.width
        && hintBox.y + hintBox.height <= mapBox.y + mapBox.height).toBeTruthy();
    await page.screenshot({ path: info.outputPath('discovery-wayfinding.png') });
    await hint.click();
    await expect(page.getByRole('dialog', { name: 'First Contract field journal' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(hint).toBeFocused();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'worldMap');
    if (info.project.name === 'chromium-mobile' || info.project.name === 'webkit-mobile') {
        for (const viewport of [{ width: 844, height: 390 }, { width: 360, height: 640 }]) {
            await page.setViewportSize(viewport);
            await expect(hint).toBeInViewport({ ratio: 1 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
            const regions = page.locator('.wm-village-chip');
            await expect(regions).toHaveCount(6);
            for (const region of await regions.all()) await expect(region).toBeInViewport({ ratio: 1 });
            await page.screenshot({ path: info.outputPath(`discovery-wayfinding-${viewport.width}.png`) });
        }
    }
});
