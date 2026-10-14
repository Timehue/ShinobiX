import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { expectViewportSafe } from './helpers/adaptive-assertions';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

const scrollers = [
    '.table-scroll', '.ui-tabs', '.profile-mobile-tabs', '.hol-tabs', '.council-tabs',
    '.expanded-tabs', '.town-tabs', '.clan-tabs', '.user-hub-tabs', '.pet-home-tabs',
    '.pet-arena-mode-toggle', '.pet-pick-strip', '.guides-filters', '.chronicle-tabs',
    '.arena-mode-toggle', '.profession-rank-ladder', '.bt-strip',
];
const runtimeErrors = new WeakMap<Page, string[]>();
const interactionProjects = new Set([
    'chromium-small-phone', 'chromium-compact-phone', 'chromium-phone-landscape',
    'chromium-mobile', 'chromium-pc-landscape-3-2',
    'firefox-presentation-desktop', 'webkit-presentation-phone',
]);
test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    runtimeErrors.set(page, errors);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error' && message.text().includes('[ScreenErrorBoundary]')) errors.push(message.text());
    });
});
test.afterEach(async ({ page }, info) => {
    if (info.status === 'passed') expect(runtimeErrors.get(page)).toEqual([]);
});

async function settled(page: Page) {
    await page.locator('.lazy-screen-fallback').waitFor({ state: 'hidden' });
    await expect(page.locator('.lazy-screen-fallback')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    // Only wait for finite entrance animations; ambient artwork may run forever.
    await page.locator('[role="dialog"], .center-game > *').evaluateAll(async elements => {
        await Promise.all(elements.flatMap(el => el.getAnimations().filter(a =>
            Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished.catch(() => {}))));
    });
}

async function capture(page: Page, info: TestInfo, state: string) {
    await settled(page);
    await page.waitForTimeout(150);
    await expect(page.getByRole('heading', { name: /This screen hit a snag|Something went wrong/ })).toHaveCount(0);
    await expectViewportSafe(page, { horizontalScrollers: scrollers, logicalStages: ['.world-map-scroll'] });
    if (process.env.UI_AUDIT_CAPTURE === '1') await page.screenshot({
        path: info.outputPath(`${state}.png`), animations: 'disabled',
    });
}

async function boot(page: Page, screen: string, inClan = false) {
    const save = uiAuditSave();
    save.character = { ...save.character, starterCardsClaimed: true, cardClashTutorialVersion: 999, ...(inClan ? { clan: 'Shadow Cell', clanFounder: false } : {}) };
    await installUiAuditRuntime(page, save);
    // Session-restorable lobbies intentionally disallow shared URL deep links.
    await page.addInitScript(screen => localStorage.setItem('lastScreen.v1', screen), screen);
    await page.route('**/api/village/war-map', route => route.fulfill({ json: { ok: true, enabled: true, villages: [], contests: [] } }));
    await page.route('**/api/clan/seal-pool/get?*', route => route.fulfill({ json: { clanName: 'Shadow Cell', balance: 2500, log: [] } }));
    await page.route('**/api/pet/sanctuary/list**', route => route.fulfill({ json: { ok: true, items: [], total: 0, nextCursor: null, carriedCount: 0, carriedCapacity: 5 } }));
    await page.route('**/api/pet/breeding/status**', route => route.fulfill({ json: { ok: true, session: null, serverTime: Date.now() } }));
    if (inClan) await page.route('**/api/save/clan-shadowcell', route => route.fulfill({ json: {
        name: 'Shadow Cell', village: 'Stormveil Village', founderName: 'FounderWithALongName',
        createdAt: Date.now() - 86_400_000, level: 8, xp: 300,
        treasury: { ryo: 25000, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0, warSupply: 0, items: [] },
        members: [
            { name: 'FounderWithALongName', village: 'Stormveil Village', level: 100, specialty: 'Taijutsu', battleContrib: 68, eventContrib: 5000, missionContrib: 147, isFounder: true, month: '2026-10' },
            { name: 'AuditNinja', village: 'Stormveil Village', level: 85, specialty: 'Ninjutsu', battleContrib: 5, eventContrib: 16, missionContrib: 92, isFounder: false, month: '2026-10' },
        ],
        roleOverrides: {}, joinRequests: [], notices: [], warHistory: [],
    } }));
    await page.goto(`/#/${screen}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', screen);
    await settled(page);
}

for (const screen of [
    'settings', 'premiumShop', 'worldCrisis', 'dojoCircuit', 'villageWarMap',
    'userHub', 'battleTowers', 'weeklyBoss', 'endlessTower', 'petArena', 'villageWar',
]) test(`${screen} secondary screen fits desktop and mobile`, async ({ page }, info) => {
    await boot(page, screen);
    await capture(page, info, screen);
});

test('Central district artwork leaves readable space for destination copy', async ({ page }, info) => {
    await boot(page, 'centralHub');
    const card = page.locator('.central-card').first();
    await card.scrollIntoViewIfNeeded();
    const copyWidth = await card.locator('.central-card-content').evaluate(el => el.getBoundingClientRect().width);
    expect(copyWidth).toBeGreaterThanOrEqual(180);
    const directoryWidth = await page.locator('.central-directory').evaluate(el => el.getBoundingClientRect().width);
    if ((page.viewportSize()?.width ?? 0) > 800 && directoryWidth > 760) {
        const cards = page.locator('.central-grid').first().locator('.central-card');
        const first = (await cards.nth(0).boundingBox())!;
        const second = (await cards.nth(1).boundingBox())!;
        expect(Math.abs(first.y - second.y), 'preserve the preferred two-column desktop directory').toBeLessThanOrEqual(1);
        expect(second.x).toBeGreaterThan(first.x);
    }
    await capture(page, info, 'central-district-cards');
});

const tabScreens = [
    ['profile', '.profile-mobile-tabs'],
    ['inventory', '.inventory-tabs'],
    ['missions', '.mission-hall [role="tablist"]'],
    ['townHall', '.town-tabs'],
    ['hallOfLegends', '.hol-tabs'],
    ['shinobiCouncil', '.council-tabs'],
    ['userHub', '.user-hub-tabs'],
    ['shinobiTiles', '.chronicle-tabs'],
    ['home', '.pet-home-tabs'],
    ['clan', '.clan-tabs'],
] as const;

for (const [screen, selector] of tabScreens) test(`${screen} menu sections remain reachable`, async ({ page }, info) => {
    test.skip(!interactionProjects.has(info.project.name), 'menu interactions are covered at the compact, mobile, landscape and desktop anchors');
    test.setTimeout(120_000);
    await boot(page, screen, screen === 'clan');
    const tabs = page.locator(selector).first();
    await expect(tabs).toBeVisible();
    const names = await tabs.locator('button').allTextContents();
    for (let index = 0; index < names.length; index++) {
        // Pet-home tabs can navigate to another route. Test each from its owner.
        if (await page.locator('.app-shell').getAttribute('data-screen') !== screen) {
            await page.goto(`/#/${screen}`, { waitUntil: 'domcontentloaded' });
            await page.reload({ waitUntil: 'domcontentloaded' });
            await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', screen);
            await settled(page);
        }
        const tab = page.locator(selector).first().locator('button').nth(index);
        if (await tab.isDisabled()) continue;
        await tab.click();
        await capture(page, info, `${screen}-tab-${index}`);
    }
});

