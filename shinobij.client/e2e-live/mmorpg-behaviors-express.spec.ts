import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { test } from './helpers/reconnecting-request';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';
import { WORLD_GEO_VERSION } from '../../shared/sector-geo';
import { weeklyBossRoamState } from '../src/lib/weekly-boss-roam';

/*
 * MMORPG behaviour, played through the real Express server (docs/MMORPG_BEHAVIOR_PASS_2026-09-24.md).
 *
 * 1. A shinobi knocked out while ONLINE shows up in their village hospital, and a
 *    Healer can treat them. The ward used to read the public roster, which builds
 *    an online player's row from presence — and presence never carried the
 *    admission — so exactly these patients were invisible.
 * 2. "Stand & Fight" against the roaming Weekly Boss starts the fight, and leaving
 *    it returns the hunter to the SAME sector. After the Solo PvE migration the
 *    prompt only opened the tracker, whose one button pointed back at the map:
 *    the boss could not be fought at all, and nothing covered it.
 * 3. Leaving a live Card Hall showdown forfeits it and puts a loss on the record.
 *    It used to pause the match with no server call, so walking out of a losing
 *    showdown kept the record clean.
 *
 * Accounts, the boss spawn and the admission are admin fixtures on the disposable
 * in-memory server; every fight, heal, settlement and navigation is real.
 */

const ADMIN = { 'x-admin-password': 'live-express-e2e-admin' };
const VILLAGE = 'Stormveil Village';

type Account = { name: string; token: string; headers: Record<string, string>; canonical: Record<string, unknown> };

async function seedShinobi(
    request: APIRequestContext,
    name: string,
    place: { sector: number; tile: number },
    extra: Record<string, unknown> = {},
): Promise<Account> {
    const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password: 'MmoBehavior!1234' } });
    expect(registered.status(), await registered.text()).toBe(200);
    const token = String((await registered.json()).token ?? '');
    const headers = { 'x-player-name': name, 'x-player-token': token };
    const character = {
        name, village: VILLAGE, storyVillage: VILLAGE, specialty: 'Ninjutsu', bloodline: 'None',
        level: 60, rankTitle: 'Jonin', xp: 0, unspentStats: 0, storyProgress: 99,
        onboardingStep: 'done', academyChecklistClaimed: true, starterCardsClaimed: true,
        examsPassed: ['genin', 'chunin', 'jonin'], profession: 'vanguard', professionRank: 1,
        professionXp: 0, professionChosenAt: 1,
        hp: 5000, maxHp: 5000, chakra: 3000, maxChakra: 3000, stamina: 3000, maxStamina: 3000,
        stats: Object.fromEntries(['strength', 'speed', 'intelligence', 'willpower', 'bukijutsuOffense',
            'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense', 'genjutsuOffense',
            'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense'].map((key) => [key, 400])),
        ryo: 5000, inventory: [], itemStacks: [], equipment: {}, pets: [], tileCards: [],
        jutsuMastery: [], equippedJutsuIds: [], pendingCombatMissionClaims: [], seenHints: ['worldMap', 'hospital'],
        ...extra,
    };
    const seeded = await request.post(`/api/save/${name}?signal=1`, {
        headers: ADMIN,
        data: { character, worldGeoV: WORLD_GEO_VERSION, currentSector: place.sector, currentTile: place.tile,
            acceptedMissionIds: [], missionProgress: {}, triggeredEvents: [] },
    });
    expect(seeded.status(), await seeded.text()).toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    const canonical = await (await request.get(`/api/save/${name}`, { headers })).json();
    return { name, token, headers, canonical };
}

async function signIn(page: Page, account: Account) {
    await page.addInitScript(({ name, token, canonical, patchVersion }) => {
        if (localStorage.getItem('live-mmo-installed') === name) return;
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name);
        localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('patchNotes.lastSeenVersion.v1', patchVersion);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        localStorage.setItem('live-mmo-installed', name);
    }, { ...account, patchVersion: LATEST_PATCH_NOTE.version });
}

/** A resumed story scene can mount over any screen; skip it wherever it appears. */
async function skipScenes(page: Page, until: ReturnType<Page['locator']>) {
    const scene = page.getByRole('dialog', { name: /visual novel scene/i });
    for (let i = 0; i < 8; i++) {
        await expect(until.or(scene)).toBeVisible({ timeout: 30_000 });
        if (!await scene.isVisible()) return;
        await scene.getByRole('button', { name: 'Skip', exact: true }).click();
    }
}

