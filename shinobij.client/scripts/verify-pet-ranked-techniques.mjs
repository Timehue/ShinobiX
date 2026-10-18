import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve(import.meta.dirname, '../.tmp/pet-techniques-review');
const baseUrl = process.env.PET_TECHNIQUES_QA_URL ?? 'http://127.0.0.1:4318';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
const errors = [], submitted = [], previews = [], commands = [];
const latest = new Map();
const appearances = new Map();
const committedRounds = new Map();
const pages = [];
async function selected(editor) { return editor.locator('input[type="checkbox"]:checked').evaluateAll(inputs => inputs.map(input => input.getAttribute('aria-label'))); }
async function swap(editor) {
    const replacement = editor.locator('input[type="checkbox"]:not(:checked)').first();
    const name = await replacement.getAttribute('aria-label');
    await editor.locator('input[type="checkbox"]:checked').first().uncheck();
    await editor.getByRole('checkbox', { name, exact: true }).check();
    return selected(editor);
}
try {
    for (const [seat, viewport] of [['alice', { width: 1280, height: 900 }], ['bob', { width: 390, height: 844 }]]) {
        const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
        pages.push(page); page.setDefaultTimeout(180000);
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', message => { if (/Shader Error|ShaderError|VALIDATE_STATUS/.test(message.text())) errors.push(message.text()); });
        page.on('request', req => {
            if (req.url().includes('pet-ranked-queue') && req.postDataJSON()?.action === 'join') submitted.push(req.postDataJSON());
            if (req.url().includes('/api/pet/tactics') && req.postDataJSON()?.action === 'orders') commands.push({ seat, ...req.postDataJSON() });
        });
        page.on('response', async res => {
            if (res.url().includes('/api/pet/tactics')) {
                const view = await res.json().catch(() => null);
                if (view?.own && (view.revision >= (latest.get(seat)?.revision ?? -1))) latest.set(seat, view);
                for (const round of view?.transcript ?? []) committedRounds.set(`${seat}:${round.round}`, round);
                if (view?.phase === 'preview') previews.push({ seat, own: view.own });
            }
        });
        await page.goto(`${baseUrl}/pet-tactics-qa.html?seat=${seat}&ranked=1&yard=1`, { waitUntil: 'commit' });
        await page.getByRole('button', { name: 'Battle & techniques', exact: true }).waitFor();
        const saved = await page.evaluate(async name => (await (await fetch(`/api/save/${name}`)).json()).character, seat);
        appearances.set(seat, saved.pets.slice(0, 4).map(pet => ({ ...(pet.loadout?.collar ? { collarId: pet.loadout.collar } : {}),
            ...(pet.paletteVariantId ? { paletteVariantId: pet.paletteVariantId } : {}) })));
        await page.getByRole('button', { name: 'Battle & techniques', exact: true }).click();
        const editor = page.locator('.pet-techniques-editor');
        await editor.getByRole('heading', { name: 'Learnable techniques' }).waitFor();
        assert.equal(await editor.getByRole('checkbox').count(), 8);
        assert.equal(await editor.locator('.pet-technique-effect').count(), 9, 'all move and signature effects are visible');
        assert.ok(await editor.locator('.pta-move-pool label > span').first().evaluate(span => span.getBoundingClientRect().width >= 160), 'move descriptions retain readable width');
        const changed = await swap(editor);
        await editor.locator('.pet-techniques-advanced > summary').click();
        await editor.getByRole('combobox').selectOption('focus-lens');
        if (seat === 'alice') {
            await page.route('**/api/pet/progress', async route => {
                await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'QA simulated save retry.' }) });
                await page.unroute('**/api/pet/progress');
            });
            await editor.getByRole('button', { name: 'Save loadout', exact: true }).click();
            await editor.getByRole('alert').filter({ hasText: 'QA simulated save retry.' }).waitFor();
        }
        await editor.getByRole('button', { name: 'Save loadout', exact: true }).click();
        await editor.getByRole('button', { name: 'Loadout saved', exact: true }).waitFor();
        await page.reload({ waitUntil: 'commit' });
        await page.getByRole('button', { name: 'Battle & techniques', exact: true }).click();
        await editor.getByRole('button', { name: 'Loadout saved', exact: true }).waitFor();
        assert.deepEqual(await selected(editor), changed, 'yard swaps persist after reload');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'yard fits the viewport');
        await page.screenshot({ path: resolve(output, `yard-${seat}.png`), fullPage: true });
        await page.getByRole('button', { name: 'QA: Ranked screen', exact: true }).click();
        await page.getByRole('heading', { name: /Choose your carried companions/ }).waitFor();
        for (let i = 0; i < 4; i++) await page.locator('.pta-roster-pet').nth(i).click();
        const rankedEditor = page.locator('.pet-techniques-editor').first();
        const editors = page.locator('.pet-techniques-editor');
        assert.equal(await page.locator('.pet-techniques-editor[open]').count(), 1, 'ranked starts with one technique library expanded');
        assert.ok(await rankedEditor.locator('.pet-technique-title svg').count() >= 9, 'all moves and the signature use the game glyph family');
        const type = await rankedEditor.locator('.pet-technique-effect').first().evaluate(node => {
            const style = getComputedStyle(node);
            return { size: parseFloat(style.fontSize), weight: style.fontWeight };
        });
        assert.ok(type.size >= 12 && type.weight === '400', 'move effects retain readable body typography in ranked');
        const secondEditor = editors.nth(1);
        assert.equal(await secondEditor.evaluate(node => node.open), false);
        await secondEditor.locator(':scope > summary').click();
        const secondChoices = await swap(secondEditor);
        await secondEditor.getByRole('button', { name: 'Save loadout', exact: true }).click();
        await secondEditor.getByRole('button', { name: 'Loadout saved', exact: true }).waitFor();
        assert.deepEqual(await selected(secondEditor), secondChoices, 'another carried pet has its own editable saved kit');
        await secondEditor.locator(':scope > summary').click();
        assert.equal(await secondEditor.evaluate(node => node.open), false, 'the edited pet can be collapsed without losing its kit');
        assert.deepEqual(await selected(rankedEditor), changed, 'ranked starts with the yard kit');
        const queue = page.getByRole('button', { name: 'Find ranked match', exact: true });
        const nextMove = await rankedEditor.locator('input[type="checkbox"]:not(:checked)').first().getAttribute('aria-label');
        await rankedEditor.locator('input[type="checkbox"]:checked').first().uncheck();
        assert.equal(await queue.isDisabled(), true, 'incomplete move kit cannot queue');
        await rankedEditor.getByRole('checkbox', { name: nextMove, exact: true }).check();
        assert.equal(await queue.isEnabled(), true);
        const nextChoices = await selected(rankedEditor);
        await rankedEditor.getByRole('button', { name: 'Save loadout', exact: true }).click();
        await rankedEditor.getByRole('button', { name: 'Loadout saved', exact: true }).waitFor();
        await page.getByRole('button', { name: 'QA: Pet Yard', exact: true }).click();
        await page.getByRole('button', { name: 'Battle & techniques', exact: true }).click();
        assert.deepEqual(await selected(editor), nextChoices, 'ranked swaps carry back to the yard');
        await page.getByRole('button', { name: 'QA: Ranked screen', exact: true }).click();
        await page.getByRole('heading', { name: /Choose your carried companions/ }).waitFor();
        for (let i = 0; i < 4; i++) await page.locator('.pta-roster-pet').nth(i).click();
        await page.locator('.pet-techniques-editor').first().screenshot({ path: resolve(output, `ranked-editor-${seat}.png`) });
    }
    await pages[0].getByRole('button', { name: 'Find ranked match', exact: true }).click();
    await pages[1].getByRole('button', { name: 'Find ranked match', exact: true }).click();
    for (const page of pages) await page.getByRole('heading', { name: 'Read their squad. Choose your opening.' }).waitFor();
    assert.equal(submitted.length, 2);
    for (const seat of ['alice', 'bob']) {
        const payload = submitted.find(body => body.name === seat);
        const preview = previews.find(view => view.seat === seat);
        assert.ok(payload && preview, `sealed preview for ${seat}`);
        assert.deepEqual(preview.own[0].moves.filter(move => move.id !== 'basic').map(move => move.id), payload.builds[0].moveIds);
        assert.equal(preview.own[0].item, 'focus-lens');
        assert.deepEqual(preview.own.map(pet => pet.appearance), appearances.get(seat), 'ranked seals each saved appearance');
        assert.deepEqual(latest.get(seat).enemy.map(pet => pet.appearance), appearances.get(seat === 'alice' ? 'bob' : 'alice'), 'the opponent sees the same cosmetics');
    }
    for (const page of pages) await page.getByRole('button', { name: 'Lock opening pair', exact: true }).click();
    for (const page of pages) await page.getByRole('button', { name: /Lock both orders/ }).waitFor();
    const chosen = [];
    for (const [index, seat] of ['alice', 'bob'].entries()) {
        const page = pages[index];
        const field = latest.get(seat).own.filter(pet => pet.slot !== null && !pet.ko).sort((a, b) => a.slot - b.slot);
        for (const pet of field) {
            await page.getByRole('button', { name: `Command ${pet.name}`, exact: true }).click();
            const move = pet.moves.find(move => move.id !== 'basic' && move.available && move.power > 0);
            assert.ok(move, `${pet.name} has an available equipped attack`);
            await page.locator(`.pta-move-card[data-action="${move.id}"]`).click();
            if (move.target === 'foe' || move.target === 'ally') await page.locator('.pta-targets [data-target-slot="0"]').click();
            chosen.push({ seat, actorId: pet.id, moveId: move.id });
        }
        await page.getByRole('button', { name: /Lock both orders/ }).click();
    }
    for (const page of pages) await page.locator('.pta-orders-heading .pta-kicker').filter({ hasText: 'Round 2' }).waitFor();
    assert.equal(commands.length, 2);
    for (const order of chosen) assert.ok(commands.find(command => command.seat === order.seat)?.orders.some(command => command.actorId === order.actorId && command.moveId === order.moveId));
    assert.ok(committedRounds.get('alice:1')?.events.length > 0, 'custom techniques generate a committed battle script');
    for (const [index, seat] of ['alice', 'bob'].entries()) await pages[index].screenshot({ path: resolve(output, `ranked-round-${seat}.png`), fullPage: true });
    // Refresh during a live match: recover the same pets, moves and round.
    await pages[0].goto(`${baseUrl}/pet-tactics-qa.html?seat=alice&ranked=1`, { waitUntil: 'commit' });
    await pages[0].locator('.pta-orders-heading .pta-kicker').filter({ hasText: 'Round 2' }).waitFor();
    assert.equal(latest.get('alice').round, 1);
    assert.deepEqual(latest.get('alice').own[0].moves.filter(move => move.id !== 'basic').map(move => move.id), submitted.find(body => body.name === 'alice').builds[0].moveIds);
    assert.deepEqual(latest.get('alice').own.map(pet => pet.appearance), appearances.get('alice'), 'live reload preserves the sealed appearance');
    await pages[0].getByRole('button', { name: 'Forfeit the battle', exact: true }).click();
    await pages[0].getByRole('button', { name: 'Yes, concede', exact: true }).click();
    for (const page of pages) await page.getByRole('button', { name: 'Back to squad builder', exact: true }).waitFor();
    const saves = await Promise.all(pages.map((page, index) => page.evaluate(async name => (await (await fetch(`/api/save/${name}`)).json()).character, ['alice', 'bob'][index])));
    assert.ok(saves[0].petRankedRating < 1000 && saves[1].petRankedRating > 1000, 'committed outcome updates both ratings');
    assert.equal(saves[0].petRankedRating + saves[1].petRankedRating, 2000);
    for (const save of saves) {
        assert.deepEqual(save.pets.map(pet => pet.id), ['ranked-0', 'ranked-1', 'ranked-2', 'ranked-3', 'ranked-4']);
        assert.equal(save.pets[0].rankedBuild.item, 'focus-lens');
        assert.deepEqual(save.pets[0].rankedBuild.moveIds, submitted.find(body => body.name === save.name).builds[0].moveIds);
    }
    for (const page of pages) {
        await page.getByRole('button', { name: 'Back to squad builder', exact: true }).click();
        await page.getByRole('heading', { name: /Choose your carried companions/ }).waitFor();
    }
    assert.deepEqual(errors, []);
    await writeFile(resolve(output, 'report.json'), JSON.stringify({ yardSwapsPersist: true, rankedSwapsPersist: true,
        incompleteKitBlocked: true, failedSaveRetry: true, submittedMovesSealed: true, customMovesExecuted: true,
        liveReloadRecovered: true, savedCosmeticsBothSides: true, cosmeticReloadRecovered: true,
        settlementPreservesLoadout: true, returnedToBuilder: true, desktopAndPhone: true,
        compactEditors: true, independentSavedKits: true, themedMoveGlyphs: true, readableTypography: true, errors }, null, 2));
    console.log('Desktop and phone: saved kits, retry, custom attacks, live reload, ranked settlement and return to builder all passed.');
} catch (error) {
    await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: String(error), views: [...latest].map(([seat, view]) => ({ seat,
        phase: view.phase, round: view.round, ready: view.ready, result: view.result, reason: view.reason })), errors }, null, 2));
    for (const [index, page] of pages.entries()) await page.screenshot({ path: resolve(output, `failure-${index}.png`), fullPage: true }).catch(() => {});
    throw error;
} finally { await browser.close(); }
