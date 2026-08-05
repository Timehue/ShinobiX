import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

const PHASE = process.env.COMBAT_LAYOUT_CAPTURE_PHASE === 'before' ? 'before' : 'after';
const STRICT = PHASE === 'after' && process.env.COMBAT_LAYOUT_STRICT !== '0';
const SCREENSHOT_ROOT = resolve(process.cwd(), '..', 'docs', 'screenshots', 'combat-layout', PHASE);

const VIEWPORTS = [
    [360, 640], [390, 844], [412, 915], [768, 1024], [1024, 768], [1280, 720],
    [1366, 768], [1440, 900], [1920, 1080], [2560, 1440], [3440, 1440],
] as const;
const VIEWPORT_FILTER = process.env.COMBAT_LAYOUT_VIEWPORT;
const ACTIVE_VIEWPORTS = VIEWPORT_FILTER
    ? VIEWPORTS.filter(([width, height]) => `${width}x${height}` === VIEWPORT_FILTER)
    : VIEWPORTS;

// Browser zoom reduces the CSS viewport while the physical window stays fixed.
// These are the exact CSS viewport equivalents of 1440x900 at 80/100/125/150%.
const BROWSER_ZOOM_EQUIVALENTS = [
    { zoomPercent: 80, width: 1800, height: 1125 },
    { zoomPercent: 100, width: 1440, height: 900 },
    { zoomPercent: 125, width: 1152, height: 720 },
    { zoomPercent: 150, width: 960, height: 600 },
] as const;

const JUTSU_IDS = [
    'starter-nin-fire-1', 'starter-nin-fire-2', 'starter-nin-fire-3',
    'starter-nin-water-1', 'starter-nin-water-2', 'starter-nin-wind-1',
    'starter-nin-lightning-1', 'starter-nin-earth-1', 'starter-universal-flicker',
];

function safeProject(testInfo: TestInfo): string {
    // Preserve enough of every project-name segment to distinguish configs such
    // as chromium-desktop-live and chromium-mobile-live. Prefix truncation made
    // both "chromiu", so the second project collided with the first account.
    return testInfo.project.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map((segment) => segment.slice(0, 3))
        .join('')
        .slice(0, 9);
}

function character(name: string) {
    return {
        name,
        village: 'Ember',
        specialty: 'Ninjutsu',
        bloodline: 'None',
        level: 1,
        rankTitle: 'Academy Student',
        xp: 0,
        ryo: 10_000,
        unspentStats: 0,
        stats: {
            strength: 900, speed: 900, intelligence: 1_200, willpower: 1_100,
            bukijutsuOffense: 800, bukijutsuDefense: 800,
            taijutsuOffense: 800, taijutsuDefense: 800,
            genjutsuOffense: 900, genjutsuDefense: 900,
            ninjutsuOffense: 1_200, ninjutsuDefense: 1_000,
        },
        hp: 8_000, maxHp: 8_000,
        chakra: 8_000, maxChakra: 8_000,
        stamina: 8_000, maxStamina: 8_000,
        onboardingStep: 'done',
        inventory: ['rustfang-kunai', 'potion-rejuvenation', 'potion-rejuvenation', 'consum-smoke-pellet'],
        itemStacks: [
            { itemId: 'potion-rejuvenation', count: 2 },
            { itemId: 'consum-smoke-pellet', count: 1 },
        ],
        equipment: { hand: 'rustfang-kunai', potion: 'potion-rejuvenation', item: 'consum-smoke-pellet' },
        pets: [],
        jutsuMastery: JUTSU_IDS.map((jutsuId) => ({ jutsuId, level: 50 })),
        equippedJutsuIds: JUTSU_IDS,
        pendingCombatMissionClaims: [],
        dailyMissionsCompleted: 0,
    };
}

async function seedSave(request: APIRequestContext, name: string) {
    const seeded = await request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': 'live-express-e2e-admin' },
        data: { character: character(name), currentSector: 40, acceptedMissionIds: [], missionProgress: {}, triggeredEvents: [] },
    });
    expect(seeded.status()).toBe(200);
}

