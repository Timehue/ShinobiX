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

test.beforeEach(async ({ page, request, context }, info) => {
    const name = uniquePlayerName(stamp => `craftlife${stamp}`);
    const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password: 'CraftJourney!1234' } });
    expect(registered.status(), await registered.text()).toBe(200);
    const token = String((await registered.json()).token);
    const headers = { 'x-player-name': name, 'x-player-token': token };
    const save = uiAuditSave(); save.currentSector = 0;
    save.character = { ...save.character, name, level: 85, ryo: 100_000, auraDust: 0, boneCharms: 0,
        equippedJutsuIds: [], jutsuMastery: [], equipment: {}, inventory: [], tileCards: [], itemStacks: [
            { itemId: 'gather-stormglass-shard-fine', count: 8 },
            { itemId: 'gather-field-herb', count: 10 }, { itemId: 'gather-heartwood-bark', count: 10 },
            { itemId: 'gather-binding-fiber', count: 10 }, { itemId: 'hunt-beast-meat', count: 20 },
            { itemId: 'hunt-cracked-horn', count: 12 }, { itemId: 'hunt-small-fang', count: 8 },
        ] };
    if (info.title.includes('established crafter')) {
        // Seed the server receipt shape; the client type still permits legacy ids.
        Object.assign(save.character, { redeemedCrafts: [{ id: 'prior-craft-receipt-001', kind: 'supply', recipeId: 'pet-treat', quantity: 1, at: Date.now() }] });
    }
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
    }, { name, token, canonical, patch: LATEST_PATCH_NOTE?.version ?? '' });
    await page.goto('/#/hunting', { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: 'Mining', exact: true }).click();
    await page.getByRole('button', { name: 'Visit the Crafter in Central', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Crafter', exact: true })).toBeVisible();
});

for (const firstCraft of [false, true]) {
for (const loseAcknowledgment of [false, true]) {
    test(`five treats charge the displayed fee for ${firstCraft ? 'a first-time' : 'an established'} crafter${loseAcknowledgment ? ' after a lost acknowledgment' : ''}`, async ({ page, request }) => {
        page.setDefaultTimeout(15_000);
        const auth = await page.evaluate(() => {
            const name = localStorage.getItem('shinobix:activePlayerPersist')!;
            const token = localStorage.getItem('shinobix:activeTokenPersist')!;
            return { name, token };
        });
        const headers = { 'x-player-name': auth.name, 'x-player-token': auth.token };
        const readSave = async () => {
            const reply = await request.get(`/api/save/${auth.name}`, { headers });
            expect(reply.status(), await reply.text()).toBe(200);
            return reply.json();
        };
        await expect.poll(async () => Array.isArray((await readSave()).character.claimedAchievementRewards)).toBe(true);
        const before = await readSave();
        expect(before.character.claimedAchievementRewards.includes('craft-first')).toBe(!firstCraft);
        const crafter = page.getByRole('dialog', { name: 'Crafter', exact: true });
        await crafter.locator('.cf-batch').scrollIntoViewIfNeeded();
        await crafter.getByRole('button', { name: /^\u00d7\s*5$/ }).click({ timeout: 15_000 });
        const card = crafter.locator('.cf-card').filter({ has: page.getByText('Pet Treats', { exact: true }) });
        await expect(card).toContainText('Costs 2,000 ryo');
        await card.getByRole('button', { name: /^Craft \u00d75$/ }).click();
        const picker = page.getByRole('dialog', { name: 'Choose crafting materials', exact: true });
        await expect(picker.locator('.craft-picker-summary')).toContainText('2,000 ryo');
        await picker.getByRole('spinbutton', { name: 'Beast Meat quantity', exact: true }).fill('20');
        const payloads: Array<Record<string, unknown>> = [];
        const replies: Array<{ character: { ryo: number }; _saveVersion: number; replayed?: boolean }> = [];
        const firstCraftReward = firstCraft ? page.waitForResponse(async response => {
            if (!response.url().endsWith('/api/achievements/sync') || !response.ok()) return false;
            return ((await response.json()).newlyRewarded ?? []).includes('craft-first');
        }) : null;
        await page.route('**/api/craft/forge', async route => {
            payloads.push(route.request().postDataJSON());
            const response = await route.fetch({ maxRetries: API_CONNECTION_RETRIES });
            expect(response.status(), await response.text()).toBe(200);
            replies.push(await response.json());
            if (loseAcknowledgment && replies.length === 1) await route.abort('failed');
            else await route.fulfill({ response });
        });
        await picker.getByRole('button', { name: 'Confirm craft', exact: true }).click();
        if (loseAcknowledgment) {
            await expect(picker.getByRole('alert')).toContainText('unreachable');
            const committed = await readSave();
            const earned = firstCraft && committed.character.claimedAchievementRewards.includes('craft-first') ? 2000 : 0;
            expect(committed.character.ryo).toBe(before.character.ryo - 2000 + earned);
            await picker.getByRole('button', { name: 'Confirm craft', exact: true }).click();
        }
        await expect(picker).toContainText('5 items added to your inventory.');
        await expect(picker.getByRole('button', { name: 'Back to Crafter', exact: true })).toBeVisible();
        expect(payloads).toHaveLength(loseAcknowledgment ? 2 : 1);
        for (const payload of payloads) {
            expect(payload.quantity).toBe(5);
            expect(payload.recipeId).toBe('pet-treat');
            expect(payload.requestId).toBe(payloads[0].requestId);
            expect(payload.materials).toEqual(expect.arrayContaining([
                expect.objectContaining({ 'hunt-beast-meat': 20 }), expect.objectContaining({ 'gather-field-herb': 10 }),
            ]));
        }
        expect(replies[0].character.ryo).toBe(before.character.ryo - 2000);
        expect(replies[0]._saveVersion).toBeGreaterThan(before._saveVersion);
        if (loseAcknowledgment) {
            expect(replies[1].replayed).toBe(true);
        }
        if (firstCraftReward) expect((await (await firstCraftReward).json()).reward.ryo).toBe(2000);
        const expectedRyo = before.character.ryo - 2000 + (firstCraft ? 2000 : 0);
        await page.goto('/#/profile', { waitUntil: 'domcontentloaded' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'profile');
        const wallet = page.locator('.profile-dossier-row').filter({ has: page.getByText('Ryo', { exact: true }) });
        await expect(wallet.locator('strong')).toHaveText(expectedRyo.toLocaleString('en-US'));
        const after = await readSave();
        expect(after.character.ryo).toBe(expectedRyo);
        const count = (id: string) => after.character.itemStacks.find((row: { itemId: string }) => row.itemId === id)?.count ?? 0;
        expect(count('pet-treat')).toBe(5);
        expect(count('hunt-beast-meat')).toBe(0);
        expect(count('gather-field-herb')).toBe(0);
    });
}
}

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
