import { expect, test } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { quietRoadCooldowns } from '../e2e-live/helpers/quiet-road';

test('sector sleepers load independently of the directory and refresh through AFK, reconnect and KO', async ({ page }) => {
    test.setTimeout(90_000);
    const save = uiAuditSave();
    save.currentSector = 22;
    save.character = { ...save.character, wandererCooldowns: quietRoadCooldowns([22]) };
    await installUiAuditRuntime(page, save);
    let asleep = true;
    let online = false;
    let reads = 0;
    let strikes = 0;
    const peer = { name: 'Shadow Fox', level: 46, village: 'Ashen Leaf Village', specialty: 'Ninjutsu',
        currentSector: 22, tile: 78, movementSequence: 37, character: { name: 'Shadow Fox', avatarImage: '' } };
    // A slow/unavailable global directory must not delay camp discovery.
    await page.route('**/api/player/roster', route => route.fulfill({ status: 503, json: {} }));
    await page.route('**/api/player/roster?sector=*', route => {
        reads++;
        return route.fulfill({ json: { sector: 22, sleepers: asleep ? [{ ...peer, sleeping: true }] : [] } });
    });
    await page.route('**/api/player/heartbeat', route => route.fulfill({ json: {
        ok: true, sector: 22, sectorMates: online ? [peer] : [],
    } }));
    await page.route('**/api/player/sleeper-kill', route => {
        expect(route.request().postDataJSON()).toMatchObject({ targetName: 'Shadow Fox', attackerName: 'AuditNinja' });
        strikes++;
        // Leave the read fixture stale to prove a successful KO cannot reappear.
        return route.fulfill({ json: { ok: true } });
    });
    await page.addInitScript(() => localStorage.setItem('legacyRumors.seen.v1:auditninja', JSON.stringify([10, 20, 30, 40, 45])));
    await page.goto('/#/worldMap');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'worldMap', { timeout: 60_000 });
    const returnButton = page.getByRole('button', { name: 'Return to Sector 22', exact: false });
    await expect.poll(async () => await returnButton.isVisible() || await page.locator('.sector-image-map').isVisible(), { timeout: 60_000 }).toBe(true);
    if (await returnButton.isVisible()) await returnButton.click();
    const roster = page.getByRole('list', { name: 'Sector players' });
    const strike = roster.getByRole('button', { name: /Strike.*Shadow Fox/ });
    await expect(strike).toBeVisible();
    const marker = page.locator('.continuous-world-peer').filter({ hasText: 'Shadow Fox' });
    await expect(marker).toHaveAttribute('title', 'Shadow Fox (Lv 46) — Sleeping');
    const position = () => marker.evaluate(node => {
        const el = node as HTMLElement, width = el.closest<HTMLElement>('.continuous-world-chunk')?.clientWidth ?? 0;
        if (!width || !el.style.transform) return null;
        const matrix = new DOMMatrix(getComputedStyle(el).transform);
        const x = (matrix.m41 + el.offsetWidth / 2) / width * 12;
        const y = (matrix.m42 + el.offsetHeight) / width * 12;
        return x > 0 && y > 0 ? [Math.round(x * 1000), Math.round(y * 1000)] : null;
    });
    await expect.poll(position).not.toBeNull();
    const campPosition = await position();
    expect(reads).toBeGreaterThan(0);
    asleep = false; online = true;
    await expect(strike).toHaveCount(0, { timeout: 15_000 });
    await expect(roster.getByRole('button', { name: 'Attack Shadow Fox', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => {
        const livePosition = await position();
        return livePosition !== null && JSON.stringify(livePosition) !== JSON.stringify(campPosition);
    }).toBe(true);
    asleep = true; online = false;
    await expect(strike).toBeVisible({ timeout: 30_000 });
    await expect(marker).toHaveAttribute('title', 'Shadow Fox (Lv 46) — Sleeping');
    await expect.poll(position).toEqual(campPosition);
    await strike.click();
    expect(strikes).toBe(0);
    await page.getByRole('button', { name: 'Strike', exact: true }).click();
    await expect.poll(() => strikes).toBe(1);
    await expect(strike).toHaveCount(0);
    await expect(marker).toHaveCount(0);
    const readsAfterKo = reads;
    await expect.poll(() => reads, { timeout: 15_000 }).toBeGreaterThan(readsAfterKo);
    await expect(strike).toHaveCount(0);
    await expect(marker).toHaveCount(0);
});
