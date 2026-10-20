import { test, expect, type Page } from '@playwright/test';
import { buildTowerEncounter } from '../../api/towers/_encounter';
import { CLAN_BOSS_FLOORS, getFloor } from '../../api/towers/_floor-catalog';
import { configureClanBossEncounter } from '../../api/clan-boss/_encounter-config';

const character = { name: 'Rill', level: 100, village: 'Ashen Leaf Village', specialty: 'Genjutsu',
    hp: 6_301, maxHp: 10_000, chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500,
    stats: { strength: 1000, speed: 1000, intelligence: 1000, willpower: 1000,
        taijutsuOffense: 1000, taijutsuDefense: 1000, ninjutsuOffense: 1000, ninjutsuDefense: 1000,
        genjutsuOffense: 1000, genjutsuDefense: 1000, bukijutsuOffense: 1000, bukijutsuDefense: 1000 },
    jutsu: [], jutsuMastery: [], equipment: {}, inventory: [], pets: [] };

async function openResult(page: Page, outcome: 'cap' | 'victory' | 'wipe', options: { reject?: boolean; ordinary?: boolean; reconnect?: boolean; defeated?: boolean } = {}) {
    const floor = options.ordinary ? getFloor(1)! : CLAN_BOSS_FLOORS[3]!;
    const session = buildTowerEncounter({ floor, squad: [{ id: 'rill', name: 'Rill', ownerSlug: 'rill', ai: false, character }],
        runId: options.ordinary ? 'tower-result-qa' : 'cboss-result-qa', seed: 7, partySize: 1, now: 1 });
    if (!options.ordinary) {
        const boss = configureClanBossEncounter(session, floor, 22_000);
        boss.hp = outcome === 'victory' ? 0 : 5_253;
    }
    session.status = 'done'; session.winner = outcome === 'victory' ? 'squad' : 'enemy';
    session.round = outcome === 'cap' ? 21 : 10;
    session.objectiveState.completed = outcome === 'victory';
    session.objectiveState.failed = outcome !== 'victory';
    for (const actor of session.actors) {
        if (actor.side === 'squad') actor.hp = outcome === 'wipe' ? 0 : 6_301;
        else if (outcome === 'victory') actor.hp = 0;
    }
    await page.addInitScript(seed => { Object.assign(window, { clanResultSeed: seed }); }, { session, character });
    if (options.ordinary) await page.route('**/api/towers/settle', route => route.fulfill({ json: {
        settled: true, runId: session.runId, winner: session.winner, results: { rill: { paid: false, reason: 'already-paid' } },
    } }));
    const params = new URLSearchParams();
    if (options.reject) params.set('reject', '1');
    if (options.ordinary) params.set('ordinary', '1');
    if (options.defeated) params.set('defeated', '1');
    await page.goto(`/e2e/fixtures/clan-boss-result.html?${params}`);
    if (options.reconnect) await page.reload(); // Rehydrate the same server-owned terminal session.
    return page.getByRole('dialog', { name: options.ordinary ? 'Floor 1 cleared' : options.defeated ? 'Clan boss defeated' : 'Assault ended', exact: true });
}

for (const outcome of ['cap', 'victory', 'wipe'] as const) test(`Clan Boss ${outcome} uses the confirmed shared pool and returns to its operation`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const result = await openResult(page, outcome);
    await expect(result).toContainText('Clan Boss');
    await expect(result).toContainText('Ancient Stone Golem');
    await expect(result).toContainText('Contribution saved. Clan boss health remaining: 5,253 HP.');
    await expect(result).not.toContainText('Clan boss defeated');
    await expect(result).not.toContainText('Your clan has defeated');
    await expect(result).toContainText(outcome === 'victory' ? 'Assault objective complete' : outcome === 'wipe' ? 'Squad defeated' : 'Round limit reached; boss still standing');
    await expect(result).not.toContainText('Floor 9004');
    await expect(result).not.toContainText('Battle Towers');
    if (outcome === 'cap') {
        await expect(result).toContainText('Round limit reached; boss still standing');
        await expect(result.locator('.tower-result-debrief')).toContainText('20 / 20');
        await expect(result.locator('.tower-result-debrief')).not.toContainText('21 / 20');
        await expect(result).not.toContainText('Assault victory');
        await page.screenshot({ path: info.outputPath('clan-golem-cap-result.png'), fullPage: true });
    }
    await result.getByRole('button', { name: 'Return to Clan Boss', exact: true }).click();
    await expect(page.getByTestId('returned-screen')).toHaveText('Clan Boss');
    expect(await page.evaluate(() => (window as unknown as { clanResultQa: object }).clanResultQa)).toEqual({ settlements: 1, exits: 1, commits: 1, bankings: 1 });
    expect(errors).toEqual([]);
});

