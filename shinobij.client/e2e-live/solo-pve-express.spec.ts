import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

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

type JsonResponse = { status: number; body: Record<string, unknown> };

const GRID_W = 12;
const GRID_H = 10;

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

async function seedAccount(request: APIRequestContext, testInfo: TestInfo) {
    const suffix = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
    const name = `live${suffix}${Date.now().toString(36)}`.toLowerCase();
    const password = 'LiveExpress!1234';
    const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password } });
    expect(registered.status()).toBe(200);
    const token = String((await registered.json()).token ?? '');
    expect(token.length).toBeGreaterThan(10);

    const character = {
        name,
        village: 'Ember',
        specialty: 'Ninjutsu',
        bloodline: 'None',
        level: 1,
        rankTitle: 'Academy Student',
        xp: 0,
        ryo: 100,
        unspentStats: 20,
        stats: {
            strength: 10, speed: 10, intelligence: 10, willpower: 10,
            bukijutsuOffense: 10, bukijutsuDefense: 10,
            taijutsuOffense: 10, taijutsuDefense: 10,
            genjutsuOffense: 10, genjutsuDefense: 10,
            ninjutsuOffense: 10, ninjutsuDefense: 10,
        },
        hp: 100, maxHp: 100,
        chakra: 100, maxChakra: 100,
        stamina: 100, maxStamina: 100,
        onboardingStep: 'done',
        inventory: ['rustfang-kunai', 'shinobi-vest'],
        itemStacks: [], equipment: {}, pets: [],
        jutsuMastery: [], equippedJutsuIds: [],
        pendingCombatMissionClaims: [],
        dailyMissionsCompleted: 0,
    };
    const seeded = await request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': 'live-express-e2e-admin' },
        data: { character, currentSector: 40, acceptedMissionIds: [], missionProgress: {}, triggeredEvents: [] },
    });
    expect(seeded.status()).toBe(200);
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

async function playToTerminal(page: Page, playerName: string, initial: Session): Promise<Session> {
    let session = initial;
    for (let turn = 0; turn < 180 && session.status !== 'done'; turn++) {
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
            moveToken: `live-${turn}-${session.version}`,
            ...intended,
        });
        let next = acted.body.session as Session | undefined;
        if (acted.status !== 200 || acted.body.applied === false) {
            const current = next ?? session;
            acted = await browserApi(page, '/api/solo-pve/action', {
                playerName,
                sessionId: session.sessionId,
                expectedVersion: current.version,
                moveToken: `live-wait-${turn}-${current.version}`,
                type: 'wait',
            });
            next = acted.body.session as Session | undefined;
        }
        expect(next, `turn ${turn} must return authoritative state`).toBeTruthy();
        session = next!;
    }
    return session;
}

