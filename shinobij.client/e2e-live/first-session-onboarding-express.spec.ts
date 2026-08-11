import { expect, test, type Page } from '@playwright/test';

type Session = {
    sessionId: string;
    version: number;
    status: 'active' | 'done';
    winner: 'player' | 'enemy' | 'draw' | null;
    activeSide: 'player' | 'enemy';
    player: { pos: number; hp: number };
    enemy: { pos: number; hp: number };
    environment: { blockedTiles: number[] };
};

type SaveRecord = {
    _saveVersion?: number;
    currentSector?: number;
    activeTraining?: { token?: string; endsAt?: number } | null;
    character?: {
        name?: string;
        onboardingStep?: string;
        activePetId?: string;
        pets?: Array<{ id?: string }>;
        jutsuMastery?: Array<{ jutsuId?: string; level?: number }>;
        equippedJutsuIds?: string[];
        inventory?: string[];
        equipment?: Record<string, string | undefined>;
        academySparClaimed?: boolean;
        academyTrialClaimed?: boolean;
        academySectorVisited?: boolean;
    };
};

type JsonResponse = { status: number; body: Record<string, unknown> };

const GRID_W = 12;
const GRID_H = 10;
const FLICKER_ID = 'starter-universal-flicker';

function neighbors(pos: number): number[] {
    const x = pos % GRID_W;
    const y = Math.floor(pos / GRID_W);
    const deltas = x % 2 === 0
        ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
        : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return deltas
        .map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
        .filter((tile) => tile.x >= 0 && tile.x < GRID_W && tile.y >= 0 && tile.y < GRID_H)
        .map((tile) => tile.y * GRID_W + tile.x);
}

function distance(a: number, b: number): number {
    const axial = (pos: number) => {
        const x = pos % GRID_W;
        const y = Math.floor(pos / GRID_W);
        return { q: x, r: y - ((x - (x & 1)) / 2) };
    };
    const first = axial(a);
    const second = axial(b);
    return (
        Math.abs(first.q - second.q)
        + Math.abs(first.q + first.r - second.q - second.r)
        + Math.abs(first.r - second.r)
    ) / 2;
}

async function browserApi(page: Page, path: string, body: Record<string, unknown>): Promise<JsonResponse> {
    return page.evaluate(async ({ endpoint, payload }) => {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        return { status: response.status, body: await response.json().catch(() => ({})) };
    }, { endpoint: path, payload: body });
}

async function readSave(page: Page, playerName: string): Promise<{ status: number; body: SaveRecord }> {
    return page.evaluate(async (name) => {
        const response = await fetch(`/api/save/${encodeURIComponent(name.toLowerCase())}`);
        return { status: response.status, body: await response.json().catch(() => ({})) as SaveRecord };
    }, playerName);
}

async function waitForPersisted(
    page: Page,
    playerName: string,
    predicate: (save: SaveRecord) => boolean,
    message: string,
): Promise<SaveRecord> {
    let latest: SaveRecord = {};
    await expect.poll(async () => {
        const response = await readSave(page, playerName);
        latest = response.body;
        return response.status === 200 && predicate(latest);
    }, { message, timeout: 25_000 }).toBe(true);
    return latest;
}

async function playToTerminal(page: Page, playerName: string, initial: Session): Promise<Session> {
    let session = initial;
    for (let turn = 0; turn < 180 && session.status !== 'done'; turn += 1) {
        const adjacent = distance(session.player.pos, session.enemy.pos) <= 1;
        const blocked = new Set(session.environment.blockedTiles ?? []);
        const nextTile = neighbors(session.player.pos)
            .filter((tile) => tile !== session.enemy.pos && !blocked.has(tile))
            .sort((a, b) => distance(a, session.enemy.pos) - distance(b, session.enemy.pos) || a - b)[0];
        const intended = adjacent ? { type: 'basicAttack' } : { type: 'move', tile: nextTile };
        let acted = await browserApi(page, '/api/solo-pve/action', {
            playerName,
            sessionId: session.sessionId,
            expectedVersion: session.version,
            moveToken: `onboarding-${turn}-${session.version}`,
            ...intended,
        });
        let next = acted.body.session as Session | undefined;
        if (acted.status !== 200 || acted.body.applied === false) {
            const current = next ?? session;
            acted = await browserApi(page, '/api/solo-pve/action', {
                playerName,
                sessionId: session.sessionId,
                expectedVersion: current.version,
                moveToken: `onboarding-wait-${turn}-${current.version}`,
                type: 'wait',
            });
            next = acted.body.session as Session | undefined;
        }
        expect(next, `onboarding spar turn ${turn} must return authoritative state`).toBeTruthy();
        session = next!;
    }
    return session;
}

