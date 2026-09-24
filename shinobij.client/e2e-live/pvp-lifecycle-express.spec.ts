import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_CONNECTION_RETRIES, test } from './helpers/reconnecting-request';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';
import { AURA_SPHERE_VN_ID } from '../src/constants/game';
import { PVP_CLAIM_TRANSIENT_RETRY_DELAYS_MS } from '../src/lib/pvp-reward-claim';
import { WORLD_GEO_VERSION } from '../../shared/sector-geo';

async function seed(request: APIRequestContext, suffix: string) {
    const name = `duel${suffix}${Date.now().toString(36)}`;
    const registered = await request.post('/api/player-auth', {
        data: { action: 'register', name, password: 'DuelJourney!1234' },
    });
    expect(registered.status(), await registered.text()).toBe(200);
    const token = String((await registered.json()).token);
    const headers = { 'x-player-name': name, 'x-player-token': token };
    const character = {
        name, village: 'Moonshadow Village', storyVillage: 'Moonshadow Village', specialty: 'Ninjutsu', bloodline: 'None',
        level: 24, rankTitle: 'Chunin', xp: 0, unspentStats: 0, storyProgress: 99,
        onboardingStep: 'done', academyChecklistClaimed: true, starterCardsClaimed: true,
        examsPassed: ['genin', 'chunin'], profession: 'vanguard', professionRank: 1, professionXp: 0, professionChosenAt: 1,
        hp: 500, maxHp: 500, chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500,
        stats: Object.fromEntries(['strength', 'speed', 'intelligence', 'willpower', 'bukijutsuOffense',
            'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense', 'genjutsuOffense', 'genjutsuDefense',
            'ninjutsuOffense', 'ninjutsuDefense'].map(key => [key, 100])),
        ryo: 1000, inventory: [], itemStacks: [], equipment: {}, pets: [], tileCards: [], jutsuMastery: [],
        equippedJutsuIds: [], pendingCombatMissionClaims: [],
    };
    const saved = await request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': 'live-express-e2e-admin' },
        data: { character, worldGeoV: WORLD_GEO_VERSION, currentSector: 12, currentTile: 65, acceptedMissionIds: [], missionProgress: {}, triggeredEvents: [AURA_SPHERE_VN_ID] },
    });
    expect(saved.status(), await saved.text()).toBe(200);
    for (let i = 0; i < 3; i++) expect((await request.get(`/api/save/${name}`, { headers })).status()).toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    const canonical = await (await request.get(`/api/save/${name}`, { headers })).json();
    const beat = await request.post('/api/player/heartbeat', {
        headers, data: { name, sector: 12, tile: 65, character: canonical.character },
    });
    expect(beat.status(), await beat.text()).toBe(200);
    expect((await beat.json()).sector, 'fixture presence must be in the duel sector').toBe(12);
    return { name, token, headers, canonical };
}

type Fighter = Awaited<ReturnType<typeof seed>>;

async function createDuel(request: APIRequestContext, p1: Fighter, p2: Fighter) {
    const attack = await request.post('/api/player/attack', {
        headers: p1.headers, data: { targetName: p2.name, attacker: { name: p1.name } },
    });
    expect(attack.status(), await attack.text()).toBe(200);
    const created = await request.post('/api/pvp/session', {
        headers: p1.headers, data: { p1Character: { name: p1.name }, p2Character: { name: p2.name },
            baseRewards: true, rewardSector: 12, useCurrentVitals: true, requireWorldCoLocation: true },
    });
    expect(created.status(), await created.text()).toBe(200);
    const session = await created.json();
    expect(session.session.rewardAuthority).toBe('world');
    return String(session.battleId);
}

