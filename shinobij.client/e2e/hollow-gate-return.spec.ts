import { test, expect, type Page } from '@playwright/test';
import { visiblePageSize } from './helpers/visible-page-size';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isPlayerModel } from '../../shared/player-model-ref';
import { HOLLOW_GATE_STEP_MS } from '../src/features/hollowGate/use-hollow-gate-walk';

test('a default shrine starter loads the selected sprint style without an equipped model', async ({ page }, info) => {
    const pin = JSON.parse(await readFile(resolve('src/data/sector-models/starter-one.json'), 'utf8'));
    const content = resolve(process.env.SECTOR_MODEL_TEST_CONTENT ?? '../.ci-evidence/sector-models', 'starter-one');
    const manifestFile = resolve(content, pin.manifestSha256 + '.json');
    test.skip(!existsSync(manifestFile), 'Mount the local starter art package');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    expect(manifest.styles.C[0]).not.toBe(manifest.styles.A[0]);
    const received = new Set<string>();
    page.on('response', response => { if (response.ok()) received.add(new URL(response.url()).pathname); });
    await page.addInitScript(() => localStorage.setItem('worldSprintStyle.v1', 'C'));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.route('**/api/world/sector-layout', route => route.fulfill({ json: {
        obstaclesEnabled: true, playerGaitsEnabled: true, modelArtBase: '/fixture-art',
    } }));
    await page.route('**/fixture-art/**', async route => {
        const path = new URL(route.request().url()).pathname;
        const file = path.slice('/fixture-art/starter-one/'.length);
        if (!path.startsWith('/fixture-art/starter-one/') || !/^[a-f0-9]{64}\.(json|gz|264|webp)$/.test(file))
            return route.abort();
        return route.fulfill({ body: await readFile(resolve(content, file)) });
    });
    await page.goto('/e2e/fixtures/hollow-gate-consumable.html');
    const avatar = page.locator('.hg-avatar:not(.hg-wanderer)');
    await expect(avatar).toHaveClass(/has-sector-model/);
    await expect(avatar.locator('.sector-model-figure')).toHaveAttribute('data-clip', 'idle');
    await expect.poll(() => received.has('/fixture-art/starter-one/' + manifest.styles.C[0])).toBe(true);
    expect([...received].some(path => path.startsWith('/fixture-art/players/'))).toBe(false);
    await page.screenshot({ path: info.outputPath('shrine-default-style-c.png') });
});

test('an equipped shrine sprite holds its stride through successive tiles and plants when input ends', async ({page}) => {
    const receipt = process.env.SECTOR_MODEL_TEST_ROSTER;
    test.skip(!receipt, 'Mount a fitted player art package and its receipt');
    const model = JSON.parse(await readFile(receipt!, 'utf8')).Zayah;
    if (!isPlayerModel(model)) throw new Error('Expected a fitted Zayah in the mounted roster');
    const content = resolve(process.env.SECTOR_MODEL_TEST_CONTENT ?? '../.ci-evidence/sector-models', 'players', model.assetId);
    await page.route('**/api/world/sector-layout', route => route.fulfill({json:{
        obstaclesEnabled:true, playerGaitsEnabled:true, modelArtBase:'/fixture-art',
    }}));
    await page.route('**/fixture-art/**', async route => {
        const parts = new URL(route.request().url()).pathname.split('/');
        const file = parts.pop()!;
        if (parts.join('/') !== '/fixture-art/players/' + model.assetId || !/^[a-f0-9]{64}\.(json|gz|264|webp)$/.test(file))
            return route.abort();
        return route.fulfill({body:await readFile(resolve(content,file))});
    });
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.goto('/e2e/fixtures/hollow-gate-consumable.html?' + new URLSearchParams(model));
    const sprite = page.locator('.hg-avatar:not(.hg-wanderer) .sector-model-figure');
    await expect(sprite).toHaveAttribute('data-clip', 'idle');
    const direction = page.getByRole('button',{name:'Move right',exact:true});
    const reverse = page.getByRole('button',{name:'Move left',exact:true});
    await page.clock.install({time:new Date('2030-01-01T00:00:00Z')});
    await page.clock.pauseAt(new Date('2030-01-01T00:00:02Z'));
    for (const button of [direction, reverse]) {
        await button.evaluate(el=>el.click());
        await page.clock.runFor(HOLLOW_GATE_STEP_MS);
        await expect(sprite).toHaveAttribute('data-facing',button===direction?'2':'6');
        await page.clock.runFor(1000);
    }
    await sprite.evaluate(el=>{
        const clips = new Set<string>();
        new MutationObserver(()=>{ clips.add((el as HTMLElement).dataset.clip!); el.setAttribute('data-observed',Array.from(clips).join(',')); })
            .observe(el,{attributeFilter:['data-clip']});
    });
    for(let step=0;step<16;step++) {
        await (step%2===0?direction:reverse).evaluate(el=>el.click());
        await page.clock.runFor(HOLLOW_GATE_STEP_MS);
    }
    await expect(sprite).toHaveAttribute('data-observed',/(^|,)run(,|$)/);
    await expect(sprite).not.toHaveAttribute('data-observed',/stop-/);
    await page.clock.runFor(1300);
    await expect(sprite).toHaveAttribute('data-clip','idle');
    await expect(sprite).toHaveAttribute('data-observed',/stop-/);
});

