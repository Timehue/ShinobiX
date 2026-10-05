import { test, expect, type Page } from '@playwright/test';
import type { TournamentMode } from '../../shared/tournaments';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';
async function api(page: Page, path: string, body?: unknown) {
    return page.evaluate(async ({ path, body }) => {
        const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
        const data = await response.json();
        if (!response.ok) throw new Error(`${path}: ${response.status}: ${JSON.stringify(data)}`);
        return data;
    }, { path, body });
}

test('production app boot resumes a tournament into Arena District and keeps its battle controls functional', async ({ page, request }) => {
    expect((await request.post('/qa-tournament/reset')).ok()).toBeTruthy();
    const player = await (await request.get('/qa-tournament/player/akira')).json();
    const other = await (await request.get('/qa-tournament/player/ren')).json();
    const headers = { 'x-player-token': player.token, 'x-player-name': 'akira' };
    const otherHeaders = { 'x-player-token': other.token, 'x-player-name': 'ren' };
    const created = await request.post('/api/tournaments/event', { headers: { 'x-admin-password': 'qa-admin' }, data: {
        action: 'create', name: 'Production recovery cup', mode: 'standard', signupMinutes: 1, maxEntries: 8, readySeconds: 300, petFormat: '1v1', notes: '',
    } });
    expect(created.ok(), await created.text()).toBeTruthy();
    const event = (await created.json()).event;
    for (const auth of [headers, otherHeaders]) expect((await request.post('/api/tournaments/event', { headers: auth, data: { action: 'join', eventId: event.id } })).ok()).toBeTruthy();
    const opened = await request.post('/qa-tournament/advance', { data: { ms: 60_001 } });
    const match = (await opened.json()).event.matches[0];
    for (const auth of [headers, otherHeaders]) expect((await request.post('/api/tournaments/event', { headers: auth, data: { action: 'ready', eventId: event.id, matchId: match.id } })).ok()).toBeTruthy();
    await page.addInitScript(({ player, patch }) => {
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: 'akira' }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ akira: { token: player.token } }));
        localStorage.setItem('shinobix:activePlayerPersist', 'akira');
        localStorage.setItem('shinobix:activeTokenPersist', player.token);
        localStorage.setItem('ninjav-save-preview-v1:akira', JSON.stringify(player.canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
    }, { player, patch: LATEST_PATCH_NOTE.version });
    await page.goto('http://127.0.0.1:5198/#/worldMap', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-shell[data-screen="arenaDistrict"]')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Enter tournament match' }).click();
    await expect(page.getByRole('heading', { name: /1v1 Tournament/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ranked', exact: true, includeHidden: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Forfeit', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Return to Tournament' })).toBeEnabled();
    await page.getByRole('button', { name: 'Return to Tournament' }).click();
    await expect(page.getByRole('heading', { name: /1v1 Tournament/ })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('shinobix:towerRunId'))).toBeNull();
});
for (const mode of ['standard', 'ranked', '2v2', 'pet'] as TournamentMode[]) {
    test(`${mode}: real admin, authenticated signup, timer, battle, reconnect and bracket result`, async ({ page, browser, request }, info) => {
        expect((await request.post('/qa-tournament/reset')).ok()).toBeTruthy();
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('/tournament-qa.html?admin&live', { waitUntil: 'domcontentloaded' });
        await page.getByLabel('Tournament name').fill(`Integration ${mode}`);
        await page.getByLabel('Type and rules').selectOption(mode);
        await page.getByLabel('Signup timer (minutes)').fill('1');
        await page.getByRole('button', { name: 'Start signup timer' }).click();
        await expect(page.getByRole('button', { name: 'Cancel tournament', exact: true })).toBeVisible();
        const names = mode === '2v2' || mode === 'standard' ? ['akira', 'ren', 'sora', 'yuki'] : ['akira', 'ren'];
        const contexts = await Promise.all(names.map(() => browser.newContext({ baseURL: String(info.project.use.baseURL), reducedMotion: 'reduce' })));
        const players = await Promise.all(contexts.map(c => c.newPage()));
        try {
            for (let i = 0; i < names.length; i++) {
                players[i].on('pageerror', error => errors.push(error.message));
                await players[i].goto(`/tournament-qa.html?live&player=${names[i]}`, { waitUntil: 'domcontentloaded' });
                if (mode === '2v2') {
                    if (i % 2 === 0) {
                        await players[i].getByLabel('Partner’s player name').fill(names[i + 1]);
                        await players[i].getByRole('button', { name: 'Sign up and invite partner' }).click();
                    } else await players[i].getByRole('button', { name: 'Accept pair invitation' }).click();
                } else {
                    if (mode === 'pet') await players[i].getByRole('checkbox').first().check();
                    await players[i].getByRole('button', { name: 'Sign up', exact: true }).click();
                }
                await expect(players[i].getByRole('button', { name: 'Withdraw entry' })).toBeVisible();
            }
            const start = await request.post('/qa-tournament/advance', { data: { ms: 60_001 } });
            expect(start.ok(), await start.text()).toBeTruthy();
            const event = (await start.json()).event;
            expect(event.status).toBe('live');
            for (const player of players) await player.getByRole('button', { name: 'Ready for this round' }).click();
            if (mode === 'pet') {
                await expect(players[0].getByText('Champion ·', { exact: false })).toBeVisible();
                await expect(players[1].getByRole('button', { name: 'Watch Colosseum match' })).toBeVisible();
                const replayA = await api(players[0], '/api/tournaments/event', { action: 'battle', eventId: event.id, matchId: event.matches[0].id });
                const replayB = await api(players[1], '/api/tournaments/event', { action: 'battle', eventId: event.id, matchId: event.matches[0].id });
                expect(replayA.script).toEqual(replayB.script);
                expect(replayA.script.events.length).toBeGreaterThan(0);
            } else {
                await players[0].getByRole('button', { name: 'Enter tournament match' }).click();
                await expect(players[0].getByRole('heading', { name: new RegExp(`${mode === '2v2' ? '2v2' : '1v1'} Tournament`) })).toBeVisible();
                await expect(players[0].getByRole('button', { name: 'Ranked', exact: true })).toBeDisabled();
                // Re-enter from real server state after a browser refresh.
                await players[0].reload({ waitUntil: 'domcontentloaded' });
                await players[0].getByRole('button', { name: 'Enter tournament match' }).click();
                await expect(players[0].getByRole('button', { name: 'Forfeit', exact: true })).toBeVisible();
                await players[0].getByRole('button', { name: 'Forfeit', exact: true }).click();
                await players[0].getByRole('button', { name: 'Confirm', exact: true }).click();
                // Finish the teammate/other bracket match via the real combat command route.
                let board = await api(players[0], '/api/tournaments/event');
                for (const match of board.event.matches.filter((m: { status: string }) => m.status !== 'done')) {
                    const member = board.event.entries.find((e: { id: string }) => e.id === match.a).members[0].id;
                    const host = players[names.indexOf(member)];
                    let state = await api(host, `/api/towers/pvp-state?playerName=${member}&matchId=${match.battleId}`);
                    const losingTeam = state.match.roster.find((m: { slug: string }) => m.slug === 'akira')?.teamId ?? 'amber';
                    for (const fighter of state.match.roster.filter((m: { teamId: string }) => m.teamId === losingTeam)) {
                        if (fighter.slug === 'akira') continue;
                        const owner = players[names.indexOf(fighter.slug)];
                        state = await api(owner, `/api/towers/pvp-state?playerName=${fighter.slug}&matchId=${match.battleId}`);
                        if (state.match.status !== 'active') break;
                        await api(owner, '/api/towers/pvp-action', { playerName: fighter.slug, matchId: match.battleId, type: 'forfeit', moveToken: crypto.randomUUID(), expectedVersion: state.match.version });
                    }
                }
                await expect(players[0].getByRole('button', { name: 'Return to Tournament', exact: true })).toBeEnabled();
                await players[0].getByRole('button', { name: 'Return to Tournament', exact: true }).click();
                await expect(players[0].getByRole('button', { name: 'Ranked', exact: true })).toBeEnabled();
                // A four-player solo bracket must create a playable final, not stop after round one.
                board = await api(players[0], '/api/tournaments/event');
                if (mode === 'standard') {
                    await expect.poll(async () => (await api(players[0], '/api/tournaments/event')).event.round).toBe(2);
                    board = await api(players[0], '/api/tournaments/event');
                    const final = board.event.matches.find((m: { round: number }) => m.round === 2);
                    for (const id of [final.a, final.b]) {
                        const member = board.event.entries.find((e: { id: string }) => e.id === id).members[0].id;
                        await api(players[names.indexOf(member)], '/api/tournaments/event', { action: 'ready', eventId: event.id, matchId: final.id });
                    }
                    const loser = board.event.entries.find((e: { id: string }) => e.id === final.a).members[0].id;
                    const owner = players[names.indexOf(loser)];
                    const state = await api(owner, `/api/towers/pvp-state?playerName=${loser}&matchId=${final.battleId}`);
                    await api(owner, '/api/towers/pvp-action', { playerName: loser, matchId: final.battleId, type: 'forfeit', moveToken: crypto.randomUUID(), expectedVersion: state.match.version });
                }
                await expect.poll(async () => (await api(players[0], '/api/tournaments/event')).event.status).toBe('complete');
                expect((await api(players[0], '/api/tournaments/event')).event.champion).toBeTruthy();
            }
            expect(errors).toEqual([]);
        } finally { await Promise.all(contexts.map(c => c.close())); }
    });
}
