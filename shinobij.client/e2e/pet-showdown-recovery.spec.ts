import { expect, test, type Page, type Route } from '@playwright/test';
import { createRequire } from 'node:module';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { startGauntletRun } from '../src/lib/pet-gauntlet';

const load = createRequire(import.meta.url);
const { createShowdownSession, showdownStateView }: typeof import('../../api/_pet-showdown/engine') = load('../../dist/api/_pet-showdown/engine.js');
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const crumbKey = 'showdown.session.v1';
const pointer = (page: Page) => page.evaluate(key => localStorage.getItem(key), crumbKey);
async function openBout(page: Page, practice = false) {
    await page.goto('/#/pets', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Pet Arena', exact: true }).click({ timeout: 45_000 });
    await page.locator(practice ? '.pet-arena-destination.is-training' : '.pet-arena-destination.is-paid').click();
}

async function fixture(page: Page, options: { finished?: 'win' | 'loss'; road?: boolean; door?: 'practice' } = {}) {
    const pets = Array.from({ length: 5 }, (_, i) => ({ id: `own-${i}`, name: `Companion ${i + 1}`, templateId: `standard-${i}`, rarity: 'standard', level: 30,
        hp: 800, attack: 120, defense: 90, speed: 60, element: 'Fire', role: 'tracker', jutsus: [] }));
    const session = createShowdownSession({ sessionId: 'recoverable-bout', playerName: 'AuditNinja', format: '3v3', tier: 'warrior', seed: 42,
        playerPets: pets, enemyPets: pets.map(pet => ({ ...pet, id: `rival-${pet.id}`, name: `Rival ${pet.name}` })), enemyTeamName: 'Sealed rivals', rewardEligible: true });
    if (options.finished) { session.finished = true; session.outcome = options.finished; }
    const state = showdownStateView(session);
    const save = uiAuditSave(); save.character = { ...save.character, pets };
    const runtime = await installUiAuditRuntime(page, save);
    await page.route('**/api/pet/warfront-start', route => route.fulfill({ status: 204 }));
    await page.addInitScript(({ key, petIds, road, door }) => {
        const screen = door === 'practice' ? 'petShowdown' : 'petColiseum';
        localStorage.setItem('lastScreen.v1', screen);
        localStorage.setItem('navigation.v1:auditninja:screen', screen);
        sessionStorage.setItem('navigation.v1:auditninja', JSON.stringify({ screen, trail: ['pets', 'petArena', screen] }));
        localStorage.setItem(key, JSON.stringify({ sessionId: 'recoverable-bout', playerName: 'AuditNinja', petIds, savedAt: Date.now(), bout: 'arena', roadChallenge: road }));
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
            return contextId === 'webgl2' ? null : Reflect.apply(original, this, [contextId, ...args]);
        } as typeof original;
    }, { key: crumbKey, petIds: pets.map(pet => pet.id), road: !!options.road, door: options.door });
    return { state, runtime, save };
}

