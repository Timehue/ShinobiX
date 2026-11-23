import assert from 'node:assert/strict';
import { resolveSectorWeather } from '../../../shared/sector-weather.ts';
import { weatherEffects } from '../../src/data/world.ts';

export async function checkWeather({ page, board, sector, world, kind, post, capture, expect }, visitAsOutsider) {
    const hud = page.locator('.coast-sector .sector-hud');
    const sky = hud.locator('.coast-sky');
    const biome = world.sectors[sector].biome;
    const landRow = async () => (await post('/api/coast/land', { action: 'status' })).sectors.find(row => row.sector === sector);
    await expect(board).toBeVisible({ timeout: 90000 });
    async function verify(id, clan) {
        await expect(sky.getByText(weatherEffects[id].name, { exact: true })).toBeVisible();
        await expect(sky.getByText(weatherEffects[id].effect, { exact: true })).toBeVisible();
        if (clan) await expect(sky.getByText('Kept so by ' + clan, { exact: true })).toBeVisible();
        else await expect(sky.getByText(/Kept so by/)).toHaveCount(0);
    }
    async function photo(label) {
        await sky.scrollIntoViewIfNeeded();
        const fits = await sky.evaluate(el => {
            const box = el.getBoundingClientRect(), plate = el.closest('.sector-hud').getBoundingClientRect();
            return box.left >= plate.left && box.right <= plate.right + 1 && box.bottom < innerHeight &&
                document.documentElement.scrollWidth <= innerWidth + 1;
        });
        assert(fits, 'Weather must fit the visible sector HUD');
        await capture(label);
    }
    if (kind === 'visitor') {
        const row = await landRow();
        assert.equal(row.sky.fixed, true);
        await verify(row.sky.weather, row.holder.clan);
        return { fixedBy: row.holder.clan, weather: row.sky.weather };
    }
    if (kind !== 'weather') {
        assert.equal(await landRow(), undefined);
        const id = resolveSectorWeather(biome, sector, Date.now());
        await verify(id);
        await photo('scheduled');
        return { sector, scheduled: id };
    }
    const row = await landRow();
    assert.equal(row.sky.fixed, false);
    await verify(row.sky.weather);
    const names = Object.keys(weatherEffects).filter(id => id !== 'thunderstorm').concat('thunderstorm');
    await hud.getByRole('button', { name: /^Sector info/ }).click();
    const picker = hud.getByRole('combobox', { name: 'Sector weather' });
    for (const id of names) {
        await picker.selectOption(id);
        await verify(id, row.holder.clan);
    }
    await hud.getByRole('button', { name: 'Close Sector Info' }).click();
    await photo('fixed');
    await visitAsOutsider();
    await expect(page.locator('.left-profile-stat').filter({ hasText: /^Weather / })).toHaveCount(0);
    // Simulate a different session lifting the fixed sky while this player is away.
    // The real endpoint allows six officer changes per minute.
    await new Promise(resolve => setTimeout(resolve, 61000));
    await post('/api/coast/land', { action: 'weather', sector, weather: 'scheduled' });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(sky.getByText(/Kept so by/)).toHaveCount(0);
    const restored = await landRow();
    assert.equal(restored.sky.fixed, false);
    await verify(restored.sky.weather);
    return { sector, fixedBy: row.holder.clan, tested: names, restored: restored.sky.weather };
}

