import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Locator, type Page, type Request as BrowserRequest, type TestInfo } from '@playwright/test';
import { AURA_SPHERE_ITEM_ID, AURA_SPHERE_VN_ID } from '../src/constants/game';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';
import { v2JutsuResourceCost } from '../src/lib/jutsu-scaling';
import { accountKey } from '../src/lib/player-accounts';

// The loadout's scroll container. Phones wrap basic commands and the loadout in
// one `.combat-action-tray` scrollport; elsewhere the tray is `display:
// contents` (DOM-present, layout-absent) and `.combat-jutsu-bar` scrolls
// itself. `.first()` on this selector is the tray when present (it precedes the
// bar in DOM order) and the bar for Tower, which has no tray; the two evaluate
// callbacks then step through a contents-tray to the bar that really scrolls.
// They run inside page.evaluate (serialized by source), so each must stay
// self-contained — no shared helper closure.
const ACTION_PANEL_SELECTOR = '.combat-action-tray, .combat-jutsu-bar';
const readTrayScrollTop = (panel: Element): number => {
    const element = panel as HTMLElement;
    const scroller = element.classList.contains('combat-action-tray') && getComputedStyle(element).display === 'contents'
        ? element.querySelector<HTMLElement>('.combat-jutsu-bar') ?? element
        : element;
    return scroller.scrollTop;
};
const resetTrayScroll = (panel: Element): void => {
    const element = panel as HTMLElement;
    const scroller = element.classList.contains('combat-action-tray') && getComputedStyle(element).display === 'contents'
        ? element.querySelector<HTMLElement>('.combat-jutsu-bar') ?? element
        : element;
    scroller.scrollTop = 0;
};

const PHASE = process.env.COMBAT_LAYOUT_CAPTURE_PHASE === 'before' ? 'before' : 'after';
const STRICT = PHASE === 'after' && process.env.COMBAT_LAYOUT_STRICT !== '0';
const SCREENSHOT_ROOT = process.env.COMBAT_LAYOUT_ARTIFACT_ROOT
    ? resolve(process.env.COMBAT_LAYOUT_ARTIFACT_ROOT, PHASE)
    // Keep durable matrix evidence outside Playwright's configured outputDir.
    // The runner may clear that directory while retaining failure artifacts;
    // nesting captures there caused late-viewpoint ENOENT failures after all
    // geometry assertions had already passed.
    : resolve(process.cwd(), 'test-results', 'combat-layout-captures', PHASE);

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

// Registration is a production security boundary, not a knob for the suite to
// disable. Six projects each register Solo, primary PvP, and Story Tower (18),
// the baseline authority project registers 2 MPvE + 4 MPvP controllers (6),
// and ordinary PvP shares one authenticated opponent: 25 total.
const MATRIX_REGISTRATION_BUDGET = 25;
const MATRIX_EXPECTED_REGISTRATION_COUNT = (6 * 3) + 2 + 4 + 1;
if (MATRIX_EXPECTED_REGISTRATION_COUNT > MATRIX_REGISTRATION_BUDGET) {
    throw new Error(`Combat matrix needs ${MATRIX_EXPECTED_REGISTRATION_COUNT} registrations, over the ${MATRIX_REGISTRATION_BUDGET} release-server budget`);
}

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

function serverPlayerSlug(name: string): string {
    // Mirror the public player-identity boundary used by the built server.
    // Tower ownership is stored as this slug while the signed-in/display name
    // may legitimately retain punctuation.
    return name.toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, 32);
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

async function seedSave(
    request: APIRequestContext,
    name: string,
    options: {
        characterPatch?: Partial<ReturnType<typeof character>>;
        triggeredEvents?: string[];
    } = {},
) {
    const { characterPatch = {}, triggeredEvents = [] } = options;
    const seeded = await request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': 'live-express-e2e-admin' },
        data: { character: { ...character(name), ...characterPatch }, currentSector: 40, acceptedMissionIds: [], missionProgress: {}, triggeredEvents },
    });
    expect(seeded.status()).toBe(200);
}

async function seedAccount(request: APIRequestContext, testInfo: TestInfo, mode: 'solo' | 'pvp' | 'tower') {
    const name = `${mode}${safeProject(testInfo)}champ`.slice(0, 20);
    const password = 'LayoutMatrix!1234';
    const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password } });
    expect(registered.status()).toBe(200);
    const token = String((await registered.json()).token ?? '');
    expect(token.length).toBeGreaterThan(10);
    await seedSave(request, name, mode !== 'solo' ? {
        characterPatch: { level: mode === 'tower' ? 30 : 20, rankTitle: 'Genin' },
        triggeredEvents: [AURA_SPHERE_VN_ID],
    } : {});
    if (mode !== 'solo') {
        // Established combat fixtures must clear real one-time progression
        // gates or their overlays can hide a layout shift in the battle UI.
        const chosen = await request.post('/api/profession/choose', {
            headers: { 'x-player-name': name, 'x-player-token': token },
            data: { playerName: name, profession: 'vanguard' },
        });
        const choice = await chosen.json() as { ok?: boolean; profession?: string; error?: string };
        expect(chosen.status(), JSON.stringify(choice)).toBe(200);
        expect(choice).toMatchObject({ ok: true, profession: 'vanguard' });

        const claimed = await request.post('/api/events/claim', {
            headers: { 'x-player-name': name, 'x-player-token': token },
            data: { playerName: name, eventId: AURA_SPHERE_VN_ID },
        });
        const eventClaim = await claimed.json() as {
            ok?: boolean;
            error?: string;
            character?: { inventory?: string[]; claimedCreatorEvents?: string[] };
        };
        expect(claimed.status(), JSON.stringify(eventClaim)).toBe(200);
        expect(eventClaim.ok).toBe(true);
        expect(eventClaim.character?.claimedCreatorEvents).toContain(AURA_SPHERE_VN_ID);
        expect(eventClaim.character?.inventory).toContain(AURA_SPHERE_ITEM_ID);
    }
    return { name, token };
}

type TowerPvpLayoutMatch = {
    matchId: string;
    status: 'ready' | 'active' | 'done' | 'cancelled';
    version: number;
    roster: Array<{ slug: string; actorId: string }>;
    combat: { activeIndex: number; turnQueue: string[] };
};

async function seedEstablishedTowerAccount(request: APIRequestContext, name: string) {
    const password = 'LayoutMatrix!1234';
    const registered = await request.post('/api/player-auth', {
        data: { action: 'register', name, password },
    });
    expect(registered.status()).toBe(200);
    const token = String((await registered.json()).token ?? '');
    expect(token.length).toBeGreaterThan(10);
    await seedSave(request, name, {
        characterPatch: { level: 30, rankTitle: 'Genin' },
        triggeredEvents: [AURA_SPHERE_VN_ID],
    });
    const headers = { 'x-player-name': name, 'x-player-token': token };
    const chosen = await request.post('/api/profession/choose', {
        headers,
        data: { playerName: name, profession: 'vanguard' },
    });
    expect(chosen.status(), JSON.stringify(await chosen.json())).toBe(200);
    const claimed = await request.post('/api/events/claim', {
        headers,
        data: { playerName: name, eventId: AURA_SPHERE_VN_ID },
    });
    expect(claimed.status(), JSON.stringify(await claimed.json())).toBe(200);
    return { name, token };
}

async function seedSharedOrdinaryPvpOpponent(request: APIRequestContext) {
    // One ordinary-PvP opponent is sufficient across the six serial projects.
    // Re-registering a throwaway opponent in every project pushed this single
    // no-retry matrix over the real household registration budget (25/15m).
    // Verify-first avoids spending a registration attempt on an existing name;
    // the admin reseed below restores a deterministic, lease-free combat save.
    const name = 'layout-pvp-opponent';
    const password = 'LayoutMatrix!1234';
    let authenticated = await request.post('/api/player-auth', {
        data: { action: 'verify', name, password },
    });
    let authentication = await authenticated.json() as { ok?: boolean; token?: string; error?: string };
    if (authenticated.status() === 200 && authentication.ok !== true) {
        authenticated = await request.post('/api/player-auth', {
            data: { action: 'register', name, password },
        });
        authentication = await authenticated.json() as { ok?: boolean; token?: string; error?: string };
    }
    expect(authenticated.status(), JSON.stringify(authentication)).toBe(200);
    const token = String(authentication.token ?? '');
    expect(token.length).toBeGreaterThan(10);
    await seedSave(request, name, {
        characterPatch: { level: 30, rankTitle: 'Genin' },
        triggeredEvents: [AURA_SPHERE_VN_ID],
    });
    const headers = { 'x-player-name': name, 'x-player-token': token };
    const chosen = await request.post('/api/profession/choose', {
        headers,
        data: { playerName: name, profession: 'vanguard' },
    });
    expect(chosen.status(), JSON.stringify(await chosen.json())).toBe(200);
    const claimed = await request.post('/api/events/claim', {
        headers,
        data: { playerName: name, eventId: AURA_SPHERE_VN_ID },
    });
    expect(claimed.status(), JSON.stringify(await claimed.json())).toBe(200);
    // This shared account may have won the previous project's PvP coin flip.
    // Closing that browser leaves its short-lived in-memory presence marked in
    // battle; after the admin reset + authenticated save acknowledgement, publish
    // the same ordinary out-of-battle heartbeat a returned client would send.
    await fetchAuthoritativeSave(request, { name, token });
    const clearedPresence = await request.post('/api/player/heartbeat', {
        headers,
        data: { name, sector: 40, inBattle: false },
    });
    const presence = await clearedPresence.json() as {
        error?: string;
        forceReload?: boolean;
        sector?: number;
        sectorMates?: Array<{ name?: string; sector?: number; inBattle?: boolean }>;
    };
    expect(clearedPresence.status(), JSON.stringify(presence)).toBe(200);
    expect(presence.forceReload, 'shared PvP opponent reset signal must be acknowledged').not.toBe(true);
    expect(
        presence.sectorMates?.find(member => serverPlayerSlug(String(member.name ?? '')) === serverPlayerSlug(name)),
        'shared PvP opponent publishes an out-of-battle presence',
    ).toMatchObject({ sector: presence.sector, inBattle: false });
    return { name, token };
}

