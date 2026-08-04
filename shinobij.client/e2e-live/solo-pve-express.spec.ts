import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

type Session = {
    sessionId: string;
    version: number;
    status: 'active' | 'done';
    winner: 'player' | 'enemy' | 'draw' | null;
    outcome?: 'win' | 'loss' | 'fled' | 'draw' | null;
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
    const journey = testInfo.title.includes('flee') ? 'flee' : 'win';
    const name = `live${suffix}${journey}`;
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
    return { name, token, password };
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

async function browserGet(page: Page, path: string): Promise<JsonResponse> {
    return page.evaluate(async (endpoint) => {
        const response = await fetch(endpoint);
        return { status: response.status, body: await response.json().catch(() => ({})) };
    }, path);
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

    const { name, token, password } = await seedAccount(request, testInfo);
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
    let settlementRequestCount = 0;
    let resolveLostCommit!: (body: Record<string, unknown>) => void;
    let resolveRecoveredRetry!: (body: Record<string, unknown>) => void;
    const lostCommit = new Promise<Record<string, unknown>>((resolve) => { resolveLostCommit = resolve; });
    const recoveredRetry = new Promise<Record<string, unknown>>((resolve) => { resolveRecoveredRetry = resolve; });
    await page.route('**/api/missions/queue-combat-claim', async (route) => {
        settlementRequestCount += 1;
        if (settlementRequestCount === 1) {
            const committed = await route.fetch();
            resolveLostCommit(await committed.json() as Record<string, unknown>);
            await route.abort('failed');
            return;
        }
        if (settlementRequestCount === 2) {
            const recovered = await route.fetch();
            const recoveredBody = await recovered.json() as Record<string, unknown>;
            resolveRecoveredRetry(recoveredBody);
            await route.fulfill({
                status: recovered.status(),
                headers: recovered.headers(),
                body: JSON.stringify(recoveredBody),
            });
            return;
        }
        await route.continue();
    });
    await page.locator('.mh-combat-card').filter({ hasText: 'E-Rank Drill' }).getByRole('button', { name: /Begin Mission/ }).click();
    const terminalResume = await (await terminalResponse).json();
    expect(terminalResume.runId).toBe(initial.sessionId);
    await expect(page.getByRole('heading', { name: 'Victory!' })).toBeVisible();
    await expect(page.getByText(/Return to the Mission Hall to claim your reward/)).toBeVisible();
    const firstSettle = await lostCommit;
    expect(firstSettle.queued).toBe(true);
    const retrySettle = await recoveredRetry;
    expect(retrySettle.queued).toBe(true);
    expect(retrySettle.replayed).toBe(true);
    const resultName = testInfo.project.name.includes('mobile') ? 'mission-result-mobile.png' : 'mission-result-desktop.png';
    await page.locator('.mission-arena-fight').screenshot({ path: `../docs/screenshots/solo-pve-cutover/${resultName}` });

    const replaySettle = await browserApi(page, '/api/missions/queue-combat-claim', {
        playerName: name,
        missionId: 'combat-e-drill',
        runId: initial.sessionId,
    });
    expect(replaySettle.status).toBe(200);
    expect(replaySettle.body.queued).toBe(true);
    expect(replaySettle.body.replayed).toBe(true);

    await page.getByRole('button', { name: /Return to Mission Hall/ }).click();
    await expect(page.getByRole('heading', { name: 'Mission Hall' })).toBeVisible();
    const claimableMission = page.locator('.mh-combat-card').filter({ hasText: 'E-Rank Drill' });
    await expect(claimableMission.getByRole('button', { name: /Claim Reward/ })).toBeVisible();
    const claimResponse = page.waitForResponse((response) => response.url().includes('/api/missions/claim-mission') && response.request().method() === 'POST');
    await claimableMission.getByRole('button', { name: /Claim Reward/ }).click();
    const claimed = await (await claimResponse).json() as Record<string, unknown>;
    expect(claimed.applied).toBe(true);

    const persisted = await browserGet(page, `/api/save/${name}`);
    expect(persisted.status).toBe(200);
    const persistedCharacter = persisted.body.character as Record<string, unknown>;
    expect(Number(persistedCharacter.ryo)).toBeGreaterThan(100);
    expect(Number(persistedCharacter.hp)).toBe(Math.max(1, Number(terminal.player.hp)));
    expect((persistedCharacter.serverSettlementReceipts as Array<{ value?: { kind?: string; runId?: string } }> ?? [])
        .some((receipt) => receipt.value?.kind === 'pve-outcome' && receipt.value.runId === initial.sessionId)).toBe(true);
    expect((persistedCharacter.pendingCombatMissionClaims as unknown[] ?? []).map(String)).not.toContain('combat-e-drill');
    expect(Number(persistedCharacter.dailyMissionsCompleted)).toBe(1);

    await hardReload();
    const refreshed = await browserGet(page, `/api/save/${name}`);
    expect(Number((refreshed.body.character as Record<string, unknown>).ryo)).toBe(Number(persistedCharacter.ryo));

    const relogin = await request.post('/api/player-auth', { data: { action: 'verify', name, password } });
    expect(relogin.status()).toBe(200);
    const reloginToken = String((await relogin.json()).token ?? '');
    const reloggedPage = await page.context().newPage();
    await installSession(reloggedPage, name, reloginToken);
    await reloggedPage.goto('/#/missions', { waitUntil: 'networkidle' });
    const relogged = await browserGet(reloggedPage, `/api/save/${name}`);
    expect(relogged.status).toBe(200);
    expect(Number((relogged.body.character as Record<string, unknown>).ryo)).toBe(Number(persistedCharacter.ryo));
    await reloggedPage.close();

    expect(runtimeErrors).toEqual([]);
    expect(serverFailures).toEqual([]);
});

