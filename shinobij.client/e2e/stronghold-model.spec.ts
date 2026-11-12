import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { advanceStronghold, STRONGHOLD_VAULT, type StrongholdVisit } from '../../shared/sector-stronghold';
import { isPlayerModel, type PlayerModel } from '../../shared/player-model-ref';

const content = resolve(process.env.SECTOR_MODEL_TEST_CONTENT ?? '../.ci-evidence/sector-models');
const rosterFile = process.env.SECTOR_MODEL_TEST_ROSTER;

async function prepare(page: Page, custom: boolean, reduced: boolean, defender?: string) {
    const roster = JSON.parse(await readFile(rosterFile!, 'utf8'));
    const model: PlayerModel = roster.Zayah;
    expect(isPlayerModel(model)).toBe(true);
    const requests = new Set<string>();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.ok()) requests.add(new URL(response.url()).pathname); });
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await page.addInitScript(() => localStorage.setItem('worldSprintStyle.v1', 'C'));
    await page.route('**/fixture-art/**', async route => {
        const path = new URL(route.request().url()).pathname.slice('/fixture-art/'.length);
        if (!/^(?:players\/[a-f0-9]{32}|[a-z0-9]+(?:-[a-z0-9]+)*)\/[a-f0-9]{64}\.(?:json|gz|264|webp)$/.test(path))
            return route.abort();
        return route.fulfill({ body: await readFile(resolve(content, path)) });
    });
    const startTile = defender ? STRONGHOLD_VAULT - 1 : 153;
    let visit: StrongholdVisit = { id: 'model-qa', layoutVersion: 1, sector: 12,
        tile: startTile, version: 0, steps: 0, threat: 0, visited: [startTile] };
    const state = { steps: [] as number[], peers: [{ name: 'Rival', level: 100, village: 'Ashen Leaf Village',
        character: { avatarImage: '/starter-avatar-one.webp', ...(custom ? {} : { playerModel: model }) },
        stronghold: { sector: 12, tile: defender ? startTile - 1 : 154 }, gaitPresentation: { gait: 'walk', style: 'B' }, inBattle: false }] };
    await page.route('**/api/**', async route => {
        if (new URL(route.request().url()).pathname === '/api/world/sector-layout') return route.fulfill({ json: {
            obstaclesEnabled: true, playerGaitsEnabled: true, modelArtBase: '/fixture-art',
        } });
        const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
        if (body?.action === 'stronghold-step') {
            visit = advanceStronghold(visit, Number(body.tile));
            state.steps.push(visit.tile);
        }
        return route.fulfill({ json: { ok: true, visit, peers: state.peers } });
    });
    const query = new URLSearchParams({ starter: 'one', ...(custom ? model : {}), ...(defender ? { defender } : {}) });
    await page.goto('/e2e/fixtures/stronghold-model.html?' + query);
    await expect(page.locator('.stronghold-loading')).toBeHidden();
    const self = page.locator('.stronghold-player');
    const peer = page.locator('.stronghold-peer');
    await expect(self).toHaveClass(/has-sector-model/);
    await expect(peer).toHaveClass(/has-sector-model/);
    const starterPin = JSON.parse(await readFile(resolve('src/data/sector-models/starter-one.json'), 'utf8'));
    const ownFolder = custom ? 'players/' + model.assetId : 'starter-one';
    const ownVersion = custom ? model.version : starterPin.manifestSha256;
    await expect.poll(() => requests.has('/fixture-art/' + ownFolder + '/' + ownVersion + '.json')).toBe(true);
    const manifest = JSON.parse(await readFile(resolve(content, ownFolder, ownVersion + '.json'), 'utf8'));
    await expect.poll(() => requests.has('/fixture-art/' + ownFolder + '/' + manifest.styles.C[0])).toBe(true);
    return { self, peer, state, errors, requests };
}

test.beforeEach(() => { test.skip(!rosterFile, 'Mount the fitted player pair and local art objects'); });

