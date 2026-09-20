import { expect, type APIRequestContext, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { openLandingLogin } from '../e2e/helpers/landing-navigation';
import { test } from './helpers/reconnecting-request';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';

// Real handler responses span save, war-map, contest and replay schemas in this
// cross-system journey; each consumed field is asserted at its use boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const PASSWORD = 'SectorJourney!1234';
const SECTOR = 10;
const ATTACKER_VILLAGE = 'Stormveil Village';
const DEFENDER_VILLAGE = 'Ashen Leaf Village';

function pet(id: string, templateId: string, name: string, element: string, attack: number) {
    return {
        id, templateId, name, element, rarity: 'rare', level: 60, xp: 0, maxLevel: 100,
        hp: 420, attack, defense: 58, speed: 64, jutsus: [], unlockedForPve: true,
        trait: 'Loyal', happiness: 88, origin: 'wild', generation: 0,
        breedingUsesMax: 8, breedingUsesRemaining: 8,
    };
}

function character(name: string, village: string, companion: Json) {
    return {
        name, village, storyVillage: village, specialty: 'Ninjutsu', bloodline: 'None',
        level: 100, rankTitle: 'Jonin', xp: 0, unspentStats: 0, storyProgress: 99,
        onboardingStep: 'done', academyChecklistClaimed: true, starterCardsClaimed: true,
        examsPassed: ['genin', 'chunin', 'jonin'], profession: 'vanguard', professionRank: 1,
        professionXp: 0, professionChosenAt: 1, chroniclePoints: 0,
        hp: 1_000, maxHp: 1_000, chakra: 1_000, maxChakra: 1_000, stamina: 1_000, maxStamina: 1_000,
        stats: Object.fromEntries(['strength', 'speed', 'intelligence', 'willpower', 'bukijutsuOffense',
            'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense', 'genjutsuOffense',
            'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense'].map(key => [key, 100])),
        ryo: 10_000, fateShards: 100, inventory: [], itemStacks: [], equipment: {},
        pets: [companion], activePetId: companion.id, tileCards: [], jutsuMastery: [],
        equippedJutsuIds: [], pendingCombatMissionClaims: [],
    };
}

async function seedAccount(request: APIRequestContext, info: TestInfo, tag: string, village: string, companion: Json) {
    const name = `sector${tag}${info.workerIndex}${Date.now().toString(36)}`;
    const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password: PASSWORD } });
    expect(registered.status(), await registered.text()).toBe(200);
    const token = String((await registered.json()).token ?? '');
    const headers = { 'x-player-name': name, 'x-player-token': token };
    const seeded = await request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': 'live-express-e2e-admin' },
        data: {
            character: character(name, village, companion), currentSector: SECTOR,
            acceptedMissionIds: [], missionProgress: {},
            triggeredEvents: ['builtin-awakening-lv2', 'builtin-aura-sphere-lv9', 'builtin-hidden-dungeon',
                ...[20, 30, 42, 58, 70, 80, 88, 92].map(level => `story-interlude-${village.toLowerCase().replace(/\W+/g, '-')}-${level}`)],
        },
    });
    expect(seeded.status(), await seeded.text()).toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    const canonicalResponse = await request.get(`/api/save/${name}`, { headers });
    expect(canonicalResponse.status(), await canonicalResponse.text()).toBe(200);
    return { name, token, headers, canonical: await canonicalResponse.json() as Json, petId: companion.id };
}

async function installSession(context: BrowserContext, account: Awaited<ReturnType<typeof seedAccount>>) {
    await context.addInitScript(({ name, token, canonical, patch }) => {
        if (localStorage.getItem('sector-war-journey-installed') === name) return;
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name);
        localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        localStorage.setItem('legacyRumors.seen.v1:' + name, JSON.stringify([10, 20, 30, 40, 45]));
        localStorage.setItem('sector-war-journey-installed', name);
    }, { ...account, patch: LATEST_PATCH_NOTE.version });
}

