import { expect, test, type Page } from '@playwright/test';
import { openLandingLogin } from '../e2e/helpers/landing-navigation';

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
        level?: number;
        stats?: Record<string, number>;
        onboardingStep?: string;
        activePetId?: string;
        pets?: Array<{ id?: string }>;
        jutsuMastery?: Array<{ jutsuId?: string; level?: number }>;
        equippedJutsuIds?: string[];
        inventory?: string[];
        equipment?: Record<string, string | undefined>;
        academySparClaimed?: boolean;
        academyTrialClaimed?: boolean;
        academyIncidentSeen?: boolean;
        academySectorVisited?: boolean;
        academyTraceSector?: number;
        academyFieldSeal?: boolean;
        firstContract?: { source?: string; route?: string; completedAt?: number; acknowledgedAt?: number };
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
    // Observe persistence without advancing the player's save-version stream.
    // Owner GETs can settle elapsed state and make the app's pending retry stale.
    const response = await page.request.get(`/api/save/${encodeURIComponent(playerName.toLowerCase())}`, {
        headers: { 'x-admin-password': 'live-express-e2e-admin' },
        // A keep-alive socket may close between persistence polls. Retry only
        // that transport reset; HTTP failures and the durable predicate still fail.
        maxRetries: 2,
    });
    return { status: response.status(), body: await response.json().catch(() => ({})) as SaveRecord };
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

// Full motion on purpose. This journey asserts that the WebGL world backdrops
// (.sector-scene-3d, .scene-ambience-3d) never bind pointer listeners, and those
// layers only mount when reduced motion is off (SectorScene3D.tsx,
// SceneAmbience3D.tsx). Under the suite's reduced motion that check would pass
// with nothing mounted to check.
test.use({ contextOptions: { reducedMotion: 'no-preference' } });

