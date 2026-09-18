import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

let javascript: string;
test.beforeAll(async () => {
    const result = await build({ entryPoints: [resolve('e2e/helpers/activity-guidance-harness.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
        define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'false', 'import.meta.env': '{}' } });
    javascript = result.outputFiles[0].text;
});
type HarnessWindow = Window & { guidanceRequests(): number; settleGuidance(index: number, title: string, fail?: boolean, gates?: string[]): void };
const count = (page: Page) => page.evaluate(() => (window as HarnessWindow).guidanceRequests());
const settle = (page: Page, index: number, title: string, fail = false, gates?: string[]) => page.evaluate(({ index, title, fail, gates }) => (window as HarnessWindow).settleGuidance(index, title, fail, gates), { index, title, fail, gates });
test.beforeEach(async ({ page }) => {
    await page.route('**/activity-guidance-harness', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script src="/guidance-harness.js"></script>' }));
    await page.route('**/guidance-harness.js', route => route.fulfill({ contentType: 'text/javascript', body: javascript }));
    await page.goto('/activity-guidance-harness');
    await expect.poll(() => count(page)).toBe(1);
});

test('an old request cannot overwrite new source readiness, and HP ticks do not refetch', async ({ page }) => {
    await page.getByRole('button', { name: 'Complete chapter' }).click();
    await expect.poll(() => count(page)).toBe(2);
    await settle(page, 1, 'New chapter state');
    await expect(page.getByText('New chapter state')).toBeVisible();
    await settle(page, 0, 'Old chapter state');
    await expect(page.getByText('Old chapter state')).toHaveCount(0);
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Regen tick' }).click();
    await page.waitForTimeout(400);
    expect(await count(page)).toBe(2);
});

test('account switch immediately hides prior readiness; a failed refresh never displays it as fresh', async ({ page }) => {
    await settle(page, 0, 'First account');
    await expect(page.getByText('First account')).toBeVisible();
    await page.getByRole('button', { name: 'Switch account' }).click();
    await expect(page.getByText('First account')).toHaveCount(0);
    await expect.poll(() => count(page)).toBe(2);
    await settle(page, 1, 'Second account', true);
    await expect(page.getByText('Current priorities could not be loaded.')).toBeVisible();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => count(page)).toBe(3);
    await settle(page, 2, 'Second account');
    await expect(page.getByText('Second account')).toBeVisible();
});

test('a successful authoritative mutation refreshes once; unchanged autosaves do not loop', async ({ page }) => {
    await settle(page, 0, 'Before collection');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('shinobix:save-version', { detail: { accountName: 'First', version: 2, source: 'mutation' } })));
    await expect.poll(() => count(page)).toBe(2);
    await settle(page, 1, 'After collection');
    await expect(page.getByText('After collection')).toBeVisible();
    for (let version = 3; version <= 8; version++) await page.evaluate(version => window.dispatchEvent(new CustomEvent('shinobix:save-version', { detail: { accountName: 'First', version, source: 'full-save' } })), version);
    await page.waitForTimeout(600);
    expect(await count(page)).toBe(2);
});

test('empty capability projections and pauses keep navigation inert', async ({ page }) => {
    await settle(page, 0, 'Missing gates', false, []);
    await expect(page.getByRole('button', { name: 'Visit Clan Hall' })).toBeDisabled();
    await page.getByRole('button', { name: 'Complete chapter' }).click();
    await expect.poll(() => count(page)).toBe(2);
    await settle(page, 1, 'Ready gates');
    await expect(page.getByRole('button', { name: 'Visit Clan Hall' })).toBeEnabled();
    await page.getByRole('button', { name: 'Pause operations' }).click();
    await expect.poll(() => count(page)).toBe(3);
    await settle(page, 2, 'Paused gates');
    await expect(page.getByRole('button', { name: 'Visit Clan Hall' })).toBeDisabled();
    await expect(page.getByTestId('destination')).toHaveText('');
});

test('capabilities expiring after render are rechecked at the click boundary', async ({ page }) => {
    await settle(page, 0, 'Ready before idle');
    const button = page.getByRole('button', { name: 'Visit Clan Hall' });
    await expect(button).toBeEnabled();
    await page.getByRole('button', { name: 'Expire without render' }).click();
    await button.click();
    await expect(page.getByTestId('destination')).toHaveText('');
});

test('mounted section requests apply once and preserve subsequent manual choices', async ({ page }) => {
    await page.getByRole('button', { name: 'Open mounted Legacy' }).click();
    await expect(page.getByTestId('section')).toHaveText('legacy');
    expect(await page.evaluate(() => sessionStorage.getItem('profile.initialTab'))).toBeNull();
    await page.getByRole('button', { name: 'Choose overview' }).click();
    await page.getByRole('button', { name: 'Regen tick' }).click();
    await expect(page.getByTestId('section')).toHaveText('overview');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('shinobix:activity-section', { detail: { key: 'profile.initialTab', section: 'invalid-tab' } })));
    await expect(page.getByTestId('section')).toHaveText('overview');
});