test('training guidance and every stat remain readable without sideways scrolling', async ({ page }, info) => {
    await boot(page, 'training');
    await expect(page.locator('#training-recommendation')).toBeVisible();
    const summary = page.getByText('How training works', { exact: true });
    await summary.click();
    for (const selector of ['.training-guide-panel', '.stat-group-list']) {
        expect(await page.locator(selector).evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    }
    await capture(page, info, 'training-guidance-expanded');
    await summary.click();
    const stat = page.locator('[data-training-stat]:not([disabled])').first();
    await stat.click();
    const dialog = page.getByRole('dialog', { name: /^Train / });
    await expect(dialog).toBeVisible();
    const viewport = page.viewportSize();
    if (viewport && viewport.width > viewport.height && viewport.height <= 420) {
        expect(await dialog.locator('.ui-modal-body').evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    }
    await capture(page, info, 'training-timer');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(stat).toBeFocused();
});

test('a full desktop deck keeps its last card and footer actions reachable', async ({ page }, info) => {
    test.skip((page.viewportSize()?.width ?? 0) <= 1100, 'desktop sticky deck rail');
    await boot(page, 'shinobiTiles');
    await page.locator('.chronicle-tabs').getByRole('button', { name: 'Deck', exact: true }).click();
    const rail = page.locator('.chronicle-deck__list');
    await expect(rail).toBeVisible();
    const geometry = await rail.evaluate(el => ({ height: el.getBoundingClientRect().height, viewport: innerHeight, scrollable: el.scrollHeight > el.clientHeight }));
    expect(geometry.height).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.scrollable).toBe(true);
    const lastCard = rail.locator('.chronicle-deck__row').last();
    await lastCard.scrollIntoViewIfNeeded();
    await expect(lastCard).toBeInViewport();
    const clear = rail.getByRole('button', { name: 'Clear', exact: true });
    await clear.focus();
    await expect(clear).toBeFocused();
    await expect(clear).toBeInViewport();
    await capture(page, info, 'full-deck-footer');
});

test('all six creator stages and account validation fit the viewport', async ({ page }, info) => {
    test.skip(!interactionProjects.has(info.project.name), 'creator interactions use the representative input and viewport anchors');
    await page.route('**/api/**', route => route.fulfill({ json: { ok: true, images: {}, categories: {}, players: [] } }));
    await page.addInitScript(() => localStorage.setItem('shinobix:storage-notice-ack', '1'));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('start-create').click();
    await expect(page.locator('.cc-flow')).toBeVisible();
    for (let step = 0; step < 6; step++) {
        await capture(page, info, `creator-${step}`);
        if (step < 5) await page.locator('.cc-actions .cc-primary').click();
    }
    // Show the validation state without creating a real account.
    await page.locator('.cc-actions .cc-primary').click();
    await expect(page.locator('#cc-name-error')).toBeVisible();
    await expect(page.locator('#cc-password-error')).toBeVisible();
    await capture(page, info, 'creator-validation');
});

test('populated battle history and action details fit the viewport', async ({ page }, info) => {
    await boot(page, 'profile');
    const battleId = 'presentation-record';
    const opponent = 'The Ashen Vanguard of Stormveil';
    const now = Date.now();
    await page.route('**/api/pvp/combat-history**', route => route.fulfill({ json: { entries: [{
        battleId, opponent, startedAt: now - 90_000, endedAt: now, rounds: 7,
        mode: 'Ranked PvP', ranked: true, outcome: 'win', winner: 'p1',
    }] } }));
    await page.route('**/api/pvp/combat-log?*', route => route.fulfill({ json: {
        battleId, source: 'receipts', battle: {
            battleId, ranked: true, startedAt: now - 90_000, endedAt: now, rounds: 7,
            p1: { name: 'AuditNinja', hp: 780, maxHp: 1200 },
            p2: { name: opponent, hp: 0, maxHp: 1400 }, winner: 'p1',
        },
        entries: Array.from({ length: 7 }, (_, index) => ({
            battleId, seq: index + 1, round: index + 1,
            actorRole: 'p1', actorName: 'AuditNinja', targetRole: 'p2', targetName: opponent,
            actionId: 'audit-fire', actionName: 'Fire Style: Dragon Flame Barrage', actionType: 'jutsu',
            result: 'applied', summaryLines: ['A sweeping flame barrage strikes the opposing shinobi for 200 damage.'],
            actorDelta: { chakra: -30 }, targetDelta: { hp: -200 }, apSpent: 2, createdAt: now,
            display: { label: 'Fire Style: Dragon Flame Barrage', category: 'jutsu', element: 'Fire' },
        })),
    } }));
    await page.locator('.profile-mobile-tabs').getByRole('button', { name: /Battles/ }).click();
    const record = page.locator('.bh-card-server');
    await expect(record).toHaveCount(1);
    await capture(page, info, 'populated-battle-history');
    await record.click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'battleLog');
    await expect(page.getByRole('heading', { name: 'Detailed Battle Log' })).toBeVisible();
    const lastAction = page.locator('.bt-strip .bt-node').last();
    await lastAction.scrollIntoViewIfNeeded();
    await expect(lastAction).toBeInViewport();
    await lastAction.click();
    await expect(lastAction).toHaveClass(/bt-node-selected/);
    await capture(page, info, 'battle-record-details');
});