async function seedAccount(request: APIRequestContext, testInfo: TestInfo, mode: 'solo' | 'pvp') {
    const name = `${mode}${safeProject(testInfo)}champ`.slice(0, 20);
    const password = 'LayoutMatrix!1234';
    const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password } });
    expect(registered.status()).toBe(200);
    const token = String((await registered.json()).token ?? '');
    expect(token.length).toBeGreaterThan(10);
    await seedSave(request, name);
    return { name, token };
}

async function installSession(page: Page, name: string, token: string) {
    await page.addInitScript(({ player, sessionToken }) => {
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: player }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [player]: { token: sessionToken } }));
        localStorage.setItem('shinobix:activePlayerPersist', player);
        localStorage.setItem('shinobix:activeTokenPersist', sessionToken);
    }, { player: name, sessionToken: token });
}

async function dismissNotices(page: Page) {
    for (let guard = 0; guard < 5; guard += 1) {
        const briefing = page.getByRole('button', { name: /Close briefing/ }).last();
        if (await briefing.isVisible().catch(() => false)) {
            await briefing.click();
            continue;
        }
        const continueButton = page.getByRole('button', { name: /Continue/ }).last();
        if (await continueButton.isVisible().catch(() => false)) {
            await continueButton.click();
            continue;
        }
        const notice = page.getByRole('button', { name: /Got it/ }).last();
        if (!(await notice.isVisible().catch(() => false))) break;
        await notice.click();
    }
}

type Rect = { x: number; y: number; width: number; height: number; right: number; bottom: number };
type LayoutMeasurement = {
    viewport: { width: number; height: number };
    documentOverflow: number;
    root: Rect | null;
    layout: Rect | null;
    main: Rect | null;
    board: Rect | null;
    gridLayer: Rect | null;
    actions: Rect | null;
    tabs: Rect | null;
    log: Rect | null;
    dossiers: Rect[];
    gridTemplateColumns: string;
    gridTemplateRows: string;
    mainGridRowCount: number;
    visibleTileCount: number;
    allTilesNamed: boolean;
    tileCentersInsideBoard: boolean;
    tileCenterBounds: Rect | null;
    minCommandTouchTarget: number | null;
    boardActionOverlap: boolean;
    boardDossierOverlap: boolean;
};

async function measure(page: Page, rootSelector: string): Promise<LayoutMeasurement> {
    return page.evaluate((selector) => {
        const rect = (element: Element | null): Rect | null => {
            if (!element) return null;
            const value = element.getBoundingClientRect();
            if (value.width <= 0 || value.height <= 0) return null;
            return { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom };
        };
        const overlap = (a: Rect | null, b: Rect | null) => Boolean(a && b && a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y);
        const root = document.querySelector(selector);
        const layoutNode = root?.querySelector('.combat-layout') ?? null;
        const mainNode = root?.querySelector('.combat-main-area') ?? null;
        const boardNode = root?.querySelector('.hex-battlefield') ?? null;
        const actionNode = root?.querySelector('.combat-jutsu-bar') ?? null;
        const tabNode = root?.querySelector('.battle-tabbar') ?? null;
        const logNode = root?.querySelector('.combat-text-log') ?? null;
        const layoutRect = rect(layoutNode);
        const boardRect = rect(boardNode);
        const actionRect = rect(actionNode);
        const dossiers = [...(root?.querySelectorAll('.combat-side-hud') ?? [])].map(rect).filter((value): value is Rect => value !== null);
        const tiles = [...(root?.querySelectorAll<HTMLElement>('.hex-tile') ?? [])].filter((tile) => rect(tile));
        const tileCenters = tiles.map((tile) => {
            const value = tile.getBoundingClientRect();
            return { x: value.left + value.width / 2, y: value.top + value.height / 2 };
        });
        const tileCenterBounds = tileCenters.length ? {
            x: Math.min(...tileCenters.map((point) => point.x)),
            y: Math.min(...tileCenters.map((point) => point.y)),
            right: Math.max(...tileCenters.map((point) => point.x)),
            bottom: Math.max(...tileCenters.map((point) => point.y)),
            width: Math.max(...tileCenters.map((point) => point.x)) - Math.min(...tileCenters.map((point) => point.x)),
            height: Math.max(...tileCenters.map((point) => point.y)) - Math.min(...tileCenters.map((point) => point.y)),
        } : null;
        const tileCentersInsideBoard = Boolean(boardRect) && tileCenters.every(({ x, y }) =>
            x >= boardRect!.x - 1 && x <= boardRect!.right + 1 && y >= boardRect!.y - 1 && y <= boardRect!.bottom + 1);
        const commandButtons = [...(root?.querySelectorAll<HTMLElement>('.shinobi-command-bar button, .battle-tab') ?? [])]
            .map(rect).filter((value): value is Rect => value !== null);
        const style = layoutNode ? getComputedStyle(layoutNode) : null;
        const mainStyle = mainNode ? getComputedStyle(mainNode) : null;
        return {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
            root: rect(root),
            layout: layoutRect,
            main: rect(mainNode),
            board: boardRect,
            gridLayer: rect(root?.querySelector('.hex-grid-layer') ?? null),
            actions: actionRect,
            tabs: rect(tabNode),
            log: rect(logNode),
            dossiers,
            gridTemplateColumns: style?.gridTemplateColumns ?? '',
            gridTemplateRows: style?.gridTemplateRows ?? '',
            mainGridRowCount: (mainStyle?.gridTemplateRows ?? '').trim().split(/\s+/).filter(Boolean).length,
            visibleTileCount: tiles.length,
            allTilesNamed: tiles.every((tile) => Boolean(tile.getAttribute('aria-label')?.trim())),
            tileCentersInsideBoard,
            tileCenterBounds,
            minCommandTouchTarget: commandButtons.length ? Math.min(...commandButtons.map((value) => Math.min(value.width, value.height))) : null,
            boardActionOverlap: overlap(boardRect, actionRect),
            boardDossierOverlap: dossiers.some((value) => overlap(boardRect, value)),
        };
    }, rootSelector);
}

