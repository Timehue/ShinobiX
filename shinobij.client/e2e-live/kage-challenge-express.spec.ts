import { expect, test, type APIRequestContext } from '@playwright/test';

const village = 'Frostfang Village';
const admin = { 'x-admin-password': 'live-express-e2e-admin' };

async function seed(request: APIRequestContext, name: string, level: number) {
    const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password: 'KageLive!1234' } });
    expect(registered.status()).toBe(200);
    const token = String((await registered.json()).token);
    const headers = { 'x-player-name': name, 'x-player-token': token };
    const stats = Object.fromEntries(['strength', 'speed', 'intelligence', 'willpower', 'bukijutsuOffense', 'bukijutsuDefense',
        'taijutsuOffense', 'taijutsuDefense', 'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense'].map(key => [key, 20]));
    const character = { name, village, level, stats, specialty: 'Ninjutsu', bloodline: 'None', rankTitle: 'Genin',
        xp: 0, ryo: 500000, villageMerit: 250, createdAt: Date.now() - 30 * 86400000, unspentStats: 0,
        hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        onboardingStep: 'done', profession: 'healer', professionRank: 1, professionChosenAt: 1,
        inventory: [], equipment: {}, pets: [], jutsuMastery: [], equippedJutsuIds: [], pendingCombatMissionClaims: [] };
    const seeded = await request.post(`/api/save/${name}?signal=1`, { headers: admin, data: { character, currentSector: 0,
        acceptedMissionIds: [], missionProgress: {}, triggeredEvents: ['builtin-awakening-lv2', 'builtin-aura-sphere-lv9', 'builtin-hidden-dungeon'] } });
    expect(seeded.status()).toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    return { name, token, headers, character };
}

test('Town Hall Kage acceptance hands the response to the challenger and seals a real official duel', async ({ page, request }) => {
    const suffix = Date.now().toString(36);
    const kage = await seed(request, `clockkage${suffix}`, 3);
    const challenger = await seed(request, `clockrival${suffix}`, 90);
    const opened = await request.post('/api/village/kage', { headers: admin,
        data: { action: 'unlock', village, playerName: kage.name } });
    expect(opened.status()).toBe(200);
    const declared = await request.post('/api/village/kage-challenge', { headers: challenger.headers,
        data: { action: 'declare', village, playerName: challenger.name } });
    expect(declared.status()).toBe(200);
    const political = (await declared.json()).challenge;
    expect(political.obligationRemainingMs).toBe(86400000);
    expect(political.challengerRemainingMs).toBe(86400000);

    await page.addInitScript(({ name, token }) => {
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name);
        localStorage.setItem('shinobix:activeTokenPersist', token);
    }, kage);
    const alerts: string[] = [];
    page.on('dialog', dialog => { alerts.push(dialog.message()); void dialog.dismiss(); });
    await page.goto('/#/townHall', { waitUntil: 'networkidle' });
    for (let pass = 0; pass < 6; pass++) {
        const close = page.getByRole('button', { name: /Skip visual novel scene|^Skip$|Close briefing|^Got it/ }).last();
        if (!await close.isVisible()) break;
        await close.click();
    }
    await page.getByRole('navigation', { name: 'Town Hall sections' }).getByRole('button', { name: 'Council', exact: true }).click();
    const board = page.getByRole('heading', { name: 'Kage Challenge', exact: true }).locator('xpath=ancestor::section[1]');
    await expect(board).toContainText('Waiting for the Kage to accept.');
    await expect(board.getByText('24:00:00', { exact: true })).toHaveCount(2);
    const acceptedResponse = page.waitForResponse(r => r.url().includes('/api/village/kage-challenge') && r.request().method() === 'POST');
    await board.getByRole('button', { name: 'Accept challenge & send duel', exact: true }).click();
    const accepted = await acceptedResponse;
    expect(accepted.status(), JSON.stringify(await accepted.json())).toBe(200);
    await expect(board).toContainText('Waiting for the challenger to accept the official duel.');
    await expect(board.getByRole('button', { name: 'Resend official duel', exact: true })).toBeVisible();
    expect(alerts).toEqual([]);

    // A missed popup is recoverable without the Kage clicking again.
    const reopened = await request.post('/api/village/kage-challenge', { headers: challenger.headers,
        data: { action: 'invitation', village, playerName: challenger.name } });
    expect(reopened.status()).toBe(200);
    const beat = await request.post('/api/player/heartbeat', { headers: challenger.headers,
        data: { name: challenger.name, sector: 0, enterTown: true, character: { name: challenger.name, village, level: 90 } } });
    expect(beat.status()).toBe(200);
    const invitations = (await beat.json()).pendingChallenges as Array<{ id: string; kageChallengeId?: string }>;
    const invitation = invitations.find(c => c.kageChallengeId === political.challengeId)!;
    expect(invitation).toBeTruthy();
    const requestedBattleId = `pvp-kage-${suffix}`;
    const started = await request.post('/api/pvp/session', { headers: challenger.headers, data: {
        battleId: requestedBattleId, challengeId: invitation.id, mode: 'standard', baseRewards: false,
        p1Character: kage.character, p2Character: challenger.character,
    } });
    const created = await started.json();
    expect(started.status(), JSON.stringify(created)).toBe(200);
    const battleId = String(created.battleId);
    expect(created.session.kageDuelAuthority).toMatchObject({ village, challengeId: political.challengeId });
    // Entering the created session seals its political authority before combat.
    const joined = await request.post('/api/pvp/move', { headers: challenger.headers,
        data: { battleId, role: 'p2', action: 'join' } });
    expect(joined.status(), JSON.stringify(await joined.json())).toBe(200);
    const notified = await request.post('/api/player/challenge', { headers: challenger.headers,
        data: { targetName: kage.name, challenge: { id: invitation.id, fromName: challenger.name,
            toName: kage.name, mode: 'standard', accepted: true, battleId } } });
    expect(notified.status(), JSON.stringify(await notified.json())).toBe(200);
    const state = await request.get(`/api/village/kage?village=${encodeURIComponent(village)}`);
    const duel = (await state.json()).challenge;
    expect(duel).toMatchObject({ status: 'accepted', battleId, clockRunning: false });
    expect(duel.duelInvitation).toBeUndefined();
    // This server is disposable in-memory KV; no production account is touched.
});
