import { expect, type APIRequestContext, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { openLandingLogin } from '../e2e/helpers/landing-navigation';
import { API_CONNECTION_RETRIES, test } from './helpers/reconnecting-request';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';

// Real handler responses span save, market, pet and receipt schemas in this
// cross-system journey; each consumed field is asserted at its use boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const PASSWORD = 'ExchangeJourney!1234';
const RYO_ITEM = 'training-katana';
const SHARD_ITEM = 'black-lotus-dagger';

function pet(id: string, templateId: string, name: string, element: string) {
    return {
        id, templateId, name, element, rarity: 'rare', level: 60, xp: 0, maxLevel: 100,
        hp: 420, attack: 72, defense: 58, speed: 64, jutsus: [], unlockedForPve: true,
        trait: 'Loyal', happiness: 88, origin: 'wild', generation: 0,
        breedingUsesMax: 8, breedingUsesRemaining: 8,
    };
}

function character(name: string, inventory: string[], pets: Json[]) {
    return {
        name, village: 'Moonshadow Village', storyVillage: 'Moonshadow Village', specialty: 'Ninjutsu', bloodline: 'None',
        level: 100, rankTitle: 'Jonin', xp: 0, unspentStats: 0, storyProgress: 99,
        onboardingStep: 'done', academyChecklistClaimed: true, starterCardsClaimed: true,
        examsPassed: ['genin', 'chunin', 'jonin'], profession: 'vanguard', professionRank: 1,
        professionXp: 0, professionChosenAt: 1, chroniclePoints: 0,
        hp: 1_000, maxHp: 1_000, chakra: 1_000, maxChakra: 1_000, stamina: 1_000, maxStamina: 1_000,
        stats: Object.fromEntries(['strength', 'speed', 'intelligence', 'willpower', 'bukijutsuOffense',
            'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense', 'genjutsuOffense',
            'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense'].map(key => [key, 100])),
        ryo: 10_000, fateShards: 1_000, inventory, itemStacks: [], equipment: {}, weaponElements: {},
        pets, tileCards: [], jutsuMastery: [], equippedJutsuIds: [], pendingCombatMissionClaims: [],
    };
}

async function seedAccount(request: APIRequestContext, info: TestInfo, tag: string, seededCharacter: Json) {
    const name = `exchange${tag}${info.workerIndex}${Date.now().toString(36)}`;
    seededCharacter.name = name;
    const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password: PASSWORD } });
    expect(registered.status(), await registered.text()).toBe(200);
    const token = String((await registered.json()).token ?? '');
    const headers = { 'x-player-name': name, 'x-player-token': token };
    const seeded = await request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': 'live-express-e2e-admin' },
        data: {
            character: seededCharacter, currentSector: 40, acceptedMissionIds: [], missionProgress: {},
            triggeredEvents: ['builtin-awakening-lv2', 'builtin-aura-sphere-lv9', 'builtin-hidden-dungeon',
                ...[20, 30, 42, 58, 70, 80, 88, 92].map(level => `story-interlude-moonshadow-village-${level}`)],
        },
    });
    expect(seeded.status(), await seeded.text()).toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    const canonicalResponse = await request.get(`/api/save/${name}`, { headers });
    expect(canonicalResponse.status(), await canonicalResponse.text()).toBe(200);
    return { name, token, headers, canonical: await canonicalResponse.json() as Json };
}

async function installSession(context: BrowserContext, account: Awaited<ReturnType<typeof seedAccount>>) {
    await context.addInitScript(({ name, token, canonical, patch }) => {
        if (localStorage.getItem('exchange-journey-installed') === name) return;
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name);
        localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        localStorage.setItem('exchange-journey-installed', name);
    }, { ...account, patch: LATEST_PATCH_NOTE.version });
}