async function measureStable(page: Page, rootSelector: string): Promise<LayoutMeasurement> {
    let current = await measure(page, rootSelector);
    for (let attempt = 0; attempt < 4 && (!current.tileCentersInsideBoard || current.visibleTileCount !== 120); attempt += 1) {
        await page.waitForTimeout(180);
        current = await measure(page, rootSelector);
    }
    return current;
}

async function captureMatrix(page: Page, mode: 'solo' | 'pvp', rootSelector: string, testInfo: TestInfo) {
    const browser = testInfo.project.name.split('-')[0];
    const directory = resolve(SCREENSHOT_ROOT, mode, browser);
    await mkdir(directory, { recursive: true });
    const measurements: LayoutMeasurement[] = [];
    const zoomMeasurements: Array<{ zoomPercent: number; physicalViewport: { width: number; height: number }; measurement: LayoutMeasurement }> = [];
    const assertLayout = (current: LayoutMeasurement, label: string) => {
        expect(current.documentOverflow, `${label} horizontal overflow`).toBeLessThanOrEqual(1);
        expect(current.visibleTileCount, `${label} tile count`).toBe(120);
        expect(current.allTilesNamed, `${label} tile accessible names`).toBe(true);
        expect(current.tileCentersInsideBoard, `${label} tile centers`).toBe(true);
        expect(current.boardActionOverlap, `${label} action overlap`).toBe(false);
        expect(current.boardDossierOverlap, `${label} dossier overlap`).toBe(false);
        expect(current.minCommandTouchTarget ?? 0, `${label} touch target`).toBeGreaterThanOrEqual(44);
        expect(current.board?.height ?? 0, `${label} board must not collapse`).toBeGreaterThanOrEqual(90);
        expect(current.mainGridRowCount, `${label} unexpected implicit main-grid row`).toBe(7);
        expect((current.board?.width ?? 0) / Math.max(1, current.board?.height ?? 0), `${label} board aspect`).toBeCloseTo(1.6214, 2);
    };
    for (const [width, height] of ACTIVE_VIEWPORTS) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(180);
        const root = page.locator(rootSelector);
        await expect(root).toBeVisible();
        const current = await measureStable(page, rootSelector);
        measurements.push(current);
        if (browser === 'chromium') {
            await page.screenshot({ path: resolve(directory, `${width}x${height}.png`), animations: 'disabled', fullPage: false });
        }
        if (STRICT) {
            assertLayout(current, `${mode} ${width}x${height}`);
        }
    }
    await writeFile(resolve(directory, 'measurements.json'), `${JSON.stringify(measurements, null, 2)}\n`, 'utf8');
    for (const zoom of BROWSER_ZOOM_EQUIVALENTS) {
        await page.setViewportSize({ width: zoom.width, height: zoom.height });
        await page.waitForTimeout(180);
        const current = await measureStable(page, rootSelector);
        zoomMeasurements.push({
            zoomPercent: zoom.zoomPercent,
            physicalViewport: { width: 1440, height: 900 },
            measurement: current,
        });
        if (STRICT) assertLayout(current, `${mode} 1440x900 at ${zoom.zoomPercent}% zoom`);
    }
    await writeFile(resolve(directory, 'zoom-measurements.json'), `${JSON.stringify(zoomMeasurements, null, 2)}\n`, 'utf8');
}

