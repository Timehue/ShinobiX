import { expect, test, type Page } from '@playwright/test';
import type { ActivitySpineInput } from '../../api/player/_activity-spine';
import { createRequire } from 'node:module';
import { PUBLIC_CAPABILITY_IDS, type PublicCapabilities } from '../../shared/public-capabilities';
import type { MasteryFocus } from '../../shared/activity-spine';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

// Exercise the actual compiled server selector. Playwright's TS loader does
// not resolve the server's NodeNext .js-to-.ts imports; CI builds this first.
const serverRequire = createRequire(import.meta.url);
const { buildActivitySpine } = serverRequire('../../dist/api/player/_activity-spine.js') as typeof import('../../api/player/_activity-spine');
const { activitySaveFacts } = serverRequire('../../dist/api/player/_activity-spine-facts.js') as typeof import('../../api/player/_activity-spine-facts');
const { CHRONICLE_RULES_VERSION } = serverRequire('../../dist/shared/chronicle-duel.js') as typeof import('../../shared/chronicle-duel');

const capabilities = Object.fromEntries(PUBLIC_CAPABILITY_IDS.map(id => [id, { state: 'available', reason: 'available' }])) as PublicCapabilities;

async function briefing(page: Page, focus: MasteryFocus, changes: Record<string, unknown> = {}, extra: Partial<ActivitySpineInput> = {}, startScreen = 'village', dismissOpeningScene = false) {
    const save = uiAuditSave();
    const now = Date.now();
    save.character = { ...save.character, statPoints: 0, unspentStats: 0, masteryFocus: focus, lastLoginRewardDate: new Date(now).toISOString().slice(0, 10), ...changes };
    await installUiAuditRuntime(page, save, true);
    await page.route('**/api/player/activity-spine?**', route => {
        // The client must not override the saved preference. Explicit focus
        // values here seed the saved character and the authoritative fixture.
        expect(new URL(route.request().url()).searchParams.get('focus')).toBeNull();
        const c = save.character!;
        const spine = buildActivitySpine({ capabilities, now, level: Number(c.level), hospitalized: false, onboardingStep: 'done', unspentStats: 0,
            trainingIdle: true, jutsuTrainingIdle: true, hasJutsu: true, hasProfession: true, profession: 'healer', clanName: '', lastLoginRewardDate: new Date(now).toISOString().slice(0, 10),
            focus, facts: activitySaveFacts(c, now), ...extra });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, spine }) });
    });
    await page.goto(`/#/${startScreen}`, { waitUntil: 'domcontentloaded' });
    if (dismissOpeningScene) {
        const skip = page.locator('.cvn-skip');
        await expect(skip).toBeVisible();
        await skip.click();
    }
    await expect(page.getByRole('dialog', { name: 'Daily Briefing' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.activity-horizon-now article')).toHaveCount(1);
    await expect(page.locator('.activity-horizon-now button')).toBeEnabled();
    await expect(page.getByLabel('Mastery focus')).toHaveCount(0);
}

test('available chapter goes through the existing Story Hall entry', async ({ page }) => {
    await briefing(page, 'village-chronicle', { level: 55, storyProgress: 4 }, {}, 'village', true);
    await expect(page.locator('.activity-horizon-now')).toContainText('next Village Chronicle chapter');
    await page.locator('.activity-horizon-now button').click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'storyHall');
    await expect(page.getByRole('heading', { name: 'Story Hall', exact: true })).toBeVisible();
});

test('a level-gated story leads to available stat training', async ({ page }) => {
    await briefing(page, 'village-chronicle', { level: 55, storyProgress: 5 });
    await expect(page.locator('.activity-horizon-now')).toContainText('level 65');
    await page.locator('.activity-horizon-now button').click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'training');
});

test('a solo clan prerequisite opens the accessible Clan Hall', async ({ page }) => {
    await briefing(page, 'clan-war');
    await expect(page.locator('.activity-horizon-now')).toContainText('require membership');
    await page.locator('.activity-horizon-now button').click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'clan');
    await expect(page.getByRole('heading', { name: /Clan/i }).first()).toBeVisible();
});

test('unavailable companions go to roster management without starting a battle', async ({ page }) => {
    let starts = 0;
    page.on('request', req => { if (req.url().includes('/api/pet/showdown') && req.method() === 'POST') starts++; });
    await briefing(page, 'companions', { pets: [] });
    await page.locator('.activity-horizon-now button').click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'pets');
    expect(starts).toBe(0);
});

