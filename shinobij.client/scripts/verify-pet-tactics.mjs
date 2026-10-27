import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Two real browser seats play a Pet Arena match end to end against the QA
// server (scripts/pet-tactics-qa-server.mts). Since 2026-10-26 both seats fight
// with their own carried companions on the Coliseum engine, through the
// Coliseum battle's own command console.
const base = process.env.PET_TACTICS_QA_URL ?? 'http://127.0.0.1:4318';
const out = resolve(import.meta.dirname, '../../docs/audits/pet-tactics-prototype');
const ranked = process.env.PET_ARENA_QA_RANKED === '1';
const visualOnly = process.env.PET_ARENA_QA_VISUAL_ONLY === '1';
const artifact = name => resolve(out, `${ranked ? 'ranked-' : ''}${name}`);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const contexts = [], errors = [], badResponses = [];
const admit = ranked ? 'Find ranked match' : 'Create arena room';
async function player(seat, viewport) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' }); contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${seat}: ${error.message}`));
    page.on('response', response => { if (response.status() >= 400 && !response.url().includes('/api/')) badResponses.push({ seat, url: response.url(), status: response.status() }); });
    await page.goto(`${base}/pet-tactics-qa.html?seat=${seat}${ranked ? '&ranked=1' : ''}`, { waitUntil: 'networkidle', timeout: 90000 });
    await Promise.any([
        page.getByRole('button', { name: admit }).waitFor({ timeout: 90000 }),
        page.getByRole('button', { name: 'Back to Pet Arena', exact: true }).last().waitFor({ timeout: 90000 }),
    ]);
    const leave = page.locator('.showdown-result').getByRole('button', { name: 'Back to Pet Arena', exact: true });
    if (await leave.isVisible()) await leave.click();
    await page.getByRole('button', { name: admit }).waitFor({ timeout: 90000 });
    return page;
}
const publicView = page => page.evaluate(async () => {
    const r = await fetch('/api/pet/tactics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recover' }) });
    return r.json();
});
const commands = page => page.getByRole('region', { name: 'Battle commands' });
/** Give every companion that is asked an order: an attack aimed at the first
 *  rival when one is offered, otherwise Guard. The final order sends the round. */