test('Solo-PvE combat layout viewport matrix', async ({ page, request }, testInfo) => {
    const { name, token } = await seedAccount(request, testInfo, 'solo');
    await installSession(page, name, token);
    await page.goto('/#/missions', { waitUntil: 'networkidle' });
    await dismissNotices(page);
    const mission = page.locator('.mh-combat-card').filter({ hasText: 'E-Rank Drill' });
    await mission.getByRole('button', { name: /Begin Mission/ }).click();
    await expect(page.locator('.mission-arena-fight')).toBeVisible();
    const firstJutsu = page.locator('.mission-arena-fight .combat-jutsu-button:not(:disabled)').first();
    await expect(firstJutsu).toBeVisible();
    await firstJutsu.click();
    await expect(page.locator('.mission-arena-fight .combat-action-notice')).toBeVisible();
    await captureMatrix(page, 'solo', '.mission-arena-fight', testInfo);
});

test('PvP combat layout viewport matrix', async ({ page, request }, testInfo) => {
    const { name, token } = await seedAccount(request, testInfo, 'pvp');
    const opponent = `${safeProject(testInfo)}opponent`.slice(0, 20);
    await seedSave(request, opponent);
    await installSession(page, name, token);
    await page.goto('/#/village', { waitUntil: 'networkidle' });
    await dismissNotices(page);
    const created = await page.evaluate(async ({ p1, p2 }) => {
        const response = await fetch('/api/pvp/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ p1Character: { name: p1 }, p2Character: { name: p2 }, biome: 'central' }),
        });
        return { status: response.status, body: await response.json() };
    }, { p1: name, p2: opponent });
    expect(created.status).toBe(200);
    const battleId = String((created.body as { battleId?: string }).battleId ?? '');
    expect(battleId.length).toBeGreaterThan(10);
    await page.evaluate(({ id }) => {
        localStorage.setItem('pvpSession.v1', JSON.stringify({ pvpBattleId: id, pvpRole: 'p1', pvpBattleContext: { mode: 'standard' }, savedAt: Date.now() }));
        localStorage.setItem('lastScreen.v1', 'pvpBattle');
        history.replaceState(null, '', '#/pvpBattle');
    }, { id: battleId });
    // A hash-only page.goto is a same-document navigation, so startup restore
    // never runs. Reload the document after installing the breadcrumb to model
    // the real crash/refresh path.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await dismissNotices(page);
    await expect(page.locator('.pvp-countdown-overlay')).toBeHidden({ timeout: 10_000 });
    const battleVisible = await page.locator('.pvp-battle-layout').waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true, () => false);
    if (!battleVisible) {
        const debug = await page.evaluate(async (id) => {
            const response = await fetch(`/api/pvp/session?id=${encodeURIComponent(id)}`);
            return {
                hash: location.hash,
                breadcrumb: localStorage.getItem('pvpSession.v1'),
                lastScreen: localStorage.getItem('lastScreen.v1'),
                sessionStatus: response.status,
                sessionStatusValue: (await response.json().catch(() => null) as { status?: string } | null)?.status ?? null,
            };
        }, battleId);
        throw new Error(`PvP restore diagnostic: ${JSON.stringify(debug)}`);
    }
    await expect(page.locator('.pvp-battle-layout')).toBeVisible();
    await captureMatrix(page, 'pvp', '.pvp-battle-layout', testInfo);
});
