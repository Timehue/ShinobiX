import { expect, test, type Page } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { expectViewportSafe } from './helpers/adaptive-assertions';

async function campaignRuntime(page: Page) {
    const save = uiAuditSave();
    const runtime = await installUiAuditRuntime(page, save);
    const village = String(save.character!.village), enemy = 'Moonshadow Village';
    const startsAt = Date.now() - 3_600_000, endsAt = startsAt + 5 * 86_400_000;
    const warId = 'moonshadowvillage-vs-stormveilvillage';
    const objective = (id: string, mode: string, sector: number) => ({ id, mode, sector, village,
        opensAt: startsAt, closesAt: endsAt, limit: 3, bouts: 0, wins: {} });
    const campaign = { version: 2, startsAt, endsAt, scores: { [village]: { pvp: 20, pve: 5, rawPve: 20, total: 25 },
        [enemy]: { pvp: 0, pve: 0, rawPve: 0, total: 0 } }, hiddenStrongholds: 3, intel: 0,
        shrine: [{ id: 'shrine-0', sector: 47, mode: 'combat', opensAt: startsAt + 20 * 3_600_000,
            closesAt: startsAt + 86_400_000, limit: 15, bouts: 0, wins: {} }],
        strongholds: [objective('combat-home', 'combat', 31), objective('pet-home', 'pet', 32), objective('card-home', 'card', 33)],
        operationAllowance: { total: 200, categories: { supply: 50, sabotage: 100, espionage: 50 }, players: {} }, operationResetAt: startsAt + 86_400_000 };
    let defense = '';
    let ended = false;
    const commands: Record<string, unknown>[] = [];
    await page.route('**/api/world-state', route => route.fulfill({ json: { territories: [], standings: [],
        wars: ended ? [] : [{ id: warId, villages: [village, enemy], startedAt: startsAt, updatedAt: startsAt, campaignVersion: 2,
            campaignEndsAt: endsAt, warGroundSector: 47, hp: { [village]: 5000, [enemy]: 5000 }, warPoints: { [village]: 25, [enemy]: 0 } }] } }));
    await page.route('**/api/village/war-campaign', route => {
        const body = route.request().postDataJSON();
        if (body.action === 'view') return route.fulfill({ json: { campaign, defense: defense ? { objectiveId: defense } : null, run: null } });
        commands.push(body);
        if (body.action === 'defend') defense = body.objectiveId;
        if (body.action === 'dequeue') defense = '';
        if (body.action === 'start' || body.action === 'operation-start') return route.fulfill({ status: 409, json: { error: 'Recover before starting a war operation.' } });
        return route.fulfill({ json: { ok: true } });
    });
    return { runtime, commands, campaign, warId, endWar: () => { ended = true; } };
}

