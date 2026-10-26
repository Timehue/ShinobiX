import { expect, test, type Page } from '@playwright/test';
import { installUiAuditRuntime, expectUiAuditBoot, uiAuditSave } from './helpers/ui-audit-runtime';
import { expectViewportSafe } from './helpers/adaptive-assertions';
import { FLOOR_CATALOG } from '../../api/towers/_floor-catalog';
import { publicTowerFloorMeta } from '../../api/towers/floors';
import { buildTowerEncounter } from '../../api/towers/_encounter';
import { startRound } from '../../api/towers/_engine';
import type { TowerPartyView } from '../src/lib/towers-api';

test.setTimeout(120_000);

function party(host = 'auditninja'): TowerPartyView {
    return { id: 'party-social-journey', inviteCode: 'ABCDEFGH', hostSlug: host,
        binding: { mode: 'story', floor: 1 }, status: 'forming',
        members: [{ slug: host, displayName: host === 'auditninja' ? 'AuditNinja' : 'RivalNinja', joinedAt: Date.now(), ready: false }],
        invitedSlugs: [], version: 1, createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 120000,
        sizeRequirements: { min: 2, max: 4, required: null }, allReady: false, canLaunch: false,
        liveMemberCount: 1, aiMemberCount: 0, aiPolicy: { allowed: true, max: 1, profile: 'story-recruit-v1', progressionEligible: false } };
}
async function enterTowers(page: Page) {
    await page.getByRole('button', { name: /Celestial Tower/ }).first().click();
    await page.getByRole('dialog', { name: 'Celestial Tower' }).getByRole('button', { name: /Battle Towers/ }).click();
    await expect(page.locator('.tower-ready-room')).toBeVisible();
}
async function installFloors(page: Page) {
    await page.route('**/api/towers/floors', route => route.fulfill({ json: { floors: [publicTowerFloorMeta(FLOOR_CATALOG[0])] } }));
    await page.route('**/api/towers/my-run?**', route => route.fulfill({ json: {} }));
}

test('find, follow, add a friend, then invite and cancel through the existing Ready Room', async ({ page }) => {
    const save = uiAuditSave();
    const runtime = await installUiAuditRuntime(page, save);
    let following: string[] = [], friends: string[] = [];
    let followAttempts = 0;
    await page.route('**/api/player/roster**', route => route.fulfill({ json: { players: [{ name: 'RivalNinja', level: 72,
        online: true, lastSeenAt: Date.now(), village: 'Ashen Leaf Village',
        character: { ...save.character, name: 'RivalNinja', accountName: 'Lantern Warden', level: 72 } }] } }));
    await page.route('**/api/player/friends**', route => {
        const req = route.request();
        if (req.method() === 'GET') return route.fulfill({ json: { following, friends } });
        const data = req.postDataJSON();
        if (data.list === 'friends') { friends = ['RivalNinja']; return route.fulfill({ json: { friends } }); }
        followAttempts++;
        if (followAttempts === 1) return route.fulfill({ status: 503, json: { error: 'Connection lost. Please try again.' } });
        following = req.method() === 'DELETE' ? [] : ['RivalNinja'];
        return route.fulfill({ json: { following } });
    });
    await expectUiAuditBoot(page, runtime, 'village');
    const users = page.getByRole('button', { name: 'Users', exact: true }).filter({ visible: true });
    const menu = page.getByRole('button', { name: 'Menu', exact: true }).filter({ visible: true });
    await expect(users.or(menu).first()).toBeVisible();
    if (await users.count() === 0) await menu.click();
    await users.click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'userHub');
    await page.getByPlaceholder('Search by name…').fill('RivalNinja');
    const row = page.locator('.user-hub-row').filter({ hasText: 'Lantern Warden' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Follow', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Connection lost' })).toBeVisible();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'userHub');
    await row.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Unfollow', exact: true })).toBeVisible();
    expect(followAttempts).toBe(2);
    await page.locator('.user-hub-tabs').getByRole('button', { name: /Friends/ }).click();
    await page.getByLabel('Add a friend by player name').fill('RivalNinja');
    await page.getByRole('button', { name: 'Add friend', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'was added to Friends' })).toBeVisible();

    await installFloors(page);
    let current: TowerPartyView | null = null;
    const actions: string[] = [];
    await page.route('**/api/towers/party**', route => {
        if (route.request().method() === 'POST') {
            const data = route.request().postDataJSON(); actions.push(data.action);
            if (data.action === 'create') current = party();
            if (data.action === 'invite') current = { ...current!, version: current!.version + 1, invitedSlugs: ['rivalninja'] };
            if (data.action === 'revoke-invite') current = { ...current!, version: current!.version + 1, invitedSlugs: [] };
        }
        return route.fulfill({ json: { ok: true, party: current, invitations: [] } });
    });
    // Reload through a supported navigation bookmark; social membership must survive.
    await page.goto('/#/centralHub', { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'centralHub');
    await enterTowers(page);
    await page.getByRole('button', { name: /^Story Floor 1/ }).click();
    await page.getByLabel('Invite a followed player').selectOption('RivalNinja');
    const cancel = page.getByRole('button', { name: 'Cancel Tower invitation for rivalninja' });
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect(cancel).toHaveCount(0);
    expect(actions).toEqual(['create', 'invite', 'revoke-invite']);
    await expectViewportSafe(page);
});

