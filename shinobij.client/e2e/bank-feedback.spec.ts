import { expect, test, type Page, type Locator } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

// Both layouts are covered once; the general smoke suite supplies other browser coverage.
test.beforeEach(({ browserName }, testInfo) => {
    test.skip(!process.env.BANK_AUDIT_MATRIX && (browserName !== 'chromium' || !['chromium-desktop', 'chromium-mobile'].includes(testInfo.project.name)), 'Bank journeys cover desktop and mobile Chromium.');
});

const diagnostics = new WeakMap<Page, { pageErrors: string[]; messages: { type: string; text: string }[] }>();
test.afterEach(async ({ page }, testInfo) => {
    const entry = diagnostics.get(page);
    if (!entry) return;
    if (process.env.BANK_AUDIT_PHASE) {
        const output = resolve('test-results/safe-consolidation', process.env.BANK_AUDIT_PHASE);
        mkdirSync(output, { recursive: true });
        const name = `${testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${page.viewportSize()!.width}`;
        writeFileSync(resolve(output, `${name}-runtime.json`), JSON.stringify(entry, null, 2));
    }
    expect(entry.pageErrors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const clipped = await page.locator('.bank-screen button, .bank-screen input, .bank-screen select').evaluateAll(nodes => nodes.filter(node => {
        const style = getComputedStyle(node), rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
    }).map(node => node.getAttribute('id') || node.textContent?.trim()));
    expect(clipped).toEqual([]);
});

async function bankFixture(page: Page, overrides: Record<string, unknown> = {}) {
    const entry = { pageErrors: [] as string[], messages: [] as { type: string; text: string }[] };
    diagnostics.set(page, entry);
    page.on('pageerror', error => entry.pageErrors.push(error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) entry.messages.push({ type: message.type(), text: message.text() }); });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    const save = uiAuditSave();
    save.currentSector = 0;
    save.character = { ...save.character, ryo: 10000, bankRyo: 20000, villageUpgrades: { bank: 50 }, lastBankInterestAt: 0, ...overrides };
    const runtime = await installUiAuditRuntime(page, save);
    return { save, runtime };
}

async function capture(page: Page, label: string) {
    if (!process.env.BANK_AUDIT_PHASE) return;
    const output = resolve('test-results/safe-consolidation', process.env.BANK_AUDIT_PHASE);
    mkdirSync(output, { recursive: true });
    const name = `${label}-${page.viewportSize()!.width}`;
    await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
    if (['bank-overview', 'bank-wire-validation'].includes(label)) await page.screenshot({ path: resolve(output, `${name}-viewport.png`) });
    writeFileSync(resolve(output, `${name}.txt`), await page.locator('body').innerText());
    if (label === 'bank-overview') {
        const styles = await page.locator('.bank-balance-rail, .bank-wire-preview, .bank-interest-callout').evaluateAll(nodes => nodes.map(node => {
            const style = getComputedStyle(node), rect = node.getBoundingClientRect();
            return { className: node.className, bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, display: style.display, border: style.border, background: style.background, gap: style.gap, marginTop: style.marginTop, padding: style.padding, borderRadius: style.borderRadius, gridTemplateColumns: style.gridTemplateColumns };
        }));
        writeFileSync(resolve(output, `bank-styles-${page.viewportSize()!.width}.json`), JSON.stringify(styles, null, 2));
    }
}

async function expectFieldError(page: Page, field: Locator, message: RegExp) {
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toBeFocused();
    const description = await field.getAttribute('aria-describedby');
    expect(description).toBeTruthy();
    await expect(page.locator(`#${description!.split(' ')[0]}`)).toContainText(message);
    await expect(page.getByRole('alertdialog', { name: 'Notice', exact: true })).toHaveCount(0);
}

async function dismissNotice(page: Page) {
    const notice = page.getByRole('alertdialog', { name: 'Notice', exact: true });
    if (await notice.count()) await notice.getByRole('button', { name: 'OK', exact: true }).click();
}