async function boot(page: Page, account: Fighter, battleId?: string, role: 'p1' | 'p2' = 'p1') {
    let socketReportedLive = false;
    page.on('request', outgoing => {
        if (outgoing.url().includes('/api/player/heartbeat') && outgoing.method() === 'POST'
            && outgoing.postDataJSON()?.socketLive === true) socketReportedLive = true;
    });
    await page.addInitScript(({ player, battleId, role, patch }) => {
        if (localStorage.getItem('pvp-journey-installed')) return;
        localStorage.setItem('pvp-journey-installed', '1');
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: player.name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [player.name]: { token: player.token } }));
        localStorage.setItem('shinobix:activePlayerPersist', player.name);
        localStorage.setItem('shinobix:activeTokenPersist', player.token);
        localStorage.setItem(`ninjav-save-preview-v1:${player.name}`, JSON.stringify(player.canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        if (battleId) localStorage.setItem('pvpSession.v1', JSON.stringify({
            owner: player.name, pvpBattleId: battleId, pvpRole: role,
            pvpBattleContext: { mode: 'standard', sectorAttack: true, sector: 12, raidKind: role === 'p1' ? 'raidPlayer' : 'defense' }, savedAt: Date.now(),
        }));
    }, { player: account, battleId, role, patch: LATEST_PATCH_NOTE.version });
    await page.goto(battleId ? '/#/pvpBattle' : '/#/worldMap', { waitUntil: 'domcontentloaded' });
    await expect(page.locator(`.app-shell[data-screen="${battleId ? 'pvpBattle' : 'worldMap'}"]`)).toBeVisible({ timeout: 45_000 });
    if (process.env.LIVE_E2E_REALTIME === '1') {
        await expect.poll(() => socketReportedLive, { message: 'the player must confirm a live real-time connection', timeout: 30_000 }).toBe(true);
    }
}

async function assertCanTravel(request: APIRequestContext, account: Fighter) {
    const response = await request.post('/api/player/travel', {
        headers: account.headers, data: { destinationSector: 13, mode: 'map' },
    });
    expect(response.status(), await response.text()).toBe(200);
}

