import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { test } from './helpers/reconnecting-request';
import { uniquePlayerName } from './helpers/player-names';
import { uiAuditSave } from '../e2e/helpers/ui-audit-runtime';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';

// Run with LIVE_E2E_REALTIME=1. Two real browsers in the same village, real
// Express handlers and Socket.IO: a line one player posts in the tavern shows
// up for the other within seconds. Nothing but the socket hint can explain
// that — the tavern's reconcile poll is two minutes (lib/use-chat-push.ts).
test.skip(process.env.LIVE_E2E_REALTIME !== '1', 'needs the realtime layer (LIVE_E2E_REALTIME=1)');

async function account(request: APIRequestContext, side: string) {
    const name = uniquePlayerName(stamp => `tav${side}${stamp}`);
    const registered = await request.post('/api/player-auth', {
        data: { action: 'register', name, password: 'TavernPush!1234' },
    });
    expect(registered.status(), await registered.text()).toBe(200);
    const token = String((await registered.json()).token);
    const headers = { 'x-player-name': name, 'x-player-token': token };
    const save = uiAuditSave();
    save.character = { ...save.character, name, equippedJutsuIds: [], jutsuMastery: [] };
    const seeded = await request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': 'live-express-e2e-admin' }, data: save,
    });
    expect(seeded.status(), await seeded.text()).toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    const canonical = await request.get(`/api/save/${name}`, { headers });
    expect(canonical.status(), await canonical.text()).toBe(200);
    const current = await canonical.json() as { character?: { village?: string } };
    expect(current.character?.village).toBe('Stormveil Village');
    return { name, token, canonical: current };
}

async function install(context: BrowserContext, player: Awaited<ReturnType<typeof account>>) {
    await context.addInitScript(({ name, token, canonical, patch }) => {
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name);
        localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        localStorage.setItem('legacyRumors.seen.v1:' + name, JSON.stringify([10, 20, 30, 40, 45]));
    }, { ...player, patch: LATEST_PATCH_NOTE.version });
}

/** Count this page's tavern reads, so the spec knows which fetch a line arrived on. */
function countTavernReads(page: Page) {
    const reads = { count: 0 };
    page.on('request', (request) => {
        if (request.method() === 'GET' && new URL(request.url()).pathname.endsWith('/village/chat')) reads.count++;
    });
    return reads;
}

async function openTavern(page: Page) {
    await page.goto('/#/tavern', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-shell[data-screen="tavern"]')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.tavern-input')).toBeVisible({ timeout: 30_000 });
}

test('a tavern line reaches another open tavern by socket push, not by poll', async ({ browser, context, page, request, baseURL }, info) => {
    test.setTimeout(150_000);
    const listener = await account(request, 'a'), speaker = await account(request, 'b');
    const speakerContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 },
        isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    try {
        await install(context, listener); await install(speakerContext, speaker);
        const speaking = await speakerContext.newPage();
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(`listener: ${error.message}`));
        speaking.on('pageerror', error => errors.push(`speaker: ${error.message}`));
        const reads = countTavernReads(page);

        await openTavern(page);
        // The mount fetch, then the catch-up fetch once the server confirms the
        // room join. After both, the listener's next read can only come from a
        // push: its reconcile poll is at least 108 s away.
        await expect.poll(() => reads.count, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
        await page.waitForTimeout(1_000);
        const settled = reads.count;

        await openTavern(speaking);
        // Unique per run, and already through the server's name gate: a raw
        // clock stamp can spell a term the chat's moderation masks.
        const line = `Push check from ${speaker.name}`;
        await speaking.locator('.tavern-input').fill(line);
        await speaking.getByRole('button', { name: '→ Send' }).click();
        await expect(speaking.locator('.tavern-text', { hasText: line })).toBeVisible();

        const posted = Date.now();
        await expect(page.locator('.tavern-text', { hasText: line })).toBeVisible({ timeout: 10_000 });
        const latencyMs = Date.now() - posted;
        expect(reads.count, 'the line arrived on a push-triggered refetch').toBeGreaterThan(settled);
        expect(errors).toEqual([]);
        await page.screenshot({ path: info.outputPath('tavern-push-listener.png'), fullPage: true });
        await info.attach('tavern-push', { body: JSON.stringify({ latencyMs, readsBeforePost: settled, readsAfter: reads.count }), contentType: 'application/json' });
    } finally {
        await speakerContext.close();
    }
});