test('expired invitation refreshes clearly; accepting a replacement reconnects to the correct activity', async ({ page }) => {
    const save = uiAuditSave();
    const runtime = await installUiAuditRuntime(page, save);
    await installFloors(page);
    let current = party('rivalninja');
    let offered = true, accepted = false, expired = false, offline = false;
    const accepts: string[] = [];
    const invitation = () => ({ partyId: current.id, inviteCode: current.inviteCode, hostSlug: 'rivalninja', hostDisplayName: 'RivalNinja', binding: current.binding, memberCount: 1, expiresAt: current.expiresAt });
    const runId = 'tower-social-journey';
    const session = buildTowerEncounter({ floor: FLOOR_CATALOG[0], runId, seed: 42, partySize: 2, now: Date.now(),
        squad: [{ id: 'sq-0', name: 'AuditNinja', ownerSlug: 'auditninja', ai: false, character: save.character! }] });
    startRound(session);
    await page.route('**/api/player/heartbeat', route => route.fulfill({ json: { ok: true, serverNow: Date.now(), towerPartyInvites: offered ? [current.id] : [] } }));
    await page.route('**/api/towers/party**', route => {
        if (offline) return route.fulfill({ status: 503, json: { error: 'Temporary connection loss' } });
        const req = route.request(); const url = new URL(req.url());
        if (req.method() === 'POST') {
            const data = req.postDataJSON(); accepts.push(data.requestId); accepted = true; offered = false;
            current = { ...current, version: 2, members: [...current.members, { slug: 'auditninja', displayName: 'AuditNinja', joinedAt: Date.now(), ready: false }], liveMemberCount: 2 };
        }
        if (expired && url.searchParams.has('partyId')) {
            offered = false;
            return route.fulfill({ status: 404, json: { error: 'That invitation expired. Ask the host for a new invitation.' } });
        }
        return route.fulfill({ json: { ok: true, party: accepted || url.searchParams.has('partyId') ? current : null, invitations: offered ? [invitation()] : [] } });
    });
    await page.route('**/api/towers/state?**', route => {
        expect(new URL(route.request().url()).searchParams.get('runId')).toBe(runId);
        return route.fulfill({ json: { session } });
    });
    await expectUiAuditBoot(page, runtime, 'centralHub');
    await expect(page.locator('.game-toast')).toContainText('RivalNinja invited you');
    await enterTowers(page);
    const accept = page.locator('.tower-ready-room-accept');
    await expect(accept).toBeVisible();
    expired = true;
    await accept.click();
    await expect(page.getByRole('alert').filter({ hasText: 'invitation expired' })).toBeVisible();
    await expect(accept).toHaveCount(0);
    expired = false; offered = true;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(accept).toBeVisible();
    await accept.click();
    await expect(page.getByRole('heading', { name: 'Your Tower squad' })).toBeVisible();
    expect(accepts).toHaveLength(1);
    offline = true;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByText('Restoring squad connection', { exact: true })).toBeVisible();
    offline = false;
    current = { ...current, version: 3, status: 'active', launch: { requestId: 'launch-social', runId, seed: 42, state: 'active', preparedAt: Date.now() } };
    await page.getByRole('button', { name: 'Retry now', exact: true }).click();
    await expect(page.locator('.screen-battleTowerFight')).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.screen-battleTowerFight')).toBeVisible();
    expect(accepts).toHaveLength(1);
});
