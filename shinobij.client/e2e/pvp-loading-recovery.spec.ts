import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createRequire } from 'node:module';
import { STARTER_PETS } from '../src/data/starter-pets';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

async function bootBattle(page: Page, runtime: Awaited<ReturnType<typeof installUiAuditRuntime>>, screen: string) {
    // Battle URLs cannot create a fight. Resume the same account-scoped
    // navigation breadcrumb a real accepted match records before a refresh.
    await page.addInitScript(screen => {
        sessionStorage.setItem('navigation.v1:auditninja', JSON.stringify({ screen, trail: ['worldMap'] }));
        localStorage.setItem('navigation.v1:auditninja:screen', screen);
    }, screen);
    await expectUiAuditBoot(page, runtime, screen);
}

async function verifyClanDuoLoad(page: Page, info: TestInfo, verifyPortrait = false) {
    const load = createRequire(import.meta.url);
    const { createTowerSession }: typeof import('../../api/towers/_tower-session') = load('../../dist/api/towers/_tower-session.js');
    const actors = ['AuditNinja', 'Correct Teammate', 'Correct Rival One', 'Correct Rival Two'].map((name, index) => ({
        id: `sealed-fighter-${index}`, side: index < 2 ? 'squad' as const : 'enemy' as const,
        name, ownerSlug: name.toLowerCase(), ai: false, pos: [0, 8, 55, 63][index],
        hp: 1000, maxHp: 1000, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], cooldowns: {}, character: { ...uiAuditSave().character, name },
    }));
    const combat = createTowerSession({ towerId: 'team-pvp', runId: 'sealed-duo-match', floor: 1, seed: 42, partySize: 2,
        map: { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors, objectiveKind: 'defeat-all', now: Date.now() });
    combat.turnQueue = actors.map(actor => actor.id);
    combat.activeAp = 5;
    const match = { matchId: 'sealed-duo-match', combat, rules: { consumables: 'enabled' } };
    const runtime = await installUiAuditRuntime(page);
    const rivalPortrait = `/api/img?id=${encodeURIComponent('avatar:correct rival one')}`;
    await page.route('**/api/img?*', route => new URL(route.request().url()).searchParams.get('id') === 'avatar:correct rival one'
        ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#944c17"/><text x="32" y="42" text-anchor="middle" font-size="28" fill="white">R1</text></svg>' })
        : route.fallback());
    const portraits = { 'avatar:correct rival one': rivalPortrait };
    await page.route('**/api/images?*', route => {
        const query = new URL(route.request().url()).searchParams;
        return route.fulfill({ json: query.get('ids') === '1'
            ? query.get('ver') === '1' ? { version: 'audit-avatar', ids: Object.keys(portraits) } : Object.keys(portraits)
            : portraits });
    });
    await page.addInitScript(() => sessionStorage.setItem('clanWarChallenge.v1', JSON.stringify({
        warId: 'duo-war', challengeId: 'duo-challenge', mode: 'pvp2v2',
    })));
    let starts = 0;
    await page.route('**/api/clan/war/pvp-2v2', route => {
        expect(route.request().postDataJSON()).toEqual({ action: 'start', playerName: 'AuditNinja', warId: 'duo-war', challengeId: 'duo-challenge' });
        return route.fulfill(++starts === 1
            ? { status: 503, json: { error: 'Temporary combat outage' } }
            : { json: { match } });
    });
    await page.route('**/api/towers/pvp-state?*', route => {
        expect(new URL(route.request().url()).searchParams.get('matchId')).toBe(match.matchId);
        return route.fulfill({ json: { match } });
    });
    await bootBattle(page, runtime, 'clanWar2v2');
    await expect(page.getByRole('alert')).toContainText('Temporary combat outage');
    await page.getByRole('button', { name: 'Retry loading battle' }).click();
    await expect(page.locator('.tower-team-pvp-fight')).toBeVisible();
    for (const actor of actors) await expect(page.locator(`#tower-roster-actor-${actor.id}`)).toContainText(actor.name);
    if (verifyPortrait) {
        const portrait = page.locator('#tower-roster-actor-sealed-fighter-2 img');
        await expect(portrait).toHaveAttribute('src', rivalPortrait);
        await expect.poll(() => portrait.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        await expect(page.getByText('UNKNOWN COMBATANT ART', { exact: true })).toHaveCount(0);
    }
    expect(starts).toBe(2);
    await page.screenshot({ path: info.outputPath('clan-2v2-loaded.png') });
}

test('clan shinobi 2v2 retries the accepted match without changing its binding', async ({ page }, info) => {
    await verifyClanDuoLoad(page, info);
});

test('clan shinobi 2v2 loads shared rival portraits and keeps unpictured players distinct from NPCs', async ({ page }, info) => {
    await verifyClanDuoLoad(page, info, true);
});

test('clan pet loading retries without submitting and waits for the actual teammate', async ({ page }) => {
    const pet = { ...STARTER_PETS[0].pet };
    const save = uiAuditSave();
    save.character = { ...save.character, pets: [pet], activePetId: pet.id };
    const runtime = await installUiAuditRuntime(page, save);
    await page.addInitScript(() => sessionStorage.setItem('clanWarChallenge.v1', JSON.stringify({
        warId: 'loading-war', challengeId: 'loading-pets', mode: 'pet2v2',
        fromPlayer: 'AuditNinja', fromPlayer2: 'Teammate', acceptedPlayer: 'Rival', acceptedPlayer2: 'RivalTwo',
    })));
    let states = 0;
    let submits = 0;
    await page.route('**/api/clan/war/pet', route => {
        const body = route.request().postDataJSON();
        expect(body.warId).toBe('loading-war');
        expect(body.challengeId).toBe('loading-pets');
        if (body.action === 'submit') submits++;
        if (body.action === 'state' && ++states === 1) return route.fulfill({ status: 503, json: { error: 'Temporary battle outage' } });
        return route.fulfill({ json: { session: { mode: 'pet2v2', status: 'awaiting-pets', from: [{ name: 'AuditNinja', pet }], to: [] } } });
    });
    await bootBattle(page, runtime, 'clanWarPet');
    await expect(page.getByRole('alert')).toContainText('Temporary battle outage');
    await expect(page.getByRole('button', { name: 'Send into battle' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry loading battle' }).click();
    await expect(page.getByText('Waiting for your teammate to send their pet…')).toBeVisible();
    expect(states).toBeGreaterThanOrEqual(2);
    expect(submits).toBe(0);
});

test('a cold clan pet battle requests its pet art without a prior pet-screen visit', async ({ page }) => {
    const pet = { ...STARTER_PETS[0].pet };
    const runtime = await installUiAuditRuntime(page);
    const categories = new Set<string>();
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname === '/api/images') categories.add(url.searchParams.get('cat') ?? '');
    });
    await page.addInitScript(() => sessionStorage.setItem('clanWarChallenge.v1', JSON.stringify({
        warId: 'cold-pet-war', challengeId: 'cold-pet-duel', fromPlayer: 'AuditNinja', acceptedPlayer: 'Rival',
    })));
    await page.route('**/api/clan/war/pet', route => route.fulfill({ json: { session: {
        status: 'awaiting-pets', mode: 'pet1v1', from: [{ name: 'AuditNinja', pet }], to: [],
    } } }));
    await bootBattle(page, runtime, 'clanWarPet');
    await expect(page.getByText('Waiting for the opposing clan to send their pet…')).toBeVisible();
    await expect.poll(() => categories.has('pet')).toBe(true);
});

test('an accepted clan match waits until the current pet battle exits before replacing its binding', async ({ page }) => {
    const save = uiAuditSave();
    save.character = { ...save.character, clan: 'Audit Clan' };
    const runtime = await installUiAuditRuntime(page, save);
    await page.addInitScript(() => sessionStorage.setItem('clanWarChallenge.v1', JSON.stringify({
        warId: 'old-war', challengeId: 'old-pets', fromPlayer: 'AuditNinja', acceptedPlayer: 'Rival',
    })));
    let releaseWars!: () => void;
    const warGate = new Promise<void>(resolve => { releaseWars = resolve; });
    await page.route('**/api/clan/war/list', async route => {
        await warGate;
        return route.fulfill({ json: { wars: [{
            id: 'next-war', clans: ['Audit Clan', 'Rival Clan'], villages: {}, hp: {}, startedAt: 1, updatedAt: 2, declaredBy: 'AuditNinja', completedChallenges: [],
            pendingChallenges: ['old-pets', 'next-pets'].map(id => ({ id, mode: 'pet1v1', status: 'accepted', fromClan: 'Audit Clan', fromPlayer: 'AuditNinja', acceptedPlayer: 'Rival' })),
        }] } });
    });
    await page.route('**/api/clan/war/pet', route => {
        const next = route.request().postDataJSON().challengeId === 'next-pets';
        return route.fulfill({ json: { session: { status: 'awaiting-pets', mode: 'pet1v1',
            from: [{ name: 'AuditNinja', pet: { ...STARTER_PETS[0].pet, name: next ? 'Next Companion' : 'Current Companion' } }], to: [],
        } } });
    });
    await bootBattle(page, runtime, 'clanWarPet');
    await expect(page.getByText(/Current Companion stands ready/)).toBeVisible();
    const listed = page.waitForResponse('**/api/clan/war/list');
    releaseWars();
    await listed;
    // Allow the accepted-match effect and its lazy launcher to run; neither may
    // replace a battle binding while its owner is still on screen.
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('clanWarChallenge.v1') ?? '{}').challengeId)).toBe('old-pets');
    await page.getByRole('button', { name: 'Return to Clan War', exact: true }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('clanWarChallenge.v1') ?? '{}').challengeId)).toBe('next-pets');
    await expect(page.getByText(/Next Companion stands ready/)).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('clanWarChallenge.v1') ?? '{}').challengeId)).toBe('next-pets');
});