test('cancel an unjoined world duel, refresh both players, and travel again', async ({ page, browser, request }, info) => {
    const p1 = await seed(request, 'cancela');
    const p2 = await seed(request, 'cancelb');
    const battleId = await createDuel(request, p1, p2);
    const p2Context = await browser.newContext({ baseURL: String(info.project.use.baseURL), viewport: info.project.use.viewport,
        isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch, reducedMotion: 'reduce' });
    try {
        await boot(page, p1, battleId);
        await page.getByRole('button', { name: /Cancel Duel/ }).click();
        await expect(page.getByRole('heading', { name: 'Duel Cancelled' })).toBeVisible();
        await expect(page.getByText('Cancellation confirmed.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
        await page.screenshot({ path: info.outputPath('cancel-confirmed.png') });
        await page.getByRole('button', { name: 'Return to Sector 12' }).click();
        await expect(page.locator('.app-shell[data-screen="worldMap"]')).toBeVisible();
        await page.reload();
        await expect(page.locator('.app-shell[data-screen="worldMap"]')).toBeVisible();
        const defender = await p2Context.newPage();
        await boot(defender, p2);
        await expect(defender.locator('.app-shell[data-screen="worldMap"]')).toBeVisible();
        for (const account of [p1, p2]) {
            const pending = await request.get(`/api/pvp/session?pending=1&playerName=${account.name}&recoveryProbeVersion=2`, { headers: account.headers });
            expect(pending.status(), await pending.text()).toBe(204);
            const history = await request.get('/api/pvp/combat-history', { headers: account.headers });
            expect(history.status(), await history.text()).toBe(200);
            expect((await history.json()).entries).toEqual([]);
            await assertCanTravel(request, account);
        }
    } finally { await p2Context.close(); }
});

test('two players join, take turns, refresh, finish, and recover lost claim and ACK responses', async ({ page, browser, request }, info) => {
    test.setTimeout(180_000);
    const p1 = await seed(request, 'livea');
    const p2 = await seed(request, 'liveb');
    const battleId = await createDuel(request, p1, p2);
    const p2Context = await browser.newContext({ baseURL: String(info.project.use.baseURL), viewport: info.project.use.viewport,
        isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch, reducedMotion: 'reduce' });
    const state = async () => (await request.get(`/api/pvp/session?id=${battleId}`, { headers: p1.headers })).json();
    try {
        const defender = await p2Context.newPage();
        await boot(page, p1, battleId);
        await boot(defender, p2, battleId, 'p2');
        await expect.poll(async () => (await state()).joined).toEqual({ p1: true, p2: true });
        await expect(page.locator('.pvp-countdown-overlay')).toHaveCount(0);
        await expect(defender.locator('.pvp-countdown-overlay')).toHaveCount(0);
        const firstRole = (await state()).activePlayer;
        await (firstRole === 'p1' ? page : defender).getByRole('button', { name: /Wait End turn/i }).click();
        await expect.poll(async () => (await state()).activePlayer).not.toBe(firstRole);
        await defender.reload();
        await expect(defender.locator('.pvp-battle-layout')).toBeVisible();
        // The client resends a lost claim or ACK on its own before it offers
        // Retry, so drop that whole automatic run to reach the manual path.
        const triesPerPress = 1 + PVP_CLAIM_TRANSIENT_RETRY_DELAYS_MS.length;
        let droppedClaims = 0;
        let droppedAcks = 0;
        await page.route('**/api/pvp/claim-rewards', async route => {
            const ack = route.request().postDataJSON()?.completionAck === true;
            if (ack ? droppedAcks < triesPerPress : droppedClaims < triesPerPress) {
                const committed = await route.fetch({ maxRetries: API_CONNECTION_RETRIES });
                expect(committed.status(), await committed.text()).toBe(200);
                if (ack) droppedAcks += 1;
                else droppedClaims += 1;
                await route.abort('failed');
            } else await route.continue();
        });
        // Repeated real flee attempts end either in escape or in the recorded
        // HP cost reaching zero. No terminal state or combat response is mocked.
        for (let attempt = 0; attempt < 20; attempt++) {
            const current = await state();
            if (current.status === 'done') break;
            const actor = current.activePlayer === 'p1' ? page : defender;
            await actor.getByRole('button', { name: /^Flee /i }).click({ timeout: 15_000 });
            await expect.poll(async () => (await state()).stateRevision).toBeGreaterThan(current.stateRevision);
            // A failed flee spends all AP; let the existing auto-pass finish
            // before choosing the next actor from authoritative turn state.
            await expect.poll(async () => {
                const next = await state();
                return next.status === 'done' || next.activePlayer !== current.activePlayer;
            }).toBe(true);
        }
        await expect.poll(async () => (await state()).status).toBe('done');
        await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
        expect(droppedClaims, 'the lost claim was resent automatically before Retry was offered').toBe(triesPerPress);
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await expect.poll(() => droppedAcks).toBe(triesPerPress);
        await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
        // The first successful continuation also settles first-win achievement
        // rewards. Compare only after those legitimate credits and the ACK
        // have committed, then prove replay cannot pay any of them again.
        const beforeAckRetry = await (await request.get(`/api/save/${p1.name}`, { headers: p1.headers })).json();
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        for (const actor of [page, defender]) {
            await expect(actor.getByText('Result secured by the server.')).toBeVisible({ timeout: 30_000 });
            await expect(actor.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
        }
        const afterRetry = await (await request.get(`/api/save/${p1.name}`, { headers: p1.headers })).json();
        expect(afterRetry.character.ryo).toBe(beforeAckRetry.character.ryo);
        expect(afterRetry.character.totalPvpKills ?? 0).toBe((await state()).winner === 'p1' ? 1 : 0);
        await page.screenshot({ path: info.outputPath('pvp-completion-recovered.png') });
        for (const [actor, account] of [[page, p1], [defender, p2]] as const) {
            const pending = await request.get(`/api/pvp/session?pending=1&playerName=${account.name}&recoveryProbeVersion=2`, { headers: account.headers });
            expect(pending.status(), await pending.text()).toBe(204);
            const history = await request.get('/api/pvp/combat-history', { headers: account.headers });
            expect(history.status(), await history.text()).toBe(200);
            expect((await history.json()).entries).toEqual([expect.objectContaining({
                battleId, opponent: account.name === p1.name ? p2.name : p1.name,
            })]);
            await actor.getByRole('button', { name: /Return to Sector 12|Return to Hospital/ }).click();
            await expect(actor.locator('.app-shell[data-screen="pvpBattle"]')).toHaveCount(0);
            const ownerSave = await (await request.get(`/api/save/${account.name}`, { headers: account.headers })).json();
            if (!ownerSave.character.hospitalized) await assertCanTravel(request, account);
        }
    } finally { await p2Context.close(); }
});
