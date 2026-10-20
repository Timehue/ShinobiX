import { expect, test } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { rollWanderers, wandererDayBucketFromMs } from '../../shared/wanderer-roster';
import { quietRoadCooldowns } from '../e2e-live/helpers/quiet-road';

for (const enoughRyo of [true, false]) test(`road bandit replaces Flee with a 500 ryo toll (${enoughRyo ? 'paid' : 'insufficient funds'})`, async ({ page }, info) => {
    const now = Date.now();
    await page.clock.setFixedTime(now);
    const bucket = wandererDayBucketFromMs(now);
    const sector = Array.from({ length: 60 }, (_, i) => i + 1).find(sector => rollWanderers(sector, bucket).some(w => w.archetype === 'bandit'))!;
    const bandit = rollWanderers(sector, bucket).find(w => w.archetype === 'bandit')!;
    const save = uiAuditSave();
    save.currentSector = sector; save.currentTile = bandit.homeTile; save.worldGeoV = 2;
    const cooldowns = quietRoadCooldowns(Array.from({ length: 66 }, (_, i) => i + 1));
    delete cooldowns[bandit.id];
    save.character = { ...save.character, ryo: enoughRyo ? 1500 : 499, wandererCooldowns: cooldowns };
    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => localStorage.setItem('legacyRumors.seen.v1:auditninja', JSON.stringify([10, 20, 30, 40, 45])));
    let payments = 0;
    await page.route('**/api/sector/road-flee', async route => {
        payments++;
        expect(route.request().postDataJSON()).toMatchObject({ kind: 'toll', sector, wandererId: bandit.id });
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(enoughRyo
            ? { ok: true, cost: { hp: 0, ryo: 500 }, totals: { hp: Number(save.character!.hp), ryo: 1000 }, _saveVersion: 2 }
            : { ok: false, reason: 'no-ryo', error: 'You need 500 ryo on hand to pay the toll.' }) });
    });
    await page.goto('/#/worldMap');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'worldMap');
    const returnButton = page.getByRole('button', { name: new RegExp('Return to Sector ' + sector) });
    await expect.poll(async () => await returnButton.isVisible() || await page.locator('.sector-image-map').isVisible()).toBe(true);
    if (await returnButton.isVisible()) await returnButton.click();
    const pay = page.getByRole('button', { name: 'Pay 500 ryo', exact: true });
    // Open this NPC's copy through its real interaction handler. Map camera
    // hitboxes are covered by connected-sector-world; this checks the modal.
    if (!await pay.isVisible()) await page.locator('.sector-wanderer-figure').filter({ has: page.locator(`img[alt="${bandit.name}"]`) }).dispatchEvent('click');
    await expect(pay).toBeVisible();
    const card = page.locator('.card').filter({ has: pay });
    await expect(card).toHaveCSS('background-color', 'rgb(17, 24, 39)');
    await expect(card.getByRole('button', { name: 'Flee', exact: true })).toHaveCount(0);
    await expect(card).toContainText('You will not lose HP.');
    await page.screenshot({ path: info.outputPath('bandit-toll-choice.png'), fullPage: true });
    await pay.click();
    if (enoughRyo) await expect(pay).toBeHidden();
    else {
        await expect(card.getByRole('alert')).toHaveText('You need 500 ryo on hand to pay the toll.');
        await expect(card.getByRole('button', { name: 'Fight', exact: true })).toBeEnabled();
    }
    expect(payments).toBe(1);
});

for (const [archetype, action] of [['merchant', 'Buy bone charms'], ['medic', 'Pay for treatment'], ['tracker', 'Accept delivery']] as const) {
    test(`${archetype} prompt names the actual service`, async ({ page }, info) => {
        const now = Date.now();
        await page.clock.setFixedTime(now);
        const bucket = wandererDayBucketFromMs(now);
        const sector = Array.from({ length: 60 }, (_, i) => i + 1).find(sector => rollWanderers(sector, bucket).some(w => w.archetype === archetype))!;
        const npc = rollWanderers(sector, bucket).find(w => w.archetype === archetype)!;
        const save = uiAuditSave();
        save.currentSector = sector; save.currentTile = npc.homeTile; save.worldGeoV = 2;
        const cooldowns = quietRoadCooldowns(Array.from({ length: 66 }, (_, i) => i + 1));
        delete cooldowns[npc.id];
        save.character = { ...save.character, wandererCooldowns: cooldowns };
        await installUiAuditRuntime(page, save);
        await page.addInitScript(() => localStorage.setItem('legacyRumors.seen.v1:auditninja', JSON.stringify([10, 20, 30, 40, 45])));
        await page.goto('/#/worldMap');
        await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'worldMap');
        const back = page.getByRole('button', { name: new RegExp('Return to Sector ' + sector) });
        await expect.poll(async () => await back.isVisible() || await page.locator('.sector-image-map').isVisible()).toBe(true);
        if (await back.isVisible()) await back.click();
        await page.locator('.sector-wanderer-figure').filter({ has: page.locator(`img[alt="${npc.name}"]`) }).dispatchEvent('click');
        await expect(page.getByRole('button', { name: action, exact: true })).toBeVisible();
        await page.screenshot({ path: info.outputPath(`${archetype}-service.png`), fullPage: true });
    });
}