test('an online shinobi knocked out in the field is on their village ward, and a Healer can treat them', async ({ page, request }, info) => {
    test.setTimeout(150_000);
    const tag = `${info.project.name.includes('mobile') ? 'm' : 'd'}${Date.now().toString(36)}`;
    const healer = await seedShinobi(request, `wardheal${tag}`, { sector: 0, tile: 60 }, {
        profession: 'healer', professionRank: 1, professionXp: 0, chakra: 3000, maxChakra: 3000,
    });
    const patient = await seedShinobi(request, `wardhurt${tag}`, { sector: 44, tile: 78 });

    // The patient is ONLINE in the field — presence from sector 44 — and is then
    // admitted exactly the way a defeat settles it: in the SAVE, never presence.
    const beat = await request.post('/api/player/heartbeat', {
        headers: patient.headers, data: { name: patient.name, sector: 44, tile: 78, character: patient.canonical.character },
    });
    expect(beat.status(), await beat.text()).toBe(200);
    const admittedAt = Date.now();
    const admitted = await request.post(`/api/save/${patient.name}?signal=1`, {
        headers: ADMIN,
        data: { ...patient.canonical, character: { ...(patient.canonical.character as object), hp: 0, hospitalized: true,
            hospitalizedAt: admittedAt, hospitalizedUntil: admittedAt + 60_000 } },
    });
    expect(admitted.status(), await admitted.text()).toBe(200);

    await signIn(page, healer);
    // The ward must answer from the SAVES. The roster graft would also show this
    // row, so the row alone cannot prove the ward endpoint is wired and reached.
    const wardAnswer = page.waitForResponse(async (response) => {
        if (!response.url().includes('/api/player/hospital-ward') || response.status() !== 200) return false;
        const body = await response.json().catch(() => null) as { patients?: Array<{ name?: string }> } | null;
        return !!body?.patients?.some((p) => p.name === patient.name);
    }, { timeout: 60_000 });
    await page.goto('/#/hospital', { waitUntil: 'domcontentloaded' });
    const ward = page.locator('section.healer-patient-list').filter({ has: page.locator('#healer-admitted-heading') });
    await skipScenes(page, ward);
    await wardAnswer;
    const row = ward.locator('.healer-patient-row').filter({ hasText: patient.name });
    await expect(row, 'the online patient appears on the ward within one poll').toBeVisible({ timeout: 25_000 });
    await expect(row, 'with the HP the save holds, not the stale presence frame').toContainText('HP 0/');

    const healed = page.waitForResponse((response) => response.url().includes('/api/player/heal') && response.request().method() === 'POST');
    await row.getByRole('button', { name: /Heal/ }).click();
    const response = await healed;
    expect(response.status(), await response.text()).toBe(200);
    // Treating a patient is the Healer's trade: a full restore from 0 HP pays XP.
    const healBody = await response.json() as { xpGained?: number; professionXp?: number };
    expect(healBody.xpGained ?? 0).toBeGreaterThan(0);
    await expect(row, 'a treated patient leaves the ward').toHaveCount(0);

    const after = await (await request.get(`/api/save/${patient.name}`, { headers: patient.headers })).json();
    expect(after.character.hospitalized).not.toBe(true);
    expect(after.character.hp).toBeGreaterThan(0);
    const healerAfter = await (await request.get(`/api/save/${healer.name}`, { headers: healer.headers })).json();
    expect(Number(healerAfter.character.professionXp ?? 0), 'the Healer banked profession XP').toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath('ward-treated.png'), animations: 'disabled' });
});

