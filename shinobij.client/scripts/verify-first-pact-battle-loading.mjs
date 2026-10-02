import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

// Current source fixtures; endpoint authority is tested separately by
// showdown.first-pact.test.ts. This checks production UI with a mock network.
// Run with: node --import tsx scripts/verify-first-pact-battle-loading.mjs
const { createShowdownSession, showdownStateView } = await import('../../api/_pet-showdown/engine.ts');
const { STARTER_PETS } = await import('../src/data/starter-pets.ts');
const { FIRST_PACT_TOURNAMENT } = await import('../../shared/first-pact-contract.ts');
const nextEncounter = FIRST_PACT_TOURNAMENT.find(encounter => encounter.requiredWins === 1);
const pets = STARTER_PETS.slice(0, 4).map(({ pet }) => ({ ...pet, level: 100, maxLevel: 100, unlockedForPve: true }));
const petIds = pets.map(pet => pet.id);
const session = createShowdownSession({
    sessionId: 'first-pact-lazy-recovery', playerName: 'Aster',
    format: '2v2', tier: 'champion', seed: 12345, playerPets: pets,
    enemyPets: pets.map(pet => ({ ...pet, id: 'court-' + pet.id })),
    enemyTeamName: 'Court wiring fixture', rewardEligible: false,
});
const state = showdownStateView(session);
assert.equal(state.player.filter(pet => !pet.benched).length, 2);
assert.equal(state.player.filter(pet => pet.benched).length, 2);
session.finished = true;
session.outcome = 'win';
const terminalState = showdownStateView(session);
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5186';
const output = resolve('output', 'first-pact-performance', 'wiring');
mkdirSync(output, { recursive: true });
const shellStyles = ['../src/styles/tokens.css', '../src/styles/layout/adaptive-stages.css']
    .map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');

