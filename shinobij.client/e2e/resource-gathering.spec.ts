import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createRequire } from 'node:module';
import { uiAuditSave } from './helpers/ui-audit-runtime';
import { kunaiFish, kunaiFlightMs, kunaiSeed } from '../../shared/kunai-fishing';
import { resourceNode, RESOURCE_NODES } from '../../shared/resource-nodes';
import { readResourceGathering } from '../../shared/resource-gathering';
import { FRACTURE_TEMPLATES } from '../../shared/fracture-chain';
import type { OnlinePlayer } from '../../api/_realtime/types';
import type { ResourceSeal } from '../../api/world/_resource-gathering';
import { expectVisibleTouchTarget } from './helpers/visible-target';
const { mintResourceSeal, admitResourceAttempt, resolveResourceAttempt, equipGatheringTool } = createRequire(import.meta.url)('../../dist/api/world/_resource-gathering.js') as typeof import('../../api/world/_resource-gathering');

async function install(page: Page, nodeId = 'resource-13', uses = 0, miningXp = 3200, fishingXp = 3200, fixture: { template?: number; successDraw?: number } = {}) {
    const node = resourceNode(nodeId)!;
    let character: Record<string, unknown> = { ...uiAuditSave().character, name: 'GatherQA',
        inventory: ['tool-basic-pickaxe', 'tool-basic-fishing-pole'],
        equipment: { pickaxe: 'tool-golden-pickaxe', fishingPole: 'tool-golden-fishing-pole' },
        gatheringToolUses: { 'tool-basic-pickaxe': uses, 'tool-basic-fishing-pole': 0 },
        resourceGathering: { ...readResourceGathering(null), miningXp, fishingXp } };
    let version = 1, settlements = 0, loseAck = false, staleAck = false;
    const seals = new Map<string, ResourceSeal>();
    const player = { sector: node.sector, tile: node.approach, movementSeq: 0, resourceEpoch: 0 } as OnlinePlayer;
    await page.addInitScript(seed => { (window as unknown as { resourceSeed: unknown }).resourceSeed = seed; }, character);
    await page.route('**/api/**', async route => {
        if (!route.request().url().endsWith('/world/resource')) return route.fulfill({ json: { ok: true, hunts: [], contracts: [] } });
        const body = route.request().postDataJSON(); let receipt;
        if (body.action === 'nodes') {
            const state = readResourceGathering(character.resourceGathering);
            const nodes = Object.fromEntries(RESOURCE_NODES.filter(candidate => candidate.sector === node.sector).map(candidate => [candidate.id, {
                remaining: Math.max(0, 3 - (state.nodes[candidate.id]?.attempts ?? 0)),
                refillAt: state.nodes[candidate.id]?.refillAt ?? 0,
            }]));
            return route.fulfill({ json: { ok: true, sector: node.sector, nodes } });
        }
        if (body.action === 'equip') character = equipGatheringTool(character, body.itemId, body.unequip)!;
        if (body.action === 'start') {
            // Match the handler's admission replay: an acknowledgement lost to
            // reload must recover the same attempt without spending again.
            const active = readResourceGathering(character.resourceGathering).active;
            if (active?.id === body.requestId) return route.fulfill({ json: { ok: true, character, _saveVersion: version, attempt: active, replayed: true } });
            const seal = mintResourceSeal(character, node, body.requestId, body.mode, player, Date.now());
            seal.template = fixture.template ?? (node.difficulty === 1 ? 0 : 2); seal.successDraw = fixture.successDraw ?? 0; seal.qualityDraw = .99;
            if (node.activity === 'fishing') seal.hookAt = 2718;
            seals.set(seal.id, seal);
            character = admitResourceAttempt(character, seal, Date.now())!;
        }
        if (body.action === 'resolve' || body.action === 'cancel') {
            const result = resolveResourceAttempt(character, body.requestId, { ...body, cancel: body.action === 'cancel' }, player, Date.now(), seals.get(body.requestId));
            if (!result.ok) return route.fulfill({ status: 409, json: { error: result.error } });
            character = result.character; receipt = result.receipt; if (!result.replayed) settlements++;
        }
        if (body.action !== 'status') version++;
        if (body.action === 'resolve' && loseAck) { loseAck = false; return route.fulfill({ status: 503, json: { ok: false, error: 'Settlement acknowledgement lost.' } }); }
        if (body.action === 'resolve' && staleAck) { staleAck = false; return route.fulfill({ json: { ok: true, character, receipt, _saveVersion: 0 } }); }
        if (body.action === 'status') receipt = readResourceGathering(character.resourceGathering).receipts.find(receipt => receipt.id === body.requestId);
        return route.fulfill({ json: { ok: true, character, _saveVersion: version, receipt, nodeId: receipt ? body.nodeId : undefined } });
    });
    return { node, character: () => character, settlements: () => settlements, loseAckOnce: () => { loseAck = true; }, staleAckOnce: () => { staleAck = true; },
        publishSave: () => { character = { ...character, ryo: Number(character.ryo) + 1 }; return ++version; } };
}
async function noOverflow(page: Page) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const dialog = page.getByRole('dialog');
    if (await dialog.isVisible()) expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