test('a successful fresh entry publishes its counter and intro once, then resumes without another entry', async ({ page }) => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const run = { token: 'fresh-rift-token', seed: 'seal-rift-seed', floorDepth: 3, floor: 1,
        variantId: 'rift-mirror-shard', variantLabel: 'Mirror-Shard Warden', bossName: 'Mirror-Shard Warden',
        chosenAugmentId: null, augmentOffers: [], position: null, keys: 0, torch: 10, threat: 0, wardSteps: 0,
        divinerUsed: false, secondWindArmed: false, resolvedEncounterIds: [], resolvedEventIds: [], visited: null,
        manifest: null, activeCombat: null, pendingAmbush: null, entryCurrencies: {} };
    await page.route('**/api/hollow-gate/**', route => {
        const path = new URL(route.request().url()).pathname, body = route.request().postDataJSON();
        requests.push({ path, body });
        if (path.endsWith('/start')) return route.fulfill({ json: { ok: true, ...run, _saveVersion: 2,
            character: { name: 'PreviewRunner', village: 'Moonshadow Village', hp: 10000, maxHp: 10000, dailyHollowGateRuns: 1,
                lastDailyReset: new Date().toISOString().slice(0, 10), itemStacks: [], hollowGateIntroSeen: false,
                lastHollowGateStart: { token: run.token, requestId: body.requestId } } } });
        if (path.endsWith('/floor-seal')) return route.fulfill({ json: { ok: true, wanderers: [], floorFeatures: [] } });
        if (path.endsWith('/resume')) return route.fulfill({ json: { ok: true, live: true, run } });
        return route.abort();
    });
    await page.goto('/e2e/fixtures/rift-entry-preview.html');
    await page.getByRole('button', { name: 'Preview descent', exact: true }).click();
    await page.getByRole('button', { name: 'Enter', exact: true }).click();
    await expect(page.getByTestId('entry-finished')).toHaveText('1');
    await expect(page.getByTestId('entry-screen')).toHaveText('hollowGateShrine');
    await expect(page.getByTestId('entry-count')).toHaveText('1');
    await expect(page.getByTestId('entry-token')).toHaveText(run.token);
    await expect(page.getByTestId('entry-intro')).toHaveText('0');
    await expect(page.getByTestId('entry-intro-updates')).toHaveText('1');
    expect(requests.map(request => request.path)).toEqual(['/api/hollow-gate/start', '/api/hollow-gate/floor-seal']);
    expect(requests[0].body.requestId).toBeTruthy();
    expect(requests[1].body.token).toBe(run.token);
    await page.getByRole('button', { name: 'Return to map', exact: true }).click();
    await page.getByRole('button', { name: 'Preview descent', exact: true }).click();
    await expect(page.getByTestId('entry-finished')).toHaveText('2');
    await expect(page.getByTestId('entry-screen')).toHaveText('hollowGateShrine');
    await expect(page.getByTestId('entry-count')).toHaveText('1');
    await expect(page.getByTestId('entry-intro-updates')).toHaveText('1');
    expect(requests.map(request => request.path)).toEqual(['/api/hollow-gate/start', '/api/hollow-gate/floor-seal', '/api/hollow-gate/resume']);
});

