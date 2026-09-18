import { expect, test, type Page } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { PUBLIC_CAPABILITY_IDS } from '../../shared/public-capabilities';

const companions = [
    { id: 'tamer-1', templateId: 'rare-26', name: 'Ember Ocelot', nickname: 'Sumi', element: 'Fire', rarity: 'rare', level: 32 },
    { id: 'tamer-2', templateId: 'legendary-6', name: 'Ember Phoenix', element: 'Fire', rarity: 'legendary', level: 45 },
    { id: 'tamer-3', templateId: 'rare-1', name: 'Tideback Otter', element: 'Water', rarity: 'rare', level: 27 },
    { id: 'tamer-4', templateId: 'rare-21', name: 'Stoneback Tanuki', element: 'Earth', rarity: 'rare', level: 19 },
].map(pet => ({ ...pet, xp: 0, maxLevel: 100, hp: 400, attack: 60, defense: 50, speed: 60, jutsus: [], happiness: 85, trait: 'Loyal', image: `/pet-poses/${pet.templateId}-idle.webp` }));

async function boot(page: Page, profession: string, overrides: Record<string, unknown> = {}) {
    const save = uiAuditSave();
    save.character = { ...save.character, profession, professionRank: 5, professionXp: 3000, honorSeals: 127, dailyHonorSealsEarned: 18, vanguardDailyResetDate: new Date().toISOString().slice(0, 10), pets: profession === 'petTamer' ? companions : [], ...overrides };
    const runtime = await installUiAuditRuntime(page, save);
    await page.route('**/api/village/war-map', route => route.fulfill({ json: { ok: true, enabled: true, villages: [], contests: [] } }));
    await page.route('**/api/pet/warfront-start', route => {
        expect(route.request().postDataJSON()).toMatchObject({ playerName: 'AuditNinja', resumeOnly: true });
        return route.fulfill({ status: 204 });
    });
    await page.route('**/api/missions/daily?*', route => route.fulfill({ json: { profession, missions: [
        { id: 'daily-1', name: profession === 'healer' ? 'A steady hand' : profession === 'vanguard' ? 'Hold the line' : 'Into the wilds', description: profession === 'healer' ? 'Restore health to wounded village allies.' : profession === 'vanguard' ? 'Win qualifying battles against rival shinobi.' : 'Complete expeditions with your companions.', target: 5, progress: 2, xpReward: 120, completedAt: null },
        { id: 'daily-2', name: 'In service of the village', description: 'Complete your daily profession duties.', target: 3, progress: 3, xpReward: 80, completedAt: Date.now() },
    ] } }));
    return { runtime, character: save.character };
}

