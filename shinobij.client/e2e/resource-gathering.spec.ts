import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createRequire } from 'node:module';
import { uiAuditSave } from './helpers/ui-audit-runtime';
import { resourceNode } from '../../shared/resource-nodes';
import { readResourceGathering } from '../../shared/resource-gathering';
import type { OnlinePlayer } from '../../api/_realtime/types';
import type { ResourceSeal } from '../../api/world/_resource-gathering';
const { mintResourceSeal, admitResourceAttempt, resolveResourceAttempt, equipGatheringTool } = createRequire(import.meta.url)('../../dist/api/world/_resource-gathering.js') as typeof import('../../api/world/_resource-gathering');

async function install(page: Page, nodeId = 'resource-13', uses = 0, miningXp = 3200) {
    const node = resourceNode(nodeId)!;
    let character: Record<string, unknown> = { ...uiAuditSave().character, name: 'GatherQA',
        inventory: ['tool-basic-pickaxe', 'tool-basic-fishing-pole'],
        equipment: { pickaxe: 'tool-golden-pickaxe', fishingPole: 'tool-golden-fishing-pole' },
        gatheringToolUses: { 'tool-basic-pickaxe': uses, 'tool-basic-fishing-pole': 0 },
        resourceGathering: { ...readResourceGathering(null), miningXp, fishingXp: 3200 } };
    let version = 1, settlements = 0;
    const seals = new Map<string, ResourceSeal>();
    const player = { sector: node.sector, tile: node.approach, movementSeq: 0, resourceEpoch: 0 } as OnlinePlayer;
    await page.addInitScript(seed => { (window as unknown as { resourceSeed: unknown }).resourceSeed = seed; }, character);
    await page.route('**/api/**', async route => {
        if (!route.request().url().endsWith('/world/resource')) return route.fulfill({ json: { ok: true, hunts: [], contracts: [] } });
        const body = route.request().postDataJSON(); let receipt;
        if (body.action === 'equip') character = equipGatheringTool(character, body.itemId, body.unequip)!;
        if (body.action === 'start') {
            const seal = mintResourceSeal(character, node, body.requestId, body.mode, player, Date.now());
            seal.template = node.difficulty === 1 ? 0 : 2; seal.successDraw = 0; seal.qualityDraw = .99;
            seals.set(seal.id, seal);
            character = admitResourceAttempt(character, seal, Date.now())!;
        }
        if (body.action === 'resolve' || body.action === 'cancel') {
            const result = resolveResourceAttempt(character, body.requestId, { ...body, cancel: body.action === 'cancel' }, player, Date.now(), seals.get(body.requestId));
            if (!result.ok) return route.fulfill({ status: 409, json: { error: result.error } });
            character = result.character; receipt = result.receipt; if (!result.replayed) settlements++;
        }
        if (body.action !== 'status') version++;
        return route.fulfill({ json: { ok: true, character, _saveVersion: version, receipt } });
    });
    return { node, character: () => character, settlements: () => settlements };
}
async function noOverflow(page: Page) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const dialog = page.getByRole('dialog');
    if (await dialog.isVisible()) expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

test('map resource nodes stay anchored when hovered and open on the first click', async ({ page }, info) => {
    await install(page);
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-13');
    await expect.poll(() => page.locator('.resource-node-art').evaluateAll(images => images.length > 0 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await page.screenshot({ path: info.outputPath('map-resource-markers.png'), fullPage: true });
    const marker = page.getByRole('button', { name: /^Harbor iron seam, mining/ });
    const before = (await marker.boundingBox())!;
    // This point stays inside the circle even if an inherited hover transform
    // displaces it, so a lost hover cannot accidentally hide the regression.
    await marker.hover({ position: { x: before.width * .75, y: before.height * .75 } });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const after = (await marker.boundingBox())!;
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    await marker.click();
    await expect(page.getByRole('dialog', { name: 'Harbor iron seam', exact: true })).toBeVisible();
});

test('narrow equipment panels keep tool controls contained and reachable after equipping', async ({ page }) => {
    await install(page);
    await page.goto('/e2e/fixtures/resource-gathering.html?screen=kit');
    const kit = page.getByRole('region', { name: 'Gathering equipment' });
    for (const name of ['Basic Pickaxe', 'Basic Fishing Pole']) {
        await kit.getByRole('button', { name: `Equip ${name}`, exact: true }).click();
    }
    await expect(kit.getByText('50 / 50 uses remaining')).toHaveCount(2);
    expect(await kit.locator('.gathering-tool-slot').evaluateAll(cards => cards.every(card =>
        card.scrollWidth <= card.clientWidth + 1))).toBe(true);
    await kit.getByRole('button', { name: 'Unequip fishing pole', exact: true }).click();
    await kit.getByRole('button', { name: 'Unequip pickaxe', exact: true }).click();
    await noOverflow(page);
});

test('Outpost tabs, independent skills and tool slots remain accessible on small screens', async ({ page }, info) => {
    await install(page);
    await page.goto('/e2e/fixtures/resource-gathering.html?screen=outpost');
    await page.getByRole('tab', { name: 'Mining', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Mining · Level 10' })).toBeVisible();
    await expect(page.getByText('Permanent · never breaks')).toHaveCount(2);
    await page.getByRole('button', { name: 'Equip Basic Pickaxe', exact: true }).click();
    await expect(page.getByText('50 / 50 uses remaining')).toBeVisible();
    await page.getByRole('tab', { name: 'Mining', exact: true }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'Fishing', exact: true })).toHaveAttribute('aria-selected', 'true');
    await noOverflow(page);
    const audit = await new AxeBuilder({ page }).include('.shinobi-outpost').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('outpost.png'), fullPage: true });
});