async function prepare(page, options = {}) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ state, terminalState, petIds, options }) => {
        const originalContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
            return kind === 'webgl2' ? null : Reflect.apply(originalContext, this, [kind, ...args]);
        };
        const qa = window.__fpQA = { requests: [], progress: null, startAttempts: 0, forfeitAttempts: 0, turnAttempts: 0 };
        if (options.breadcrumb) localStorage.setItem('first-pact.showdown.v1', JSON.stringify({
            sessionId: state.sessionId, playerName: 'Aster', encounterId: 'stable-qualifier', petIds, savedAt: Date.now(),
        }));
        const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
        // Each fetch assignment gets its own delegate, avoiding recursion
        // when the preview captures the previously wrapped fetch.
        const intercept = delegate => async (input, init) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (url.endsWith('/api/pet/showdown')) {
                const body = JSON.parse(String(init?.body ?? '{}'));
                qa.requests.push(body);
                if (body.action === 'state') return json({ state: options.terminalRecovery ? terminalState : state });
                if (body.action === 'first-pact') {
                    qa.startAttempts += 1;
                    if (qa.startAttempts <= (options.startFailures ?? 0) || qa.startAttempts === options.rematchFailureAt) return json({ error: 'Test gate temporarily unavailable.' }, 503);
                    if (options.holdStart && !qa.startReleased) {
                        await new Promise(resolve => { qa.releaseStart = () => { qa.startReleased = true; resolve(); }; });
                    }
                    return json({ state: { ...state, sessionId: 'first-pact-start-' + qa.startAttempts }, firstPact: { progress: qa.progress } });
                }
                if (body.action === 'forfeit') {
                    qa.forfeitAttempts += 1;
                    if (qa.forfeitAttempts <= (options.forfeitFailures ?? 0)) return json({ error: 'Test concession unavailable.' }, 502);
                    return json({ ok: true, conceded: true, firstPact: { progress: qa.progress } });
                }
                if (body.action === 'turn') {
                    qa.turnAttempts += 1;
                    qa.progress = { ...qa.progress, stableQuest: { ...qa.progress.stableQuest, tournamentWins: 1 } };
                    qa.settled = true;
                    return json({ ok: true, events: [], reward: 0, state: { ...terminalState, sessionId: body.sessionId }, firstPact: { progress: qa.progress } });
                }
                throw new Error('Uncovered Showdown action: ' + body.action);
            }
            const response = await delegate(input, init);
            if (url.endsWith('/api/first-pact/state')) {
                const data = await response.clone().json();
                // The preview's city facade cannot see our battle receipt.
                // Keep its later checkpoints consistent with a real server,
                // which rebases position writes onto settled campaign progress.
                qa.progress = qa.settled ? { ...qa.progress, lastPosition: data.progress.lastPosition } : data.progress;
                return json({ ...data, progress: qa.progress }, response.status);
            }
            return response;
        };
        let current = intercept(window.fetch.bind(window));
        Object.defineProperty(window, 'fetch', { configurable: true, get: () => current, set: delegate => { current = intercept(delegate); } });
    }, { state, terminalState, petIds, options });
    await page.goto(baseUrl + '/firstpactpreview.html?state=tournament', { waitUntil: 'domcontentloaded' });
    // The isolated preview omits App's shell CSS; use the actual portal
    // tokens/layout for production stacking and hit testing.
    await page.addStyleTag({ content: shellStyles });
    await page.waitForFunction(() => document.querySelector('[data-fp-render-ready="true"]'), null, { timeout: 60000 });
    return errors;
}
async function openSquad(page) {
    await page.keyboard.press('e');
    await page.getByRole('dialog', { name: 'Conversation with Registrar Orin' }).waitFor();
    while (await page.getByRole('button', { name: 'Continue', exact: true }).count()) {
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Prepare four-pet squad', exact: true }).click();
    await page.getByRole('dialog', { name: 'Prepare tournament squad' }).waitFor();
    assert.equal(await page.locator('.fp-formation-slot.active').count(), 2);
    assert.equal(await page.locator('.fp-formation-slot.reserve').count(), 2);
}
async function waitBattle(page) {
    await page.getByTestId('pet-showdown-root').waitFor({ timeout: 45000 });
    await page.getByTestId('pet-showdown-render-fallback').waitFor();
    assert.equal(await page.locator('.first-pact-screen').evaluate(element => getComputedStyle(element).zIndex), '1999');
}
async function concede(page) {
    await page.getByRole('button', { name: 'Forfeit the battle', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Forfeit the battle?', exact: true })
        .getByRole('button', { name: 'Yes, concede', exact: true }).click();
}
async function assertCityRestored(page) {
    await page.waitForFunction(() => localStorage.getItem('first-pact.showdown.v1') == null);
    await page.getByTestId('pet-showdown-root').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.first-pact-screen').evaluate(element => getComputedStyle(element).zIndex), '2300');
}
const browser = await chromium.launch({ headless: true });
try {
    const city = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const battleRequests = [];
    city.on('request', request => { if (/PetShowdownBattle-.*\.js/.test(request.url())) battleRequests.push(request.url()); });
    const cityErrors = await prepare(city, { startFailures: 1, holdStart: true, rematchFailureAt: 3 });
    assert.equal(battleRequests.length, 0, 'city entry must defer battle code');
    await openSquad(city);
    await city.waitForFunction(() => performance.getEntriesByType('resource').some(entry => /PetShowdownBattle-.*\.js/.test(entry.name)));
    assert.equal(battleRequests.length, 1, 'squad preparation should prefetch once');
    await city.getByRole('button', { name: 'Commit this formation', exact: true }).click();
    await city.getByRole('alert').filter({ hasText: 'Test gate temporarily unavailable.' }).waitFor();
    assert.equal(await city.evaluate(() => localStorage.getItem('first-pact.showdown.v1')), null);
    await city.getByRole('button', { name: 'Commit this formation', exact: true }).evaluate(button => { button.click(); button.click(); });
    await city.waitForFunction(() => !!window.__fpQA.releaseStart);
    assert.equal(await city.getByRole('dialog', { name: 'Prepare tournament squad' }).getByRole('button', { name: 'Close', exact: true }).isDisabled(), true);
    assert.equal(await city.locator('.fp-roster button:enabled').count(), 0, 'pending start must seal the chosen order');
    assert.equal(await city.evaluate(() => window.__fpQA.startAttempts), 2, 'one retry must create one request');
    await city.evaluate(() => window.__fpQA.releaseStart());
    await waitBattle(city);
    const start = await city.evaluate(() => window.__fpQA.requests.filter(request => request.action === 'first-pact').at(-1));
    assert.equal(start.encounterId, 'stable-qualifier');
    assert.deepEqual(start.petIds, petIds, 'formation order must reach the server');
    assert.deepEqual(await city.evaluate(() => JSON.parse(localStorage.getItem('first-pact.showdown.v1')).petIds), petIds);
    // Actual command controls -> submitTurn -> receipt -> result -> next round.
    await city.getByRole('button', { name: /^Guard/ }).click();
    await city.getByRole('button', { name: /^Guard/ }).click();
    await city.getByRole('dialog', { name: 'Victory', exact: true }).waitFor();
    assert.equal(await city.evaluate(() => localStorage.getItem('first-pact.showdown.v1')), null);
    await city.getByRole('button', { name: 'Battle Again', exact: true }).click();
    await city.getByRole('alert').filter({ hasText: 'Test gate temporarily unavailable.' }).waitFor();
    assert.equal(await city.locator('.fp-squad h2').innerText(), nextEncounter.title, 'failed rematch must reopen the correct formation');
    await city.getByRole('button', { name: 'Commit this formation', exact: true }).click();
    await waitBattle(city);
    const rematch = await city.evaluate(() => window.__fpQA.requests.filter(request => request.action === 'first-pact').at(-1));
    assert.equal(rematch.encounterId, nextEncounter.id, 'rematch must follow settled progression');
    await concede(city);
    await assertCityRestored(city);
    assert.deepEqual(cityErrors, []);
    await city.close();

    const recovery = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const recoveryErrors = await prepare(recovery, { breadcrumb: true, forfeitFailures: 1 });
    await waitBattle(recovery);
    await concede(recovery);
    const alert = recovery.getByRole('alert').filter({ hasText: 'The Court could not record the concession.' });
    await alert.waitFor();
    assert.ok(await recovery.evaluate(() => localStorage.getItem('first-pact.showdown.v1')), 'refused concession must retain recovery');
    await recovery.screenshot({ path: resolve(output, 'mobile-concession-error.png') });
    await alert.getByRole('button', { name: 'Dismiss', exact: true }).click(); // proves the banner is reachable above combat
    await recovery.getByRole('alertdialog', { name: 'Forfeit the battle?', exact: true })
        .getByRole('button', { name: 'Yes, concede', exact: true }).click();
    await assertCityRestored(recovery);
    assert.deepEqual(recoveryErrors, []);
    await recovery.close();

    const terminal = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const terminalErrors = await prepare(terminal, { breadcrumb: true, terminalRecovery: true });
    await terminal.waitForFunction(() => localStorage.getItem('first-pact.showdown.v1') == null);
    assert.equal(await terminal.getByTestId('pet-showdown-root').count(), 0);
    assert.equal(await terminal.evaluate(() => window.__fpQA.turnAttempts), 1, 'terminal recovery should claim once without mounting combat');
    await openSquad(terminal);
    assert.equal(await terminal.locator('.fp-squad h2').innerText(), nextEncounter.title, 'receipt recovery must update the next encounter');
    assert.deepEqual(terminalErrors, []);
    await terminal.close();
    console.log('PASS: deferred loading, 2+2 formation, rejected start/retry, guarded launch, settlement, next-round rematch, mobile recovery, visible concession failure/retry, and terminal receipt recovery.');
} finally {
    await browser.close();
}
