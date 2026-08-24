import { expect, test, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test';

/*
 * Village Stores — the player loop, driven end to end in a real browser against
 * the real Express server (playwright.live.config.ts).
 *
 * The stores shipped fully unit-tested and with ZERO browser coverage: nothing
 * had ever cooked a ration, opened the Town Hall and watched Provisions rise.
 * This spec is that walk:
 *
 *   Cafeteria "Cook for the village" → ration packs + the daily cook counter
 *   → Town Hall → Treasury → "Donate to Provisions" → the Provisions row
 *   → "Donate to Materials" → the Materials row
 *   → the Supply log (empty state, then a real drained row).
 *
 * Every UI assertion is paired with a SERVER read (/api/village/war-map, which
 * is where the Town Hall itself reads the stores from, and /api/save/<name>),
 * so a screen that lies about a number fails the test.
 *
 * Determinism: no wall-clock arithmetic and no fixed sleeps. The daily cook /
 * donation counters are UTC-day keyed, so the expected figures are taken from
 * the SERVER's own response to the very click under test (`dailyCooked`,
 * `stores.provisions`) rather than recomputed here — a run that straddles UTC
 * midnight still asserts exactly what the server did.
 *
 * Isolation: a unique account per run, and every stores assertion is a DELTA
 * against a baseline read immediately beforehand, so a village treasury that
 * already holds stock cannot change the outcome. The account is deleted at the
 * end; the village row lives in the per-run in-memory KV and dies with the
 * server (SHINOBIX_QA_MEMORY_KV=1, reuseExistingServer: false).
 */

const ADMIN_PASSWORD = 'live-express-e2e-admin';
const PASSWORD = 'LiveExpress!1234';
/** Must be one of api/_war-map-sectors.ts WAR_VILLAGES — /api/village/war-map
 *  only reports stores for a war village, and the Town Hall reads it from there. */
const VILLAGE = 'Moonshadow Village';

const FIELD_RATIONS_YIELD = 5;
const CAMPAIGN_RATIONS_YIELD = 20;
const ASH_SCALE_POINTS = 15;          // api/craft/_forge.ts CRAFT_POINTS['hunt-ash-scale']
const SUPPLY_DEPOT_L6_MATERIALS = 400; // STRUCTURE_MATERIALS_BY_LEVEL[6]
/** Cumulative Honor-Seal cost of six supplyDepot upgrades: round(5·(l+1)^1.4). */
const DEPOT_L6_SEAL_COST = 185;
/** Ash Scales donated through the API to stock the drain (plus the one donated
 *  through the UI) — 28 × 15 = 420 materials, inside the 1,500/day donor cap. */
const BULK_ASH_SCALES = 27;

type Stores = { provisions: number; materialPoints: number; storesLedger: Array<Record<string, unknown>> };

function playerHeaders(name: string, token: string): Record<string, string> {
    return { 'x-player-name': name, 'x-player-token': token };
}

/** The two stores + the ledger straight off the server, through the same
 *  endpoint the Town Hall Treasury tab reads. */
async function readStores(request: APIRequestContext, name: string, token: string): Promise<Stores> {
    const response = await request.get('/api/village/war-map', { headers: playerHeaders(name, token) });
    expect(response.status(), '/api/village/war-map must answer the seeded player').toBe(200);
    const body = await response.json() as { villages?: Array<Record<string, unknown>> };
    const mine = (body.villages ?? []).find((v) => v.village === VILLAGE);
    expect(mine, `${VILLAGE} must appear in the war-map view`).toBeTruthy();
    return {
        provisions: Number(mine!.provisions) || 0,
        materialPoints: Number(mine!.materialPoints) || 0,
        storesLedger: Array.isArray(mine!.storesLedger) ? mine!.storesLedger as Array<Record<string, unknown>> : [],
    };
}

async function readSave(request: APIRequestContext, name: string, token: string): Promise<Record<string, unknown>> {
    const response = await request.get(`/api/save/${name}`, { headers: playerHeaders(name, token) });
    expect(response.status()).toBe(200);
    return await response.json() as Record<string, unknown>;
}

/** Copies of `itemId` a save holds — mirrors api/craft/_forge.ts countOwned. */
function countOwned(save: Record<string, unknown>, itemId: string): number {
    const character = (save.character ?? {}) as Record<string, unknown>;
    const loose = Array.isArray(character.inventory) ? (character.inventory as string[]) : [];
    const stacks = Array.isArray(character.itemStacks) ? (character.itemStacks as Array<Record<string, unknown>>) : [];
    return loose.filter((id) => id === itemId).length
        + stacks.filter((s) => String(s?.itemId ?? '') === itemId)
            .reduce((sum, s) => sum + (Math.floor(Number(s.count)) || 0), 0);
}

/**
 * A disposable account holding hunt spoils, ryo and seals, seeded through the
 * admin save write the other live specs use rather than by playing hours of
 * hunting. Unique per run so repeat runs (and a sibling worktree's server)
 * cannot collide.
 */
async function seedStoresAccount(request: APIRequestContext, testInfo: TestInfo) {
    const name = `storesqa${Date.now().toString(36)}${testInfo.project.name.includes('mobile') ? 'm' : 'd'}`;
    const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password: PASSWORD } });
    expect(registered.status(), 'the disposable stores account must register').toBe(200);
    const token = String((await registered.json()).token ?? '');
    expect(token.length).toBeGreaterThan(10);

    const character = {
        name,
        village: VILLAGE,
        specialty: 'Ninjutsu',
        bloodline: 'None',
        // Level 3 on purpose. The village stores have NO level gate, but level
        // 4 fires the first story milestone VN, level 9 the Aura Sphere VN,
        // level 13 the forced ProfessionPicker and level 20 the first story
        // interlude — four full-screen overlays that would each have to be
        // raced rather than avoided. The cheapest deterministic boot is a
        // character below all of them.
        level: 3,
        rankTitle: 'Academy Student',
        xp: 0,
        ryo: 50_000,
        honorSeals: 500,
        unspentStats: 0,
        stats: {
            strength: 20, speed: 20, intelligence: 20, willpower: 20,
            bukijutsuOffense: 20, bukijutsuDefense: 20,
            taijutsuOffense: 20, taijutsuDefense: 20,
            genjutsuOffense: 20, genjutsuDefense: 20,
            ninjutsuOffense: 20, ninjutsuDefense: 20,
        },
        hp: 100, maxHp: 100,
        chakra: 100, maxChakra: 100,
        stamina: 100, maxStamina: 100,
        onboardingStep: 'done',
        // A level-13+ character with no profession gets the FORCED
        // ProfessionPicker overlay, which blocks every click on every screen by
        // design (screens/ProfessionPicker.tsx). Seed a chosen profession so the
        // browser lands in an ordinary session instead of a modal.
        profession: 'healer',
        professionRank: 1,
        professionXp: 0,
        professionChosenAt: 1,
        inventory: [],
        // The hunt spoils the loop starts from. Campaign Rations consumes the
        // Frost Pelt first (recipe material order), so the Ash Scales survive
        // for the donation legs.
        itemStacks: [
            { itemId: 'hunt-beast-meat', count: 5 },
            { itemId: 'hunt-frost-pelt', count: 3 },
            { itemId: 'hunt-ash-scale', count: 30 },
        ],
        equipment: {}, pets: [],
        jutsuMastery: [], equippedJutsuIds: [],
        pendingCombatMissionClaims: [],
        dailyMissionsCompleted: 0,
    };
    // `?signal=1` is load-bearing, not decoration. A plain POST — even with the
    // admin password — runs the entitlement guard in api/save/_entitlement-guard.ts,
    // which conserves item ownership against the STORED save: a fresh account owns
    // nothing, so every seeded stack is silently dropped and the kitchen has
    // nothing to cook. The admin path skips the sanitizer, which is the only way
    // to hand a new account real hunt spoils.
    const seeded = await request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': ADMIN_PASSWORD },
        data: {
            character, currentSector: 0, acceptedMissionIds: [], missionProgress: {},
            // The level-gated builtin visual novels auto-open over whatever screen
            // the player lands on (App.tsx trigger effects). Marking them already
            // seen keeps the boot deterministic instead of racing a cutscene.
            triggeredEvents: ['builtin-awakening-lv2', 'builtin-aura-sphere-lv9', 'builtin-hidden-dungeon'],
        },
    });
    expect(seeded.status(), 'the admin seed write must land').toBe(200);
    // ...and `?signal=1` arms a 300s reset-signal that makes the player's first
    // heartbeat answer forceReload (and drops their own saves meanwhile). Ack it
    // immediately so the browser under test boots into an ordinary session
    // instead of reloading itself mid-loop.
    const acked = await request.post(`/api/save/${name}?ack=1`, { headers: playerHeaders(name, token) });
    expect(acked.status(), 'the admin reset-signal must be acked before the browser boots').toBe(200);

    // The seed is only useful if the server kept it: a sanitizer that dropped
    // itemStacks would leave a kitchen with nothing to cook and a green test
    // that proved nothing.
    const canonical = await readSave(request, name, token);
    expect(countOwned(canonical, 'hunt-beast-meat')).toBe(5);
    expect(countOwned(canonical, 'hunt-ash-scale')).toBe(30);
    expect(Number((canonical.character as Record<string, unknown>).ryo)).toBeGreaterThanOrEqual(50_000);

    return { name, token };
}

