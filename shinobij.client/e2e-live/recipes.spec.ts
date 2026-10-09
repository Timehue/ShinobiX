import { expect } from '@playwright/test';
import { API_CONNECTION_RETRIES, test } from './helpers/reconnecting-request';
import { uiAuditSave } from '../e2e/helpers/ui-audit-runtime';
import { uniquePlayerName } from './helpers/player-names';
import { quietRoadCooldowns } from './helpers/quiet-road';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';

for (const motion of ['reduce', 'no-preference'] as const) {
test.describe(`workshop motion: ${motion}`, () => {
test.use({ contextOptions: { reducedMotion: motion } });
test('workshop ingredient batches, armor lining and edible campaign rations persist', async ({ page, request, context }, info) => {
    const name = uniquePlayerName(stamp => `recipes${stamp}`);
    const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password: 'RecipeJourney!1234' } });
    expect(registered.status(), await registered.text()).toBe(200);
    const token = String((await registered.json()).token), headers = { 'x-player-name': name, 'x-player-token': token };
    const save = uiAuditSave(); save.currentSector = 0;
    save.character = { ...save.character, name, level: 85, ryo: 5000,
        equippedJutsuIds: [], jutsuMastery: [], equipment: {}, inventory: [], tileCards: [],
        villageUpgrades: {}, clanUpgradeLevels: {}, clanDoctrine: undefined, elderFocus: undefined,
        itemStacks: [
            { itemId: 'gather-iron-sand', count: 36 }, { itemId: 'gather-iron-sand-fine', count: 24 },
            { itemId: 'gather-iron-sand-superior', count: 2 }, { itemId: 'gather-iron-sand-pristine', count: 2 },
            { itemId: 'hunt-torn-hide', count: 8 }, { itemId: 'gather-binding-fiber', count: 18 }, { itemId: 'gather-heartwood-bark', count: 10 },
            { itemId: 'hunt-beast-meat', count: 8 }, { itemId: 'gather-field-herb', count: 8 },
            { itemId: 'weekly-boss-core', count: 10 }, { itemId: 'hunt-frost-pelt', count: 3 }, { itemId: 'hunt-ash-scale', count: 3 },
        ], wandererCooldowns: quietRoadCooldowns(Array.from({ length: 65 }, (_, i) => i + 1)) };
    const seeded = await request.post(`/api/save/${name}?signal=1`, { headers: { 'x-admin-password': 'live-express-e2e-admin' }, data: save });
    expect(seeded.status(), await seeded.text()).toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    const canonical = await (await request.get(`/api/save/${name}`, { headers })).json();
    await context.addInitScript(({ name, token, canonical, patch }) => {
        if (localStorage.getItem('recipe-journey-installed') === name) return;
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name); localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1'); localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        localStorage.setItem('legacyRumors.seen.v1:' + name, JSON.stringify([10, 20, 30, 40, 45]));
        localStorage.setItem('recipe-journey-installed', name);
    }, { name, token, canonical, patch: LATEST_PATCH_NOTE.version });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    let craftPosts = 0;
    page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/api/craft/forge')) craftPosts++; });
    page.on('dialog', dialog => void dialog.accept());
    const readCharacter = async () => (await (await request.get(`/api/save/${name}`, { headers })).json()).character;
    const owned = async (id: string) => {
        const c = await readCharacter();
        return c.inventory.filter((item: string) => item === id).length + c.itemStacks.filter((stack: { itemId: string }) => stack.itemId === id)
            .reduce((sum: number, stack: { count: number }) => sum + stack.count, 0);
    };
    await page.goto('/#/inventory', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-shell[data-screen="inventory"]')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Inspect Heartwood Bark', exact: true }).click();
    const fuel = page.getByRole('dialog', { name: 'Heartwood Bark item details', exact: true });
    await expect(fuel).toContainText('Fuel for Common Fish Rations');
    await fuel.getByRole('button', { name: 'Cook at the Noodle Den', exact: true }).click();
    await expect(page.locator('.cafe-kitchen')).toBeVisible();
    await page.goto('/#/hunting', { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tab', { name: 'Mining', exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('tab', { name: 'Mining', exact: true }).click();
    await page.getByRole('button', { name: 'Visit the Crafter in Central', exact: true }).click();
    const crafter = page.getByRole('dialog', { name: 'Crafter', exact: true });
    await expect(crafter).toBeVisible(); await expect(crafter).not.toContainText(/craft pts|craft points/);
    const recipe = (name: string) => crafter.locator('.cf-card').filter({ has: page.getByText(name, { exact: true }) });
    // Plenty of old generic points cannot replace missing actual ingredients.
    await expect(recipe('Elemental Treats').getByRole('button', { name: 'Craft ×1', exact: true })).toBeDisabled();
    await crafter.locator('.cf-batch').getByRole('button', { name: '×20', exact: true }).click();
    await expect(recipe('Shuriken ×3').getByRole('button')).toBeDisabled();
    await crafter.locator('.cf-batch').getByRole('button', { name: '×5', exact: true }).click();
    await expect(recipe('Shuriken ×3')).toContainText('Iron Sand or better: 64/30');
    await expect(recipe('Shuriken ×3')).toContainText('Heartwood Bark: 10/5');
    await expect(recipe('Shuriken ×3')).toContainText('Binding Fiber: 18/10');
    await recipe('Shuriken ×3').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('shuriken-three-materials.png'), fullPage: true });
    await recipe('Shuriken ×3').getByRole('button', { name: 'Craft ×5', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Choose crafting materials', exact: true });
    const workbench = picker.getByRole('region', { name: 'Crafting workbench' });
    const finishCraft = async (capture: string) => {
        await expect(workbench).toHaveAttribute('data-phase', 'complete');
        const back = picker.getByRole('button', { name: 'Back to Crafter', exact: true });
        await expect(back).toBeFocused();
        expect(await back.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= innerHeight && rect.height >= 44;
        })).toBe(true);
        await picker.screenshot({ path: info.outputPath(capture), animations: 'disabled' });
        await back.click(); await expect(picker).toHaveCount(0);
    };
    await expect(picker.getByRole('button', { name: 'Confirm craft', exact: true })).toBeDisabled();
    await expect(picker.getByRole('spinbutton', { name: 'Fine Iron Sand quantity', exact: true })).toHaveValue('0');
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(picker).toHaveCount(0);
    expect(await owned('gather-iron-sand')).toBe(36); expect(await owned('thrown-shuriken')).toBe(0);
    await expect(recipe('Shuriken ×3').getByRole('button', { name: 'Craft ×5', exact: true })).toBeFocused();
    await recipe('Shuriken ×3').getByRole('button', { name: 'Craft ×5', exact: true }).click();
    await picker.getByRole('spinbutton', { name: 'Iron Sand quantity', exact: true }).fill('28');
    await expect(picker.getByRole('button', { name: 'Confirm craft', exact: true })).toBeDisabled();
    await picker.getByRole('spinbutton', { name: 'Fine Iron Sand quantity', exact: true }).fill('2');
    await expect.poll(() => picker.evaluate(element => {
        const card = element.getBoundingClientRect();
        const confirm = element.querySelector('.craft-picker-confirm')!.getBoundingClientRect();
        return confirm.top >= card.top && confirm.bottom <= card.bottom && confirm.bottom <= innerHeight && confirm.height >= 44;
    })).toBe(true);
    await picker.screenshot({ path: info.outputPath('exact-material-selection.png') });
    expect(await picker.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    // A rejected craft restores the exact selection and never shows a reward.
    await page.route('**/api/craft/forge', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Workshop temporarily unavailable.' }) }));
    await picker.getByRole('button', { name: 'Confirm craft', exact: true }).click();
    await expect(picker.getByRole('alert')).toHaveText('Workshop temporarily unavailable.');
    await expect(workbench).toHaveCount(0);
    expect(await owned('thrown-shuriken')).toBe(0); expect(await owned('gather-iron-sand')).toBe(36);
    await expect(picker.getByRole('spinbutton', { name: 'Fine Iron Sand quantity', exact: true })).toHaveValue('2');
    await page.unroute('**/api/craft/forge');
    // A long response cannot reveal a fake result or submit a second craft.
    let releaseFirstForge!: () => void, forgeRequests = 0;
    const holdFirstForge = new Promise<void>(resolve => { releaseFirstForge = resolve; });
    await page.route('**/api/craft/forge', async route => {
        forgeRequests++;
        const response = await route.fetch({ maxRetries: API_CONNECTION_RETRIES });
        await holdFirstForge;
        await route.fulfill({ response });
    });
    try {
        await picker.getByRole('button', { name: 'Confirm craft', exact: true }).click();
        await expect(workbench).toHaveClass(/craft-sequence--forge/);
        if (await page.evaluate(() => !matchMedia('(prefers-reduced-motion: reduce)').matches)) {
            await expect(workbench).toHaveAttribute('data-phase', 'working');
            expect(await workbench.evaluate(element => element.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'))).toBe(true);
            await picker.screenshot({ path: info.outputPath('hammering-in-progress.png') });
        }
        await expect(workbench).toHaveAttribute('data-phase', 'waiting');
        await expect(picker.getByRole('button', { name: 'Confirm craft', exact: true })).toHaveCount(0);
        await expect(picker.getByRole('button', { name: 'Back to Crafter', exact: true })).toHaveCount(0);
        await expect.poll(() => owned('thrown-shuriken')).toBe(15);
        expect(forgeRequests).toBe(1);
    } finally { releaseFirstForge(); }
    await finishCraft('crafted-shuriken-reveal.png');
    await page.unroute('**/api/craft/forge');
    await expect.poll(() => owned('thrown-shuriken')).toBe(15);
    expect(await owned('gather-iron-sand')).toBe(8); expect(await owned('gather-iron-sand-fine')).toBe(22);
    expect(await owned('gather-iron-sand-superior')).toBe(2); expect(await owned('gather-iron-sand-pristine')).toBe(2);
    expect(await owned('hunt-beast-meat')).toBe(8);
    expect(await owned('gather-heartwood-bark')).toBe(5); expect(await owned('gather-binding-fiber')).toBe(8);
    await crafter.locator('.cf-batch').getByRole('button', { name: '×1', exact: true }).click();
    await recipe('Senbon ×1').getByRole('button', { name: 'Craft ×1', exact: true }).click();
    await picker.getByRole('spinbutton', { name: 'Fine Iron Sand quantity', exact: true }).fill('3');
    const postsBeforeSenbon = craftPosts;
    await picker.getByRole('button', { name: 'Confirm craft', exact: true }).click();
    await expect(workbench).toHaveAttribute('data-phase', 'complete');
    // Enter / implicit form submission must stay locked after the HTTP reply,
    // while the player is still looking at the result and has stock for more.
    await picker.locator('form').evaluate(form => form.requestSubmit());
    await finishCraft('crafted-senbon-reveal.png');
    expect(craftPosts).toBe(postsBeforeSenbon + 1);
    await expect.poll(() => owned('thrown-senbon')).toBe(1);
    await recipe('Attack Pill ×1').getByRole('button', { name: 'Craft ×1', exact: true }).click();
    let releaseForge!: () => void;
    const holdForgeReply = new Promise<void>(resolve => { releaseForge = resolve; });
    await page.route('**/api/craft/forge', async route => {
        const response = await route.fetch({ maxRetries: API_CONNECTION_RETRIES });
        await holdForgeReply;
        await route.fulfill({ response });
    });
    try {
        await picker.getByRole('button', { name: 'Confirm craft', exact: true }).click();
        await expect(workbench).toHaveClass(/craft-sequence--prepare/);
        if (await page.evaluate(() => !matchMedia('(prefers-reduced-motion: reduce)').matches)) {
            // Exercise keyboard activation without waiting for two stable layout
            // frames while this deliberately short animation is already ticking.
            await picker.getByRole('button', { name: 'Skip animation', exact: true }).press('Enter');
            await picker.screenshot({ path: info.outputPath('supplies-animation-skipped.png') });
        }
        await expect(workbench).toHaveAttribute('data-phase', 'waiting');
        await expect(picker).toContainText('Closing this menu will not cancel the craft.');
        await expect(picker.getByRole('button', { name: 'Confirm craft', exact: true })).toHaveCount(0);
        await expect(picker.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
        await page.keyboard.press('Escape');
        await expect(picker).toHaveCount(0); await expect(crafter).toBeVisible();
    } finally { releaseForge(); }
    await expect.poll(() => owned('item-attack-pill')).toBe(1);
    await page.unroute('**/api/craft/forge');
    expect(await owned('gather-field-herb')).toBe(4); expect(await owned('hunt-beast-meat')).toBe(6);
    await crafter.getByRole('button', { name: 'Armor', exact: true }).click();
    const chest = recipe('Rare Chest Plate');
    await expect(chest).toContainText('Fine Iron Sand or better: 23/14');
    await expect(chest).toContainText('Binding Fiber: 6/6');
    await chest.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('armor-ingredient-recipe.png'), fullPage: true });
    const beforeArmorRyo = (await readCharacter()).ryo;
    await chest.getByRole('button', { name: 'Forge', exact: true }).click();
    await picker.getByRole('spinbutton', { name: 'Fine Iron Sand quantity', exact: true }).fill('14');
    await picker.getByRole('spinbutton', { name: 'Torn Hide quantity', exact: true }).fill('8');
    await picker.getByRole('button', { name: 'Confirm craft', exact: true }).click();
    await expect(workbench).toHaveClass(/craft-sequence--stitch/);
    if (await page.evaluate(() => !matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        await picker.screenshot({ path: info.outputPath('stitching-armor-in-progress.png') });
    }
    await finishCraft('crafted-armor-reveal.png');
    await expect.poll(() => owned('rare-chest-plate')).toBe(1);
    expect(await owned('gather-iron-sand-fine')).toBe(5); expect(await owned('gather-iron-sand-superior')).toBe(2);
    expect(await owned('gather-iron-sand-pristine')).toBe(2); expect(await owned('hunt-torn-hide')).toBe(0);
    expect(await owned('hunt-frost-pelt')).toBe(3); expect(await owned('weekly-boss-core')).toBe(10);
    expect((await readCharacter()).ryo).toBe(beforeArmorRyo - 600);
    await page.goto('/#/cafeteria', { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const kitchen = page.locator('.cafe-kitchen');
    await expect(kitchen).toBeVisible(); await expect(kitchen).not.toContainText(/Frost Pelt|Ash Scale/);
    await expect(kitchen.getByRole('button', { name: /^Campaign Rations/ })).toContainText('4 Beast Meat');
    await expect(kitchen.getByRole('button', { name: /^Campaign Rations/ })).toContainText('2 Heartwood Bark for fuel');
    await kitchen.getByRole('button', { name: /^Campaign Rations/ }).click();
    await expect.poll(() => owned('ration-pack')).toBe(20);
    await kitchen.getByRole('button', { name: /^Field Rations/ }).click();
    await expect.poll(() => owned('ration-pack')).toBe(25);
    expect(await owned('hunt-beast-meat')).toBe(1); expect(await owned('gather-field-herb')).toBe(1);
    expect(await owned('gather-heartwood-bark')).toBe(0); expect(await owned('gather-binding-fiber')).toBe(0);
    await expect(kitchen.getByRole('button', { name: /^Field Rations/ })).toBeDisabled();
    await expect(kitchen).toContainText('Needs 1 Heartwood Bark for cooking fuel');
    expect(await owned('hunt-frost-pelt')).toBe(3); expect(await owned('hunt-ash-scale')).toBe(3);
    expect((await readCharacter()).ryo).toBe(beforeArmorRyo - 710);
    await page.reload(); await expect(kitchen).toBeVisible();
    await expect(kitchen).toContainText('Cooked today: 25/40 rations');
    expect(await owned('rare-chest-plate')).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await kitchen.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('edible-campaign-rations.png'), fullPage: true });
    expect(errors).toEqual([]);
});
});
}
