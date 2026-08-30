import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

type Session = {
    sessionId: string;
    version: number;
    status: 'active' | 'done';
    winner: 'player' | 'enemy' | 'draw' | null;
    outcome?: 'win' | 'loss' | 'fled' | 'draw' | null;
    activeSide: 'player' | 'enemy';
    player: { pos: number; hp: number; maxHp: number; character?: { jutsu?: Array<{ id?: string }> } };
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

async function seedAccount(request: APIRequestContext, testInfo: TestInfo, options: { hp?: number; equipFlicker?: boolean } = {}) {
    const suffix = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
    const journey = testInfo.title.toLowerCase().includes('flee')
        ? 'flee'
        : testInfo.title.toLowerCase().includes('flicker') ? 'flicker' : 'win';
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
        hp: options.hp ?? 100, maxHp: 100,
        chakra: 100, maxChakra: 100,
        stamina: 100, maxStamina: 100,
        onboardingStep: 'done',
        inventory: ['rustfang-kunai', 'shinobi-vest'],
        itemStacks: [], equipment: {}, pets: [],
        jutsuMastery: options.equipFlicker
            ? [{ jutsuId: 'starter-universal-flicker', level: 1, xp: 0 }]
            : [],
        equippedJutsuIds: options.equipFlicker ? ['starter-universal-flicker'] : [],
        pendingCombatMissionClaims: [],
        dailyMissionsCompleted: 0,
    };
    // This brand-new disposable account has no mounted client to reload. Setting
    // signal=1 here would make its first heartbeat report forceReload and create
    // an artificial protected-draft conflict during a later hospital/reload path.
    const seedRequest = () => request.post(`/api/save/${name}`, {
        headers: { 'x-admin-password': 'live-express-e2e-admin' },
        data: { character, currentSector: 40, acceptedMissionIds: [], missionProgress: {}, triggeredEvents: [] },
    });
    let seeded = await seedRequest();
    if (seeded.status() === 429) {
        // Adjacent project cases share the loopback-IP save-burst bucket. Keep the
        // production guard enabled and honor its exact retry hint instead of making
        // suite speed determine whether this disposable admin seed is admitted.
        const limited = await seeded.json().catch(() => ({})) as Record<string, unknown>;
        const hintedDelay = Number(limited.retryAfterMs);
        const retryAfterMs = Number.isFinite(hintedDelay)
            ? Math.min(5_000, Math.max(0, hintedDelay))
            : 3_100;
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs + 100));
        seeded = await seedRequest();
    }
    expect(seeded.status()).toBe(200);
    const canonicalResponse = await request.get(`/api/save/${name}`, {
        headers: { 'x-player-name': name, 'x-player-token': token },
    });
    expect(canonicalResponse.status()).toBe(200);
    const canonical = await canonicalResponse.json() as Record<string, unknown> & {
        character: Record<string, unknown>;
        _saveVersion: number;
    };
    expect(Number.isSafeInteger(canonical._saveVersion)).toBe(true);
    const requestedHp = options.hp ?? Number(canonical.character.hp);
    const exactSeedPayload: Record<string, unknown> = {
        ...canonical,
        character: { ...canonical.character, hp: requestedHp },
        _baseSaveVersion: canonical._saveVersion,
    };
    delete exactSeedPayload._saveVersion;
    delete exactSeedPayload._saveAt;
    const exactSeed = await request.post(`/api/save/${name}`, {
        headers: { 'x-player-name': name, 'x-player-token': token },
        data: exactSeedPayload,
    });
    expect(exactSeed.status()).toBe(200);
    const exactSeedAcknowledgement = await exactSeed.json() as Record<string, unknown>;
    expect(exactSeedAcknowledgement.ok).toBe(true);
    expect(Number(exactSeedAcknowledgement._saveVersion)).toBeGreaterThan(canonical._saveVersion);
    const exactSeedVerification = await request.get(`/api/save/${name}`, {
        headers: { 'x-player-name': name, 'x-player-token': token },
    });
    expect(exactSeedVerification.status()).toBe(200);
    const exactSnapshot = await exactSeedVerification.json() as Record<string, unknown> & {
        character: Record<string, unknown>;
        _saveVersion: number;
    };
    expect(exactSnapshot._saveVersion).toBe(exactSeedAcknowledgement._saveVersion);
    expect(Number(exactSnapshot.character.hp)).toBe(requestedHp);
    expect(Number(exactSnapshot.character.hp)).toBeLessThanOrEqual(Number(exactSnapshot.character.maxHp));
    const heartbeat = await request.post('/api/player/heartbeat', {
        headers: { 'x-player-name': name, 'x-player-token': token },
        data: { name, sector: 40, character: { name, level: 1, village: 'Ember' } },
    });
    expect(heartbeat.status()).toBe(200);
    expect((await heartbeat.json()).forceReload).not.toBe(true);
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

