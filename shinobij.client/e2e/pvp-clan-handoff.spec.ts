import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { STARTER_PETS } from '../src/data/starter-pets';

test('a restored clan shinobi duel does not reopen from a stale accepted challenge on exit', async ({ page }) => {
    const save = uiAuditSave();
    save.character = { ...save.character, clan: 'Audit Clan' };
    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => localStorage.setItem('pvpSession.v1', JSON.stringify({
        owner: 'auditninja', pvpBattleId: 'completed-clan-duel', pvpRole: 'p1', savedAt: Date.now(),
        pvpBattleContext: { mode: 'clanWar1v1', clanWarChallengeId: 'viewed-duel', clanWarReturnScreen: 'clan' },
    })));
    const fighter = (name: string, pos: number) => ({ name, pos, hp: 500, maxHp: 500, chakra: 500, maxChakra: 500,
        stamina: 500, maxStamina: 500, shield: 0, statuses: [], character: { ...save.character, name } });
    const session = { battleId: 'completed-clan-duel', stateRevision: 2, p1: fighter('AuditNinja', 10), p2: fighter('Rival', 30),
        round: 1, activePlayer: 'p1', ap: { p1: 100, p2: 100 }, actionsThisTurn: 0, cooldowns: { p1: {}, p2: {} },
        log: [], status: 'done', winner: 'p2', joined: { p1: true, p2: true }, createdAt: Date.now(), endedAt: Date.now() };
    let starts = 0;
    await page.route('**/api/pvp/session**', route => {
        if (route.request().method() === 'POST') {
            starts++;
            return route.fulfill({ status: 409, json: { error: 'This challenge already finished.' } });
        }
        return route.fulfill({ json: session });
    });
    await page.route('**/api/pvp/move', route => route.fulfill({ json: session }));
    await page.route('**/api/pvp/claim-rewards', route => route.fulfill({ json: { ok: true, alreadyClaimed: true,
        completionPending: false, rewardAuthorized: false, character: save.character, _saveVersion: 999 } }));
    let releaseList!: () => void;
    const gate = new Promise<void>(resolve => { releaseList = resolve; });
    await page.route('**/api/clan/war/list', async route => {
        await gate;
        return route.fulfill({ json: { wars: [{ id: 'completed-war', clans: ['Audit Clan', 'Rival Clan'], villages: {}, hp: {},
            startedAt: 1, updatedAt: 2, declaredBy: 'AuditNinja', completedChallenges: [], pendingChallenges: [{
                id: 'viewed-duel', mode: 'pvp1v1', status: 'accepted', fromClan: 'Audit Clan', fromPlayer: 'AuditNinja', acceptedPlayer: 'Rival',
            }, { id: 'next-pets', mode: 'pet1v1', status: 'accepted', fromClan: 'Audit Clan', fromPlayer: 'AuditNinja', acceptedPlayer: 'Rival' }] }] } });
    });
    await page.route('**/api/clan/war/pet', route => {
        expect(route.request().postDataJSON()).toMatchObject({ warId: 'completed-war', challengeId: 'next-pets' });
        return route.fulfill({ json: { session: {
            status: 'awaiting-pets', mode: 'pet1v1', from: [{ name: 'AuditNinja', pet: { ...STARTER_PETS[0].pet, name: 'Next Companion' } }], to: [],
        } } });
    });
    await page.goto('/#/pvpBattle');
    const leave = page.getByRole('button', { name: 'Return to Clan War', exact: true });
    await expect(leave).toBeEnabled();
    const listed = page.waitForResponse('**/api/clan/war/list');
    releaseList();
    await listed;
    await leave.click();
    await expect(page.getByText(/Next Companion stands ready/)).toBeVisible();
    expect(starts).toBe(0);
});

