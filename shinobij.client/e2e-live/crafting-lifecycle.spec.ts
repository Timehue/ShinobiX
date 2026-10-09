import { expect, type Page } from '@playwright/test';
import { API_CONNECTION_RETRIES, test } from './helpers/reconnecting-request';
import { uiAuditSave } from '../e2e/helpers/ui-audit-runtime';
import { uniquePlayerName } from './helpers/player-names';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';

async function openMenu(page: Page, name: string) {
    const target = page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
    const menu = page.getByRole('button', { name: 'Menu', exact: true }).filter({ visible: true }).first();
    await expect(target.or(menu).first()).toBeVisible();
    if (!await target.isVisible()) await menu.click();
    await target.click();
}

test.beforeEach(async ({ page, request, context }) => {
    const name = uniquePlayerName(stamp => `craftlife${stamp}`);
    const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password: 'CraftJourney!1234' } });
    expect(registered.status(), await registered.text()).toBe(200);
    const token = String((await registered.json()).token);
    const headers = { 'x-player-name': name, 'x-player-token': token };
    const save = uiAuditSave(); save.currentSector = 0;
    save.character = { ...save.character, name, level: 85, ryo: 5000, auraDust: 0, boneCharms: 0,
        equippedJutsuIds: [], jutsuMastery: [], equipment: {}, inventory: [], tileCards: [], itemStacks: [
            { itemId: 'gather-stormglass-shard-fine', count: 8 },
            { itemId: 'gather-field-herb', count: 10 }, { itemId: 'gather-heartwood-bark', count: 10 },
            { itemId: 'gather-binding-fiber', count: 10 }, { itemId: 'hunt-beast-meat', count: 2 },
            { itemId: 'hunt-cracked-horn', count: 12 }, { itemId: 'hunt-small-fang', count: 8 },
        ] };
    const seeded = await request.post(`/api/save/${name}?signal=1`, { headers: { 'x-admin-password': 'live-express-e2e-admin' }, data: save });
    expect(seeded.status(), await seeded.text()).toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    const canonical = await (await request.get(`/api/save/${name}`, { headers })).json();
    await context.addInitScript(({ name, token, canonical, patch }) => {
        if (localStorage.getItem('craft-lifecycle-installed') === name) return;
        localStorage.setItem('craft-lifecycle-installed', name);
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name);
        localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
    }, { name, token, canonical, patch: LATEST_PATCH_NOTE.version });
    await page.goto('/#/hunting', { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: 'Mining', exact: true }).click();
    await page.getByRole('button', { name: 'Visit the Crafter in Central', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Crafter', exact: true })).toBeVisible();
});

test('currency crafts credit the wallet and describe the actual reward', async ({ page }, info) => {
    const crafter = page.getByRole('dialog', { name: 'Crafter', exact: true });
    const picker = page.getByRole('dialog', { name: 'Choose crafting materials', exact: true });
    for (const reward of [{ name: 'Aura Dust', amount: 50 }, { name: 'Bone Charm', amount: 1 }]) {
        const card = crafter.locator('.cf-card').filter({ has: page.getByText(reward.name, { exact: true }) });
        await card.getByRole('button', { name: 'Craft ×1', exact: true }).click();
        await picker.getByRole('spinbutton', { name: 'Fine Stormglass Shard quantity', exact: true }).fill(reward.name === 'Aura Dust' ? '2' : '1');
        const response = page.waitForResponse(response => response.url().endsWith('/api/craft/forge'));
        await picker.getByRole('button', { name: 'Confirm craft', exact: true }).click();
        const body = await (await response).json();
        expect(body.character[reward.name === 'Aura Dust' ? 'auraDust' : 'boneCharms']).toBe(reward.amount);
        await expect(picker).toContainText(`${reward.name} ×${reward.amount} added to your wallet.`);
        await picker.screenshot({ path: info.outputPath(`${reward.name.toLowerCase().replace(' ', '-')}-receipt.png`), animations: 'disabled' });
        await picker.getByRole('button', { name: 'Back to Crafter', exact: true }).click();
    }
});

test('a craft reply still updates inventory after leaving Central', async ({ page }) => {
    const crafter = page.getByRole('dialog', { name: 'Crafter', exact: true });
    await crafter.locator('.cf-card').filter({ has: page.getByText('Attack Pill ×1', { exact: true }) })
        .getByRole('button', { name: 'Craft ×1', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Choose crafting materials', exact: true });
    let release!: () => void, settled!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const serverSettled = new Promise<void>(resolve => { settled = resolve; });
    await page.route('**/api/craft/forge', async route => {
        const response = await route.fetch({ maxRetries: API_CONNECTION_RETRIES });
        expect(response.status(), await response.text()).toBe(200);
        settled(); await held;
        await route.fulfill({ response });
    });
    try {
        await picker.getByRole('button', { name: 'Confirm craft', exact: true }).click();
        await serverSettled;
        await picker.getByRole('button', { name: 'Close', exact: true }).click();
        await crafter.getByRole('button', { name: '✕ Close', exact: true }).click();
        await openMenu(page, 'Inventory');
        await expect(page.locator('.app-shell[data-screen="inventory"]')).toBeVisible();
        release();
        await expect(page.getByRole('button', { name: 'Inspect Attack Pill', exact: true })).toBeVisible();
    } finally { release(); }
});