test('a pet replay outage offers a retry and preserves the recorded result', async ({ page }) => {
    const pet = { ...STARTER_PETS[0].pet };
    const runtime = await installUiAuditRuntime(page);
    await page.addInitScript(() => sessionStorage.setItem('clanWarChallenge.v1', JSON.stringify({
        warId: 'replay-war', challengeId: 'replay-pets', fromPlayer: 'AuditNinja', acceptedPlayer: 'Rival',
    })));
    let watches = 0;
    await page.route('**/api/clan/war/pet', route => {
        const body = route.request().postDataJSON();
        if (body.action === 'watch') {
            watches++;
            return route.fulfill(watches === 1
                ? { status: 503, json: { error: 'Temporary replay outage' } }
                : { status: 409, json: { error: 'This battle predates the new arena and cannot be replayed.' } });
        }
        return route.fulfill({ json: { session: { status: 'done', mode: 'pet1v1', winner: 'from-wins', from: [{ name: 'AuditNinja', pet }], to: [{ name: 'Rival', pet }] } } });
    });
    await bootBattle(page, runtime, 'clanWarPet');
    await expect(page.getByRole('alert')).toContainText('Temporary replay outage');
    await page.getByRole('button', { name: 'Retry loading replay' }).click();
    await expect(page.getByText('This battle cannot be replayed, but its result is recorded above.')).toBeVisible();
    await expect(page.getByText('Your pets took the battle — the enemy clan takes damage!')).toBeVisible();
    expect(watches).toBe(2);
});