for (const grantDelayMs of [0, 500]) {
test(`a new player completes the full persisted Academy first session against built Express (starter response delay ${grantDelayMs}ms)`, async ({ page }, testInfo) => {
    const completeRealTraining = process.env.JOURNEY_COMPLETE_REAL_TRAINING === '1';
    // Optional local certification waits for the unchanged 15-minute server timer.
    test.setTimeout(completeRealTraining ? 20 * 60_000 : 240_000);
    test.skip(testInfo.project.name !== 'chromium-desktop-live', 'one desktop run covers the full first-session authority journey');
    const journeyStartedAt = Date.now();
    if (grantDelayMs) {
        // Let achievement sync supersede an already committed starter grant.
        // Its older response must not cancel the cinematic's persistence handoff.
        await page.route('**/api/pet/choose-starter', async (route) => {
            // The same keep-alive reset guard as the persistence poll above. It is
            // inline, not the e2e-live helper: scripts/prepare-ux-journey-audit.mjs
            // runs a copy of this spec from test-results/, where that import breaks.
            const response = await route.fetch({ maxRetries: 2 });
            await new Promise((resolve) => setTimeout(resolve, grantDelayMs));
            await route.fulfill({ response });
        });
    }

    const playerName = `Journey${Date.now().toString(36).slice(-7)}`;
    const password = 'Journey!Pass1234';
    const runtimeErrors: string[] = [];
    const serverFailures: string[] = [];
    const decorativeListeners: string[] = [];
    await page.exposeFunction('__reportDecorativeListener', (type: string) => decorativeListeners.push(type));
    await page.addInitScript(() => {
        const addListener = EventTarget.prototype.addEventListener;
        const pointerEvents = new Set(['click', 'contextmenu', 'dblclick', 'wheel', 'pointerdown', 'pointerup', 'pointermove', 'pointerleave', 'pointercancel', 'lostpointercapture']);
        EventTarget.prototype.addEventListener = function (type, listener, options) {
            if (pointerEvents.has(type) && this instanceof HTMLElement
                && this.closest('.sector-scene-3d, .scene-ambience-3d')) {
                void (window as unknown as { __reportDecorativeListener: (type: string) => Promise<void> })
                    .__reportDecorativeListener(type);
            }
            return addListener.call(this, type, listener, options);
        };
    });
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
    await expect(page.getByRole('heading', { name: 'Choose the answer you will carry' })).toBeVisible();
    await page.getByRole('button', { name: /Remain Unbound/ }).click();
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
        && save.character?.academyVow === 'unbound'
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
    const jutsuList = page.getByRole('listbox', { name: 'Jutsu library' });
    await jutsuList.getByText('Flicker', { exact: true }).click();
    const jutsuResponse = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/training/jutsu-ryo');
    await page.getByRole('button', { name: 'Unlock level 1 · free' }).click();
    expect((await jutsuResponse).status()).toBe(200);
    await expect(page.locator('.jutsu-notice')).toContainText('Flicker unlocked at level 1.');
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
    const beginSparButton = page.getByRole('button', { name: /Begin the Resonance Trial/ });
    await expect(beginSparButton).toBeVisible();
    await waitForPersisted(page, playerName, (save) => (
        save.character?.onboardingStep === 'academySpar'
        && Object.values(save.character.equipment ?? {}).includes('rustfang-kunai')
        && Object.values(save.character.equipment ?? {}).includes('shinobi-vest')
    ), 'both starter gear items and the spar handoff must persist');

    const sparStart = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/story/spar-start');
    await beginSparButton.click();
    const sparStartHttp = await sparStart;
    expect(sparStartHttp.status()).toBe(200);
    const started = await sparStartHttp.json() as { runId: string; session: Session };
    expect(started.session.sessionId).toBe(started.runId);
    await expect(page.locator('.mission-arena-fight')).toBeVisible();

    // Learn the actual command/target interaction before the persistence solver
    // finishes the match. The guide occupies the existing feedback band, so it
    // cannot cover the vitals or the action tray on a phone.
    await expect(page.locator('.combat-action-notice .spar-coach-hint')).toContainText('Move');
    await expect(page.locator('body > .spar-coach-banner')).toHaveCount(0);
    await page.getByRole('button', { name: /^Move/ }).click();
    const moveReply = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/solo-pve/action');
    await page.getByRole('button', { name: /move target/ }).first().click();
    const moved = await (await moveReply).json() as { session: Session; applied: boolean };
    expect(moved.applied).toBe(true);
    expect(moved.session.player.pos).not.toBe(started.session.player.pos);
    await page.locator('.combat-jutsu-button').filter({ hasText: 'Flicker' }).click();
    const jutsuReply = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/solo-pve/action');
    await page.getByRole('button', { name: /jutsu move destination/ }).first().click();
    const flickered = await (await jutsuReply).json() as { session: Session; applied: boolean };
    expect(flickered.applied).toBe(true);
    expect(flickered.session.player.pos).not.toBe(moved.session.player.pos);

    const terminal = await playToTerminal(page, playerName, flickered.session);
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
    await expect(sparResult).not.toHaveClass(/story-fight-complete--cinematic/);
    await expect(sparResult).toHaveCSS('animation-delay', '0s');
    expect((await settleResponse).status()).toBe(200);
    await expect(sparResult).toContainText(/stat points/);
    await sparResult.getByRole('button', { name: 'Continue' }).click();
    const sparAftermath = page.getByRole('dialog', { name: 'The dummy falls. Its seals do not.' });
    await expect(sparAftermath).toBeVisible();
    await sparAftermath.getByRole('button', { name: 'Continue' }).click();
    const echoedVow = page.getByRole('dialog', { name: 'Your answer comes back in the wrong voice.' });
    await expect(echoedVow).toBeVisible();
    await echoedVow.getByRole('button', { name: 'Keep the vow' }).click();
    await expect(page.getByRole('button', { name: 'Go to Cafeteria' })).toBeVisible();
    await waitForPersisted(page, playerName, (save) => (
        save.character?.onboardingStep === 'cafeteria'
        && save.character.academySparClaimed === true
        && save.character.academyIncidentSeen === true
    ), 'the sealed spar reward, aftermath, and recovery handoff must persist');

    await page.getByRole('button', { name: 'Go to Cafeteria' }).click();
    await expect(page.getByRole('heading', { name: 'Cafeteria' })).toBeVisible();
    const cafeteriaStorageNotice = page.getByRole('region', { name: 'Data storage notice' });
    if (await cafeteriaStorageNotice.isVisible().catch(() => false)) {
        await cafeteriaStorageNotice.getByRole('button', { name: 'Got it', exact: true }).click();
        await expect(cafeteriaStorageNotice).toHaveCount(0);
    }
    const cafeteriaResponse = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/player/cafeteria');
    await page.getByRole('button', { name: /Feast/ }).click();
    expect((await cafeteriaResponse).status()).toBe(200);
    await expect(page.locator('.game-toast-stack')).toContainText('Feast restored your resources.');
    await expect(page.getByRole('button', { name: 'Go to Mission Hall' })).toBeVisible();
    await waitForPersisted(page, playerName, (save) => save.character?.onboardingStep === 'firstMission',
        'full recovery and the mission handoff must persist');

    await page.getByRole('button', { name: 'Go to Mission Hall' }).click();
    await expect(page.getByRole('heading', { name: 'Mission Hall' })).toBeVisible();
    const missionResponse = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/missions/claim-mission');
    await page.getByRole('button', { name: 'Claim Academy Trial Reward' }).click();
    expect((await missionResponse).status()).toBe(200);
    await expect(page.locator('.game-toast-stack')).toContainText('Academy Trial complete!');
    await expect(page.getByRole('alertdialog', { name: 'Notice' })).toHaveCount(0);
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
    // the stateful desktop coverage with the direct-travel and critical
    // mobile-control contract exercised by adaptive-shell.spec.ts.
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
    const sectorMarker = page.getByRole('button', { name: 'Travel to Harbor Gates (Sector 1)' });
    expect(travelPosts).toBe(0);
    const travelResponse = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/player/travel');
    await sectorMarker.click();
    expect((await travelResponse).status()).toBe(200);
    expect(travelPosts).toBe(1);

    const fieldTrace = page.getByRole('dialog', { name: 'The foxfire stops at an old road marker.' });
    await expect(fieldTrace).toBeVisible();
    await fieldTrace.getByRole('button', { name: 'Continue' }).click();
    const measuredRoad = page.getByRole('dialog', { name: 'The mark is measuring the road.' });
    await expect(measuredRoad).toBeVisible();
    await measuredRoad.getByRole('button', { name: 'Return with the evidence' }).click();
    await waitForPersisted(page, playerName, (save) => (
        save.character?.academySectorVisited === true
        && save.character.academyTraceSector === 1
    ), 'the acknowledged field trace must persist before returning');

    await expect(page.getByRole('button', { name: 'Return to Village' })).toBeVisible();
    await page.getByRole('button', { name: 'Return to Village' }).click();
    const fieldSeal = page.getByRole('dialog', { name: "Shiranui's Field Seal" });
    await expect(fieldSeal).toBeVisible();
    await fieldSeal.getByRole('button', { name: 'Accept the Field Seal' }).click();
    const nextStep = page.getByRole('dialog', { name: 'Your next step is yours.' });
    await expect(nextStep).toBeVisible();
    await nextStep.getByRole('button', { name: 'Stay in the village for now' }).click();

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
            && character.academySectorVisited === true
            && character.academyFieldSeal === true;
    }, 'the complete first-session contract must persist');
    expect(Number(completed._saveVersion)).toBeGreaterThan(0);
    expect(completed.currentSector).toBe(0);
    expect(completed.character?.firstContract?.source).toBe('academy');

    await hardReload();
    await expect(page.locator('.icx-root')).toHaveCount(0);
    await expect(page.locator('.onboarding-coach-banner')).toHaveCount(0);
    await expect(page.locator('.stormveil-village-screen')).toBeVisible();
    await expect(page.locator('.mobile-bottom-nav')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

    // A second session must recover through the real auth path, not merely from
    // React state or a warm browser refresh.
    // The final autosave and logout share the real 3-second save-burst bucket.
    // Preserve the existing Academy checkpoint before beginning another activity.
    await page.waitForTimeout(3_100);
    await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'Menu', exact: true }).click();
    const mobileMenu = page.getByRole('dialog', { name: 'Shinobi menu' });
    await expect(mobileMenu).toBeVisible();
    const logoutSave = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname.toLowerCase() === `/api/save/${playerName.toLowerCase()}`);
    await mobileMenu.getByRole('button', { name: 'Logout' }).click();
    expect((await logoutSave).status()).toBe(200);
    await expect(page.getByTestId('start-create')).toBeVisible();

    await openLandingLogin(page);
    await page.getByRole('button', { name: 'Use a name and password' }).click();
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

    // Begin the optional assignment in the second authenticated session. This
    // proves the offered journal survives logout/login, then separately checks
    // the real activity, recap and durable acknowledgement across reloads.
    await page.locator('.fc-ribbon').getByRole('button', { name: /Choose a route/ }).click();
    await page.screenshot({ path: testInfo.outputPath('first-contract-live-routes.png') });
    await page.getByRole('dialog', { name: 'First Contract field journal' }).getByRole('button', { name: /Companion A moment for your companion/ }).click();
    await waitForPersisted(page, playerName, (save) => save.character?.firstContract?.route === 'companion', 'the chosen contract must persist');
    const care = await browserApi(page, '/api/pet/progress', { playerName, action: 'pet', petId: completed.character?.activePetId });
    expect(care.status, JSON.stringify(care.body)).toBe(200);
    await hardReload();
    await page.locator('.fc-ribbon').getByRole('button', { name: 'Read your entry' }).click();
    const journal = page.getByRole('dialog', { name: 'First Contract field journal' });
    await expect(journal).toContainText('You took time to care for one of your companions.');
    await page.screenshot({ path: testInfo.outputPath('first-contract-live-recap.png') });
    await journal.getByRole('button', { name: 'Choose your next goal' }).click();
    await waitForPersisted(page, playerName, (save) => Boolean(save.character?.firstContract?.completedAt && save.character.firstContract.acknowledgedAt), 'completion and its acknowledgement must persist');
    await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'Village', exact: true }).click();
    await expect(page.locator('.stormveil-village-screen')).toBeVisible();
    await hardReload();
    await expect(page.locator('.fc-ribbon')).toHaveCount(0);
    expect(decorativeListeners, 'world backdrop canvases must never bind pointer listeners, including during return-to-village teardown').toEqual([]);
    expect(runtimeErrors).toEqual([]);
    expect(serverFailures).toEqual([]);
    let finalSave = await waitForPersisted(page, playerName, (save) => (
        save.character?.onboardingStep === 'done'
        && Boolean(save.character.firstContract?.acknowledgedAt)
    ), 'the final journey evidence must describe the authoritative save');
    let trainingEvidence: { waitingMs: number; applied: number; overflow: number; replayStatus: number } | null = null;
    if (completeRealTraining) {
        const trainingToken = finalSave.activeTraining?.token;
        expect(trainingToken).toBeTruthy();
        const waitStartedAt = Date.now();
        const remainingMs = Math.max(0, Number(finalSave.activeTraining?.endsAt) - Date.now());
        await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'Menu', exact: true }).click();
        await page.getByRole('dialog', { name: 'Shinobi menu' }).getByRole('button', { name: 'Training', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Training Grounds' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Collect Training', exact: true })).toBeEnabled({ timeout: remainingMs + 30_000 });
        await hardReload();
        await expect(page.getByRole('button', { name: 'Collect Training', exact: true })).toBeEnabled();
        const collectionResponse = page.waitForResponse((response) => response.request().method() === 'POST'
            && new URL(response.url()).pathname === '/api/training/complete');
        await page.getByRole('button', { name: 'Collect Training', exact: true }).click();
        const collection = await collectionResponse;
        expect(collection.status()).toBe(200);
        const grant = await collection.json() as { granted?: boolean; applied?: number; overflow?: number };
        expect(grant.granted).toBe(true);
        expect(Number(grant.applied ?? 0) + Number(grant.overflow ?? 0)).toBeGreaterThan(0);
        finalSave = await waitForPersisted(page, playerName, (save) => !save.activeTraining, 'the completed training lease must retire');
        const settledStats = finalSave.character?.stats;
        const replay = await browserApi(page, '/api/training/complete', { playerName, token: trainingToken });
        expect(replay.status).toBe(200);
        await hardReload();
        finalSave = await waitForPersisted(page, playerName, (save) => !save.activeTraining, 'the training retry must not recreate a lease');
        expect(finalSave.character?.stats).toEqual(settledStats);
        trainingEvidence = { waitingMs: Date.now() - waitStartedAt, applied: Number(grant.applied ?? 0), overflow: Number(grant.overflow ?? 0), replayStatus: replay.status };
    }
    await testInfo.attach('journey-summary', {
        contentType: 'application/json',
        body: JSON.stringify({
            evidenceType: 'BROWSER JOURNEY: real Express, isolated memory KV',
            account: playerName,
            fixture: 'fresh; no progression grants; API-assisted combat and companion care',
            startedAt: new Date(journeyStartedAt).toISOString(),
            elapsedMs: Date.now() - journeyStartedAt,
            starterResponseDelayMs: grantDelayMs,
            level: finalSave.character?.level ?? null,
            saveVersion: finalSave._saveVersion,
            currentSector: finalSave.currentSector,
            onboardingStep: finalSave.character?.onboardingStep,
            academySparClaimed: finalSave.character?.academySparClaimed,
            academyTrialClaimed: finalSave.character?.academyTrialClaimed,
            firstContractAcknowledged: Boolean(finalSave.character?.firstContract?.acknowledgedAt),
            trainingActive: Boolean(finalSave.activeTraining?.token),
            completedRealTraining: trainingEvidence,
            trainingRemainingMs: finalSave.activeTraining?.endsAt
                ? Math.max(0, finalSave.activeTraining.endsAt - Date.now()) : null,
            runtimeErrorCount: runtimeErrors.length,
            serverFailureCount: serverFailures.length,
        }, null, 2),
    });
});
}