for (const interruption of ['encounter', 'combat', 'screen', 'account']) test(`rift entry preview cancels on ${interruption} without starting or charging`, async ({ page }, info) => {
    const starts: unknown[] = [];
    await page.route('**/api/hollow-gate/start', route => { starts.push(route.request().postDataJSON()); return route.fulfill({ status: 503, json: { error: 'Test server unavailable' } }); });
    await page.goto('/e2e/fixtures/rift-entry-preview.html');
    await page.getByRole('button', { name: 'Preview descent', exact: true }).click();
    const preview = page.getByRole('alertdialog', { name: 'Mirror-Shard Warden' });
    await expect(preview).toContainText('Entry is free for this event.');
    await page.evaluate(kind => (window as unknown as { interruptPreview: (kind: string) => void }).interruptPreview(kind), interruption);
    await expect(preview).toHaveCount(0);
    await expect(page.getByTestId('entry-finished')).toHaveText('1');
    await expect(page.getByTestId('entry-count')).toHaveText('0');
    if (interruption === 'encounter') {
        await page.getByRole('button', { name: 'Fight', exact: true }).click();
        await expect(page.getByRole('region', { name: 'Active combat' })).toBeVisible();
        await expect(page.getByRole('alertdialog')).toHaveCount(0);
        await page.screenshot({ path: info.outputPath('combat-without-rift-preview.png'), fullPage: true });
    }
    expect(starts).toEqual([]);
});

test('cancelled rift preview stays cancelled; a fresh explicit Enter sends exactly one start', async ({ page }) => {
    let starts = 0;
    await page.route('**/api/hollow-gate/start', route => { starts++; return route.fulfill({ status: 503, json: { error: 'Test server unavailable' } }); });
    await page.goto('/e2e/fixtures/rift-entry-preview.html');
    await page.getByRole('button', { name: 'Preview descent', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByTestId('entry-finished')).toHaveText('1'); expect(starts).toBe(0);
    await page.getByRole('button', { name: 'Preview descent', exact: true }).click();
    await page.getByRole('button', { name: 'Enter', exact: true }).click();
    await expect(page.getByTestId('entry-finished')).toHaveText('2'); expect(starts).toBe(1);
});

for (const resolution of ['confirm', 'escape']) test(`an interrupted rift button cannot accept an unrelated queued prompt before ${resolution}`, async ({ page }) => {
    await page.goto('/e2e/fixtures/rift-entry-preview.html');
    await page.getByRole('button', { name: 'Preview descent', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Enter', exact: true })).toBeVisible();
    await page.evaluate(() => {
        const oldEnter = document.querySelector<HTMLButtonElement>('.game-alert-ok')!;
        const fixture = window as unknown as { queueOtherPrompt: () => void; interruptPreview: (kind: string) => void };
        fixture.queueOtherPrompt(); fixture.interruptPreview('encounter'); oldEnter.click();
    });
    const other = page.getByRole('alertdialog', { name: 'Other action' });
    await expect(other).toBeVisible();
    await expect(page.getByTestId('other-confirmed')).toHaveText('false');
    if (resolution === 'escape') await page.keyboard.press('Escape');
    else await other.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(other).toHaveCount(0);
    await expect(page.getByTestId('other-confirmed')).toHaveText(String(resolution === 'confirm'));
});

for (const interruption of ['combat', 'account']) test(`an accepted rift start interrupted by ${interruption} preserves only its owning account receipt`, async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let starts = 0;
    await page.route('**/api/hollow-gate/start', async route => {
        starts++; await held;
        await route.fulfill({ json: { ok: true, token: 'accepted-rift-token', seed: 'accepted-rift-seed', _saveVersion: 2,
            character: { name: 'PreviewRunner', hp: 10000, maxHp: 10000, dailyHollowGateRuns: 1,
                lastHollowGateStart: { token: 'accepted-rift-token', requestId: 'accepted-rift-request' } } } });
    });
    await page.goto('/e2e/fixtures/rift-entry-preview.html');
    await page.getByRole('button', { name: 'Preview descent', exact: true }).click();
    await page.getByRole('button', { name: 'Enter', exact: true }).click();
    await expect.poll(() => starts).toBe(1);
    await page.evaluate(kind => (window as unknown as { interruptPreview: (kind: string) => void }).interruptPreview(kind), interruption);
    release();
    await expect(page.getByTestId('entry-finished')).toHaveText('1');
    await expect(page.getByTestId('entry-screen')).toHaveText('worldMap');
    await expect(page.getByTestId('entry-token')).toHaveText(interruption === 'combat' ? 'accepted-rift-token' : 'none');
    await expect(page.getByTestId('entry-count')).toHaveText(interruption === 'combat' ? '1' : '0');
    if (interruption === 'combat') await expect(page.getByRole('region', { name: 'Active combat' })).toBeVisible();
    expect(starts).toBe(1);
});

test('a delayed floor seal cannot replace combat and the accepted run stays recoverable', async ({ page }) => {
    let release!: () => void, seals = 0, starts = 0;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/hollow-gate/start', route => {
        starts++;
        return route.fulfill({ json: { ok: true, token: 'seal-rift-token', seed: 'seal-rift-seed', floorDepth: 3, _saveVersion: 2,
            character: { name: 'PreviewRunner', hp: 10000, maxHp: 10000, dailyHollowGateRuns: 1,
                lastHollowGateStart: { token: 'seal-rift-token', requestId: 'seal-rift-request' } } } });
    });
    await page.route('**/api/hollow-gate/floor-seal', async route => { seals++; await held; await route.fulfill({ json: { ok: true } }); });
    await page.goto('/e2e/fixtures/rift-entry-preview.html');
    await page.getByRole('button', { name: 'Preview descent', exact: true }).click();
    await page.getByRole('button', { name: 'Enter', exact: true }).click();
    await expect.poll(() => seals).toBe(1);
    await page.evaluate(() => (window as unknown as { interruptPreview: (kind: string) => void }).interruptPreview('combat'));
    release();
    await expect(page.getByTestId('entry-finished')).toHaveText('1');
    await expect(page.getByTestId('entry-screen')).toHaveText('worldMap');
    await expect(page.getByRole('region', { name: 'Active combat' })).toBeVisible();
    await expect(page.getByTestId('entry-token')).toHaveText('seal-rift-token');
    await expect(page.getByTestId('entry-count')).toHaveText('1');
    expect(starts).toBe(1); expect(seals).toBe(1);
});