async function dismissNotice(page: Page, expectedMessage: string | RegExp) {
    const notice = page.getByRole('alertdialog', { name: 'Notice' });
    await expect(notice).toBeVisible();
    await expect(notice.locator('.game-alert-message')).toHaveText(expectedMessage);
    await notice.getByRole('button', { name: 'OK' }).click();
    await expect(notice).toBeHidden();
}

async function createCharacter(page: Page, playerName: string, password: string) {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByTestId('start-create').click();
    await page.getByRole('button', { name: 'Choose Village' }).click();
    await page.locator('.cc-village-card').first().click();
    await page.getByRole('button', { name: 'Choose Bloodline' }).click();
    await page.locator('.cc-bloodline-card').first().click();
    await page.getByRole('button', { name: 'Choose Avatar' }).click();
    await page.locator('.cc-avatar-card').first().click();
    await page.getByRole('button', { name: 'Preview Shinobi' }).click();
    await page.getByRole('button', { name: 'Name and Password' }).click();
    await page.getByLabel('Name').fill(playerName);
    await page.locator('#cc-password').fill(password);
    await page.locator('#cc-confirm-password').fill(password);

    const firstSave = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname.toLowerCase() === `/api/save/${playerName.toLowerCase()}`);
    await page.getByRole('button', { name: 'Enter the World' }).click();
    expect((await firstSave).status()).toBe(200);
    await expect(page.locator('.icx-root')).toBeVisible();
}