test('real built client completes and recovers a server-owned combat mission', async ({ page, request }, testInfo) => {
    const runtimeErrors: string[] = [];
    const serverFailures: string[] = [];
    let navigationInProgress = false;
    page.on('pageerror', (error) => {
        // Chromium rejects fetches cancelled by our deliberate hard reload. The
        // response watcher below still fails every completed 5xx API request.
        if (navigationInProgress && error.message === 'Failed to fetch') return;
        runtimeErrors.push(error.message);
    });
    page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().includes('Failed to load resource')) runtimeErrors.push(message.text());
    });
    page.on('response', (response) => {
        if (response.url().includes('/api/') && response.status() >= 500) serverFailures.push(`${response.status()} ${response.url()}`);
    });
    const hardReload = async () => {
        navigationInProgress = true;
        try {
            await page.reload({ waitUntil: 'networkidle' });
        } finally {
            navigationInProgress = false;
        }
    };
    const dismissNotices = async () => {
        for (let guard = 0; guard < 3; guard++) {
            const notice = page.getByRole('button', { name: /Got it/ }).last();
            if (!(await notice.isVisible().catch(() => false))) break;
            await notice.click();
        }
    };

    const { name, token } = await seedAccount(request, testInfo);
    await installSession(page, name, token);
    await page.goto('/#/missions', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Mission Hall' })).toBeVisible();
    await dismissNotices();

    const mission = page.locator('.mh-combat-card').filter({ hasText: 'E-Rank Drill' });
    const startResponse = page.waitForResponse((response) => response.url().includes('/api/missions/combat-start') && response.request().method() === 'POST');
    await mission.getByRole('button', { name: /Begin Mission/ }).click();
    const startedHttp = await startResponse;
    expect(startedHttp.status()).toBe(200);
    const started = await startedHttp.json();
    const initial = started.session as Session;
    expect(initial.sessionId).toBe(started.runId);
    await expect(page.locator('.mission-arena-fight')).toBeVisible();

    const screenshotName = testInfo.project.name.includes('mobile') ? 'mission-mobile.png' : 'mission-desktop.png';
    await page.locator('.mission-arena-fight').screenshot({ path: `../docs/screenshots/solo-pve-cutover/${screenshotName}` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    const rejected = await browserApi(page, '/api/solo-pve/action', {
        playerName: name,
        sessionId: initial.sessionId,
        expectedVersion: initial.version,
        moveToken: 'live-invalid-out-of-range',
        type: 'basicAttack',
    });
    expect(rejected.body.applied).toBe(false);
    expect((rejected.body.session as Session).version).toBe(initial.version);

    const blocked = new Set(initial.environment.blockedTiles ?? []);
    const step = neighbors(initial.player.pos)
        .filter((tile) => tile !== initial.enemy.pos && !blocked.has(tile))
        .sort((a, b) => distance(a, initial.enemy.pos) - distance(b, initial.enemy.pos) || a - b)[0];
    const movement = {
        playerName: name,
        sessionId: initial.sessionId,
        expectedVersion: initial.version,
        moveToken: 'live-duplicate-move',
        type: 'move',
        tile: step,
    };
    const first = await browserApi(page, '/api/solo-pve/action', movement);
    expect(first.status).toBe(200);
    expect(first.body.applied).toBe(true);
    const moved = first.body.session as Session;
    const duplicate = await browserApi(page, '/api/solo-pve/action', movement);
    expect(duplicate.status).toBe(200);
    expect((duplicate.body.session as Session).version).toBe(moved.version);
    const stale = await browserApi(page, '/api/solo-pve/action', { ...movement, moveToken: 'live-stale-version' });
    expect(stale.status).toBe(409);
    expect((stale.body.session as Session).version).toBe(moved.version);

    await hardReload();
    await expect(page.getByRole('heading', { name: 'Mission Hall' })).toBeVisible();
    await dismissNotices();
    const resumedResponse = page.waitForResponse((response) => response.url().includes('/api/missions/combat-start') && response.request().method() === 'POST');
    await page.locator('.mh-combat-card').filter({ hasText: 'E-Rank Drill' }).getByRole('button', { name: /Begin Mission/ }).click();
    const resumed = await (await resumedResponse).json();
    expect(resumed.runId).toBe(initial.sessionId);

    const terminal = await playToTerminal(page, name, resumed.session as Session);
    expect(terminal.status).toBe('done');
    expect(terminal.winner).toBe('player');

    await hardReload();
    await expect(page.getByRole('heading', { name: 'Mission Hall' })).toBeVisible();
    await dismissNotices();
    const terminalResponse = page.waitForResponse((response) => response.url().includes('/api/missions/combat-start') && response.request().method() === 'POST');
    const settlementResponse = page.waitForResponse((response) => response.url().includes('/api/missions/queue-combat-claim') && response.request().method() === 'POST');
    await page.locator('.mh-combat-card').filter({ hasText: 'E-Rank Drill' }).getByRole('button', { name: /Begin Mission/ }).click();
    const terminalResume = await (await terminalResponse).json();
    expect(terminalResume.runId).toBe(initial.sessionId);
    await expect(page.getByRole('heading', { name: 'Victory!' })).toBeVisible();
    await expect(page.getByText(/Return to the Mission Hall to claim your reward/)).toBeVisible();
    const settled = await (await settlementResponse).json();
    expect(settled.queued).toBe(true);
    const resultName = testInfo.project.name.includes('mobile') ? 'mission-result-mobile.png' : 'mission-result-desktop.png';
    await page.locator('.mission-arena-fight').screenshot({ path: `../docs/screenshots/solo-pve-cutover/${resultName}` });

    const replaySettle = await browserApi(page, '/api/missions/queue-combat-claim', {
        playerName: name,
        missionId: 'combat-e-drill',
        runId: initial.sessionId,
    });
    expect(replaySettle.status).toBe(200);
    expect(replaySettle.body.queued).toBe(false);
    expect(replaySettle.body.reason).toBe('already-settled');

    expect(runtimeErrors).toEqual([]);
    expect(serverFailures).toEqual([]);
});
