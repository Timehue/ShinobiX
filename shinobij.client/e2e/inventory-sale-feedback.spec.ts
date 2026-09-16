import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

// Main smoke supplies two representative layouts; the focused matrix also runs WebKit and narrow phones.
test.beforeEach(({ browserName }, testInfo) => {
    test.skip(!process.env.BANK_AUDIT_MATRIX && (browserName !== 'chromium' || !['chromium-desktop', 'chromium-mobile'].includes(testInfo.project.name)), 'Inventory sale journeys cover desktop and mobile Chromium.');
});

const diagnostics = new WeakMap<Page, { errors: string[]; messages: { type: string; text: string }[] }>();
test.afterEach(async ({ page }, testInfo) => {
    const entry = diagnostics.get(page);
    if (!entry) return;
    if (process.env.BANK_AUDIT_PHASE) {
        const output = resolve('test-results/safe-consolidation', process.env.BANK_AUDIT_PHASE);
        mkdirSync(output, { recursive: true });
        const name = `${testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${page.viewportSize()!.width}`;
        writeFileSync(resolve(output, `${name}-runtime.json`), JSON.stringify(entry, null, 2));
    }
    expect(entry.errors).toEqual([]);
    expect(entry.messages.filter(message => message.text.includes('[ScreenErrorBoundary]'))).toEqual([]);
    await expect(page.getByRole('heading', { name: 'This screen hit a snag', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

async function fixture(page: Page) {
    const entry = { errors: [] as string[], messages: [] as { type: string; text: string }[] };
    diagnostics.set(page, entry);
    page.on('pageerror', error => entry.errors.push(error.message));
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) entry.messages.push({ type: message.type(), text: message.text() }); });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    const save = uiAuditSave();
    save.currentSector = 0;
    save.character = { ...save.character, ryo: 10000, inventory: ['shinobi-vest', 'shinobi-vest', 'shinobi-vest', 'rustfang-kunai'], itemStacks: [], equipment: {}, tileCards: [] };
    const runtime = await installUiAuditRuntime(page, save);
    async function boot() {
        await expectUiAuditBoot(page, runtime, 'inventory');
        await expect(page.getByRole('heading', { name: 'Equipped', exact: true })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
    }
    async function acceptSale(route: Route, stale = false) {
        const character = { ...save.character, inventory: ['rustfang-kunai'], itemStacks: [], ryo: 10270 };
        const version = runtime.currentVersion() + (stale ? -1 : 1);
        if (!stale) runtime.commitServerCharacter(character, version);
        await route.fulfill({ json: { ok: true, character, settlement: { kind: 'inventory-sale', itemId: 'shinobi-vest', quantity: 3, ryo: 270 }, _saveVersion: version } });
    }
    return { boot, acceptSale };
}

async function keyboardOpenItem(page: Page, name: string) {
    const opener = page.getByRole('button', { name, exact: true });
    for (let step = 0; step < 100; step++) {
        if (await opener.evaluate(node => node === document.activeElement)) break;
        await page.keyboard.press('Tab');
    }
    await expect(opener).toBeFocused();
    await page.keyboard.press('Enter');
}

async function openVest(page: Page, keyboard = false) {
    if (keyboard) await keyboardOpenItem(page, 'Inspect Shinobi Vest');
    else await page.getByRole('button', { name: 'Inspect Shinobi Vest', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Shinobi Vest item details', exact: true });
    await expect(dialog).toBeVisible();
    return dialog;
}

async function capture(page: Page, label: string) {
    if (!process.env.BANK_AUDIT_PHASE) return;
    const output = resolve('test-results/safe-consolidation', process.env.BANK_AUDIT_PHASE);
    mkdirSync(output, { recursive: true });
    const name = `${label}-${page.viewportSize()!.width}`;
    await page.screenshot({ path: resolve(output, `${name}.png`) });
    writeFileSync(resolve(output, `${name}.txt`), await page.locator('body').innerText());
    if (label === 'inventory-late-error-closed') {
        const notice = await page.locator('#inventory-sale-error').evaluate(node => {
            const rect = node.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        });
        const dismiss = await page.getByRole('button', { name: 'Dismiss sale notice', exact: true }).evaluate(node => {
            const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, padding: style.padding, fontSize: style.fontSize, color: style.color, background: style.background, border: style.border };
        });
        writeFileSync(resolve(output, `${name}-bounds.json`), JSON.stringify({ notice, dismiss }, null, 2));
    }
}

test('Inventory guards a pending Sell All and keeps a newly opened selection after its accepted receipt', async ({ page }) => {
    const { boot, acceptSale } = await fixture(page);
    let release: (() => void) | undefined;
    const held = new Promise<void>(resolve => { release = resolve; });
    const requests: Record<string, unknown>[] = [];
    await page.route('**/api/inventory/sell', async route => {
        requests.push(route.request().postDataJSON());
        await held;
        await acceptSale(route);
    });
    await boot();
    const vest = await openVest(page, true);
    const all = vest.getByRole('button', { name: /Sell All x3/ });
    await all.evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
    await expect.poll(() => requests.length).toBe(1);
    await expect(all).toBeDisabled();
    await expect(all).toHaveAttribute('aria-busy', 'true');
    await expect(vest.getByRole('button', { name: 'Sell for 90 ryo', exact: true })).toBeDisabled();
    await expect(vest.getByRole('status')).toContainText('Selling 3 × Shinobi Vest');
    await expect(vest.getByRole('button', { name: 'Close item details', exact: true })).toBeEnabled();
    await capture(page, 'inventory-sale-pending');
    await page.keyboard.press('Escape');
    await expect(vest).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Inspect Shinobi Vest', exact: true })).toBeFocused();
    await keyboardOpenItem(page, 'Inspect Rustfang Kunai');
    const kunai = page.getByRole('dialog', { name: 'Rustfang Kunai item details', exact: true });
    await expect(kunai).toBeVisible();
    release!();
    await expect(page.locator('.game-toast-stack')).toContainText('Sold 3 × Shinobi Vest for 270 ryo.');
    await expect(kunai).toBeVisible();
    await expect(kunai.getByRole('button', { name: 'Sell for 112 ryo', exact: true })).toBeEnabled();
    await expect(page.getByRole('alertdialog', { name: 'Notice', exact: true })).toHaveCount(0);
    await capture(page, 'inventory-sale-receipt-new-selection');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Inspect Shinobi Vest', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Inspect Rustfang Kunai', exact: true })).toBeFocused();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ playerName: 'AuditNinja', itemId: 'shinobi-vest', source: 'backpack', quantity: 3 });
    expect(requests[0].requestId).toBeTruthy();
    // This reload reads the in-memory mock server snapshot, not a real backend.
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Inspect Shinobi Vest', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Inspect Rustfang Kunai', exact: true })).toBeVisible();
});