async function openExchange(page: Page) {
    await page.goto('/#/sunscarFestival', { waitUntil: 'domcontentloaded' });
    const hall = page.locator('.sx-hall');
    const enter = page.getByRole('button', { name: 'Enter the Exchange', exact: true });
    const worldMap = page.getByRole('button', { name: 'Enter World Map', exact: true });
    // A restored internal Festival mode can paint the hall before the shell's
    // route attribute catches up. Either the hub entry or the hall itself is a
    // valid ready state; both are player-visible and unambiguous.
    await expect(hall.or(enter).or(worldMap)).toBeVisible();
    if (await worldMap.isVisible()) {
        // A clean login correctly starts in the village safe zone. Return to
        // Sunscar through the actual map-travel flow instead of relying on a
        // deep link that the route guard is supposed to reject.
        await worldMap.click();
        await expect(page.locator('.anime-world-map')).toBeVisible();
        await page.getByRole('button', { name: 'Travel to Cactus Flats (Sector 54)', exact: true }).click();
        await expect(enter).toBeVisible({ timeout: 15_000 });
    }
    if (!(await hall.isVisible())) {
        await expect(enter).toBeVisible();
        await enter.click();
    }
    // The Festival card uses the same heading copy; the hall root is the
    // authoritative transition signal, not a text match against the hub.
    await expect(hall).toBeVisible();
    await expect(hall.getByRole('heading', { name: 'Sunscar Exchange', exact: true })).toBeVisible();
    // High-level fixtures have earned several story interludes. They are marked
    // complete above, but tolerate a queued scene from an older preview so a
    // narrative modal can never masquerade as an Exchange loading timeout.
    const skip = page.getByRole('button', { name: /^(?:Skip|Skip visual novel scene)$/i }).last();
    for (let attempt = 0; attempt < 6; attempt++) {
        if (await skip.isVisible().catch(() => false)) {
            await skip.click();
            await expect(page.getByRole('dialog', { name: /visual novel scene/i })).toHaveCount(0);
            break;
        }
        await page.waitForTimeout(200);
    }
}

async function listAsset(page: Page, name: string, price: number, currency: 'ryo' | 'fateShards') {
    const sellTab = page.getByRole('button', { name: 'Sell an asset', exact: true });
    await expect(sellTab).toBeVisible();
    await sellTab.click();
    const search = page.getByRole('searchbox', { name: 'Search the Exchange' });
    await search.fill(name);
    const asset = page.locator('.sx-listing', { hasText: name });
    await expect(asset).toHaveCount(1);
    await asset.click();
    await page.getByLabel('Payment currency').selectOption(currency);
    await page.getByLabel('Total asking price').fill(String(price));
    await page.getByRole('button', { name: 'Review listing →', exact: true }).click();
    await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
    await expect(page.getByText('Listing published. Your goods are now held by the Exchange.', { exact: true })).toBeVisible();
}