async function seedActiveTowerPvpMatch(request: APIRequestContext, testInfo: TestInfo) {
    const accounts: Array<{ name: string; token: string }> = [];
    for (const suffix of ['a', 'b', 'c', 'd']) {
        // Punctuation is intentional: the UI must reconcile a display name with
        // the canonical owner slug instead of hiding the signed-in actor/loadout.
        const name = `tm.${safeProject(testInfo)}${suffix}`.slice(0, 20);
        accounts.push(await seedEstablishedTowerAccount(request, name));
    }

    let match: TowerPvpLayoutMatch | null = null;
    for (const [index, account] of accounts.entries()) {
        const joined = await request.post('/api/towers/pvp-queue', {
            headers: { 'x-player-name': account.name, 'x-player-token': account.token },
            data: {
                action: 'join',
                playerName: account.name,
                requestId: `layout-queue-${safeProject(testInfo)}-${index}-0001`,
            },
        });
        const body = await joined.json() as {
            error?: string;
            presence?: { state?: string; match?: TowerPvpLayoutMatch | null };
        };
        expect(joined.status(), JSON.stringify(body)).toBe(200);
        if (body.presence?.match) match = body.presence.match;
    }
    expect(match, 'the fourth exact-2v2 queue join must publish a match').not.toBeNull();

    for (const [index, account] of accounts.entries()) {
        const ready = await request.post('/api/towers/pvp-queue', {
            headers: { 'x-player-name': account.name, 'x-player-token': account.token },
            data: {
                action: 'ready',
                playerName: account.name,
                matchId: match!.matchId,
                ready: true,
                requestId: `layout-ready-${safeProject(testInfo)}-${index}-0001`,
                expectedVersion: match!.version,
            },
        });
        const body = await ready.json() as { error?: string; match?: TowerPvpLayoutMatch | null };
        expect(ready.status(), JSON.stringify(body)).toBe(200);
        expect(body.match, 'every ready acknowledgement must return the current match').toBeTruthy();
        match = body.match!;
    }
    expect(match!.status).toBe('active');

    const activeActorId = match!.combat.turnQueue[match!.combat.activeIndex];
    const activeController = match!.roster.find(member => member.actorId === activeActorId)?.slug;
    const account = accounts.find(candidate => serverPlayerSlug(candidate.name) === activeController);
    expect(account, 'the active actor must map to one of the four authenticated controllers').toBeTruthy();
    return { account: account!, match: match! };
}

type TowerPartyLayoutView = {
    id: string;
    inviteCode: string;
    version: number;
    status: 'forming' | 'launching' | 'active' | 'closed';
};

type TowerPartyLayoutSession = {
    runId: string;
    activeIndex: number;
    turnQueue: string[];
    actors: Array<{ id: string; ownerSlug: string | null }>;
};

type TowerAuthoritySession = {
    actionVersion?: number;
    activeAp: number;
    actionsThisTurn: number;
    activeIndex: number;
    turnQueue: string[];
    actors: Array<{
        id: string;
        ownerSlug: string | null;
        pos: number;
        chakra: number;
        stamina: number;
        cooldowns?: Record<string, number>;
        character?: {
            level?: number;
            specialty?: string;
            jutsu?: Array<{
                id?: string;
                type?: string;
                ap?: number;
                chakraCost?: number;
                staminaCost?: number;
                cooldown?: number;
            }>;
        };
    }>;
    log: string[];
};

type TowerAuthority =
    | { kind: 'mpve'; runId: string }
    | { kind: 'mpvp'; matchId: string };

async function fetchTowerAuthoritySession(
    request: APIRequestContext,
    account: { name: string; token: string },
    authority: TowerAuthority,
): Promise<TowerAuthoritySession> {
    const headers = { 'x-player-name': account.name, 'x-player-token': account.token };
    if (authority.kind === 'mpve') {
        const response = await request.get(
            `/api/towers/state?runId=${encodeURIComponent(authority.runId)}&playerName=${encodeURIComponent(account.name)}`,
            { headers },
        );
        const body = await response.json() as { error?: string; session?: TowerAuthoritySession };
        expect(response.status(), JSON.stringify(body)).toBe(200);
        expect(body.session).toBeTruthy();
        return body.session!;
    }
    const response = await request.get(
        `/api/towers/pvp-state?matchId=${encodeURIComponent(authority.matchId)}&playerName=${encodeURIComponent(account.name)}`,
        { headers },
    );
    const body = await response.json() as {
        error?: string;
        match?: { version: number; combat: TowerAuthoritySession };
    };
    expect(response.status(), JSON.stringify(body)).toBe(200);
    expect(body.match).toBeTruthy();
    return body.match!.combat.actionVersion == null
        ? { ...body.match!.combat, actionVersion: body.match!.version }
        : body.match!.combat;
}

async function assertAuthoritativeTowerFlickerCast(
    page: Page,
    request: APIRequestContext,
    account: { name: string; token: string },
    authority: TowerAuthority,
    rootSelector: string,
): Promise<void> {
    const root = page.locator(rootSelector);
    // Keep a stable locator after the successful cast disables the card on
    // cooldown; a :not(:disabled) locator would disappear before UI proof.
    const flicker = root.locator('.combat-jutsu-button[title^="Flicker |"]').first();
    await expect(flicker, `${authority.kind} Flicker card`).toBeVisible();
    await expect(flicker, `${authority.kind} Flicker starts enabled`).toBeEnabled();
    await flicker.scrollIntoViewIfNeeded();
    await flicker.click();
    await expect(flicker).toHaveClass(/selected-action/);

    const destination = root.getByRole('button', { name: /jutsu move destination/i }).first();
    await expect(destination, `${authority.kind} legal Flicker destination`).toBeVisible();
    const targetTile = Number(await destination.getAttribute('data-combat-tile'));
    expect(Number.isSafeInteger(targetTile), `${authority.kind} destination tile index`).toBe(true);

    const before = await fetchTowerAuthoritySession(request, account, authority);
    const beforeVersion = Number(before.actionVersion);
    expect(Number.isSafeInteger(beforeVersion), `${authority.kind} pre-cast action version`).toBe(true);
    const actorId = before.turnQueue[before.activeIndex];
    const beforeActor = before.actors.find(actor => actor.id === actorId);
    expect(beforeActor, `${authority.kind} active actor`).toBeTruthy();
    expect(beforeActor!.ownerSlug, `${authority.kind} active controller`).toBe(serverPlayerSlug(account.name));
    expect(targetTile, `${authority.kind} Flicker must change position`).not.toBe(beforeActor!.pos);
    // Tower authority seals the run/match loadout when combat starts. Its
    // Flicker must preserve the canonical PvE/PvP contract; deriving expected
    // deltas from a drifted Tower record would hide the parity regression.
    const sealedFlicker = beforeActor!.character?.jutsu?.find(jutsu => jutsu.id === 'starter-universal-flicker');
    expect(sealedFlicker, `${authority.kind} sealed Flicker definition`).toBeTruthy();
    const authorityLevel = Number(beforeActor!.character?.level);
    expect(Number.isFinite(authorityLevel), `${authority.kind} authoritative actor level`).toBe(true);
    // Compute the expectation through the parity-pinned ordinary client formula,
    // not from Tower's sealed cost fields. This keeps the journey sensitive to
    // hydration drift while supporting fixtures whose authoritative level is
    // sanitized upward by the save service.
    const canonicalFlicker = {
        type: 'Taijutsu',
        ap: 20,
        chakraCost: 0,
        staminaCost: v2JutsuResourceCost(20, authorityLevel),
        cooldown: 2,
    } as const;
    expect(
        sealedFlicker,
        `${authority.kind} preserves PvE/PvP runtime Flicker costs; sealed=${JSON.stringify(sealedFlicker)}`,
    ).toMatchObject(canonicalFlicker);

    const endpoint = authority.kind === 'mpve' ? '/api/towers/action' : '/api/towers/pvp-action';
    const actionPosts: Array<Record<string, unknown>> = [];
    const recordAction = (browserRequest: BrowserRequest) => {
        if (browserRequest.method() !== 'POST' || new URL(browserRequest.url()).pathname !== endpoint) return;
        try {
            actionPosts.push(browserRequest.postDataJSON() as Record<string, unknown>);
        } catch {
            actionPosts.push({ unreadable: true });
        }
    };
    page.on('request', recordAction);
    try {
        const actionResponsePromise = page.waitForResponse(response =>
            response.request().method() === 'POST' && new URL(response.url()).pathname === endpoint);
        await destination.click();
        const actionResponse = await actionResponsePromise;
        const actionBody = await actionResponse.json() as {
            applied?: boolean;
            replayed?: boolean;
            reason?: string;
            currentVersion?: number;
            match?: { version?: number; combat?: TowerAuthoritySession };
        };
        expect(actionResponse.status(), JSON.stringify(actionBody)).toBe(200);
        expect(actionBody.applied, JSON.stringify(actionBody)).toBe(true);
        expect(actionBody.replayed, `${authority.kind} first delivery is not a replay`).toBe(false);
        expect(actionBody.currentVersion, `${authority.kind} response version`).toBe(beforeVersion + 1);
        if (authority.kind === 'mpvp') {
            expect(actionBody.match?.version, 'MPvP match version').toBe(beforeVersion + 1);
            expect(actionBody.match?.combat?.actionVersion, 'MPvP combat version').toBe(beforeVersion + 1);
        }

        let latest: TowerAuthoritySession | null = null;
        await expect.poll(async () => {
            latest = await fetchTowerAuthoritySession(request, account, authority);
            return Number(latest.actionVersion);
        }, {
            message: `${authority.kind} persisted Flicker version`,
            timeout: 10_000,
        }).toBe(beforeVersion + 1);
        const after = latest!;
        const afterActor = after.actors.find(actor => actor.id === actorId);
        expect(afterActor, `${authority.kind} moved actor`).toBeTruthy();
        expect(afterActor!.pos, `${authority.kind} authoritative destination`).toBe(targetTile);
        expect(after.activeAp, `${authority.kind} Flicker AP spend`).toBe(before.activeAp - canonicalFlicker.ap);
        expect(after.actionsThisTurn, `${authority.kind} action count`).toBe(before.actionsThisTurn + 1);
        expect(afterActor!.chakra, `${authority.kind} Flicker chakra spend`).toBe(beforeActor!.chakra - canonicalFlicker.chakraCost);
        expect(afterActor!.stamina, `${authority.kind} Flicker stamina spend`).toBe(beforeActor!.stamina - canonicalFlicker.staminaCost);
        expect(afterActor!.cooldowns?.['starter-universal-flicker'], `${authority.kind} Flicker cooldown`).toBe(canonicalFlicker.cooldown);
        expect(after.log, `${authority.kind} exactly one combat-log entry`).toHaveLength(before.log.length + 1);
        expect(after.log.at(-1), `${authority.kind} Flicker log`).toMatch(new RegExp(`uses Flicker.*flickers to hex ${targetTile}`, 'i'));

        await expect(flicker).not.toHaveClass(/selected-action/);
        await expect(flicker, `${authority.kind} Flicker enters cooldown`).toBeDisabled();
        await expect(root.locator(`button.tower-hex-tile[data-combat-tile="${targetTile}"]`)).toHaveAttribute(
            'aria-label',
            new RegExp(`occupied by ${account.name}`, 'i'),
        );
        // A duplicate browser submission would be a user-visible double action.
        // Wait across several frames so an accidental effect/refetch replay is observed.
        await page.evaluate(() => new Promise<void>(resolveAfterFrames => {
            let frames = 0;
            const next = () => {
                frames += 1;
                if (frames >= 6) resolveAfterFrames();
                else requestAnimationFrame(next);
            };
            requestAnimationFrame(next);
        }));
        expect(actionPosts, `${authority.kind} browser action POST count`).toHaveLength(1);
        expect(actionPosts[0]).toMatchObject({
            type: 'jutsu',
            jutsuId: 'starter-universal-flicker',
            tile: targetTile,
            playerName: account.name,
        });
        if (authority.kind === 'mpve') expect(actionPosts[0]?.runId, 'MPvE action run').toBe(authority.runId);
        else expect(actionPosts[0]?.matchId, 'MPvP action match').toBe(authority.matchId);
        expect(actionPosts[0]?.expectedVersion, `${authority.kind} optimistic version`).toBe(beforeVersion);
        expect(String(actionPosts[0]?.moveToken ?? ''), `${authority.kind} idempotency token`).toMatch(/^tower_[A-Za-z0-9_-]+$/);

        // Exercise the captured browser intent a second time at the API boundary.
        // Both Tower authority variants must replay the original receipt without
        // another reducer mutation, even though their transports are distinct.
        const replayResponse = await request.post(endpoint, {
            headers: { 'x-player-name': account.name, 'x-player-token': account.token },
            data: actionPosts[0],
        });
        const replayBody = await replayResponse.json() as {
            applied?: boolean;
            replayed?: boolean;
            reason?: string;
            currentVersion?: number;
        };
        expect(replayResponse.status(), JSON.stringify(replayBody)).toBe(200);
        expect(replayBody.currentVersion, `${authority.kind} duplicate keeps version`).toBe(beforeVersion + 1);
        expect(replayBody.applied, JSON.stringify(replayBody)).toBe(true);
        expect(replayBody.replayed, `${authority.kind} duplicate is receipt replay`).toBe(true);
        const afterDuplicate = await fetchTowerAuthoritySession(request, account, authority);
        const duplicateActor = afterDuplicate.actors.find(actor => actor.id === actorId);
        expect(Number(afterDuplicate.actionVersion), `${authority.kind} duplicate persisted version`).toBe(beforeVersion + 1);
        expect(afterDuplicate.activeAp, `${authority.kind} duplicate AP`).toBe(after.activeAp);
        expect(afterDuplicate.actionsThisTurn, `${authority.kind} duplicate action count`).toBe(after.actionsThisTurn);
        expect(afterDuplicate.log, `${authority.kind} duplicate log`).toEqual(after.log);
        expect(duplicateActor, `${authority.kind} duplicate actor`).toEqual(afterActor);

        // Exercise a real ownership transition after the movement cast. An
        // armed intent must not survive into another fighter's turn, while the
        // signed-in fighter's sealed loadout remains visible for inspection.
        const nextJutsu = root.locator('.combat-jutsu-button:not(:disabled):not([title^="Flicker |"])').first();
        await expect(nextJutsu, `${authority.kind} post-cast alternate jutsu`).toBeVisible();
        await nextJutsu.click();
        await expect(nextJutsu).toHaveClass(/selected-action/);
        const endTurn = root.getByRole('button', { name: /End Turn/i });
        await expect(endTurn, `${authority.kind} end-turn control`).toBeEnabled();
        const endTurnResponsePromise = page.waitForResponse(response =>
            response.request().method() === 'POST' && new URL(response.url()).pathname === endpoint);
        await endTurn.click();
        const endTurnResponse = await endTurnResponsePromise;
        const endTurnBody = await endTurnResponse.json() as {
            applied?: boolean;
            replayed?: boolean;
            currentVersion?: number;
            reason?: string;
        };
        expect(endTurnResponse.status(), JSON.stringify(endTurnBody)).toBe(200);
        expect(endTurnBody.applied, JSON.stringify(endTurnBody)).toBe(true);
        expect(endTurnBody.replayed, `${authority.kind} first end-turn delivery`).toBe(false);
        expect(endTurnBody.currentVersion, `${authority.kind} end-turn version`).toBe(beforeVersion + 2);
        await expect.poll(async () => {
            const transitioned = await fetchTowerAuthoritySession(request, account, authority);
            return {
                version: Number(transitioned.actionVersion),
                activeActorId: transitioned.turnQueue[transitioned.activeIndex],
            };
        }, {
            message: `${authority.kind} persisted ownership transition`,
            timeout: 10_000,
        }).toEqual({ version: beforeVersion + 2, activeActorId: expect.not.stringMatching(new RegExp(`^${actorId}$`)) });
        await expect(root.locator('.combat-jutsu-button.selected-action'), `${authority.kind} stale armed intent`).toHaveCount(0);
        await expect(root.locator('.combat-jutsu-button').first(), `${authority.kind} local sealed loadout remains mounted`).toBeVisible();
        await expect(root.locator('.combat-jutsu-button:not(:disabled)'), `${authority.kind} waiting-turn jutsu controls`).toHaveCount(0);
        expect(actionPosts, `${authority.kind} browser action POST count after end turn`).toHaveLength(2);
        expect(actionPosts[1]).toMatchObject({
            type: 'wait',
            playerName: account.name,
            expectedVersion: beforeVersion + 1,
        });
        expect(String(actionPosts[1]?.moveToken ?? ''), `${authority.kind} end-turn idempotency token`).toMatch(/^tower_[A-Za-z0-9_-]+$/);
    } finally {
        page.off('request', recordAction);
    }
}

