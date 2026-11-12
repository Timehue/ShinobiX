import { expect, test, type Page } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { quietRoadCooldowns } from '../e2e-live/helpers/quiet-road';
import { createClanWarCampaign, projectClanWarCampaign, CLAN_WAR_RULES } from '../../shared/clan-war-campaign';
import { NPC_VILLAGE } from '../../shared/npc-village';

// Cinderhold (the NPC village) on the player screens that name it: the War Hall
// declare list and peace copy, the clan-war 2v2 note against an NPC clan, and
// the sector roster row for a shinobi seen at a node (Ready, as a gathering player reads).

/** The audit player sits in the Kage seat, and (optionally) its village is at war with Cinderhold. */
async function warHallRuntime(page: Page, atWar: boolean) {
    const save = uiAuditSave();
    const runtime = await installUiAuditRuntime(page, save);
    const village = String(save.character!.village), now = Date.now(), startsAt = now - 3_600_000;
    const war = { id: 'cinderholdvillage-vs-stormveilvillage', villages: [village, NPC_VILLAGE], startedAt: startsAt, updatedAt: startsAt,
        campaignVersion: 3, campaignEndsAt: startsAt + 5 * 86_400_000, hp: { [village]: 5000, [NPC_VILLAGE]: 5000 },
        warPoints: { [village]: 40, [NPC_VILLAGE]: 30 }, peaceProposals: {} as Record<string, number> };
    const commands: Record<string, unknown>[] = [];
    await page.route(url => url.pathname === '/api/village/kage', route => route.fulfill({ json: { seatedKage: 'AuditNinja' } }));
    await page.route('**/api/world-state', route => {
        if (route.request().method() === 'POST') {
            const body = route.request().postDataJSON();
            commands.push(body);
            if (body.command === 'propose-peace') war.peaceProposals = { [village]: Date.now() };
            return route.fulfill({ json: { ok: true, war: { ...war, updatedAt: Date.now() } } });
        }
        return route.fulfill({ json: { territories: [], standings: [], wars: atWar ? [war] : [] } });
    });
    await page.route('**/api/village/war-campaign', route => route.fulfill({ json: { campaign: null, defense: null, run: null } }));
    await expectUiAuditBoot(page, runtime, 'townHall');
    await page.getByRole('button', { name: 'War Hall', exact: true }).click();
    await expect(page.locator('.app-shell[data-screen="villageWar"]')).toBeVisible();
    return { village, commands };
}

test('the War Hall offers Cinderhold as a declare target', async ({ page }) => {
    await warHallRuntime(page, false);
    const target = page.getByRole('combobox').filter({ has: page.locator('option', { hasText: 'Select target village…' }) });
    await expect(target).toBeVisible();
    await expect(target.locator('option', { hasText: NPC_VILLAGE })).toHaveCount(1);
});

