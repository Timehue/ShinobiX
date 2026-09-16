// Run from shinobij.client: node scripts/stronghold-browser-qa.mjs
// Real host, Arena and production styles; deterministic local API fixtures.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { chromium, webkit } from '@playwright/test';
import { createBrowserNetworkDiagnostics } from './lib/browser-network-diagnostics.mjs';
const tmp = resolve('.tmp/stronghold-audit');
const outputArg = process.argv.find(value => value.startsWith('--output='));
const output = resolve(outputArg ? outputArg.slice('--output='.length) : '../docs/stronghold/audit');
await mkdir(tmp, { recursive: true }); await mkdir(output, { recursive: true });
await new Promise((ok, fail) => { const p = spawn(process.execPath, ['--import', 'tsx', 'scripts/fixtures/stronghold-session.ts'], { stdio: 'inherit' }); p.on('exit', code => code === 0 ? ok() : fail(new Error(`Fixture failed: ${code}`))); });
const session = JSON.parse(await readFile(tmp + '/session.json', 'utf8'));
await build({ entryPoints: ['scripts/fixtures/stronghold-qa.tsx'], bundle: true, jsx: 'automatic', outfile: tmp + '/preview.js',
    plugins: [{ name: 'public-assets', setup(build) { build.onResolve({ filter: /^\// }, args => ({ path: args.path, external: true })); } }],
    loader: { '.css': 'css', '.webp': 'file', '.png': 'file', '.svg': 'file', '.woff2': 'file', '.woff': 'file', '.jpg': 'file', '.mp3': 'file' },
    define: { 'import.meta.env.PROD': 'false', 'import.meta.env.DEV': 'true', 'import.meta.env.MODE': '"test"' }, logLevel: 'error' });
const server = createServer(async (req, res) => {
    try {
        const path = new URL(req.url, 'http://localhost').pathname;
        if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script src="/preview.js"></script></body></html>'); return; }
        const file = resolve(path.startsWith('/preview.') ? tmp : 'public', '.' + path);
        res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream');
        res.end(await readFile(file));
    } catch { res.statusCode = 404; res.end(); }
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const url = `http://127.0.0.1:${server.address().port}/`;
const errors = [], checks = [];
const diagnostics = createBrowserNetworkDiagnostics();
function fixture(options = {}) {
    const visit = { id: 'qa', layoutVersion: 1, sector: options.sector ?? 12, tile: options.tile ?? 153, steps: options.steps ?? 0, threat: options.threat ?? 0, version: 0, visited: options.visited ?? [153] };
    const state = { visit, steps: 0, polls: 0, leaves: 0, starts: 0, attacks: 0, reports: 0, failLeave: false, failStep: false, failResume: false, terminal: false, lose: false, ...options };
    state.session = structuredClone(session);
    if (state.terminal) Object.assign(state.session, { status: 'done', winner: state.lose ? 'enemy' : 'player', outcome: state.lose ? 'loss' : 'win',
        terminalEvidence: { finishedAt: Date.now(), finalMoveToken: 'qa-terminal', finalVersion: 0, finalEventSeq: 0, winner: state.lose ? 'enemy' : 'player', outcome: state.lose ? 'loss' : 'win', itemsUsed: {}, settlementState: 'pending' } });
    state.peers = Array.from({ length: options.crowd ?? 1 }, (_, n) => ({ name: n ? `LongShinobiPlayerName${n}` : 'Rival', level: 100, village: 'Ashen Leaf Village', stronghold: { sector: visit.sector, tile: 154 + n % 3 }, inBattle: false }));
    return state;
}
async function prepare(browser, viewport, state, query = '', beforeNavigate) {
    const page = await browser.newPage({ viewport, isMobile: viewport.width < 900, hasTouch: true, reducedMotion: 'reduce' });
    diagnostics.observe(page, { engine: browser.browserType().name(), viewport, query,
        sector: state.visit.sector, terminal: state.terminal, lose: state.lose, failReport: Boolean(state.failReport) });
    page.on('pageerror', e => errors.push(String(e)));
    await page.route('**/api/**', route => diagnostics.route(page, route, async () => {
        const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
        const action = body?.action;
        const fail = error => route.fulfill({ status: 503, json: { error } });
        if (action === 'stronghold-enter') state.visit.presenceId = body.presenceId;
        if (action === 'stronghold-state') { state.polls++; if (state.onState) return state.onState(route); }
        if (action === 'stronghold-leave') { state.leaves++; if (state.onLeave) return state.onLeave(route); if (state.failLeave) return fail('Connection interrupted. Try leaving again.'); return route.fulfill({ json: { ok: true } }); }
        if (action === 'stronghold-step') {
            if (state.failStep) return fail('Connection interrupted.');
            if (body.version === state.visit.version) { state.steps++; Object.assign(state.visit, { tile: body.tile, version: state.visit.version + 1, steps: state.visit.steps + 1, threat: Math.min(100, state.visit.threat + 4) }); if (!state.visit.visited.includes(body.tile)) state.visit.visited.push(body.tile); }
        }
        if (action === 'start' && state.holdStart) await new Promise(resolve => { state.releaseStart = resolve; });
        if (action === 'state' && state.failResume) return fail('Connection temporarily unavailable.');
        if (action === 'start') { state.starts++; if (state.onStart) return state.onStart(route); }
        if (route.request().url().includes('/api/qa/stronghold-attack')) { state.attacks++; return state.onAttack ? state.onAttack(route) : route.fulfill({ json: { ok: true } }); }
        if (action === 'state' || action === 'start') return route.fulfill({ json: { ok: true, runId: 'qa-patrol', session: state.session, sector: 12, targetVillage: 'Moonshadow Village', anbu: { name: 'The Moonshadow Anbu' } } });
        if (action === 'stronghold-patrol-report' || action === 'report') {
            state.reports++;
            if (state.failReport) return fail('Settlement temporarily unavailable.');
            state.visit.threat = 0; state.visit.version++;
            return route.fulfill({ json: { ok: true, visit: state.visit, peers: state.peers, won: !state.lose, alreadySettled: true, character: session.player.character, _saveVersion: 2 } });
        }
        if (route.request().url().includes('/solo-pve/')) return route.fulfill({ json: { ok: true, session: state.session } });
        return route.fulfill({ json: { ok: true, visit: state.visit, peers: state.peers, ...(state.visit.threat >= 100 ? { patrol: state.session } : {}) } });
    }));
    await beforeNavigate?.(page);
    await page.goto(url + query);
    return page;
}
async function ready(page) { await page.locator('.stronghold-shell').waitFor(); await page.locator('.stronghold-loading').waitFor({ state: 'hidden' }); }
async function fits(page) {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
    const box = await page.locator('.stronghold-dpad').boundingBox();
    assert(box && box.y + box.height <= page.viewportSize().height + 1, 'movement controls clipped');
    for (const button of await page.locator('.stronghold-dpad button, .stronghold-leave, .stronghold-zoom, .stronghold-peer').all()) {
        const b = await button.boundingBox(); assert(b.width >= 43.99 && b.height >= 43.99, `small tap target: ${await button.textContent()} ${JSON.stringify(b)}`);
    }
    const ownAvatar = await page.locator('.stronghold-player').boundingBox();
    for (const avatar of await page.locator('.stronghold-peer-avatar').all()) {
        const peer = await avatar.boundingBox();
        assert(peer && Math.abs(peer.width - ownAvatar.width) < .1 && Math.abs(peer.height - ownAvatar.height) < .1, 'player and rival avatar sizes differ');
    }
}
const browsers = [];
try {
    if (process.argv.includes('--dismissal')) {
        const { auditStrongholdDismissal } = await import('./stronghold-dismissal-qa.mjs');
        for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
            const browser = await engine.launch({ headless: true }); browsers.push(browser);
            checks.push(...await auditStrongholdDismissal({ browser, engineName, fixture, prepare, ready }));
        }
    } else if (process.argv.includes('--resources')) {
        const browser = await chromium.launch({ headless: true }); browsers.push(browser);
        const { auditStrongholdResources } = await import('./stronghold-resource-qa.mjs');
        checks.push(...await auditStrongholdResources({ browser, fixture, prepare, ready, output }));
    } else
    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !process.argv.includes('--webkit') || name === 'webkit')) {
        const browser = await engine.launch({ headless: true }); browsers.push(browser);
        // Keep deliberate exits available while a request is stalled; the pending
        // action must still fence movement and duplicate battle admission.
        for (const dismiss of ['escape', 'close', 'cancel']) {
            const state = fixture({ sector: 99 });
            const page = await prepare(browser, { width: 390, height: 844 }, state, '?host=1&sector=99&holdAttack=1');
            await ready(page); await page.locator('.stronghold-peer').click();
            await page.getByRole('button', { name: 'Attack player', exact: true }).click();
            assert(await page.getByRole('button', { name: 'Connecting…' }).isDisabled());
            if (dismiss === 'escape') await page.keyboard.press('Escape');
            else await page.getByRole('button', { name: dismiss === 'close' ? 'Close dialog' : 'Cancel', exact: true }).click();
            await page.getByRole('dialog').waitFor({ state: 'hidden' });
            assert(await page.getByRole('button', { name: 'Move right', exact: true }).isDisabled());
            await page.keyboard.press('d'); assert.equal(state.steps, 0);
            await page.getByRole('button', { name: /^Players/ }).click();
            assert(await page.getByRole('dialog').getByRole('button', { name: 'Inspect' }).isDisabled());
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('body').getAttribute('data-attack-count'), '1');
            await page.evaluate(() => window.releaseStrongholdAttack());
            await page.waitForFunction(() => !document.querySelector('button[aria-label="Move right"]')?.disabled);
            await page.getByRole('button', { name: 'Move right', exact: true }).click();
            await page.waitForFunction(() => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '4');
            checks.push({ engine: engineName, pendingAttackDismissal: dismiss, duplicateAttackBlocked: true });
            await page.close();
        }
        {
            const state = fixture({ tile: 697, visited: [697], holdStart: true });
            const page = await prepare(browser, { width: 844, height: 390 }, state, '?host=1');
            await ready(page); await page.getByRole('button', { name: 'Move right', exact: true }).click();
            await page.getByRole('button', { name: 'Challenge', exact: true }).click();
            assert(await page.getByRole('button', { name: 'Engaging…' }).isDisabled());
            await page.getByRole('button', { name: 'Retreat', exact: true }).click();
            await page.getByRole('dialog').waitFor({ state: 'hidden' });
            assert(await page.getByRole('button', { name: 'Move right', exact: true }).isDisabled());
            while (!state.releaseStart) await page.waitForTimeout(10);
            state.releaseStart();
            await page.locator('.hex-grid-layer').waitFor();
            checks.push({ engine: engineName, pendingAnbuDismissal: true, admittedBattlePreserved: true });
            await page.close();
        }
        for (const sector of [12, 99]) {
            const state = fixture({ sector });
            const page = await prepare(browser, { width: 390, height: 844 }, state, `?host=1&sector=${sector}&cachedAvatar=1`);
            await ready(page); await fits(page);
            assert.equal(await page.locator('.stronghold-player img').getAttribute('src'), '/anbu/frostfang.webp');
            assert.equal(await page.locator('.stronghold-peer-avatar img').getAttribute('src'), '/anbu/moonshadow.webp');
            // The transparent padding must open inspection without walking onto the tile.
            const target = await page.locator('.stronghold-peer').boundingBox();
            await page.locator('.stronghold-peer').click({ position: { x: 1, y: target.height / 2 } });
            await page.getByRole('dialog', { name: 'Rival', exact: true }).waitFor();
            assert.equal(state.steps, 0);
            await page.keyboard.press('Escape');
            await page.getByRole('dialog').waitFor({ state: 'hidden' });
            checks.push({ engine: engineName, sector, cachedPortraits: true, avatarSizeParity: true, transparentTouchTarget: true });
            await page.close();
        }
        for (const [width, height] of [[320, 568], [390, 844], [430, 932], [844, 390], [1920, 1080]]) {
            const state = fixture({ sector: 99, crowd: 18 });
            const page = await prepare(browser, { width, height }, state, '?host=1&sector=99');
            await ready(page); await fits(page);
            assert(await page.getByRole('heading', { name: 'Obsidian Stronghold', exact: true }).isVisible());
            assert(await page.getByText('4× PvP rewards', { exact: true }).isVisible());
            assert(await page.getByText('Ashen Threshold', { exact: true }).first().isVisible());
            await page.screenshot({ path: `${output}/${engineName}-obsidian-${width}x${height}.png` });
            if (width < 900) await page.getByRole('button', { name: /^Players/ }).click();
            await page.locator('.stronghold-roster:visible').last().getByRole('button', { name: 'Inspect' }).first().click();
            assert(await page.getByText('4× normal rewards on a PvP win.', { exact: true }).isVisible());
            await page.getByRole('button', { name: 'Attack player' }).click();
            await page.getByRole('dialog').waitFor({ state: 'hidden' });
            assert.equal(await page.evaluate(() => document.body.dataset.attack), 'Rival');
            await page.getByRole('button', { name: 'Move right', exact: true }).click();
            await page.waitForFunction(() => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '4');
            await page.getByRole('button', { name: 'View full map' }).click();
            await fits(page);
            const beforeOverview = state.steps;
            await page.keyboard.press('d'); await page.waitForTimeout(150);
            assert.equal(state.steps, beforeOverview, 'overview must block keyboard movement');
            await page.screenshot({ path: `${output}/${engineName}-obsidian-map-${width}x${height}.png` });
            checks.push({ engine: engineName, viewport: `${width}x${height}`, obsidian: true, rewardBanner: true, attackBonus: true, fits: true });
            await page.close();
        }
        {
            const state = fixture({ sector: 99, tile: 697, visited: [697], crowd: 0 });
            const page = await prepare(browser, { width: 390, height: 844 }, state, '?host=1&sector=99', page =>
                page.addInitScript(() => localStorage.setItem('anbuInfiltration.activeRun:scout', 'unrelated-saved-anbu')));
            await ready(page);
            await page.getByRole('button', { name: 'Move right', exact: true }).click();
            await page.waitForFunction(() => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '4');
            assert.equal(state.visit.tile, 698, 'the altar must be walkable');
            assert.equal(await page.getByRole('dialog').count(), 0, 'no village Anbu in Death’s Gate');
            assert.equal(await page.evaluate(() => localStorage.getItem('anbuInfiltration.activeRun:scout')), 'unrelated-saved-anbu');
            checks.push({ engine: engineName, obsidianAltar: true, savedAnbuIsolated: true });
            await page.close();
        }
        for (const [width, height] of [[320, 568], [390, 844], [430, 932], [844, 390], [1920, 1080]]) {
            const state = fixture({ crowd: 18 }); const page = await prepare(browser, { width, height }, state); await ready(page); await fits(page);
            await page.screenshot({ path: `${output}/${engineName}-${width}x${height}.png` });
            if (width < 900) {
                await page.getByRole('button', { name: /^Players/ }).click();
                await page.getByRole('dialog').getByRole('button', { name: 'Inspect' }).last().click();
            } else await page.locator('.stronghold-roster-row button').first().click();
            await page.getByRole('button', { name: 'Attack player' }).click();
            assert(await page.getByRole('button', { name: 'Connecting…' }).isDisabled());
            await page.getByRole('dialog').waitFor({ state: 'hidden' });
            await page.getByRole('button', { name: 'Move right', exact: true }).click();
            await page.waitForFunction(() => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '4');
            await page.keyboard.press('a'); // Keyboard still works after a direction button holds focus.
            await page.waitForFunction(() => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '8');
            await page.getByRole('button', { name: 'View full map' }).click();
            assert(await page.getByRole('button', { name: 'Move right', exact: true }).isDisabled());
            const beforeOverview = state.steps;
            await page.keyboard.press('d'); await page.waitForTimeout(150);
            assert.equal(state.steps, beforeOverview, 'overview must block keyboard movement');
            checks.push(`${engineName} ${width}x${height}: crowd, modal, tap targets, movement, overview`); await page.close();
        }
        const state = fixture(); const page = await prepare(browser, { width: 390, height: 844 }, state); await ready(page);
        state.failLeave = true; await page.getByRole('button', { name: 'Leave stronghold' }).click();
        await page.getByText('Connection interrupted. Try leaving again.').waitFor();
        const oldPolls = state.polls; await page.waitForFunction(() => document.querySelector('.stronghold-guidance')?.textContent.includes('Tap the floor')); assert(state.polls > oldPolls);
        state.failLeave = false;
        for (let n = 1; n <= 25; n++) {
            await page.keyboard.press(n % 2 ? 'd' : 'a');
            try { await page.waitForFunction(expected => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === String(expected), n * 4, { timeout: 5000 }); }
            catch (e) { console.log({ engineName, n, state, pageErrors: errors, focus: await page.evaluate(() => document.activeElement?.outerHTML), text: await page.locator('body').innerText() }); throw e; }
        }
        assert.equal(state.steps, 25); assert.equal(await page.locator('body').getAttribute('data-patrol'), 'qa-patrol');
        checks.push(`${engineName}: exit failure restores polling; exactly 25 steps trigger patrol`); await page.close();
        const boss = fixture({ tile: 697, visited: [697] }); const host = await prepare(browser, { width: 844, height: 390 }, boss, '?host=1'); await ready(host);
        await host.getByRole('button', { name: 'Move right', exact: true }).click(); await host.getByRole('dialog').waitFor();
        const dialogBox = await host.getByRole('dialog').boundingBox(); assert(dialogBox.y >= 0 && dialogBox.y + dialogBox.height <= 390);
        await host.screenshot({ path: `${output}/${engineName}-boss-landscape.png` });
        await host.keyboard.press('Escape'); await host.getByRole('dialog').waitFor({ state: 'hidden' });
        await host.getByRole('button', { name: 'Move right', exact: true }).click(); await host.getByRole('button', { name: 'Challenge', exact: true }).click();
        await host.locator('.stronghold-shell').waitFor({ state: 'hidden' });
        await host.locator('.hex-grid-layer').waitFor();
        const battleBox = await host.locator('.hex-battlefield').boundingBox();
        assert(battleBox && battleBox.height > 80 && battleBox.y < 390, 'combat board is clipped');
        const attackBox = await host.locator('.basic-action-bar button').first().boundingBox();
        assert(attackBox && attackBox.y >= 0 && attackBox.y + attackBox.height <= 390, 'combat actions clipped');
        await host.locator('.basic-action-bar button').first().click({ trial: true });
        await host.waitForTimeout(400); await host.screenshot({ path: `${output}/${engineName}-combat.png` });
        checks.push(`${engineName}: final boss dialog fits landscape, Escape restores exploration, actual Arena mounts`); await host.close();
        // Establish the saved-run precondition before mounting. Booting an
        // unrelated exploration page merely to seed storage raced its passive
        // mount effects against navigation (WebKit reports access-control errors
        // for those old-document fetches before any API request is dispatched).
        const recovery = fixture({ failResume: true });
        const retry = await prepare(browser, { width: 390, height: 844 }, recovery, '?host=1', page =>
            page.addInitScript(() => localStorage.setItem('anbuInfiltration.activeRun:scout', 'qa-patrol')));
        await retry.getByRole('button', { name: 'Retry connection' }).waitFor();
        assert.equal(await retry.evaluate(() => localStorage.getItem('anbuInfiltration.activeRun:scout')), 'qa-patrol');
        recovery.failResume = false; await retry.getByRole('button', { name: 'Retry connection' }).click();
        await retry.getByRole('heading', { name: 'Rejoining your infiltration' }).waitFor({ state: 'hidden' });
        checks.push(`${engineName}: failed recovery retains account-scoped fight and retries`); await retry.close();
        // Exercise real navigation while an established presence request is
        // pending, then prove the replacement page still enters successfully.
        {
            let entered, release;
            const observed = new Promise(resolve => { entered = resolve; });
            const held = new Promise(resolve => { release = resolve; });
            const state = fixture({ onState: async route => {
                entered(); await held;
                await route.fulfill({ json: { ok: true, visit: state.visit, peers: state.peers } });
            } });
            const page = await prepare(browser, { width: 390, height: 844 }, state, '?host=1');
            await ready(page);
            await Promise.race([observed, page.waitForTimeout(10_000).then(() => { throw new Error('Presence poll did not start'); })]);
            try {
                await Promise.all([
                    page.waitForRequest(request => request.method() === 'POST' && request.postDataJSON()?.action === 'stronghold-enter'),
                    page.reload(),
                ]);
                // The replacement must be usable before the old poll is released;
                // browser transport cancellation events differ across engines.
                await ready(page);
            } finally { release(); }
            assert.equal(state.starts, 0, 'navigation must not admit a battle');
            checks.push(`${engineName}: navigation during a pending presence read recovers`);
            await page.close();
        }
        for (const outcome of ['win', 'loss', 'save-rejected', 'report-failure']) {
            const terminal = fixture({ threat: 100, terminal: true, lose: outcome === 'loss', failReport: outcome === 'report-failure' });
            const result = await prepare(browser, { width: 390, height: 844 }, terminal, `?host=1${outcome === 'save-rejected' ? '&rejectSave=1' : ''}`);
            if (outcome === 'win' || outcome === 'save-rejected') { await ready(result); await result.waitForFunction(() => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '0'); }
            if (outcome === 'loss') { await result.getByRole('button', { name: 'Return to sector' }).click(); await result.getByRole('heading', { name: 'Returned to sector' }).waitFor(); }
            if (outcome === 'report-failure') { await result.getByRole('heading', { name: 'Report Failed' }).waitFor(); await result.getByRole('button', { name: /retry/i }).click({ trial: true }); }
            assert.equal(terminal.reports, outcome === 'report-failure' ? 4 : 1, 'unexpected settlement attempts (Arena retries failed reports four times)');
            checks.push(`${engineName}: actual Arena patrol settlement ${outcome}`); await result.close();
        }
    }
    assert.deepEqual(errors, []);
    await writeFile(output + (process.argv.includes('--dismissal') ? '/dismissal-results.json' : process.argv.includes('--resources') ? '/resource-results.json' : '/results.json'), JSON.stringify({ checks, pageErrors: errors }, null, 2));
    console.log(JSON.stringify({ passed: true, checks, pageErrors: errors }, null, 2));
} catch (error) {
    for (const browser of browsers) for (const context of browser.contexts()) for (const page of context.pages()) {
        await page.screenshot({ path: output + '/failure.png' });
        console.log({ failureText: await page.locator('body').innerText(), pageErrors: errors });
    }
    throw error;
} finally {
    try { for (const browser of browsers) await browser.close(); }
    finally {
        await new Promise(resolve => server.close(resolve));
        await writeFile(output + '/diagnostics.json', JSON.stringify({ ...diagnostics.report(), checks, pageErrors: errors }, null, 2));
    }
}