async function warMap(request: APIRequestContext, headers: Record<string, string>) {
    const response = await request.get('/api/village/war-map', { headers });
    expect(response.status(), await response.text()).toBe(200);
    return await response.json() as Json;
}

async function openLiveSector(page: Page) {
    await page.goto('/#/worldMap', { waitUntil: 'domcontentloaded' });
    const worldMapShell = page.locator('.app-shell[data-screen="worldMap"]');
    const enterWorldMap = page.getByRole('button', { name: 'Enter World Map', exact: true });
    await expect(worldMapShell.or(enterWorldMap)).toBeVisible({ timeout: 60_000 });
    if (await enterWorldMap.isVisible()) await enterWorldMap.click();
    await expect(worldMapShell).toBeVisible({ timeout: 60_000 });
    const returnToSector = page.getByRole('button', { name: new RegExp(`Return to Sector ${SECTOR}`) });
    const travelToSector = page.getByRole('button', { name: `Travel to Cliffside Deepwood (Sector ${SECTOR})`, exact: true });
    const sectorMap = page.locator('.sector-image-map');
    await expect(sectorMap.or(returnToSector).or(travelToSector)).toBeVisible({ timeout: 60_000 });
    if (await returnToSector.isVisible()) await returnToSector.click();
    else if (await travelToSector.isVisible()) await travelToSector.click();
    await expect(sectorMap).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Contested · Pet Battle', exact: true })).toBeVisible({ timeout: 60_000 });
}

async function logoutAndRelogin(page: Page, name: string) {
    const loggedOut = page.getByTestId('start-create');
    const blocked = page.getByRole('alertdialog', { name: /Save temporarily paused|Save Failed/ });
    const encounter = page.getByRole('dialog', { name: /— encounter$/ });
    await page.waitForTimeout(3_100);
    if (await encounter.isVisible()) {
        await encounter.getByRole('button', { name: 'Flee', exact: true }).click();
        await expect(encounter).toBeHidden();
    }
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await expect(loggedOut.or(blocked)).toBeVisible();
    if (await blocked.isVisible()) {
        await blocked.getByRole('button', { name: 'Log out anyway', exact: true }).click();
    }
    await expect(loggedOut).toBeVisible();
    await openLandingLogin(page);
    await page.getByRole('button', { name: 'Use a name and password' }).click();
    await page.getByLabel('Name').fill(name);
    await page.getByPlaceholder('Enter your password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Enter Village' }).click();
    await expect(loggedOut).toHaveCount(0);
}