test('shared occupied nodes offer a working contest action and never offer a second harvest', async ({ page }, info) => {
    const runtime = await install(page);
    await page.addInitScript(peer => { (window as unknown as { resourcePeers: unknown[] }).resourcePeers = [peer]; },
        { name: 'Rival Shinobi', level: 100, village: 'Frostfang', specialty: 'ninjutsu', character: runtime.character(), currentSector: 2 });
    await page.route('**/api/world/resource', async route => {
        if (route.request().postDataJSON().action !== 'nodes') return route.fallback();
        return route.fulfill({ json: { ok: true, sector: 2, nodes: { 'resource-13': {
            remaining: 2, refillAt: 0, gatherer: 'rivalshinobi', claimExpiresAt: Date.now() + 90_000,
        } } } });
    });
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-13');
    await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    await expect(page.getByRole('button', { name: 'Contest node', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Begin mining · 1 action' })).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath('shared-node-contest.png'), fullPage: true });
    await page.getByRole('button', { name: 'Contest node', exact: true }).click();
    await expect(page.getByTestId('resource-contested')).toHaveText('Rival Shinobi');
    expect(readResourceGathering(runtime.character().resourceGathering).attemptsToday).toBe(0);
});

test('a depleted shared node blocks a fresh player who has never gathered there', async ({ page }) => {
    const runtime = await install(page);
    await page.route('**/api/world/resource', async route => {
        if (route.request().postDataJSON().action !== 'nodes') return route.fallback();
        return route.fulfill({ json: { ok: true, sector: 2, nodes: {
            'resource-13': { remaining: 0, refillAt: Date.now() + 600_000 },
        } } });
    });
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-13');
    await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    await expect(page.getByText(/Replenishes in 10 minutes/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Begin mining · 1 action' })).toHaveCount(0);
    expect(readResourceGathering(runtime.character().resourceGathering).attemptsToday).toBe(0);
    await noOverflow(page);
});

test('map resource nodes stay anchored when hovered and open on the first click', async ({ page }, info) => {
    await install(page);
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-13');
    await expect.poll(() => page.locator('.resource-node-art').evaluateAll(images => images.length > 0 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await page.screenshot({ path: info.outputPath('map-resource-markers.png'), fullPage: true });
    const marker = page.getByRole('button', { name: /^Harbor iron seam, mining/ });
    await marker.scrollIntoViewIfNeeded();
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
    for (const name of ['Basic Pickaxe', 'Basic Fishing Kunai']) {
        await kit.getByRole('button', { name: `Equip ${name}`, exact: true }).click();
    }
    await expect(kit.getByText('50 / 50 uses remaining')).toHaveCount(2);
    expect(await kit.locator('.gathering-tool-slot').evaluateAll(cards => cards.every(card =>
        card.scrollWidth <= card.clientWidth + 1))).toBe(true);
    await kit.getByRole('button', { name: 'Unequip fishing kunai', exact: true }).click();
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
    for (const activity of ['Fishing', 'Mining']) {
        await page.getByRole('tab', { name: activity, exact: true }).click();
        await expect(page.getByRole('heading', { name: `${activity} · Level 10` })).toBeVisible();
        await expect(page.getByRole('progressbar', { name: `${activity} skill progress` })).toHaveAttribute('value', '1');
        const tier = page.locator('.outpost-site-tier').last();
        await tier.locator('summary').focus();
        await page.keyboard.press('Enter');
        await expect(tier).toHaveAttribute('open', '');
        await expect(tier.locator('article').first()).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(tier).not.toHaveAttribute('open');
        await noOverflow(page);
        const audit = await new AxeBuilder({ page }).include('.shinobi-outpost').withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(audit.violations).toEqual([]);
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect.poll(() => page.locator('.outpost-grade img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
        await page.screenshot({ path: info.outputPath(`outpost-${activity.toLowerCase()}.png`) });
        await page.locator('.outpost-survey').screenshot({ path: info.outputPath(`outpost-${activity.toLowerCase()}-sites.png`) });
    }
});

test('Outpost appraisal distinguishes locked grades and shows progress within the current level', async ({ page }) => {
    await install(page, 'resource-13', 0, 125);
    await page.goto('/e2e/fixtures/resource-gathering.html?screen=outpost');
    await page.getByRole('tab', { name: 'Mining', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Mining · Level 2' })).toBeVisible();
    const progress = page.getByRole('progressbar', { name: 'Mining skill progress' });
    await expect(progress).toHaveAttribute('value', '25');
    await expect(progress).toHaveAttribute('max', '150');
    await expect(page.locator('.outpost-grade.is-locked')).toHaveCount(2);
    await expect(page.locator('.outpost-grade--1')).toContainText('Available now');
    await expect(page.locator('.outpost-grade--2')).toContainText('Unlocks at skill 4');
    const rich = page.locator('.outpost-site-tier').nth(1);
    await rich.locator('summary').click();
    await expect(rich.locator('article').first()).toContainText('Unlocks at skill 4');
    await noOverflow(page);
});

test('level-one Outpost quality values stay within their cards on narrow phones', async ({ page }) => {
    await install(page, 'resource-13', 0, 0, 0);
    await page.goto('/e2e/fixtures/resource-gathering.html?screen=outpost');
    for (const width of [320, 360, 390]) {
        await page.setViewportSize({ width, height: 800 });
        for (const activity of ['Fishing', 'Mining']) {
            await page.getByRole('tab', { name: activity, exact: true }).click();
            await expect(page.getByRole('heading', { name: `${activity} · Level 1` })).toBeVisible();
            await expect(page.locator('.outpost-grade--0 strong')).toHaveText('100.0%');
            expect(await page.locator('.outpost-grade').evaluateAll(cards => cards.every(card => {
                const bounds = card.getBoundingClientRect(), value = card.querySelector('strong')!.getBoundingClientRect();
                return card.scrollWidth <= card.clientWidth + 1 && value.right <= bounds.right + 1;
            })), `${activity} appraisal should fit at ${width}px`).toBe(true);
            await noOverflow(page);
        }
    }
});

test('Veinbreaking exposes the core and consumes the final basic tool use once', async ({ page }, info) => {
    const runtime = await install(page, 'resource-13', 49);
    runtime.character().equipment = { pickaxe: 'tool-basic-pickaxe', fishingPole: 'tool-golden-fishing-pole' };
    // The initial browser seed is supplied again with the final-use tool equipped.
    await page.addInitScript(seed => { (window as unknown as { resourceSeed: unknown }).resourceSeed = seed; }, runtime.character());
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-13');
    await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    await page.getByRole('button', { name: 'Begin mining · 1 action' }).click();
    const detonate = page.getByRole('button', { name: 'Release fracture', exact: true });
    await expect(detonate).toBeVisible();
    const actionBox = await detonate.boundingBox();
    expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    const charges = page.locator('.vein-seal');
    await expect(page.locator('.vein-talisman').first()).toBeVisible();
    await expect(page.locator('.vein-talisman')).toHaveCount(await charges.count());
    await expect(page.locator('.vein-scene > .vein-talisman')).toHaveCount(0);
    await expect(page.locator('.vein-scene img[src*="pickaxe"]')).toHaveCount(0);
    if (info.project.name.includes('landscape')) {
        for (const charge of await charges.all()) await expectVisibleTouchTarget(charge);
    }
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
    await page.getByRole('button', { name: 'Release fracture', exact: true }).click();
    await expect(page.getByText('Your basic tool broke after its 50th use.', { exact: false })).toBeVisible();
    expect(runtime.settlements()).toBe(1);
    expect(readResourceGathering(runtime.character().resourceGathering).attemptsToday).toBe(1);
    expect((runtime.character().equipment as Record<string, string>).pickaxe).toBeUndefined();
    await noOverflow(page);
    expect((await new AxeBuilder({ page }).include('.resource-dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('mining-result.png'), fullPage: true });
});

async function startKunai(page: Page, fishingXp = 3200) {
    const runtime = await install(page, 'resource-1', 0, 3200, fishingXp);
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-1');
    await page.getByRole('button', { name: /^Dockside shoal, fishing/ }).click();
    await page.getByRole('button', { name: 'Ready kunai · 1 action' }).click();
    await expect(page.getByRole('button', { name: 'Throw kunai', exact: true })).toBeEnabled();
    return runtime;
}
async function leadFish(page: Page, runtime: Awaited<ReturnType<typeof install>>, touch = false, index = 0) {
    const active = readResourceGathering(runtime.character().resourceGathering).active!;
    const shots = await page.evaluate(id => JSON.parse(sessionStorage.getItem(`outpost-kunai:${id}`) || '[]'), active.id);
    // Resolve layout before predicting the moving target, especially on Firefox.
    const box = (await page.getByRole('application', { name: 'Kunai fishing pool' }).boundingBox())!;
    const shot = { kind: 'throw' as const, at: Date.now() - active.startedAt + 25, x: 50, y: 45 };
    for (let n = 0; n < 15; n++) {
        const point = kunaiFish(kunaiSeed(active), index, shot.at + kunaiFlightMs(shot), shots);
        shot.x = point.x; shot.y = point.y;
    }
    const x = box.x + shot.x / 100 * box.width, y = box.y + shot.y / 100 * box.height;
    if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
}

test('kunai aiming, swimming fish and tether retrieval produce one server-replayed catch', async ({ page }, info) => {
    const runtime = await startKunai(page);
    const pool = page.getByRole('application', { name: 'Kunai fishing pool' });
    await expect(pool).toBeFocused();
    await expectVisibleTouchTarget(page.getByRole('button', { name: 'Throw kunai', exact: true }));
    const box = (await pool.boundingBox())!;
    expect(box.width).toBeGreaterThan(200); expect(box.height).toBeGreaterThan(125);
    await page.screenshot({ path: info.outputPath('kunai-aim.png'), fullPage: true });
    await leadFish(page, runtime, Boolean(info.project.use.hasTouch));
    await expect(page.locator('.kunai-game')).toHaveAttribute('data-phase', 'hauling');
    await page.screenshot({ path: info.outputPath('kunai-haul.png'), fullPage: true });
    await expect(page.getByRole('heading', { name: 'Fine River Fish', exact: true })).toBeVisible();
    const state = readResourceGathering(runtime.character().resourceGathering);
    expect(state.receipts.at(-1)).toMatchObject({ outcome: 'success', xp: 10 });
    expect(state.attemptsToday).toBe(1); expect(runtime.settlements()).toBe(1);
    await noOverflow(page);
    expect((await new AxeBuilder({ page }).include('.resource-dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('kunai-result.png'), fullPage: true });
});

test('kunai misses scatter the shoal and three throws exhaust the attempt without an item', async ({ page }, info) => {
    const runtime = await startKunai(page);
    const pool = page.getByRole('application', { name: 'Kunai fishing pool' });
    for (let n = 0; n < 3; n++) {
        await expect(page.getByRole('button', { name: 'Throw kunai', exact: true })).toBeEnabled();
        const box = (await pool.boundingBox())!;
        await page.mouse.click(box.x + box.width * .06, box.y + box.height * .12);
        await expect(page.locator('.kunai-game')).toHaveAttribute('data-phase', 'returning');
        if (!n) await page.screenshot({ path: info.outputPath('kunai-miss.png'), fullPage: true });
    }
    await expect(page.getByRole('heading', { name: 'This one got away.' })).toBeVisible();
    const state = readResourceGathering(runtime.character().resourceGathering);
    expect(state.receipts.at(-1)).toMatchObject({ outcome: 'failed', xp: 3 });
    expect(state.receipts.at(-1)?.itemId).toBeUndefined(); expect(runtime.settlements()).toBe(1);
    await noOverflow(page);
});

test('kunai clock corrections cannot rewind a committed throw or crash retrieval', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const runtime = await startKunai(page);
    const pool = (await page.getByRole('application', { name: 'Kunai fishing pool' }).boundingBox())!;
    await page.mouse.click(pool.x + pool.width * .06, pool.y + pool.height * .12);
    await expect(page.locator('.kunai-shots')).toHaveAttribute('aria-label', '2 of 3 kunai throws remaining');
    await page.evaluate(() => {
        // A device/server-clock correction can arrive between animation frames.
        const originalNow = Date.now;
        Date.now = () => originalNow() - 4000;
        setTimeout(() => { Date.now = originalNow; }, 400);
    });
    await expect(page.getByRole('button', { name: 'Throw kunai', exact: true })).toBeEnabled();
    await expect(page.locator('.kunai-shots')).toHaveAttribute('aria-label', '2 of 3 kunai throws remaining');
    await leadFish(page, runtime);
    await expect(page.getByRole('region', { name: 'Fishing result' })).toBeVisible();
    expect(errors).toEqual([]); expect(runtime.settlements()).toBe(1);
});

test('kunai pointer cancellation and lost window focus cannot throw; keyboard aiming works', async ({ page }) => {
    const runtime = await startKunai(page);
    const pool = page.getByRole('application', { name: 'Kunai fishing pool' });
    const box = (await pool.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await expect(page.locator('.kunai-shots')).toHaveAttribute('aria-label', '3 of 3 kunai throws remaining');
    await page.mouse.move(box.x + 25, box.y + 30); await page.mouse.down();
    await pool.dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up();
    await expect(page.locator('.kunai-shots')).toHaveAttribute('aria-label', '3 of 3 kunai throws remaining');
    await page.mouse.down(); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up();
    await expect(page.locator('.kunai-shots')).toHaveAttribute('aria-label', '3 of 3 kunai throws remaining');
    await pool.focus();
    for (let n = 0; n < 30; n++) await page.keyboard.press('ArrowLeft');
    for (let n = 0; n < 30; n++) await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Space');
    await expect(page.locator('.kunai-shots')).toHaveAttribute('aria-label', '2 of 3 kunai throws remaining');
    await expect(page.getByRole('button', { name: 'Throw kunai', exact: true })).toBeEnabled();
    await leadFish(page, runtime);
    await expect(page.getByRole('heading', { name: 'Fine River Fish', exact: true })).toBeVisible();
    expect(runtime.settlements()).toBe(1);
});

test('kunai reload preserves committed throws and a lost acknowledgement is recovered once', async ({ page }, info) => {
    const runtime = await startKunai(page);
    const pool = page.getByRole('application', { name: 'Kunai fishing pool' }), box = (await pool.boundingBox())!;
    await page.mouse.click(box.x + box.width * .06, box.y + box.height * .12);
    await page.addInitScript(seed => { (window as unknown as { resourceSeed: unknown }).resourceSeed = seed; }, runtime.character());
    await page.reload();
    await expect(page.locator('.kunai-shots')).toHaveAttribute('aria-label', '2 of 3 kunai throws remaining');
    await expect(page.getByRole('button', { name: 'Throw kunai', exact: true })).toBeEnabled();
    runtime.loseAckOnce(); await leadFish(page, runtime);
    await expect(page.getByRole('alert')).toContainText('Settlement acknowledgement lost.');
    const recover = page.getByRole('button', { name: 'Recover result', exact: true });
    await expectVisibleTouchTarget(recover);
    await page.screenshot({ path: info.outputPath('kunai-recovery.png'), fullPage: true });
    await recover.click();
    await expect(page.getByRole('heading', { name: 'Fine River Fish', exact: true })).toBeVisible();
    expect(readResourceGathering(runtime.character().resourceGathering).attemptsToday).toBe(1);
    expect(runtime.settlements()).toBe(1); await noOverflow(page);
});

test('kunai stale settlement replies offer direct recovery without abandoning or spending again', async ({ page }, info) => {
    const runtime = await startKunai(page);
    const id = readResourceGathering(runtime.character().resourceGathering).active!.id;
    runtime.staleAckOnce(); await leadFish(page, runtime);
    const recover = page.getByRole('button', { name: 'Check gathering again', exact: true });
    await expect(recover).toBeVisible();
    await expectVisibleTouchTarget(recover);
    await expect(page.getByRole('alert')).toContainText('Check gathering again');
    await expect(page.getByRole('button', { name: 'Abandon attempt (action stays spent)', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('stale-settlement-recovery.png'), fullPage: true });
    await recover.click();
    await expect(page.getByRole('heading', { name: 'Fine River Fish', exact: true })).toBeVisible();
    const state = readResourceGathering(runtime.character().resourceGathering);
    expect(state.receipts).toHaveLength(1); expect(state.receipts[0].id).toBe(id);
    expect(state.attemptsToday).toBe(1); expect(runtime.settlements()).toBe(1);
    await page.getByRole('button', { name: 'Fish again', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Throw kunai', exact: true })).toBeEnabled();
    expect(readResourceGathering(runtime.character().resourceGathering).attemptsToday).toBe(2);
});

test('kunai watch mode recovered from status keeps its mode when fishing again', async ({ page }) => {
    const runtime = await install(page, 'resource-1');
    let allowSettlement = false;
    await page.route('**/api/world/resource', route => {
        if (route.request().postDataJSON().action === 'resolve' && !allowSettlement)
            return route.fulfill({ status: 503, json: { ok: false, error: 'Reconnect before recording.' } });
        return route.fallback();
    });
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-1');
    await page.getByRole('button', { name: /^Dockside shoal, fishing/ }).click();
    await page.getByRole('radio', { name: /Watch animation/ }).check();
    await page.getByRole('button', { name: 'Ready kunai · 1 action' }).click();
    await expect(page.getByText('River technique', { exact: true })).toBeVisible();
    const id = readResourceGathering(runtime.character().resourceGathering).active!.id;
    // Keep the original stale boot save: status alone must restore the attempt and mode.
    await page.reload({ waitUntil: 'domcontentloaded' });
    allowSettlement = true;
    await expect(page.getByRole('region', { name: 'Fishing result' })).toBeVisible();
    expect(readResourceGathering(runtime.character().resourceGathering).receipts.at(-1)?.id).toBe(id);
    await page.getByRole('button', { name: 'Fish again', exact: true }).click();
    await expect(page.getByText('River technique', { exact: true })).toBeVisible();
    const state = readResourceGathering(runtime.character().resourceGathering);
    expect(state.active?.mode).toBe('relaxed'); expect(state.attemptsToday).toBe(2);
    expect(runtime.settlements()).toBe(1);
});

test('kunai relaxed mode animates a throw and retrieval without timed input', async ({ page }, info) => {
    const runtime = await install(page, 'resource-1');
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-1');
    await page.getByRole('button', { name: /^Dockside shoal, fishing/ }).click();
    await page.getByRole('radio', { name: /Watch animation/ }).check();
    await page.getByRole('button', { name: 'Ready kunai · 1 action' }).click();
    await expect(page.getByRole('application', { name: 'Kunai fishing pool' })).toBeVisible();
    await expect(page.getByText('Animation mode uses your skill’s baseline success rate.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Throw kunai', exact: true })).toHaveCount(0);
    await expect(page.locator('.kunai-game')).toHaveAttribute('data-phase', 'hauling');
    await page.screenshot({ path: info.outputPath('kunai-relaxed.png'), fullPage: true });
    await expect(page.getByRole('heading', { name: 'Fine River Fish', exact: true })).toBeVisible();
    expect(runtime.settlements()).toBe(1); await noOverflow(page);
});

for (const challenge of [
    { xp: 0, level: 1, index: 1, species: 'Bronze Carp', required: 4, blocked: true },
    { xp: 450, level: 4, index: 1, species: 'Bronze Carp', required: 4, blocked: false },
    { xp: 1400, level: 7, index: 2, species: 'River Sturgeon', required: 10, blocked: true },
    { xp: 3200, level: 10, index: 2, species: 'River Sturgeon', required: 10, blocked: false },
]) {
    test(`kunai ranked fish: Lv${challenge.level} versus ${challenge.species} Lv${challenge.required}`, async ({ page }, info) => {
        const runtime = await startKunai(page, challenge.xp);
        await expect(page.locator('#kunai-help')).toContainText(`Fishing Lv.${challenge.level}`);
        await expect(page.locator('#kunai-species')).toContainText(`${challenge.species}, requires Fishing level ${challenge.required}, ${challenge.blocked ? 'too strong' : 'catchable'}`);
        await page.screenshot({ path: info.outputPath('ranked-shoal.png'), fullPage: true });
        await leadFish(page, runtime, Boolean(info.project.use.hasTouch), challenge.index);
        await expect(page.locator('.kunai-game')).toHaveAttribute('data-phase', challenge.blocked ? 'resisting' : 'hauling');
        await page.screenshot({ path: info.outputPath(challenge.blocked ? 'fish-breaking-free.png' : 'ranked-catch.png'), fullPage: true });
        await expect(page.getByRole('heading', { name: challenge.blocked ? 'Outmatched by the fish.' : 'Fine River Fish', exact: true })).toBeVisible();
        const state = readResourceGathering(runtime.character().resourceGathering), receipt = state.receipts.at(-1)!;
        expect(receipt).toMatchObject({ outcome: challenge.blocked ? 'failed' : 'success', xp: challenge.blocked ? 3 : 10,
            fishingCatch: { name: challenge.species, requiredLevel: challenge.required, fisherLevel: challenge.level, tooStrong: challenge.blocked } });
        if (challenge.blocked) { expect(receipt.itemId).toBeUndefined(); await expect(page.getByRole('region', { name: 'Fishing result' })).toContainText(`requires Fishing Lv.${challenge.required}`); }
        expect(state.attemptsToday).toBe(1); expect(runtime.settlements()).toBe(1);
        await noOverflow(page);
        expect((await new AxeBuilder({ page }).include('.resource-dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    });
}

for (const deposit of [{ id: 'resource-15', skin: 'frozen' }, { id: 'resource-22', skin: 'volcanic' }, { id: 'resource-14', skin: 'crystal' }]) {
    test(`${deposit.skin} deposits keep their terrain identity through a three-charge fracture`, async ({ page }, info) => {
        const runtime = await install(page, deposit.id);
        await page.goto(`/e2e/fixtures/resource-gathering.html?node=${deposit.id}`);
        await page.getByRole('button', { name: new RegExp(`^${runtime.node.name}, mining`) }).click();
        await page.getByRole('button', { name: 'Begin mining · 1 action' }).click();
        await expect(page.locator(`.vein-scene--${deposit.skin}`)).toBeVisible();
        for (const site of ['Crown seam', 'East seam', 'West seam']) await page.getByRole('button', { name: new RegExp(`^${site}`) }).click();
        await expect(page.getByText('3 / 3 seals placed', { exact: false })).toBeVisible();
        await page.screenshot({ path: info.outputPath(`${deposit.skin}-fracture.png`), fullPage: true });
        await page.getByRole('button', { name: 'Release fracture', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Superior Iron Sand', exact: true })).toBeVisible();
        expect(runtime.settlements()).toBe(1);
        await noOverflow(page);
    });
}

for (const template of [3, 4, 5, 6, 7]) test(`Veinbreaking formation ${template} supports readable paths and a clean server extraction`, async ({ page }, info) => {
    const nodeId = template < 5 ? 'resource-13' : 'resource-15';
    const runtime = await install(page, nodeId, 0, 3200, 3200, { template });
    await page.goto(`/e2e/fixtures/resource-gathering.html?node=${nodeId}`);
    await page.getByRole('button', { name: new RegExp(`^${runtime.node.name}, mining`) }).click();
    await page.getByRole('button', { name: 'Begin mining · 1 action' }).click();
    await expect(page.getByRole('heading', { name: 'Veinbreaking', exact: true })).toBeVisible();
    await expect(page.locator('.vein-talisman').first()).toBeVisible();
    await page.getByRole('button', { name: 'Read seam', exact: true }).click();
    await expect(page.locator('.vein-scan')).toBeAttached();
    const formation = FRACTURE_TEMPLATES[template];
    for (const seal of await page.locator('.vein-seal').all()) await expectVisibleTouchTarget(seal);
    expect(await page.locator('.vein-seal').evaluateAll(seals => {
        const boxes = seals.map(seal => seal.getBoundingClientRect());
        return boxes.every((a, i) => boxes.slice(i + 1).every(b =>
            Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 1 || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 1));
    }), 'seal touch targets must not overlap').toBe(true);
    for (const site of formation.sites.slice(0, formation.charges)) {
        const seal = page.getByRole('button', { name: new RegExp(`^${site.label}, reaches`) });
        await expectVisibleTouchTarget(seal); await seal.click();
    }
    await expect(page.getByRole('status').filter({ hasText: `${formation.faces} / ${formation.faces} pockets reached` })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`veinbreaking-${template}-placed.png`), fullPage: true });
    await page.getByRole('button', { name: 'Release fracture', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Mining result' })).toContainText('Added to your inventory');
    expect(runtime.settlements()).toBe(1);
    expect(readResourceGathering(runtime.character().resourceGathering).attemptsToday).toBe(1);
});

test('Veinbreaking previews crossing damage and distinguishes a clean extraction failure', async ({ page }) => {
    await install(page, 'resource-13', 0, 3200, 3200, { successDraw: .999 });
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-13');
    await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    await page.getByRole('button', { name: 'Begin mining · 1 action' }).click();
    await page.getByRole('button', { name: /^Northwest seam/ }).click();
    await page.getByRole('button', { name: /^East cross-fault/ }).click();
    await expect(page.getByText('1 pocket under crossing fractures', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^East cross-fault/ }).click();
    await page.getByRole('button', { name: /^Southeast seam/ }).click();
    await page.getByRole('button', { name: 'Release fracture', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Mining result' })).toContainText('The fracture held, but no usable ore could be extracted.');
});

test('Veinbreaking propagates cracks, sheds stone and honors reduced motion', async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await install(page);
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-13');
    await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    await page.getByRole('button', { name: 'Begin mining · 1 action' }).click();
    await page.getByRole('button', { name: /^Northwest seam/ }).click();
    await page.getByRole('button', { name: /^Southeast seam/ }).click();
    await expect(page.locator('.vein-talisman').first()).toHaveClass(/is-primed/);
    await expect(page.locator('.vein-talisman').first()).not.toHaveClass(/is-igniting/);
    await page.getByRole('button', { name: 'Release fracture', exact: true }).click();
    await expect(page.locator('.vein-fault.is-fired').first()).toBeAttached();
    await expect(page.locator('.vein-shell.is-loose').first()).toBeAttached();
    const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    await expect(page.locator('.vein-talisman').first()).toHaveClass(/is-igniting/);
    await expect(page.locator('.vein-seal:not(.is-placed) .vein-talisman.is-igniting')).toHaveCount(0);
    await expect(page.locator('.vein-seal.is-fired .vein-talisman-paper').first()).toHaveCSS('animation-name', reduced ? 'none' : 'vein-talisman-scorch');
    await expect(page.locator('.vein-seal.is-fired .vein-talisman-flame').first()).toHaveCSS('animation-name', reduced ? 'none' : 'vein-talisman-flame');
    await expect(page.locator('.vein-fault.is-fired').first()).toHaveCSS('animation-name', reduced ? 'none' : 'vein-crack');
    if (reduced) await expect(page.locator('.vein-debris').first()).toHaveCSS('display', 'none');
    await page.screenshot({ path: info.outputPath('veinbreaking-fracture-in-motion.png'), fullPage: true, animations: 'allow' });
    await expect(page.getByRole('region', { name: 'Mining result' })).toBeVisible();
    expect(errors).toEqual([]);
});

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
    await page.getByRole('button', { name: 'Release fracture', exact: true }).click();
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
    await expect(page.locator('.vein-talisman').first()).toBeVisible();
    await expect(page.locator('.vein-scene img[src*="pickaxe"]')).toHaveCount(0);
    await page.addInitScript(seed => { (window as unknown as { resourceSeed: unknown }).resourceSeed = seed; }, runtime.character());
    await page.reload();
    await page.getByRole('button', { name: 'Collect result', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Fine Iron Sand', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Mining result' }).getByText('2/3', { exact: true })).toBeVisible();
    await expect(page.getByText('This node replenishes in 10 minutes.')).toHaveCount(0);
    await page.getByRole('button', { name: 'Mine again', exact: false }).click();
    await expect(page.getByText('Action spent · 2/100 today')).toBeVisible();
    expect(readResourceGathering(runtime.character().resourceGathering).active?.mode).toBe('relaxed');
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

for (const activity of ['mining', 'fishing'] as const) {
    test(`${activity} first open recovers an overtaken status without a manual retry`, async ({ page }, info) => {
        const nodeId = activity === 'mining' ? 'resource-13' : 'resource-1';
        const runtime = await install(page, nodeId);
        let statusCalls = 0, version = 1;
        let release!: () => void;
        const delayed = () => new Promise<void>(resolve => { release = resolve; });
        let waiting = delayed();
        await page.route('**/api/world/resource', async route => {
            if (route.request().postDataJSON().action !== 'status') return route.fallback();
            const snapshot = { ...runtime.character() }, snapshotVersion = version;
            statusCalls++;
            if (statusCalls % 2 === 1) await waiting;
            await route.fulfill({ json: { ok: true, character: snapshot, _saveVersion: snapshotVersion } });
        });
        await page.goto(`/e2e/fixtures/resource-gathering.html?node=${nodeId}&lifecycle=1`);
        for (let opening = 0; opening < 3; opening++) {
            await expect.poll(() => statusCalls).toBe(opening * 2 + 1);
            // Another normal save wins while the mount-time status is in flight.
            version = runtime.publishSave();
            await page.getByTestId('gathering-publish-save').click();
            await page.getByRole('button', { name: new RegExp(`^${runtime.node.name}, ${activity}`) }).click();
            await expect(page.getByRole('status')).toContainText('Checking your gathering attempt');
            release();
            await expect(page.getByRole('button', { name: activity === 'mining' ? 'Begin mining · 1 action' : 'Ready kunai · 1 action' })).toBeEnabled();
            expect(statusCalls).toBe((opening + 1) * 2);
            await expect(page.getByRole('button', { name: 'Check gathering again', exact: true })).toHaveCount(0);
            const state = JSON.parse(await page.getByTestId('resource-state').textContent() ?? '{}');
            expect(state.version).toBe(version); expect(state.character.ryo).toBe(runtime.character().ryo);
            expect(readResourceGathering(state.character.resourceGathering).attemptsToday).toBe(0);
            if (opening < 2) {
                await page.getByRole('button', { name: 'Close', exact: true }).click();
                await page.getByTestId('gathering-mount').click();
                waiting = delayed();
                await page.getByTestId('gathering-mount').click();
            }
        }
        await page.screenshot({ path: info.outputPath(`${activity}-first-open-recovered.png`), fullPage: true });
        await page.getByRole('button', { name: activity === 'mining' ? 'Begin mining · 1 action' : 'Ready kunai · 1 action' }).click();
        await expect(page.locator('.resource-attempt-strip')).toBeVisible();
        expect(readResourceGathering(runtime.character().resourceGathering).attemptsToday).toBe(1);
        expect(runtime.settlements()).toBe(0);
    });

    test(`${activity} restored controls wait for status and retry rejected saves without spending twice`, async ({ page }, info) => {
        const nodeId = activity === 'mining' ? 'resource-13' : 'resource-1';
        const runtime = await install(page, nodeId);
        await page.goto(`/e2e/fixtures/resource-gathering.html?node=${nodeId}`);
        await page.getByRole('button', { name: new RegExp(`^${runtime.node.name}, ${activity}`) }).click();
        await page.getByRole('radio', { name: /Watch animation/ }).check();
        await page.getByRole('button', { name: activity === 'mining' ? 'Begin mining · 1 action' : 'Ready kunai · 1 action' }).click();
        // This case rejects a status version after an acknowledged admission;
        // wait for that acknowledgement before intentionally reloading.
        await expect(page.locator('.resource-attempt-strip')).toBeVisible();
        const admitted = runtime.character();
        await page.addInitScript(seed => { (window as unknown as { resourceSeed: unknown }).resourceSeed = seed; }, admitted);
        let release!: () => void;
        const delayed = new Promise<void>(resolve => { release = resolve; });
        await page.route('**/api/world/resource', async route => {
            if (route.request().postDataJSON().action !== 'status') return route.fallback();
            await delayed;
            return route.fulfill({ json: { ok: true, character: admitted, _saveVersion: 0 } });
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('status')).toContainText('Checking your gathering attempt');
        await expect(page.getByRole('button', { name: 'Collect result', exact: true })).toHaveCount(0);
        await page.screenshot({ path: info.outputPath(`${activity}-status-pending.png`), fullPage: true });
        release();
        await expect(page.getByRole('button', { name: 'Check gathering again', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Collect result', exact: true })).toHaveCount(0);
        await page.unroute('**/api/world/resource');
        // Reinstall the successful status responder without replacing the
        // attempt or private seal held by the original broader fixture route.
        await page.route('**/api/world/resource', route => route.request().postDataJSON().action === 'status'
            ? route.fulfill({ json: { ok: true, character: admitted, _saveVersion: 2 } }) : route.fallback());
        await page.getByRole('button', { name: 'Check gathering again', exact: true }).click();
        await expect(activity === 'fishing' ? page.getByRole('application', { name: 'Kunai fishing pool' }) : page.getByRole('button', { name: 'Collect result', exact: true })).toBeVisible();
        expect(readResourceGathering(runtime.character().resourceGathering).attemptsToday).toBe(1);
        expect(runtime.settlements()).toBe(0);
    });
}

test('changing selected nodes during the status readback keeps the current node and spends nothing', async ({ page }) => {
    const runtime = await install(page);
    let calls = 0, releaseInitial!: () => void, releaseCurrent!: () => void;
    const initial = new Promise<void>(resolve => { releaseInitial = resolve; });
    const current = new Promise<void>(resolve => { releaseCurrent = resolve; });
    await page.route('**/api/world/resource', async route => {
        const body = route.request().postDataJSON();
        if (body.action !== 'status') return route.fallback();
        expect(body.nodeId).toBeUndefined();
        const snapshot = { ...runtime.character() }, version = ++calls;
        await (calls === 1 ? initial : current);
        await route.fulfill({ json: { ok: true, character: snapshot, _saveVersion: version } });
    });
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-13&lifecycle=1');
    await expect.poll(() => calls).toBe(1);
    runtime.publishSave(); await page.getByTestId('gathering-publish-save').click();
    await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    releaseInitial(); await expect.poll(() => calls).toBe(2);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: /^Dockside shoal, fishing/ }).click();
    await expect(page.getByRole('status')).toContainText('Checking your gathering attempt');
    releaseCurrent();
    await expect(page.getByRole('dialog', { name: 'Dockside shoal', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approach shore', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Begin mining · 1 action' })).toHaveCount(0);
    const state = JSON.parse(await page.getByTestId('resource-state').textContent() ?? '{}');
    expect(state.version).toBe(2); expect(readResourceGathering(state.character.resourceGathering).attemptsToday).toBe(0);
    expect(calls).toBe(2); expect(runtime.settlements()).toBe(0);
});

for (const failure of ['service', 'stale'] as const) {
    test(`initial ${failure} failure keeps recovery explicit and bounded`, async ({ page }) => {
        const runtime = await install(page);
        let calls = 0, release!: () => void, recover = false;
        const waiting = new Promise<void>(resolve => { release = resolve; });
        await page.route('**/api/world/resource', async route => {
            if (route.request().postDataJSON().action !== 'status') return route.fallback();
            calls++;
            await waiting;
            if (recover) return route.fulfill({ json: { ok: true, character: runtime.character(), _saveVersion: 2 } });
            return route.fulfill(failure === 'service'
                ? { status: 503, json: { ok: false, error: 'Gathering service unavailable.' } }
                : { json: { ok: true, character: runtime.character(), _saveVersion: 1 } });
        });
        await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-13&lifecycle=1');
        await expect.poll(() => calls).toBe(1);
        runtime.publishSave(); await page.getByTestId('gathering-publish-save').click();
        await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
        release();
        const retry = page.getByRole('button', { name: 'Check gathering again', exact: true });
        await expect(retry).toBeVisible();
        expect(calls).toBe(failure === 'service' ? 1 : 2);
        await expect(page.getByRole('button', { name: 'Begin mining · 1 action' })).toHaveCount(0);
        if (failure === 'service') await expect(page.getByRole('alert')).toContainText('Gathering service unavailable.');
        recover = true; await retry.click();
        await expect(page.getByRole('button', { name: 'Begin mining · 1 action' })).toBeEnabled();
        expect(calls).toBe(failure === 'service' ? 2 : 3);
        expect(readResourceGathering(runtime.character().resourceGathering).attemptsToday).toBe(0);
    });
}

test('a late status response cannot commit after the gathering surface unmounts', async ({ page }) => {
    const runtime = await install(page);
    let received!: () => void, release!: () => void;
    const incoming = new Promise<void>(resolve => { received = resolve; });
    const delayed = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/world/resource', async route => {
        if (route.request().postDataJSON().action !== 'status') return route.fallback();
        received(); await delayed;
        await route.fulfill({ json: { ok: true, character: { ...runtime.character(), ryo: 99999999 }, _saveVersion: 99 } });
    });
    await page.goto('/e2e/fixtures/resource-gathering.html?lifecycle=1'); await incoming;
    await page.getByTestId('gathering-mount').click();
    await expect(page.getByRole('button', { name: /^Harbor iron seam, mining/ })).toHaveCount(0);
    const response = page.waitForResponse(response => response.url().endsWith('/world/resource') && response.request().postDataJSON().action === 'status');
    release(); await response;
    // Two paint frames let the asynchronous callback run; it must keep both
    // the save and its accepted version untouched after the screen has left.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const state = JSON.parse((await page.getByTestId('resource-state').textContent())!);
    expect(state.version).toBe(1); expect(state.character.ryo).toBe(runtime.character().ryo);
});

test('mining settlement recovery stays reachable after a transient resolve error', async ({ page }, info) => {
    await install(page);
    let failOnce = true;
    await page.route('**/api/world/resource', route => {
        if (route.request().postDataJSON().action === 'resolve' && failOnce) {
            failOnce = false;
            return route.fulfill({ status: 503, json: { ok: false, error: 'Temporary gathering connection error.' } });
        }
        return route.fallback();
    });
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-13');
    await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    await page.getByRole('button', { name: 'Begin mining · 1 action' }).click();
    await page.getByRole('button', { name: /^Northwest seam/ }).click();
    await page.getByRole('button', { name: /^Southeast seam/ }).click();
    await page.getByRole('button', { name: 'Release fracture', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Temporary gathering connection error.');
    const recover = page.getByRole('button', { name: 'Recover result', exact: true });
    await expect(recover).toBeVisible();
    if (info.project.name.includes('landscape')) await expectVisibleTouchTarget(recover);
    await page.screenshot({ path: info.outputPath('mining-retry-control.png'), fullPage: true });
    await recover.click();
    await expect(page.getByRole('region', { name: 'Mining result' })).toContainText('2/3');
});

test('reload during committed mining detonation cannot reopen or improve its formation', async ({ page }, info) => {
    const runtime = await install(page);
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-13');
    await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    await page.getByRole('button', { name: 'Begin mining · 1 action' }).click();
    await page.getByRole('button', { name: /^Northwest seam/ }).click();
    await page.getByRole('button', { name: /^East cross-fault/ }).click();
    await page.getByRole('button', { name: 'Release fracture', exact: true }).click();
    await page.addInitScript(seed => { (window as unknown as { resourceSeed: unknown }).resourceSeed = seed; }, runtime.character());
    // Keep settlement unresolved across the document transition so the test
    // checks the frozen input phase rather than simply reading a final receipt.
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/world/resource', async route => {
        if (route.request().postDataJSON().action !== 'resolve') return route.fallback();
        await delayed; return route.fallback();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.vein-scene')).toBeVisible();
    for (const charge of await page.locator('.vein-seal').all()) await expect(charge).toBeDisabled();
    await expect(page.getByRole('button', { name: /^East cross-fault/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /^Southeast seam/ })).toHaveAttribute('aria-pressed', 'false');
    await page.screenshot({ path: info.outputPath('mining-detonation-restored.png'), fullPage: true });
    release();
    await expect(page.getByRole('heading', { name: 'The seam gave way.', exact: true })).toBeVisible();
    const state = readResourceGathering(runtime.character().resourceGathering);
    expect(state.receipts.at(-1)).toMatchObject({ outcome: 'failed', xp: 3 });
    expect(state.attemptsToday).toBe(1); expect(runtime.settlements()).toBe(1);
});

test('reload resumes spent talismans without replaying their ignition or spending another action', async ({ page }, info) => {
    const runtime = await install(page);
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/world/resource', async route => {
        if (route.request().postDataJSON().action !== 'resolve') return route.fallback();
        await delayed; return route.fallback();
    });
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-13');
    await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    await page.getByRole('button', { name: 'Begin mining · 1 action' }).click();
    for (const site of ['Northwest seam', 'Southeast seam']) await page.getByRole('button', { name: new RegExp(`^${site}`) }).click();
    await page.getByRole('button', { name: 'Release fracture', exact: true }).click();
    await expect(page.locator('.vein-seal.is-fired')).toHaveCount(2);
    await expect(page.locator('.vein-seal.is-fired .vein-talisman-char').last()).toHaveCSS('opacity', '1');
    await page.addInitScript(seed => { (window as unknown as { resourceSeed: unknown }).resourceSeed = seed; }, runtime.character());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.vein-seal.is-fired')).toHaveCount(2);
    await expect(page.locator('.vein-seal.is-fired .vein-talisman-flame').first()).toHaveCSS('opacity', '0');
    await expect(page.locator('.vein-seal.is-fired .vein-talisman-char').first()).toHaveCSS('opacity', '1');
    const delay = await page.locator('.vein-seal.is-fired .vein-talisman-paper').first().evaluate(element => parseFloat(getComputedStyle(element).animationDelay));
    // Reduced motion uses a static spent state; normal motion must resume
    // beyond the original burn instead of starting a fresh flame on reload.
    if (!await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)) expect(delay).toBeLessThan(-.5);
    await page.screenshot({ path: info.outputPath('mining-spent-talismans-restored.png'), fullPage: true });
    release();
    await expect(page.getByRole('region', { name: 'Mining result' })).toBeVisible();
    expect(runtime.settlements()).toBe(1);
    expect(readResourceGathering(runtime.character().resourceGathering).attemptsToday).toBe(1);
});

test('reload recovers the same committed mining receipt after a lost acknowledgement', async ({ page }, info) => {
    const runtime = await install(page);
    await page.goto('/e2e/fixtures/resource-gathering.html?node=resource-13');
    await page.getByRole('button', { name: /^Harbor iron seam, mining/ }).click();
    await page.getByRole('button', { name: 'Begin mining · 1 action' }).click();
    const admitted = runtime.character();
    await page.getByRole('button', { name: /^Northwest seam/ }).click();
    await page.getByRole('button', { name: /^East cross-fault/ }).click();
    runtime.loseAckOnce();
    await page.getByRole('button', { name: 'Release fracture', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Settlement acknowledgement lost.');
    await page.addInitScript(seed => { (window as unknown as { resourceSeed: unknown }).resourceSeed = seed; }, admitted);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'The seam gave way.', exact: true })).toBeVisible();
    await expect(page.locator('.vein-seal')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Mining result' })).toContainText('2/3');
    expect(runtime.settlements()).toBe(1);
    const state = readResourceGathering(runtime.character().resourceGathering);
    expect(state.attemptsToday).toBe(1); expect(state.receipts).toHaveLength(1); expect(state.receipts[0].xp).toBe(3);
    await page.screenshot({ path: info.outputPath('mining-lost-ack-recovered.png'), fullPage: true });
});
