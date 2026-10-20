import { test, expect, type Page } from '@playwright/test';

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
        expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
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