test('a sector table can open its next duel even when the recorded replay is unavailable', async ({ page }) => {
    const pet = { ...STARTER_PETS[0].pet };
    const save = uiAuditSave();
    save.character = { ...save.character, pets: [pet] };
    const runtime = await installUiAuditRuntime(page, save);
    await page.addInitScript(() => sessionStorage.setItem('sectorWarPet.v1', JSON.stringify({ sectorWarId: 'pet-table-war' })));
    let submits = 0;
    await page.route('**/api/village/sector-pet', route => {
        const body = route.request().postDataJSON();
        expect(body.sectorWarId).toBe('pet-table-war');
        if (body.action === 'watch') return route.fulfill({ status: 503, json: { error: 'Temporary table replay outage' } });
        if (body.action !== 'state') submits++;
        return route.fulfill({ json: { session: { status: 'done', seed: 42, winner: 'p1', viewerSide: 'p1', p1: { name: 'AuditNinja', pet }, p2: { name: 'Rival', pet } } } });
    });
    await bootBattle(page, runtime, 'sectorPet');
    await expect(page.getByRole('alert')).toContainText('Temporary table replay outage');
    await expect(page.getByRole('button', { name: 'Retry loading replay' })).toBeVisible();
    await page.getByRole('button', { name: 'Open a new duel' }).click();
    await expect(page.getByRole('button', { name: 'Send into battle' })).toBeVisible();
    expect(submits).toBe(0);
});