test('real built client records a flee without queueing a mission reward', async ({ page, request }, testInfo) => {
    const runtimeErrors: string[] = [];
    const serverFailures: string[] = [];
    let navigationInProgress = false;
    page.on('pageerror', (error) => {
        if (navigationInProgress && error.message === 'Failed to fetch') return;
        runtimeErrors.push(error.message);
    });
    page.on('response', (response) => {
        if (response.url().includes('/api/') && response.status() >= 500) serverFailures.push(`${response.status()} ${response.url()}`);
    });

    const { name, token } = await seedAccount(request, testInfo);
    await installSession(page, name, token);
    await page.goto('/#/missions', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Mission Hall' })).toBeVisible();
    for (let guard = 0; guard < 3; guard++) {
        const notice = page.getByRole('button', { name: /Got it/ }).last();
        if (!(await notice.isVisible().catch(() => false))) break;
        await notice.click();
    }

    const mission = page.locator('.mh-combat-card').filter({ hasText: 'E-Rank Drill' });
    const startResponse = page.waitForResponse((response) => response.url().includes('/api/missions/combat-start') && response.request().method() === 'POST');
    await mission.getByRole('button', { name: /Begin Mission/ }).click();
    const started = await (await startResponse).json() as { runId: string; session: Session };
    let terminal = started.session;
    let fleeAttempts = 0;
    while (terminal.status === 'active' && fleeAttempts < 20) {
        const fled = await browserApi(page, '/api/solo-pve/action', {
            playerName: name,
            sessionId: started.runId,
            expectedVersion: terminal.version,
            moveToken: `live-flee-${fleeAttempts}`,
            type: 'flee',
        });
        expect(fled.status).toBe(200);
        expect(fled.body.applied).toBe(true);
        terminal = fled.body.session as Session;
        fleeAttempts += 1;
    }
    expect(fleeAttempts).toBeGreaterThan(0);
    expect(terminal.status).toBe('done');
    expect(['fled', 'loss']).toContain(terminal.outcome);

    // The terminal action route reconciles the physical outcome before it
    // acknowledges completion. Assert the exact combat remainder here, before
    // the ordinary one-HP-per-second village regeneration resumes.
    const immediatelySettled = await browserGet(page, `/api/save/${name}`);
    const immediatelySettledCharacter = immediatelySettled.body.character as Record<string, unknown>;
    if (terminal.player.hp <= 0) {
        expect(immediatelySettledCharacter.hospitalized).toBe(true);
        expect(Number(immediatelySettledCharacter.hp)).toBe(0);
    } else {
        expect(Number(immediatelySettledCharacter.hp)).toBe(Math.max(1, Number(terminal.player.hp)));
    }
    expect((immediatelySettledCharacter.serverSettlementReceipts as Array<{ value?: { kind?: string; runId?: string } }> ?? [])
        .some((receipt) => receipt.value?.kind === 'pve-outcome' && receipt.value.runId === started.runId)).toBe(true);

    navigationInProgress = true;
    try {
        await page.reload({ waitUntil: 'networkidle' });
    } finally {
        navigationInProgress = false;
    }
    await expect(page.getByRole('heading', { name: 'Mission Hall' })).toBeVisible();
    let outcomeRequestCount = 0;
    let resolveLostOutcome!: (body: Record<string, unknown>) => void;
    let resolveRecoveredOutcome!: (body: Record<string, unknown>) => void;
    const lostOutcome = new Promise<Record<string, unknown>>((resolve) => { resolveLostOutcome = resolve; });
    const recoveredOutcome = new Promise<Record<string, unknown>>((resolve) => { resolveRecoveredOutcome = resolve; });
    await page.route('**/api/pve/fight-outcome', async (route) => {
        outcomeRequestCount += 1;
        const response = await route.fetch();
        const body = await response.json() as Record<string, unknown>;
        if (outcomeRequestCount === 1) {
            resolveLostOutcome(body);
            await route.abort('failed');
            return;
        }
        if (outcomeRequestCount === 2) resolveRecoveredOutcome(body);
        await route.fulfill({
            status: response.status(),
            headers: response.headers(),
            body: JSON.stringify(body),
        });
    });
    const resumedResponse = page.waitForResponse((response) => response.url().includes('/api/missions/combat-start') && response.request().method() === 'POST');
    await page.locator('.mh-combat-card').filter({ hasText: 'E-Rank Drill' }).getByRole('button', { name: /Begin Mission/ }).click();
    expect((await (await resumedResponse).json()).runId).toBe(started.runId);
    await expect(page.getByRole('heading', { name: 'Defeat' })).toBeVisible();
    expect((await lostOutcome).replayed).toBe(true);
    expect((await recoveredOutcome).replayed).toBe(true);
    expect(outcomeRequestCount).toBe(2);

    const refusedClaim = await browserApi(page, '/api/missions/queue-combat-claim', {
        playerName: name,
        missionId: 'combat-e-drill',
        runId: started.runId,
    });
    expect(refusedClaim.body.queued).toBe(false);
    expect(refusedClaim.body.reason).toBe('not-won');
    const persisted = await browserGet(page, `/api/save/${name}`);
    const character = persisted.body.character as Record<string, unknown>;
    expect(Number(character.ryo)).toBe(100);
    if (terminal.player.hp <= 0) {
        expect(character.hospitalized).toBe(true);
        expect(Number(character.hp)).toBe(0);
    } else {
        // A reload plus the injected retry takes long enough for normal village
        // regeneration to tick. It may raise HP, but must never resurrect the
        // player to the newly-derived maximum as the old load normalizer did.
        expect(Number(character.hp)).toBeGreaterThanOrEqual(Math.max(1, Number(terminal.player.hp)));
        expect(Number(character.hp)).toBeLessThan(Number(character.maxHp));
    }
    expect((character.serverSettlementReceipts as Array<{ value?: { kind?: string; runId?: string } }> ?? [])
        .some((receipt) => receipt.value?.kind === 'pve-outcome' && receipt.value.runId === started.runId)).toBe(true);
    expect(Array.isArray(character.pendingCombatMissionClaims) ? character.pendingCombatMissionClaims : []).not.toContain('combat-e-drill');
    await page.getByRole('button', { name: /Return to Mission Hall/ }).click();
    await expect(page.getByRole('heading', { name: 'Mission Hall' })).toBeVisible();

    expect(runtimeErrors).toEqual([]);
    expect(serverFailures).toEqual([]);
});