async function seedActiveTowerPartyMatch(request: APIRequestContext, testInfo: TestInfo) {
    const accounts = await Promise.all(['a', 'b'].map(suffix =>
        seedEstablishedTowerAccount(request, `tv.${safeProject(testInfo)}${suffix}`.slice(0, 20))));
    const [host, ally] = accounts as [typeof accounts[number], typeof accounts[number]];
    const headers = (account: typeof host) => ({
        'x-player-name': account.name,
        'x-player-token': account.token,
    });

    const created = await request.post('/api/towers/party', {
        headers: headers(host),
        data: {
            action: 'create', playerName: host.name, mode: 'story', floor: 1,
            requestId: `layout-party-create-${safeProject(testInfo)}-0001`,
        },
    });
    let body = await created.json() as { error?: string; party?: TowerPartyLayoutView | null };
    expect(created.status(), JSON.stringify(body)).toBe(200);
    expect(body.party).toBeTruthy();
    let party = body.party!;

    const joined = await request.post('/api/towers/party', {
        headers: headers(ally),
        data: {
            action: 'join', playerName: ally.name, inviteCode: party.inviteCode,
            expectedVersion: party.version,
            requestId: `layout-party-join-${safeProject(testInfo)}-0001`,
        },
    });
    body = await joined.json() as { error?: string; party?: TowerPartyLayoutView | null };
    expect(joined.status(), JSON.stringify(body)).toBe(200);
    party = body.party!;

    for (const [index, account] of accounts.entries()) {
        const ready = await request.post('/api/towers/party', {
            headers: headers(account),
            data: {
                action: 'ready', playerName: account.name, partyId: party.id,
                expectedVersion: party.version,
                requestId: `layout-party-ready-${safeProject(testInfo)}-${index}-0001`,
            },
        });
        body = await ready.json() as { error?: string; party?: TowerPartyLayoutView | null };
        expect(ready.status(), JSON.stringify(body)).toBe(200);
        party = body.party!;
    }

    const launched = await request.post('/api/towers/start', {
        headers: headers(host),
        data: {
            hostName: host.name, mode: 'story', floor: 1, partyId: party.id,
            expectedVersion: party.version,
            requestId: `layout-party-launch-${safeProject(testInfo)}-0001`,
        },
    });
    const launch = await launched.json() as {
        error?: string;
        runId?: string;
        session?: TowerPartyLayoutSession;
    };
    expect(launched.status(), JSON.stringify(launch)).toBe(200);
    expect(launch.runId).toBeTruthy();
    expect(launch.session).toBeTruthy();
    const session = launch.session!;
    const activeActorId = session.turnQueue[session.activeIndex];
    const activeOwner = session.actors.find(actor => actor.id === activeActorId)?.ownerSlug;
    const account = accounts.find(candidate => serverPlayerSlug(candidate.name) === activeOwner);
    expect(account, 'the first party-MPvE turn must belong to a live party member').toBeTruthy();
    return { account: account!, runId: launch.runId! };
}

async function installSession(
    page: Page,
    name: string,
    token: string,
    {
        acknowledgeEstablishedNotices = false,
        savePreview,
    }: { acknowledgeEstablishedNotices?: boolean; savePreview?: unknown } = {},
) {
    await page.addInitScript(({ player, sessionToken, establishedAccount, latestPatchVersion, previewKey, preview }) => {
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: player }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [player]: { token: sessionToken } }));
        localStorage.setItem('shinobix:activePlayerPersist', player);
        localStorage.setItem('shinobix:activeTokenPersist', sessionToken);
        if (preview !== undefined) localStorage.setItem(previewKey, JSON.stringify(preview));
        if (establishedAccount) {
            localStorage.setItem('shinobix:storage-notice-ack', '1');
            if (latestPatchVersion) localStorage.setItem('patchNotes.lastSeenVersion.v1', latestPatchVersion);
            localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        }
    }, {
        player: name,
        sessionToken: token,
        establishedAccount: acknowledgeEstablishedNotices,
        latestPatchVersion: LATEST_PATCH_NOTE?.version ?? '',
        previewKey: `ninjav-save-preview-v1:${accountKey(name)}`,
        preview: savePreview,
    });
}

