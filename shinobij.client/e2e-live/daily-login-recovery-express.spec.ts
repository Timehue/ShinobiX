import { expect } from '@playwright/test';
import { API_CONNECTION_RETRIES, test } from './helpers/reconnecting-request';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';

test('daily claim survives a lost response, receipt retry, logout and relogin', async ({ page, request, context }, info) => {
    test.setTimeout(90000);
    const name = `daily${info.project.name.includes('mobile') ? 'm' : 'd'}${Date.now().toString(36)}`;
    const password = 'DailyRecovery!1234';
    const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password } });
    expect(registered.status(), await registered.text()).toBe(200);
    const { token } = await registered.json();
    const headers = { 'x-player-name': name, 'x-player-token': token };
    const character = { name, village: 'Moonshadow Village', specialty: 'Ninjutsu', bloodline: 'None',
        rankTitle: 'Genin', xp: 0, hp: 700, maxHp: 700, chakra: 1000, maxChakra: 1000,
        stamina: 1000, maxStamina: 1000, unspentStats: 0,
        stats: Object.fromEntries(['strength', 'speed', 'intelligence', 'willpower', 'bukijutsuOffense',
            'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense', 'genjutsuOffense',
            'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense'].map(key => [key, 20])),
        inventory: [], itemStacks: [], equipment: {}, pets: [], jutsuMastery: [], equippedJutsuIds: [],
        level: 10, ryo: 1000, fateShards: 20, loginStreak: 6,
        lastLoginRewardDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
        onboardingStep: 'done', academyChecklistClaimed: true, storyProgress: 9,
        storyVillage: 'Moonshadow Village', storyTraits: [],
        profession: 'vanguard', professionChosenAt: 1 };
    const seeded = await request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': 'live-express-e2e-admin' },
        data: { character, currentSector: 40, acceptedMissionIds: [], missionProgress: {},
            triggeredEvents: ['builtin-awakening-lv2', 'builtin-aura-sphere-lv9', 'builtin-hidden-dungeon'] },
    });
    expect(seeded.status(), await seeded.text()).toBe(200);
    const owned = await request.get(`/api/save/${name}`, { headers });
    const before = await owned.json();
    await request.post(`/api/save/${name}?ack=1`, { headers });
    await context.addInitScript(({ name, token, before, patch }) => {
        if (localStorage.getItem('daily-qa-installed')) return;
        localStorage.setItem('daily-qa-installed', '1');
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name);
        localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name}`, JSON.stringify(before));
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
    }, { name, token, before, patch: LATEST_PATCH_NOTE.version });
    let dropped = false;
    await page.route('**/api/player/daily-login', async route => {
        if (dropped) return route.continue();
        const response = await route.fetch({ maxRetries: API_CONNECTION_RETRIES });
        expect(response.status()).toBe(200);
        expect((await response.json()).granted.fateShards).toBe(5);
        dropped = true;
        await route.abort();
    });
    await page.goto('/#/village');
    const briefing = page.getByRole('dialog', { name: 'Daily Briefing' });
    await expect(briefing).toBeVisible();
    const claim = briefing.getByRole('button', { name: /Claim \+/ });
    await claim.click();
    await expect.poll(() => dropped).toBe(true);
    await expect(claim).toBeEnabled();
    await claim.click();
    await expect(briefing).toContainText("Today's login reward already collected");
    await expect(briefing).toContainText('7-day streak');
    await page.screenshot({ path: info.outputPath('daily-recovered.png'), fullPage: true });
    await briefing.getByRole('button', { name: 'Close briefing' }).click();
    const loggedOut = page.getByTestId('start-create');
    const logoutBlocked = page.getByRole('alertdialog', { name: /Save temporarily paused|Save Failed/ });
    for (let attempt = 0; attempt < 3; attempt++) {
        await page.waitForTimeout(3100); // Existing safe retry after a save-burst limit.
        if (info.project.name.includes('mobile')) {
            const menu = page.getByRole('dialog', { name: 'Shinobi menu' });
            if (!await menu.isVisible()) await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'Menu', exact: true }).click();
            await menu.getByRole('button', { name: 'Logout' }).click();
        } else await page.getByRole('button', { name: 'Logout', exact: true }).click();
        await expect(loggedOut.or(logoutBlocked)).toBeVisible();
        if (await loggedOut.isVisible()) break;
        await logoutBlocked.getByRole('button', { name: 'Stay in game', exact: true }).click();
        await expect(logoutBlocked).toHaveCount(0);
    }
    await expect(loggedOut).toBeVisible();
    const saved = await request.get(`/api/save/${name}`, { headers: { 'x-admin-password': 'live-express-e2e-admin' } });
    expect((await saved.json()).character.fateShards).toBe(25);
    await page.locator('.landing-topnav').getByRole('button', { name: 'Log In', exact: true }).click();
    await page.getByRole('button', { name: 'Use a name and password' }).click();
    await page.getByLabel('Name').fill(name);
    await page.getByPlaceholder('Enter your password').fill(password);
    const restored = page.waitForResponse(r => new URL(r.url()).pathname === `/api/save/${name}` && r.request().method() === 'GET' && r.status() === 200);
    await page.getByRole('button', { name: 'Enter Village' }).click();
    expect((await (await restored).json()).character.fateShards).toBe(25);
    await expect(briefing).toHaveCount(0);
});