test('failed pet recovery retains the fight; concession retries wait for confirmation and return to the Coliseum', async ({ page }, info) => {
    test.setTimeout(90_000);
    const { state } = await fixture(page);
    let readable = false, concessions = 0;
    await page.route('**/api/pet/showdown', route => {
        const body = route.request().postDataJSON();
        if (body.action === 'state') return !readable ? json(route, {}, 503) : json(route, { state });
        if (body.action === 'forfeit') return ++concessions === 1 ? json(route, {}, 503) : json(route, { ok: true, conceded: true });
        throw new Error(`Unexpected showdown action: ${body.action}`);
    });
    await openBout(page);
    await expect(page.getByRole('alert')).toContainText('saved battle is still available', { timeout: 45_000 });
    expect(await pointer(page)).toContain('recoverable-bout');
    readable = true;
    await page.getByRole('button', { name: 'Retry battle recovery' }).click();
    await expect(page.getByTestId('pet-showdown-root')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('region', { name: 'Battle commands' })).toBeVisible();
    await page.getByRole('button', { name: 'Forfeit the battle', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, concede' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('concession could not be confirmed');
    await expect(page.getByRole('region', { name: 'Battle commands' })).toHaveCount(0);
    const concede = page.getByRole('button', { name: 'Yes, concede' });
    expect(await concede.evaluate(button => {
        const box = button.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth
            && button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    })).toBe(true);
    expect(await pointer(page)).toContain('recoverable-bout');
    await page.screenshot({ path: info.outputPath('unconfirmed-concession-retains-battle.png') });
    await page.getByRole('button', { name: 'Keep fighting', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Battle commands' })).toBeVisible();
    await page.getByRole('button', { name: 'Forfeit the battle', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, concede' }).click();
    await expect(page.getByTestId('pet-showdown-root')).toHaveCount(0);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'petColiseum');
    expect(await pointer(page)).toBeNull();
    expect(concessions).toBe(2);
});

for (const outcome of ['win', 'loss'] as const) test(`a lost ${outcome} receipt remains recoverable and adopts the confirmed save`, async ({ page }, info) => {
    test.setTimeout(90_000);
    const { state, save, runtime } = await fixture(page, { finished: outcome });
    let claims = 0, receiptsAvailable = false;
    const character = { ...save.character!, ryo: 1234567, pets: (save.character!.pets as Record<string, unknown>[]).map((pet, i) => i === 0 ? { ...pet, name: 'Recovered companion' } : pet) };
    await page.route('**/api/pet/showdown', route => {
        const body = route.request().postDataJSON();
        if (body.action === 'state') return json(route, { state });
        expect(body.action).toBe('turn'); expect(body.commands).toEqual([]);
        claims++;
        if (!receiptsAvailable) return json(route, {}, 500);
        runtime.commitServerCharacter(character, runtime.currentVersion() + 1);
        return json(route, { ok: true, state, events: [], character, _saveVersion: runtime.currentVersion(), reward: outcome === 'win' ? 500 : 0 });
    });
    await openBout(page);
    await expect(page.getByRole('alert')).toContainText('result could not be confirmed', { timeout: 45_000 });
    expect(await pointer(page)).toContain('recoverable-bout');
    receiptsAvailable = true;
    await page.getByRole('button', { name: 'Retry battle recovery' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Your pet battle ${outcome === 'win' ? 'victory' : 'defeat'} is saved.` })).toBeVisible();
    expect(await pointer(page)).toBeNull();
    await expect(page.getByText('Recovered companion', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`confirmed-${outcome}-back-in-lobby.png`) });
    expect(claims).toBeGreaterThanOrEqual(2);
});

test('a saved road challenge returns to the world map only after concession is confirmed', async ({ page }) => {
    test.setTimeout(90_000);
    const { state } = await fixture(page, { road: true });
    await page.route('**/api/pet/showdown', route => json(route, route.request().postDataJSON().action === 'state' ? { state } : { ok: true, conceded: true }));
    await openBout(page);
    await expect(page.getByTestId('pet-showdown-root')).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Forfeit the battle', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, concede' }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'worldMap');
    await expect(page.getByTestId('pet-showdown-root')).toHaveCount(0);
    expect(await pointer(page)).toBeNull();
});

test('a saved paid 3v3 bout resumes through the correct door and rematches with its original format', async ({ page }) => {
    test.setTimeout(90_000);
    const { state } = await fixture(page, { door: 'practice' });
    let starts = 0;
    const finalState = { ...state, finished: true, outcome: 'win' as const };
    await page.route('**/api/pet/showdown', route => {
        const body = route.request().postDataJSON();
        if (body.action === 'state') return json(route, { state });
        if (body.action === 'turn') return json(route, { ok: true, state: finalState, events: [{ t: 'end', outcome: 'win' }], reward: 0 });
        expect(body.action).toBe('arena'); expect(body.format).toBe('3v3'); expect(body.petIds).toHaveLength(5); starts++;
        return json(route, { state: { ...state, sessionId: 'next-bout' } });
    });
    await openBout(page, true);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'petColiseum', { timeout: 45_000 });
    await expect(page.getByRole('region', { name: 'Battle commands' })).toBeVisible({ timeout: 45_000 });
    for (let index = 0; index < 3; index++) {
        await expect(page.locator('.pet-native-review b')).toHaveText(`${index}/3 orders chosen`);
        await page.locator('.showdown-stance-chip').filter({ hasText: 'Guard' }).click();
    }
    await expect(page.getByRole('dialog', { name: 'Victory', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Battle again', exact: true }).click();
    await expect.poll(() => starts).toBe(1);
    await expect(page.getByRole('region', { name: 'Battle commands' })).toBeVisible();
    expect(await pointer(page)).toContain('next-bout');
});

test('a pending Gauntlet result survives leaving and re-entry without starting or charging another run', async ({ page }, info) => {
    test.setTimeout(90_000);
    const save = uiAuditSave();
    const runtime = await installUiAuditRuntime(page, save);
    await page.route('**/api/pet/warfront-start', route => route.fulfill({ status: 204 }));
    const run = { ...startGauntletRun(42), status: 'lost' as const, round: 4, hearts: 0, roundsCleared: 3, log: ['Your squad was defeated.'] };
    await page.addInitScript(pending => {
        localStorage.setItem('lastScreen.v1', 'petArena');
        localStorage.setItem('navigation.v1:auditninja:screen', 'petArena');
        sessionStorage.setItem('navigation.v1:auditninja', JSON.stringify({ screen: 'petArena', trail: ['pets', 'petArena'] }));
        localStorage.setItem('pet.gauntlet.pending.v1', JSON.stringify(pending));
        sessionStorage.setItem('shinobix:pet-arena-view:v1', 'gauntlet');
    }, { player: 'AuditNinja', run, meta: { token: 'pending-gauntlet', weekKey: 'qa-week', rewardEligible: true }, transcript: [] });
    let recovered = false, reports = 0, starts = 0, receiptVersion: number | null = null;
    await page.route('**/api/pet/gauntlet', route => {
        const body = route.request().postDataJSON();
        if (body.action === 'start') { starts++; throw new Error('Recovery must not charge a new run'); }
        expect(body).toEqual({ action: 'report', runToken: 'pending-gauntlet', transcript: [] }); reports++;
        if (!recovered) return json(route, {}, 503);
        if (receiptVersion === null) {
            receiptVersion = runtime.currentVersion() + 1;
            runtime.commitServerCharacter(save.character!, receiptVersion);
        }
        return json(route, { ryo: 750, fateShards: 0, boneCharms: 0, balances: { ryo: 9999999, fateShards: 9999, boneCharms: 9999 },
            character: save.character, _saveVersion: receiptVersion, score: null, rank: null, weekKey: '', roundsCleared: null, heartsLeft: null });
    });
    await page.goto('/#/pets', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Pet Arena', exact: true }).click({ timeout: 45_000 });
    await page.getByRole('button', { name: /Pet Gauntlet/ }).click();
    await expect(page.getByRole('button', { name: 'Retry Gauntlet result' })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('button', { name: 'Run the weekly Gauntlet again' })).toBeDisabled();
    await page.getByRole('button', { name: 'Pet Yard', exact: true }).click();
    recovered = true;
    await page.getByRole('button', { name: 'Pet Arena', exact: true }).click();
    await page.getByRole('button', { name: /Pet Gauntlet/ }).click();
    await expect(page.getByText('Saved reward receipt recovered', { exact: false })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('+750 Ryo', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run the weekly Gauntlet again' })).toBeEnabled();
    expect(await page.evaluate(() => localStorage.getItem('pet.gauntlet.pending.v1'))).toBeNull();
    expect(starts).toBe(0); expect(reports).toBeGreaterThanOrEqual(2);
    await page.getByText('Saved reward receipt recovered', { exact: false }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('gauntlet-recovered-no-new-entry-fee.png') });
});

test('a lost paid Gauntlet entry reply recovers the same run even after its fee emptied the wallet', async ({ page }, info) => {
    test.setTimeout(90_000);
    const save = uiAuditSave(); save.character = { ...save.character!, ryo: 1500 };
    const runtime = await installUiAuditRuntime(page, save);
    await page.route('**/api/pet/warfront-start', route => route.fulfill({ status: 204 }));
    let available = false, acceptedId: string | null = null, acceptedVersion = 0;
    const requests: string[] = [];
    const paid = { ...save.character, ryo: 0 };
    await page.route('**/api/pet/gauntlet', route => {
        const body = route.request().postDataJSON(); expect(body.action).toBe('start');
        expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/i); requests.push(body.requestId);
        if (acceptedId === null) {
            acceptedId = body.requestId;
            acceptedVersion = runtime.currentVersion() + 1;
            runtime.commitServerCharacter(paid, acceptedVersion);
        }
        expect(body.requestId).toBe(acceptedId);
        if (!available) return route.abort('failed');
        return json(route, { runToken: acceptedId, seed: 42, weekKey: 'qa-week', rewardEligible: true, maxRounds: 10,
            rewardedRunsLeft: 3, chargedRyo: 0, resumed: true, balances: { ryo: 0 }, character: paid, _saveVersion: acceptedVersion });
    });
    await page.goto('/#/pets', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Pet Arena', exact: true }).click({ timeout: 45_000 });
    await page.getByRole('button', { name: /Pet Gauntlet/ }).click();
    await expect(page.getByText('Practice run — entry not confirmed. This run has no rewards.', { exact: false })).toBeVisible({ timeout: 45_000 });
    available = true;
    await page.getByRole('button', { name: 'Retry entry (up to 1,500 ryo)', exact: true }).click();
    await expect(page.getByRole('button', { name: '↻ New run (1,500 ryo)', exact: true })).toBeVisible();
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(new Set(requests).size).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('pet.gauntlet.entry.v1'))).toBeNull();
    expect(runtime.serverSave().character?.ryo).toBe(0);
    await page.screenshot({ path: info.outputPath('paid-entry-recovered-without-second-fee.png') });
});