async function fetchAuthoritativeSave(request: APIRequestContext, account: { name: string; token: string }): Promise<unknown> {
    const headers = { 'x-player-name': account.name, 'x-player-token': account.token };
    let previousShape = '';
    let latest: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await request.get(`/api/save/${encodeURIComponent(account.name)}`, {
            headers,
        });
        latest = await response.json();
        expect(response.status(), JSON.stringify(latest)).toBe(200);

        // A freshly admin-seeded record can acquire server-owned defaults over
        // more than one read. Mounting the client from the first projection lets
        // its concurrent boot reads protect that incomplete projection as a
        // device draft, which later raises an unrelated save-conflict banner in
        // long WebKit matrices. Require a fixed-point payload before installing
        // the preview; save clock/version metadata is expected to advance.
        const shape = JSON.stringify(latest, (key, value) =>
            key === '_saveVersion' || key === '_saveAt' ? undefined : value);
        if (previousShape && shape === previousShape) {
            // Admin seeding intentionally publishes a short-lived reset signal.
            // A real active session acknowledges it after applying the reset;
            // these fixtures have already fetched and accepted the settled save,
            // so finalize that handshake before mounting the browser. Otherwise
            // heartbeat can force-reload during combat and correctly preserve the
            // device projection as a conflict draft, obscuring the board under test.
            const acknowledged = await request.post(`/api/save/${encodeURIComponent(account.name)}?ack=1`, { headers });
            const acknowledgement = await acknowledged.json() as { ok?: boolean; error?: string };
            expect(acknowledged.status(), JSON.stringify(acknowledgement)).toBe(200);
            expect(acknowledgement.ok).toBe(true);

            const finalResponse = await request.get(`/api/save/${encodeURIComponent(account.name)}`, { headers });
            const finalSave = await finalResponse.json();
            expect(finalResponse.status(), JSON.stringify(finalSave)).toBe(200);
            return finalSave;
        }
        previousShape = shape;
    }
    throw new Error(`Authoritative save did not normalize to a fixed point for ${account.name}`);
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

async function resolveSaveConflict(page: Page): Promise<void> {
    const banner = page.getByRole('complementary', { name: 'Device and server saves diverged' });
    if (await banner.isVisible().catch(() => false)) {
        // This is intentionally a real pointer action: recovery must remain
        // operable above a body-portaled fullscreen CombatInstance.
        await banner.getByRole('button', { name: 'Keep server' }).click();
    }
    await expect(banner).toBeHidden();
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
    firstJutsuLabel: string | null;
    /** False when the measured card was disabled — i.e. it is not this side's
     *  turn. Reported so a layout failure is never mistaken for a turn-order
     *  one, or the reverse. */
    firstJutsuEnabled: boolean;
    actionScroll: { scrollTop: number; clientHeight: number; scrollHeight: number } | null;
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
        // The action panel is whichever element actually clips and scrolls the
        // loadout: on phones that is the shared `.combat-action-tray` (basic
        // commands + loadout in one scrollport), everywhere else the tray is
        // `display: contents` and `.combat-jutsu-bar` scrolls itself. Measuring
        // the bar on a phone would report its unclipped rect, which slides up
        // under the board as soon as a card is scrolled into view.
        const trayNode = root?.querySelector<HTMLElement>('.combat-action-tray') ?? null;
        const actionNode = trayNode && getComputedStyle(trayNode).display !== 'contents'
            ? trayNode
            : root?.querySelector('.combat-jutsu-bar') ?? null;
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
        /*
         * Geometry probe: prefer an ENABLED jutsu, but fall back to any jutsu.
         *
         * What this measures is whether the first card's centre sits inside the
         * action tray and is hit-testable — a LAYOUT property a disabled card
         * has identically, since nothing in the stylesheets keys pointer-events
         * off :disabled. Matching only `:not(:disabled)` made a layout assertion
         * depend on TURN STATE, and that dependency cannot be waited out: PvP
         * turns lapse on a 75s server timer (api/pvp/session.ts auto-waits a
         * lapsed turn), the matrix walks 22 viewports plus the zoom
         * equivalents, and on webkit that outlives the timer. The turn then
         * passes to an opponent with no client attached, so every card stays
         * disabled for a whole turn cycle and the probe reported rect=null at
         * 2560x1440.
         *
         * Actionability is still gated where turn state IS controlled:
         * assertJutsuSelectionGeometryStable requires
         * `.combat-jutsu-button:not(:disabled)` to be visible and to actually
         * arm, on focused viewports reached long before the timer can lapse.
         * firstJutsuEnabled keeps the distinction in the failure text so a
         * genuinely unreachable deck still reads as one.
         */
        const enabledJutsu = root?.querySelector<HTMLElement>('.combat-jutsu-button:not(:disabled)') ?? null;
        const firstJutsu = enabledJutsu ?? root?.querySelector<HTMLElement>('.combat-jutsu-button') ?? null;
        const firstJutsuEnabled = Boolean(enabledJutsu);
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
        const trackStyle = mainStyle?.display === 'contents' ? style : mainStyle;
        const mainRect = mainStyle?.display === 'contents'
            ? (() => {
                const parts = [...(root?.querySelectorAll(
                    '.arena-top-panel, .dual-ap-panel, .twp-strip, .hex-battlefield, .shinobi-command-bar, .combat-jutsu-bar, .combat-text-log, .combat-mode-panel, .battle-chat-col',
                ) ?? [])]
                    .map(rect)
                    .filter((value): value is Rect => value !== null);
                if (!parts.length) return null;
                const x = Math.min(...parts.map((value) => value.x));
                const y = Math.min(...parts.map((value) => value.y));
                const right = Math.max(...parts.map((value) => value.right));
                const bottom = Math.max(...parts.map((value) => value.bottom));
                return { x, y, width: right - x, height: bottom - y, right, bottom };
            })()
            : rect(mainNode);
        const countGridTracks = (template: string) => {
            let depth = 0;
            let count = 0;
            let inTrack = false;
            for (const character of template.trim()) {
                if (/\s/.test(character) && depth === 0) {
                    if (inTrack) count += 1;
                    inTrack = false;
                    continue;
                }
                inTrack = true;
                if (character === '(') depth += 1;
                if (character === ')') depth = Math.max(0, depth - 1);
            }
            return count + (inTrack ? 1 : 0);
        };
        const apTextRects = [...(root?.querySelectorAll<HTMLElement>('.dual-ap-panel > div > strong, .dual-ap-panel > div > small, .dual-ap-panel > .round-timer-display > small, .dual-ap-panel .round-timer-ring') ?? [])]
            .map(rect).filter((value): value is Rect => value !== null);
        const dualApTextOverlap = apTextRects.some((first, index) => apTextRects.slice(index + 1).some((second) => overlap(first, second)));
        return {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            devicePixelRatio: window.devicePixelRatio,
            documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
            root: rect(root),
            layout: layoutRect,
            main: mainRect,
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
            mainGridRowCount: countGridTracks(trackStyle?.gridTemplateRows ?? ''),
            mainGridTemplateColumns: mainStyle?.gridTemplateColumns ?? '',
            mainGridTemplateRows: trackStyle?.gridTemplateRows ?? '',
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
            firstJutsuLabel: firstJutsu?.getAttribute('aria-label') ?? firstJutsu?.textContent?.trim().slice(0, 80) ?? null,
            firstJutsuEnabled,
            actionScroll: actionNode ? {
                scrollTop: (actionNode as HTMLElement).scrollTop,
                clientHeight: (actionNode as HTMLElement).clientHeight,
                scrollHeight: (actionNode as HTMLElement).scrollHeight,
            } : null,
            tileCenterBounds,
            minCommandTouchTarget: commandButtons.length ? Math.min(...commandButtons.map((value) => Math.min(value.width, value.height))) : null,
            boardActionOverlap: overlap(boardRect, actionRect),
            boardDossierOverlap: dossiers.some((value) => overlap(boardRect, value)),
            terrainNoticeOverlap: overlap(rect(terrainNode), rect(noticeNode)),
            dualApTextOverlap,
        };
    }, rootSelector);
}

async function settleLayout(page: Page): Promise<void> {
    // ResizeObserver updates fitted board scale after layout. Two animation
    // frames cover both the resize notification and React's rendered response.
    await page.evaluate(() => new Promise<void>((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()));
    }));
}

async function measureStable(page: Page, rootSelector: string): Promise<LayoutMeasurement> {
    await settleLayout(page);
    let current = await measure(page, rootSelector);
    for (let attempt = 0; attempt < 8 && (!current.tileCentersInsideBoard || current.visibleTileCount !== 120); attempt += 1) {
        await page.waitForTimeout(90);
        await settleLayout(page);
        current = await measure(page, rootSelector);
    }
    /*
     * Deliberately NO wait-for-actionable loop here.
     *
     * A previous fix spun up to 6s for a jutsu to become enabled, because the
     * geometry probe only matched `:not(:disabled)`. That race is unwinnable:
     * a lapsed PvP turn passes to an opponent with no client attached, so the
     * deck stays disabled for a full 75s turn cycle — far longer than any wait
     * this suite can afford, which is why webkit still failed at 2560x1440.
     * measure() now falls back to a disabled card, whose geometry is identical,
     * removing the race instead of racing it.
     */
    return current;
}

type SelectionGeometry = {
    root: Rect | null;
    boardStage: Rect | null;
    board: Rect | null;
    gridLayer: Rect | null;
    gridTransform: string;
    actionScrollTop: number;
    windowScrollX: number;
    windowScrollY: number;
    documentHeight: number;
    visualViewport: { width: number; height: number; offsetLeft: number; offsetTop: number; scale: number } | null;
    visibleTileCount: number;
    allTilesNamed: boolean;
    tileCenterHitCount: number;
    tileCenterMisses: string[];
};

type TransitionFrameGeometry = {
    timestamp: number;
    selected: boolean;
    root: Rect | null;
    boardStage: Rect | null;
    board: Rect | null;
    gridLayer: Rect | null;
    gridTransform: string;
};

const TRANSITION_TRACE_KEY = '__combatLayoutTransitionTrace';
const TRANSITION_TRACE_FRAMES = 12;