test('Bank associates validation with fields and preserves entered amounts', async ({ page }) => {
    const { runtime } = await bankFixture(page);
    let mutations = 0;
    await page.route('**/api/bank/transfer', async route => { mutations++; return route.abort(); });
    await page.route('**/api/player/trade', route => { mutations++; return route.abort(); });
    await expectUiAuditBoot(page, runtime, 'bank');
    await capture(page, 'bank-overview');
    const amount = page.locator('#bank-transfer-amount');
    await page.getByRole('button', { name: 'Deposit to vault', exact: true }).click();
    await expectFieldError(page, amount, /positive amount/i);
    await capture(page, 'bank-validation');
    await amount.press('ControlOrMeta+A');
    await page.keyboard.type('30000');
    await page.getByRole('button', { name: 'Withdraw to wallet', exact: true }).click();
    await expectFieldError(page, amount, /not enough banked ryo/i);
    await expect(amount).toHaveValue('30000');
    for (const [name, value] of [['Half wallet', '5000'], ['Max wallet', '10000'], ['Max vault', '20000']]) {
        await page.getByRole('button', { name, exact: true }).click();
        await expect(amount).toHaveValue(value);
        await expect(amount).not.toHaveAttribute('aria-invalid', 'true');
    }
    await page.getByRole('button', { name: 'Review & send', exact: true }).click();
    await expectFieldError(page, page.getByLabel('Recipient', { exact: true }), /name|recipient/i);
    await page.getByLabel('Recipient', { exact: true }).fill('AuditNinja');
    await page.getByLabel('Amount', { exact: true }).fill('1000');
    await page.getByRole('button', { name: 'Review & send', exact: true }).click();
    await expectFieldError(page, page.getByLabel('Recipient', { exact: true }), /yourself/i);
    await page.getByLabel('Recipient', { exact: true }).fill('RivalNinja');
    await page.getByLabel('Amount', { exact: true }).fill('500');
    await page.getByRole('button', { name: 'Review & send', exact: true }).click();
    await expectFieldError(page, page.getByLabel('Amount', { exact: true }), /minimum.*1,000/i);
    await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('500');
    await page.getByRole('button', { name: 'Review & send', exact: true }).scrollIntoViewIfNeeded();
    await capture(page, 'bank-wire-validation');
    await expect(page.getByRole('alertdialog', { name: 'Confirm', exact: true })).toHaveCount(0);
    expect(mutations).toBe(0);
});

