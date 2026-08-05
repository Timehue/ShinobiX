import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

const PHASE = process.env.COMBAT_LAYOUT_CAPTURE_PHASE === 'before' ? 'before' : 'after';
const STRICT = PHASE === 'after' && process.env.COMBAT_LAYOUT_STRICT !== '0';
const SCREENSHOT_ROOT = resolve(process.cwd(), '..', 'docs', 'screenshots', 'combat-layout', PHASE);

const VIEWPORTS = [
    [320, 568], [360, 800], [375, 667], [390, 844], [412, 915], [430, 932],
    [667, 375], [800, 360], [844, 390], [932, 430],
    [768, 1024], [820, 1180], [1024, 768], [1180, 820],
    [1280, 720], [1366, 768], [1440, 900], [1536, 864], [1600, 900],
    [1920, 1080], [2560, 1440], [3440, 1440],
] as const;
const VIEWPORT_FILTER = process.env.COMBAT_LAYOUT_VIEWPORT;
const ACTIVE_VIEWPORTS = VIEWPORT_FILTER
    ? VIEWPORTS.filter(([width, height]) => `${width}x${height}` === VIEWPORT_FILTER)
    : VIEWPORTS;

// Browser zoom reduces the CSS viewport while the physical window stays fixed.
// These are the exact CSS viewport equivalents of 1440x900 at
// 80/100/125/150/200%. This is reflow-equivalent coverage, not a claim that
// Playwright controls each browser's native zoom UI.
const BROWSER_ZOOM_EQUIVALENTS = [
    { zoomPercent: 80, width: 1800, height: 1125 },
    { zoomPercent: 100, width: 1440, height: 900 },
    { zoomPercent: 125, width: 1152, height: 720 },
    { zoomPercent: 150, width: 960, height: 600 },
    { zoomPercent: 200, width: 720, height: 450 },
    { zoomPercent: 200, width: 512, height: 384, physicalWidth: 1024, physicalHeight: 768 },
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
    const segments = testInfo.project.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
    const [engine = 'test', ...qualifiers] = segments;
    return `${engine.slice(0, 3)}${qualifiers.join('').slice(0, 6)}`.slice(0, 9);
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
        inventory: ['rustfang-kunai', 'thrown-shuriken', 'potion-rejuvenation', 'potion-rejuvenation', 'consum-smoke-pellet'],
        itemStacks: [
            { itemId: 'thrown-shuriken', count: 1 },
            { itemId: 'potion-rejuvenation', count: 2 },
            { itemId: 'consum-smoke-pellet', count: 1 },
        ],
        equipment: { hand: 'rustfang-kunai', thrown: 'thrown-shuriken', potion: 'potion-rejuvenation', item: 'consum-smoke-pellet' },
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
    devicePixelRatio: number;
    documentOverflow: number;
    root: Rect | null;
    layout: Rect | null;
    main: Rect | null;
    boardStage: Rect | null;
    board: Rect | null;
    gridLayer: Rect | null;
    actions: Rect | null;
    tabs: Rect | null;
    log: Rect | null;
    dossiers: Rect[];
    dossierFlow: Array<{ dossier: number; display: string; columns: string; children: Array<{ className: string; gridColumn: string; gridRow: string; rect: Rect | null }> }>;
    gridTemplateColumns: string;
    gridTemplateRows: string;
    mainGridRowCount: number;
    mainGridTemplateColumns: string;
    mainGridTemplateRows: string;
    visibleTileCount: number;
    allTilesNamed: boolean;
    tileCentersInsideBoard: boolean;
    tileCentersHitTheirTile: boolean;
    tileCenterHitCount: number;
    tileCenterMisses: string[];
    dossierResourcesContained: boolean;
    dossierContentMisses: string[];
    firstJutsuCenterVisibleAndHit: boolean;
    firstJutsuCenterHit: string | null;
    firstJutsu: Rect | null;
    tileCenterBounds: Rect | null;
    minCommandTouchTarget: number | null;
    boardActionOverlap: boolean;
    boardDossierOverlap: boolean;
    terrainNoticeOverlap: boolean;
    dualApTextOverlap: boolean;
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
        const terrainNode = root?.querySelector('.twp-strip') ?? null;
        const noticeNode = root?.querySelector('.combat-action-notice') ?? null;
        const layoutRect = rect(layoutNode);
        const boardRect = rect(boardNode);
        const actionRect = rect(actionNode);
        const dossiers = [...(root?.querySelectorAll('.combat-side-hud') ?? [])].map(rect).filter((value): value is Rect => value !== null);
        const dossierFlow = [...(root?.querySelectorAll<HTMLElement>('.combat-side-hud') ?? [])].map((dossierNode, dossier) => ({
            dossier,
            display: getComputedStyle(dossierNode).display,
            columns: getComputedStyle(dossierNode).gridTemplateColumns,
            children: [...dossierNode.children].map((child) => ({
                className: (child as HTMLElement).className,
                gridColumn: getComputedStyle(child).gridColumn,
                gridRow: getComputedStyle(child).gridRow,
                rect: rect(child),
            })),
        }));
        const dossierContentMisses: string[] = [];
        const dossierResourcesContained = [...(root?.querySelectorAll('.combat-side-hud') ?? [])].every((dossier, dossierIndex) => {
            const dossierRect = dossier.getBoundingClientRect();
            return [...dossier.querySelectorAll('.resource-line, .combat-mobile-effects')].filter((resource) => {
                const style = getComputedStyle(resource);
                const value = resource.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && value.width > 0 && value.height > 0;
            }).every((resource) => {
                const resourceRect = resource.getBoundingClientRect();
                const contained = resourceRect.top >= dossierRect.top - 1 && resourceRect.bottom <= dossierRect.bottom + 1;
                if (!contained) dossierContentMisses.push(`${dossierIndex}:${resource.className}[${resourceRect.top.toFixed(1)},${resourceRect.bottom.toFixed(1)}] outside [${dossierRect.top.toFixed(1)},${dossierRect.bottom.toFixed(1)}]`);
                return contained;
            });
        });
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
        const tileCenterMisses: string[] = [];
        const tileCenterHits = tiles.map((tile) => {
            const value = tile.getBoundingClientRect();
            const hit = document.elementFromPoint(value.left + value.width / 2, value.top + value.height / 2);
            const accurate = hit === tile || Boolean(hit && tile.contains(hit));
            if (!accurate) tileCenterMisses.push(`${tile.dataset.tile ?? '?'}@${(value.left + value.width / 2).toFixed(1)},${(value.top + value.height / 2).toFixed(1)}=>${hit instanceof HTMLElement ? hit.className : hit?.nodeName ?? 'none'}`);
            return accurate;
        });
        const tileCenterHitCount = tileCenterHits.filter(Boolean).length;
        const tileCentersHitTheirTile = tileCenterHitCount === tiles.length;
        const commandButtons = [...(root?.querySelectorAll<HTMLElement>('.shinobi-command-bar button, .battle-tab') ?? [])]
            .map(rect).filter((value): value is Rect => value !== null);
        const firstJutsu = root?.querySelector<HTMLElement>('.combat-jutsu-button:not(:disabled)') ?? null;
        const firstJutsuRect = rect(firstJutsu);
        const firstJutsuHit = firstJutsuRect
            ? document.elementFromPoint(firstJutsuRect.x + firstJutsuRect.width / 2, firstJutsuRect.y + firstJutsuRect.height / 2)
            : null;
        const firstJutsuCenterVisibleAndHit = Boolean(
            firstJutsu && firstJutsuRect && actionRect
            && firstJutsuRect.y + firstJutsuRect.height / 2 >= actionRect.y
            && firstJutsuRect.y + firstJutsuRect.height / 2 <= actionRect.bottom
            && firstJutsuHit && (firstJutsuHit === firstJutsu || firstJutsu.contains(firstJutsuHit)),
        );
        const style = layoutNode ? getComputedStyle(layoutNode) : null;
        const mainStyle = mainNode ? getComputedStyle(mainNode) : null;
        const apTextRects = [...(root?.querySelectorAll<HTMLElement>('.dual-ap-panel > div > strong, .dual-ap-panel > div > small, .dual-ap-panel > .round-timer-display > small, .dual-ap-panel .round-timer-ring') ?? [])]
            .map(rect).filter((value): value is Rect => value !== null);
        const dualApTextOverlap = apTextRects.some((first, index) => apTextRects.slice(index + 1).some((second) => overlap(first, second)));
        return {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            devicePixelRatio: window.devicePixelRatio,
            documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
            root: rect(root),
            layout: layoutRect,
            main: rect(mainNode),
            boardStage: rect(root?.querySelector('.combat-board-stage') ?? null),
            board: boardRect,
            gridLayer: rect(root?.querySelector('.hex-grid-layer') ?? null),
            actions: actionRect,
            tabs: rect(tabNode),
            log: rect(logNode),
            dossiers,
            dossierFlow,
            gridTemplateColumns: style?.gridTemplateColumns ?? '',
            gridTemplateRows: style?.gridTemplateRows ?? '',
            mainGridRowCount: (mainStyle?.gridTemplateRows ?? '').trim().split(/\s+/).filter(Boolean).length,
            mainGridTemplateColumns: mainStyle?.gridTemplateColumns ?? '',
            mainGridTemplateRows: mainStyle?.gridTemplateRows ?? '',
            visibleTileCount: tiles.length,
            allTilesNamed: tiles.every((tile) => Boolean(tile.getAttribute('aria-label')?.trim())),
            tileCentersInsideBoard,
            tileCentersHitTheirTile,
            tileCenterHitCount,
            tileCenterMisses,
            dossierResourcesContained,
            dossierContentMisses,
            firstJutsuCenterVisibleAndHit,
            firstJutsuCenterHit: firstJutsuHit instanceof HTMLElement ? firstJutsuHit.className : firstJutsuHit?.nodeName ?? null,
            firstJutsu: firstJutsuRect,
            tileCenterBounds,
            minCommandTouchTarget: commandButtons.length ? Math.min(...commandButtons.map((value) => Math.min(value.width, value.height))) : null,
            boardActionOverlap: overlap(boardRect, actionRect),
            boardDossierOverlap: dossiers.some((value) => overlap(boardRect, value)),
            terrainNoticeOverlap: overlap(rect(terrainNode), rect(noticeNode)),
            dualApTextOverlap,
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

async function writeArtifactWithRetry(page: Page, path: string, data: string | Uint8Array): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
            await writeFile(path, data);
            return;
        } catch (error) {
            lastError = error;
            if (attempt < 5) await page.waitForTimeout(150 * (attempt + 1));
        }
    }
    throw lastError;
}