async function startTransitionTrace(page: Page, rootSelector: string): Promise<void> {
    await page.evaluate(({ selector, traceKey, frameCount }) => {
        const rect = (element: Element | null): Rect | null => {
            if (!element) return null;
            const value = element.getBoundingClientRect();
            return { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom };
        };
        const capture = (timestamp: number): TransitionFrameGeometry => {
            const root = document.querySelector(selector);
            const gridLayer = root?.querySelector('.hex-grid-layer') ?? null;
            return {
                timestamp,
                selected: Boolean(root?.querySelector('.combat-jutsu-button.selected-action')),
                root: rect(root),
                boardStage: rect(root?.querySelector('.combat-board-stage, .tower-board-area, .hex-battlefield') ?? null),
                board: rect(root?.querySelector('.hex-battlefield, .tower-board-area') ?? null),
                gridLayer: rect(gridLayer),
                gridTransform: gridLayer ? getComputedStyle(gridLayer).transform : '',
            };
        };
        const trace = { samples: [capture(performance.now())], complete: false, started: false };
        (window as unknown as Record<string, unknown>)[traceKey] = trace;
        const beginTrace = () => {
            if (trace.started) return;
            trace.started = true;
            root?.removeEventListener('pointerdown', beginTrace, true);
            document.removeEventListener('keydown', beginTrace, true);
            let sampledFrames = 0;
            const sampleFrame = (timestamp: number) => {
                trace.samples.push(capture(timestamp));
                sampledFrames += 1;
                if (sampledFrames >= frameCount) trace.complete = true;
                else requestAnimationFrame(sampleFrame);
            };
            requestAnimationFrame(sampleFrame);
        };
        // Anchor the consecutive-frame window to the real user interaction.
        // Starting rAFs before Playwright dispatches input can let a busy WebKit
        // process consume the entire trace before pointerdown reaches the page.
        const root = document.querySelector(selector);
        root?.addEventListener('pointerdown', beginTrace, true);
        document.addEventListener('keydown', beginTrace, true);
    }, { selector: rootSelector, traceKey: TRANSITION_TRACE_KEY, frameCount: TRANSITION_TRACE_FRAMES });
}

async function finishTransitionTrace(page: Page): Promise<TransitionFrameGeometry[]> {
    await page.waitForFunction((traceKey) => {
        const trace = (window as unknown as Record<string, { complete?: boolean } | undefined>)[traceKey];
        return trace?.complete === true;
    }, TRANSITION_TRACE_KEY);
    return page.evaluate((traceKey) => {
        const store = window as unknown as Record<string, { samples?: TransitionFrameGeometry[] } | undefined>;
        const samples = store[traceKey]?.samples ?? [];
        delete store[traceKey];
        return samples;
    }, TRANSITION_TRACE_KEY);
}

async function clickVisibleControlCenter(page: Page, control: Locator, label: string): Promise<void> {
    const box = await control.boundingBox();
    const viewport = page.viewportSize();
    expect(box, `${label} bounding box`).not.toBeNull();
    expect(viewport, `${label} viewport`).not.toBeNull();
    const left = Math.max(0, box?.x ?? 0);
    const top = Math.max(0, box?.y ?? 0);
    const right = Math.min(viewport?.width ?? 0, (box?.x ?? 0) + (box?.width ?? 0));
    const bottom = Math.min(viewport?.height ?? 0, (box?.y ?? 0) + (box?.height ?? 0));
    expect(right - left, `${label} visible width`).toBeGreaterThanOrEqual(44);
    expect(bottom - top, `${label} visible height`).toBeGreaterThanOrEqual(44);
    const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
    const hit = await control.evaluate((element, point) => {
        const target = document.elementFromPoint(point.x, point.y);
        return {
            inside: target === element || Boolean(target && element.contains(target)),
            target: target instanceof HTMLElement ? `${target.tagName}.${target.className}` : target?.nodeName ?? 'none',
        };
    }, center);
    expect(hit.inside, `${label} visible centre hit ${hit.target}`).toBe(true);
    // Locator.click() first scrolls the whole control into view. That is useful
    // for form automation but unlike a real pointer tap on an already-visible
    // card, and it mutates the combat tray/viewport before pointerdown. Click
    // the visible centre directly so the trace covers only the UI transition.
    await page.mouse.click(center.x, center.y);
}

async function selectionGeometry(page: Page, rootSelector: string): Promise<SelectionGeometry> {
    return page.evaluate((selector) => {
        const root = document.querySelector(selector);
        const rect = (element: Element | null): Rect | null => {
            if (!element) return null;
            const value = element.getBoundingClientRect();
            return { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom };
        };
        const gridLayer = root?.querySelector('.hex-grid-layer') ?? null;
        const trayCandidate = root?.querySelector<HTMLElement>('.combat-action-tray') ?? null;
        const actionTray = trayCandidate && getComputedStyle(trayCandidate).display !== 'contents'
            ? trayCandidate
            : root?.querySelector<HTMLElement>('.combat-jutsu-bar') ?? null;
        // Tower draws several non-interactive overlays with the tile skin class.
        // Scope this inventory to the real board controls so the 120-tile
        // accessibility and hit-test contract cannot be satisfied by decoration.
        const tiles = [...(root?.querySelectorAll<HTMLButtonElement>('button.hex-tile, button.tower-hex-tile') ?? [])].filter(tile => {
            const value = tile.getBoundingClientRect();
            return value.width > 0 && value.height > 0;
        });
        const tileCenterMisses: string[] = [];
        const tileCenterHitCount = tiles.filter(tile => {
            const value = tile.getBoundingClientRect();
            const hit = document.elementFromPoint(value.left + value.width / 2, value.top + value.height / 2);
            const tileIndex = Number(tile.dataset.combatTile);
            const actorTarget = hit instanceof Element
                ? hit.closest<HTMLElement>('.tower-board-actor[data-combat-target-tile]')
                : null;
            const mappedActorTarget = Boolean(
                tile.hasAttribute('inert')
                && actorTarget
                && (actorTarget instanceof HTMLButtonElement || actorTarget.getAttribute('role') === 'button'),
            );
            // Tower intentionally removes idle/non-target tiles from pointer and
            // accessibility hit-testing with `inert`. In that state the browser
            // must resolve the centre to the tile's own grid substrate—not an
            // unrelated overlay. Once a tile becomes actionable, the stricter
            // tile/actor hit contract below still applies.
            const inertGridSubstrate = tile.hasAttribute('inert')
                && hit === tile.closest('.hex-grid-layer');
            const accurate = hit === tile || Boolean(hit && tile.contains(hit)) || mappedActorTarget || inertGridSubstrate;
            if (!accurate) {
                tileCenterMisses.push(
                    `${Number.isSafeInteger(tileIndex) ? tileIndex + 1 : '?'}=>${hit instanceof HTMLElement ? hit.className : hit?.nodeName ?? 'none'}`,
                );
            }
            return accurate;
        }).length;
        return {
            root: rect(root),
            boardStage: rect(root?.querySelector('.combat-board-stage, .tower-board-area, .hex-battlefield') ?? null),
            board: rect(root?.querySelector('.hex-battlefield, .tower-board-area') ?? null),
            gridLayer: rect(gridLayer),
            gridTransform: gridLayer ? getComputedStyle(gridLayer).transform : '',
            actionScrollTop: actionTray?.scrollTop ?? 0,
            windowScrollX: window.scrollX,
            windowScrollY: window.scrollY,
            documentHeight: document.documentElement.scrollHeight,
            visualViewport: window.visualViewport ? {
                width: window.visualViewport.width,
                height: window.visualViewport.height,
                offsetLeft: window.visualViewport.offsetLeft,
                offsetTop: window.visualViewport.offsetTop,
                scale: window.visualViewport.scale,
            } : null,
            visibleTileCount: tiles.length,
            allTilesNamed: tiles.every(tile => Boolean(tile.getAttribute('aria-label')?.trim())),
            tileCenterHitCount,
            tileCenterMisses,
        };
    }, rootSelector);
}

function expectGeometryNear(actual: SelectionGeometry, expected: SelectionGeometry, label: string): void {
    const expectRectNear = (actualRect: Rect | null, expectedRect: Rect | null, rectLabel: string) => {
        expect(actualRect, `${label} ${rectLabel} must exist`).not.toBeNull();
        expect(expectedRect, `${label} baseline ${rectLabel} must exist`).not.toBeNull();
        for (const key of ['x', 'y', 'width', 'height'] as const) {
            expect(Math.abs((actualRect?.[key] ?? 0) - (expectedRect?.[key] ?? 0)), `${label} ${rectLabel}.${key}`).toBeLessThanOrEqual(1);
        }
    };
    expectRectNear(actual.root, expected.root, 'root');
    expectRectNear(actual.boardStage, expected.boardStage, 'board stage');
    expectRectNear(actual.board, expected.board, 'board');
    expectRectNear(actual.gridLayer, expected.gridLayer, 'rendered grid');
    expect(actual.gridTransform, `${label} computed board transform`).toBe(expected.gridTransform);
    // WebKit can quantize the same subpixel scroll position to adjacent integer
    // CSS pixels after a selected border repaints. Preserve the no-jump contract
    // while tolerating only that single-pixel projection noise.
    expect(Math.abs(actual.actionScrollTop - expected.actionScrollTop), `${label} action tray scroll`).toBeLessThanOrEqual(1);
    expect(actual.windowScrollX, `${label} document horizontal scroll`).toBe(expected.windowScrollX);
    expect(actual.windowScrollY, `${label} document vertical scroll`).toBe(expected.windowScrollY);
    expect(actual.documentHeight, `${label} document height`).toBe(expected.documentHeight);
    expect(actual.visualViewport, `${label} visual viewport`).toEqual(expected.visualViewport);
}

function expectTransitionTraceStable(
    trace: TransitionFrameGeometry[],
    expected: SelectionGeometry,
    label: string,
    selectedBefore: boolean,
    selectedAfter: boolean,
): void {
    expect(trace, `${label} frame trace`).toHaveLength(TRANSITION_TRACE_FRAMES + 1);
    expect(trace[0]?.selected, `${label} selection at trace start`).toBe(selectedBefore);
    expect(trace.some(sample => sample.selected === selectedAfter), `${label} must span the interaction state change`).toBe(true);
    const expectRectNear = (actualRect: Rect | null, expectedRect: Rect | null, rectLabel: string, frame: number) => {
        expect(actualRect, `${label} frame ${frame} ${rectLabel} must exist`).not.toBeNull();
        expect(expectedRect, `${label} baseline ${rectLabel} must exist`).not.toBeNull();
        for (const key of ['x', 'y', 'width', 'height'] as const) {
            expect(
                Math.abs((actualRect?.[key] ?? 0) - (expectedRect?.[key] ?? 0)),
                `${label} frame ${frame} ${rectLabel}.${key}`,
            ).toBeLessThanOrEqual(1);
        }
    };
    trace.forEach((sample, frame) => {
        expectRectNear(sample.root, expected.root, 'root', frame);
        expectRectNear(sample.boardStage, expected.boardStage, 'board stage', frame);
        expectRectNear(sample.board, expected.board, 'board', frame);
        expectRectNear(sample.gridLayer, expected.gridLayer, 'rendered grid', frame);
        expect(sample.gridTransform, `${label} frame ${frame} computed board transform`).toBe(expected.gridTransform);
    });
}