test('Bank confirms accepted moves and refuses a stale character response', async ({ page }) => {
    const { save, runtime } = await bankFixture(page);
    let character = { ...save.character };
    let stale = false;
    let releaseFirst: (() => void) | undefined;
    const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
    const requests: Record<string, unknown>[] = [];
    await page.route('**/api/bank/transfer', async route => {
        const body = route.request().postDataJSON(); requests.push(body);
        if (requests.length === 1) await firstResponse;
        const delta = body.action === 'deposit' ? body.amount : -body.amount;
        const next = { ...character, ryo: Number(character.ryo) - delta, bankRyo: Number(character.bankRyo) + delta };
        const version = stale ? runtime.currentVersion() - 1 : runtime.currentVersion() + 1;
        if (!stale) { character = next; runtime.commitServerCharacter(character, version); }
        return route.fulfill({ json: { character: next, _saveVersion: version } });
    });
    await expectUiAuditBoot(page, runtime, 'bank');
    const amount = page.locator('#bank-transfer-amount');
    await amount.fill('500');
    await page.getByRole('button', { name: 'Deposit to vault', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect.poll(() => requests.length).toBe(1);
    await expect(page.getByRole('button', { name: 'Working…', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Withdraw to wallet', exact: true })).toBeDisabled();
    await expect(amount).not.toBeEditable();
    for (const name of ['Half wallet', 'Max wallet', 'Max vault']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
    await capture(page, 'bank-pending');
    releaseFirst!();
    await expect(amount).toHaveValue('0');
    await expect(amount).toBeEditable();
    await expect(page.locator('.bank-balance-rail')).toContainText('9,500');
    await expect(page.locator('.bank-balance-rail')).toContainText('20,500');
    await expect(page.locator('.game-toast-stack')).toContainText(/500.*ryo/i);
    await capture(page, 'bank-success');
    await amount.fill('300');
    await page.getByRole('button', { name: 'Withdraw to wallet', exact: true }).click();
    await expect(amount).toHaveValue('0');
    await expect(amount).toBeEditable();
    await expect(page.locator('.bank-balance-rail')).toContainText('9,800');
    await expect(page.locator('.bank-balance-rail')).toContainText('20,200');
    await expect(page.locator('.game-toast-stack')).toContainText(/300.*ryo/i);
    expect(requests.map(r => [r.action, r.direction, r.amount])).toEqual([['deposit', 'deposit', 500], ['withdraw', 'withdraw', 300]]);
    expect(requests[0].requestId).toBeTruthy();
    expect(requests[1].requestId).not.toBe(requests[0].requestId);
    await page.locator('.bank-screen').getByRole('button', { name: /Village/ }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'village');
    await page.getByRole('button', { name: 'Enter Bank', exact: true }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'bank');
    await expect(page.locator('.bank-balance-rail')).toContainText('20,200');
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'bank');
    await expect(page.locator('.bank-balance-rail')).toContainText('9,800');
    await expect(page.locator('.bank-balance-rail')).toContainText('20,200');
    stale = true;
    await amount.fill('137');
    await page.getByRole('button', { name: 'Deposit to vault', exact: true }).click();
    await expect.poll(() => requests.length).toBe(3);
    await expect(page.getByRole('button', { name: 'Deposit to vault', exact: true })).toBeEnabled();
    await expect(amount).toHaveValue('137');
    await expect(page.getByRole('alertdialog', { name: 'Notice', exact: true })).toContainText('Action unconfirmed. Refresh before retrying.');
    await dismissNotice(page);
    await expect(amount).toBeEditable();
    await expect(page.locator('.bank-balance-rail')).toContainText('20,200');
    await expect(page.locator('.game-toast-stack').filter({ hasText: '137' })).toHaveCount(0);
});

test('Bank keeps its receipt ID through refresh and a temporary rate limit', async ({ page }) => {
    const { save, runtime } = await bankFixture(page, { ryo: 500, bankRyo: 0 });
    const requests: Array<{ requestId: string; action: string; amount: number }> = [];
    const settled = { ...save.character, ryo: 0, bankRyo: 500 };
    let settledVersion = 0;
    await page.route('**/api/bank/transfer', async route => {
        const body = route.request().postDataJSON() as { requestId: string; action: string; amount: number };
        requests.push(body);
        if (requests.length === 1) {
            settledVersion = runtime.currentVersion() + 1;
            runtime.commitServerCharacter(settled, settledVersion);
            return route.abort('failed'); // the server committed, but its response was lost
        }
        if (requests.length === 2) return route.fulfill({ status: 429, json: { error: 'Too many requests. Retry shortly.' } });
        return route.fulfill({ json: { character: settled, _saveVersion: settledVersion, replayed: true } });
    });
    await expectUiAuditBoot(page, runtime, 'bank');
    const amount = page.locator('#bank-transfer-amount');
    await amount.fill('500');
    await page.getByRole('button', { name: 'Deposit to vault', exact: true }).click();
    await expect(page.getByRole('alertdialog', { name: 'Notice', exact: true })).toContainText('Action unconfirmed. Refresh before retrying.');
    await dismissNotice(page);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'bank');
    await expect(page.locator('.bank-balance-rail')).toContainText('500');
    await amount.fill('500');
    await page.getByRole('button', { name: 'Deposit to vault', exact: true }).click();
    await expect.poll(() => requests.length).toBe(2);
    // A rate-limit refusal only asks the player to wait, so it is a quiet toast
    // (lib/slow-down-notice.ts), never a modal the player must click through.
    await expect(page.locator('.game-toast-stack')).toContainText('Too many requests. Retry shortly.');
    await expect(page.getByRole('alertdialog', { name: 'Notice', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Deposit to vault', exact: true }).click();
    await expect.poll(() => requests.length).toBe(3);
    expect(requests.map(request => [request.action, request.amount, request.requestId])).toEqual([
        ['deposit', 500, requests[0].requestId],
        ['deposit', 500, requests[0].requestId],
        ['deposit', 500, requests[0].requestId],
    ]);
    await expect(amount).toHaveValue('0');
    await expect(page.locator('.game-toast-stack')).toContainText('Transfer already completed.');
    await expect(page.locator('.bank-balance-rail')).toContainText('500');
});

test('Bank distinguishes server rejection from uncertain responses without reporting success', async ({ page }) => {
    const { runtime } = await bankFixture(page);
    let mode = 'rejected', requests = 0;
    await page.route('**/api/bank/transfer', async route => {
        requests++;
        if (mode === 'rejected') return route.fulfill({ status: 400, json: { error: 'Not enough banked ryo.' } });
        if (mode === 'timeout') return route.fulfill({ status: 408, json: { error: 'timeout backend detail' } });
        if (mode === 'network') return route.abort('failed');
        if (mode === 'server') return route.fulfill({ status: 503, json: { error: 'temporary backend detail' } });
        return route.fulfill({ status: 200, contentType: 'application/json', body: 'not json' });
    });
    await expectUiAuditBoot(page, runtime, 'bank');
    const amount = page.locator('#bank-transfer-amount');
    await amount.fill('500');
    for (const response of ['rejected', 'timeout', 'network', 'server', 'malformed']) {
        mode = response;
        await page.getByRole('button', { name: 'Withdraw to wallet', exact: true }).click();
        await expect(page.locator('body')).toContainText(response === 'rejected' ? 'Not enough banked ryo.' : 'Action unconfirmed. Refresh before retrying.');
        await expect(amount).toHaveValue('500');
        await expect(page.locator('.bank-balance-rail')).toContainText('20,000');
        await expect(page.locator('.game-toast-stack')).toHaveCount(0);
        await capture(page, response === 'rejected' ? 'bank-rejected' : `bank-unconfirmed-${response}`);
        await dismissNotice(page);
    }
    expect(requests).toBe(5);
});

test('Bank announces confirmed interest without a blocking acknowledgement', async ({ page }) => {
    const { runtime } = await bankFixture(page);
    await page.route('**/api/bank/claim-interest', route => route.fulfill({ json: { ok: true, eligible: true, claimed: 100, bankRyo: 20100, lastBankInterestAt: Date.now() } }));
    await expectUiAuditBoot(page, runtime, 'bank');
    await page.getByRole('button', { name: 'Collect interest', exact: true }).click();
    await expect(page.locator('.bank-balance-rail')).toContainText('20,100');
    await expect(page.locator('.game-toast-stack')).toContainText(/interest.*100.*ryo/i);
    await expect(page.getByRole('alertdialog', { name: 'Notice', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Collect interest', exact: true })).toBeDisabled();
    await capture(page, 'bank-interest-success');
});

test('Bank keeps wire confirmation and retries an uncertain intent with the same nonce', async ({ page }) => {
    const { runtime } = await bankFixture(page);
    const requests: Record<string, unknown>[] = [];
    let confirmed = false;
    await page.route('**/api/player/trade', route => {
        requests.push(route.request().postDataJSON());
        return confirmed ? route.fulfill({ json: { ok: true, senderBalance: 9000, debit: 1000, credit: 900, burned: 100, toPlayer: 'RivalNinja' } }) : route.fulfill({ status: 503, json: {} });
    });
    await expectUiAuditBoot(page, runtime, 'bank');
    await page.getByLabel('Recipient', { exact: true }).fill('RivalNinja');
    await page.getByLabel('Amount', { exact: true }).fill('1000');
    const review = page.getByRole('button', { name: 'Review & send', exact: true });
    const confirm = page.getByRole('alertdialog', { name: 'Confirm', exact: true });
    await review.click();
    await expect(confirm).toContainText('RivalNinja');
    await expect(confirm).toContainText('900');
    await expect(confirm.getByRole('button', { name: 'Confirm', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(confirm.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(requests).toHaveLength(0);
    await review.click();
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.locator('body')).toContainText('Action unconfirmed. Refresh before retrying.');
    await expect(page.getByLabel('Recipient', { exact: true })).toHaveValue('RivalNinja');
    await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('1000');
    await expect(page.locator('.game-toast-stack')).toHaveCount(0);
    await dismissNotice(page);
    confirmed = true;
    await review.click();
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByLabel('Recipient', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('0');
    await expect(page.locator('.game-toast-stack')).toContainText(/Sent 1,000 Ryo to RivalNinja/);
    expect(requests).toHaveLength(2);
    expect(requests[0].nonce).toBeTruthy();
    expect(requests[1].nonce).toBe(requests[0].nonce);
    await capture(page, 'bank-wire-success');
});

async function keyboardTabTo(page: Page, selector: string) {
    for (let step = 0; step < 80; step++) {
        if (await page.locator(selector).evaluate(node => node === document.activeElement)) return;
        await page.keyboard.press('Tab');
    }
    throw new Error(`Keyboard could not reach ${selector}`);
}

test('Bank wire correction and cancellation work entirely from the keyboard', async ({ page }) => {
    const { runtime } = await bankFixture(page);
    let requests = 0;
    await page.route('**/api/player/trade', route => { requests++; return route.abort(); });
    await expectUiAuditBoot(page, runtime, 'bank');
    await expect(page.locator('#bank-recipient')).toBeVisible();
    await keyboardTabTo(page, '#bank-recipient');
    await page.keyboard.type('RivalNinja');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('500');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expectFieldError(page, page.locator('#bank-send-amount'), /minimum.*1,000/i);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('1000');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog', { name: 'Confirm', exact: true });
    await expect(dialog).toContainText('RivalNinja');
    await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review & send', exact: true })).toBeFocused();
    await expect(page.locator('#bank-recipient')).toHaveValue('RivalNinja');
    await expect(page.locator('#bank-send-amount')).toHaveValue('1000');
    expect(requests).toBe(0);
});

test('Bank wire freezes the submitted fields until a pending response settles', async ({ page }) => {
    const { runtime } = await bankFixture(page);
    let release: (() => void) | undefined;
    let success = false;
    const payloads: Record<string, unknown>[] = [];
    await page.route('**/api/player/trade', async route => {
        payloads.push(route.request().postDataJSON());
        await new Promise<void>(resolve => { release = resolve; });
        return success
            ? route.fulfill({ json: { ok: true, senderBalance: 9000, debit: 1000, credit: 900, burned: 100, toPlayer: 'RivalNinja' } })
            : route.fulfill({ status: 503, json: {} });
    });
    await expectUiAuditBoot(page, runtime, 'bank');
    const recipient = page.locator('#bank-recipient'), amount = page.locator('#bank-send-amount'), currency = page.locator('#bank-currency');
    await recipient.fill('RivalNinja');
    await amount.fill('1000');
    for (const accepted of [false, true]) {
        success = accepted;
        await page.getByRole('button', { name: 'Review & send', exact: true }).click();
        await page.getByRole('alertdialog', { name: 'Confirm', exact: true }).getByRole('button', { name: 'Confirm', exact: true }).click();
        await expect.poll(() => payloads.length).toBe(accepted ? 2 : 1);
        await expect(recipient).not.toBeEditable();
        await expect(amount).not.toBeEditable();
        await expect(currency).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Sending…', exact: true })).toBeDisabled();
        release!();
        await expect(page.getByRole('button', { name: 'Review & send', exact: true })).toBeEnabled();
        if (!accepted) {
            await expect(page.getByRole('alertdialog', { name: 'Notice', exact: true })).toContainText('Action unconfirmed. Refresh before retrying.');
            await dismissNotice(page);
            await expect(recipient).toHaveValue('RivalNinja');
            await expect(amount).toHaveValue('1000');
        } else {
            await expect(recipient).toHaveValue('');
            await expect(amount).toHaveValue('0');
        }
        await expect(recipient).toBeEditable();
        await expect(amount).toBeEditable();
        await expect(currency).toBeEnabled();
    }
    expect(payloads[1].nonce).toBe(payloads[0].nonce);
});

for (const state of [
    { name: 'upgrade', overrides: { villageUpgrades: { bank: 0 } }, reason: 'Upgrade required' },
    { name: 'deposit', overrides: { bankRyo: 0 }, reason: 'Deposit required' },
    { name: 'small deposit', overrides: { bankRyo: 1, villageUpgrades: { bank: 1 } }, reason: 'Deposit too small' },
]) test(`Bank explains unavailable interest for ${state.name}`, async ({ page }) => {
    const { runtime } = await bankFixture(page, state.overrides);
    let requests = 0;
    await page.route('**/api/bank/claim-interest', route => { requests++; return route.abort(); });
    await expectUiAuditBoot(page, runtime, 'bank');
    await expect(page.locator('.bank-interest-callout')).toContainText(state.reason);
    await expect(page.getByRole('button', { name: 'Collect interest', exact: true })).toBeDisabled();
    await expect(page.locator('.bank-interest-callout')).not.toContainText('Ready now');
    expect(requests).toBe(0);
});

test('Bank interest availability updates while the player is idle at full vitals', async ({ page }) => {
    const deadline = Date.now() + 8000;
    const { runtime } = await bankFixture(page, { lastBankInterestAt: deadline - 86400000 });
    await expectUiAuditBoot(page, runtime, 'bank');
    const collect = page.getByRole('button', { name: 'Collect interest', exact: true });
    await expect(collect).toBeDisabled();
    await expect(collect).toBeEnabled({ timeout: Math.max(1000, deadline - Date.now()) + 4000 });
    await expect(page.locator('.bank-interest-callout')).toContainText('Ready now');
});
