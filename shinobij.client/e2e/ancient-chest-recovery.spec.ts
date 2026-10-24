import { expect, test, type Page } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

async function restoreWorldMap(page: Page) {
    await page.reload({ waitUntil: 'commit', timeout: 20_000 });
    // Readiness is the restored game view, including either supported map mode;
    // a route-name shell or a browser lifecycle event does not prove it is ready.
    await expect(page.locator('.app-shell[data-screen="worldMap"] :is(.sector-hud-region, .world-atlas-card):visible').first()).toBeVisible({ timeout: 20_000 });
}

async function expectChestActionClear(page: Page) {
    const action = page.locator('.chest-claim-btn');
    await expect.poll(() => action.evaluate(button => {
        const box = button.getBoundingClientRect();
        return [[box.left + 8, box.top + 8], [box.right - 8, box.top + 8],
            [box.left + 8, box.bottom - 8], [box.right - 8, box.bottom - 8]].map(([x, y]) => {
                const hit = document.elementFromPoint(x, y);
                return hit === button || button.contains(hit);
            });
    }), { message: 'Every chest action corner must receive input' }).toEqual([true, true, true, true]);
}

async function expectWallet(page: Page, ryo: number, dust: number) {
    // Use the game navigation after recovery so bootstrap navigation cannot
    // interrupt a second document load or leave the Profile chunk loading.
    const profile = page.locator('button[title="View character profile"]:visible');
    const you = page.locator('.mobile-bottom-nav').getByRole('button', { name: 'You', exact: true });
    await expect.poll(async () => await profile.isVisible() || await you.isVisible()).toBe(true);
    if (await you.isVisible()) {
        await you.click();
        await page.getByRole('dialog', { name: 'Your shinobi' }).getByTitle('View character profile').click();
    } else await profile.click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'profile');
    const rows = page.locator('.profile-dossier-row');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    await expect(rows.filter({ has: page.getByText('Ryo', { exact: true }) }).locator('strong')).toHaveText(ryo.toLocaleString('en-US'));
    await expect(rows.filter({ has: page.getByText('Aura Dust', { exact: true }) }).locator('strong')).toHaveText(dust.toLocaleString('en-US'));
}

