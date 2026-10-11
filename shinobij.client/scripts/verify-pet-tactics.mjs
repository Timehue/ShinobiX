import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.PET_TACTICS_QA_URL ?? 'http://127.0.0.1:4318';
const out = resolve(import.meta.dirname, '../../docs/audits/pet-tactics-prototype');
const ranked = process.env.PET_ARENA_QA_RANKED === '1';
const visualOnly = process.env.PET_ARENA_QA_VISUAL_ONLY === '1';
const artifact = name => resolve(out, `${ranked ? 'ranked-' : ''}${name}`);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const contexts = [], errors = [], badResponses = [];
async function player(seat, viewport) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' }); contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${seat}: ${error.message}`));
    page.on('response', response => { if (response.status() >= 400 && !response.url().includes('/api/')) badResponses.push({ seat, url: response.url(), status: response.status() }); });
    await page.goto(`${base}/pet-tactics-qa.html?seat=${seat}${ranked ? '&ranked=1' : ''}`, { waitUntil: 'networkidle', timeout: 90000 });
    await Promise.any([
        page.getByRole('button', { name: ranked ? 'Find ranked match' : 'Create arena room' }).waitFor({ timeout: 90000 }),
        page.getByRole('button', { name: 'Back to squad builder', exact: true }).waitFor({ timeout: 90000 }),
    ]);
    if (await page.getByRole('button', { name: 'Back to squad builder', exact: true }).isVisible()) {
        await page.getByRole('button', { name: 'Back to squad builder', exact: true }).click();
    }
    await page.getByRole('button', { name: ranked ? 'Find ranked match' : 'Create arena room' }).waitFor({ timeout: 90000 });
    return page;
}
const publicView = page => page.evaluate(async () => {
    const r = await fetch('/api/pet/tactics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recover' }) });
    return r.json();
});
async function chooseAction(page, petName, action, targetSlot) {
    await page.getByRole('button', { name: 'Command ' + petName, exact: true }).click();
    const category = action.startsWith('switch:') ? 'Switch' : ['guard', 'rest'].includes(action) ? 'Guard / Rest' : 'Moves';
    await page.getByRole('navigation', { name: 'Action categories' }).getByRole('button', { name: category, exact: true }).click();
    await page.locator('[data-action="' + action + '"]').click();
    if (targetSlot !== undefined) await page.locator('[data-target-slot="' + targetSlot + '"]').click();
}
const result = { mode: ranked ? 'ranked-player-controlled' : 'sparring', desktop: false, mobile: false, twoPlayerCommandRounds: 0, reconnect: false, terminal: null, errors, badResponses };
try {
    const a = await player('alice', { width: 1440, height: 960 });
    if (await a.locator('.pta-roster-pet').count() !== 12) throw new Error('The roster must expose 12 pets.');
    await a.getByRole('heading', { name: 'Pet Arena', exact: true }).waitFor();
    await a.screenshot({ path: artifact('squad-builder-desktop.png'), fullPage: true }); result.desktop = true;
    const b = await player('bob', { width: 390, height: 844 });
    await b.screenshot({ path: artifact('squad-builder-mobile.png'), fullPage: true });
    const overflow = await b.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    if (overflow) throw new Error('Mobile squad builder overflows horizontally.'); result.mobile = true;
    await a.getByRole('button', { name: 'Tactics build', exact: true }).nth(0).click();
    await b.getByRole('button', { name: 'Tactics build', exact: true }).nth(3).click();
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
    await b.locator('.pta-leads button').filter({ hasText: 'Pebble Tortoise' }).click();
    await b.locator('.pta-leads button').filter({ hasText: 'Cinder Cub' }).click();
    await a.getByRole('button', { name: 'Lock opening pair' }).click();
    const privatePreview = await publicView(b);
    if (privatePreview.enemy.some(p => p.slot !== null)) throw new Error('Enemy leads leaked before the second lock.');
    await b.getByRole('button', { name: 'Lock opening pair' }).click();
    await Promise.all([a.locator('.pta-orders').waitFor({ timeout: 45000 }), b.locator('.pta-orders').waitFor({ timeout: 45000 })]);
    if (ranked) for (const page of [a, b]) await page.locator('[data-qa-battle-active="true"][data-qa-fullscreen="true"]').waitFor({ state: 'attached' });
    await a.locator('.showdown-topbar-right button.showdown-chip.icon').first().click();
    await b.locator('.showdown-topbar-right button.showdown-chip.icon').first().click();
    for (const page of [a, b]) {
        const readable = await page.evaluate(() => {
            const consoleRect = document.querySelector('.pta-console').getBoundingClientRect();
            const sceneRect = document.querySelector('.showdown-scene-viewport').getBoundingClientRect();
            const plates = [...document.querySelectorAll('.showdown-team-panel.enemy .showdown-plate:not(.benched)')];
            const resources = [...document.querySelectorAll('.pta-actor progress')];
            return !document.querySelector('.showdown-playerbar') && Math.abs(sceneRect.bottom - consoleRect.top) <= 2
                && resources.length === 4 && resources.every(bar => {
                    const r = bar.getBoundingClientRect(), card = bar.closest('button').getBoundingClientRect();
                    return bar.value === bar.max && r.width > 50 && r.left >= card.left && r.right <= card.right && r.bottom <= card.bottom;
                }) && consoleRect.left >= 0 && consoleRect.right <= innerWidth + 2 && plates.every(plate => {
                const r = plate.getBoundingClientRect(); return r.left >= -2 && r.right <= innerWidth + 2;
            });
        });
        if (!readable) throw new Error('Arena has a dead band, duplicate friendly HUD, or unreadable pet resources.');
    }
    await a.screenshot({ path: artifact('battle-desktop.png') });
    await b.screenshot({ path: artifact('battle-mobile.png') });
    if (await a.getByRole('button', { name: 'Lock both orders', exact: true }).isEnabled()) throw new Error('An empty order batch can be locked.');
    await a.getByRole('button', { name: /Battle intel/ }).click();
    await a.getByRole('dialog', { name: 'Battle intel', exact: true }).waitFor();
    await a.keyboard.press('Escape');
    if (await a.getByRole('dialog', { name: 'Battle intel', exact: true }).isVisible()) throw new Error('Battle intel cannot be dismissed with Escape.');
    await chooseAction(a, 'Cinder Cub', 'expose', 1);
    await a.locator('[data-action="expose"]').focus();
    await a.keyboard.press('Enter');
    await chooseAction(a, 'Ripple Seal', 'water-pulse', 1);
    if ((await publicView(a)).ownOrders !== null) throw new Error('Local menu edits sent unlocked orders.');
    await a.screenshot({ path: artifact('battle-selected-desktop.png') });
    await chooseAction(b, 'Pebble Tortoise', 'intercept');
    await chooseAction(b, 'Cinder Cub', 'fire-pulse', 1);
    await b.screenshot({ path: artifact('battle-selected-mobile.png') });
    const mobileControls = await b.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        const clock = rect('.pta-clock'), actors = rect('.pta-actor-rail'), lock = rect('.pta-review button');
        return [clock, actors, lock].every(r => r.top >= 0 && r.bottom <= innerHeight + 2 && r.left >= 0 && r.right <= innerWidth + 2)
            && [...document.querySelectorAll('.pta-targets button')].every(el => el.getBoundingClientRect().height >= 44)
            && document.querySelector('.pta-orders select') === null;
    });
    if (!mobileControls) throw new Error('Mobile timer, pet selectors, targets or lock control are not usable.');
    result.commandMenu = { keyboard: true, localDraftPrivacy: true, intelEscape: true, mobilePinnedControls: true, integratedResources: true, arenaMeetsMenu: true };
    if (visualOnly) {
        result.mode = 'command-menu-preview';
        await writeFile(artifact('command-preview-report.json'), JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify(result, null, 2));
        await browser.close();
        process.exit(0);
    }
    await a.getByRole('button', { name: 'Lock both orders', exact: true }).click();
    const privateOrders = await publicView(b);
    if (privateOrders.ownOrders !== null || !privateOrders.ready.opponent || 'orders' in privateOrders) throw new Error('Command privacy failed.');
    await a.reload({ waitUntil: 'networkidle' });
    await a.getByText('Your orders are sealed', { exact: true }).waitFor({ timeout: 45000 }); result.reconnect = true;
    await a.locator('.showdown-topbar-right button.showdown-chip.icon').first().click();
    await b.getByRole('button', { name: 'Lock both orders', exact: true }).click();
    await a.locator('.showdown-takeover canvas').waitFor({ timeout: 45000 });
    await a.locator('.showdown-playerbar').waitFor();
    result.commandMenu.playbackHud = true;
    result.twoPlayerCommandRounds = 1;
    // Real DOM input through the production component, with each browser choosing from its public state.
    for (let n = 0; n < 30; n++) {
        const snapshots = await Promise.all([publicView(a), publicView(b)]);
        if (snapshots[0].phase === 'finished') { result.terminal = snapshots[0].result; break; }
        await Promise.all([a.getByRole('button', { name: 'Lock both orders', exact: true }).waitFor({ timeout: 70000 }), b.getByRole('button', { name: 'Lock both orders', exact: true }).waitFor({ timeout: 70000 })]);
        const views = await Promise.all([publicView(a), publicView(b)]);
        if (n === 0) {
            for (const [i, page] of [a, b].entries()) {
                const synced = await page.evaluate(pets => pets.every(p => {
                    const bar = label => document.querySelector(`progress[aria-label="${p.name} ${label}"]`);
                    return bar('HP')?.value === p.hp && bar('HP')?.max === p.maxHp && bar('Energy')?.value === p.stamina;
                }), views[i].own.filter(p => p.slot !== null && !p.ko));
                if (!synced) throw new Error('Pet card resources are stale after round playback.');
            }
            result.commandMenu.resourcesAfterRound = true;
            await a.screenshot({ path: artifact('battle-resource-update-desktop.png') });
        }
        for (const [i, page] of [a, b].entries()) {
            const v = views[i]; let usedSignature = false;
            const reserved = new Set();
            for (const pet of v.own.filter(p => p.slot !== null && !p.ko)) {
                const foe = v.enemy.filter(p => p.slot !== null && !p.ko).sort((x, y) => x.hp - y.hp)[0];
                const moves = pet.moves.filter(m => m.available && m.power > 0);
                let chosen = moves.sort((x, y) => (y.ranges.find(r => r.slot === foe.slot)?.max ?? 0) - (x.ranges.find(r => r.slot === foe.slot)?.max ?? 0))[0];
                if (pet.signature.available && !usedSignature && pet.signature.power > 0) { chosen = pet.signature; usedSignature = true; }
                if (chosen) {
                    await chooseAction(page, pet.name, chosen.id === pet.signature.id ? 'signature' : chosen.id, foe.slot);
                } else {
                    const reserve = v.own.find(p => !p.ko && p.slot === null && p.stamina >= 40 && !reserved.has(p.id));
                    if (reserve) { reserved.add(reserve.id); await chooseAction(page, pet.name, 'switch:' + reserve.id); }
                    else await chooseAction(page, pet.name, 'rest');
                }
            }
        }
        await a.getByRole('button', { name: 'Lock both orders', exact: true }).click();
        await b.getByRole('button', { name: 'Lock both orders', exact: true }).click();
        result.twoPlayerCommandRounds++;
        console.log(`Committed two-player round ${result.twoPlayerCommandRounds}`);
        // A transcript change confirms the server committed both browser command batches.
        await a.waitForFunction(async expected => {
            const r = await fetch('/api/pet/tactics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recover' }) });
            const v = await r.json(); return v.round >= expected || v.phase === 'finished';
        }, result.twoPlayerCommandRounds, { timeout: 20000 });
    }
    const final = await publicView(a);
    if (final.phase !== 'finished') throw new Error('The browser duel did not reach a terminal server result.');
    result.terminal = final.result; result.reason = final.reason; result.rounds = final.round;
    await a.getByRole('dialog').filter({ hasText: /VICTORY|DEFEAT|DRAW/ }).waitFor({ timeout: 70000 });
    if (ranked) {
        await Promise.all([a.getByText(/Pet Elo recorded/).waitFor({ timeout: 70000 }), b.getByText(/Pet Elo recorded/).waitFor({ timeout: 70000 })]);
        result.settlement = await Promise.all([a, b].map(page => page.evaluate(async () => {
            const name = new URLSearchParams(location.search).get('seat');
            const record = await (await fetch(`/api/save/${name}`)).json();
            return { rating: record.character.petRankedRating, receipts: record.character.redeemedPetRankedMatchTokens?.length ?? 0, version: record._saveVersion, ryo: record.character.ryo, pets: record.character.pets.length };
        })));
        if (result.settlement.some(s => s.receipts !== 1 || s.version < 2 || s.ryo !== 500 || s.pets !== 0)) throw new Error('Ranked settlement did not preserve the owned save and record both participants once.');
    }
    await a.screenshot({ path: artifact('result-desktop.png') });
    if (ranked) {
        for (const page of [a, b]) {
            await page.locator('[data-qa-battle-active="false"][data-qa-fullscreen="true"]').waitFor({ state: 'attached' });
            await page.getByRole('button', { name: 'Back to squad builder', exact: true }).click();
            await page.locator('[data-qa-battle-active="false"][data-qa-fullscreen="false"]').waitFor({ state: 'attached' });
            await page.getByRole('button', { name: 'Find ranked match', exact: true }).waitFor();
        }
        result.commandMenu.lifecycleSignals = true;
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