async function assertLayout(page: Page) {
    const hub = page.locator('.ph-hub');
    const overflow = await hub.evaluate(element => {
        const root = element.getBoundingClientRect();
        return [...element.querySelectorAll('button, summary, h2, h3, .ph-metric, .ph-companion')].filter(el => {
            if (!(el as HTMLElement).checkVisibility()) return false;
            const box = el.getBoundingClientRect();
            return box.left < root.left - 1 || box.right > root.right + 1;
        }).map(el => el.textContent);
    });
    expect(overflow).toEqual([]);
    await expect.poll(() => hub.locator('img').evaluateAll(images => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
    expect(await hub.innerText()).not.toMatch(/[🐾🏥🎯🔥🏟⭐📜🛏🌍]/u);
}

async function openProfessionFromMenu(page: Page, label: string) {
    // The real menu deliberately debounces rapid navigation for 300ms.
    await expect(async () => {
        if (await page.locator('.app-shell').getAttribute('data-screen') === 'professions') return;
        const desktopEntry = page.locator('.right-menu-panel').getByRole('button', { name: label, exact: true });
        if (await desktopEntry.isVisible()) {
            await desktopEntry.click();
        } else {
            const menu = page.getByRole('dialog', { name: 'Shinobi menu' });
            if (!await menu.isVisible()) await page.getByRole('navigation', { name: 'Primary game navigation' }).getByRole('button', { name: 'Menu', exact: true }).click();
            await menu.getByRole('button', { name: label, exact: true }).click();
        }
        await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'professions', { timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await expect(page.locator('.ph-hero h2')).toHaveText(label);
}

for (const profession of ['vanguard', 'petTamer', 'healer']) {
    test(`${profession}: artwork, responsive layout, progression and destination`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error' && /ScreenErrorBoundary|TypeError|ReferenceError/.test(message.text())) errors.push(message.text());
        });
        const { runtime } = await boot(page, profession);
        await expectUiAuditBoot(page, runtime, 'professions');
        await expect(page.locator('.ph-hero h2')).toHaveText(profession === 'petTamer' ? 'Pet Tamer' : profession === 'healer' ? 'Healer' : 'Vanguard');
        await expect(page.getByRole('progressbar', { name: /rank progress/ })).toHaveAttribute('aria-valuenow', /\d+/);
        await expect(page.getByRole('heading', { name: 'Orders for today' })).toBeVisible();
        await page.locator('.profession-mastery-panel').scrollIntoViewIfNeeded();
        await assertLayout(page);
        await page.locator('.ph-hero').scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`${profession}-${testInfo.project.name}.png`), fullPage: true });
        await page.screenshot({ path: testInfo.outputPath(`${profession}-${testInfo.project.name}-viewport.png`) });
        if (profession === 'petTamer') {
            await page.locator('.ph-companions').scrollIntoViewIfNeeded();
            await page.screenshot({ path: testInfo.outputPath(`companions-${testInfo.project.name}.png`) });
        }
        await page.getByText('Explore specializations', { exact: true }).click();
        await expect(page.locator('.profession-mastery-path')).toHaveCount(3);
        await expect(page.locator('.profession-mastery-path').first()).toBeVisible();
        await page.locator('.profession-mastery-path').first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`${profession}-mastery-${testInfo.project.name}.png`) });
        await assertLayout(page);
        expect(errors).toEqual([]);
        const destinations = {
            vanguard: [['Find a Target', 'userHub'], ['Raid a Village', 'villageWar'], ['Sector Map', 'villageWarMap'], ['Arena District', 'arenaDistrict']],
            petTamer: [['Pet Yard', 'pets'], ['Pet Arena', 'petArena']],
            healer: [['Village Hospital', 'hospital']],
        };
        for (const [label, screen] of destinations[profession as keyof typeof destinations]) {
            await page.locator('.ph-hub').getByRole('button', { name: new RegExp(label) }).click();
            await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', screen);
            await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible();
            if (screen === 'villageWarMap') {
                await expect(page.getByRole('heading', { name: 'Sector War Map', exact: true })).toBeVisible();
                await expect(page.getByText('Loading the war map…', { exact: true })).toHaveCount(0);
            }
            await expect(page.getByRole('heading', { name: 'This screen hit a snag', exact: true })).toHaveCount(0);
            await openProfessionFromMenu(page, profession === 'petTamer' ? 'Pet Tamer' : profession === 'healer' ? 'Healer' : 'Vanguard');
            await expect(page.locator('.ph-hero h2')).toBeVisible();
        }
        // The hero uses the same navigation history as the rest of the game.
        await page.locator('.ph-hero').getByRole('button', { name: '← Back', exact: true }).click();
        await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', destinations[profession as keyof typeof destinations].at(-1)![1]);
        expect(errors).toEqual([]);
    });
}

test('empty companion roster and maximum-rank progression remain useful', async ({ page }) => {
    const { runtime } = await boot(page, 'petTamer', { pets: [], professionRank: 10, professionXp: 100_000 });
    await expectUiAuditBoot(page, runtime, 'professions');
    await expect(page.getByText('Profession mastered', { exact: true })).toBeVisible();
    await expect(page.getByText('Every bond begins with a first encounter.')).toBeVisible();
    await page.getByRole('button', { name: /Find a companion/ }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'pets');
});