for (const replayed of [false, true]) {
    for (const skip of [false, true]) {
        test(`${replayed ? 'paid replay' : 'fresh chest'} stays honest after ${skip ? 'Skip' : 'normal story completion'}`, async ({ page }, info) => {
            // The failed WebKit trace reached the reveal at 82 seconds after
            // normal playback. Budget that phase separately from two cold views;
            // reload and wallet readiness remain bounded to 30 seconds each.
            test.setTimeout(skip ? 90_000 : 150_000);
            const initial = uiAuditSave();
            initial.currentSector = 1;
            initial.currentBiome = 'forest';
            initial.character = { ...initial.character, level: 1, ryo: 75_062, auraDust: 105 };
            const runtime = await installUiAuditRuntime(page, initial);
            await page.addInitScript(() => {
                localStorage.setItem('vnReaderMode.v1', 'cinematic');
                localStorage.setItem('vnTextSpeed.v1', 'instant');
                localStorage.setItem('vnAutoRead.v1', '0');
                if (!sessionStorage.getItem('chestRecoveryFixture.seeded')) {
                    localStorage.setItem('worldRewardRecovery.v1:auditninja', JSON.stringify([{
                        id: 'chestoperation001', playerName: 'AuditNinja', kind: 'chest', sector: 1,
                        worldExploreRequestId: 'chestdiscovery001', createdAt: Date.now(),
                    }]));
                    sessionStorage.setItem('chestRecoveryFixture.seeded', '1');
                }
            });
            const requests: Array<{ requestId: string; worldExploreRequestId: string }> = [];
            const ryo = replayed ? 75_062 : 75_407, auraDust = replayed ? 105 : 115;
            let currentRyo = 75_062;
            await page.route('**/api/player/daily-login', route => route.fulfill({ json: {
                ok: true, alreadyClaimed: true, granted: { ryo: 0, fateShards: 0 },
                balances: { ryo: currentRyo, fateShards: initial.character!.fateShards },
            } }));
            await page.route('**/api/world/open-chest', async route => {
                requests.push(route.request().postDataJSON());
                currentRyo = ryo;
                const character = { ...initial.character, ryo, auraDust };
                const version = runtime.currentVersion() + 1;
                runtime.commitServerCharacter(character, version);
                await route.fulfill({ json: { ok: true, replayed, character, _saveVersion: version,
                    loot: { xp: 0, ryo: 345, itemId: 'rustfang-kunai', auraDust: 10 } } });
            });
            const reader = page.locator('.cvn-root, .visual-novel.admin-vn-play, .vn-finale-panel');
            const reveal = page.locator('.chest-reveal');
            await test.step('Play and inspect the chest receipt', async () => {
                await page.goto('/#/worldMap', { waitUntil: 'domcontentloaded' });
                await expect(reader).toBeVisible({ timeout: 30_000 });
                if (skip) await reader.getByRole('button', { name: /^Skip$|Skip visual novel scene/ }).click();
                else {
                    for (let line = 0; line < 15 && await reader.count(); line++) {
                        const open = reader.getByRole('button', { name: 'Open chest', exact: true });
                        if (await open.isVisible()) { await open.click(); break; }
                        const next = reader.locator('.vn-controls').getByRole('button', { name: /^(Next|Continue)$/ });
                        await expect(next).toBeVisible();
                        const before = await reader.innerText();
                        await next.click();
                        await expect.poll(async () => await reader.count() ? reader.innerText() : '').not.toBe(before);
                    }
                }
                await expect(reveal.getByRole('heading', { name: replayed ? 'Previously saved chest' : 'Rewards saved' })).toBeVisible();
                await expect(reveal.locator('.chest-reward-row strong').filter({ hasText: /345 Ryo/ })).toHaveText(`${replayed ? '' : '+'}345 Ryo`);
                await expect(reveal.locator('.chest-reward-row strong').filter({ hasText: /10 Aura Dust/ })).toHaveText(`${replayed ? '' : '+'}10 Aura Dust`);
                await expect(reveal).toContainText('Rustfang Kunai');
                await expect(reveal.getByRole('button', { name: 'Claim All Rewards' })).toHaveCount(0);
                await expect(reveal.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
                await expectChestActionClear(page);
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
                await page.screenshot({ path: info.outputPath('chest-reveal.png'), fullPage: true });
            }, { timeout: skip ? 30_000 : 90_000 });
            await test.step('Dismiss and restore the saved map', async () => {
                const action = reveal.getByRole('button', { name: 'Continue', exact: true });
                const box = await action.boundingBox();
                expect(box).not.toBeNull();
                await action.click({ position: { x: box!.width - 8, y: box!.height - 8 } });
                await expect(reveal).toHaveCount(0);
                expect(requests).toEqual([{ playerName: 'AuditNinja', sector: 1, requestId: 'chestoperation001', worldExploreRequestId: 'chestdiscovery001' }]);
                await expect.poll(async () => page.evaluate(() => localStorage.getItem('worldRewardRecovery.v1:auditninja'))).toBeNull();
                await restoreWorldMap(page);
                await expect(reveal).toHaveCount(0);
                expect(requests, 'Continue and reload must not collect the same chest again').toHaveLength(1);
                await expect(page.getByRole('button', { name: 'Review World Map tip' })).toBeVisible();
            }, { timeout: 30_000 });
            await test.step('Verify the saved wallet', () => expectWallet(page, ryo, auraDust), { timeout: 30_000 });
        });
    }
}

test('a duplicate gear roll shows the sale value the server paid for it', async ({ page }) => {
    // Economy rebalance 2026-10 (#38): gear already in the backpack is sold for
    // its NPC value instead of vanishing. The reveal must say so, inside the
    // ryo line it already counts, without overflowing a phone screen.
    test.setTimeout(90_000);
    const initial = uiAuditSave();
    initial.currentSector = 1;
    // The fixture backpack already holds a Rustfang Kunai.
    initial.character = { ...initial.character, level: 1, ryo: 75_062, auraDust: 105 };
    const runtime = await installUiAuditRuntime(page, initial);
    await page.addInitScript(() => {
        localStorage.setItem('vnTextSpeed.v1', 'instant');
        if (!sessionStorage.getItem('chestRecoveryFixture.seeded')) {
            localStorage.setItem('worldRewardRecovery.v1:auditninja', JSON.stringify([{
                id: 'duplicatechest001', playerName: 'AuditNinja', kind: 'chest', sector: 1,
                worldExploreRequestId: 'duplicatediscovery001', createdAt: Date.now(),
            }]));
            sessionStorage.setItem('chestRecoveryFixture.seeded', '1');
        }
    });
    await page.route('**/api/player/daily-login', route => route.fulfill({ json: {
        ok: true, alreadyClaimed: true, granted: { ryo: 0, fateShards: 0 },
        balances: { ryo: 75_519, fateShards: initial.character!.fateShards },
    } }));
    await page.route('**/api/world/open-chest', async route => {
        const character = { ...initial.character, ryo: 75_519, auraDust: 115 };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(character, version);
        await route.fulfill({ json: { ok: true, replayed: false, character, _saveVersion: version,
            loot: { xp: 0, ryo: 457, itemId: 'rustfang-kunai', duplicateSaleRyo: 112, auraDust: 10 } } });
    });
    await page.goto('/#/worldMap', { waitUntil: 'domcontentloaded' });
    await page.locator('.cvn-skip, .vn-skip-button').click();
    const reveal = page.locator('.chest-reveal');
    await expect(reveal.getByRole('heading', { name: 'Rewards saved' })).toBeVisible({ timeout: 30_000 });
    await expect(reveal.locator('.chest-reward-row strong').filter({ hasText: /457 Ryo/ })).toHaveText('+457 Ryo');
    const kunai = reveal.locator('.chest-reward-row').filter({ hasText: 'Rustfang Kunai' });
    await expect(kunai).toContainText('Already owned: sold for 112 Ryo, counted above');
    await expectChestActionClear(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('repeated lost chest ACKs recover one paid receipt and disclose its replay', async ({ page }) => {
    test.setTimeout(90_000);
    const initial = uiAuditSave();
    initial.currentSector = 1;
    initial.character = { ...initial.character, level: 1, ryo: 75_062, auraDust: 105 };
    const runtime = await installUiAuditRuntime(page, initial);
    await page.addInitScript(() => {
        localStorage.setItem('vnTextSpeed.v1', 'instant');
        if (!sessionStorage.getItem('chestRecoveryFixture.seeded')) {
            localStorage.setItem('worldRewardRecovery.v1:auditninja', JSON.stringify([{
                id: 'interruptedchest001', playerName: 'AuditNinja', kind: 'chest', sector: 1,
                worldExploreRequestId: 'interrupteddiscovery001', createdAt: Date.now(),
            }]));
            sessionStorage.setItem('chestRecoveryFixture.seeded', '1');
        }
    });
    const requests: unknown[] = [];
    let currentRyo = 75_062;
    await page.route('**/api/player/daily-login', route => route.fulfill({ json: {
        ok: true, alreadyClaimed: true, granted: { ryo: 0, fateShards: 0 },
        balances: { ryo: currentRyo, fateShards: initial.character!.fateShards },
    } }));
    await page.route('**/api/world/open-chest', async route => {
        requests.push(route.request().postDataJSON());
        const character = { ...initial.character, ryo: 75_407, auraDust: 115 };
        if (requests.length === 1) {
            currentRyo = 75_407;
            runtime.commitServerCharacter(character, runtime.currentVersion() + 1);
        }
        if (requests.length <= 2) { await route.abort(); return; }
        await route.fulfill({ json: { ok: true, replayed: true, character, _saveVersion: runtime.currentVersion(),
            loot: { xp: 0, ryo: 345, itemId: 'rustfang-kunai', auraDust: 10 } } });
    });
    await page.goto('/#/worldMap', { waitUntil: 'domcontentloaded' });
    await page.locator('.cvn-skip, .vn-skip-button').click();
    await expect(page.getByRole('heading', { name: 'Previously saved chest' })).toBeVisible();
    expect(requests).toHaveLength(3);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[2]).toEqual(requests[0]);
    await page.locator('.chest-reveal').getByRole('button', { name: 'Continue', exact: true }).click();
    await test.step('Restore the saved map', () => restoreWorldMap(page), { timeout: 30_000 });
    expect(requests).toHaveLength(3);
    await test.step('Verify the saved wallet', () => expectWallet(page, 75_407, 115), { timeout: 30_000 });
});