for (const source of ['resume', 'marker']) test(`a delayed ${source} recovery cannot replace a new combat scene`, async ({ page }) => {
    let release!: () => void, resumes = 0, starts = 0;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/hollow-gate/start', route => { starts++; return route.abort(); });
    await page.route('**/api/hollow-gate/resume', async route => {
        resumes++; await held;
        await route.fulfill({ json: { ok: true, live: true, run: { token: 'resume-rift-token', seed: 'resume-rift-seed', floorDepth: 3, floor: 1,
            chosenAugmentId: null, augmentOffers: [], position: null, keys: 0, torch: 10, threat: 0, wardSteps: 0, divinerUsed: false,
            secondWindArmed: false, resolvedEncounterIds: [], resolvedEventIds: [], visited: null, manifest: null,
            activeCombat: null, pendingAmbush: null, entryCurrencies: {} } } });
    });
    await page.goto(`/e2e/fixtures/rift-entry-preview.html?${source}=1`);
    await page.getByRole('button', { name: 'Preview descent', exact: true }).click();
    await expect.poll(() => resumes).toBe(1);
    await page.evaluate(() => (window as unknown as { interruptPreview: (kind: string) => void }).interruptPreview('combat'));
    release();
    await expect(page.getByTestId('entry-finished')).toHaveText('1');
    await expect(page.getByTestId('entry-screen')).toHaveText('worldMap');
    await expect(page.getByRole('region', { name: 'Active combat' })).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByTestId('entry-token')).toHaveText('resume-rift-token');
    expect(starts).toBe(0);
});