async function writeScreenshotWithRetry(page: Page, path: string): Promise<void> {
    const image = await page.screenshot({ animations: 'disabled', fullPage: false });
    await writeArtifactWithRetry(page, path, image);
}

async function assertEdgeActionPopovers(page: Page, rootSelector: string): Promise<void> {
    const root = page.locator(rootSelector);
    const helpButtons = root.locator('.combat-jutsu-help');
    await expect(helpButtons.first()).toBeVisible();
    const indices = await helpButtons.evaluateAll((buttons) => {
        const positioned = buttons.map((button, index) => ({ index, rect: button.getBoundingClientRect() }));
        const left = positioned.reduce((best, current) => current.rect.left < best.rect.left ? current : best);
        const right = positioned.reduce((best, current) => current.rect.right > best.rect.right ? current : best);
        return [...new Set([left.index, right.index])];
    });
    for (const [position, index] of indices.entries()) {
        const trigger = helpButtons.nth(index);
        const controlledId = await trigger.getAttribute('aria-controls');
        expect(controlledId, `edge action trigger ${index} must identify its portaled detail dialog`).toBeTruthy();
        await trigger.click();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        const popover = page.locator(`#${controlledId}`);
        await expect(popover).toBeVisible();
        await expect(popover).toHaveAttribute('role', 'dialog');
        await expect(popover).toHaveAttribute('aria-modal', 'true');
        const backdrop = popover.locator('..');
        await expect(backdrop).toHaveClass(/combat-detail-backdrop/);
        expect(await backdrop.evaluate((node) => document.elementFromPoint(2, 2) === node),
            `edge action popover ${index} must block the live battle surface`).toBe(true);
        await popover.locator('[data-combat-detail-close]').focus();
        await page.keyboard.press('Tab');
        await expect(popover.locator('[data-combat-detail-close]')).toBeFocused();
        expect(await popover.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            return rect.left >= -1 && rect.top >= -1
                && rect.right <= window.innerWidth + 1
                && rect.bottom <= window.innerHeight + 1;
        }), `edge action popover ${index} must stay within the viewport`).toBe(true);
        if (position === indices.length - 1) {
            await writeScreenshotWithRetry(page, resolve(SCREENSHOT_ROOT, 'pvp', 'chromium', '390x844-popover.png'));
            await page.keyboard.press('Escape');
            await expect(popover).toBeHidden();
            await expect(trigger).toHaveAttribute('aria-expanded', 'false');
            await expect(trigger).toBeFocused();
            continue;
        }
        await popover.locator('[data-combat-detail-close]').click();
        await expect(popover).toBeHidden();
    }

    const thrownTrigger = root.locator('#pvp-combat-detail-trigger-item-thrown-shuriken');
    await expect(thrownTrigger).toBeVisible();
    await thrownTrigger.click();
    await expect(thrownTrigger).toHaveAttribute('aria-expanded', 'true');
    const thrownDialog = page.locator('#pvp-combat-detail-item-thrown-shuriken');
    await expect(thrownDialog).toBeVisible();
    await expect(thrownDialog).toHaveAttribute('aria-labelledby', 'pvp-combat-detail-label-item-thrown-shuriken');
    await expect(thrownDialog.getByText('Thrown', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(thrownDialog).toBeHidden();
    await expect(thrownTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(thrownTrigger).toBeFocused();

    // The edge-control checks intentionally scroll the contained action tray
    // to its final equipment row. Restore the matrix's top-of-tray baseline so
    // the subsequent first-jutsu hit test measures layout, not test residue.
    await root.locator('.combat-jutsu-bar').evaluate((panel) => { panel.scrollTop = 0; });
}

async function captureMatrix(page: Page, mode: 'solo' | 'pvp', rootSelector: string, testInfo: TestInfo) {
    const browser = testInfo.project.name.includes('dpr')
        ? testInfo.project.name
        : testInfo.project.name.split('-')[0];
    const directory = resolve(SCREENSHOT_ROOT, mode, browser);
    await mkdir(directory, { recursive: true });
    const measurements: LayoutMeasurement[] = [];
    const zoomMeasurements: Array<{ zoomPercent: number; physicalViewport: { width: number; height: number }; measurement: LayoutMeasurement }> = [];
    const assertLayout = (current: LayoutMeasurement, label: string) => {
        expect(current.devicePixelRatio, `${label} device pixel ratio`).toBe(Number(testInfo.project.use.deviceScaleFactor ?? 1));
        expect(current.documentOverflow, `${label} horizontal overflow`).toBeLessThanOrEqual(1);
        expect(current.visibleTileCount, `${label} tile count`).toBe(120);
        expect(current.allTilesNamed, `${label} tile accessible names`).toBe(true);
        expect(current.tileCentersInsideBoard, `${label} tile centers`).toBe(true);
        expect(
            current.tileCenterHitCount,
            `${label} tile center hit-testing misses: ${current.tileCenterMisses.join(', ')}; main=${JSON.stringify(current.main)} stage=${JSON.stringify(current.boardStage)} board=${JSON.stringify(current.board)}`,
        ).toBe(current.visibleTileCount);
        expect(current.dossierResourcesContained, `${label} dossier resources clipped: ${current.dossierContentMisses.join(', ')}`).toBe(true);
        expect(current.boardActionOverlap, `${label} action overlap`).toBe(false);
        expect(current.boardDossierOverlap, `${label} dossier overlap`).toBe(false);
        expect(current.terrainNoticeOverlap, `${label} terrain/action-notice overlap`).toBe(false);
        expect(current.dualApTextOverlap, `${label} AP/timer labels overlap`).toBe(false);
        expect(current.minCommandTouchTarget ?? 0, `${label} touch target`).toBeGreaterThanOrEqual(44);
        expect(current.actions?.height ?? 0, `${label} selected action panel height`).toBeGreaterThanOrEqual(44);
        expect(current.firstJutsuCenterVisibleAndHit, `${label} first jutsu center inaccessible; hit=${current.firstJutsuCenterHit}`).toBe(true);
        expect(
            current.board?.height ?? 0,
            `${label} board must not collapse; stage=${JSON.stringify(current.boardStage)} rows=${current.mainGridTemplateRows}`,
        ).toBeGreaterThanOrEqual(90);
        const shortLandscape = current.viewport.width >= 480 && current.viewport.height <= 500;
        expect(current.mainGridRowCount, `${label} unexpected implicit main-grid row`).toBe(shortLandscape ? 4 : 7);
        expect((current.board?.width ?? 0) / Math.max(1, current.board?.height ?? 0), `${label} board aspect`).toBeCloseTo(1.6214, 2);
    };
    for (const [width, height] of ACTIVE_VIEWPORTS) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(180);
        const root = page.locator(rootSelector);
        await expect(root).toBeVisible();
        await page.evaluate((selector) => {
            for (const dossier of document.querySelectorAll(`${selector} .combat-side-hud`)) {
                if (!dossier.querySelector('.resource-line--shield')) {
                    const shield = document.createElement('div');
                    shield.className = 'resource-line resource-line--shield';
                    shield.dataset.layoutFixture = 'shield';
                    shield.innerHTML = '<span class="resource-label">Shield <small>1500</small></span><div class="hud-bar shield-bar"><span style="width:100%"></span></div>';
                    dossier.querySelector('.combat-mobile-effects')?.before(shield);
                    if (!shield.isConnected) dossier.append(shield);
                }
                let effects = dossier.querySelector<HTMLElement>('.combat-mobile-effects');
                if (!effects) {
                    effects = document.createElement('div');
                    effects.className = 'combat-mobile-effects';
                    effects.dataset.layoutFixture = 'effects';
                    effects.setAttribute('aria-label', 'Active effects');
                    dossier.append(effects);
                }
                if (!effects.querySelector('.cme-chip')) {
                    effects.innerHTML = '<span class="cme-chip cme-pos">Guard<small>25% 3r</small></span><span class="cme-chip cme-neg">Burn<small>10% 2r</small></span><span class="cme-chip cme-more">+5</span>';
                }
            }
        }, rootSelector);
        if (browser === 'chromium' && mode === 'pvp' && width === 390 && height === 844) {
            await assertEdgeActionPopovers(page, rootSelector);
        }
        const current = await measureStable(page, rootSelector);
        measurements.push(current);
        if (browser === 'chromium') {
            await writeScreenshotWithRetry(page, resolve(directory, `${width}x${height}.png`));
        }
        if (STRICT) {
            assertLayout(current, `${mode} ${width}x${height}`);
        }
    }
    await writeArtifactWithRetry(page, resolve(directory, 'measurements.json'), `${JSON.stringify(measurements, null, 2)}\n`);
    for (const zoom of BROWSER_ZOOM_EQUIVALENTS) {
        await page.setViewportSize({ width: zoom.width, height: zoom.height });
        await page.waitForTimeout(180);
        const current = await measureStable(page, rootSelector);
        const physicalViewport = {
            width: 'physicalWidth' in zoom ? zoom.physicalWidth : 1440,
            height: 'physicalHeight' in zoom ? zoom.physicalHeight : 900,
        };
        zoomMeasurements.push({
            zoomPercent: zoom.zoomPercent,
            physicalViewport,
            measurement: current,
        });
        if (browser.startsWith('chromium') && zoom.zoomPercent === 200) {
            await writeScreenshotWithRetry(page, resolve(directory, `${physicalViewport.width}x${physicalViewport.height}-at-200-percent.png`));
        }
        if (STRICT) assertLayout(current, `${mode} ${physicalViewport.width}x${physicalViewport.height} at ${zoom.zoomPercent}% zoom`);
    }
    await writeArtifactWithRetry(page, resolve(directory, 'zoom-measurements.json'), `${JSON.stringify(zoomMeasurements, null, 2)}\n`);
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
