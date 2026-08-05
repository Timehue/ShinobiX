import { expect, test, type Page, type Route } from '@playwright/test';

const FIXED_NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installDeterministicRuntime(page: Page) {
    await page.addInitScript((fixedNow) => {
        Date.now = () => fixedNow;
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
    }, FIXED_NOW);
    await page.route('**/api/**', (route) => json(route, {
        ok: true,
        images: {},
        categories: {},
        players: [],
        ladder: [],
        leaderboard: [],
        announcements: [],
        entries: [],
        eras: [],
        wars: [],
        territories: [],
        standings: [],
    }));
}

async function settleVisualState(page: Page) {
    await page.addStyleTag({ content: `
        *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            caret-color: transparent !important;
        }
        html { scroll-behavior: auto !important; }
        canvas, video { visibility: hidden !important; }
    ` });
    await page.evaluate(() => document.fonts.ready);
}

async function screenshot(page: Page, name: string) {
    await settleVisualState(page);
    await expect(page).toHaveScreenshot(name, {
        fullPage: false,
    });
}

test.beforeEach(async ({ page }) => installDeterministicRuntime(page));

test('landing hero - desktop', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('start-create')).toBeVisible();
    await screenshot(page, 'landing-desktop.png');
});

test('landing hero - mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('start-create')).toBeVisible();
    await screenshot(page, 'landing-mobile.png');
});

test('character creator entry', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByTestId('start-create').click();
    await expect(page.getByRole('heading', { name: 'Begin as a Shinobi' })).toBeVisible();
    await screenshot(page, 'character-creator-desktop.png');
});

test('authenticated Central Hub shell', async ({ page }) => {
    const character = {
        name: 'VisualNinja', village: 'Ember', specialty: 'Ninjutsu', bloodline: 'None',
        level: 12, rankTitle: 'Chunin', xp: 2400, ryo: 1800, unspentStats: 0,
        stats: {
            strength: 20, speed: 22, intelligence: 24, willpower: 20,
            bukijutsuOffense: 18, bukijutsuDefense: 18,
            taijutsuOffense: 18, taijutsuDefense: 18,
            genjutsuOffense: 18, genjutsuDefense: 18,
            ninjutsuOffense: 24, ninjutsuDefense: 22,
        },
        hp: 150, maxHp: 150, chakra: 180, maxChakra: 180, stamina: 140, maxStamina: 140,
        onboardingStep: 'done', inventory: [], itemStacks: [], equipment: {}, pets: [],
        jutsuMastery: [], equippedJutsuIds: [], pendingCombatMissionClaims: [],
        storyProgress: 9, storyVillage: 'Ember', storyTraits: [],
    };
    await page.unroute('**/api/**');
    await page.route('**/api/**', (route) => {
        const path = new URL(route.request().url()).pathname.toLowerCase();
        if (path === '/api/save/visualninja') {
            return json(route, { character, currentBiome: 'central', currentSector: 40, acceptedMissionIds: [], missionProgress: {}, triggeredEvents: ['builtin-aura-sphere-lv9'], _saveVersion: 1 });
        }
        if (path === '/api/player-auth') return json(route, { ok: true, token: 'visual-session-token' });
        if (path === '/api/perf-beacon') return route.fulfill({ status: 204 });
        if (path === '/api/battle-lock') return json(route, { lock: null });
        if (path === '/api/weekly-boss') return json(route, { boss: null, fightEnabled: true });
        if (path === '/api/ranked-season') return json(route, { current: null, lastSeason: null });
        if (path === '/api/legacy/status') return json(route, { enabled: false });
        return json(route, { ok: true, images: {}, categories: {}, players: [], leaderboard: [], announcements: [], entries: [], eras: [], wars: [], territories: [], standings: [] });
    });
    await page.addInitScript(() => {
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: 'VisualNinja' }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ visualninja: { token: 'visual-session-token' } }));
        localStorage.setItem('shinobix:activePlayerPersist', 'VisualNinja');
        localStorage.setItem('shinobix:activeTokenPersist', 'visual-session-token');
    });
    await page.goto('/#/centralHub', { waitUntil: 'networkidle' });
    const dismissPatchNotes = page.getByRole('button', { name: 'Got it' });
    if (await dismissPatchNotes.isVisible()) await dismissPatchNotes.click();
    await expect(page.getByRole('heading', { name: 'Central — The Thousand Gates' })).toBeVisible();
    await screenshot(page, 'central-hub-desktop.png');
});
