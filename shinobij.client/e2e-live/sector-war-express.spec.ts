import { expect, type APIRequestContext, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { openLandingLogin } from '../e2e/helpers/landing-navigation';
import { test } from './helpers/reconnecting-request';
import { uniquePlayerName } from './helpers/player-names';
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
    const name = uniquePlayerName((stamp) => `sector${tag}${info.workerIndex}${stamp}`);
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

async function openLiveSector(page: Page, game: 'Pet Battle' | 'Card Battle' = 'Pet Battle') {
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
    await expect(page.getByRole('button', { name: `Contested · ${game}`, exact: true })).toBeVisible({ timeout: 60_000 });
}

/** Back on the sector board after a battle screen, from either world-map view. */
async function backToSector(page: Page) {
    await expect(page.locator('.app-shell[data-screen="worldMap"]')).toBeVisible({ timeout: 60_000 });
    const returnToSector = page.getByRole('button', { name: new RegExp(`Return to Sector ${SECTOR}`) });
    const sectorMap = page.locator('.sector-image-map');
    await expect(sectorMap.or(returnToSector)).toBeVisible({ timeout: 60_000 });
    if (await returnToSector.isVisible()) await returnToSector.click();
    await expect(sectorMap).toBeVisible({ timeout: 60_000 });
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

// Owner ruling 2026-10-08: in a Pet war, attacking an enemy who stands in the
// contested sector is a pet battle against THAT player, opened for both of them
// as a Combat attack opens its fight, and it scores for the winner's village.
test('attacking an enemy in a Pet war\'s sector is a pet battle, opened on both players\' screens', async ({ browser, baseURL, context, page, request }, info) => {
    test.skip(info.project.name.includes('mobile'), 'The two-client battle runs once on the desktop player shell.');
    test.setTimeout(210_000);
    page.setDefaultTimeout(20_000);

    const attacker = await seedAccount(request, info, 'openatk', ATTACKER_VILLAGE, pet('open-attacker-pet', 'rare-26', 'Tempest Ocelot', 'Lightning', 82));
    const defender = await seedAccount(request, info, 'opendef', DEFENDER_VILLAGE, pet('open-defender-pet', 'rare-1', 'Cinder Otter', 'Fire', 70));
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
    attacker.canonical = await (await request.get(`/api/save/${attacker.name}`, { headers: attacker.headers })).json() as Json;
    defender.canonical = await (await request.get(`/api/save/${defender.name}`, { headers: defender.headers })).json() as Json;

    const defenderContext = await browser.newContext({
        baseURL, viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce', serviceWorkers: 'block',
    });
    try {
        await installSession(context, attacker);
        await installSession(defenderContext, defender);
        const defenderPage = await defenderContext.newPage();
        defenderPage.setDefaultTimeout(20_000);
        await openLiveSector(page);
        await openLiveSector(defenderPage);
        // The defender is already on the Pet screen, at the war's table: the
        // battle they are drawn into must replace it, not wait behind it.
        await defenderPage.getByRole('button', { name: 'Contested · Pet Battle', exact: true }).click();
        await expect(defenderPage.getByRole('heading', { name: 'Pet Duel — Sector War' })).toBeVisible();

        // The enemy standing in the sector is offered the war's own game.
        const battle = page.getByRole('button', { name: `Pet Battle ${defender.name}`, exact: true });
        await expect(battle).toBeEnabled({ timeout: 60_000 });
        await battle.click();

        const verdict = /Your pet won the sector duel|Your pet was defeated/;
        await expect(page.locator('.app-shell[data-screen="sectorPet"]')).toBeVisible();
        await expect(page.getByText(verdict)).toBeVisible({ timeout: 30_000 });
        // The target's client hears of it and opens the same battle on its own.
        await expect(defenderPage.locator('.app-shell[data-screen="sectorPet"]')).toBeVisible({ timeout: 30_000 });
        await expect(defenderPage.getByText(verdict)).toBeVisible({ timeout: 30_000 });
        const attackerWon = await page.getByText('Your pet won the sector duel!').isVisible();
        expect(await defenderPage.getByText('Your pet won the sector duel!').isVisible(), 'one battle, one winner').toBe(!attackerWon);
        await page.screenshot({ path: info.outputPath('open-pet-battle-attacker.png'), animations: 'disabled' });
        await defenderPage.screenshot({ path: info.outputPath('open-pet-battle-target.png'), animations: 'disabled' });

        const scored = (await warMap(request, attacker.headers)).contests.find((entry: Json) => entry.id === contest.id) as Json;
        expect(attackerWon ? scored.attackerPoints : scored.defenderPoints, 'it scored for the winner\'s village').toBeGreaterThan(0);
        expect(attackerWon ? scored.defenderPoints : scored.attackerPoints).toBe(0);

        const result = page.getByRole('dialog', { name: /Victory|Defeat/ });
        await expect(result).toBeVisible({ timeout: 60_000 });
        await result.getByRole('button', { name: 'Leave the Showdown', exact: true }).click();
        await backToSector(page);

        // The same two cannot be set on each other again at once, and the
        // player is told why on that player's row rather than by a pop-up.
        await expect(battle).toBeEnabled({ timeout: 60_000 });
        await battle.click();
        await expect(page.getByText(/You two met in battle moments ago/)).toBeVisible();
        await expect(page.locator('.app-shell[data-screen="worldMap"]')).toBeVisible();
        const unchanged = (await warMap(request, attacker.headers)).contests.find((entry: Json) => entry.id === contest.id) as Json;
        expect(unchanged).toMatchObject({ attackerPoints: scored.attackerPoints, defenderPoints: scored.defenderPoints });
    } finally {
        await defenderContext.close();
    }
});

// The same ruling for a Card war: the attack is a card duel with that player.
// Both seats are named; the target's client takes its seat on its own, and a
// duelist who walks away mid-match forfeits it to the other village.
test('attacking an enemy in a Card war\'s sector is a card duel the target is seated in', async ({ browser, baseURL, context, page, request }, info) => {
    test.skip(info.project.name.includes('mobile'), 'The two-client duel runs once on the desktop player shell.');
    test.setTimeout(210_000);
    page.setDefaultTimeout(20_000);

    const attacker = await seedAccount(request, info, 'cardatk', ATTACKER_VILLAGE, pet('card-attacker-pet', 'rare-26', 'Tempest Ocelot', 'Lightning', 82));
    const defender = await seedAccount(request, info, 'carddef', DEFENDER_VILLAGE, pet('card-defender-pet', 'rare-1', 'Cinder Otter', 'Fire', 70));
    const setup = await request.post('/api/_qa/sector-war', {
        headers: { 'x-admin-password': 'live-express-e2e-admin' },
        data: {
            action: 'seed', sector: SECTOR, attackerVillage: ATTACKER_VILLAGE,
            defenderVillage: DEFENDER_VILLAGE, attackerName: attacker.name,
            defenderName: defender.name, winCondition: 'card',
        },
    });
    expect(setup.status(), await setup.text()).toBe(200);
    const contest = (await setup.json() as Json).contest as Json;
    attacker.canonical = await (await request.get(`/api/save/${attacker.name}`, { headers: attacker.headers })).json() as Json;
    defender.canonical = await (await request.get(`/api/save/${defender.name}`, { headers: defender.headers })).json() as Json;

    const defenderContext = await browser.newContext({
        baseURL, viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce', serviceWorkers: 'block',
    });
    try {
        await installSession(context, attacker);
        await installSession(defenderContext, defender);
        const defenderPage = await defenderContext.newPage();
        defenderPage.setDefaultTimeout(20_000);
        await openLiveSector(page, 'Card Battle');
        await openLiveSector(defenderPage, 'Card Battle');
        // The defender is already on the Card screen, waiting at the war's table:
        // the duel they are challenged to must replace it, not wait behind it.
        await defenderPage.getByRole('button', { name: 'Contested · Card Battle', exact: true }).click();
        await expect(defenderPage.getByText('No attacker has opened this sector\'s table yet.', { exact: false })).toBeVisible({ timeout: 30_000 });

        // The target's own client takes its seat; nobody presses anything there.
        const seated = defenderPage.waitForResponse((response) => response.url().includes('/api/village/sector-card')
            && response.request().postDataJSON()?.action === 'join' && !!response.request().postDataJSON()?.engageId
            && response.status() === 200, { timeout: 60_000 });
        const duel = page.getByRole('button', { name: `Card Battle ${defender.name}`, exact: true });
        await expect(duel).toBeEnabled({ timeout: 60_000 });
        await duel.click();
        await expect(page.locator('.app-shell[data-screen="sectorCard"]')).toBeVisible();
        await expect(defenderPage.locator('.app-shell[data-screen="sectorCard"]')).toBeVisible({ timeout: 30_000 });
        const join = await (await seated).json() as Json;
        expect(join.session?.viewerSide, 'the target holds the defending seat').toBe('p2');
        expect(String(join.session?.p1?.name).toLowerCase(), 'the challenger holds the attacking seat').toBe(attacker.name.toLowerCase());

        // Both duelists are at the same live match, each facing the other. A live
        // board fills the screen (the table's header hides), so the board's own
        // exit is the way out.
        for (const [duelist, opponent] of [[page, defender.name], [defenderPage, attacker.name]] as const) {
            await expect(duelist.locator('main.chronicle-shell--duel-active')).toBeVisible({ timeout: 30_000 });
            await expect(duelist.getByText(new RegExp(`^${opponent}$`, 'i')).first()).toBeVisible();
        }
        await page.screenshot({ path: info.outputPath('open-card-duel-attacker.png'), animations: 'disabled' });
        await defenderPage.screenshot({ path: info.outputPath('open-card-duel-target.png'), animations: 'disabled' });

        // The challenger walks away mid-match: that forfeits it to the other village.
        await page.getByRole('button', { name: 'Back to World Map', exact: true }).click();
        const leave = page.getByRole('alertdialog').filter({ hasText: 'Leaving a live match forfeits it.' });
        await expect(leave).toBeVisible();
        const forfeited = page.waitForResponse((response) => response.url().includes('/api/village/sector-card')
            && response.request().postDataJSON()?.action === 'forfeit');
        await leave.getByRole('button', { name: 'Confirm', exact: true }).click();
        const forfeit = await (await forfeited).json() as Json;
        expect(forfeit.warResult?.scored, 'the forfeit scored for the war').toBe(true);
        await expect(page.locator('.app-shell[data-screen="worldMap"]')).toBeVisible();
        await expect(defenderPage.getByText('The server scored this win for your side of the war.')).toBeVisible({ timeout: 30_000 });

        const scored = (await warMap(request, attacker.headers)).contests.find((entry: Json) => entry.id === contest.id) as Json;
        expect(scored.defenderPoints, 'the defending village won the duel').toBeGreaterThan(0);
        expect(scored.attackerPoints).toBe(0);
    } finally {
        await defenderContext.close();
    }
});