test('a real sector pet war is discoverable, replayed, persistent, and isolated from a superseded duel', async ({ context, page, request }, info) => {
    test.skip(info.project.name.includes('mobile'), 'The full war journey runs once on the desktop player shell.');
    test.setTimeout(210_000);
    page.setDefaultTimeout(20_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const attackerPet = pet('sector-attacker-pet', 'rare-26', 'Tempest Ocelot', 'Lightning', 82);
    const defenderPet = pet('sector-defender-pet', 'rare-1', 'Cinder Otter', 'Fire', 70);
    const attacker = await seedAccount(request, info, 'attacker', ATTACKER_VILLAGE, attackerPet);
    const defender = await seedAccount(request, info, 'defender', DEFENDER_VILLAGE, defenderPet);
    const setup = await request.post('/api/_qa/sector-war', {
        headers: { 'x-admin-password': 'live-express-e2e-admin' },
        data: {
            action: 'seed', sector: SECTOR, attackerVillage: ATTACKER_VILLAGE,
            defenderVillage: DEFENDER_VILLAGE, attackerName: attacker.name,
            defenderName: defender.name, winCondition: 'pet',
        },
    });
    expect(setup.status(), await setup.text()).toBe(200);
    const contest = (await setup.json() as Json).contest as Json;
    expect(contest).toMatchObject({ sector: SECTOR, winCondition: 'pet', attackerPoints: 0, defenderPoints: 0 });
    attacker.canonical = await (await request.get(`/api/save/${attacker.name}`, { headers: attacker.headers })).json() as Json;
    defender.canonical = await (await request.get(`/api/save/${defender.name}`, { headers: defender.headers })).json() as Json;
    expect(attacker.canonical.currentSector).toBe(SECTOR);

    await installSession(context, attacker);
    await openLiveSector(page);
    await page.getByRole('button', { name: 'Contested · Pet Battle', exact: true }).click();
    await expect(page.locator('.app-shell[data-screen="sectorPet"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Pet Duel — Sector War/ })).toBeVisible();
    await page.getByRole('button', { name: 'Send into battle', exact: true }).click();
    await expect(page.getByText('Waiting for a defender to answer with their pet…', { exact: false })).toBeVisible();

    const defended = await request.post('/api/village/sector-pet', {
        headers: defender.headers,
        data: { action: 'join', sectorWarId: contest.id, playerName: defender.name, petId: defender.petId },
    });
    expect(defended.status(), await defended.text()).toBe(200);
    const decided = (await defended.json() as Json).session as Json;
    expect(decided).toMatchObject({ status: 'done', appliedToContest: true, engine: 'showdown' });

    await expect(page.getByText(/Your pet won the sector duel|Your pet was defeated/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('dialog', { name: /Pet Showdown/ })).toBeVisible({ timeout: 30_000 });
    const result = page.getByRole('dialog', { name: /Victory|Defeat/ });
    await expect(result).toBeVisible({ timeout: 60_000 });
    await result.getByRole('button', { name: 'Leave the Showdown', exact: true }).click();
    await page.locator('.app-shell[data-screen="worldMap"]').waitFor({ state: 'visible' });

    const scored = (await warMap(request, attacker.headers)).contests.find((entry: Json) => entry.id === contest.id) as Json;
    expect(scored.attackerPoints + scored.defenderPoints).toBeGreaterThan(0);
    const firstTally = { attackerPoints: scored.attackerPoints, defenderPoints: scored.defenderPoints };

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.app-shell[data-screen="worldMap"]').waitFor({ state: 'visible' });
    await logoutAndRelogin(page, attacker.name);
    await openLiveSector(page);
    const afterRelogin = (await warMap(request, attacker.headers)).contests.find((entry: Json) => entry.id === contest.id) as Json;
    expect(afterRelogin).toMatchObject(firstTally);

    // Open a second duel against the current contest, then replace the contest
    // before its defender arrives. The late terminal response must remain a
    // replayable duel without scoring the replacement war that reused the id.
    const openedLate = await request.post('/api/village/sector-pet', {
        headers: attacker.headers,
        data: { action: 'join', sectorWarId: contest.id, playerName: attacker.name, petId: attacker.petId },
    });
    expect(openedLate.status(), await openedLate.text()).toBe(200);
    expect((await openedLate.json() as Json).session.status).toBe('awaiting-defender');
    const replaced = await request.post('/api/_qa/sector-war', {
        headers: { 'x-admin-password': 'live-express-e2e-admin' },
        data: { action: 'replace', contestId: contest.id },
    });
    expect(replaced.status(), await replaced.text()).toBe(200);
    const replacement = (await replaced.json() as Json).contest as Json;
    expect(replacement).toMatchObject({ id: contest.id, attackerPoints: 0, defenderPoints: 0 });
    expect(replacement.startedAt).toBeGreaterThan(contest.startedAt);

    const lateDefender = await request.post('/api/village/sector-pet', {
        headers: defender.headers,
        data: { action: 'join', sectorWarId: contest.id, playerName: defender.name, petId: defender.petId },
    });
    expect(lateDefender.status(), await lateDefender.text()).toBe(200);
    expect((await lateDefender.json() as Json).session).toMatchObject({ status: 'done', appliedToContest: true });
    const isolated = (await warMap(request, attacker.headers)).contests.find((entry: Json) => entry.id === contest.id) as Json;
    expect(isolated).toMatchObject({ attackerPoints: 0, defenderPoints: 0, startedAt: replacement.startedAt });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await openLiveSector(page);
    await expect(page.getByRole('button', { name: 'Contested · Pet Battle', exact: true })).toBeVisible();
});