test('Clan Boss refused settlement holds exit and retries once without claiming a saved result', async ({ page }) => {
    const result = await openResult(page, 'cap', { reject: true });
    await expect(result).toContainText('Contribution receipt pending.');
    await expect(result).not.toContainText('Contribution saved.');
    await expect(result.getByRole('button', { name: 'Return to Clan Boss', exact: true })).toBeDisabled();
    await result.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(result).toContainText('Contribution saved. Clan boss health remaining: 5,253 HP.');
    await result.getByRole('button', { name: 'Return to Clan Boss', exact: true }).click();
    await expect(page.getByTestId('returned-screen')).toHaveText('Clan Boss');
    expect(await page.evaluate(() => (window as unknown as { clanResultQa: object }).clanResultQa)).toEqual({ settlements: 2, exits: 1, commits: 1, bankings: 1 });
});

test('a reconnected terminal assault keeps Clan Boss labels and the host return callback', async ({ page }) => {
    const result = await openResult(page, 'cap', { reconnect: true });
    await expect(result).toContainText('Contribution saved. Clan boss health remaining: 5,253 HP.');
    await result.getByRole('button', { name: 'Return to Clan Boss', exact: true }).click();
    await expect(page.getByTestId('returned-screen')).toHaveText('Clan Boss');
});

test('only a confirmed empty shared pool announces the Clan Boss defeat', async ({ page }) => {
    const result = await openResult(page, 'victory', { defeated: true });
    await expect(result).toContainText("Contribution saved. Your clan has defeated this week's boss.");
    await expect(result).not.toContainText('health remaining: 5,253');
    await result.getByRole('button', { name: 'Return to Clan Boss', exact: true }).click();
    await expect(page.getByTestId('returned-screen')).toHaveText('Clan Boss');
    expect(await page.evaluate(() => (window as unknown as { clanResultQa: object }).clanResultQa)).toEqual({ settlements: 1, exits: 1, commits: 1, bankings: 1 });
});

test('ordinary Tower result and return remain unchanged', async ({ page }) => {
    const result = await openResult(page, 'victory', { ordinary: true });
    await expect(result).toContainText('Battle Towers');
    await expect(result).not.toContainText('Clan Boss');
    await expect(result).not.toContainText('Contribution saved.');
    await result.getByRole('button', { name: 'Leave the Tower', exact: true }).click();
    await expect(page.getByTestId('returned-screen')).toHaveText('Battle Towers');
});