async function commandRound(page) {
    for (let step = 0; step < 12 && await commands(page).isVisible(); step++) {
        const target = page.locator('.pet-native-targets button').first();
        if (await target.isVisible()) { await target.click(); continue; }
        const technique = page.locator('.showdown-tech-grid button:not([disabled])').first();
        if (await technique.isVisible()) { await technique.click(); continue; }
        await page.locator('.showdown-stance-chip').filter({ hasText: 'Guard' }).first().click();
    }
}
const result = { mode: ranked ? 'ranked-player-controlled' : 'sparring', engine: null, desktop: false, mobile: false, twoPlayerCommandRounds: 0, reconnect: false, terminal: null, errors, badResponses };
try {
    const a = await player('alice', { width: 1440, height: 960 });
    if (await a.locator('.pta-roster-pet').count() !== 5) throw new Error('The picker must list the seat\'s five carried companions.');
    await a.getByRole('heading', { name: 'Pet Arena', exact: true }).waitFor();
    await a.screenshot({ path: artifact('squad-builder-desktop.png'), fullPage: true }); result.desktop = true;
    const b = await player('bob', { width: 390, height: 844 });
    await b.screenshot({ path: artifact('squad-builder-mobile.png'), fullPage: true });
    if (await b.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)) throw new Error('Mobile squad picker overflows horizontally.');
    result.mobile = true;
    // Sparring arrives with four picked; ranked starts empty. Alice brings her
    // first four, Bob swaps his fourth for his fifth.
    for (const [page, indexes] of [[a, [0, 1, 2, 3]], [b, [0, 1, 2, 4]]]) {
        const pets = page.locator('.pta-roster-pet');
        for (let i = 0; i < 5; i++) if (await pets.nth(i).getAttribute('aria-pressed') === 'true') await pets.nth(i).click();
        for (const i of indexes) await pets.nth(i).click();
    }
    if (ranked) {
        await a.getByRole('button', { name: 'Find ranked match' }).click();
        await a.getByText('Finding a ranked opponent', { exact: true }).waitFor();
        await a.locator('[data-qa-battle-active="true"][data-qa-fullscreen="false"]').waitFor({ state: 'attached' });
        await a.getByRole('button', { name: 'Cancel ranked search', exact: true }).click();
        await a.getByRole('button', { name: 'Find ranked match', exact: true }).waitFor();
        await a.locator('[data-qa-battle-active="false"][data-qa-fullscreen="false"]').waitFor({ state: 'attached' });
        await a.getByRole('button', { name: 'Find ranked match' }).click();
        await a.getByText('Finding a ranked opponent', { exact: true }).waitFor();
        result.rankedSearchCancel = true;
        await b.getByRole('button', { name: 'Find ranked match' }).click();
    } else {
        await a.getByRole('button', { name: 'Create arena room' }).click();
        const code = (await a.locator('.pta-room-code').innerText()).trim();
        await b.getByLabel('Arena code', { exact: true }).fill(code);
        await b.getByRole('button', { name: 'Join arena', exact: true }).click();
    }
    await Promise.all([a.locator('.pta-leads').waitFor(), b.locator('.pta-leads').waitFor()]);
    const preview = await publicView(b);
    result.engine = preview.engine ?? null;
    if (preview.engine !== 'showdown-v1') throw new Error('A new Pet Arena room must run on the Coliseum engine.');
    if (preview.battle.player.length !== 4 || preview.battle.enemy.length !== 4) throw new Error('Both squads must hold four companions.');
    if (!preview.battle.player.every(p => p.id.startsWith(`${preview.seat}:`))) throw new Error('Own companions must carry the seat prefix.');
    await a.screenshot({ path: artifact('preview-desktop.png'), fullPage: true });
    await b.screenshot({ path: artifact('preview-mobile.png'), fullPage: true });
    await b.locator('.pta-leads button').nth(0).click();
    await b.locator('.pta-leads button').nth(2).click();
    await a.getByRole('button', { name: 'Lock opening pair' }).click();
    const privatePreview = await publicView(b);
    if (privatePreview.battle.enemy.some(p => p.benched)) throw new Error('Enemy leads leaked before the second lock.');
    await b.getByRole('button', { name: 'Lock opening pair' }).click();
    await Promise.all([commands(a).waitFor({ timeout: 60000 }), commands(b).waitFor({ timeout: 60000 })]);
    if (ranked) for (const page of [a, b]) await page.locator('[data-qa-battle-active="true"][data-qa-fullscreen="true"]').waitFor({ state: 'attached' });
    for (const page of [a, b]) {
        const timer = page.getByRole('timer');
        if (!await timer.isVisible()) throw new Error('The shared planning clock is missing.');
        const fits = await page.evaluate(() => {
            const console = document.querySelector('.pet-native-console').getBoundingClientRect();
            return console.left >= 0 && console.right <= innerWidth + 2;
        });
        if (!fits) throw new Error('The command console overflows the viewport.');
    }
    await a.screenshot({ path: artifact('battle-desktop.png') });
    await b.screenshot({ path: artifact('battle-mobile.png') });
    if (visualOnly) {
        result.mode = 'command-menu-preview';
        await writeFile(artifact('command-preview-report.json'), JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify(result, null, 2));
        await browser.close();
        process.exit(0);
    }
    // Round one: Alice commits, reconnects, and must find her orders still locked.
    await commandRound(a);
    const privateOrders = await publicView(b);
    if (privateOrders.ownCommands !== null || !privateOrders.ready.opponent || 'commands' in privateOrders) throw new Error('Command privacy failed.');
    await a.reload({ waitUntil: 'networkidle' });
    await a.getByText(/Orders locked · waiting for bob/).waitFor({ timeout: 45000 }); result.reconnect = true;
    await commandRound(b);
    result.twoPlayerCommandRounds = 1;
    for (let n = 0; n < 40; n++) {
        const view = await publicView(a);
        if (view.phase === 'finished') break;
        await Promise.race([
            Promise.all([commands(a).waitFor({ timeout: 90000 }), commands(b).waitFor({ timeout: 90000 })]),
            a.getByRole('dialog').filter({ hasText: /VICTORY|DEFEAT|DRAW/ }).waitFor({ timeout: 90000 }),
        ]);
        if ((await publicView(a)).phase === 'finished') break;
        await Promise.all([commandRound(a), commandRound(b)]);
        result.twoPlayerCommandRounds++;
        console.log(`Committed two-player round ${result.twoPlayerCommandRounds}`);
    }
    const final = await publicView(a);
    if (final.phase !== 'finished') throw new Error('The browser duel did not reach a terminal server result.');
    result.terminal = final.result; result.reason = final.reason; result.rounds = final.round;
    await a.getByRole('dialog').filter({ hasText: /VICTORY|DEFEAT|DRAW/ }).waitFor({ timeout: 90000 });
    if (ranked) {
        await Promise.all([a.getByText(/Pet Elo recorded/).waitFor({ timeout: 70000 }), b.getByText(/Pet Elo recorded/).waitFor({ timeout: 70000 })]);
        result.settlement = await Promise.all([a, b].map(page => page.evaluate(async () => {
            const name = new URLSearchParams(location.search).get('seat');
            const record = await (await fetch(`/api/save/${name}`)).json();
            return { rating: record.character.petRankedRating, receipts: record.character.redeemedPetRankedMatchTokens?.length ?? 0, version: record._saveVersion, ryo: record.character.ryo, pets: record.character.pets.length };
        })));
        if (result.settlement.some(s => s.receipts !== 1 || s.version < 2 || s.ryo !== 500 || s.pets !== 5)) throw new Error('Ranked settlement did not preserve the owned save and record both participants once.');
    }
    await a.screenshot({ path: artifact('result-desktop.png') });
    if (ranked) {
        for (const page of [a, b]) {
            await page.locator('[data-qa-battle-active="false"][data-qa-fullscreen="true"]').waitFor({ state: 'attached' });
            await page.locator('.showdown-result').getByRole('button', { name: 'Back to Pet Arena', exact: true }).click();
            await page.locator('[data-qa-battle-active="false"][data-qa-fullscreen="false"]').waitFor({ state: 'attached' });
            await page.getByRole('button', { name: 'Find ranked match', exact: true }).waitFor();
        }
        result.lifecycleSignals = true;
    }
    if (errors.length || badResponses.length) throw new Error(`Browser errors: ${JSON.stringify({ errors, badResponses })}`);
    console.log(JSON.stringify(result, null, 2));
} catch (error) {
    result.failure = error.message; console.error(error);
    result.lastViews = await Promise.all(contexts.flatMap(c => c.pages()).map(p => publicView(p).then(v => ({ round: v.round, phase: v.phase, ready: v.ready, result: v.result })).catch(e => ({ error: e.message }))));
    for (const [i, context] of contexts.entries()) for (const page of context.pages()) await page.screenshot({ path: artifact(`failure-${i}.png`) }).catch(() => {});
    process.exitCode = 1;
} finally {
    await writeFile(artifact('browser-report.json'), JSON.stringify(result, null, 2) + '\n');
    await browser.close();
}
