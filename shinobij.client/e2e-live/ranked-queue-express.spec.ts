import { expect, test, type APIRequestContext, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

const PASSWORD = 'RankedJourney!1234';
const ADMIN = 'live-express-e2e-admin';

async function seedFighter(request: APIRequestContext, info: TestInfo, side: string) {
    const name = `rankedjourney${side}${info.workerIndex}${Date.now().toString(36)}`;
    const registered = await request.post('/api/player-auth', {
        data: { action: 'register', name, password: PASSWORD },
    });
    expect(registered.status(), await registered.text()).toBe(200);
    const token = String((await registered.json()).token ?? '');
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
        ryo: 1000, inventory: [], itemStacks: [], equipment: {}, pets: [], tileCards: [], jutsuMastery: [],
        equippedJutsuIds: [], pendingCombatMissionClaims: [],
    };
    const seeded = await request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': ADMIN },
        data: { character, currentSector: 1, acceptedMissionIds: [], missionProgress: {}, triggeredEvents: [] },
    });
    expect(seeded.status(), await seeded.text()).toBe(200);
    const headers = { 'x-player-name': name, 'x-player-token': token };
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    const canonicalResponse = await request.get(`/api/save/${name}`, { headers });
    expect(canonicalResponse.status(), await canonicalResponse.text()).toBe(200);
    return { name, token, headers, canonical: await canonicalResponse.json() };
}

async function openRanked(context: BrowserContext, account: Awaited<ReturnType<typeof seedFighter>>) {
    await context.addInitScript(({ name, token, canonical }) => {
        if (localStorage.getItem('ranked-journey-installed') === name) return;
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name);
        localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        localStorage.setItem('ranked-journey-installed', name);
    }, account);
    const page = await context.newPage();
    await page.goto('/#/centralHub', { waitUntil: 'domcontentloaded' });
    const arenaEntry = page.getByRole('button', { name: /Arena District/ });
    const skip = page.getByRole('dialog', { name: /visual novel scene/i }).getByRole('button', { name: 'Skip' });
    await expect(skip.or(arenaEntry)).toBeVisible();
    for (let attempt = 0; attempt < 6 && await skip.isVisible().catch(() => false); attempt++) {
        await skip.click();
    }
    if (!(await arenaEntry.isVisible())) {
        await page.goto('/#/centralHub', { waitUntil: 'domcontentloaded' });
    }
    await expect(arenaEntry).toBeVisible();
    await arenaEntry.click();
    await expect(page.getByRole('heading', { name: 'Arena District' })).toBeVisible();
    return page;
}

test('two ranked players enter one live PvP session and can advance its first turn', async ({ browser, context, request }, info) => {
    test.setTimeout(120_000);
    const started = await request.post('/api/admin/ranked-season', {
        headers: { 'x-admin-password': ADMIN }, data: { action: 'start' },
    });
    expect(started.status(), await started.text()).toBe(200);
    const alice = await seedFighter(request, info, 'alice');
    const bob = await seedFighter(request, info, 'bob');
    const bobContext = await browser.newContext({
        baseURL: String(info.project.use.baseURL),
        viewport: info.project.use.viewport,
        isMobile: info.project.use.isMobile,
        hasTouch: info.project.use.hasTouch,
    });
    try {
        const alicePage = await openRanked(context, alice);
        const bobPage = await openRanked(bobContext, bob);
        await alicePage.getByTestId('ranked-format-weapon-picker')
            .getByRole('button', { name: /Tempest Fang Blade/ }).click();
        await alicePage.getByRole('button', { name: 'Queue Up for Ranked' }).click();
        await bobPage.getByRole('button', { name: 'Queue Up for Ranked' }).click();
        await expect(alicePage.locator('.app-shell[data-screen="pvpBattle"]')).toBeVisible({ timeout: 30_000 });
        await expect(bobPage.locator('.app-shell[data-screen="pvpBattle"]')).toBeVisible({ timeout: 30_000 });

        const pending = await request.get(`/api/pvp/session?pending=1&playerName=${alice.name}&recoveryProbeVersion=2`, {
            headers: alice.headers,
        });
        expect(pending.status(), await pending.text()).toBe(200);
        const battleId = String((await pending.json()).battleId ?? '');
        expect(battleId).toMatch(/^pvp-/);
        const sessionResponse = await request.get(`/api/pvp/session?id=${battleId}`, { headers: alice.headers });
        expect(sessionResponse.status(), await sessionResponse.text()).toBe(200);
        const session = await sessionResponse.json() as {
            activePlayer: 'p1' | 'p2'; joined: { p1: boolean; p2: boolean }; rankedFormatVersion: number;
            p1: { character: { equipment: { hand: string }; bloodline: string }; hp: number };
            p2: { character: { equipment: { hand: string }; bloodline: string }; hp: number };
        };
        expect(session.joined).toEqual({ p1: true, p2: true });
        expect(session.rankedFormatVersion).toBe(1);
        expect(session.p1.character.equipment.hand).toBe('tempest-fang-blade');
        expect(session.p2.character.equipment.hand).toBe('black-lotus-dagger');
        expect(session.p1.character.bloodline).toBe('None');
        expect(session.p1.hp).toBe(10_000);
        expect(session.p2.hp).toBe(10_000);
        const activePage: Page = session.activePlayer === 'p1' ? alicePage : bobPage;
        await activePage.getByRole('button', { name: /WAIT End turn/i }).click();
        await expect.poll(async () => {
            const response = await request.get(`/api/pvp/session?id=${battleId}`, { headers: alice.headers });
            return (await response.json() as { activePlayer: string }).activePlayer;
        }).not.toBe(session.activePlayer);
        const nextPage = session.activePlayer === 'p1' ? bobPage : alicePage;
        await expect(nextPage.locator('.combat-item-button', { hasText: 'Attack Pill' })).toBeEnabled();
        await nextPage.locator('.combat-item-button', { hasText: 'Attack Pill' }).click();
        const nextRole = session.activePlayer === 'p1' ? 'p2' : 'p1';
        await expect.poll(async () => {
            const response = await request.get(`/api/pvp/session?id=${battleId}`, { headers: alice.headers });
            const current = await response.json() as { itemsUsed?: Record<string, Record<string, number>> };
            return current.itemsUsed?.[nextRole]?.['item-attack-pill'] ?? 0;
        }).toBe(1);
        await expect(alicePage.locator('.pvp-countdown-overlay')).toHaveCount(0);
        await expect(bobPage.locator('.pvp-countdown-overlay')).toHaveCount(0);
        await alicePage.screenshot({ path: info.outputPath('ranked-initiator.png') });
        await bobPage.screenshot({ path: info.outputPath('ranked-responder.png') });
    } finally {
        await bobContext.close();
    }
});
