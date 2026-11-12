import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const content = resolve(process.env.SECTOR_MODEL_TEST_CONTENT ?? '../.ci-evidence/sector-models');
async function openNpc(page: Page, role: string, reduced = false) {
    const errors: string[] = [], requests = new Set<string>();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.ok()) requests.add(new URL(response.url()).pathname); });
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await page.route('**/api/world/sector-layout', route => route.fulfill({ json: {
        obstaclesEnabled: true, playerGaitsEnabled: true, modelArtBase: '/fixture-art',
    } }));
    await page.route('**/fixture-art/**', async route => {
        const file = new URL(route.request().url()).pathname.slice('/fixture-art/'.length);
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-f0-9]{64}\.(json|gz|264|webp)$/.test(file)) return route.abort();
        return route.fulfill({ body: await readFile(resolve(content, file)) });
    });
    await page.goto('/e2e/fixtures/hollow-gate-consumable.html?' + new URLSearchParams({ modelNpc: role }));
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(reduced);
    return { errors, requests };
}

for (const [role, name, kind] of [
    ['medic', 'Wandering Medic', 'underground-medic'], ['wayfarer', 'Relic Wayfarer', 'underground-wayfarer'],
    ['bandit', 'Cavern Bandit', 'underground-bandit'], ['night-ninja', 'Night Ninja', 'underground-night-ninja'],
    ['patrol', 'Stormveil Patrol', 'underground-patrol'], ['keeper', 'Shrine Keeper', 'underground-medic'],
]) test(`${name} keeps its fitted body and selection in the real shrine`, async ({ page }, info) => {
    const { errors, requests } = await openNpc(page, role);
    const actor = page.getByRole('button', { name: new RegExp('^' + name + ',') });
    const sprite = actor.locator('.sector-model-figure');
    await expect(actor).toHaveClass(/has-sector-model/);
    await expect(sprite).toHaveCSS('background-image', /blob:/);
    const pin = JSON.parse(await readFile(resolve('src/data/sector-models', kind + '.json'), 'utf8'));
    expect(requests.has('/fixture-art/' + kind + '/' + pin.manifestSha256 + '.json')).toBe(true);
    if (role !== 'keeper') {
        await sprite.evaluate(element => {
            const observations: Array<{ frame?: string; gait?: string; facing?: string }> = [];
            new MutationObserver(() => {
                const data = (element as HTMLElement).dataset;
                observations.push({ frame: data.frame, gait: data.gait, facing: data.facing });
                element.setAttribute('data-observed', JSON.stringify(observations));
            }).observe(element, { attributeFilter: ['data-frame', 'data-gait', 'data-facing'] });
        });
        for (let step = 0; step < 8; step++) {
            await page.getByRole('button', { name: 'Advance NPC fixture', exact: true }).evaluate(element => element.click());
            await page.waitForTimeout(260);
        }
        await expect(sprite).toHaveAttribute('data-clip', 'idle');
        const observations = JSON.parse(await sprite.getAttribute('data-observed') || '[]') as Array<{ frame: string; gait: string; facing: string }>;
        const moving = observations.filter(sample => sample.gait !== 'idle');
        expect(new Set(moving.map(sample => sample.frame)).size).toBeGreaterThanOrEqual(3);
        expect(new Set(moving.map(sample => sample.facing))).toEqual(new Set(['2', '6']));
        await writeFile(info.outputPath('shrine-movement.json'), JSON.stringify(observations));
    }
    const geometry = await actor.evaluate(element => {
        const actor = element as HTMLElement, sprite = actor.querySelector<HTMLElement>('.sector-model-figure')!;
        return { actor: actor.getBoundingClientRect().toJSON(), sprite: sprite.getBoundingClientRect().toJSON(),
            height: Number.parseFloat(getComputedStyle(actor).getPropertyValue('--sector-model-height')) };
    });
    expect(geometry.height).toBeGreaterThan(20);
    expect(geometry.sprite.top).toBeLessThan(geometry.actor.bottom);
    await writeFile(info.outputPath('shrine-actor.json'), JSON.stringify({ role, kind, revision: pin.manifestSha256, geometry }));
    await page.screenshot({ path: info.outputPath('shrine-npc.png') });
    await actor.focus(); await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => document.body.dataset.npcPicked)).toBe('25');
    expect(errors).toEqual([]);
});

for (const reduced of [false, true]) test(`Hollow Hound encounter uses its ${reduced ? 'still' : 'animated'} reviewed art`, async ({ page }, info) => {
    const art = JSON.parse(await readFile(resolve('src/data/hollow-hound-encounter.json'), 'utf8'));
    const expected = reduced ? art.still : art.idle;
    const bytes = await readFile(resolve(content, 'hollow-hound', expected));
    expect(createHash('sha256').update(bytes).digest('hex') + '.webp').toBe(expected);
    const { errors, requests } = await openNpc(page, 'hound', reduced);
    const picture = page.locator('.hg-hound-figure');
    await expect(picture).toBeVisible();
    await expect.poll(() => picture.locator('img').evaluate(image => new URL((image as HTMLImageElement).currentSrc).pathname))
        .toBe('/fixture-art/hollow-hound/' + expected);
    expect(await picture.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(requests.has('/fixture-art/hollow-hound/' + expected)).toBe(true);
    await page.screenshot({ path: info.outputPath('shrine-hound.png') });
    expect(errors).toEqual([]);
});