async function inspectListing(page: Page, name: string, sellerName: string) {
    await page.getByRole('button', { name: 'Browse market', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search the Exchange' }).fill(name);
    const listing = page.locator('.sx-listing', { hasText: name }).filter({ hasText: `From ${sellerName}` });
    await expect(listing).toHaveCount(1);
    await listing.click();
}

async function logoutAndRelogin(page: Page, name: string) {
    const loggedOut = page.getByTestId('start-create');
    const blocked = page.getByRole('alertdialog', { name: /Save temporarily paused|Save Failed/ });
    for (let attempt = 0; attempt < 3; attempt++) {
        await page.waitForTimeout(3_100);
        await page.getByRole('button', { name: 'Logout', exact: true }).click();
        await expect(loggedOut.or(blocked)).toBeVisible();
        if (await loggedOut.isVisible()) break;
        await blocked.getByRole('button', { name: 'Stay in game', exact: true }).click();
    }
    await expect(loggedOut).toBeVisible();
    await openLandingLogin(page);
    await page.getByRole('button', { name: 'Use a name and password' }).click();
    await page.getByLabel('Name').fill(name);
    await page.getByPlaceholder('Enter your password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Enter Village' }).click();
    await expect(loggedOut).toHaveCount(0);
}

test('real players list, safely retry, spend both currencies, make roster room, and keep every trade after relogin', async ({ browser, context, page, request }, info) => {
    test.skip(info.project.name.includes('mobile'), 'The full economy journey runs once on the desktop player shell.');
    test.setTimeout(210_000);
    page.setDefaultTimeout(20_000);

    const offeredPet = pet('exchange-offered-pet', 'rare-26', 'Sunstep Ocelot', 'Fire');
    const seller = await seedAccount(request, info, 'seller', character('', [RYO_ITEM, RYO_ITEM, SHARD_ITEM], [offeredPet]));
    const buyerPets = [
        pet('exchange-buyer-p1', 'rare-1', 'Tideback Otter', 'Water'),
        pet('exchange-buyer-p2', 'rare-16', 'Gale Heron', 'Wind'),
        pet('exchange-buyer-p3', 'rare-21', 'Stoneback Tanuki', 'Earth'),
        pet('exchange-buyer-p4', 'rare-6', 'Volt Marten', 'Lightning'),
        pet('exchange-buyer-p5', 'rare-11', 'Mist Serpent', 'Water'),
    ];
    const buyer = await seedAccount(request, info, 'buyer', character('', [], buyerPets));
    const rival = await seedAccount(request, info, 'rival', character('', [], []));

    await installSession(context, seller);
    await openExchange(page);
    await listAsset(page, 'Training Katana', 201, 'ryo');
    await listAsset(page, 'Black Lotus Dagger', 202, 'fateShards');
    await listAsset(page, offeredPet.name, 303, 'ryo');

    const buyerContext = await browser.newContext({ baseURL: String(info.project.use.baseURL) });
    await installSession(buyerContext, buyer);
    const buyerPage = await buyerContext.newPage();
    buyerPage.setDefaultTimeout(20_000);
    try {
        await openExchange(buyerPage);

        let droppedCommittedBuy = false;
        await buyerPage.route('**/api/festival/exchange', async route => {
            const body = route.request().postDataJSON() as { action?: string } | null;
            if (body?.action !== 'buy' || droppedCommittedBuy) return route.continue();
            const response = await route.fetch({ maxRetries: API_CONNECTION_RETRIES });
            expect(response.status(), 'the real server committed the purchase before the client received an uncertain result').toBe(200);
            droppedCommittedBuy = true;
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({ ok: false, pending: true, error: 'Connection interrupted. Retry the saved trade to check its outcome safely.' }),
            });
        });
        await inspectListing(buyerPage, 'Training Katana', seller.name);
        await buyerPage.getByRole('button', { name: 'Buy for 201 ryo', exact: true }).click();
        await expect.poll(() => droppedCommittedBuy).toBe(true);
        await expect(buyerPage.getByRole('alert')).toContainText('Connection interrupted. Retry the saved trade');
        await buyerPage.unroute('**/api/festival/exchange');
        await buyerPage.getByRole('dialog', { name: 'Inspect listing' })
            .getByRole('button', { name: 'Retry saved trade', exact: true }).click();
        await expect(buyerPage.getByText('Purchase complete. Your goods have been delivered.', { exact: true })).toBeVisible();

        await inspectListing(buyerPage, 'Black Lotus Dagger', seller.name);
        await buyerPage.getByRole('button', { name: 'Buy for 202 Fate Shards', exact: true }).click();
        await expect(buyerPage.getByText('Purchase complete. Your goods have been delivered.', { exact: true })).toBeVisible();

        await inspectListing(buyerPage, offeredPet.name, seller.name);
        await expect(buyerPage.getByText('Your companion roster is full. Move a companion to the Sanctuary before buying.', { exact: true })).toBeVisible();
        await expect(buyerPage.getByRole('button', { name: 'Buy for 303 ryo', exact: true })).toBeDisabled();
        await buyerPage.getByRole('button', { name: 'Manage companion roster', exact: true }).click();
        await expect(buyerPage.getByRole('heading', { name: 'Companion Sanctuary', exact: true })).toBeVisible();
        await buyerPage.getByLabel('Owned companion').selectOption(buyerPets[0].id);
        await buyerPage.getByRole('button', { name: 'Move to Sanctuary', exact: true }).click();
        await expect(buyerPage.getByRole('status')).toContainText(`${buyerPets[0].name} is resting safely in the Sanctuary.`);
        await buyerPage.getByRole('button', { name: 'Return to Exchange', exact: true }).click();
        await expect(buyerPage.getByRole('button', { name: 'Buy for 303 ryo', exact: true })).toBeEnabled();
        await buyerPage.getByRole('button', { name: 'Buy for 303 ryo', exact: true }).click();
        await expect(buyerPage.getByText('Purchase complete. Your goods have been delivered.', { exact: true })).toBeVisible();

        const saved = async () => (await (await request.get(`/api/save/${buyer.name}`, { headers: buyer.headers })).json()) as Json;
        await expect.poll(async () => (await saved()).character.ryo).toBe(9_496);
        let stored = await saved();
        expect(stored.character.fateShards).toBe(798);
        expect(stored.character.inventory).toEqual(expect.arrayContaining([RYO_ITEM, SHARD_ITEM]));
        expect(stored.character.pets.map((entry: Json) => entry.id)).toContain(offeredPet.id);
        expect(stored.character.pets.map((entry: Json) => entry.id)).not.toContain(buyerPets[0].id);

        // Publish the seller's second copy, then let the visible buyer and an
        // independently authenticated rival hit the real buy handler together.
        // The browser receives its genuine winning or losing response; either
        // way exactly one account may be debited and receive the escrowed item.
        await listAsset(page, 'Training Katana', 404, 'ryo');
        await inspectListing(buyerPage, 'Training Katana', seller.name);
        let race: { buyerStatus: number; rivalStatus: number } | null = null;
        await buyerPage.route('**/api/festival/exchange', async route => {
            const body = route.request().postDataJSON() as { action?: string; listingId?: string; expectedPrice?: number } | null;
            if (body?.action !== 'buy' || body.expectedPrice !== 404) return route.continue();
            const [buyerResponse, rivalResponse] = await Promise.all([
                route.fetch({ maxRetries: API_CONNECTION_RETRIES }),
                request.post('/api/festival/exchange', {
                    headers: rival.headers,
                    data: {
                        action: 'buy', playerName: rival.name, listingId: body.listingId,
                        expectedPrice: 404, expectedCurrency: 'ryo',
                    },
                }),
            ]);
            race = { buyerStatus: buyerResponse.status(), rivalStatus: rivalResponse.status() };
            await route.fulfill({ response: buyerResponse });
        });
        await buyerPage.getByRole('button', { name: 'Buy for 404 ryo', exact: true }).click();
        await expect.poll(() => race).not.toBeNull();
        expect([race!.buyerStatus, race!.rivalStatus].sort()).toEqual([200, 409]);
        await expect(
            buyerPage.getByText('Purchase complete. Your goods have been delivered.', { exact: true })
                .or(buyerPage.getByRole('alert')),
        ).toBeVisible();
        await buyerPage.unroute('**/api/festival/exchange');

        const afterRaceBuyer = await saved();
        const rivalResponse = await request.get(`/api/save/${rival.name}`, { headers: rival.headers });
        expect(rivalResponse.status(), await rivalResponse.text()).toBe(200);
        const afterRaceRival = await rivalResponse.json() as Json;
        const trainingKatanaCount = (save: Json) => save.character.inventory.filter((id: string) => id === RYO_ITEM).length;
        expect(trainingKatanaCount(afterRaceBuyer) + trainingKatanaCount(afterRaceRival)).toBe(2);
        expect(afterRaceBuyer.character.ryo + afterRaceRival.character.ryo).toBe(19_092);

        await buyerPage.reload({ waitUntil: 'domcontentloaded' });
        await buyerPage.locator('.app-shell[data-screen="sunscarFestival"]').waitFor({ state: 'visible' });
        await logoutAndRelogin(buyerPage, buyer.name);
        await openExchange(buyerPage);
        await buyerPage.getByRole('button', { name: 'Trade history', exact: true }).click();
        await expect(buyerPage.locator('.sx-listing', { hasText: 'Training Katana' })).toBeVisible();
        await expect(buyerPage.locator('.sx-listing', { hasText: 'Black Lotus Dagger' })).toBeVisible();
        await expect(buyerPage.locator('.sx-listing', { hasText: offeredPet.name })).toBeVisible();
        stored = await saved();
        expect([9_092, 9_496]).toContain(stored.character.ryo);
        expect(stored.character.fateShards).toBe(798);
    } finally {
        await buyerContext.close();
    }
});
