import { expect, type APIRequestContext } from '@playwright/test';
import { test } from './helpers/reconnecting-request';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';
import { WORLD_GEO_VERSION } from '../../shared/sector-geo';

const ADMIN = 'live-express-e2e-admin';

async function seedWildExplorer(request: APIRequestContext) {
    const name = `wildjourney${Date.now().toString(36)}`;
    const registered = await request.post('/api/player-auth', {
        data: { action: 'register', name, password: 'WildJourney!1234' },
    });
    expect(registered.status(), await registered.text()).toBe(200);
    const token = String((await registered.json()).token ?? '');
    const headers = { 'x-player-name': name, 'x-player-token': token };
    const character = {
        name, village: 'Moonshadow Village', storyVillage: 'Moonshadow Village', specialty: 'Ninjutsu', bloodline: 'None',
        level: 24, rankTitle: 'Chunin', xp: 0, unspentStats: 0, storyProgress: 99,
        onboardingStep: 'done', academyChecklistClaimed: true, starterCardsClaimed: true,
        examsPassed: ['genin', 'chunin'], profession: 'vanguard', professionRank: 1,
        professionXp: 0, professionChosenAt: 1,
        hp: 500, maxHp: 500, chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500,
        stats: Object.fromEntries(['strength', 'speed', 'intelligence', 'willpower', 'bukijutsuOffense',
            'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense', 'genjutsuOffense',
            'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense'].map(key => [key, 100])),
        ryo: 1000, inventory: [], itemStacks: [{ itemId: 'beast-seal-reinforced', count: 1 }],
        equipment: {}, pets: [], tileCards: [], jutsuMastery: [], equippedJutsuIds: [],
        pendingCombatMissionClaims: [], seenHints: ['worldMap'], dailyTilesExplored: 0, totalTilesExplored: 0,
    };
    const seeded = await request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': ADMIN },
        data: { character, worldGeoV: WORLD_GEO_VERSION, currentSector: 44, currentTile: 78,
            acceptedMissionIds: [], missionProgress: {}, triggeredEvents: [] },
    });
    expect(seeded.status(), await seeded.text()).toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    const canonicalResponse = await request.get(`/api/save/${name}`, { headers });
    expect(canonicalResponse.status(), await canonicalResponse.text()).toBe(200);
    const canonical = await canonicalResponse.json();
    const heartbeat = await request.post('/api/player/heartbeat', {
        headers, data: { name, sector: 44, tile: 78, character: canonical.character },
    });
    expect(heartbeat.status(), await heartbeat.text()).toBe(200);
    return { name, token, headers, canonical };
}

test('real World Map discovery binds a wild companion and survives refresh', async ({ page, request }, info) => {
    test.setTimeout(180_000);
    const account = await seedWildExplorer(request);
    await page.addInitScript(({ name, token, canonical, patchVersion }) => {
        if (localStorage.getItem('live-wild-installed') === name) return;
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name);
        localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('patchNotes.lastSeenVersion.v1', patchVersion);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        localStorage.setItem('live-wild-installed', name);
    }, { ...account, patchVersion: LATEST_PATCH_NOTE.version });
    // Only the in-memory test server accepts this secret header. Every
    // discovery, battle, seal spend, roster write and reload is real Express.
    await page.route('**/api/pet/encounter-start', route => route.continue({
        headers: { ...route.request().headers(), 'x-qa-wild-hit': ADMIN },
    }));
    await page.goto('/#/worldMap', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-shell[data-screen="worldMap"]')).toBeVisible({ timeout: 45_000 });
    const stage = page.locator('.sector-stage-panel');
    const returnToSector = page.getByRole('button', { name: /Return to Sector 44/ });
    for (let i = 0; i < 5; i++) {
        const skipStory = page.getByRole('button', { name: 'Skip', exact: true });
        await expect(stage.or(returnToSector).or(skipStory)).toBeVisible();
        if (await skipStory.isVisible()) await skipStory.click();
        else if (await returnToSector.isVisible()) await returnToSector.click();
        else break;
    }
    await expect(stage).toBeVisible();
    await stage.getByRole('button', { name: 'Move to tile row 2 column 10' }).click();
    const discoveryResponse = page.waitForResponse(response =>
        response.url().includes('/api/pet/encounter-start') && response.request().method() === 'POST');
    if (info.project.name === 'chromium-desktop-live') await page.keyboard.press('e');
    else {
        const explore = page.locator('.sector-hud').getByRole('button', { name: 'Explore', exact: true });
        await expect(explore).toBeInViewport();
        await explore.click();
    }
    const discovery = await discoveryResponse;
    expect(discovery.status(), await discovery.text()).toBe(200);
    const found = await discovery.json() as { pet?: { name?: string }; token?: string };
    expect(found.token).toBeTruthy();
    const petName = String(found.pet?.name ?? '');
    expect(petName).toBeTruthy();
    const scene = page.getByRole('dialog', { name: /visual novel scene/i });
    const petHeading = page.getByRole('heading', { name: petName });
    for (let i = 0; i < 4; i++) {
        await expect(scene.or(petHeading)).toBeVisible();
        if (await petHeading.isVisible()) break;
        await scene.getByRole('button', { name: 'Skip', exact: true }).click();
    }
    await expect(petHeading).toBeVisible();
    await page.getByRole('button', { name: 'Face the wild pet' }).click();
    await page.getByRole('button', { name: 'Continue' }).first().click();
    await page.getByRole('button', { name: 'Continue' }).first().click();
    await page.getByRole('button', { name: /Bind with Reinforced Beast Seal/ }).click();
    await expect(page.getByRole('heading', { name: 'Bond formed' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('wild-bound-real-express.png'), animations: 'disabled' });
    await page.getByRole('dialog', { name: 'Binding result' }).getByRole('button', { name: 'Continue' }).click();
    const saved = await request.get(`/api/save/${account.name}`, { headers: account.headers });
    expect(saved.status(), await saved.text()).toBe(200);
    const state = await saved.json() as { character: { pets: Array<{ name: string; origin: string }>;
        itemStacks: Array<{ itemId: string; count: number }> } };
    expect(state.character.pets).toEqual(expect.arrayContaining([expect.objectContaining({ name: petName, origin: 'wild' })]));
    expect(state.character.itemStacks.some(stack => stack.itemId === 'beast-seal-reinforced' && stack.count > 0)).toBe(false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    // The saved World Map can resume a pending story scene after its state
    // hydrates. It may appear a few seconds after DOMContentLoaded and cover
    // the mobile menu, so allow it to mount before navigating to Pet Home.
    await scene.waitFor({ state: 'visible', timeout: 12_000 }).catch(() => undefined);
    for (let i = 0; i < 8 && await scene.isVisible(); i++) {
        await scene.getByRole('button', { name: 'Skip', exact: true }).click();
    }
    if (info.project.name !== 'chromium-desktop-live') {
        await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'Menu', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Pet Home' }).click();
    for (let i = 0; i < 8; i++) {
        await expect(scene.or(petHeading)).toBeVisible();
        if (await petHeading.isVisible()) break;
        await scene.getByRole('button', { name: 'Skip', exact: true }).click();
    }
    await expect(petHeading).toBeVisible();
    await petHeading.scrollIntoViewIfNeeded();
    await expect(petHeading).toBeInViewport();
    await page.screenshot({ path: info.outputPath('wild-roster-real-express.png'), animations: 'disabled' });
});