test('Warden decision shows its sealed cue and round-cap warning without horizontal overflow', async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/solo-pve/state**', async route => route.fulfill({ json: { ok: true,
        session: await page.evaluate(() => (window as unknown as { wardenQaSession: unknown }).wardenQaSession) } }));
    await page.goto('/e2e/fixtures/hollow-gate-warden.html');
    const warning = page.getByRole('status').filter({ hasText: 'Round 18/40' });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('23 rounds left');
    const instruction = page.getByText('Stand inside the violet ward column before Mirror-Shard Warden acts.', { exact: true });
    await expect(instruction).toBeVisible();
    for (const rule of [warning, instruction]) {
        const bounds = await rule.boundingBox(); expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual((await visiblePageSize(page)).width + 1);
    }
    await page.screenshot({ path: info.outputPath('warden-round-warning.png'), fullPage: true });
    expect(errors).toEqual([]);
});

test('Warden cap result explains the terminal reason and names the actual opponent', async ({ page }, info) => {
    await page.goto('/e2e/fixtures/hollow-gate-warden.html?cap=1');
    const result = page.getByRole('dialog', { name: 'Hollow Gate combat result' });
    await expect(result).toContainText('The 40-round limit expired before Mirror-Shard Warden was defeated. This dive has ended.');
    await expect(result).not.toContainText('Hollow Hound');
    await page.screenshot({ path: info.outputPath('warden-cap-result.png'), fullPage: true });
    await result.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-resolved', 'yes');
});

test('a historical terminal 25-round result is not reopened or relabeled as 40', async ({ page }) => {
    await page.goto('/e2e/fixtures/hollow-gate-warden.html?cap=1&legacy=1');
    const result = page.getByRole('dialog', { name: 'Hollow Gate combat result' });
    await expect(result).toContainText('The 25-round limit expired before Mirror-Shard Warden was defeated.');
    await expect(result).not.toContainText('40-round');
});

test('a replayed legacy receipt keeps 25 even when the initial fight prop was active', async ({ page }) => {
    await page.route('**/api/solo-pve/state**', async route => route.fulfill({ json: { ok: true,
        session: await page.evaluate(() => ({ ...(window as unknown as { wardenQaSession: object }).wardenQaSession,
            version: 2, status: 'done', outcome: 'loss', winner: 'enemy', terminalReason: 'round-limit', round: 26, hollowGateRoundLimit: 25 })) } }));
    await page.goto('/e2e/fixtures/hollow-gate-warden.html?legacyReceipt=1');
    const result = page.getByRole('dialog', { name: 'Hollow Gate combat result' });
    await expect(result).toContainText('The 25-round limit expired before Mirror-Shard Warden was defeated.');
    await expect(result).not.toContainText('40-round');
});

async function install(page: Page, outcome: 'win' | 'loss' | 'ended', failFirst = false, active = false) {
    let settlements = 0;
    await page.route('**/api/card-clash/ai-move', route => route.fulfill({ json: { ok: true, session: {
        matchId: 'return-match', rulesVersion: 10, turnNumber: 31, firstPlayer: 'p1', activePlayer: 'p1', phase: 'main1',
        normalSummonUsed: false, status: active ? 'active' : 'complete', winner: active ? null : outcome === 'win' ? 'p1' : 'p2', viewerSide: 'p1',
        activeField: null, responseWindow: null, log: ['The Chronicle showdown is sealed.'], events: [], turnStartedAt: Date.now(),
        p1: { name: 'ReturnDiver', lifePoints: active || outcome === 'win' ? 8000 : 0, deckCount: 10, handCount: 0, hand: [], monsterZones: [null, null, null, null, null], magicTrapZones: [null, null, null, null, null], graveyard: [] },
        p2: { name: 'The Chronicle Keeper', lifePoints: outcome === 'win' ? 0 : 8000, deckCount: 10, handCount: 0, monsterZones: [null, null, null, null, null], magicTrapZones: [null, null, null, null, null], graveyard: [] },
    } } }));
    await page.route('**/api/hollow-gate/card-settle', async route => {
        settlements++;
        if (failFirst && settlements === 1) return route.fulfill({ status: 503, json: { error: 'Result still sealing; retry Continue.' } });
        return route.fulfill({ json: { ok: true, won: outcome === 'win', ended: outcome === 'ended', alreadyReported: settlements > 1,
            character: { name: 'ReturnDiver', hp: outcome === 'ended' ? 0 : outcome === 'loss' ? 1 : 100, maxHp: 10000,
                hospitalized: outcome === 'ended', hollowGateRun: outcome === 'ended' ? null : { runToken: 'return-qa', threat: 0 } },
            _saveVersion: 4, reward: { ryo: outcome === 'win' ? 12 : 0, auraDust: 0 },
        } });
    });
    await page.goto('/e2e/fixtures/hollow-gate-return.html');
    return () => settlements;
}