async function openMissionHall(page: Page): Promise<void> {
    let networkChangedChunk = false;
    const onRequestFailed = (request: import('@playwright/test').Request) => {
        const url = new URL(request.url());
        const appOrigin = new URL(request.frame().url() === 'about:blank' ? request.url() : request.frame().url()).origin;
        if (
            url.origin === appOrigin
            && /^\/assets\/[^/]+\.js$/.test(url.pathname)
            && request.failure()?.errorText === 'net::ERR_NETWORK_CHANGED'
        ) networkChangedChunk = true;
    };
    page.on('requestfailed', onRequestFailed);
    try {
        await page.goto('/#/missions', { waitUntil: 'networkidle' });
        const hall = page.getByRole('heading', { name: 'Mission Hall' });
        if (!(await hall.isVisible().catch(() => false)) && networkChangedChunk) {
            networkChangedChunk = false;
            await page.reload({ waitUntil: 'networkidle' });
        }
        await expect(hall).toBeVisible();
    } finally {
        page.off('requestfailed', onRequestFailed);
    }
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

async function fleeThroughVisibleMissionClient(
    page: Page,
    playerName: string,
    runId: string,
    initial: Session,
): Promise<{ session: Session; character: Record<string, unknown>; saveVersion: number }> {
    // The visible client must own these actions. Calling /solo-pve/action from
    // page.evaluate leaves MissionArenaFight on its pre-action session, so its
    // terminal outcome effect never replays /pve/fight-outcome and never adopts
    // the authoritative character + save version before a reload.
    const outcomeResponsePromise = page.waitForResponse((response) =>
        response.url().includes('/api/pve/fight-outcome')
        && response.request().method() === 'POST',
    );
    let session = initial;
    let attempts = 0;
    while (session.status === 'active' && attempts < 20) {
        const actionResponsePromise = page.waitForResponse((response) =>
            response.url().includes('/api/solo-pve/action')
            && response.request().method() === 'POST',
        );
        await page.getByRole('button', { name: /^Flee\b/ }).click();
        const actionResponse = await actionResponsePromise;
        expect(actionResponse.status()).toBe(200);
        const request = actionResponse.request().postDataJSON() as Record<string, unknown>;
        expect(request.playerName).toBe(playerName);
        expect(request.sessionId).toBe(runId);
        expect(request.type).toBe('flee');
        expect(request.expectedVersion).toBe(session.version);
        const result = await actionResponse.json() as { applied?: boolean; session?: Session };
        expect(result.applied).toBe(true);
        expect(result.session).toBeTruthy();
        session = result.session!;
        attempts += 1;
    }
    expect(attempts).toBeGreaterThan(0);
    expect(session.status).toBe('done');

    // Terminal action reconciliation is already durable on the server. The UI's
    // explicit outcome request must replay that receipt, then atomically adopt
    // its full character + version just like the production component does.
    const outcomeResponse = await outcomeResponsePromise;
    expect(outcomeResponse.status()).toBe(200);
    const outcome = await outcomeResponse.json() as Record<string, unknown>;
    expect(outcome.ok).toBe(true);
    expect(outcome.replayed).toBe(true);
    expect(outcome.character).toBeTruthy();
    const authoritativeCharacter = outcome.character as Record<string, unknown>;
    const adoptedVersion = Number(outcome._saveVersion);
    expect(Number.isSafeInteger(adoptedVersion)).toBe(true);
    expect(adoptedVersion).toBeGreaterThan(0);

    // Prove the App adopted the pair, rather than merely observing the HTTP
    // response: its next successful full save must echo that version (or newer)
    // as the optimistic-concurrency base before this test is allowed to reload.
    const adoptionSaveResponse = await page.waitForResponse(async (response) => {
        const url = new URL(response.url());
        if (
            url.pathname !== `/api/save/${playerName.toLowerCase()}`
            || url.search !== ''
            || response.request().method() !== 'POST'
            || response.status() !== 200
        ) return false;
        const payload = response.request().postDataJSON() as Record<string, unknown>;
        if (Number(payload._baseSaveVersion) < adoptedVersion) return false;
        const acknowledgement = await response.json().catch(() => null) as Record<string, unknown> | null;
        return acknowledgement?.ok === true
            && Number.isSafeInteger(Number(acknowledgement._saveVersion))
            && Number(acknowledgement._saveVersion) >= adoptedVersion;
    }, { timeout: 20_000 });
    const adoptionSave = await adoptionSaveResponse.json() as Record<string, unknown>;
    expect(Number(adoptionSave._saveVersion)).toBeGreaterThanOrEqual(adoptedVersion);
    return { session, character: authoritativeCharacter, saveVersion: adoptedVersion };
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

test('real built mission combat casts Flicker through a highlighted destination', async ({ page, request }, testInfo) => {
    const runtimeErrors: string[] = [];
    const serverFailures: string[] = [];
    page.on('pageerror', (error) => {
        runtimeErrors.push(error.message);
    });
    page.on('console', (message) => {
        // Chromium also prints a generic resource-load line for an HTTP error;
        // the response watcher below captures the useful status and URL.
        if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
            runtimeErrors.push(message.text());
        }
    });
    page.on('response', (response) => {
        if (response.url().includes('/api/') && response.status() >= 500) {
            serverFailures.push(`${response.status()} ${response.url()}`);
        }
    });

    const { name, token } = await seedAccount(request, testInfo, { equipFlicker: true });
    await installSession(page, name, token);
    await page.goto('/#/missions', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Mission Hall' })).toBeVisible();
    const notice = page.getByRole('button', { name: /Got it/ }).last();
    if (await notice.isVisible().catch(() => false)) await notice.click();

    const mission = page.locator('.mh-combat-card').filter({ hasText: 'E-Rank Drill' });
    const startResponse = page.waitForResponse((response) => response.url().includes('/api/missions/combat-start') && response.request().method() === 'POST');
    await mission.getByRole('button', { name: /Begin Mission/ }).click();
    const startedHttp = await startResponse;
    expect(startedHttp.status()).toBe(200);
    const started = await startedHttp.json();
    const initial = started.session as Session;
    expect(initial.player.character?.jutsu?.map((jutsu) => jutsu.id)).toContain('starter-universal-flicker');
    await expect(page.locator('.mission-arena-fight')).toBeVisible();

    const flickerButton = page.locator('button.combat-jutsu-button[title^="Flicker |"]');
    await expect(flickerButton).toBeVisible();
    await flickerButton.click();
    await expect(flickerButton).toHaveClass(/selected-action/);

    const highlightedTiles = page.locator('button.hex-tile.dash-target-tile');
    await expect(highlightedTiles.first()).toBeVisible();
    const legalDestinations = await highlightedTiles.evaluateAll((tiles) => tiles
        .map((tile) => Number(tile.getAttribute('data-tile')))
        .filter(Number.isInteger));
    const destination = legalDestinations
        .sort((a, b) => distance(b, initial.enemy.pos) - distance(a, initial.enemy.pos))[0];
    expect(Number.isInteger(destination)).toBe(true);
    expect(distance(initial.player.pos, destination)).toBeLessThanOrEqual(5);
    expect(distance(destination, initial.enemy.pos)).toBeGreaterThan(1);
    const highlightedDestination = page.locator(`button.hex-tile.dash-target-tile[data-tile="${destination}"]`);

    const flickerResponse = page.waitForResponse((response) => {
        if (!response.url().includes('/api/solo-pve/action') || response.request().method() !== 'POST') return false;
        const action = response.request().postDataJSON() as Record<string, unknown>;
        return action.type === 'jutsu';
    });
    await highlightedDestination.click();
    const flickerHttp = await flickerResponse;
    const flickerRequest = flickerHttp.request().postDataJSON() as Record<string, unknown>;
    expect(flickerRequest.jutsuId).toBe('starter-universal-flicker');
    expect(flickerRequest.tile).toBe(destination);
    expect(flickerHttp.status()).toBe(200);
    const flickerResult = await flickerHttp.json() as Record<string, unknown>;
    expect(flickerResult.error).not.toBe('Internal server error.');
    expect(flickerResult.applied).toBe(true);
    const flickered = flickerResult.session as Session;
    expect(flickered.version).toBe(initial.version + 1);
    expect(flickered.player.pos).toBe(destination);
    await expect(page.getByText('Internal server error.', { exact: true })).toHaveCount(0);
    expect(runtimeErrors).toEqual([]);
    expect(serverFailures).toEqual([]);
});

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

    // Begin below max so this scenario always exercises surviving-HP authority;
    // the E-rank opponent can deterministically lose without landing a hit.
    const { name, token, password } = await seedAccount(request, testInfo, { hp: 20 });
    await installSession(page, name, token);
    await openMissionHall(page);
    await dismissNotices();

    const mission = page.locator('.mh-combat-card').filter({ hasText: 'E-Rank Drill' });
    const startResponse = page.waitForResponse((response) => response.url().includes('/api/missions/combat-start') && response.request().method() === 'POST');
    await mission.getByRole('button', { name: /Begin Mission/ }).click();
    const startedHttp = await startResponse;
    expect(startedHttp.status()).toBe(200);
    const started = await startedHttp.json();
    const initial = started.session as Session;
    expect(initial.sessionId).toBe(started.runId);
    expect(initial.player.hp).toBeLessThan(initial.player.maxHp);
    await expect(page.locator('.mission-arena-fight')).toBeVisible();

    const screenshotName = testInfo.project.name.includes('mobile') ? 'mission-mobile.png' : 'mission-desktop.png';
    await page.locator('.mission-arena-fight').screenshot({ path: testInfo.outputPath(screenshotName) });
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
    expect(terminal.player.hp).toBeLessThan(terminal.player.maxHp);

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
    const firstSettledCharacter = firstSettle.character as Record<string, unknown>;
    expect(Number(firstSettledCharacter.hp)).toBeGreaterThanOrEqual(Number(terminal.player.hp));
    expect(Number(firstSettledCharacter.hp)).toBeLessThan(Number(firstSettledCharacter.maxHp));
    const retrySettle = await recoveredRetry;
    expect(retrySettle.queued).toBe(true);
    expect(retrySettle.replayed).toBe(true);
    expect(retrySettle._saveVersion).toBe(firstSettle._saveVersion);
    expect(Number((retrySettle.character as Record<string, unknown>).hp)).toBe(Number(firstSettledCharacter.hp));
    const resultName = testInfo.project.name.includes('mobile') ? 'mission-result-mobile.png' : 'mission-result-desktop.png';
    await page.locator('.mission-arena-fight').screenshot({ path: testInfo.outputPath(resultName) });

    const replaySettle = await browserApi(page, '/api/missions/queue-combat-claim', {
        playerName: name,
        missionId: 'combat-e-drill',
        runId: initial.sessionId,
    });
    expect(replaySettle.status).toBe(200);
    expect(replaySettle.body.queued).toBe(true);
    expect(replaySettle.body.replayed).toBe(true);
    expect(replaySettle.body._saveVersion).toBe(firstSettle._saveVersion);
    expect(Number((replaySettle.body.character as Record<string, unknown>).hp)).toBe(Number(firstSettledCharacter.hp));

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
    // Settlement recovery, reward claiming, and the injected lost-response retry
    // take long enough for ordinary village regeneration to tick. The physical
    // remainder may rise, but it must survive and must never become a free refill.
    expect(Number(persistedCharacter.hp)).toBeGreaterThanOrEqual(Math.max(1, Number(terminal.player.hp)));
    expect(Number(persistedCharacter.hp)).toBeLessThan(Number(persistedCharacter.maxHp));
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

    // A full-health flee can regenerate its fixed 10% escape cost during the
    // reload/retry window. Start low enough that every replay still has a real,
    // observable physical remainder without changing production combat rules.
    const { name, token } = await seedAccount(request, testInfo, { hp: 20 });
    await installSession(page, name, token);
    await openMissionHall(page);
    for (let guard = 0; guard < 3; guard++) {
        const notice = page.getByRole('button', { name: /Got it/ }).last();
        if (!(await notice.isVisible().catch(() => false))) break;
        await notice.click();
    }

    const mission = page.locator('.mh-combat-card').filter({ hasText: 'E-Rank Drill' });
    const startResponse = page.waitForResponse((response) => response.url().includes('/api/missions/combat-start') && response.request().method() === 'POST');
    await mission.getByRole('button', { name: /Begin Mission/ }).click();
    const started = await (await startResponse).json() as { runId: string; session: Session };
    expect(started.session.player.hp).toBe(20);
    expect(started.session.player.hp).toBeLessThan(started.session.player.maxHp);
    const authoritativeOutcome = await fleeThroughVisibleMissionClient(page, name, started.runId, started.session);
    const terminal = authoritativeOutcome.session;
    expect(['fled', 'loss']).toContain(terminal.outcome);

    // Assert the exact physical remainder at the authoritative acknowledgement
    // boundary. A later full-save wait intentionally allows ordinary village
    // regeneration to tick, but it may never erase or refill this combat cost.
    const authoritativeHp = Number(authoritativeOutcome.character.hp);
    const authoritativeReceipts = (authoritativeOutcome.character.serverSettlementReceipts as Array<Record<string, unknown> & { value?: { kind?: string; runId?: string } }> ?? [])
        .filter((receipt) => receipt.value?.kind === 'pve-outcome' && receipt.value.runId === started.runId);
    expect(authoritativeReceipts).toHaveLength(1);
    if (terminal.player.hp <= 0) {
        expect(authoritativeOutcome.character.hospitalized).toBe(true);
        expect(authoritativeHp).toBe(0);
    } else {
        expect(authoritativeHp).toBe(Math.max(1, Number(terminal.player.hp)));
    }
    expect(authoritativeHp).toBeLessThan(Number(authoritativeOutcome.character.maxHp));

    // The terminal action route reconciles the physical outcome before it
    // acknowledges completion. After the proven client adoption/full-save above,
    // regeneration may have advanced HP, but the same receipt and cost survive.
    const immediatelySettled = await browserGet(page, `/api/save/${name}`);
    const immediatelySettledCharacter = immediatelySettled.body.character as Record<string, unknown>;
    const immediatelySettledVersion = Number(immediatelySettled.body._saveVersion);
    const immediateHp = Number(immediatelySettledCharacter.hp);
    const immediateReceipts = (immediatelySettledCharacter.serverSettlementReceipts as Array<Record<string, unknown> & { value?: { kind?: string; runId?: string } }> ?? [])
        .filter((receipt) => receipt.value?.kind === 'pve-outcome' && receipt.value.runId === started.runId);
    expect(Number.isSafeInteger(immediatelySettledVersion)).toBe(true);
    expect(immediatelySettledVersion).toBeGreaterThanOrEqual(authoritativeOutcome.saveVersion);
    expect(immediateReceipts).toHaveLength(1);
    expect(immediateReceipts[0]).toEqual(authoritativeReceipts[0]);
    if (terminal.player.hp <= 0) {
        expect(immediatelySettledCharacter.hospitalized).toBe(true);
        expect(immediateHp).toBe(0);
    } else {
        expect(immediateHp).toBeGreaterThanOrEqual(authoritativeHp);
    }
    expect(immediateHp).toBeLessThan(Number(immediatelySettledCharacter.maxHp));

    navigationInProgress = true;
    try {
        await page.reload({ waitUntil: 'networkidle' });
    } finally {
        navigationInProgress = false;
    }
    // A failed flee can legitimately end in a KO. The server then redirects
    // the refreshed client to Hospital until the authoritative admission timer
    // releases the player. Exercise that real recovery path instead of assuming
    // every flee leaves enough HP to return directly to Mission Hall.
    const hospital = page.getByRole('heading', { name: 'Village Hospital' });
    let dischargedAuthority: {
        saveVersion: number;
        hp: number;
        maxHp: number;
        receipt: Record<string, unknown>;
    } | null = null;
    if (await hospital.isVisible().catch(() => false)) {
        await expect(hospital).toBeHidden({ timeout: 70_000 });
        const discharged = await browserGet(page, `/api/save/${name}`);
        expect(discharged.status).toBe(200);
        const dischargedCharacter = discharged.body.character as Record<string, unknown>;
        const dischargedVersion = Number(discharged.body._saveVersion);
        const dischargedHp = Number(dischargedCharacter.hp);
        const dischargedMaxHp = Number(dischargedCharacter.maxHp);
        const dischargedReceipts = (dischargedCharacter.serverSettlementReceipts as Array<Record<string, unknown> & { value?: { kind?: string; runId?: string } }> ?? [])
            .filter((receipt) => receipt.value?.kind === 'pve-outcome' && receipt.value.runId === started.runId);
        expect(Number.isSafeInteger(dischargedVersion)).toBe(true);
        expect(dischargedVersion).toBeGreaterThan(immediatelySettledVersion);
        expect(dischargedCharacter.hospitalized).toBe(false);
        expect(dischargedHp).toBe(dischargedMaxHp);
        expect(dischargedReceipts).toHaveLength(1);
        expect(dischargedReceipts[0]).toEqual(immediateReceipts[0]);
        dischargedAuthority = {
            saveVersion: dischargedVersion,
            hp: dischargedHp,
            maxHp: dischargedMaxHp,
            receipt: dischargedReceipts[0],
        };

        // Hospital discharge returns the real client to Village. Continue through
        // the same visible navigation a player uses; changing only location.hash
        // does not dispatch this app's screen transition after boot.
        const enterMissionHall = page.getByRole('button', { name: 'Enter Mission Hall' });
        await expect(enterMissionHall).toBeVisible();
        await enterMissionHall.click();
    }
    await expect(page.getByRole('heading', { name: 'Mission Hall' })).toBeVisible();
    const refusedTerminalClaim = await browserApi(page, '/api/missions/queue-combat-claim', {
        playerName: name,
        missionId: 'combat-e-drill',
        runId: started.runId,
    });
    expect(refusedTerminalClaim.body.queued).toBe(false);
    expect(refusedTerminalClaim.body.reason).toBe('not-won');

    // A loss or flee is physically settled before this screen returns. Retrying
    // must retire that terminal authority and mint a fresh unpaid attempt; only
    // terminal WINS remain resumable so their claim can be queued exactly once.
    const retryResponse = page.waitForResponse((response) => response.url().includes('/api/missions/combat-start') && response.request().method() === 'POST');
    await page.locator('.mh-combat-card').filter({ hasText: 'E-Rank Drill' }).getByRole('button', { name: /Begin Mission/ }).click();
    const retry = await (await retryResponse).json() as { runId: string; resumed: boolean; session: Session };
    expect(retry.runId).not.toBe(started.runId);
    expect(retry.resumed).toBe(false);
    expect(retry.session.sessionId).toBe(retry.runId);
    expect(retry.session.status).toBe('active');
    await expect(page.locator('.mission-arena-fight')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Defeat' })).toBeHidden();

    const retiredClaim = await browserApi(page, '/api/missions/queue-combat-claim', {
        playerName: name,
        missionId: 'combat-e-drill',
        runId: started.runId,
    });
    expect(retiredClaim.body.queued).toBe(false);
    expect(retiredClaim.body.reason).toBe('invalid-binding');
    const persisted = await browserGet(page, `/api/save/${name}`);
    const character = persisted.body.character as Record<string, unknown>;
    expect(Number(character.ryo)).toBe(100);
    if (dischargedAuthority) {
        expect(character.hospitalized).toBe(false);
        expect(Number(character.hp)).toBe(dischargedAuthority.hp);
        expect(Number(character.maxHp)).toBe(dischargedAuthority.maxHp);
    } else if (terminal.player.hp <= 0) {
        expect(character.hospitalized).toBe(true);
        expect(Number(character.hp)).toBe(0);
    } else {
        // A reload plus the injected retry takes long enough for normal village
        // regeneration to tick. It may raise HP, but must never resurrect the
        // player to the newly-derived maximum as the old load normalizer did.
        expect(Number(character.hp)).toBeGreaterThanOrEqual(Math.max(1, Number(terminal.player.hp), immediateHp));
        expect(Number(character.hp)).toBeLessThan(Number(character.maxHp));
    }
    const finalReceipts = (character.serverSettlementReceipts as Array<Record<string, unknown> & { value?: { kind?: string; runId?: string } }> ?? [])
        .filter((receipt) => receipt.value?.kind === 'pve-outcome' && receipt.value.runId === started.runId);
    expect(finalReceipts).toHaveLength(1);
    expect(finalReceipts[0]).toEqual(immediateReceipts[0]);
    expect(Array.isArray(character.pendingCombatMissionClaims) ? character.pendingCombatMissionClaims : []).not.toContain('combat-e-drill');

    expect(runtimeErrors).toEqual([]);
    expect(serverFailures).toEqual([]);
});