async function installSession(page: Page, name: string, token: string) {
    await page.addInitScript(({ player, sessionToken }) => {
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: player }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [player]: { token: sessionToken } }));
        localStorage.setItem('shinobix:activePlayerPersist', player);
        localStorage.setItem('shinobix:activeTokenPersist', sessionToken);
    }, { player: name, sessionToken: token });
}

/** Boot overlays (Daily Briefing, offline notices) sit over every screen on a
 *  first visit. Same shape as combat-layout-matrix.spec.ts's dismissNotices —
 *  bounded, and never a fixed sleep. The briefing's reward is deliberately NOT
 *  claimed: this spec asserts an exact ryo balance. */
async function dismissBootNotices(page: Page) {
    // A visual novel covers the briefing, so the cutscene is dismissed FIRST —
    // clicking the briefing underneath it only burns the retry budget.
    const closers = [
        page.getByRole('button', { name: 'Skip visual novel scene' }),
        page.getByRole('button', { name: /^Skip$/ }),
        page.getByRole('button', { name: /Close briefing/ }),
        page.getByRole('button', { name: /^Got it/ }),
    ];
    for (let guard = 0; guard < 6; guard += 1) {
        let clicked = false;
        for (const closer of closers) {
            const target = closer.last();
            if (!(await target.isVisible().catch(() => false))) continue;
            await target.click({ timeout: 5_000 }).catch(() => undefined);
            clicked = true;
            break;
        }
        if (!clicked) return;
    }
}

