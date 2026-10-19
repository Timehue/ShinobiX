import { test, expect, type Page } from '@playwright/test';

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