function expectCombatBoardUsable(geometry: SelectionGeometry, label: string, isTower: boolean): void {
    expect(geometry.board?.height ?? 0, `${label} board height`).toBeGreaterThanOrEqual(90);
    // Story/MPvP are 12x10; generated party-MPvE maps can be larger. Never
    // accept a reduced board, and require every actual button in larger maps.
    if (isTower) expect(geometry.visibleTileCount, `${label} visible Tower tile count`).toBeGreaterThanOrEqual(120);
    else expect(geometry.visibleTileCount, `${label} visible combat tile count`).toBe(120);
    expect(geometry.allTilesNamed, `${label} every combat tile must have an accessible name`).toBe(true);
    expect(
        geometry.tileCenterHitCount,
        `${label} tile center hit-test misses: ${geometry.tileCenterMisses.join(', ')}`,
    ).toBe(geometry.visibleTileCount);
}

async function assertJutsuSelectionGeometryStable(
    page: Page,
    rootSelector: string,
    canToggleOff: boolean,
    captureSlug?: string,
    fullViewportMatrix = false,
): Promise<void> {
    // Every shell gets the phone plus both 200%-zoom equivalents that exposed
    // the auto-fit jump. The shared Tower shell additionally runs the complete
    // advertised viewport/zoom set in every browser/DPR project.
    const focusedViewports = [
        { width: 390, height: 844 },
        { width: 720, height: 450 },
        { width: 512, height: 384 },
    ];
    const requestedMatrix = [
        ...ACTIVE_VIEWPORTS.map(([width, height]) => ({ width, height })),
        ...BROWSER_ZOOM_EQUIVALENTS
            .filter(({ width, height }) => !VIEWPORT_FILTER || `${width}x${height}` === VIEWPORT_FILTER)
            .map(({ width, height }) => ({ width, height })),
    ];
    const viewports = (fullViewportMatrix ? requestedMatrix : focusedViewports)
        .filter((viewport, index, all) => all.findIndex(candidate =>
            candidate.width === viewport.width && candidate.height === viewport.height) === index);
    expect(viewports.length, 'at least one jutsu transition viewport must be selected').toBeGreaterThan(0);
    for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        const root = page.locator(rootSelector);
        const firstJutsu = root.locator('.combat-jutsu-button:not(:disabled)').first();
        const actionTray = root.locator(ACTION_PANEL_SELECTOR).first();
        await expect(firstJutsu).toBeVisible();
        await actionTray.evaluate(resetTrayScroll);
        await page.mouse.move(0, 0);
        await settleLayout(page);
        const before = await selectionGeometry(page, rootSelector);
        const isTower = rootSelector.toLowerCase().includes('tower');
        const captureDirectory = captureSlug && viewport.width === 512 && viewport.height === 384
            ? resolve(SCREENSHOT_ROOT, 'arming', captureSlug)
            : null;
        if (captureDirectory) {
            await mkdir(captureDirectory, { recursive: true });
            await writeScreenshotWithRetry(page, resolve(captureDirectory, '512x384-idle.png'));
        }
        expectCombatBoardUsable(before, `${rootSelector} ${viewport.width}x${viewport.height} idle`, isTower);
        if (isTower) {
            const leaveControl = root.locator('.tower-fight-leave');
            await expect(leaveControl, `${rootSelector} leave or forfeit control`).toBeVisible();
            const leaveMinimum = await leaveControl.evaluate((control) => {
                const style = getComputedStyle(control);
                return {
                    width: Number.parseFloat(style.minWidth),
                    height: Number.parseFloat(style.minHeight),
                };
            });
            expect(leaveMinimum.width, `${rootSelector} leave or forfeit CSS min-width`).toBeGreaterThanOrEqual(44);
            expect(leaveMinimum.height, `${rootSelector} leave or forfeit CSS min-height`).toBeGreaterThanOrEqual(44);
            const leaveBox = await leaveControl.boundingBox();
            // Firefox/DPR projection can report an exact 44 CSS-pixel box as
            // 43.999998. Keep the authored 44px minimum above authoritative,
            // while tolerating only sub-hundredth floating-point noise here.
            expect(leaveBox?.width ?? 0, `${rootSelector} leave or forfeit target width`).toBeGreaterThanOrEqual(43.99);
            expect(leaveBox?.height ?? 0, `${rootSelector} leave or forfeit target height`).toBeGreaterThanOrEqual(43.99);
        }

        await startTransitionTrace(page, rootSelector);
        await clickVisibleControlCenter(page, firstJutsu, `${rootSelector} ${viewport.width}x${viewport.height} jutsu`);
        const armTrace = await finishTransitionTrace(page);
        await expect(firstJutsu, `${rootSelector} ${viewport.width}x${viewport.height} jutsu must arm`).toHaveClass(/selected-action/);
        expectTransitionTraceStable(armTrace, before, `${rootSelector} ${viewport.width}x${viewport.height} arming`, false, true);
        await page.mouse.move(0, 0);
        await settleLayout(page);
        const label = `${rootSelector} ${viewport.width}x${viewport.height}`;
        const armed = await selectionGeometry(page, rootSelector);
        if (captureDirectory) {
            await writeScreenshotWithRetry(page, resolve(captureDirectory, '512x384-armed.png'));
        }
        expectCombatBoardUsable(armed, `${label} armed`, isTower);
        expectGeometryNear(armed, before, `${label} after arming a jutsu`);

        await startTransitionTrace(page, rootSelector);
        if (canToggleOff) await clickVisibleControlCenter(page, firstJutsu, `${rootSelector} ${viewport.width}x${viewport.height} selected jutsu`);
        else await page.keyboard.press('Escape');
        const cancelTrace = await finishTransitionTrace(page);
        await expect(firstJutsu).not.toHaveClass(/selected-action/);
        expectTransitionTraceStable(cancelTrace, before, `${label} cancelling`, true, false);
        await page.mouse.move(0, 0);
        await settleLayout(page);
        const cancelled = await selectionGeometry(page, rootSelector);
        if (captureDirectory) {
            await writeScreenshotWithRetry(page, resolve(captureDirectory, '512x384-cancelled.png'));
            await writeArtifactWithRetry(
                page,
                resolve(captureDirectory, '512x384-geometry.json'),
                `${JSON.stringify({ viewport, idle: before, armTrace, armed, cancelTrace, cancelled }, null, 2)}\n`,
            );
        }
        expectCombatBoardUsable(cancelled, `${label} cancelled`, isTower);
        expectGeometryNear(cancelled, before, `${label} after cancelling a jutsu`);

        if (viewport.width === 512 && viewport.height === 384) {
            // The first card exercises self-cast guidance in these fixtures.
            // Also cover the Move + EMPTY_GROUND family whose range overlay and
            // longer guidance previously had no explicit arming transition.
            const moveJutsu = root.locator('.combat-jutsu-button:not(:disabled)').filter({ hasText: /Flicker/i }).first();
            await expect(moveJutsu, `${label} Move/ground jutsu fixture`).toBeAttached();
            await moveJutsu.scrollIntoViewIfNeeded();
            await settleLayout(page);
            const moveBefore = await selectionGeometry(page, rootSelector);
            await startTransitionTrace(page, rootSelector);
            await moveJutsu.click();
            const moveArmTrace = await finishTransitionTrace(page);
            await expect(moveJutsu).toHaveClass(/selected-action/);
            expectTransitionTraceStable(moveArmTrace, moveBefore, `${label} arming Flicker`, false, true);
            await settleLayout(page);
            const moveArmed = await selectionGeometry(page, rootSelector);
            expectCombatBoardUsable(moveArmed, `${label} Flicker armed`, isTower);
            expectGeometryNear(moveArmed, moveBefore, `${label} after arming Flicker`);

            await startTransitionTrace(page, rootSelector);
            if (canToggleOff) await moveJutsu.click();
            else await page.keyboard.press('Escape');
            const moveCancelTrace = await finishTransitionTrace(page);
            await expect(moveJutsu).not.toHaveClass(/selected-action/);
            expectTransitionTraceStable(moveCancelTrace, moveBefore, `${label} cancelling Flicker`, true, false);
            await settleLayout(page);
            const moveCancelled = await selectionGeometry(page, rootSelector);
            expectCombatBoardUsable(moveCancelled, `${label} Flicker cancelled`, isTower);
            expectGeometryNear(moveCancelled, moveBefore, `${label} after cancelling Flicker`);

            if (captureDirectory) {
                await writeArtifactWithRetry(
                    page,
                    resolve(captureDirectory, '512x384-flicker-geometry.json'),
                    `${JSON.stringify({ viewport, idle: moveBefore, armTrace: moveArmTrace, armed: moveArmed, cancelTrace: moveCancelTrace, cancelled: moveCancelled }, null, 2)}\n`,
                );
            }
        }
    }

    // Leave the matrix in its historical armed state so every viewport also
    // validates the populated guidance slot.
    const firstJutsu = page.locator(rootSelector).locator('.combat-jutsu-button:not(:disabled)').first();
    await firstJutsu.click();
    await expect(firstJutsu).toHaveClass(/selected-action/);
    await settleLayout(page);
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
    const actionTray = root.locator(ACTION_PANEL_SELECTOR).first();
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
        await trigger.scrollIntoViewIfNeeded();
        const scrollBeforeOpen = await actionTray.evaluate(readTrayScrollTop);
        const controlledId = await trigger.getAttribute('aria-controls');
        expect(controlledId, `edge action trigger ${index} must identify its portaled detail dialog`).toBeTruthy();
        await trigger.click();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        const popover = page.locator(`#${controlledId}`);
        await expect(popover).toBeVisible();
        await settleLayout(page);
        expect(await actionTray.evaluate(readTrayScrollTop), `opening edge action ${index} must not scroll its tray`).toBe(scrollBeforeOpen);
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
            expect(await actionTray.evaluate(readTrayScrollTop), `closing edge action ${index} must not scroll its tray`).toBe(scrollBeforeOpen);
            continue;
        }
        await popover.locator('[data-combat-detail-close]').click();
        await expect(popover).toBeHidden();
        await expect(trigger).toBeFocused();
        expect(await actionTray.evaluate(readTrayScrollTop), `closing edge action ${index} must not scroll its tray`).toBe(scrollBeforeOpen);
    }

    const thrownTrigger = root.locator('#pvp-combat-detail-trigger-item-thrown-shuriken');
    await expect(thrownTrigger).toBeVisible();
    await thrownTrigger.scrollIntoViewIfNeeded();
    const thrownScrollBeforeOpen = await actionTray.evaluate(readTrayScrollTop);
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
    expect(await actionTray.evaluate(readTrayScrollTop), 'closing thrown-item details must not scroll its tray').toBe(thrownScrollBeforeOpen);

    // The edge-control checks intentionally scroll the contained action tray
    // to its final equipment row. Restore the matrix's top-of-tray baseline so
    // the subsequent first-jutsu hit test measures layout, not test residue.
    await root.locator(ACTION_PANEL_SELECTOR).first().evaluate(resetTrayScroll);
}

