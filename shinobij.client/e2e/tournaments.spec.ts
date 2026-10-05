import { test, expect } from '@playwright/test';
import type { Tournament, TournamentResponse } from '../../shared/tournaments';
const fixture = (mode: Tournament['mode'] = 'standard'): Tournament => ({ id: 'qa-event', name: 'Autumn Arena Cup', mode, notes: 'Meet in the Arena before signup closes.',
    createdAt: Date.now(), signupEndsAt: Date.now() + 600_000, endsAt: Date.now() + 4200_000, status: 'signup',
    maxEntries: 16, readySeconds: 120, petFormat: '1v1', entries: [], matches: [], round: 0, rounds: 0, champion: null });
test('admin chooses all four modes and starts a custom signup timer', async ({ page }) => {
    let data: TournamentResponse = { event: null, serverNow: Date.now(), playerId: '' };
    let submitted: Record<string, unknown> | undefined;
    await page.route('**/api/tournaments/event', async route => {
        if (route.request().method() === 'POST') { submitted = route.request().postDataJSON(); data = { ...data, event: { ...fixture('pet'), name: String(submitted!.name) } }; }
        await route.fulfill({ json: data });
    });
    await page.goto('/tournament-qa.html?admin', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Start signup timer' })).toBeEnabled();
    for (const mode of ['pet', '2v2', 'ranked', 'standard']) await page.getByLabel('Type and rules').selectOption(mode);
    await page.getByLabel('Type and rules').selectOption('pet');
    await page.getByLabel('Signup timer (minutes)').fill('45');
    await page.getByLabel('Pet formation').selectOption('2v2');
    await page.screenshot({ path: 'test-results/tournament-admin-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Start signup timer' }).click();
    await expect(page.getByRole('button', { name: 'Cancel tournament', exact: true })).toBeVisible();
    expect(submitted).toMatchObject({ action: 'create', mode: 'pet', signupMinutes: 45, petFormat: '2v2' });
});
test('tournament tab stays visible with Dojo Circuit off; pairs require partner acceptance', async ({ page }) => {
    const event = fixture('2v2');
    await page.route('**/api/tournaments/event', async route => {
        const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
        if (body?.action === 'join') event.entries = [{ id: 'pair', members: [{ id: 'akira', name: 'Akira', accepted: true }, { id: 'ren', name: body.partner, accepted: false }] }];
        await route.fulfill({ json: { event, serverNow: Date.now(), playerId: 'akira' } });
    });
    await page.goto('/tournament-qa.html');
    await expect(page.getByRole('button', { name: 'Tournaments', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dojo Circuit', exact: true })).toHaveCount(0);
    await page.getByLabel('Partner’s player name').fill('Ren');
    await page.getByRole('button', { name: 'Sign up and invite partner' }).click();
    await expect(page.getByText('Ren (invited)', { exact: false })).toBeVisible();
    await expect(page.getByText('0 confirmed pairs', { exact: false })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/tournament-signup-mobile.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
test('live bracket readies a player and renders desktop and mobile without page overflow', async ({ page }) => {
    const event = fixture(); event.status = 'live'; event.signupEndsAt = Date.now() - 1000; event.endsAt = event.signupEndsAt + 3600_000; event.round = 1; event.rounds = 2;
    event.entries = ['akira', 'ren', 'sora'].map(id => ({ id, members: [{ id, name: id, accepted: true }] }));
    event.matches = [{ id: 'm1', round: 1, a: 'akira', b: 'ren', ready: [], readyEndsAt: Date.now() + 120_000, endsAt: Date.now() + 1200_000, battleId: 'qa', status: 'waiting', winner: null },
        { id: 'm2', round: 1, a: 'sora', b: null, ready: [], readyEndsAt: Date.now(), endsAt: Date.now() + 1200_000, battleId: 'qa2', status: 'done', winner: 'sora', reason: 'Bye' }];
    await page.route('**/api/tournaments/event', async route => {
        if (route.request().method() === 'POST') event.matches[0].ready = ['akira'];
        await route.fulfill({ json: { event, serverNow: Date.now(), playerId: 'akira' } });
    });
    await page.goto('/tournament-qa.html');
    await page.getByRole('button', { name: 'Ready for this round' }).click();
    await expect(page.getByRole('button', { name: 'Ready — waiting for opponents' })).toBeDisabled();
    await page.screenshot({ path: 'test-results/tournament-bracket-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/tournament-bracket-mobile.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