test('Inventory preserves an interrupted sale with inline recovery and distinguishes a confirmed rejection', async ({ page }) => {
    const { boot, acceptSale } = await fixture(page);
    let mode = 'network';
    const requests: Record<string, unknown>[] = [];
    await page.route('**/api/inventory/sell', async route => {
        requests.push(route.request().postDataJSON());
        if (mode === 'network') return route.abort('failed');
        if (mode === 'server') return route.fulfill({ status: 503, json: { error: 'temporary backend detail' } });
        if (mode === 'timeout') return route.fulfill({ status: 408, json: { error: 'timeout backend detail' } });
        if (mode === 'malformed') return route.fulfill({ status: 200, contentType: 'application/json', body: 'not json' });
        if (mode === 'rejected') return route.fulfill({ status: 400, json: { error: 'Item is not available in your backpack.' } });
        return acceptSale(route);
    });
    await boot();
    const vest = await openVest(page);
    for (const response of ['network', 'server', 'timeout', 'malformed', 'rejected']) {
        mode = response;
        await vest.getByRole('button', { name: /Sell All x3/ }).click();
        const warning = vest.locator('#inventory-sale-error');
        await expect(warning).toContainText(response === 'rejected' ? 'Item is not available in your backpack.' : 'Action unconfirmed. Refresh before retrying.');
        await expect(warning).toHaveAttribute('role', 'alert');
        await expect(vest).toContainText('Inventory Count: 3');
        await expect(vest.getByRole('button', { name: /Sell All x3/ })).toBeEnabled();
        await expect(page.locator('.game-toast-stack')).toHaveCount(0);
        await expect(page.getByRole('alertdialog', { name: 'Notice', exact: true })).toHaveCount(0);
        await capture(page, `inventory-sale-${response}`);
    }
    expect(requests[1].requestId).toBe(requests[0].requestId);
    mode = 'accepted';
    await vest.getByRole('button', { name: /Sell All x3/ }).click();
    await expect(vest).toHaveCount(0);
    await expect(page.locator('.game-toast-stack')).toContainText('Sold 3 × Shinobi Vest for 270 ryo.');
    expect(requests).toHaveLength(6);
});