async function assertBattlefieldActorPresentation(
    page: Page,
    rootSelector: string,
    expected: { playerMarkers: number; enemyMarkers: number; minimumEnemySprites: number },
): Promise<void> {
    const root = page.locator(rootSelector);
    const actors = root.locator('[data-battlefield-actor]');
    const playerMarkers = root.locator('[data-battlefield-actor="player"][data-battlefield-presentation="marker"]');
    const enemyMarkers = root.locator('[data-battlefield-actor="enemy"][data-battlefield-presentation="marker"]');
    const enemySprites = root.locator('[data-battlefield-actor="enemy"][data-battlefield-presentation="sprite"]');
    await expect(playerMarkers, 'player portrait markers').toHaveCount(expected.playerMarkers);
    await expect(enemyMarkers, 'enemy portrait markers').toHaveCount(expected.enemyMarkers);
    const enemySpriteCount = await enemySprites.count();
    expect(enemySpriteCount, 'enemy body sprite count').toBeGreaterThanOrEqual(expected.minimumEnemySprites);
    await expect(actors, 'every fighter must use the shared marker-or-sprite presentation').toHaveCount(
        expected.playerMarkers + expected.enemyMarkers + enemySpriteCount,
    );

    expect(await actors.evaluateAll((nodes) => nodes.every((node) => {
        const style = getComputedStyle(node);
        return style.pointerEvents === 'none'
            && Number.parseFloat(style.width) >= 40
            && Number.parseFloat(style.height) >= 40;
    })), 'actor art must stay inside a non-interactive combat anchor').toBe(true);

    if (expected.minimumEnemySprites > 0) {
        expect(await enemySprites.locator('.battlefield-actor-sprite').evaluateAll((images) => images.every((image) => {
            const sprite = image as HTMLImageElement;
            return sprite.complete && sprite.naturalWidth > 0 && sprite.naturalHeight > 0;
        })), 'enemy body sprites must load successfully').toBe(true);
    }
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
        expect(
            current.firstJutsuCenterVisibleAndHit,
            `${label} first jutsu center inaccessible; hit=${current.firstJutsuCenterHit}; action=${current.firstJutsuLabel}; enabled=${current.firstJutsuEnabled}; rect=${JSON.stringify(current.firstJutsu)}; scroll=${JSON.stringify(current.actionScroll)}`,
        ).toBe(true);
        expect(
            current.board?.height ?? 0,
            `${label} board must not collapse; stage=${JSON.stringify(current.boardStage)} rows=${current.mainGridTemplateRows}`,
        ).toBeGreaterThanOrEqual(90);
        // Both authoritative modes use four tracks in short landscape so the
        // board and controls remain side by side. The wide desktop command
        // center uses the outer shell's six explicit rows; narrower layouts
        // keep their existing six- or seven-track contracts.
        // Pin each authored breakpoint so an accidental implicit row is still
        // a release failure.
        const intermediateDesktopDossiers = (current.layout?.width ?? 0) >= 1180
            && (current.layout?.height ?? 0) >= 660;
        const wideDesktopCommandCenter = current.viewport.width >= 1280
            && current.viewport.height >= 700
            && intermediateDesktopDossiers;
        const expectedMainRows = wideDesktopCommandCenter
            ? 6
            : intermediateDesktopDossiers
                ? 8
                : mode === 'solo'
                    ? (current.viewport.width >= 1024 ? 6 : current.viewport.height <= 500 ? 4 : 7)
                    : current.viewport.width < 980
                        ? (current.viewport.height <= 500 ? 4 : 6)
                        : 7;
        expect(current.mainGridRowCount, `${label} unexpected implicit main-grid row`).toBe(expectedMainRows);
        if (mode === 'solo') {
            // Solo intentionally renders the battlefield directly, without an
            // aspect-locking CombatBoardStage. Its row height changes by viewport;
            // width, tile containment, hit testing, and the 90px floor are the
            // live usability contracts rather than one stale aspect ratio.
            expect(current.board?.width ?? 0, `${label} board width`).toBeGreaterThanOrEqual(Math.min(280, current.viewport.width - 12));
            if (wideDesktopCommandCenter) {
                expect(
                    (current.board?.height ?? 0) / Math.max(1, current.main?.height ?? 0),
                    `${label} battlefield must remain the dominant desktop interaction surface`,
                ).toBeGreaterThanOrEqual(0.32);
                expect(
                    (current.board?.width ?? 0) / Math.max(1, current.layout?.width ?? 0),
                    `${label} upper battlefield must not be squeezed by the side dossiers`,
                ).toBeGreaterThanOrEqual(0.6);
            }
        } else {
            // PvP deliberately splits the shortest landscape tier between the
            // board and actions. Preserve its authored stage ratio and a useful
            // physical floor while allowing that responsive split composition.
            expect(current.board?.width ?? 0, `${label} board width`).toBeGreaterThanOrEqual(Math.min(232, current.viewport.width - 12));
            if (wideDesktopCommandCenter) {
                expect(current.boardStage, `${label} panoramic board stage`).not.toBeNull();
                expect(Math.abs((current.board?.width ?? 0) - (current.boardStage?.width ?? 0)), `${label} board fills stage width`).toBeLessThanOrEqual(3);
                expect(Math.abs((current.board?.height ?? 0) - (current.boardStage?.height ?? 0)), `${label} board fills stage height`).toBeLessThanOrEqual(3);
                expect((current.board?.width ?? 0) / Math.max(1, current.board?.height ?? 0), `${label} panoramic board aspect`).toBeGreaterThanOrEqual(2);
            } else {
                expect((current.board?.width ?? 0) / Math.max(1, current.board?.height ?? 0), `${label} board aspect`).toBeCloseTo(1.6214, 2);
            }
        }
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
            if (width >= 1280 && height >= 700) {
                if (mode === 'solo') {
                    await expect(root.locator('.combat-companion-panel')).toHaveCount(0);
                    await expect(root.locator('.combat-companion-summon')).toHaveCount(0);
                    await expect(root.locator('.shinobi-command-bar .summon-pet-command'), `${mode} ${width}x${height} summon command`).toBeVisible();
                    await expect(root.locator('.combat-layout')).toHaveClass(/combat-log-wide/);
                    await expect(root.locator('.battle-chat-col')).toHaveCount(0);
                } else {
                    await expect(root.locator('.battle-chat-col'), `${mode} ${width}x${height} battle chat mode panel`).toBeVisible();
                    await expect(root.locator('.combat-companion-panel')).toHaveCount(0);
                }
            }
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
    // Prime the device preview with the exact post-sanitization server record.
    // Otherwise the async divergence detector can raise a save-conflict banner
    // midway through the viewport loop and turn a combat hit-test into an
    // overlay test.
    const savePreview = await fetchAuthoritativeSave(request, { name, token });
    await installSession(page, name, token, { savePreview });
    await page.goto('/#/missions', { waitUntil: 'networkidle' });
    await dismissNotices(page);
    await resolveSaveConflict(page);
    const mission = page.locator('.mh-combat-card').filter({ hasText: 'E-Rank Drill' });
    await mission.getByRole('button', { name: /Begin Mission/ }).click();
    await expect(page.locator('.mission-arena-fight')).toBeVisible();
    await expect(page.locator('.mission-arena-fight .combat-action-notice')).toBeVisible();
    await assertBattlefieldActorPresentation(page, '.mission-arena-fight', {
        playerMarkers: 1,
        enemyMarkers: 0,
        minimumEnemySprites: 1,
    });
    await assertJutsuSelectionGeometryStable(page, '.mission-arena-fight', true);
    await page.setViewportSize({ width: 1440, height: 900 });
    const soloRoot = page.locator('.mission-arena-fight');
    const battleLog = soloRoot.locator('.combat-text-log');
    await expect(battleLog).toBeVisible();
    expect((await battleLog.boundingBox())?.height ?? 0, 'desktop Battle Log must be a readable panel').toBeGreaterThanOrEqual(140);
    const soloBoard = await soloRoot.locator('.hex-battlefield').boundingBox();
    const soloGrid = await soloRoot.locator('.hex-grid-layer').boundingBox();
    expect((soloGrid?.width ?? 0) / Math.max(1, soloBoard?.width ?? 0), 'desktop hex grid should use most of the battlefield art').toBeGreaterThanOrEqual(0.6);
    const soloArtwork = await soloRoot.locator('.combat-jutsu-thumb img').evaluateAll((images) => images.map((image) => {
        const art = image as HTMLImageElement;
        const artRect = art.getBoundingClientRect();
        const frameRect = art.parentElement?.getBoundingClientRect();
        const fallback = art.parentElement?.querySelector<HTMLElement>('.combat-jutsu-fallback-icon');
        const fallbackRect = fallback?.getBoundingClientRect();
        const display = getComputedStyle(art).display;
        const artStyle = getComputedStyle(art);
        return {
            source: art.currentSrc || art.src,
            loaded: art.complete && art.naturalWidth > 0 && art.naturalHeight > 0,
            fit: artStyle.objectFit,
            contained: Boolean(frameRect
                && artRect.left >= frameRect.left - 1
                && artRect.top >= frameRect.top - 1
                && artRect.right <= frameRect.right + 1
                && artRect.bottom <= frameRect.bottom + 1),
            fallback: display === 'none'
                && Boolean(fallbackRect && fallbackRect.width >= 1 && fallbackRect.height >= 1),
        };
    }));
    expect(soloArtwork.length, 'desktop solo combat should render loadout artwork').toBeGreaterThan(0);
    expect(
        soloArtwork.every((art) => (art.loaded && art.fit === 'cover' && art.contained) || art.fallback),
        `desktop solo card artwork must use the shared edge-to-edge crop or its visible fallback: ${JSON.stringify(soloArtwork)}`,
    ).toBe(true);
    await expect(soloRoot.locator('.battle-tabbar')).toBeHidden();
    await expect(soloRoot.locator('.shinobi-command-bar')).toBeVisible();
    await expect(soloRoot.locator('.combat-jutsu-bar')).toBeVisible();
    const resultAnimation = await page.evaluate(() => {
        const rules = [...document.styleSheets].flatMap((sheet) => {
            try { return [...sheet.cssRules]; } catch { return []; }
        });
        const styleFor = (selector: string) => rules
            .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === selector)
            .map((rule) => ({
                animation: rule.style.animation,
                delay: rule.style.animationDelay,
                duration: rule.style.animationDuration,
            }));
        return {
            ordinary: styleFor('.story-fight-complete'),
            cinematic: styleFor('.story-fight-complete--cinematic'),
        };
    });
    expect(resultAnimation.ordinary.some((rule) => rule.delay === '2.2s'),
        'ordinary combat results must acknowledge the final hit without a story pause').toBe(false);
    expect(resultAnimation.ordinary.some((rule) => /(?:180ms|0\.18s)/.test(`${rule.duration} ${rule.animation}`)),
        'ordinary combat results must retain the brief entrance polish').toBe(true);
    expect(resultAnimation.cinematic.some((rule) => rule.delay === '2.2s'),
        'authored story chapters must keep their explicit final-bark beat').toBe(true);
    await captureMatrix(page, 'solo', '.mission-arena-fight', testInfo);
});

