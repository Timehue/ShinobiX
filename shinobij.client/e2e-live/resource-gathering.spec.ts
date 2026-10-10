import { expect } from '@playwright/test';
import { API_CONNECTION_RETRIES, test } from './helpers/reconnecting-request';
import { uiAuditSave } from '../e2e/helpers/ui-audit-runtime';
import { uniquePlayerName } from './helpers/player-names';
import { quietRoadCooldowns } from './helpers/quiet-road';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';
import { FRACTURE_TEMPLATES } from '../../shared/fracture-chain';
import { readResourceGathering } from '../../shared/resource-gathering';

test.use({ contextOptions: { reducedMotion: 'no-preference' } });
// These journeys cross the map, shops, inventory, Outpost and crafting. Budget
// for full-motion Firefox/WebKit startup; individual minigame deadlines stay real.
test.setTimeout(300_000);
test('real map approaches, both minigames, Outpost tabs and fish cooking persist together', async ({ page, request, context }, info) => {
    const name = uniquePlayerName(stamp => `resource${stamp}`);
    const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password: 'GatheringJourney!1234' } });
    expect(registered.status(), await registered.text()).toBe(200);
    const token = String((await registered.json()).token), headers = { 'x-player-name': name, 'x-player-token': token };
    const save = uiAuditSave(); save.currentSector = 2; save.currentTile = 74; save.worldGeoV = 2; save.currentBiome = 'central';
    save.character = { ...save.character, name, equippedJutsuIds: [], jutsuMastery: [],
        equipment: { pickaxe: 'tool-golden-pickaxe', fishingPole: 'tool-golden-fishing-pole' },
        inventory: [], itemStacks: [{ itemId: 'gather-river-fish-fine', count: 5 }, { itemId: 'gather-field-herb', count: 2 }, { itemId: 'gather-heartwood-bark', count: 1 }],
        resourceGathering: { ...readResourceGathering(null), fishingXp: 3200, miningXp: 3200 },
        wandererCooldowns: quietRoadCooldowns(Array.from({ length: 65 }, (_, i) => i + 1)) };
    const seeded = await request.post(`/api/save/${name}?signal=1`, { headers: { 'x-admin-password': 'live-express-e2e-admin' }, data: save });
    expect(seeded.status(), await seeded.text()).toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    const canonical = await (await request.get(`/api/save/${name}`, { headers })).json();
    await context.addInitScript(({ name, token, canonical, patch }) => {
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name); localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1'); localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        localStorage.setItem('legacyRumors.seen.v1:' + name, JSON.stringify([10, 20, 30, 40, 45])); localStorage.setItem('liteFx.v1', '0');
    }, { name, token, canonical, patch: LATEST_PATCH_NOTE.version });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/#/worldMap', { waitUntil: 'domcontentloaded' });
    const enter = page.getByRole('button', { name: 'Enter World Map', exact: true });
    await expect(page.locator('.app-shell[data-screen="worldMap"]').or(enter)).toBeVisible({ timeout: 60_000 });
    if (await enter.isVisible()) await enter.click();
    const returnButton = page.getByRole('button', { name: /Return to Sector \d+\b/ });
    await expect.poll(async () => await returnButton.isVisible() || await page.locator('.continuous-world-map').isVisible()).toBe(true);
    if (await returnButton.isVisible()) await returnButton.click();
    await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy', 'false');
    await expect.poll(() => page.locator('.resource-node-art').evaluateAll(images => images.length > 0 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await page.screenshot({ path: info.outputPath('live-resource-markers.png'), fullPage: true });
    await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    await expect(page.getByRole('dialog', { name: 'Harbor iron seam', exact: true })).toBeVisible();
    const approach = page.getByRole('button', { name: 'Approach rock base', exact: true });
    if (await approach.isVisible()) {
        await approach.click();
        await expect.poll(async () => (await (await request.get('/api/player/world-move', { headers })).json()).tile, { timeout: 30_000 }).toBe(74);
        await expect(page.locator('.sector-player-tile')).toHaveAttribute('aria-label', 'Current tile row 7 column 3');
        await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    }
    await page.getByRole('button', { name: 'Begin mining · 1 action' }).click();
    await expect(page.locator('.fracture-board')).toBeVisible();
    const admitted = await (await request.get(`/api/save/${name}`, { headers })).json();
    const state = readResourceGathering(admitted.character.resourceGathering);
    for (const key of ['successDraw', 'qualityDraw', 'traceDraw', 'rules', 'authorityEpoch']) expect(state.active).not.toHaveProperty(key);
    const formation = FRACTURE_TEMPLATES[state.active!.template];
    for (const site of formation.sites.slice(0, formation.charges)) await page.getByRole('button', { name: new RegExp(`^${site.label}`) }).click();
    await page.screenshot({ path: info.outputPath('live-mining.png'), fullPage: true });
    await page.getByRole('button', { name: 'Detonate chain', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Mining result' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('live-mining-result.png'), fullPage: true });
    await page.getByRole('button', { name: 'Back to map', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: /^Dockside shoal, fishing/ }).click();
    await page.getByRole('button', { name: 'Approach shore', exact: true }).click();
    await expect.poll(async () => (await (await request.get('/api/player/world-move', { headers })).json()).tile, { timeout: 30_000 }).toBe(99);
    await expect(page.locator('.sector-player-tile')).toHaveAttribute('aria-label', 'Current tile row 9 column 4');
    await page.getByRole('button', { name: /^Dockside shoal, fishing/ }).click();
    await page.getByRole('button', { name: 'Cast line · 1 action' }).click();
    const hook = page.getByRole('button', { name: 'Hook fish', exact: true });
    await expect(hook).toBeEnabled();
    await hook.focus();
    await page.keyboard.press('Enter');
    const reel = page.getByRole('button', { name: 'Hold to reel', exact: true });
    await expect(reel).toBeEnabled();
    await expect(page.locator('.fishing-tension-fill')).toBeVisible();
    // Keep input on the reel control as the final phase changes its layout.
    // Pointer and touch targets are covered by the focused component suite.
    await reel.focus();
    for (let cycle = 0; cycle < 3; cycle++) {
        await page.keyboard.down('Space'); await page.waitForTimeout(1300);
        await page.keyboard.up('Space'); await page.waitForTimeout(700);
    }
    await page.screenshot({ path: info.outputPath('live-fishing-reel.png'), fullPage: true });
    await page.getByRole('button', { name: 'Collect result', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Fishing result' })).toBeVisible();
    const finished = await (await request.get(`/api/save/${name}`, { headers })).json();
    expect(readResourceGathering(finished.character.resourceGathering).attemptsToday).toBe(2);
    expect(readResourceGathering(finished.character.resourceGathering).receipts).toHaveLength(2);
    expect(readResourceGathering(finished.character.resourceGathering).active).toBeUndefined();
    await page.screenshot({ path: info.outputPath('live-fishing-result.png'), fullPage: true });
    await page.getByRole('button', { name: 'Back to map', exact: true }).click();
    await expect(page.locator('.sector-hud-explore')).toContainText('Shared 2/100');
    const you = page.locator('.mobile-bottom-nav').getByRole('button', { name: 'You', exact: true });
    if (await you.isVisible()) {
        await you.click();
        const profile = page.getByRole('dialog', { name: 'Your shinobi' });
        await expect(profile.locator('.left-caps-field')).toContainText('2/100');
        await profile.getByRole('button', { name: 'Close', exact: true }).click();
    } else {
        await expect(page.locator('.left-profile-card .left-caps-field')).toContainText('2/100');
    }
    // A new document checks server persistence without reloading a half-mounted
    // page and cancelling its startup requests (WebKit reports those as CORS errors).
    await page.goto('/?gathering-step=outpost#/hunting', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Shinobi Outpost', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Fishing', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Fishing · Level 10' })).toBeVisible();
    await page.getByRole('tab', { name: 'Mining', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Mining · Level 10' })).toBeVisible();
    await page.goto('/?gathering-step=kitchen#/cafeteria', { waitUntil: 'domcontentloaded' });
    const recipe = page.locator('article').filter({ hasText: 'Fine Fish Rations' });
    await recipe.getByRole('button').click();
    await expect.poll(async () => (await (await request.get(`/api/save/${name}`, { headers })).json()).character.rationsCookedToday).toBe(10);
    expect(errors).toEqual([]);
});

test('shop tools equip, survive reload, spend durability, and connect to refining and weapon forging', async ({ page, request, context }, info) => {
    page.setDefaultTimeout(20_000);
    const name = uniquePlayerName(stamp => `fieldkit${stamp}`);
    const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password: 'GatheringJourney!1234' } });
    expect(registered.status(), await registered.text()).toBe(200);
    const token = String((await registered.json()).token), headers = { 'x-player-name': name, 'x-player-token': token };
    const save = uiAuditSave(); save.currentSector = 2; save.currentTile = 74; save.worldGeoV = 2; save.currentBiome = 'central';
    save.character = { ...save.character, name, level: 85, ryo: 5000, fateShards: 200, elderFocus: undefined,
        villageUpgrades: {}, clanUpgradeLevels: {}, clanDoctrine: undefined,
        equippedJutsuIds: [], jutsuMastery: [], equipment: {}, inventory: [], tileCards: [], gatheringToolUses: {},
        itemStacks: [{ itemId: 'gather-iron-sand-fine', count: 8 }, { itemId: 'gather-iron-sand-superior', count: 2 },
            { itemId: 'gather-iron-sand-pristine', count: 2 }, { itemId: 'hunt-torn-hide', count: 100 },
            { itemId: 'gather-heartwood-bark', count: 2 }, { itemId: 'gather-binding-fiber', count: 4 }],
        resourceGathering: { ...readResourceGathering(null), fishingXp: 3200, miningXp: 3200 },
        wandererCooldowns: quietRoadCooldowns(Array.from({ length: 65 }, (_, i) => i + 1)) };
    const seeded = await request.post(`/api/save/${name}?signal=1`, { headers: { 'x-admin-password': 'live-express-e2e-admin' }, data: save });
    expect(seeded.status(), await seeded.text()).toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    const canonical = await (await request.get(`/api/save/${name}`, { headers })).json();
    await context.addInitScript(({ name, token, canonical, patch }) => {
        if (localStorage.getItem('fieldkit-installed') === name) return;
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name); localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1'); localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        localStorage.setItem('legacyRumors.seen.v1:' + name, JSON.stringify([10, 20, 30, 40, 45]));
        localStorage.setItem('liteFx.v1', '0'); localStorage.setItem('fieldkit-installed', name);
    }, { name, token, canonical, patch: LATEST_PATCH_NOTE.version });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => void dialog.accept());
    const readSave = async () => (await (await request.get(`/api/save/${name}`, { headers })).json()).character;
    let navigation = 0;
    const navigate = async (screen: string) => {
        // Change the query so this is one complete document navigation, including
        // repeat visits, rather than a hash change followed by an immediate reload.
        await page.goto(`/?gathering-step=${++navigation}#/${screen}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await expect(page.locator(`.app-shell[data-screen="${screen}"]`)).toBeVisible({ timeout: 60_000 });
    };
    const healthy = async () => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const failed = await page.locator('img:visible').evaluateAll(images => images
            .filter(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 0)
            .map(image => (image as HTMLImageElement).src));
        expect(failed).toEqual([]);
    };
    await navigate('shop');
    for (const tool of [{ id: 'tool-basic-pickaxe', name: 'Basic Pickaxe' }, { id: 'tool-basic-fishing-pole', name: 'Basic Fishing Pole' }]) {
        await page.getByRole('button', { name: new RegExp(tool.name) }).click();
        const popup = page.getByRole('dialog', { name: `${tool.name} item details` });
        await expect(popup).toContainText('50 gathering attempts');
        await healthy(); await page.screenshot({ path: info.outputPath(`${tool.id}-shop.png`), fullPage: true });
        const purchased = page.waitForResponse(response => response.url().endsWith('/shop/purchase') && response.request().postDataJSON().itemId === tool.id);
        await popup.getByRole('button', { name: 'Buy for 150 ryo', exact: true }).click();
        expect((await purchased).status()).toBe(200);
        await expect(popup).toHaveCount(0);
    }
    let current = await readSave(); expect(current.ryo).toBe(4700);
    expect(current.gatheringToolUses).toMatchObject({ 'tool-basic-pickaxe': 0, 'tool-basic-fishing-pole': 0 });
    await navigate('inventory');
    const kit = page.getByRole('region', { name: 'Gathering equipment' });
    await kit.getByRole('button', { name: 'Equip Basic Pickaxe', exact: true }).click();
    await kit.getByRole('button', { name: 'Equip Basic Fishing Pole', exact: true }).click();
    await expect(kit.getByText('50 / 50 uses remaining')).toHaveCount(2);
    expect(await kit.locator('.gathering-tool-slot').evaluateAll(cards => cards.every(card => card.scrollWidth <= card.clientWidth + 1))).toBe(true);
    await kit.screenshot({ path: info.outputPath('basic-tool-kit.png') });
    await healthy(); await page.screenshot({ path: info.outputPath('basic-tools-equipped.png'), fullPage: true });
    await page.reload();
    await expect(kit.getByText('50 / 50 uses remaining')).toHaveCount(2);
    current = await readSave(); expect(current.equipment).toMatchObject({ pickaxe: 'tool-basic-pickaxe', fishingPole: 'tool-basic-fishing-pole' });
    await navigate('worldMap');
    const enter = page.getByRole('button', { name: 'Enter World Map', exact: true });
    const returnButton = page.getByRole('button', { name: /Return to Sector \d+\b/ });
    await expect(page.locator('.continuous-world-map').or(enter).or(returnButton)).toBeVisible({ timeout: 60_000 });
    if (await enter.isVisible()) await enter.click();
    await expect.poll(async () => await returnButton.isVisible() || await page.locator('.continuous-world-map').isVisible()).toBe(true);
    if (await returnButton.isVisible()) await returnButton.click();
    await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    await expect(page.getByRole('dialog', { name: 'Harbor iron seam', exact: true })).toBeVisible();
    const approach = page.getByRole('button', { name: 'Approach rock base', exact: true });
    if (await approach.isVisible()) {
        await approach.click();
        await expect.poll(async () => (await (await request.get('/api/player/world-move', { headers })).json()).tile, { timeout: 30_000 }).toBe(74);
        await expect(page.locator('.sector-player-tile')).toHaveAttribute('aria-label', 'Current tile row 7 column 3');
        await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    }
    await page.getByRole('radio', { name: /Watch animation/ }).check();
    await page.getByRole('button', { name: 'Begin mining · 1 action' }).click();
    await expect(page.getByRole('button', { name: 'Abandon attempt (action stays spent)', exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Abandon attempt (action stays spent)', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Mining result' })).toContainText('2/3');
    await expect(page.getByRole('button', { name: 'Mine again' })).toBeVisible();
    current = await readSave(); expect(current.gatheringToolUses['tool-basic-pickaxe']).toBe(1);
    expect(readResourceGathering(current.resourceGathering).attemptsToday).toBe(1);
    await page.getByRole('button', { name: 'Back to map', exact: true }).click();
    await navigate('grandMarketplace');
    for (const tool of [{ id: 'tool-golden-pickaxe', name: 'Golden Pickaxe' }, { id: 'tool-golden-fishing-pole', name: 'Golden Fishing Pole' }]) {
        await page.getByRole('button', { name: new RegExp(tool.name) }).click();
        const popup = page.getByRole('dialog', { name: `${tool.name} item details` });
        await expect(popup).toContainText('Permanent · never breaks');
        const purchased = page.waitForResponse(response => response.url().endsWith('/shop/purchase') && response.request().postDataJSON().itemId === tool.id);
        await popup.getByRole('button', { name: 'Buy for 50 Fate Shards', exact: true }).click();
        expect((await purchased).status()).toBe(200); await expect(popup).toHaveCount(0);
    }
    current = await readSave(); expect(current.fateShards).toBe(100);
    await navigate('inventory');
    await page.getByRole('button', { name: 'Inspect Golden Pickaxe', exact: true }).click();
    const toolDetails = page.getByRole('dialog');
    await expect(toolDetails).toContainText('Gathering Tool');
    await expect(toolDetails).toContainText('Marketplace price: 50 Fate Shards');
    await expect(toolDetails).toContainText('Permanent · never breaks');
    await expect(toolDetails).not.toContainText('Equip for passive bonuses');
    await toolDetails.getByRole('button', { name: 'Close', exact: true }).last().click();
    await kit.getByRole('button', { name: 'Equip Golden Pickaxe', exact: true }).click();
    await kit.getByRole('button', { name: 'Equip Golden Fishing Pole', exact: true }).click();
    await expect(kit.getByText('Permanent · never breaks')).toHaveCount(2);
    await kit.screenshot({ path: info.outputPath('golden-tool-kit.png') });
    await healthy(); await page.screenshot({ path: info.outputPath('golden-tools-equipped.png'), fullPage: true });
    current = await readSave(); expect(current.inventory).toEqual(expect.arrayContaining(['tool-basic-pickaxe', 'tool-basic-fishing-pole']));
    expect(current.gatheringToolUses['tool-basic-pickaxe']).toBe(1);
    await navigate('hunting');
    await page.getByRole('tab', { name: 'Mining', exact: true }).click();
    await page.getByRole('button', { name: 'Visit the Crafter in Central', exact: true }).click();
    const crafter = page.getByRole('dialog', { name: 'Crafter', exact: true });
    await expect(crafter).toBeVisible();
    await crafter.getByRole('button', { name: 'Weapons', exact: true }).click();
    const recipe = crafter.locator('.cf-card').filter({ has: page.getByText('Ashen Leaf Saber', { exact: true }) });
    await expect(recipe).toContainText('Fine Iron Sand or better: 12/10');
    await recipe.getByRole('button', { name: 'Forge', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Choose crafting materials', exact: true });
    await picker.getByRole('spinbutton', { name: 'Fine Iron Sand quantity', exact: true }).fill('8');
    await picker.getByRole('spinbutton', { name: 'Superior Iron Sand quantity', exact: true }).fill('2');
    const beforeForgeRyo = (await readSave()).ryo;
    const forgeResponse = page.waitForResponse(response => response.url().endsWith('/craft/forge') && response.request().postDataJSON().recipeId === 'ashen-leaf-saber');
    await picker.getByRole('button', { name: 'Confirm craft', exact: true }).click();
    // Achievement sync may reward this first forge immediately after settlement.
    expect((await (await forgeResponse).json()).character.ryo).toBe(beforeForgeRyo - 600);
    await expect.poll(async () => (await readSave()).inventory.includes('ashen-leaf-saber')).toBe(true);
    await picker.getByRole('button', { name: 'Back to Crafter', exact: true }).click();
    current = await readSave();
    const quantity = (id: string) => current.itemStacks.find((stack: { itemId: string }) => stack.itemId === id)?.count ?? 0;
    expect(quantity('gather-iron-sand-fine')).toBe(0); expect(quantity('gather-iron-sand-superior')).toBe(0);
    expect(quantity('gather-iron-sand-pristine')).toBe(2); expect(quantity('hunt-torn-hide')).toBe(100);
    expect(quantity('gather-heartwood-bark')).toBe(0); expect(quantity('gather-binding-fiber')).toBe(0);
    await healthy(); await page.screenshot({ path: info.outputPath('graded-weapon-forge.png'), fullPage: true });
    await navigate('hunting');
    await page.getByRole('tab', { name: 'Mining', exact: true }).click();
    const refinery = page.locator('.outpost-refinery').locator('article').filter({ hasText: 'Pristine Iron Sand' });
    await refinery.getByRole('button', { name: 'Refine 1 → 4 Iron Sand', exact: true }).click();
    await expect.poll(async () => (await readSave()).itemStacks.find((stack: { itemId: string }) => stack.itemId === 'gather-iron-sand')?.count).toBe(4);
    current = await readSave(); expect(quantity('gather-iron-sand-pristine')).toBe(1);
    expect(readResourceGathering(current.resourceGathering).attemptsToday).toBe(1);
    await healthy(); await page.screenshot({ path: info.outputPath('outpost-refinery.png'), fullPage: true });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Mining · Level 10' })).toBeVisible();
    current = await readSave(); expect(current.equipment).toMatchObject({ pickaxe: 'tool-golden-pickaxe', fishingPole: 'tool-golden-fishing-pole' });
    expect(current.inventory).toContain('ashen-leaf-saber'); expect(quantity('gather-iron-sand')).toBe(4);
    expect(errors).toEqual([]);
});

// The server serializes a player's writes, but their replies can arrive in any
// order. Here the boot achievement sync is settled AFTER the purchase and its
// reply lands first: the page holds a newer version whose character is the old
// local one plus the stored wallet, so it has no pickaxe, and the purchase reply
// reads as stale. That left the popup open with Buy live, and the next autosave
// stored the pickaxe-less inventory: the player paid and lost the tool.
test('a tool purchase overtaken by a later save keeps the tool and closes its popup', async ({ page, request, context }) => {
    page.setDefaultTimeout(20_000);
    const name = uniquePlayerName(stamp => `overtake${stamp}`);
    const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password: 'GatheringJourney!1234' } });
    expect(registered.status(), await registered.text()).toBe(200);
    const token = String((await registered.json()).token), headers = { 'x-player-name': name, 'x-player-token': token };
    const save = uiAuditSave(); save.currentSector = 2; save.currentTile = 74; save.worldGeoV = 2; save.currentBiome = 'central';
    save.character = { ...save.character, name, level: 85, ryo: 5000, elderFocus: undefined, villageUpgrades: {}, clanUpgradeLevels: {},
        clanDoctrine: undefined, equippedJutsuIds: [], jutsuMastery: [], equipment: {}, inventory: [], tileCards: [], gatheringToolUses: {},
        wandererCooldowns: quietRoadCooldowns(Array.from({ length: 65 }, (_, i) => i + 1)) };
    expect('unlockedAchievements' in save.character, 'a first achievement sync runs at boot').toBe(false);
    expect((await request.post(`/api/save/${name}?signal=1`, { headers: { 'x-admin-password': 'live-express-e2e-admin' }, data: save })).status()).toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    const canonical = await (await request.get(`/api/save/${name}`, { headers })).json();
    await context.addInitScript(({ name, token, canonical, patch }) => {
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name); localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1'); localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        localStorage.setItem('legacyRumors.seen.v1:' + name, JSON.stringify([10, 20, 30, 40, 45])); localStorage.setItem('liteFx.v1', '0');
    }, { name, token, canonical, patch: LATEST_PATCH_NOTE.version });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const readSave = async () => (await (await request.get(`/api/save/${name}`, { headers })).json()).character;
    // Hold the boot sync until the purchase is stored, then deliver its newer
    // reply before the purchase reply. Both writes are real; only delivery order is set.
    let releaseSync!: () => void; const purchaseStored = new Promise<void>(resolve => { releaseSync = resolve; });
    let syncDelivered!: () => void; const syncLanded = new Promise<void>(resolve => { syncDelivered = resolve; });
    const order: string[] = [];
    await page.route('**/api/achievements/sync', async route => {
        if (order.includes('sync')) return route.continue();
        order.push('sync-held');
        await purchaseStored;
        const response = await route.fetch({ maxRetries: API_CONNECTION_RETRIES });
        order.push('sync'); await route.fulfill({ response }); syncDelivered();
    });
    await page.route('**/api/shop/purchase', async route => {
        const response = await route.fetch({ maxRetries: API_CONNECTION_RETRIES });
        releaseSync();
        await Promise.race([syncLanded, new Promise(resolve => setTimeout(resolve, 10_000))]);
        // Let the page adopt the sync's reply before this one arrives.
        await new Promise(resolve => setTimeout(resolve, 500));
        order.push('purchase'); await route.fulfill({ response });
    });
    await page.goto('/?gathering-step=overtake#/shop', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(page.locator('.app-shell[data-screen="shop"]')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => order).toContain('sync-held');
    await page.getByRole('button', { name: /Basic Pickaxe/ }).click();
    const popup = page.getByRole('dialog', { name: 'Basic Pickaxe item details' });
    const purchased = page.waitForResponse(response => response.url().endsWith('/shop/purchase'));
    await popup.getByRole('button', { name: 'Buy for 150 ryo', exact: true }).click();
    expect((await purchased).status()).toBe(200);
    expect(order).toEqual(['sync-held', 'sync', 'purchase']);
    await expect(popup).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Basic Pickaxe/ })).toContainText('Owned');
    // Give the autosave its debounce window: it must not store a copy without the tool.
    await page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(`/save/${name}`), { timeout: 10_000 }).catch(() => null);
    const stored = await readSave();
    expect(stored.ryo).toBe(4850);
    expect(stored.inventory).toContain('tool-basic-pickaxe');
    expect(errors).toEqual([]);
});