// Keep a single routed server state across reloads. The real Clan Hall, its
// ClanBoss child, API wrappers, polling and fight settlement callback all run.
async function openFullFlow(page: Page, initial: 'active' | 'pending', rejectFirst = false) {
    const clanCharacter = { ...character, clan: 'Review Clan', clanFounder: true, itemStacks: [], ryo: 0 };
    const floor = CLAN_BOSS_FLOORS[3]!;
    const current = buildTowerEncounter({ floor, squad: [{ id: 'rill', name: 'Rill', ownerSlug: 'rill', ai: false,
        character: clanCharacter }], runId: 'cboss-clan-hall-flow', seed: 7, partySize: 1, now: Date.now() });
    const boss = configureClanBossEncounter(current, floor, 22_000);
    const counts = { settlements: 0, bankings: 0, myRun: 0, state: 0, actions: 0 };
    let settled = false;
    const unexpected: string[] = [];
    const finish = (victory: boolean) => {
        current.status = 'done'; current.winner = victory ? 'squad' : 'enemy';
        current.round = victory ? 10 : 21;
        current.objectiveState.completed = victory; current.objectiveState.failed = !victory;
        boss.hp = victory ? 0 : 5_253;
        // An accepted pre-fix session must be rendered contextually without
        // rewriting its persisted combat evidence in the browser.
        current.log = [victory ? 'Floor 9004 cleared!' : 'Round limit reached \u2014 floor failed.'];
        current.actionVersion = (current.actionVersion ?? 0) + 1;
    };
    if (initial === 'pending') finish(true);
    const clan = { name: 'Review Clan', village: character.village, founderName: 'Rill', createdAt: 1,
        level: 8, xp: 300, members: [{ name: 'Rill', village: character.village, level: 100, specialty: 'Genjutsu',
            battleContrib: 0, eventContrib: 0, missionContrib: 0, isFounder: true, month: '2026-10' }],
        treasury: { ryo: 0, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0, warSupply: 0, items: [] },
        warHistory: [], joinRequests: [], notices: [] };
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
        if (path === '/api/save/clan-reviewclan') return json(route.request().method() === 'GET' ? clan : { ok: true });
        if (path === '/api/clan/mission/claim' && route.request().method() === 'GET') return json({ ok: true, claimed: [] });
        if (path === '/api/clan-boss/get') return json({ ok: true, active: true, inClan: true, weekId: 'review-week',
            endsAt: Date.now() + 86_400_000, boss: { id: 'stone-golem', name: 'Ancient Stone Golem', icon: '',
                flavor: 'A persistent threat to Review Clan.', mechanic: 'golem', sectorId: 40 },
            myClan: { clanName: clan.name, pool: settled ? boss.hp : 22_000, poolMax: 22_000, killed: settled && boss.hp === 0,
                damageDealt: settled ? 22_000 - boss.hp : 0, participants: 1, attemptsPerMember: 5, myAttemptsLeft: 4, rank: 1, score: 0 },
            standings: [] });
        if (path === '/api/clan-boss/party') return json({ ok: true, serverNow: Date.now(), party: null,
            invitations: [], publicParties: [], population: { publicParties: 0, openSeats: 0 } });
        if (path === '/api/towers/my-run') {
            counts.myRun++;
            return json(settled ? { runId: null } : { runId: current.runId, session: current });
        }
        if (path === '/api/towers/state') { counts.state++; return json({ session: current }); }
        if (path === '/api/towers/join') {
            expect(route.request().postDataJSON()).toMatchObject({ runId: current.runId, playerName: 'Rill' });
            return json({ session: current });
        }
        if (path === '/api/towers/action') { counts.actions++; return json({ applied: false, session: current }); }
        if (path === '/api/clan-boss/assault-settle') {
            expect(route.request().postDataJSON()).toEqual({ runId: current.runId, playerName: 'Rill' });
            counts.settlements++;
            if (rejectFirst && counts.settlements === 1) return json({ error: 'Contribution receipt pending.', retryable: true }, 503);
            if (!settled) counts.bankings++;
            settled = true; current.rewardSettlementState = 'settled';
            return json({ ok: true, settled: true, alreadySettled: counts.settlements > 1,
                character: clanCharacter, _saveVersion: 7, result: { won: current.winner === 'squad', damage: 22_000 - boss.hp }, pool: boss.hp });
        }
        unexpected.push(`${route.request().method()} ${path}`);
        return json({ error: 'Unrouted full-flow API request' }, 404);
    });
    await page.addInitScript(seed => { Object.assign(window, { clanResultSeed: seed }); }, { session: current, character: clanCharacter });
    await page.goto('/e2e/fixtures/clan-boss-result.html?fullFlow=1');
    await expect(page.locator('.clan-hall-screen')).toBeVisible();
    await expect(page.locator('.clan-boss-operation')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    return { counts, finish, unexpected, persistedLog: () => current.log };
}