test('PvP combat layout viewport matrix', async ({ page, request }, testInfo) => {
    const p1 = await seedAccount(request, testInfo, 'pvp');
    const p2 = await seedSharedOrdinaryPvpOpponent(request);
    const created = await request.post('/api/pvp/session', {
        headers: { 'x-player-name': p1.name, 'x-player-token': p1.token },
        data: { p1Character: { name: p1.name }, p2Character: { name: p2.name }, biome: 'central' },
    });
    const creation = await created.json() as {
        error?: string;
        battleId?: string;
        session?: { activePlayer?: 'p1' | 'p2' };
    };
    expect(created.status(), JSON.stringify(creation)).toBe(200);
    const battleId = String(creation.battleId ?? '');
    expect(battleId.length).toBeGreaterThan(10);
    const activeRole = creation.session?.activePlayer;
    expect(activeRole, 'PvP session must declare the coin-flip winner').toMatch(/^p[12]$/);
    const activeAccount = activeRole === 'p2' ? p2 : p1;
    const savePreview = await fetchAuthoritativeSave(request, activeAccount);
    await installSession(page, activeAccount.name, activeAccount.token, {
        acknowledgeEstablishedNotices: true,
        savePreview,
    });
    await page.addInitScript(({ id, owner, role }) => {
        localStorage.setItem('pvpSession.v1', JSON.stringify({ owner, pvpBattleId: id, pvpRole: role, pvpBattleContext: { mode: 'standard' }, savedAt: Date.now() }));
        localStorage.setItem('lastScreen.v1', 'pvpBattle');
    }, { id: battleId, owner: accountKey(activeAccount.name), role: activeRole! });
    // Mount the authenticated fighter who won the real server coin flip. That
    // keeps the arming test deterministic without forging client turn state.
    await page.goto('/#/pvpBattle', { waitUntil: 'domcontentloaded' });
    await dismissNotices(page);
    await resolveSaveConflict(page);
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
    await assertBattlefieldActorPresentation(page, '.pvp-battle-layout', {
        playerMarkers: 1,
        enemyMarkers: 1,
        minimumEnemySprites: 0,
    });
    await assertJutsuSelectionGeometryStable(page, '.pvp-battle-layout', false);
    await captureMatrix(page, 'pvp', '.pvp-battle-layout', testInfo);

    await page.setViewportSize({ width: 1440, height: 900 });
    const pvpRoot = page.locator('.pvp-battle-layout');
    const layout = pvpRoot.locator('.combat-layout');
    const chat = pvpRoot.locator('.battle-chat-col');
    const toggle = chat.locator('.battle-chat-toggle');
    const log = pvpRoot.locator('.combat-text-log');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const openLog = await log.boundingBox();
    const draftInput = chat.locator('.battle-chat-input-row input');
    const draftEnabled = await draftInput.isEnabled();
    if (draftEnabled) await draftInput.fill('unsent tactical draft');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(chat).toHaveClass(/battle-chat-hidden/);
    await expect(layout).toHaveClass(/combat-log-wide/);
    const collapsedLog = await log.boundingBox();
    expect((collapsedLog?.width ?? 0) - (openLog?.width ?? 0), 'collapsed chat must release its lower-right space to the battle log').toBeGreaterThan(120);
    const openLogRight = (openLog?.x ?? 0) + (openLog?.width ?? 0);
    const collapsedLogRight = (collapsedLog?.x ?? 0) + (collapsedLog?.width ?? 0);
    expect(collapsedLogRight - openLogRight, 'expanded battle log must reach into the former chat area').toBeGreaterThan(120);
    expect((await chat.locator('.battle-side-header').boundingBox())?.height ?? 0, 'collapsed chat reopen control').toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'collapsed chat horizontal overflow').toBeLessThanOrEqual(1);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(layout).not.toHaveClass(/combat-log-wide/);
    if (draftEnabled) await expect(draftInput).toHaveValue('unsent tactical draft');
    const restoredLog = await log.boundingBox();
    expect(Math.abs((restoredLog?.width ?? 0) - (openLog?.width ?? 0)), 'reopened chat must restore the split log geometry').toBeLessThanOrEqual(3);
    expect(await chat.locator('.battle-chat-messages').evaluate((feed) => feed.scrollHeight - feed.scrollTop - feed.clientHeight), 'reopened chat feed should stay at its newest message').toBeLessThanOrEqual(2);

    const pvpArtwork = await pvpRoot.locator('.combat-jutsu-thumb img').evaluateAll((images) => images.map((image) => {
        const art = image as HTMLImageElement;
        return art.complete && art.naturalWidth > 0 && art.naturalHeight > 0 && getComputedStyle(art).objectFit === 'cover';
    }));
    expect(pvpArtwork.length, 'desktop PvP combat should render loadout artwork').toBeGreaterThan(0);
    expect(pvpArtwork.every(Boolean), 'desktop PvP card artwork must load with the shared edge-to-edge crop').toBe(true);
});

test('Tower combat shell keeps jutsu selection geometry stable', async ({ page, request }, testInfo) => {
    // WebKit needs roughly five minutes to exercise all 22 base viewports,
    // six zoom equivalents, and both 12-frame arm/cancel traces; slower Windows
    // GPU runners can approach eight. Keep this exhaustive test no-retry, but
    // do not let the suite-wide 240s budget terminate a healthy final-viewport
    // run before the zoom checks complete.
    test.setTimeout(600_000);
    const { name, token } = await seedAccount(request, testInfo, 'tower');
    const savePreview = await fetchAuthoritativeSave(request, { name, token });
    await installSession(page, name, token, { acknowledgeEstablishedNotices: true, savePreview });
    await page.addInitScript(() => localStorage.setItem('lastScreen.v1', 'battleTowers'));
    await page.goto('/', { waitUntil: 'networkidle' });
    await dismissNotices(page);
    await resolveSaveConflict(page);

    const firstFloor = page.locator('button[aria-describedby="tower-story-floor-1-details"]');
    await expect(firstFloor).toBeVisible();
    await firstFloor.click();
    await page.getByRole('button', { name: /Enter Floor 1/ }).click();
    await expect(page.locator('.screen-battleTowerFight')).toBeVisible();
    await assertBattlefieldActorPresentation(page, '.screen-battleTowerFight', {
        playerMarkers: 1,
        enemyMarkers: 0,
        minimumEnemySprites: 1,
    });

    // BattleTowerFight is also the shared party-MPvE host. The authoritative
    // team-PvP variant gets its own real exact-2v2 journey below.
    await assertJutsuSelectionGeometryStable(
        page,
        '.screen-battleTowerFight',
        true,
        `tower-${testInfo.project.name}`,
        true,
    );
});

test('Tower party-MPvE authoritative variant keeps jutsu selection geometry stable', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-layout',
        'One built-server party authority journey is enough; the shared Tower shell has full browser/DPR coverage above.');
    const { account, runId } = await seedActiveTowerPartyMatch(request, testInfo);
    const savePreview = await fetchAuthoritativeSave(request, account);
    await installSession(page, account.name, account.token, { acknowledgeEstablishedNotices: true, savePreview });
    await page.addInitScript(({ activeRunId }) => {
        localStorage.setItem('shinobix:towerRunId', activeRunId);
        localStorage.setItem('lastScreen.v1', 'battleTowers');
    }, { activeRunId: runId });
    await page.goto('/', { waitUntil: 'networkidle' });
    await dismissNotices(page);
    await resolveSaveConflict(page);

    const fight = page.locator('.screen-battleTowerFight:not(.tower-team-pvp-fight)');
    await expect(fight).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('complementary', { name: 'Device and server saves diverged' })).toBeHidden();
    await assertJutsuSelectionGeometryStable(page, '.screen-battleTowerFight:not(.tower-team-pvp-fight)', true,
        `tower-mpve-${testInfo.project.name}`);
    await assertAuthoritativeTowerFlickerCast(
        page,
        request,
        account,
        { kind: 'mpve', runId },
        '.screen-battleTowerFight:not(.tower-team-pvp-fight)',
    );
});

test('Tower MPvP authoritative variant keeps jutsu selection geometry stable', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-layout',
        'One built-server authority journey is enough; the shared shell has full browser/DPR coverage above.');
    const { account, match } = await seedActiveTowerPvpMatch(request, testInfo);
    const savePreview = await fetchAuthoritativeSave(request, account);
    await installSession(page, account.name, account.token, { acknowledgeEstablishedNotices: true, savePreview });
    await page.addInitScript(({ matchId }) => {
        localStorage.setItem('shinobix:towerRunId', `pvp:${matchId}`);
        // Team Arena 2v2 lives in the BATTLE ARENA; the Towers are co-op PvE.
        localStorage.setItem('lastScreen.v1', 'battleArena');
    }, { matchId: match.matchId });
    await page.goto('/', { waitUntil: 'networkidle' });
    await dismissNotices(page);
    await resolveSaveConflict(page);

    const fight = page.locator('.screen-battleTowerFight.tower-team-pvp-fight');
    await expect(fight).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('complementary', { name: 'Device and server saves diverged' })).toBeHidden();
    await assertJutsuSelectionGeometryStable(page, '.tower-team-pvp-fight', true, `tower-mpvp-${testInfo.project.name}`);
    await assertAuthoritativeTowerFlickerCast(
        page,
        request,
        account,
        { kind: 'mpvp', matchId: match.matchId },
        '.tower-team-pvp-fight',
    );
});