test('a new player completes the full persisted Academy first session against built Express', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop-live', 'one desktop run covers the full first-session authority journey');

    const playerName = `Journey${Date.now().toString(36).slice(-7)}`;
    const password = 'Journey!Pass1234';
    const runtimeErrors: string[] = [];
    const serverFailures: string[] = [];
    let navigationInProgress = false;
    page.on('pageerror', (error) => {
        if (navigationInProgress && error.message === 'Failed to fetch') return;
        runtimeErrors.push(error.message);
    });
    page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
            runtimeErrors.push(message.text());
        }
    });
    page.on('response', (response) => {
        if (response.url().includes('/api/') && response.status() >= 500) {
            serverFailures.push(`${response.status()} ${new URL(response.url()).pathname}`);
        }
    });
    const hardReload = async () => {
        navigationInProgress = true;
        try {
            await page.reload({ waitUntil: 'networkidle' });
        } finally {
            navigationInProgress = false;
        }
    };

    await createCharacter(page, playerName, password);

    // The cinematic can be fast-forwarded, but the canonical companion grant
    // remains mandatory and is committed through its dedicated server endpoint.
    await page.getByRole('button', { name: /^Skip/ }).click();
    await expect(page.getByRole('heading', { name: 'Choose Your Companion' })).toBeVisible();
    const firstPet = page.locator('.icx-pet-card').first();
    const petName = (await firstPet.locator('.icx-pet-name').innerText()).trim();
    await firstPet.click();
    await page.getByRole('button', { name: `Take ${petName}` }).click();
    await page.getByRole('button', { name: /^Skip/ }).click();
    await expect(page.locator('.icx-root.is-companion')).toBeVisible();
    await page.getByRole('button', { name: /^Skip/ }).click();
    await expect(page.getByRole('button', { name: 'Go to Training Grounds' })).toBeVisible();
    await waitForPersisted(page, playerName, (save) => (
        save.character?.onboardingStep === 'training'
        && save.character?.pets?.length === 1
        && Boolean(save.character.activePetId)
    ), 'the selected companion and training handoff must persist');

    await page.getByRole('button', { name: 'Go to Training Grounds' }).click();
    await expect(page.getByRole('heading', { name: 'Training Grounds' })).toBeVisible();
    const trainingResponse = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/training/start');
    await page.getByRole('button', { name: /Start 15 Minutes/ }).click();
    expect((await trainingResponse).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Go to Jutsu Training' })).toBeVisible();
    await waitForPersisted(page, playerName, (save) => (
        save.character?.onboardingStep === 'jutsu'
        && Boolean(save.activeTraining?.token)
    ), 'stat training and the jutsu handoff must persist');

    // A hard reload at the first server-backed milestone proves the tutorial
    // resumes from durable state instead of a component-only sequence.
    await hardReload();
    await expect(page.getByRole('button', { name: 'Go to Jutsu Training' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to Jutsu Training' }).click();
    await expect(page.getByRole('heading', { name: 'Jutsu Training Hall' })).toBeVisible();
    const jutsuList = page.getByRole('listbox', { name: 'Choose Jutsu' });
    await jutsuList.getByText('Flicker', { exact: true }).click();
    const jutsuResponse = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/training/jutsu-ryo');
    await page.getByRole('button', { name: 'Unlock Level 1 (Free)' }).click();
    expect((await jutsuResponse).status()).toBe(200);
    await dismissNotice(page, 'Flicker unlocked at level 1 for free!');
    await expect(page.getByRole('button', { name: 'Open Profile' })).toBeVisible();
    await waitForPersisted(page, playerName, (save) => (
        save.character?.onboardingStep === 'jutsuLoadout'
        && save.character.jutsuMastery?.some((entry) => entry.jutsuId === FLICKER_ID && Number(entry.level) >= 1) === true
    ), 'the free Flicker unlock and loadout handoff must persist');

    await page.getByRole('button', { name: 'Open Profile' }).click();
    await page.locator('.profile-mobile-tabs').getByRole('button', { name: 'Jutsu' }).click();
    await page.getByRole('tab', { name: /Learned Jutsu/ }).click();
    await page.getByRole('searchbox', { name: 'Search jutsu' }).fill('Flicker');
    await page.getByRole('button', { name: 'Equip Flicker' }).click();
    await expect(page.getByRole('button', { name: 'Open Inventory' })).toBeVisible();
    await waitForPersisted(page, playerName, (save) => (
        save.character?.onboardingStep === 'inventory'
        && save.character.equippedJutsuIds?.includes(FLICKER_ID) === true
    ), 'the four-jutsu loadout and inventory handoff must persist');

    await page.getByRole('button', { name: 'Open Inventory' }).click();
    for (const itemName of ['Rustfang Kunai', 'Shinobi Vest']) {
        await page.locator('.backpack-item').filter({ hasText: itemName }).click();
        const itemDialog = page.getByRole('dialog', { name: `${itemName} item details` });
        await expect(itemDialog).toBeVisible();
        await itemDialog.getByRole('button', { name: /^Equip to / }).click();
    }
    await expect(page.getByRole('button', { name: 'Begin Your First Spar' })).toBeVisible();
    await waitForPersisted(page, playerName, (save) => (
        save.character?.onboardingStep === 'academySpar'
        && Object.values(save.character.equipment ?? {}).includes('rustfang-kunai')
        && Object.values(save.character.equipment ?? {}).includes('shinobi-vest')
    ), 'both starter gear items and the spar handoff must persist');

    const sparStart = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/story/spar-start');
    await page.getByRole('button', { name: 'Begin Your First Spar' }).click();
    const sparStartHttp = await sparStart;
    expect(sparStartHttp.status()).toBe(200);
    const started = await sparStartHttp.json() as { runId: string; session: Session };
    expect(started.session.sessionId).toBe(started.runId);
    await expect(page.locator('.mission-arena-fight')).toBeVisible();

    const terminal = await playToTerminal(page, playerName, started.session);
    expect(terminal.status).toBe('done');
    expect(terminal.winner).toBe('player');

    // The browser still holds the opening frame. One ordinary UI action gets a
    // stale-version response carrying the final authoritative session, proving
    // the arena recovers rather than relying on test-only state injection.
    const settleResponse = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/story/settle');
    await page.getByRole('button', { name: /^Wait/ }).click();
    const sparResult = page.getByRole('dialog', { name: 'Sparring match won' });
    await expect(sparResult).toBeVisible();
    expect((await settleResponse).status()).toBe(200);
    await expect(sparResult).toContainText(/stat points/);
    await sparResult.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('button', { name: 'Go to Cafeteria' })).toBeVisible();
    await waitForPersisted(page, playerName, (save) => (
        save.character?.onboardingStep === 'cafeteria'
        && save.character.academySparClaimed === true
    ), 'the sealed spar reward and recovery handoff must persist');

    await page.getByRole('button', { name: 'Go to Cafeteria' }).click();
    await expect(page.getByRole('heading', { name: 'Cafeteria' })).toBeVisible();
    const cafeteriaResponse = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/player/cafeteria');
    await page.getByRole('button', { name: /Feast/ }).click();
    expect((await cafeteriaResponse).status()).toBe(200);
    await dismissNotice(page, 'Feast restored your resources.');
    await expect(page.getByRole('button', { name: 'Go to Mission Hall' })).toBeVisible();
    await waitForPersisted(page, playerName, (save) => save.character?.onboardingStep === 'firstMission',
        'full recovery and the mission handoff must persist');

    await page.getByRole('button', { name: 'Go to Mission Hall' }).click();
    await expect(page.getByRole('heading', { name: 'Mission Hall' })).toBeVisible();
    const missionResponse = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/missions/claim-mission');
    await page.getByRole('button', { name: 'Claim Academy Trial Reward' }).click();
    expect((await missionResponse).status()).toBe(200);
    await dismissNotice(page, /^Academy Trial complete!/);
    await expect(page.getByRole('button', { name: 'Open Logbook' })).toBeVisible();
    await waitForPersisted(page, playerName, (save) => (
        save.character?.onboardingStep === 'logbook'
        && save.character.academyTrialClaimed === true
    ), 'the Academy Trial reward and Logbook handoff must persist');

    await page.getByRole('button', { name: 'Open Logbook' }).click();
    await expect(page.getByRole('heading', { name: 'Logbook' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open World Map' })).toBeVisible();

    // The long authority journey runs once, but its final navigation/recovery
    // seam deliberately switches to the canonical 390x844 viewport. This pairs
    // the stateful desktop coverage with the same inspect-before-travel and
    // critical mobile-control contract exercised by adaptive-shell.spec.ts.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open World Map' }).click();
    await expect(page.locator('.anime-world-map')).toBeVisible();
    const storageNotice = page.getByRole('button', { name: 'Got it' });
    if (await storageNotice.isVisible().catch(() => false)) await storageNotice.click();
    let travelPosts = 0;
    page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/player/travel') travelPosts += 1;
    });
    await page.getByRole('button', { name: 'Stormveil', exact: true }).click();
    const sectorMarker = page.getByRole('button', { name: 'Inspect Harbor Gates (Sector 1)' });
    await sectorMarker.click();
    const sectorInspector = page.getByRole('dialog', { name: 'Harbor Gates' });
    await expect(sectorInspector).toBeVisible();
    expect(travelPosts, 'inspecting a mobile map sector must not start travel').toBe(0);
    const travelResponse = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/player/travel');
    await sectorInspector.getByRole('button', { name: 'Travel to Sector 1' }).click();
    expect((await travelResponse).status()).toBe(200);
    expect(travelPosts).toBe(1);
    await expect(page.getByRole('button', { name: 'Return to Village' })).toBeVisible();
    await page.getByRole('button', { name: 'Return to Village' }).click();

    const completed = await waitForPersisted(page, playerName, (save) => {
        const character = save.character;
        return character?.onboardingStep === 'done'
            && character.pets?.length === 1
            && Boolean(character.activePetId)
            && Boolean(save.activeTraining?.token)
            && character.jutsuMastery?.some((entry) => entry.jutsuId === FLICKER_ID && Number(entry.level) >= 1) === true
            && character.equippedJutsuIds?.includes(FLICKER_ID) === true
            && Object.values(character.equipment ?? {}).includes('rustfang-kunai')
            && Object.values(character.equipment ?? {}).includes('shinobi-vest')
            && character.academySparClaimed === true
            && character.academyTrialClaimed === true
            && character.academySectorVisited === true;
    }, 'the complete first-session contract must persist');
    expect(Number(completed._saveVersion)).toBeGreaterThan(0);
    expect(completed.currentSector).toBe(0);

    await hardReload();
    await expect(page.locator('.icx-root')).toHaveCount(0);
    await expect(page.locator('.onboarding-coach-banner')).toHaveCount(0);
    await expect(page.locator('.stormveil-village-screen')).toBeVisible();
    await expect(page.locator('.mobile-bottom-nav')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

    // A second session must recover through the real auth path, not merely from
    // React state or a warm browser refresh.
    await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'Menu', exact: true }).click();
    const mobileMenu = page.getByRole('dialog', { name: 'Shinobi menu' });
    await expect(mobileMenu).toBeVisible();
    const logoutSave = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname.toLowerCase() === `/api/save/${playerName.toLowerCase()}`);
    await mobileMenu.getByRole('button', { name: 'Logout + Save' }).click();
    expect((await logoutSave).status()).toBe(200);
    await expect(page.getByTestId('start-create')).toBeVisible();

    await page.locator('.landing-topnav').getByRole('button', { name: 'Log In', exact: true }).click();
    await page.getByLabel('Name').fill(playerName);
    await page.getByPlaceholder('Enter your password').fill(password);
    const loginSave = page.waitForResponse((response) => response.request().method() === 'GET'
        && new URL(response.url()).pathname.toLowerCase() === `/api/save/${playerName.toLowerCase()}`);
    await page.getByRole('button', { name: 'Enter Village' }).click();
    expect((await loginSave).status()).toBe(200);
    await expect(page.locator('.stormveil-village-screen')).toBeVisible();
    await expect(page.locator('.icx-root')).toHaveCount(0);
    await expect(page.locator('.onboarding-coach-banner')).toHaveCount(0);
    await waitForPersisted(page, playerName, (save) => (
        save.character?.onboardingStep === 'done'
        && save.character.academySparClaimed === true
        && save.character.academyTrialClaimed === true
        && Boolean(save.activeTraining?.token)
    ), 'a real logout/login must restore the completed Academy session');
    expect(runtimeErrors).toEqual([]);
    expect(serverFailures).toEqual([]);
});