test('a war against Cinderhold explains its peace rule and asks before offering peace', async ({ page }) => {
    const { village, commands } = await warHallRuntime(page, true);
    const rule = `once ${village} has at least double Cinderhold's score and leads by 100 or more`;
    await expect(page.getByText(`Cinderhold never offers peace. It accepts a standing offer ${rule}, and peace ends the war with no winner.`, { exact: false })).toBeVisible();
    await expect(page.getByText(/Cinderhold has no Kage/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Propose peace', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Offer peace?' });
    await expect(confirm).toContainText(`It accepts ${rule}. Peace ends the war with no winner.`);
    await expect(confirm).toContainText('pays no crates, war purses or MVP rewards');
    await confirm.getByRole('button', { name: 'Keep fighting', exact: true }).click();
    await expect(confirm).toHaveCount(0);
    expect(commands).toHaveLength(0);

    await page.getByRole('button', { name: 'Propose peace', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Offer peace?' }).getByRole('button', { name: 'Offer peace', exact: true }).click();
    await expect.poll(() => commands.length).toBe(1);
    expect(commands[0]).toMatchObject({ kind: 'war-command', command: 'propose-peace' });
    await expect(page.getByText(`Cinderhold accepts it ${rule}.`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Withdraw peace offer', exact: true })).toBeVisible();
});

test('the clan war 2v2 queue says an NPC clan fields no teams', async ({ page }) => {
    const now = Date.now(), save = uiAuditSave(), enemy = 'Ashen Fang';
    save.character = { ...save.character, clan: 'Shadow Cell', clanFounder: true };
    await installUiAuditRuntime(page, save);
    const rosters: [{ clan: string; members: Array<{ name: string; level: number }> }, { clan: string; members: Array<{ name: string; level: number }> }] = [
        { clan: 'Shadow Cell', members: ['auditninja', 'rei', 'kuro', 'mei'].map(name => ({ name, level: 85 })) },
        { clan: enemy, members: ['kuroto', 'renji', 'raku', 'sayo'].map(name => ({ name, level: 85 })) },
    ];
    const clan = { name: 'Shadow Cell', village: 'Stormveil Village', founderName: 'AuditNinja', level: 25, xp: 300, treasury: { ryo: 25000, warSupply: 10, provisions: 90, items: [] },
        createdAt: now - 10 * 86400000, members: rosters[0].members.map(member => ({ ...member, village: 'Stormveil Village', month: new Date().toISOString().slice(0, 7) })),
        roleOverrides: {}, joinRequests: [], notices: [], warHistory: [] };
    const campaign = createClanWarCampaign({ instanceId: 'cw2-ui-audit-npc01', now: now - CLAN_WAR_RULES.preparationMs,
        rosters, sectors: Array(6).fill(12), offsets: Array(6).fill(0), modes: ['pet1v1', 'tilecards', 'pvp1v1', 'pvp1v1', 'pet1v1', 'tilecards'] });
    const war = { id: 'ashenfang-vs-shadowcell', clans: [enemy, 'Shadow Cell'], villages: {}, hp: { [enemy]: 1000, 'Shadow Cell': 1000 }, startedAt: campaign.declaredAt, updatedAt: now,
        declaredBy: 'auditninja', pendingChallenges: [], completedChallenges: [], campaignView: projectClanWarCampaign(campaign, 'Shadow Cell', 'auditninja', now) };
    await page.route('**/api/save/clan-shadowcell', route => route.fulfill({ json: clan }));
    await page.route('**/api/clan/war/list', route => route.fulfill({ json: { wars: [war] } }));
    await page.route('**/api/clan/program', route => route.fulfill({ json: { view: { clan: clan.name, weekKey: '2026-W45', resetsAt: now + 7 * 86400000, serverNow: now,
        contracts: [], project: { progress: 0, memberUsed: 0, completed: false, completedProjects: 0, hallRestored: false }, assignments: {} } } }));
    await page.goto('/#/clan', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.clan-overview')).toBeVisible();
    const dismiss = page.locator('.screen-hint-dismiss'); if (await dismiss.isVisible()) await dismiss.click();
    await page.getByRole('button', { name: 'Wars', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Clan war campaign' });
    const team = panel.locator('article').filter({ has: page.getByRole('heading', { name: 'Shinobi Team Battle', exact: true }) });
    await expect(team.getByText(`${enemy} fields no 2v2 teams, so this queue has no opponents.`, { exact: true })).toBeVisible();
    await expect(team.getByRole('button', { name: 'Open partner slot', exact: true })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Join queue', exact: true }).first()).toBeEnabled();
});

test('the sector roster shows a Cinderhold shinobi at a node as Ready, as a gathering player reads, and attackable', async ({ page }) => {
    test.setTimeout(90_000);
    const save = uiAuditSave();
    save.currentSector = 22;
    save.character = { ...save.character, wandererCooldowns: quietRoadCooldowns([22]) };
    await installUiAuditRuntime(page, save);
    const npc = { name: 'Kuroto', level: 40, village: NPC_VILLAGE, specialty: 'Taijutsu', currentSector: 22, tile: 60,
        movementSequence: 3, activity: 'mining', character: { name: 'Kuroto', avatarImage: '' } };
    await page.route('**/api/player/roster?sector=*', route => route.fulfill({ json: { sector: 22, sleepers: [] } }));
    await page.route('**/api/player/heartbeat', route => route.fulfill({ json: { ok: true, sector: 22, sectorMates: [npc] } }));
    await page.addInitScript(() => localStorage.setItem('legacyRumors.seen.v1:auditninja', JSON.stringify([10, 20, 30, 40, 45])));
    await page.goto('/#/worldMap');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'worldMap', { timeout: 60_000 });
    const returnButton = page.getByRole('button', { name: 'Return to Sector 22', exact: false });
    await expect.poll(async () => await returnButton.isVisible() || await page.locator('.sector-image-map').isVisible(), { timeout: 60_000 }).toBe(true);
    if (await returnButton.isVisible()) await returnButton.click();
    const row = page.getByRole('list', { name: 'Sector players' }).locator('li').filter({ hasText: 'Kuroto' });
    await expect(row.locator('.sector-roster-status')).toHaveText('Ready', { timeout: 30_000 });
    await expect(row.getByRole('button', { name: 'Attack Kuroto', exact: true })).toBeEnabled();
});