/** The panel a heading owns, so a sibling adding affordances around the heading
 *  cannot move the anchor. Role/text based — never an nth-child path. */
function panelFor(scope: Page | Locator, heading: RegExp | string): Locator {
    return scope.getByRole('heading', { name: heading }).locator('xpath=ancestor::section[1]');
}

async function openTreasuryTab(page: Page): Promise<Locator> {
    // The SPA writes the hash but never listens to it, so a goto that changes
    // ONLY the fragment leaves the player standing in the Cafeteria. The hash
    // is a deep link read at BOOT (lib/screen-guards DEEP_LINKABLE_SCREENS),
    // so it has to be set and then actually reloaded.
    await page.goto('/#/townHall', { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await dismissBootNotices(page);
    const tabs = page.getByRole('navigation', { name: 'Town Hall sections' });
    await expect(tabs).toBeVisible();
    await tabs.getByRole('button', { name: 'Treasury' }).click();
    const treasury = panelFor(page, /Village Treasury/);
    await expect(treasury).toBeVisible();
    return treasury;
}

test('a village cook turns hunt spoils into Provisions and Materials the server actually holds', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop-live', 'one desktop run covers the stores economy seam');

    const serverFailures: string[] = [];
    const dialogs: string[] = [];
    page.on('response', (response) => {
        if (response.url().includes('/api/') && response.status() >= 500) {
            serverFailures.push(`${response.status()} ${new URL(response.url()).pathname}`);
        }
    });
    // Every refusal in this loop reaches the player as an alert(). If one fires
    // the loop did NOT work, however green the rest of the DOM looks.
    page.on('dialog', (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });

    const { name, token } = await seedStoresAccount(request, testInfo);
    await installSession(page, name, token);

    try {
        // ── 1. Cafeteria: cook rations (UI) ──────────────────────────────
        await page.goto('/#/cafeteria', { waitUntil: 'networkidle' });
        await dismissBootNotices(page);
        await expect(page.getByRole('heading', { name: 'Cafeteria' })).toBeVisible();

        const kitchen = panelFor(page, 'Cook for the village');
        await expect(kitchen).toBeVisible();
        const rationChip = kitchen.getByRole('listitem').filter({ hasText: 'Ration packs' });
        const capLine = kitchen.getByText(/^Cooked today: [\d,]+\/40 rations\./);
        await expect(rationChip.locator('strong')).toHaveText('0');
        await expect(capLine).toBeVisible();

        const cookField = page.waitForResponse((r) =>
            new URL(r.url()).pathname === '/api/player/cafeteria' && r.request().method() === 'POST');
        await kitchen.getByRole('button', { name: /^Field Rations/ }).click();
        const fieldResponse = await cookField;
        expect(fieldResponse.status(), 'Field Rations must cook').toBe(200);
        expect(fieldResponse.request().postDataJSON()).toMatchObject({ playerName: name, recipeId: 'field-rations' });
        const fieldBody = await fieldResponse.json() as { cooked: number; dailyCooked: number; dailyCap: number };
        expect(fieldBody.cooked).toBe(FIELD_RATIONS_YIELD);
        expect(fieldBody.dailyCap).toBe(40);

        // ── 2. The counters the player reads must be the server's own ────
        await expect(rationChip.locator('strong')).toHaveText(String(FIELD_RATIONS_YIELD));
        await expect(capLine).toContainText(`Cooked today: ${fieldBody.dailyCooked}/40 rations.`);

        const cookCampaign = page.waitForResponse((r) =>
            new URL(r.url()).pathname === '/api/player/cafeteria' && r.request().method() === 'POST');
        await kitchen.getByRole('button', { name: /^Campaign Rations/ }).click();
        const campaignResponse = await cookCampaign;
        expect(campaignResponse.status(), 'Campaign Rations must cook').toBe(200);
        const campaignBody = await campaignResponse.json() as { cooked: number; dailyCooked: number };
        expect(campaignBody.cooked).toBe(CAMPAIGN_RATIONS_YIELD);

        const cookedTotal = FIELD_RATIONS_YIELD + CAMPAIGN_RATIONS_YIELD;
        await expect(rationChip.locator('strong')).toHaveText(String(cookedTotal));
        await expect(capLine).toContainText(`Cooked today: ${campaignBody.dailyCooked}/40 rations.`);
        // Frost Pelt is spent before Ash Scale, so the donation legs still have stock.
        await expect(kitchen.getByRole('listitem').filter({ hasText: 'Frost Pelt' }).locator('strong')).toHaveText('2');

        // Server truth, not the DOM: the packs and the spent spoils are on the save.
        const afterCook = await readSave(request, name, token);
        expect(countOwned(afterCook, 'ration-pack'), 'the server must hold the cooked packs').toBe(cookedTotal);
        expect(countOwned(afterCook, 'hunt-beast-meat')).toBe(4);
        expect(countOwned(afterCook, 'hunt-frost-pelt')).toBe(2);
        expect(Number((afterCook.character as Record<string, unknown>).ryo)).toBe(50_000 - 30 - 80);

        // ── 3. Town Hall → Treasury: donate rations into Provisions (UI) ──
        const baseline = await readStores(request, name, token);
        const treasury = await openTreasuryTab(page);
        const provisionsRow = treasury.getByText(/^Provisions:\s*[\d,]+ rations$/);
        const materialsRow = treasury.getByText(/^Materials:\s*[\d,]+ materials$/);
        await expect(provisionsRow).toHaveText(`Provisions: ${baseline.provisions.toLocaleString('en-US')} rations`);
        await expect(materialsRow).toHaveText(`Materials: ${baseline.materialPoints.toLocaleString('en-US')} materials`);

        const donateSelect = treasury.getByRole('combobox').filter({ has: page.getByRole('option', { name: 'Choose item' }) });
        await donateSelect.selectOption('ration-pack');
        // The control has to say what it does: routing is visible BEFORE the click.
        const donateProvisions = treasury.getByRole('button', { name: 'Donate to Provisions' });
        await expect(donateProvisions).toBeEnabled();

        const rationDonation = page.waitForResponse((r) =>
            new URL(r.url()).pathname === '/api/village/treasury/donate' && r.request().method() === 'POST');
        await donateProvisions.click();
        const rationDonateResponse = await rationDonation;
        expect(rationDonateResponse.status(), 'the ration donation must land').toBe(200);
        expect(rationDonateResponse.request().postDataJSON()).toMatchObject({ playerName: name, village: VILLAGE, itemId: 'ration-pack' });
        const rationDonateBody = await rationDonateResponse.json() as { stores?: { provisions: number; materialPoints: number } };
        expect(rationDonateBody.stores?.provisions, 'a ration pack routes into Provisions 1:1').toBe(baseline.provisions + 1);

        // ── 4. The Provisions row rises, and the SERVER agrees ───────────
        await expect(provisionsRow).toHaveText(`Provisions: ${(baseline.provisions + 1).toLocaleString('en-US')} rations`);
        const afterRations = await readStores(request, name, token);
        expect(afterRations.provisions, 'treasury.provisions must have moved server-side').toBe(baseline.provisions + 1);
        expect(afterRations.materialPoints, 'a ration must not touch Materials').toBe(baseline.materialPoints);

        // ── 5. A hunt material routes into Materials instead (UI) ────────
        await donateSelect.selectOption('hunt-ash-scale');
        const donateMaterials = treasury.getByRole('button', { name: 'Donate to Materials' });
        await expect(donateMaterials).toBeEnabled();

        const materialDonation = page.waitForResponse((r) =>
            new URL(r.url()).pathname === '/api/village/treasury/donate' && r.request().method() === 'POST');
        await donateMaterials.click();
        const materialDonateResponse = await materialDonation;
        expect(materialDonateResponse.status(), 'the material donation must land').toBe(200);
        const materialDonateBody = await materialDonateResponse.json() as { stores?: { provisions: number; materialPoints: number } };
        expect(materialDonateBody.stores?.materialPoints).toBe(baseline.materialPoints + ASH_SCALE_POINTS);

        const expectedMaterials = baseline.materialPoints + ASH_SCALE_POINTS;
        await expect(materialsRow).toHaveText(`Materials: ${expectedMaterials.toLocaleString('en-US')} materials`);
        const afterMaterials = await readStores(request, name, token);
        expect(afterMaterials.materialPoints, 'treasury.materialPoints must have moved server-side').toBe(expectedMaterials);
        expect(afterMaterials.provisions, 'a material must not touch Provisions').toBe(baseline.provisions + 1);

        // The donated stock left the donor — a routed donation is a real debit.
        const afterDonations = await readSave(request, name, token);
        expect(countOwned(afterDonations, 'ration-pack')).toBe(cookedTotal - 1);
        expect(countOwned(afterDonations, 'hunt-ash-scale')).toBe(29);

        // ── 6. Supply log: empty until something DRAINS the stores ───────
        // Donations are credits; the log records drains only (spoilage, siege
        // rations, garrison feed, depot conversions, structure builds), so the
        // honest assertion here is the empty state, not a row.
        const supplyLog = treasury.getByRole('heading', { name: 'Supply log' });
        await expect(supplyLog).toBeVisible();
        // Empty-state copy was reworded when the Supply log gained its scope
        // line (a donation is a credit and never appears here). Anchor on the
        // stable class rather than the sentence so copy edits don't break this.
        await expect(treasury.locator('.town-stores-log-empty')).toContainText(/Nothing spent yet\./);
        expect(afterMaterials.storesLedger, 'a donation must not write a ledger row').toEqual([]);

        // ── 7. A real drain (API-driven), then the log must show it (UI) ──
        // Standing up a 72h sector war or waiting for the nightly pass is not
        // drivable here, so the drain is the OTHER real producer: raising a
        // permanent structure to L6 burns 400 materials and writes a
        // `structure` ledger row. Stocked through the same donate endpoint.
        const seals = await request.post('/api/village/treasury/donate', {
            headers: { 'x-admin-password': ADMIN_PASSWORD },
            data: { playerName: name, village: VILLAGE, currency: 'honorSeals', amount: DEPOT_L6_SEAL_COST + 16 },
        });
        expect(seals.status(), 'the treasury must be funded for the upgrades').toBe(200);
        const bulk = await request.post('/api/village/treasury/donate', {
            headers: { 'x-admin-password': ADMIN_PASSWORD },
            data: { playerName: name, village: VILLAGE, itemId: 'hunt-ash-scale', count: BULK_ASH_SCALES },
        });
        expect(bulk.status(), 'the bulk material donation must land').toBe(200);
        const stocked = await readStores(request, name, token);
        expect(stocked.materialPoints).toBe(expectedMaterials + BULK_ASH_SCALES * ASH_SCALE_POINTS);
        expect(stocked.materialPoints).toBeGreaterThanOrEqual(SUPPLY_DEPOT_L6_MATERIALS);

        for (let level = 1; level <= 6; level++) {
            const upgrade = await request.post('/api/village/war-structure', {
                headers: { 'x-admin-password': ADMIN_PASSWORD },
                data: { playerName: name, village: VILLAGE, structure: 'supplyDepot' },
            });
            expect(upgrade.status(), `supplyDepot L${level} must be raised`).toBe(200);
            const upgradeBody = await upgrade.json() as { newLevel: number; materialsSpent?: number };
            expect(upgradeBody.newLevel).toBe(level);
            expect(upgradeBody.materialsSpent ?? 0).toBe(level === 6 ? SUPPLY_DEPOT_L6_MATERIALS : 0);
        }

        const drained = await readStores(request, name, token);
        expect(drained.materialPoints, 'the L6 build must burn 400 materials').toBe(stocked.materialPoints - SUPPLY_DEPOT_L6_MATERIALS);
        expect(drained.storesLedger.length, 'the drain must write exactly one ledger row').toBe(1);
        expect(drained.storesLedger[0]).toMatchObject({ kind: 'structure', amount: SUPPLY_DEPOT_L6_MATERIALS, by: name, ref: 'supplyDepot:6' });

        // Back through the player's eyes: the Supply log renders the drain.
        const reopened = await openTreasuryTab(page);
        await expect(reopened.getByRole('heading', { name: 'Supply log' })).toBeVisible();
        const drainRow = reopened.getByRole('listitem').filter({ hasText: 'Structure build' });
        await expect(drainRow).toHaveCount(1);
        await expect(drainRow).toContainText('Structure build −400 materials');
        await expect(drainRow).toContainText('Supply Depot L6');
        await expect(reopened.getByText(/^Materials:\s*[\d,]+ materials$/))
            .toHaveText(`Materials: ${drained.materialPoints.toLocaleString('en-US')} materials`);

        expect(dialogs, 'no step in the loop may refuse').toEqual([]);
        expect(serverFailures, 'no endpoint in the loop may 5xx').toEqual([]);
    } finally {
        // The disposable account never outlives the run.
        await request.delete(`/api/save/${name}`, { headers: playerHeaders(name, token) }).catch(() => undefined);
    }
});