for (const [screen, endpoint, key, context] of [
    ['tilecardsDuel', '/api/clan/war/tilecards', 'clanWarChallenge.v1', { warId: 'card-war', challengeId: 'card-challenge' }],
    ['cardClashFreePlay', '/api/card-clash/match', 'cardClashFreePlay.v1', { matchId: 'free-play-loading' }],
    ['sectorCard', '/api/village/sector-card', 'sectorWarCard.v1', { sectorWarId: 'sector-card-war', engageId: '0123456789abcdef01234567' }],
] as const) {
    test(`${screen} retries failed admission to the same card match`, async ({ page }, info) => {
        const runtime = await installUiAuditRuntime(page);
        await page.addInitScript(({ key, context }) => sessionStorage.setItem(key, JSON.stringify(context)), { key, context });
        let joins = 0;
        const seat = (name: string) => ({ name, lifePoints: 8000, deckCount: 35, handCount: 5, hand: [], monsterZones: [null, null, null, null, null], magicTrapZones: [null, null, null, null, null], graveyard: [] });
        await page.route(`**${endpoint}`, route => {
            const body = route.request().postDataJSON();
            expect(body).toMatchObject(context);
            if (body.action === 'join' && ++joins === 1) return route.fulfill({ status: 503, json: { error: 'Temporary card outage' } });
            if (joins < 2) return route.fulfill({ json: { session: { status: 'awaiting-p2' } } });
            return route.fulfill({ json: { session: {
                rulesVersion: 10, status: 'active', viewerSide: 'p1', firstPlayer: 'p1', activePlayer: 'p1', turnNumber: 1,
                phase: 'main1', normalSummonUsed: false, winner: null, activeField: null, responseWindow: null,
                p1: seat('AuditNinja'), p2: seat('Correct Rival'), log: [], events: [], turnStartedAt: Date.now(),
            } } });
        });
        await bootBattle(page, runtime, screen);
        await page.getByRole('button', { name: 'Retry joining battle' }).click();
        await expect(page.locator('.chronicle-table')).toBeVisible();
        await expect(page.getByText('Correct Rival', { exact: true }).first()).toBeVisible();
        expect(joins).toBe(2);
        await page.screenshot({ path: info.outputPath('card-battle-loaded.png') });
    });
}

test('an open sector pet battle recovers its sealed teams instead of offering a new fight', async ({ page }, info) => {
    const load = createRequire(import.meta.url);
    const { createShowdownSession, showdownStateView }: typeof import('../../api/_pet-showdown/engine') = load('../../dist/api/_pet-showdown/engine.js');
    const pet = { ...STARTER_PETS[0].pet, name: 'Sealed Companion' };
    const rival = { ...pet, id: 'sealed-rival', name: 'Sealed Rival' };
    const match = createShowdownSession({ sessionId: 'open-pet-audit', playerName: 'AuditNinja', format: '1v1', tier: 'warrior', seed: 42,
        playerPets: [pet], enemyPets: [rival], enemyTeamName: 'Correct Rival', rewardEligible: false });
    const initialState = showdownStateView(match);
    match.finished = true;
    match.outcome = 'win';
    const finalState = showdownStateView(match);
    const save = uiAuditSave();
    save.character = { ...save.character, pets: [pet] };
    const runtime = await installUiAuditRuntime(page, save);
    await page.addInitScript(() => {
        sessionStorage.setItem('sectorWarPet.v1', JSON.stringify({ sectorWarId: 'open-pet-war', engageId: '0123456789abcdef01234567' }));
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, ...args: unknown[]) {
            return id === 'webgl2' ? null : Reflect.apply(original, this, [id, ...args]);
        } as typeof original;
    });
    let states = 0;
    let watches = 0;
    await page.route('**/api/village/sector-pet', route => {
        const body = route.request().postDataJSON();
        expect(body.sectorWarId).toBe('open-pet-war');
        expect(body.engageId).toBe('0123456789abcdef01234567');
        if (body.action === 'state') {
            if (++states === 1) return route.fulfill({ status: 503, json: { error: 'Temporary sector outage' } });
            return route.fulfill({ json: { session: { status: 'done', seed: 42, winner: 'p1', viewerSide: 'p1', p1: { name: 'AuditNinja', pet }, p2: { name: 'Correct Rival', pet: rival } } } });
        }
        expect(body.action).toBe('watch');
        watches++;
        return route.fulfill({ json: { script: { initialState, finalState, events: [{ t: 'end', outcome: 'win' }] } } });
    });
    await bootBattle(page, runtime, 'sectorPet');
    await page.getByRole('button', { name: 'Retry loading battle' }).click();
    await expect(page.getByTestId('pet-showdown-root')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send into battle' })).toHaveCount(0);
    expect(watches).toBe(1);
    await page.screenshot({ path: info.outputPath('sealed-pet-battle-loaded.png') });
});