test('Town Hall War tab accepts a field order, shows its route and intel milestones, and enforces personal caps', async ({ page }, testInfo) => {
    const { runtime, campaign, warId } = await campaignRuntime(page);
    campaign.shrine[0].opensAt = Date.now() - 1000;
    let mission: Record<string, unknown> | null = null;
    const actions: string[] = [];
    await page.route('**/api/village/war-campaign', route => {
        const body = route.request().postDataJSON(); actions.push(body.action);
        if (body.action === 'operation-start') mission = { id: 'test-sabotage-order', kind: 'sabotage', village: 'Stormveil Village', enemy: 'Moonshadow Village',
            createdAt: Date.now(), sectors: [17, 18, 19], completedSectors: [], status: 'active', holdSeconds: 0, holdRequired: 20, insideStronghold: false, serverNow: Date.now() };
        if (body.action === 'operation-abandon') { mission = { ...mission, status: 'abandoned' }; campaign.operationAllowance.players = { auditninja: { total: 4, categories: { espionage: 2 } } } as never; }
        return route.fulfill({ json: { campaign, mission, run: null, defense: null } });
    });
    await expectUiAuditBoot(page, runtime, 'townHall');
    await page.getByRole('navigation', { name: 'Town Hall sections' }).getByRole('button', { name: 'War', exact: true }).click();
    const shrine = page.getByRole('region', { name: 'Village war campaign' }).locator('article').filter({ has: page.getByRole('heading', { name: 'War Shrine · Sector 47', exact: true }) });
    const shrineArt = shrine.locator('.village-campaign-shrine-art');
    await expect(shrineArt).toBeVisible();
    expect((await shrineArt.boundingBox())!.height).toBeLessThanOrEqual(160);
    await expect(shrineArt).toHaveAttribute('src', '/ui/village-war/war-shrine-landmark-gold-v1.webp');
    const columns = shrine.locator('.village-campaign-shrine-layout > *');
    await expect(columns).toHaveCount(3);
    if ((await shrine.boundingBox())!.width > 600) {
        const [info, picture, stats] = await Promise.all((await columns.all()).map(column => column.boundingBox()));
        expect(info!.x + info!.width).toBeLessThan(picture!.x);
        expect(picture!.x + picture!.width).toBeLessThan(stats!.x);
    }
    await expect(shrine.getByRole('button')).toHaveCount(0);
    await shrineArt.click();
    await expect(page.getByRole('dialog', { name: 'Golden shrine interior' })).toHaveCount(0);
    expect(actions).not.toContain('shrine-enter');
    await expect(shrine.getByText(/Town Hall shows the shrine's status only/)).toBeVisible();
    const orders = page.getByRole('region', { name: 'Field missions and intelligence' });
    const supply = orders.locator('article').filter({ has: page.getByRole('heading', { name: 'Supply', exact: true }) });
    await expect(supply.getByText('10 support points · +1 intel', { exact: true })).toBeVisible();
    await expect(supply.getByText('You 0/1 attempts', { exact: true })).toBeVisible();
    await expect(supply.getByRole('button', { name: 'Accept Supply' })).toBeEnabled();
    await expect(orders.getByText(/Village.*attempts/)).toHaveCount(0);
    await expect(orders.getByText(/Your attempts today: 0\/4/)).toBeVisible();
    await expect(orders.getByRole('progressbar', { name: 'Shared war intelligence' })).toHaveAttribute('max', '72');
    await expect(orders.getByText('24 · Stronghold 1 unknown')).toBeVisible();
    await expect(orders.getByText('48 · Stronghold 2 unknown')).toBeVisible();
    await expect(orders.getByText('72 · Stronghold 3 unknown')).toBeVisible();
    await orders.getByRole('button', { name: 'Accept Sabotage' }).click();
    await expect(orders.getByText(/Disrupt 3 distinct enemy-held sectors/)).toBeVisible();
    await expect(orders.getByText('Eligible sectors: 17 · 18 · 19')).toBeVisible();
    await expect(orders.getByRole('button', { name: 'Accept Espionage' })).toBeDisabled();
    expect(actions).toContain('operation-start'); expect(warId).toBeTruthy();
    await expectViewportSafe(page, { horizontalScrollers: ['.town-tabs'] });
    await testInfo.attach('field-orders-town-hall', { body: await page.screenshot({ path: testInfo.outputPath('field-orders-town-hall.png'), fullPage: true }), contentType: 'image/png' });
    await orders.getByRole('button', { name: 'Abandon order' }).click();
    await expect(orders.getByRole('button', { name: 'Accept Sabotage' })).toBeDisabled();
    await expect(orders.getByRole('button', { name: 'Accept Espionage' })).toBeDisabled();
});

test('Town Hall intel fills live and reveals only the earned enemy specialties with scoring progress', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const { runtime, campaign } = await campaignRuntime(page);
    const enemy = 'Moonshadow Village';
    const targets = (['combat', 'pet', 'card'] as const).map((mode, i) => ({ id: `${mode}-enemy`, mode, village: enemy, sector: 20 + i,
        opensAt: campaign.startsAt, closesAt: campaign.endsAt, limit: 3, bouts: i + 1, wins: {} }));
    await expectUiAuditBoot(page, runtime, 'townHall');
    await page.getByRole('navigation', { name: 'Town Hall sections' }).getByRole('button', { name: 'War', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Village war campaign' });
    const orders = panel.getByRole('region', { name: 'Field missions and intelligence' });
    const meter = orders.getByRole('progressbar', { name: 'Shared war intelligence' });
    await expect(meter).toHaveAttribute('value', '0');
    for (const target of targets) await expect(panel.getByRole('heading', { name: `Enemy stronghold · Sector ${target.sector}`, exact: true })).toHaveCount(0);
    for (let step = 1; step <= 3; step++) {
        campaign.intel = step * 24;
        campaign.hiddenStrongholds = 3 - step;
        campaign.strongholds.push(targets[step - 1]);
        // Wait for the real visible-tab poll; do not reload or force a React refresh.
        await expect(meter).toHaveAttribute('value', String(step * 24), { timeout: 20_000 });
        await expect(orders.getByText(`${step}/3 enemy strongholds identified`, { exact: true })).toBeVisible();
        await expect(orders.getByText(`${step * 24} · Stronghold ${step} revealed`, { exact: true })).toBeVisible();
        for (const [index, target] of targets.entries()) {
            const heading = panel.getByRole('heading', { name: `Enemy stronghold · Sector ${target.sector}`, exact: true });
            if (index >= step) { await expect(heading).toHaveCount(0); continue; }
            const card = panel.locator('article').filter({ has: page.getByRole('heading', { name: `Enemy stronghold · Sector ${target.sector}`, exact: true }) });
            await expect(heading).toBeVisible();
            await expect(card.getByText(['Shinobi PvP', 'Pet battles only', 'Card battles only'][index], { exact: true })).toBeVisible();
            await expect(card.getByText(`${target.bouts}/3 scored live battles`, { exact: true })).toBeVisible();
            await expect(card.getByText(index === 2 ? 'Scoring complete' : /Open · closes in/)).toBeVisible();
            await card.locator('img').scrollIntoViewIfNeeded();
            await expect.poll(() => card.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(640);
        }
        await expect(panel.getByRole('button', { name: 'Attack the ANBU defense' })).toHaveCount(0);
    }
    await expectViewportSafe(page, { horizontalScrollers: ['.town-tabs'] });
    await testInfo.attach('intel-fully-revealed', { body: await orders.screenshot({ path: testInfo.outputPath('intel-fully-revealed.png') }), contentType: 'image/png' });
});

test('village campaign shows a locked shrine, mode-specific strongholds and capped support', async ({ page }, testInfo) => {
    const { runtime, commands } = await campaignRuntime(page);
    await expectUiAuditBoot(page, runtime, 'townHall');
    await page.getByRole('button', { name: 'War Hall', exact: true }).click();
    await expect(page.locator('.app-shell[data-screen="villageWar"]')).toBeVisible();
    const campaign = page.getByRole('region', { name: 'Village war campaign' });
    await expect(campaign.getByText('Five-day Village War', { exact: true })).toBeVisible();
    await expect(campaign.getByText(/Locked · opens in/)).toBeVisible();
    await expect(campaign.getByRole('button', { name: 'Contest the shrine' })).toHaveCount(0);
    await expect(campaign.getByRole('button', { name: 'Attack the ANBU defense' })).toHaveCount(0);
    await expect(campaign.getByText(/Travel to Sector 47 and enter its golden shrine/)).toBeVisible();
    await expect(campaign.getByText('Pet battles only', { exact: true })).toBeVisible();
    await expect(campaign.getByText('Card battles only', { exact: true })).toBeVisible();
    await expect(campaign.getByText('0/3 enemy strongholds identified')).toBeVisible();
    const illustrations = campaign.locator('.village-campaign-art');
    await expect(illustrations).toHaveCount(4);
    for (const illustration of await illustrations.all()) {
        await illustration.scrollIntoViewIfNeeded();
        await expect.poll(() => illustration.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
    await expect(campaign.getByRole('button', { name: 'Accept Supply' })).toBeEnabled();
    await campaign.getByRole('button', { name: 'Accept Espionage' }).click();
    await expect(campaign.getByRole('alert')).toHaveText('Recover before starting a war operation.');
    expect(commands.at(-1)?.operation).toBe('espionage');
    await expectViewportSafe(page);
    await testInfo.attach('campaign', { body: await page.screenshot({ path: testInfo.outputPath('campaign.png'), fullPage: true }), contentType: 'image/png' });
});

test('Town Hall queues and removes a defender for the chosen stronghold battle type', async ({ page }) => {
    const { runtime, commands } = await campaignRuntime(page);
    await expectUiAuditBoot(page, runtime, 'townHall');
    await page.getByRole('navigation', { name: 'Town Hall sections' }).getByRole('button', { name: 'Guard', exact: true }).click();
    const campaign = page.getByRole('region', { name: 'Village war campaign' });
    const card = campaign.locator('article').filter({ hasText: 'Card battles only' });
    await card.getByRole('button', { name: 'Queue to defend', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Leave defense queue', exact: true })).toBeVisible();
    expect(commands.at(-1)?.objectiveId).toBe('card-home');
    await card.getByRole('button', { name: 'Leave defense queue', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Queue to defend', exact: true })).toBeVisible();
    expect(commands.at(-1)?.action).toBe('dequeue');
    await expectViewportSafe(page, { horizontalScrollers: ['.town-tabs'] });
});

test('a card defense notification reaches an online player through heartbeat delivery', async ({ page }) => {
    const runtime = await installUiAuditRuntime(page, uiAuditSave());
    await page.route('**/api/player/heartbeat', route => route.fulfill({ json: { sectorMates: [], allPlayers: [], pendingChallenges: [],
        pendingNotices: [{ kind: 'village-war-card-defense', by: 'Enemy', sector: 21, at: Date.now() }] } }));
    await expectUiAuditBoot(page, runtime, 'townHall');
    await expect(page.getByText(/attacked your queued card stronghold in Sector 21/)).toBeVisible();
    await expect(page.getByText(/enter your assigned card battle now/)).toBeVisible();
});

test('an open Town Hall defense panel stops offering objectives after its current war ends', async ({ page }) => {
    const { runtime, endWar } = await campaignRuntime(page);
    await expectUiAuditBoot(page, runtime, 'townHall');
    await page.getByRole('navigation', { name: 'Town Hall sections' }).getByRole('button', { name: 'Guard', exact: true }).click();
    const campaign = page.getByRole('region', { name: 'Village war campaign' });
    await expect(campaign).toBeVisible();
    endWar();
    await expect(campaign).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Queue as Village Guard', exact: true })).toBeVisible();
});