async function expectActualHallWithoutRecovery(page: Page, server: Awaited<ReturnType<typeof openFullFlow>>) {
    await expect(page.locator('.clan-boss-operation-fight')).toHaveCount(0);
    await expect(page.locator('.clan-hall-screen .clan-boss-operation')).toBeVisible();
    await expect(page.getByText('Assault resolved. Contribution, profession, clan, and sector results are sealed below.', { exact: true })).toBeVisible();
    await expect(page.locator('.operation-rejoin')).toHaveCount(0);
    const requests = server.counts.myRun;
    await expect.poll(() => server.counts.myRun).toBeGreaterThan(requests);
    await expect(page.locator('.operation-rejoin')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.clan-hall-screen .clan-boss-operation')).toBeVisible();
    await expect(page.locator('.operation-rejoin')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(server.counts.bankings).toBe(1);
    expect(server.unexpected).toEqual([]);
}

test('actual Clan Hall rejoins an accepted active assault and removes recovery after terminal settlement', async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const server = await openFullFlow(page, 'active');
    await expect(page.getByRole('button', { name: 'Rejoin your accepted operation', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finish assault results', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Rejoin your accepted operation', exact: true }).click();
    await expect(page.locator('.clan-boss-operation-fight')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Tactical battlefield', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => server.counts.state).toBeGreaterThan(0);
    server.finish(false);
    const result = page.getByRole('dialog', { name: 'Assault limit reached', exact: true });
    await expect(result).toContainText('Your contribution is saved to the clan boss operation.');
    await expect(page.locator('.tower-rail-battle-log')).toContainText('Round limit reached \u2014 assault ended.');
    await expect(page.locator('.tower-rail-battle-log')).not.toContainText('floor failed');
    await page.screenshot({ path: info.outputPath('actual-clan-cap-result.png'), fullPage: true });
    await result.getByRole('button', { name: 'Return to Clan Hall', exact: true }).click();
    await expectActualHallWithoutRecovery(page, server);
    await page.screenshot({ path: info.outputPath('actual-clan-hall-after-reload.png'), fullPage: true });
    expect(server.counts.settlements).toBe(1);
    expect(errors).toEqual([]);
});

test('actual Clan Hall recovers pending legacy results, refuses exit until retry, and clears stale Rejoin', async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const server = await openFullFlow(page, 'pending', true);
    await expect(page.getByRole('button', { name: 'Finish assault results', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rejoin your accepted operation', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('actual-clan-pending-results.png'), fullPage: true });
    await page.getByRole('button', { name: 'Finish assault results', exact: true }).click();
    const result = page.getByRole('dialog', { name: 'Assault victory', exact: true });
    await expect(result).toContainText('Contribution receipt pending.');
    await expect(result).not.toContainText('Your contribution is saved');
    await expect(result.getByRole('button', { name: 'Return to Clan Hall', exact: true })).toBeDisabled();
    await expect(page.locator('.tower-rail-battle-log')).toContainText('Clan Boss assault cleared!');
    await expect(page.locator('.tower-rail-battle-log')).not.toContainText('Floor 9004 cleared!');
    expect(server.persistedLog()).toEqual(['Floor 9004 cleared!']);
    await page.screenshot({ path: info.outputPath('actual-clan-settlement-retry.png'), fullPage: true });
    if (info.project.name === 'desktop') await page.locator('.tower-rail-battle-log').screenshot({
        path: info.outputPath('actual-clan-legacy-log-projection.png'),
    });
    await result.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(result).toContainText('Your contribution is saved to the clan boss operation.');
    await result.getByRole('button', { name: 'Return to Clan Hall', exact: true }).click();
    await expectActualHallWithoutRecovery(page, server);
    expect(server.counts.settlements).toBe(2);
    expect(errors).toEqual([]);
});