test('Stand & Fight starts the roaming Weekly Boss fight, and leaving it returns the hunter to the same sector', async ({ page, request }, info) => {
    test.setTimeout(180_000);
    // One boss per in-memory server: spawn it once, and every later project hunts
    // the same one. Projects can run on parallel workers, so a spawn that lost the
    // race (409 stale-generation) simply hunts the boss the other worker spawned.
    let boss = (await (await request.get('/api/weekly-boss')).json()).boss;
    if (!boss || boss.rewardsDistributed || Number(boss.expiresAt) <= Date.now()) {
        const spawned = await request.post('/api/weekly-boss', {
            headers: ADMIN, data: { kind: 'reset', expectedSpawnId: boss?.spawnId ?? null, requestedSpawnId: randomUUID() },
        });
        expect([200, 409], await spawned.text()).toContain(spawned.status());
        boss = spawned.status() === 200 ? (await spawned.json()).boss : (await (await request.get('/api/weekly-boss')).json()).boss;
        expect(boss?.weekKey, 'a live Weekly Boss is roaming').toBeTruthy();
    }
    // The boss hops sectors on a timer. Never start a hunt it will leave mid-test.
    let roam = weeklyBossRoamState(boss, Date.now());
    expect(roam?.active, 'the spawned boss is roaming').toBe(true);
    if (roam!.nextHopInMs < 75_000) {
        await page.waitForTimeout(roam!.nextHopInMs + 1_000);
        roam = weeklyBossRoamState(boss, Date.now());
    }
    const sector = roam!.currentSector;

    const tag = `${info.project.name.includes('mobile') ? 'm' : 'd'}${Date.now().toString(36)}`;
    const hunter = await seedShinobi(request, `bosshunt${tag}`, { sector, tile: 78 });
    expect(hunter.canonical.currentSector, 'the hunter stands in the boss sector').toBe(sector);
    const beat = await request.post('/api/player/heartbeat', {
        headers: hunter.headers, data: { name: hunter.name, sector, tile: 78, character: hunter.canonical.character },
    });
    expect(beat.status(), await beat.text()).toBe(200);

    await signIn(page, hunter);
    await page.goto('/#/worldMap', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-shell[data-screen="worldMap"]')).toBeVisible({ timeout: 45_000 });
    const stage = page.locator('.sector-stage-panel');
    const returnToSector = page.getByRole('button', { name: new RegExp(`Return to Sector ${sector}\\b`) });
    const skip = page.getByRole('button', { name: 'Skip', exact: true });
    // Step onto the sector board, skipping any resumed story scene. Each pass
    // waits for the board after its click, so a slow re-render under a loaded
    // machine is not mistaken for a click that did nothing.
    await expect(async () => {
        if (await stage.isVisible()) return;
        if (await skip.isVisible()) await skip.click();
        else if (await returnToSector.isVisible()) await returnToSector.click();
        await expect(stage).toBeVisible({ timeout: 4_000 });
    }).toPass({ timeout: 60_000 });

    // The boss stalks the hunter and engages on contact — the Stand/Flee prompt
    // opens by itself. This suite runs with reduced motion, where the boss used to
    // stand frozen on its (clipped) home tile and never engaged at all; it now
    // steps toward the player like the road wanderers do.
    const bossFigure = page.locator('.sector-wanderer-figure[title*="Weekly Boss is bearing down"]');
    await expect(bossFigure).toBeAttached({ timeout: 30_000 });
    const stand = page.getByRole('button', { name: 'Stand & Fight', exact: true });
    await expect(stand, 'the boss reaches the hunter and confronts them').toBeVisible({ timeout: 30_000 });
    const started = page.waitForResponse((response) => response.url().endsWith('/api/weekly-boss')
        && response.request().method() === 'POST' && response.request().postDataJSON()?.kind === 'startFight');
    await stand.click();
    const startResponse = await started;
    const start = await startResponse.json();
    expect(startResponse.status(), JSON.stringify(start)).toBe(200);
    expect(start.runId, 'Stand & Fight sealed a real Weekly Boss run').toBeTruthy();

    await expect(page.locator('.app-shell[data-screen="weeklyBoss"]')).toBeVisible();
    const flee = page.getByRole('button', { name: /^Flee/ }).first();
    await expect(flee, 'the fight is on the board').toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: info.outputPath('weekly-boss-fight.png'), animations: 'disabled' });

    // Leave the fight the way the engine's own abandon does — a terminal forfeit
    // that costs 10% HP, so the hunter walks away on their feet. (A Flee is a 50%
    // escape roll; the abandon keeps this journey deterministic.)
    const state = await (await request.get(`/api/solo-pve/state?sessionId=${start.runId}&playerName=${hunter.name}`, { headers: hunter.headers })).json();
    const abandoned = await request.post('/api/solo-pve/action', {
        headers: hunter.headers,
        data: { playerName: hunter.name, sessionId: start.runId, type: 'abandon', expectedVersion: state.session.version, moveToken: `e2e-abandon-${tag}` },
    });
    expect(abandoned.status(), await abandoned.text()).toBe(200);
    // The board polls only on the enemy's turn. On the hunter's own turn, their
    // next action learns the terminal state from the server's stale-version reply.
    if (await flee.isEnabled().catch(() => false)) await flee.click();

    // The primary button's decorative ✦ glyphs are part of its accessible name.
    const back = page.getByRole('button', { name: /Return to the World Map/ });
    await expect(back, 'the result sends the hunter back to the map, not the tracker').toBeVisible({ timeout: 45_000 });
    await back.click();
    await expect(page.locator('.app-shell[data-screen="worldMap"]')).toBeVisible();
    await expect(stage, 'the sector board the hunter stood on reopens').toBeVisible();
    const after = await (await request.get(`/api/save/${hunter.name}`, { headers: hunter.headers })).json();
    expect(after.currentSector, 'fighting the boss never moved the hunter').toBe(sector);
    expect(after.character.hospitalized).not.toBe(true);
    await page.screenshot({ path: info.outputPath('weekly-boss-back-in-sector.png'), animations: 'disabled' });
});

