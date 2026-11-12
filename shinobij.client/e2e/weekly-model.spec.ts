import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const content = resolve(process.env.SECTOR_MODEL_TEST_CONTENT ?? '../.ci-evidence/sector-models');

async function prepare(page: Page, portrait: string, reduced = false) {
    const requests = new Set<string>();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.ok()) requests.add(new URL(response.url()).pathname); });
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await page.route('**/fixture-art/**', async route => {
        const path = new URL(route.request().url()).pathname.slice('/fixture-art/'.length);
        if (!/^hollow-warden\/[a-f0-9]{64}\.(?:json|gz|264|webp)$/.test(path)) return route.abort();
        return route.fulfill({ body: await readFile(resolve(content, path)) });
    });
    await page.route('**/api/world/sector-layout', route => route.fulfill({ json: {
        obstaclesEnabled: false, playerGaitsEnabled: true, modelArtBase: '/fixture-art',
    } }));
    await page.goto('/e2e/fixtures/weekly-model.html?portrait=' + portrait);
    const actor = page.locator('.sector-wanderer-figure');
    await expect(actor).toBeVisible();
    return { actor, requests, errors };
}

for (const portrait of ['canonical', 'public', 'fallback']) test(`${portrait} weekly portrait uses its own fitted package and still engages`, async ({ page }, info) => {
    const pin = JSON.parse(await readFile(resolve('src/data/sector-models/hollow-warden.json'), 'utf8'));
    const { actor, requests, errors } = await prepare(page, portrait);
    await expect(actor).toHaveClass(/has-sector-model/);
    await expect.poll(() => requests.has('/fixture-art/hollow-warden/' + pin.manifestSha256 + '.json')).toBe(true);
    const sprite = actor.locator('.sector-model-figure');
    await sprite.evaluate(element => {
        const observations: Array<{ gait?: string; frame?: string; facing?: string }> = [];
        new MutationObserver(() => {
            const data = (element as HTMLElement).dataset;
            if (element.parentElement?.classList.contains('has-sector-model'))
                observations.push({ gait: data.gait, frame: data.frame, facing: data.facing });
            element.setAttribute('data-observed', JSON.stringify(observations));
        }).observe(element, { attributeFilter: ['data-frame', 'data-gait', 'data-facing'] });
    });
    const before = await actor.getAttribute('style');
    await page.getByRole('button', { name: 'Move northwest', exact: true }).click();
    await expect.poll(() => actor.getAttribute('style')).not.toBe(before);
    await expect.poll(async () => {
        const samples = JSON.parse(await sprite.getAttribute('data-observed') || '[]');
        return new Set(samples.filter((s: { gait: string }) => s.gait === 'run' || s.gait === 'walk')
            .map((s: { frame: string }) => s.frame)).size;
    }).toBeGreaterThanOrEqual(3);
    const count = Number(await page.getByTestId('engagements').textContent());
    await page.getByRole('button', { name: 'Move southeast', exact: true }).click();
    await expect.poll(async () => Number(await page.getByTestId('engagements').textContent())).toBeGreaterThan(count);
    await expect(sprite).toHaveAttribute('data-clip', 'idle');
    const samples = JSON.parse(await sprite.getAttribute('data-observed') || '[]');
    await writeFile(info.outputPath('weekly-poses.json'), JSON.stringify({ portrait, samples }));
    await page.screenshot({ path: info.outputPath('weekly-fitted.png') });
    expect(errors).toEqual([]);
});

test('an unrelated custom weekly portrait keeps its appearance', async ({ page }) => {
    const { actor, requests, errors } = await prepare(page, 'custom');
    await expect(actor.locator('.sector-avatar-body img')).toHaveAttribute('src', /^data:image\/svg\+xml,/);
    await expect(actor.locator('.sector-model-figure')).toHaveCount(0);
    await expect.poll(async () => Number(await page.getByTestId('engagements').textContent())).toBeGreaterThan(0);
    expect([...requests].filter(path => path.startsWith('/fixture-art/'))).toEqual([]);
    expect(errors).toEqual([]);
});

test('reduced motion still closes the weekly encounter with planted poses', async ({ page }) => {
    const { actor, errors } = await prepare(page, 'fallback', true);
    await expect(actor).toHaveClass(/has-sector-model/);
    const sprite = actor.locator('.sector-model-figure');
    const before = await actor.getAttribute('style');
    await page.getByRole('button', { name: 'Move southeast', exact: true }).click();
    await expect.poll(() => actor.getAttribute('style')).not.toBe(before);
    await expect.poll(async () => Number(await page.getByTestId('engagements').textContent())).toBeGreaterThan(0);
    await expect(sprite).toHaveAttribute('data-clip', 'idle');
    expect(errors).toEqual([]);
});
