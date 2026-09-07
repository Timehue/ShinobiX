import { expect, test, type Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { expectUiAuditBoot, installUiAuditRuntime } from './helpers/ui-audit-runtime';

test('slow mail reads do not overlap or replace another conversation', async ({ page }) => {
    await page.clock.install();
    const runtime = await installUiAuditRuntime(page);
    let delayed: Route | undefined;
    let delayedReads = 0;
    const currentMessages = [{ from: 'fast-ninja', to: 'AuditNinja', text: 'Current conversation', ts: Date.now() }];
    let sentTo = '';
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/messages?*', async route => {
        const partner = new URL(route.request().url()).searchParams.get('with');
        if (partner === 'slow-ninja') { delayedReads++; delayed = route; return; }
        return route.fulfill({ json: currentMessages });
    });
    await page.route('**/api/messages', route => {
        if (route.request().method() === 'POST') {
            const body = route.request().postDataJSON() as { to: string; text: string };
            sentTo = body.to;
            currentMessages.push({ from: 'AuditNinja', to: body.to, text: body.text, ts: Date.now() });
            return route.fulfill({ json: currentMessages });
        }
        return route.fulfill({ json: [
            { with: 'slow-ninja', lastText: 'Waiting for a reply', lastTs: Date.now(), unread: 0 },
            { with: 'fast-ninja', lastText: 'Ready to talk', lastTs: Date.now(), unread: 0 },
        ] });
    });
    await expectUiAuditBoot(page, runtime, 'messages');
    await page.getByRole('button', { name: /slow-ninja Waiting/ }).click();
    await expect.poll(() => delayedReads).toBe(1);
    // Longer than the 8s poll interval, shorter than the request timeout.
    await page.clock.fastForward(9_000);
    expect(delayedReads).toBe(1);
    const retired = delayed!.request();
    const aborted = page.waitForEvent('requestfailed', request => request === retired);
    await page.getByRole('button', { name: '← Inbox', exact: true }).click();
    await aborted;
    await page.getByRole('button', { name: /fast-ninja Ready/ }).click();
    await expect(page.getByText('Current conversation', { exact: true })).toBeVisible();
    // A transport may already have delivered bytes when cleanup runs. Returning
    // the retired response must never paint it under the new partner's name.
    await delayed!.fulfill({ json: [{ from: 'slow-ninja', to: 'AuditNinja', text: 'Retired conversation', ts: Date.now() }] });
    await expect(page.getByText('Retired conversation', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Current conversation', { exact: true })).toBeVisible();
    const reply = page.getByPlaceholder('Message fast-ninja…', { exact: true });
    await reply.fill('Still the right conversation');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Still the right conversation', { exact: true })).toBeVisible();
    await expect(reply).toHaveValue('');
    expect(sentTo).toBe('fast-ninja');
    expect(errors).toEqual([]);
});

test('Nindo edits keep the text and banner together through save and clear', async ({ page }) => {
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, 'profile');
    const editor = page.locator('.nindo-editor');
    const input = editor.locator('textarea');
    await input.fill('  Protect the village.  ');
    await editor.getByRole('button', { name: 'Ember', exact: true }).click();
    await expect(input).toHaveValue('  Protect the village.  ');
    await editor.getByRole('button', { name: 'Save Nindo', exact: true }).click();
    await expect(input).toHaveValue('Protect the village.');
    await expect(editor.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled();
    await expect.poll(() => {
        const state = runtime.lastCommit()?.postedState;
        return state ? JSON.parse(state).character.nindo : undefined;
    }).toBe('Protect the village.');
    expect(JSON.parse(runtime.lastCommit()!.postedState).character.nindoBg).toBe('ember');
    await editor.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(input).toHaveValue('');
    await expect(editor.getByRole('button', { name: 'None', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => {
        const state = runtime.lastCommit()?.postedState;
        return state ? JSON.parse(state).character.nindo : undefined;
    }).toBe('');
});

test('repeated archive visits release documents, listeners and detached UI', async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chromium exposes the DOM and heap counters used by this diagnostic.');
    test.setTimeout(90_000);
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, 'centralHub');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const session = await page.context().newCDPSession(page);
    const visit = async () => {
        await page.locator('.central-card').filter({ hasText: 'Ancient Archives' }).click();
        const archive = page.getByRole('dialog', { name: 'Ancient Archives' });
        await expect(archive).toBeVisible();
        await archive.getByRole('button', { name: /close/i }).first().click();
        await expect(archive).toBeHidden();
    };
    const measure = async () => {
        // A detached dialog can still be held until React's passive cleanup
        // runs. Sample after a paint and task boundary, not in that short gap.
        await page.evaluate(() => new Promise<void>(resolve => {
            requestAnimationFrame(() => setTimeout(resolve, 0));
        }));
        await session.send('HeapProfiler.collectGarbage');
        return {
            ...await session.send('Memory.getDOMCounters'),
            ...await session.send('Runtime.getHeapUsage'),
            liveElements: await page.locator('*').count(),
        };
    };
    // Warm the lazy route and its caches before comparing repeated use.
    for (let i = 0; i < 3; i++) await visit();
    const initial = await measure();
    for (let i = 0; i < 20; i++) await visit();
    const before = await measure();
    for (let i = 0; i < 20; i++) await visit();
    const after = await measure();
    const measurements = testInfo.outputPath('archive-resource-cycles.json');
    await writeFile(measurements, JSON.stringify({ cyclesPerWindow: 20, initial, before, after }, null, 2));
    await testInfo.attach('archive-resource-cycles.json', {
        path: measurements, contentType: 'application/json',
    });
    expect(after.documents).toBeLessThanOrEqual(before.documents);
    // A closed archive must not leave one modal tree or listener set per visit.
    // Compare successive 20-visit windows; initial captures delayed shell work
    // separately so a one-time mount is not mistaken for per-visit retention.
    expect(after.nodes - before.nodes).toBeLessThan(100);
    expect(after.jsEventListeners - before.jsEventListeners).toBeLessThan(10);
    expect(errors).toEqual([]);
    await session.detach();
});
