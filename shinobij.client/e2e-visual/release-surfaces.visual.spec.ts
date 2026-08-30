import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { PUBLIC_CAPABILITY_IDS } from '../../shared/public-capabilities';

const FIXED_NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installDeterministicRuntime(page: Page) {
    await page.addInitScript((fixedNow) => {
        const NativeDate = Date;
        class FixedDate extends NativeDate {
            constructor(...args: ConstructorParameters<typeof Date>) {
                super(args.length === 0 ? fixedNow : args[0]);
            }
            static now() { return fixedNow; }
        }
        globalThis.Date = FixedDate as DateConstructor;
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

async function sectionScreenshot(page: Page, section: Locator, name: string) {
    await section.scrollIntoViewIfNeeded();
    await section.locator('img').evaluateAll(async (images) => {
        await Promise.all(images.map((image) => image instanceof HTMLImageElement ? image.decode().catch(() => undefined) : undefined));
    });
    await expect(section).toHaveScreenshot(name, {
        animations: 'disabled',
        caret: 'hide',
    });
}

async function expectNoHorizontalOverflow(page: Page) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => installDeterministicRuntime(page));

test('landing hero - desktop', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('start-create')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await screenshot(page, 'landing-desktop.png');
});

test('landing hero - compact', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('start-create')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await screenshot(page, 'landing-compact.png');
});

test('landing hero - mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('start-create')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await screenshot(page, 'landing-mobile.png');
});

test('landing finale - desktop', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const finale = page.locator('.landing-begin');
    await expect(finale).toBeVisible();
    await finale.scrollIntoViewIfNeeded();
    await settleVisualState(page);
    // Isolate the long section capture from the sticky global nav. Playwright
    // stitches element screenshots taller than the viewport and would otherwise
    // composite the sticky bar through the middle of the section artwork.
    await page.addStyleTag({ content: '.landing-topbar { visibility: hidden !important; }' });
    await expect(finale).toHaveScreenshot('landing-finale-desktop.png', {
        animations: 'disabled',
        caret: 'hide',
    });
});

test('landing story sections - desktop', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await settleVisualState(page);
    await page.addStyleTag({ content: '.landing-topbar { visibility: hidden !important; }' });
    await sectionScreenshot(page, page.locator('.landing-features'), 'landing-features-desktop.png');
    await sectionScreenshot(page, page.locator('.landing-band'), 'landing-band-desktop.png');
    await sectionScreenshot(page, page.locator('.landing-clan').nth(0), 'landing-clan-desktop.png');
    await sectionScreenshot(page, page.locator('.landing-clan').nth(1), 'landing-legacy-desktop.png');
    await sectionScreenshot(page, page.locator('.landing-footer'), 'landing-footer-desktop.png');
});

test('landing story sections - tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await settleVisualState(page);
    await expectNoHorizontalOverflow(page);
    await page.addStyleTag({ content: '.landing-topbar { visibility: hidden !important; }' });
    await sectionScreenshot(page, page.locator('.landing-features'), 'landing-features-tablet.png');
    await sectionScreenshot(page, page.locator('.landing-clan').first(), 'landing-clan-tablet.png');
});

test('landing story sections - mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await settleVisualState(page);
    await expectNoHorizontalOverflow(page);
    await page.addStyleTag({ content: '.landing-topbar { visibility: hidden !important; }' });
    await sectionScreenshot(page, page.locator('.landing-features'), 'landing-features-mobile.png');
    await sectionScreenshot(page, page.locator('.landing-band'), 'landing-band-mobile.png');
    await sectionScreenshot(page, page.locator('.landing-clan').first(), 'landing-clan-mobile.png');
    await sectionScreenshot(page, page.locator('.landing-clan').nth(1), 'landing-legacy-mobile.png');
    await sectionScreenshot(page, page.locator('.landing-begin'), 'landing-finale-mobile.png');
    await sectionScreenshot(page, page.locator('.landing-footer'), 'landing-footer-mobile.png');
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
        // Use the stat-derived full pools so passive regeneration cannot move a
        // visual baseline by one pixel/second while the page settles.
        hp: 1600, maxHp: 1600, chakra: 2000, maxChakra: 2000, stamina: 2000, maxStamina: 2000,
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
        // The player surface is gated on a live capability answer
        // (LiveCapabilitiesProvider / PlayerSurfaceBlocker). The generic
        // fallback below returns no `capabilities` key, which reads as "still
        // checking" and parks the app on "Reconnecting to your save" forever —
        // which is exactly how this spec silently rotted after the capability
        // system landed. Mirrors e2e/helpers/ui-audit-runtime.ts.
        if (path === '/api/player/capabilities') {
            return json(route, {
                ok: true,
                capabilities: Object.fromEntries(PUBLIC_CAPABILITY_IDS.map((id) => [
                    id,
                    { state: 'available', reason: 'available' },
                ])),
            });
        }
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
    // The h1 is two spans ("Central" + "The Thousand Gates") with the separator
    // supplied by CSS, so the accessible name has no em dash in it. Match on the
    // words rather than the punctuation: this locator previously pinned a dash
    // that the DOM never contained, and the failure looked like a broken hub.
    await expect(page.getByRole('heading', { name: /Central\s+The Thousand Gates/ })).toBeVisible();
    await screenshot(page, 'central-hub-desktop.png');
});