test('Fracture Chain exposes the core and consumes the final basic tool use once', async ({ page }, info) => {
    const runtime = await install(page, 'resource-13', 49);
    runtime.character().equipment = { pickaxe: 'tool-basic-pickaxe', fishingPole: 'tool-golden-fishing-pole' };
    // The initial browser seed is supplied again with the final-use tool equipped.
    await page.addInitScript(seed => { (window as unknown as { resourceSeed: unknown }).resourceSeed = seed; }, runtime.character());
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-13');
    await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    await page.getByRole('button', { name: 'Begin mining · 1 action' }).click();
    const detonate = page.getByRole('button', { name: 'Detonate chain', exact: true });
    await expect(detonate).toBeVisible();
    const actionBox = await detonate.boundingBox();
    expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    const charges = page.locator('.fracture-charge');
    expect(await charges.evaluateAll(buttons => buttons.every(button => {
        const box = button.getBoundingClientRect();
        return box.width >= 44 && box.height >= 44;
    }))).toBe(true);
    const northwest = page.getByRole('button', { name: /^Northwest seam/ });
    await northwest.focus();
    await page.keyboard.press('Enter');
    await expect(northwest).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Enter');
    await expect(northwest).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: /^Northwest seam/ }).click();
    await page.getByRole('button', { name: /^Southeast seam/ }).click();
    await noOverflow(page);
    expect((await new AxeBuilder({ page }).include('.resource-dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('fracture-placed.png'), fullPage: true });
    await page.getByRole('button', { name: 'Detonate chain', exact: true }).click();
    await expect(page.getByText('Your basic tool broke after its 50th use.', { exact: false })).toBeVisible();
    expect(runtime.settlements()).toBe(1);
    expect(readResourceGathering(runtime.character().resourceGathering).attemptsToday).toBe(1);
    expect((runtime.character().equipment as Record<string, string>).pickaxe).toBeUndefined();
    await noOverflow(page);
    expect((await new AxeBuilder({ page }).include('.resource-dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('mining-result.png'), fullPage: true });
});

test('cast, hook and controlled reel input produce a server-replayed catch', async ({ page }, info) => {
    const runtime = await install(page, 'resource-1');
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-1');
    await page.getByRole('button', { name: /^Dockside shoal, fishing/ }).click();
    await page.getByRole('button', { name: 'Cast line · 1 action' }).click();
    await expect(page.locator('.fishing-rod')).toBeVisible();
    expect(Number((await page.locator('.resource-attempt-strip span').last().innerText()).match(/\d+/)![0])).toBeLessThanOrEqual(90);
    const hook = page.getByRole('button', { name: 'Hook fish', exact: true });
    await hook.click();
    const reel = page.getByRole('button', { name: 'Hold to reel', exact: true });
    await expect(reel).toBeVisible();
    const reelBox = await reel.boundingBox();
    expect(reelBox!.y + reelBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.screenshot({ path: info.outputPath('fishing-hooked.png'), fullPage: true, animations: 'disabled' });
    await reel.focus();
    for (let cycle = 0; cycle < 3; cycle++) {
        await page.keyboard.down('Space');
        await expect(reel).toHaveClass(/is-held/);
        await page.waitForTimeout(1300);
        await page.keyboard.up('Space');
        await expect(reel).not.toHaveClass(/is-held/);
        await page.waitForTimeout(700);
    }
    await page.screenshot({ path: info.outputPath('fishing-reel.png'), fullPage: true });
    const collect = page.getByRole('button', { name: 'Collect result', exact: true });
    await expect(collect).toBeVisible();
    const tension = Number(await page.getByRole('meter', { name: 'Line tension' }).getAttribute('aria-valuenow'));
    await expect(page.locator('.fishing-tension-fill')).toHaveCSS('background-color', tension > 80 ? 'rgb(209, 140, 116)' : tension < 20 ? 'rgb(169, 137, 104)' : 'rgb(209, 167, 88)');
    expect((await new AxeBuilder({ page }).include('.resource-dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await collect.click();
    await expect(page.getByRole('heading', { name: 'Fine River Fish', exact: true })).toBeVisible();
    await expect(page.getByText('Fine quality', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fish again' })).toBeVisible();
    expect(runtime.settlements()).toBe(1);
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath('fishing-result.png'), fullPage: true });
    await page.getByRole('button', { name: 'Back to map', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const deposit of [{ id: 'resource-15', skin: 'frozen' }, { id: 'resource-22', skin: 'volcanic' }]) {
    test(`${deposit.skin} deposits keep their terrain identity through a three-charge fracture`, async ({ page }, info) => {
        const runtime = await install(page, deposit.id);
        await page.goto(`/e2e/fixtures/resource-gathering.html?node=${deposit.id}`);
        await page.getByRole('button', { name: new RegExp(`^${runtime.node.name}, mining`) }).click();
        await page.getByRole('button', { name: 'Begin mining · 1 action' }).click();
        await expect(page.locator(`.fracture-board--${deposit.skin}`)).toBeVisible();
        for (const site of ['Crown seam', 'East seam', 'West seam']) await page.getByRole('button', { name: new RegExp(`^${site}`) }).click();
        await expect(page.getByText('3 / 3 charges placed', { exact: false })).toBeVisible();
        await page.screenshot({ path: info.outputPath(`${deposit.skin}-fracture.png`), fullPage: true });
        await page.getByRole('button', { name: 'Detonate chain', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Superior Iron Sand', exact: true })).toBeVisible();
        expect(runtime.settlements()).toBe(1);
        await noOverflow(page);
    });
}

test('field report shows a skill level up, repeat gathering and an exhausted node', async ({ page }, info) => {
    const runtime = await install(page, 'resource-13', 0, 90);
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-13');
    await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    await page.getByRole('radio', { name: /Watch animation/ }).check();
    await page.getByRole('button', { name: 'Begin mining · 1 action' }).click();
    await page.getByRole('button', { name: 'Collect result', exact: true }).click();
    await expect(page.getByText('Level up · Mining 2', { exact: true })).toBeVisible();
    await expect(page.getByText('Common quality', { exact: true })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath('mining-level-up.png'), fullPage: true });
    for (let attempt = 0; attempt < 2; attempt++) {
        await page.getByRole('button', { name: 'Mine again' }).click();
        await page.getByRole('button', { name: 'Abandon attempt (action stays spent)', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Tools down.' })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Mine again' })).toHaveCount(0);
    await expect(page.getByText('This node replenishes in 10 minutes.')).toBeVisible();
    expect(runtime.settlements()).toBe(3);
    expect(readResourceGathering(runtime.character().resourceGathering).attemptsToday).toBe(3);
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath('node-exhausted.png'), fullPage: true });
    await page.getByRole('button', { name: 'Back to map', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('overlapping charges destroy the core even with a successful extraction roll', async ({ page }, info) => {
    const runtime = await install(page, 'resource-22');
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-22');
    await page.getByRole('button', { name: new RegExp(`^${runtime.node.name}, mining`) }).click();
    await page.getByRole('button', { name: 'Begin mining · 1 action' }).click();
    for (const site of ['Crown seam', 'East seam', 'Diagonal fracture']) await page.getByRole('button', { name: new RegExp(`^${site}`) }).click();
    await page.getByRole('button', { name: 'Detonate chain', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'The seam gave way.', exact: true })).toBeVisible();
    const state = readResourceGathering(runtime.character().resourceGathering);
    expect(state.receipts.at(-1)).toMatchObject({ outcome: 'failed', xp: 3 });
    expect(state.receipts.at(-1)?.itemId).toBeUndefined();
    expect(state.attemptsToday).toBe(1);
    await page.screenshot({ path: info.outputPath('shattered-core-result.png'), fullPage: true });
});

test('refreshing an admitted attempt preserves its node, charges and repeat action', async ({ page }) => {
    const runtime = await install(page);
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-13');
    await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    await page.getByRole('radio', { name: /Watch animation/ }).check();
    await page.getByRole('button', { name: 'Begin mining · 1 action' }).click();
    await expect(page.getByText('Animation mode uses your skill’s baseline success rate.', { exact: true })).toBeVisible();
    await page.addInitScript(seed => { (window as unknown as { resourceSeed: unknown }).resourceSeed = seed; }, runtime.character());
    await page.reload();
    await page.getByRole('button', { name: 'Collect result', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Fine Iron Sand', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Mining result' }).getByText('2/3', { exact: true })).toBeVisible();
    await expect(page.getByText('This node replenishes in 10 minutes.')).toHaveCount(0);
    await page.getByRole('button', { name: 'Mine again', exact: false }).click();
    await expect(page.getByText('Action spent · 2/100 today')).toBeVisible();
    expect(runtime.settlements()).toBe(1);
    expect(readResourceGathering(runtime.character().resourceGathering).attemptsToday).toBe(2);
});

test('a missing gathering tool explains the prerequisite before spending an action', async ({ page }) => {
    const runtime = await install(page);
    runtime.character().equipment = {};
    await page.addInitScript(seed => { (window as unknown as { resourceSeed: unknown }).resourceSeed = seed; }, runtime.character());
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-13');
    await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    await expect(page.getByRole('status')).toContainText('Equip a pickaxe in Inventory first.');
    await expect(page.getByRole('button', { name: 'Begin mining · 1 action' })).toHaveCount(0);
    expect(readResourceGathering(runtime.character().resourceGathering).attemptsToday).toBe(0);
});