test('a familiar companion fighter opens the paid Coliseum destination', async ({ page }) => {
    const pet = {
        id: 'activity-guide-pet', templateId: 'standard-1', name: 'Kumo', rarity: 'standard',
        level: 40, hp: 900, attack: 120, defense: 70, speed: 80, element: 'Fire',
        role: 'assassin', jutsus: [],
    };
    await briefing(page, 'companions', { pets: [pet], activePetId: pet.id, totalPetWins: 1 });
    await expect(page.locator('.activity-horizon-now')).toContainText('companion Coliseum');
    await page.locator('.activity-horizon-now button').click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'petColiseum');
});

test('a forty-card illegal deck opens the actual Deck section', async ({ page }) => {
    await briefing(page, 'chronicle-showdown', { starterCardsClaimed: true, tileCards: ['tc-01'], cardClashDeck: Array(40).fill('tc-01') });
    await page.locator('.activity-horizon-now button').click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'shinobiTiles');
    await page.getByRole('button', { name: 'Enter the Card Hall', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Card Hall sections' }).getByRole('button', { name: 'Deck', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('active run overrides focus and returns to the existing Tower lobby', async ({ page }) => {
    await briefing(page, 'companions', {}, { resume: { title: 'Resume your Tower run', screen: 'battleTowers', runtimeModeId: 'battle-towers' } });
    await page.locator('.activity-horizon-now button').click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'battleTowers');
});

test('Legacy opens Profile Legacy', async ({ page }) => {
    await briefing(page, 'legacy');
    await page.locator('.activity-horizon-now button').click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'profile');
    await expect(page.locator('.profile-mobile-tabs button[aria-current="page"]')).toHaveText('Legacy');
});

test('supply review opens the Crafter', async ({ page }) => {
    await briefing(page, 'village-chronicle');
    await page.getByRole('button', { name: 'Review Recipes', exact: true }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'centralHub');
    await expect(page.getByRole('dialog', { name: /Crafter/i })).toBeVisible();
});

test('Legacy switches an already mounted Profile to the promised section', async ({ page }) => {
    await briefing(page, 'legacy', {}, {}, 'profile');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'profile');
    await expect(page.locator('.profile-mobile-tabs button[aria-current="page"]')).toHaveText('Profile');
    await page.locator('.activity-horizon-now button').click();
    await expect(page.locator('.profile-mobile-tabs button[aria-current="page"]')).toHaveText('Legacy');
});

test('deck preparation switches an already mounted Card Hall', async ({ page }) => {
    await briefing(page, 'chronicle-showdown', { starterCardsClaimed: true, tileCards: ['tc-01'], cardClashDeck: Array(40).fill('tc-01'), cardClashTutorialVersion: CHRONICLE_RULES_VERSION }, {}, 'shinobiTiles');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'shinobiTiles');
    await expect(page.locator('.chronicle-tabs button[aria-pressed="true"]')).toHaveText('Collection');
    await page.locator('.activity-horizon-now button').click();
    await expect(page.getByRole('navigation', { name: 'Card Hall sections' }).getByRole('button', { name: 'Deck', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('recipe review opens the Crafter within an already mounted Central Hub', async ({ page }) => {
    await briefing(page, 'village-chronicle', {}, {}, 'centralHub');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'centralHub');
    await expect(page.locator('.central-hub')).toBeAttached();
    await expect(page.locator('.central-dialog-shell--crafter')).toHaveCount(0);
    await page.getByRole('button', { name: 'Review Recipes', exact: true }).click();
    await expect(page.getByRole('dialog', { name: /Crafter/i })).toBeVisible();
});

test('mobile cards remain within the viewport and the briefing scrolls to its actions', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await briefing(page, 'clan-war');
    const dialog = page.getByRole('dialog', { name: 'Daily Briefing' });
    await expect(page.locator('.activity-card')).toHaveCount(6);
    const overflow = await dialog.evaluate(el => [...el.querySelectorAll('.activity-card')].some(card => {
        const r = card.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1;
    }));
    expect(overflow).toBe(false);
    await page.locator('.activity-horizon-long-term button').scrollIntoViewIfNeeded();
    await expect(page.locator('.activity-horizon-long-term button')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('activity-mobile.png') });
});