test('healer can treat a worldwide patient and receives a visible receipt', async ({ page }) => {
    await page.clock.install();
    const { runtime, character } = await boot(page, 'healer', { professionRank: 10, professionXp: 100_000 });
    await page.route('**/api/player/injured-villagers?*', route => route.fulfill({ json: { injured: [{ name: 'WoundedAlly', level: 25, hp: 100, maxHp: 1000, hospitalized: false }] } }));
    let healBody: Record<string, unknown> | null = null;
    await page.route('**/api/player/heal', async route => {
        healBody = route.request().postDataJSON();
        // Pause before the receipt so passive regeneration cannot race the debit assertion.
        await page.clock.pauseAt(new Date(Date.now() + 1000));
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter({ ...character, chakra: 8980, professionXp: 100090 }, version);
        await route.fulfill({ json: { xpGained: 90, chakraCost: 20, professionXp: 100090, professionRank: 10, _saveVersion: version } });
    });
    await expectUiAuditBoot(page, runtime, 'professions');
    await page.getByRole('button', { name: 'Heal ally', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'WoundedAlly: Healed!' })).toBeVisible();
    expect(healBody).toMatchObject({ healerName: 'AuditNinja', targetName: 'WoundedAlly', requestId: expect.stringMatching(/^heal_/) });
    await expect(page.getByRole('button', { name: 'Heal ally', exact: true })).toHaveCount(0);
    await expect(page.locator('.ph-metric').filter({ hasText: 'Chakra available' }).locator('dd')).toHaveText('8,980');
    expect(runtime.saveConflictCount()).toBe(0);
});

