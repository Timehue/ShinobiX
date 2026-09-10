import { expect, test } from '@playwright/test';

test('failed simulation can retry without sealing another formation or leaking workers', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop');
    await page.route('**/*pet-rite.worker*', (route) => route.abort());
    await page.goto('/petvfx.html?rite=1&riteqa=1&petQuality=low', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Lock formation', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Unable to prepare the battle');
    await expect(page.getByRole('button', { name: 'Lock formation', exact: true })).toBeEnabled();
    await expect.poll(() => page.workers().length).toBe(0);
    await page.unroute('**/*pet-rite.worker*');
    await page.getByRole('button', { name: 'Lock formation', exact: true }).click();
    await expect(page.getByTestId('wfr-stage-curtain')).toHaveAttribute('data-stage-ready', 'true');
    await expect.poll(() => page.workers().length).toBe(0);
    await page.getByRole('button', { name: 'Leave the Warfront', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reopen Warfront' })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
});

test('leaving while the worker loads cancels the pending battle', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop');
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/*pet-rite.worker*', async (route) => { await held; await route.abort().catch(() => undefined); });
    await page.goto('/petvfx.html?rite=1&riteqa=1&petQuality=low', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Lock formation', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Preparing battle…' })).toBeDisabled();
    await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
    release?.();
    await expect(page.getByRole('button', { name: 'Reopen Warfront' })).toBeVisible();
    await expect.poll(() => page.workers().length).toBe(0);
    await expect(page.locator('canvas')).toHaveCount(0);
});

test('worker-backed spectator playback finishes the complete best-of-three match', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/petvfx.html?rite=1&autostart=1&seed=23&petQuality=low&ritespeed=30&riteqa=1&avian=1', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /The Rite is (yours|lost)/ })).toBeVisible({ timeout: 80_000 });
    const clashes = await page.locator('.wfr-recap li').count();
    expect(clashes).toBeGreaterThanOrEqual(2);
    expect(clashes).toBeLessThanOrEqual(3);
    await expect(page.locator('.wfr-result-line')).toContainText(/Clashes (2–[01]|[01]–2)/);
    await expect.poll(() => page.workers().length).toBe(0);
    expect(errors).toEqual([]);
});