test('Inventory explains an unaccepted character version and retains the selected item and Escape focus', async ({ page }) => {
    const { boot, acceptSale } = await fixture(page);
    let requests = 0;
    await page.route('**/api/inventory/sell', route => { requests++; return acceptSale(route, true); });
    await boot();
    const vest = await openVest(page, true);
    await vest.getByRole('button', { name: /Sell All x3/ }).click();
    await expect(vest.locator('#inventory-sale-error')).toContainText('Action unconfirmed. Refresh before retrying.');
    await expect(vest).toContainText('Inventory Count: 3');
    await expect(vest.getByRole('button', { name: /Sell All x3/ })).toBeEnabled();
    await expect(page.locator('.game-toast-stack')).toHaveCount(0);
    await capture(page, 'inventory-sale-stale-version');
    await page.keyboard.press('Escape');
    await expect(vest).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Inspect Shinobi Vest', exact: true })).toBeFocused();
    expect(requests).toBe(1);
});

test('Inventory keeps late sale failures visible after closing details or opening another item', async ({ page }) => {
    const { boot } = await fixture(page);
    let release: (() => void) | undefined;
    let requests = 0;
    await page.route('**/api/inventory/sell', async route => {
        requests++;
        await new Promise<void>(resolve => { release = resolve; });
        if (requests === 1) return route.abort('failed');
        return route.fulfill({ status: 400, json: { error: 'Item is not available in your backpack.' } });
    });
    await boot();
    for (const otherSelection of [false, true]) {
        const vest = await openVest(page);
        await vest.getByRole('button', { name: /Sell All x3/ }).click();
        await expect.poll(() => requests).toBe(otherSelection ? 2 : 1);
        await vest.getByRole('button', { name: 'Close item details', exact: true }).click();
        await expect(vest).toHaveCount(0);
        if (otherSelection) await page.getByRole('button', { name: 'Inspect Rustfang Kunai', exact: true }).click();
        release!();
        const context = otherSelection ? page.getByRole('dialog', { name: 'Rustfang Kunai item details', exact: true }) : page.locator('.center-game');
        const warning = context.locator('#inventory-sale-error');
        await expect(warning).toBeVisible();
        await expect(warning).toBeInViewport();
        const dismiss = context.getByRole('button', { name: 'Dismiss sale notice', exact: true });
        await expect(dismiss).toBeInViewport({ ratio: 1 });
        // The modal entrance can briefly produce a subpixel transform on its 44px target.
        if (page.viewportSize()!.width <= 390) await expect.poll(async () => Math.round((await dismiss.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
        await expect(warning).toContainText('Shinobi Vest sale:');
        await expect(warning).toContainText(otherSelection ? 'Item is not available in your backpack.' : 'Action unconfirmed. Refresh before retrying.');
        await expect(page.getByRole('alertdialog', { name: 'Notice', exact: true })).toHaveCount(0);
        await expect(page.locator('.game-toast-stack')).toHaveCount(0);
        await capture(page, otherSelection ? 'inventory-late-error-other-selection' : 'inventory-late-error-closed');
        await dismiss.click();
        await expect(page.locator('#inventory-sale-error')).toHaveCount(0);
        if (otherSelection) {
            await expect(context).toBeVisible();
            await page.keyboard.press('Escape');
        }
    }
});