test('Vanguard mastery investment and respec update the live Seal allowance and survive reload', async ({ page }) => {
    const { runtime, character } = await boot(page, 'vanguard', { professionRank: 10, professionXp: 100_000, masterySpec: {} });
    const requests: Record<string, unknown>[] = [];
    await page.route('**/api/profession/mastery', async route => {
        const body = route.request().postDataJSON();
        requests.push(body);
        const next = { ...character, masterySpec: body.action === 'invest' ? { 'seal-cap': 1 } : {}, ryo: body.action === 'respec' ? Number(character.ryo) - 50_000 : character.ryo };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(next, version);
        await route.fulfill({ json: { character: next, _saveVersion: version } });
    });
    await expectUiAuditBoot(page, runtime, 'professions');
    const ledger = page.getByRole('progressbar', { name: 'Daily Honor Seal progress' });
    await expect(ledger).toHaveAttribute('aria-valuenow', '18');
    await expect(ledger).toHaveAttribute('aria-valuemax', '50');
    await page.locator('.profession-mastery-node').filter({ hasText: 'Relentless' }).getByRole('button').click();
    await expect(ledger).toHaveAttribute('aria-valuemax', '55');
    await expect(page.getByText('3 points to spend', { exact: true })).toBeVisible();
    expect(requests[0]).toEqual({ playerName: 'AuditNinja', action: 'invest', nodeId: 'seal-cap' });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(ledger).toHaveAttribute('aria-valuemax', '55');
    await page.getByRole('button', { name: 'Respec all (50,000 ryo)', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(ledger).toHaveAttribute('aria-valuemax', '50');
    await expect(page.getByText('4 points to spend', { exact: true })).toBeVisible();
    expect(requests[1]).toEqual({ playerName: 'AuditNinja', action: 'respec' });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(ledger).toHaveAttribute('aria-valuemax', '50');
    expect(runtime.saveConflictCount()).toBe(0);
});

test('Vanguard ignores yesterday’s earnings and respects Sector Map maintenance', async ({ page }) => {
    const { runtime } = await boot(page, 'vanguard', { dailyHonorSealsEarned: 50, vanguardDailyResetDate: '2020-01-01' });
    await page.route('**/api/player/capabilities*', route => route.fulfill({ json: {
        ok: true,
        capabilities: Object.fromEntries(PUBLIC_CAPABILITY_IDS.map(id => [id, { state: id === 'villageWar' ? 'temporarily-unavailable' : 'available', reason: id === 'villageWar' ? 'maintenance' : 'available' }])),
    } }));
    await expectUiAuditBoot(page, runtime, 'professions');
    await expect(page.getByRole('progressbar', { name: 'Daily Honor Seal progress' })).toHaveAttribute('aria-valuenow', '0');
    const map = page.locator('.ph-hub').getByRole('button', { name: /Sector Map/ });
    await expect(map).toBeDisabled();
    await expect(map).toContainText('temporarily unavailable');
    await expect(page.locator('.ph-hub').getByRole('button', { name: /Raid a Village/ })).toBeEnabled();
});

test('Tamer loads published companion portraits and applies mastery bonuses immediately', async ({ page }) => {
    const { runtime, character } = await boot(page, 'petTamer', { professionRank: 10, professionXp: 100_000, masterySpec: {} });
    await page.route('**/api/images?*', async route => {
        const category = new URL(route.request().url()).searchParams.get('cat');
        await route.fulfill({ json: { ids: category === 'pet' ? ['pet:rare-26'] : [], version: '1' } });
    });
    await page.route('**/api/profession/mastery', async route => {
        expect(route.request().postDataJSON()).toEqual({ playerName: 'AuditNinja', action: 'invest', nodeId: 'pet-damage' });
        const next = { ...character, masterySpec: { 'pet-damage': 1 } };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(next, version);
        await route.fulfill({ json: { character: next, _saveVersion: version } });
    });
    await expectUiAuditBoot(page, runtime, 'professions');
    await expect(page.locator('.ph-companion').filter({ hasText: 'Sumi' }).locator('img')).toHaveAttribute('src', /\/api\/img\?id=pet%3Arare-26&v=1/);
    const damage = page.locator('.ph-metric').filter({ hasText: 'PvE pet damage' }).locator('dd');
    await expect(damage).toHaveText('+20%');
    await page.locator('.profession-mastery-node').filter({ hasText: 'Savagery' }).getByRole('button').click();
    await expect(damage).toHaveText('+22%');
    expect(runtime.saveConflictCount()).toBe(0);
});

test('healer retries a failed request with the same receipt ID and clears pending UI', async ({ page }) => {
    await page.clock.install();
    const { runtime, character } = await boot(page, 'healer', { professionRank: 10, professionXp: 100_000 });
    await page.route('**/api/player/injured-villagers?*', route => route.fulfill({ json: { injured: [{ name: 'WoundedAlly', level: 25, hp: 100, maxHp: 1000, hospitalized: false }] } }));
    const requests: Record<string, unknown>[] = [];
    let finishRequest!: () => void;
    const pendingResponse = new Promise<void>(resolve => { finishRequest = resolve; });
    await page.route('**/api/player/heal', async route => {
        requests.push(route.request().postDataJSON());
        if (requests.length === 1) {
            await pendingResponse;
            await route.fulfill({ status: 503, json: { error: 'Temporary failure' } });
            return;
        }
        // Retry timers run normally; freeze only when the successful receipt arrives.
        await page.clock.pauseAt(new Date(Date.now() + 1000));
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter({ ...character, chakra: 8980, professionXp: 100090 }, version);
        await route.fulfill({ json: { xpGained: 90, chakraCost: 20, professionXp: 100090, professionRank: 10, _saveVersion: version } });
    });
    await expectUiAuditBoot(page, runtime, 'professions');
    await page.getByRole('button', { name: 'Heal ally', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Healing…', exact: true })).toBeDisabled();
    finishRequest();
    await expect(page.getByRole('status').filter({ hasText: 'WoundedAlly: Healed!' })).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    await expect(page.locator('.ph-metric').filter({ hasText: 'Chakra available' }).locator('dd')).toHaveText('8,980');
});

test('a stale healing response cannot overwrite current progress or leave a stuck spinner', async ({ page }) => {
    const { runtime } = await boot(page, 'healer', { professionRank: 10, professionXp: 100_000 });
    await page.route('**/api/player/injured-villagers?*', route => route.fulfill({ json: { injured: [{ name: 'WoundedAlly', level: 25, hp: 100, maxHp: 1000, hospitalized: false }] } }));
    await page.route('**/api/player/heal', route => route.fulfill({ json: { xpGained: 90, chakraCost: 20, professionXp: 100090, professionRank: 10, _saveVersion: 0 } }));
    await expectUiAuditBoot(page, runtime, 'professions');
    await page.getByRole('button', { name: 'Heal ally', exact: true }).click();
    await expect(page.getByText('A newer save is already active. Reopen the ward to refresh.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Heal ally', exact: true })).toBeEnabled();
    await expect(page.locator('.ph-metric').filter({ hasText: 'Chakra available' }).locator('dd')).toHaveText('9,000');
    await expect(page.locator('.ph-heal-receipt')).toHaveCount(0);
});

test('daily orders recover cleanly after a temporary server failure', async ({ page }) => {
    const { runtime } = await boot(page, 'vanguard');
    let recovered = false;
    await page.route('**/api/missions/daily?*', route => {
        return !recovered
            ? route.fulfill({ status: 503, json: { error: 'Orders temporarily unavailable' } })
            : route.fulfill({ json: { profession: 'vanguard', missions: [{ id: 'recovered', name: 'Fresh orders', description: 'Win a qualifying battle.', target: 1, progress: 0, xpReward: 100, completedAt: null }] } });
    });
    await expectUiAuditBoot(page, runtime, 'professions');
    await expect(page.getByText('Orders temporarily unavailable')).toBeVisible();
    recovered = true;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByText('Fresh orders', { exact: true })).toBeVisible();
    await expect(page.getByText('Orders temporarily unavailable')).toHaveCount(0);
});

test('changing profession switches the hub, menu, missions and progression together', async ({ page }) => {
    const { runtime, character } = await boot(page, 'vanguard', { professionRank: 10, professionXp: 100_000, masterySpec: { 'seal-cap': 1 }, inventory: ['profession-change-approval'] });
    let activeProfession = 'vanguard';
    await page.route('**/api/missions/daily?*', route => route.fulfill({ json: { profession: activeProfession, missions: [{ id: `${activeProfession}-order`, name: `${activeProfession} assignment`, description: 'Serve your village.', target: 1, progress: 0, xpReward: 100, completedAt: null }] } }));
    await page.route('**/api/profession/choose', async route => {
        expect(route.request().postDataJSON()).toEqual({ playerName: 'AuditNinja', profession: 'healer', respec: true });
        activeProfession = 'healer';
        const next = { ...character, profession: 'healer', professionRank: 1, professionXp: 0, masterySpec: {}, inventory: [] };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(next, version);
        await route.fulfill({ json: { character: next, _saveVersion: version } });
    });
    await expectUiAuditBoot(page, runtime, 'professions');
    await page.getByRole('button', { name: 'Change to Healer', exact: true }).click();
    await page.getByRole('button', { name: 'Become Healer', exact: true }).click();
    await expect(page.locator('.ph-hero h2')).toHaveText('Healer');
    await expect(page.getByText('healer assignment', { exact: true })).toBeVisible();
    await expect(page.getByText('vanguard assignment', { exact: true })).toHaveCount(0);
    await expect(page.locator('.ph-rank-emblem strong')).toHaveText('01');
    await expect(page.getByText('0 points to spend', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change to Vanguard', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: /Village Hospital/ }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'hospital');
    await openProfessionFromMenu(page, 'Healer');
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.ph-hero h2')).toHaveText('Healer');
    expect(runtime.saveConflictCount()).toBe(0);
});