for (const outcome of ['win', 'loss', 'ended'] as const) test(`Continue returns a terminal ${outcome} to its authoritative destination`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const count = await install(page, outcome);
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`terminal-${outcome}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByTestId('returned-screen')).toHaveText(outcome === 'ended' ? 'hospital' : 'hollowGateShrine');
    await expect(page.getByTestId('returned-hp')).toHaveText(outcome === 'ended' ? '0' : outcome === 'loss' ? '1' : '100');
    await expect(page.getByTestId('board-tiles')).toHaveText(outcome === 'ended' ? '0' : '9');
    expect(count()).toBe(1);
    expect(errors).toEqual([]);
});

test('Leave Showdown retries a terminal failed Continue instead of opening a sealed-match loop', async ({ page }) => {
    const count = await install(page, 'loss', true);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText('Result still sealing; retry Continue.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Leave Showdown', exact: true }).click();
    await expect(page.getByTestId('returned-screen')).toHaveText('hollowGateShrine');
    await expect(page.getByTestId('returned-hp')).toHaveText('1');
    await expect(page.getByText('Chronicle Ambush Sealed', { exact: true })).toHaveCount(0);
    expect(count()).toBe(2);
});

test('an unfinished Leave preserves Resume and performs no settlement', async ({ page }) => {
    const count = await install(page, 'loss', false, true);
    await page.getByRole('button', { name: 'Leave encounter', exact: true }).click();
    await expect(page.getByText('Chronicle Ambush Sealed', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resume Showdown', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Leave encounter', exact: true })).toBeVisible();
    expect(count()).toBe(0);
});

for (const mode of ['PvE', 'pet']) for (const timing of ['during', 'after']) {
    test(`paid Eye survives a ${mode} combat unmount when its reply arrives ${timing} the fight`, async ({ page }) => {
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        const requests: Record<string, unknown>[] = [];
        await page.route('**/api/hollow-gate/use-consumable', async route => {
            requests.push(route.request().postDataJSON());
            await held;
            await route.fulfill({ json: { ok: true, _saveVersion: 2,
                character: { name: 'RelicDiver', hp: 100, maxHp: 100, pets: [], inventory: [], hollowShards: 75 },
                runState: { keys: 0, torch: 10, threat: 0, wardSteps: 0, divinerUsed: true, secondWindArmed: false } } });
        });
        await page.goto('/e2e/fixtures/hollow-gate-consumable.html');
        const state = async () => JSON.parse((await page.getByTestId('relic-state').textContent())!);
        const before = await state();
        await page.getByText('Hollow Shard relics & event log', { exact: true }).click();
        await page.getByRole('button', { name: /Diviner's Eye/ }).click();
        await expect.poll(() => requests.length).toBe(1);
        await page.getByRole('button', { name: `Enter ${mode} fight`, exact: true }).click();
        await expect(page.getByRole('region', { name: 'Active combat' })).toBeVisible();
        await expect(page.getByRole('button', { name: /Diviner's Eye/ })).toHaveCount(0);
        if (timing === 'after') await page.getByRole('button', { name: 'Win and return', exact: true }).click();
        release();
        await expect.poll(async () => (await state()).receipts).toBe(1);
        if (timing === 'during') await page.getByRole('button', { name: 'Win and return', exact: true }).click();
        await page.getByText('Hollow Shard relics & event log', { exact: true }).click();
        const eye = page.getByRole('button', { name: /Diviner's Eye/ });
        await expect(eye).toBeVisible();
        await expect(eye).toBeDisabled();
        const after = await state();
        expect(after.run.diviner).toBe(true);
        expect(after.sight).toBeGreaterThan(before.sight);
        expect(after.run.runToken).toBe(before.run.runToken);
        expect(after.run.floor).toBe(before.run.floor);
        expect(after.run.activeCombat).toBeUndefined();
        expect(after.character.hollowShards).toBe(75);
        expect(after.receipts).toBe(1);
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ playerName: 'RelicDiver', token: 'paid-eye-run', action: 'diviner-eye' });
        expect(requests[0].requestId).toBeTruthy();
    });
}
