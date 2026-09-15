import { expect, type APIRequestContext, type Page, type Route, type TestInfo } from '@playwright/test';
import { API_CONNECTION_RETRIES, test } from './helpers/reconnecting-request';
import { writeFile } from 'node:fs/promises';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';

/*
 * Seeded late-feature fixture, not an organic Chronicle-unlock journey.
 * Uses playwright.live.config.ts's real Express + disposable memory store.
 * Run against a rebuilt artifact with --trace off: fixture authentication must
 * not be exported in traces. Entry is source-assisted: install the existing
 * authenticated session format and navigate directly to the known Shop route.
 * The attached summary contains only economic state and one timing observation
 * per navigation/request phase per project, with no performance thresholds.
 */
type Json = Record<string, unknown>;
type PackReply = { ok?: boolean; replayed?: boolean; cards?: string[]; cost?: number; currency?: string; _saveVersion?: number };
const PACK_PATH = '/api/card-clash/open-pack';

function economicState(record: Json) {
    const character = record.character as Json;
    return {
        chroniclePoints: Number(character.chroniclePoints ?? 0),
        fateShards: Number(character.fateShards ?? 0),
        ryo: Number(character.ryo ?? 0),
        cards: [...(Array.isArray(character.tileCards) ? character.tileCards as string[] : [])].sort(),
    };
}

async function seedPackAccount(request: APIRequestContext, info: TestInfo, initialChroniclePoints: number) {
    const name = `packqa${Date.now().toString(36)}${info.project.name.includes('mobile') ? 'm' : 'd'}`;
    const registration = await request.post('/api/player-auth', {
        data: { action: 'register', name, password: 'IsolatedPackJourney!1234' },
    });
    expect(registration.status(), 'the isolated fixture account must register').toBe(200);
    const token = String((await registration.json()).token ?? '');
    expect(token.length).toBeGreaterThan(10);
    const headers = { 'x-player-name': name, 'x-player-token': token };
    const character = {
        name, village: 'Moonshadow Village', specialty: 'Ninjutsu', bloodline: 'None',
        // Low-level boot avoids unrelated story/profession overlays. The codex
        // and Chronicle Points are explicitly seeded; no natural unlock claim.
        level: 3, rankTitle: 'Academy Student', xp: 0, unspentStats: 0,
        starterCardsClaimed: true, chroniclePoints: initialChroniclePoints, fateShards: 100, ryo: 5000,
        tileCards: [], inventory: [], itemStacks: [], equipment: {}, pets: [],
        jutsuMastery: [], equippedJutsuIds: [], pendingCombatMissionClaims: [],
        hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        stats: Object.fromEntries([
            'strength', 'speed', 'intelligence', 'willpower', 'bukijutsuOffense', 'bukijutsuDefense',
            'taijutsuOffense', 'taijutsuDefense', 'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
        ].map((key) => [key, 20])),
        onboardingStep: 'done', profession: 'healer', professionRank: 1, professionXp: 0, professionChosenAt: 1,
    };
    const seeded = await request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': 'live-express-e2e-admin' },
        data: {
            character, currentSector: 0, acceptedMissionIds: [], missionProgress: {},
            triggeredEvents: ['builtin-awakening-lv2', 'builtin-aura-sphere-lv9', 'builtin-hidden-dungeon'],
        },
    });
    expect(seeded.status(), 'admin fixture seed must commit before the browser starts').toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    const readSave = async () => {
        const response = await request.get(`/api/save/${name}`, { headers });
        expect(response.status(), 'owner read must return authoritative saved balances/cards').toBe(200);
        return await response.json() as Json;
    };
    const canonical = await readSave();
    expect((canonical.character as Json).starterCardsClaimed).toBe(true);
    expect(economicState(canonical).chroniclePoints).toBe(initialChroniclePoints);
    return { name, token, headers, canonical, readSave };
}

async function installSession(page: Page, account: Awaited<ReturnType<typeof seedPackAccount>>) {
    await page.addInitScript(({ name, token, canonical, patch }) => {
        if (localStorage.getItem('pack-retry-qa-installed') === name) return;
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name);
        localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        localStorage.setItem('pack-retry-qa-installed', name);
    }, { name: account.name, token: account.token, canonical: account.canonical, patch: LATEST_PATCH_NOTE.version });
}