for (const [village, kind] of [
    ['Moonshadow Village', 'moonshadow-defender'], ['Stormveil Village', 'stormveil-defender'],
    ['Ashen Leaf Village', 'ashenleaf-defender'], ['Frostfang Village', 'frostfang-defender'],
]) test(`${village} defender uses its fitted body at the vault and retains the challenge action`, async ({ page }, info) => {
    const { state, errors, requests } = await prepare(page, false, false, village);
    const pin = JSON.parse(await readFile(resolve('src/data/sector-models', kind + '.json'), 'utf8'));
    const defender = page.locator('.stronghold-anbu-station');
    await expect(defender).toHaveClass(/has-sector-model/);
    const sprite = defender.locator('.sector-model-figure');
    await expect(sprite).toHaveAttribute('data-clip', 'idle');
    await expect(sprite).toHaveCSS('background-image', /blob:/);
    await expect(defender.locator('.stronghold-anbu')).toHaveCSS('opacity', '0');
    expect(requests.has('/fixture-art/' + kind + '/' + pin.manifestSha256 + '.json')).toBe(true);
    const painted = await sprite.evaluate(async element => {
        const css = getComputedStyle(element), rect = element.getBoundingClientRect();
        const tile = element.closest<HTMLElement>('.stronghold-tile')!.getBoundingClientRect();
        const tileSize = Number(element.closest<HTMLElement>('.stronghold-map')!.dataset.tileSize);
        const image = new Image();
        image.src = css.backgroundImage.slice(4, -1).replace(/^["']|["']$/g, '');
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(rect.width); canvas.height = Math.ceil(rect.height);
        const context = canvas.getContext('2d')!;
        const [width, height] = css.backgroundSize.split(' ').map(Number.parseFloat);
        context.drawImage(image, Number.parseFloat(css.backgroundPositionX), Number.parseFloat(css.backgroundPositionY), width, height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let top = canvas.height, bottom = -1, visible = 0;
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
            if (pixels[(y * canvas.width + x) * 4 + 3] < 64) continue;
            visible++; top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        return { tileSize, paintedHeight: bottom - top + 1, visiblePixels: visible,
            footY: rect.top + bottom, groundY: tile.top + tile.height / 2 };
    });
    expect(painted.paintedHeight).toBeGreaterThan(painted.tileSize * .55);
    expect(painted.paintedHeight).toBeLessThan(painted.tileSize * 1.2);
    expect(painted.visiblePixels).toBeGreaterThan(painted.paintedHeight * 2);
    expect(Math.abs(painted.footY - painted.groundY)).toBeLessThan(painted.tileSize * .15 + 2);
    await writeFile(info.outputPath('defender-paint.json'), JSON.stringify({ village, kind, revision: pin.manifestSha256, ...painted }));
    await page.screenshot({ path: info.outputPath('defender-vault.png') });
    await page.getByRole('button', { name: /^Anbu vault, row/ }).click();
    await expect.poll(() => page.evaluate(() => document.body.dataset.challenge)).toBe('true');
    expect(state.steps).toEqual([]);
    expect(errors).toEqual([]);
});

for (const custom of [false, true]) test(`${custom ? 'equipped' : 'starter'} stronghold players animate and retain inspection controls`, async ({ page }, info) => {
    const { self, peer, state, errors } = await prepare(page, custom, false);
    await self.locator('.sector-model-figure').evaluate(element => {
        const samples: Array<{ gait?: string; frame?: string; facing?: string }> = [];
        const record = () => {
            const d = (element as HTMLElement).dataset;
            if (element.parentElement?.classList.contains('has-sector-model')) samples.push({ gait: d.gait, frame: d.frame, facing: d.facing });
            element.setAttribute('data-observed', JSON.stringify(samples));
        };
        new MutationObserver(record).observe(element, { attributeFilter: ['data-frame', 'data-gait', 'data-facing'] });
    });
    const right = page.getByRole('button', { name: 'Move right', exact: true });
    const left = page.getByRole('button', { name: 'Move left', exact: true });
    // Repeat after the cold-facing request, so visible authored poses must
    // advance as well as the logical tile and the portrait fallback.
    for (let step = 0; step < 12; step++) {
        await (step % 4 < 2 ? right : left).click();
        await expect.poll(() => state.steps.length).toBe(step + 1);
        await page.waitForTimeout(200);
    }
    const sprite = self.locator('.sector-model-figure');
    await expect(sprite).toHaveAttribute('data-clip', 'idle');
    const observations = JSON.parse(await sprite.getAttribute('data-observed') || '[]');
    const walking = observations.filter((s: { gait: string }) => s.gait === 'walk');
    expect(new Set(walking.map((s: { frame: string }) => s.frame)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(walking.map((s: { facing: string }) => s.facing))).toEqual(new Set(['2', '6']));
    await writeFile(info.outputPath('visible-walk-samples.json'), JSON.stringify({ steps: state.steps, observations }));
    await info.attach('visible-walk-samples', { path: info.outputPath('visible-walk-samples.json'), contentType: 'application/json' });
    await peer.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Attack player', exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    const anchors = await page.locator('.stronghold-motion-avatar').evaluateAll(nodes => nodes.map(node => {
        const root = node as HTMLElement;
        const sprite = root.querySelector<HTMLElement>('.sector-model-figure')!;
        const pseudo = getComputedStyle(root, '::before');
        return { name: root.getAttribute('aria-label'), root: root.getBoundingClientRect().toJSON(),
            sprite: sprite.getBoundingClientRect().toJSON(), spriteStyle: sprite.getAttribute('style'),
            ring: { top: pseudo.top, left: pseudo.left, width: pseudo.width, height: pseudo.height,
                transform: pseudo.transform, border: pseudo.border, boxSizing: pseudo.boxSizing,
                minWidth: pseudo.minWidth, minHeight: pseudo.minHeight } };
    }));
    await writeFile(info.outputPath('figure-anchors.json'), JSON.stringify(anchors));
    await info.attach('figure-anchors', { path: info.outputPath('figure-anchors.json'), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath('stronghold-models.png') });
    expect(errors).toEqual([]);
});

test('reduced motion snaps stronghold figures and retains mobile peer targets', async ({ page }) => {
    const { self, peer, state, errors } = await prepare(page, false, true);
    const before = await self.evaluate(el => ({ left: (el as HTMLElement).style.left, top: (el as HTMLElement).style.top }));
    await page.getByRole('button', { name: 'Move right', exact: true }).click();
    await expect.poll(() => state.steps.length).toBe(1);
    await expect.poll(() => self.evaluate(el => (el as HTMLElement).style.left)).not.toBe(before.left);
    await expect(self.locator('.sector-model-figure')).toHaveAttribute('data-clip', 'idle');
    const box = await peer.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await peer.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(errors).toEqual([]);
});