test('leaving a live Card Hall showdown forfeits it, and the loss is on the record', async ({ page, request }, info) => {
    test.setTimeout(150_000);
    const tag = `${info.project.name.includes('mobile') ? 'm' : 'd'}${Date.now().toString(36)}`;
    // The save clamps the tutorial marker to the current rules version, so 999
    // reads as "seen" whatever that version is.
    const duelist = await seedShinobi(request, `cardleave${tag}`, { sector: 0, tile: 60 }, {
        starterCardsClaimed: true, cardClashTutorialVersion: 999, cardClashTutorialSeen: true,
        cardClashWins: 0, cardClashLosses: 0, cardClashDraws: 0,
    });

    await signIn(page, duelist);
    await page.goto('/#/shinobiTiles', { waitUntil: 'domcontentloaded' });
    const hall = page.locator('.app-shell[data-screen="shinobiTiles"]');
    const sections = page.getByRole('navigation', { name: 'Card Hall sections' });
    await skipScenes(page, sections);
    await sections.getByRole('button', { name: 'Play', exact: true }).click();

    const started = page.waitForResponse((response) => response.url().includes('/api/card-clash/ai-start')
        && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Start Showdown vs AI' }).click();
    const startResponse = await started;
    expect(startResponse.status(), await startResponse.text()).toBe(200);
    expect((await startResponse.json()).matchId, 'a real showdown was sealed').toBeTruthy();
    // A live showdown fills the screen; the board's own exit is the way out.
    const exit = page.getByRole('button', { name: 'Return to Hall' });
    await expect(exit, 'the showdown board is up').toBeVisible({ timeout: 30_000 });

    // Leaving asks first, and choosing to stay keeps the showdown.
    const leave = page.getByRole('alertdialog').filter({ hasText: 'Leaving forfeits it and counts as a loss.' });
    await exit.click();
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(leave).toHaveCount(0);
    await expect(exit, 'staying keeps the showdown on the board').toBeVisible();

    // Leaving for real forfeits on the server and closes the board.
    const forfeited = page.waitForResponse((response) => response.url().includes('/api/card-clash/ai-move')
        && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'forfeit');
    await exit.click();
    await leave.getByRole('button', { name: 'Confirm', exact: true }).click();
    const forfeitResponse = await forfeited;
    expect(forfeitResponse.status(), await forfeitResponse.text()).toBe(200);
    expect((await forfeitResponse.json()).session?.status, 'the showdown is over').toBe('complete');
    await expect(exit, 'the forfeited board closes').toHaveCount(0, { timeout: 15_000 });
    const header = page.locator('header.chronicle-header');
    await expect(header, 'the Hall shows the loss it just recorded').toContainText('1L');

    // With nothing live, the Hall's Back lets the player out: the menus are open again.
    await header.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(hall, 'Back leaves the Card Hall once the showdown is forfeited').toHaveCount(0, { timeout: 15_000 });

    const after = await (await request.get(`/api/save/${duelist.name}`, { headers: duelist.headers })).json();
    expect(after.character.cardClashLosses, 'the walk-out is a loss on the record').toBe(1);
    expect(Number(after.character.cardClashWins ?? 0)).toBe(0);
    await page.screenshot({ path: info.outputPath('card-hall-left.png'), animations: 'disabled' });
});