async function expectShopReady(page: Page, purchaseEnabled = true, pendingControlScreenshot?: string) {
    await expect(page.getByRole('button', { name: /Basic Card Pack/ })).toBeVisible();
    const closers = [
        page.getByRole('button', { name: 'Skip visual novel scene' }),
        page.getByRole('button', { name: /Close briefing/ }),
        page.getByRole('button', { name: /^Got it/ }),
    ];
    for (let attempt = 0; attempt < 6; attempt++) {
        let closed = false;
        for (const closer of closers) {
            if (!(await closer.last().isVisible().catch(() => false))) continue;
            await closer.last().click();
            closed = true;
            break;
        }
        if (!closed) break;
    }
    await page.getByRole('button', { name: /Basic Card Pack/ }).scrollIntoViewIfNeeded();
    if (pendingControlScreenshot) await page.screenshot({ path: pendingControlScreenshot });
    if (purchaseEnabled) await expect(page.getByRole('button', { name: /Basic Card Pack/ })).toBeEnabled();
    else await expect(page.getByRole('button', { name: /Basic Card Pack/ })).toBeDisabled();
}

for (const initialChroniclePoints of [1000, 100]) {
test(`seeded Chronicle pack with ${initialChroniclePoints} CP: lost committed response recovers after reload${initialChroniclePoints === 1000 ? ' and a new purchase remains distinct' : ' at zero remaining CP'}`, async ({ page, request }, info) => {
    test.setTimeout(120_000);
    expect(new URL(String(info.project.use.baseURL)).hostname, 'use the isolated live Express configuration').toBe('127.0.0.1');
    const account = await seedPackAccount(request, info, initialChroniclePoints);
    await installSession(page, account);
    const evidence: Json[] = [];
    const timings: Array<{ phase: string; durationMs: number }> = [];
    const recordTiming = (phase: string, startedAt: number) => {
        timings.push({ phase, durationMs: Math.round((performance.now() - startedAt) * 100) / 100 });
    };
    const observed: Array<{ requestId: string; body: PackReply }> = [];
    const interceptPack = async (route: Route) => {
        const requestBody = route.request().postDataJSON() as Json;
        // This request reaches the real server. Only its already-committed HTTP
        // reply is lost; no request/response or saved economy is fabricated.
        const fetchStartedAt = performance.now();
        const response = await route.fetch({ maxRetries: API_CONNECTION_RETRIES });
        const fetchDurationMs = Math.round((performance.now() - fetchStartedAt) * 100) / 100;
        expect(response.status()).toBe(200);
        const body = await response.json() as PackReply;
        expect(body.ok).toBe(true);
        timings.push({
            phase: ['committed-pack-response-discarded-http', 'same-purchase-replay-http', 'distinct-purchase-http'][observed.length]
                ?? 'unexpected-pack-http',
            durationMs: fetchDurationMs,
        });
        observed.push({ requestId: String(requestBody.requestId ?? ''), body });
        if (observed.length === 1) await route.abort('failed');
        else await route.fulfill({ response });
    };

    try {
        const coldNavigationStartedAt = performance.now();
        await page.goto('/#/shop', { waitUntil: 'domcontentloaded' });
        await expectShopReady(page);
        recordTiming('cold-seeded-shop-navigation-to-ready', coldNavigationStartedAt);
        const opening = economicState(await account.readSave());
        expect(opening.chroniclePoints).toBe(initialChroniclePoints);
        evidence.push({ phase: 'opening-seeded-account', ...opening });
        await page.route(`**${PACK_PATH}`, interceptPack);

        await page.getByRole('button', { name: /Basic Card Pack/ }).click();
        // GameAlertHost replaces window.alert with the themed DOM Notice.
        const notice = page.getByRole('alertdialog', { name: 'Notice', exact: true });
        await expect(notice).toContainText(/Pack opening unconfirmed/i);
        await expect(notice).toContainText('Refresh before retrying to recover the same purchase.');
        await notice.getByRole('button', { name: 'OK', exact: true }).click();
        expect(observed).toHaveLength(1);
        expect(observed[0].requestId).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
        expect(observed[0].body.cards).toHaveLength(5);
        expect(observed[0].body.cost).toBe(100);
        expect(observed[0].body.currency).toBe('chroniclePoints');
        const committed = economicState(await account.readSave());
        expect(committed).toEqual({
            ...opening, chroniclePoints: opening.chroniclePoints - 100,
            cards: [...opening.cards, ...observed[0].body.cards!].sort(),
        });
        evidence.push({ phase: 'committed-response-discarded', requestId: observed[0].requestId, ...committed });
        const pendingKey = `shinobix.card-pack:${JSON.stringify({ playerName: account.name, packType: 'standard' })}`;
        expect(await page.evaluate((key) => sessionStorage.getItem(key), pendingKey)).toBe(observed[0].requestId);

        const recoveryReloadStartedAt = performance.now();
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('.chronicle-points-balance strong')).toHaveText(String(committed.chroniclePoints));
        await expectShopReady(page, true, info.outputPath('pending-pack-control.png'));
        recordTiming('warm-recovery-reload-to-ready', recoveryReloadStartedAt);
        expect(await page.evaluate((key) => sessionStorage.getItem(key), pendingKey)).toBe(observed[0].requestId);
        const replayResponse = page.waitForResponse((response) =>
            new URL(response.url()).pathname === PACK_PATH && response.request().method() === 'POST');
        await page.getByRole('button', { name: /Basic Card Pack/ }).click();
        expect((await replayResponse).status()).toBe(200);
        const reveal = page.getByRole('dialog', { name: 'Standard Pack opening', exact: true });
        await expect(reveal).toBeVisible();
        expect(observed).toHaveLength(2);
        expect(observed[1].requestId).toBe(observed[0].requestId);
        expect(observed[1].body.replayed).toBe(true);
        expect(observed[1].body.cards).toEqual(observed[0].body.cards);
        expect(economicState(await account.readSave())).toEqual(committed);
        await expect(page.locator('.chronicle-points-balance strong')).toHaveText(String(committed.chroniclePoints));
        expect(await page.evaluate((key) => sessionStorage.getItem(key), pendingKey)).toBeNull();
        evidence.push({ phase: 'reloaded-same-purchase-recovered', requestId: observed[1].requestId, ...committed });

        await reveal.getByRole('button', { name: /Skip/ }).click();
        let closing = committed;
        if (initialChroniclePoints === 1000) {
        const nextResponse = page.waitForResponse((response) =>
            new URL(response.url()).pathname === PACK_PATH && response.request().method() === 'POST');
        await reveal.getByRole('button', { name: /Open Another/ }).click();
        expect((await nextResponse).status()).toBe(200);
        expect(observed).toHaveLength(3);
        expect(observed[2].requestId).not.toBe(observed[0].requestId);
        expect(observed[2].body.replayed).not.toBe(true);
        expect(observed[2].body.cards).toHaveLength(5);
        closing = economicState(await account.readSave());
        expect(closing).toEqual({
            ...opening, chroniclePoints: opening.chroniclePoints - 200,
            cards: [...committed.cards, ...observed[2].body.cards!].sort(),
        });
        await expect(page.locator('.chronicle-points-balance strong')).toHaveText(String(closing.chroniclePoints));
        expect(opening.chroniclePoints).toBe(closing.chroniclePoints + 2 * 100);
        evidence.push({ phase: 'distinct-purchase-confirmed', requestId: observed[2].requestId, ...closing });
        } else {
            expect(closing.chroniclePoints).toBe(0);
            expect(opening.chroniclePoints).toBe(closing.chroniclePoints + 100);
            await expect(reveal.getByRole('button', { name: /Open Another/ })).toBeDisabled();
            expect(economicState(await account.readSave())).toEqual(closing);
            expect(observed).toHaveLength(2);
            evidence.push({ phase: 'exhausted-wallet-recovery-confirmed', ...closing });
        }

        const settledReloadStartedAt = performance.now();
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expectShopReady(page, initialChroniclePoints === 1000);
        recordTiming('warm-settled-reload-to-ready', settledReloadStartedAt);
        await expect(page.locator('.chronicle-points-balance strong')).toHaveText(String(closing.chroniclePoints));
        expect(economicState(await account.readSave())).toEqual(closing);
        expect(observed).toHaveLength(initialChroniclePoints === 1000 ? 3 : 2);
        await page.screenshot({ path: info.outputPath('card-pack-recovered.png'), fullPage: true });
    } finally {
        await page.unroute(`**${PACK_PATH}`, interceptPack);
        const evidencePath = info.outputPath('card-pack-economic-evidence.json');
        await writeFile(evidencePath, JSON.stringify({
            evidenceType: 'seeded-real-Express-browser',
            account: account.name,
            project: info.project.name,
            viewport: page.viewportSize(),
            initialChroniclePoints,
            entryMethod: 'source-assisted seeded session and direct Shop route; not an organic Chronicle unlock',
            timingScope: 'one observation per navigation/request phase per project; no performance thresholds',
            states: evidence, timings,
        }, null, 2));
        await info.attach('card-pack-economic-evidence', {
            path: evidencePath,
            contentType: 'application/json',
        });
        await request.delete(`/api/save/${account.name}`, { headers: account.headers }).catch(() => undefined);
    }
});
}