test('the next clan 2v2 match clears the previous load failure while the return hub is still loading', async ({ page }) => {
    const save = uiAuditSave();
    save.character = { ...save.character, clan: 'Audit Clan' };
    const runtime = await installUiAuditRuntime(page, save);
    await page.addInitScript(() => {
        sessionStorage.setItem('clanWarChallenge.v1', JSON.stringify({ warId: 'old-war', challengeId: 'old-duo' }));
        sessionStorage.setItem('navigation.v1:auditninja', JSON.stringify({ screen: 'clanWar2v2', trail: ['clan'] }));
        localStorage.setItem('navigation.v1:auditninja:screen', 'clanWar2v2');
    });
    const load = createRequire(import.meta.url);
    const { createTowerSession }: typeof import('../../api/towers/_tower-session') = load('../../dist/api/towers/_tower-session.js');
    const actors = ['AuditNinja', 'New Teammate', 'New Rival One', 'New Rival Two'].map((name, index) => ({
        id: `next-fighter-${index}`, side: index < 2 ? 'squad' as const : 'enemy' as const,
        name, ownerSlug: name.toLowerCase(), ai: false, pos: [0, 8, 55, 63][index],
        hp: 1000, maxHp: 1000, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], cooldowns: {}, character: { ...save.character, name },
    }));
    const combat = createTowerSession({ towerId: 'team-pvp', runId: 'next-duo-match', floor: 1, seed: 42, partySize: 2,
        map: { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] }, actors, objectiveKind: 'defeat-all', now: Date.now() });
    combat.turnQueue = actors.map(actor => actor.id);
    combat.activeAp = 5;
    const match = { matchId: 'next-duo-match', combat, rules: { consumables: 'enabled' } };
    const manifest = JSON.parse(readFileSync(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8'));
    let releaseHub!: () => void;
    const hubGate = new Promise<void>(resolve => { releaseHub = resolve; });
    await page.route(`**/${manifest['src/screens/ClanHall.tsx'].file}`, async route => { await hubGate; await route.continue(); });
    let releaseWars!: () => void;
    const warGate = new Promise<void>(resolve => { releaseWars = resolve; });
    await page.route('**/api/clan/war/list', async route => {
        await warGate;
        return route.fulfill({ json: { wars: [{ id: 'next-war', clans: ['Audit Clan', 'Rival Clan'], villages: {}, hp: {},
            startedAt: 1, updatedAt: 2, declaredBy: 'AuditNinja', completedChallenges: [], pendingChallenges: [{
                id: 'next-duo', mode: 'pvp2v2', status: 'accepted', fromClan: 'Audit Clan', fromPlayer: 'AuditNinja',
                fromPlayer2: 'New Teammate', acceptedPlayer: 'New Rival One', acceptedPlayer2: 'New Rival Two',
            }] }] } });
    });
    await page.route('**/api/clan/war/pvp-2v2', route => {
        const body = route.request().postDataJSON();
        if (body.challengeId === 'old-duo') return route.fulfill({ status: 503, json: { error: 'Previous match unavailable' } });
        expect(body).toMatchObject({ warId: 'next-war', challengeId: 'next-duo' });
        return route.fulfill({ json: { match } });
    });
    await page.route('**/api/towers/pvp-state?*', route => {
        expect(new URL(route.request().url()).searchParams.get('matchId')).toBe(match.matchId);
        return route.fulfill({ json: { match } });
    });
    try {
        await expectUiAuditBoot(page, runtime, 'clanWar2v2');
        await expect(page.getByRole('alert')).toContainText('Previous match unavailable');
        const listed = page.waitForResponse('**/api/clan/war/list');
        releaseWars();
        await listed;
        await page.getByRole('button', { name: /Back to Clan Hall/ }).click();
        await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('clanWarChallenge.v1') ?? '{}').challengeId)).toBe('next-duo');
        releaseHub();
        await expect(page.locator('.tower-team-pvp-fight')).toBeVisible();
        await expect(page.locator('#tower-roster-actor-next-fighter-2')).toContainText('New Rival One');
        await expect(page.getByText('Previous match unavailable', { exact: true })).toHaveCount(0);
    } finally { releaseHub(); releaseWars(); }
});

test('the next clan card match replaces the previous table while the return hub is still loading', async ({ page }) => {
    const save = uiAuditSave();
    save.character = { ...save.character, clan: 'Audit Clan' };
    const runtime = await installUiAuditRuntime(page, save);
    await page.addInitScript(() => {
        sessionStorage.setItem('clanWarChallenge.v1', JSON.stringify({ warId: 'old-war', challengeId: 'old-cards' }));
        sessionStorage.setItem('navigation.v1:auditninja', JSON.stringify({ screen: 'tilecardsDuel', trail: ['clan'] }));
        localStorage.setItem('navigation.v1:auditninja:screen', 'tilecardsDuel');
    });
    const manifest = JSON.parse(readFileSync(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8'));
    let releaseHub!: () => void;
    const hubGate = new Promise<void>(resolve => { releaseHub = resolve; });
    await page.route(`**/${manifest['src/screens/ClanHall.tsx'].file}`, async route => { await hubGate; await route.continue(); });
    let releaseWars!: () => void;
    const warGate = new Promise<void>(resolve => { releaseWars = resolve; });
    await page.route('**/api/clan/war/list', async route => {
        await warGate;
        return route.fulfill({ json: { wars: [{ id: 'next-war', clans: ['Audit Clan', 'Rival Clan'], villages: {}, hp: {},
            startedAt: 1, updatedAt: 2, declaredBy: 'AuditNinja', completedChallenges: [], pendingChallenges: [{
                id: 'next-cards', mode: 'tilecards', status: 'accepted', fromClan: 'Audit Clan', fromPlayer: 'AuditNinja', acceptedPlayer: 'Next Rival',
            }] }] } });
    });
    let nextJoins = 0;
    const seat = (name: string) => ({ name, lifePoints: 8000, deckCount: 35, handCount: 5, hand: [],
        monsterZones: [null, null, null, null, null], magicTrapZones: [null, null, null, null, null], graveyard: [] });
    await page.route('**/api/clan/war/tilecards', route => {
        const body = route.request().postDataJSON();
        if (body.challengeId === 'old-cards') return route.fulfill({ json: { session: { status: 'awaiting-p2' } } });
        expect(body).toMatchObject({ warId: 'next-war', challengeId: 'next-cards' });
        if (body.action === 'join') nextJoins++;
        return route.fulfill({ json: { session: { rulesVersion: 10, status: 'active', viewerSide: 'p1', firstPlayer: 'p1',
            activePlayer: 'p1', turnNumber: 1, phase: 'main1', normalSummonUsed: false, winner: null, activeField: null, responseWindow: null,
            p1: seat('AuditNinja'), p2: seat('Next Rival'), log: [], events: [], turnStartedAt: Date.now(),
        } } });
    });
    try {
        await expectUiAuditBoot(page, runtime, 'tilecardsDuel');
        await expect(page.getByRole('heading', { name: 'Preparing the table' })).toBeVisible();
        const listed = page.waitForResponse('**/api/clan/war/list');
        releaseWars();
        await listed;
        await page.getByRole('button', { name: 'Return to Clan War', exact: true }).click();
        await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('clanWarChallenge.v1') ?? '{}').challengeId)).toBe('next-cards');
        releaseHub();
        await expect(page.getByText('Next Rival', { exact: true }).first()).toBeVisible();
        expect(nextJoins).toBe(1);
    } finally { releaseHub(); releaseWars(); }
});
