import { expect, test, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function expectHitTarget(control: Locator) {
    await expect(control).toBeVisible();
    expect(await control.evaluate(element => {
        const r = element.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return r.width >= 44 && r.height >= 44 && (hit === element || element.contains(hit));
    })).toBe(true);
}

test('ready Scorpion race keeps Start and Graphics reachable; clock starts and pauses', async ({ page }, info) => {
    await page.addInitScript(() => localStorage.setItem('petRally.render.v1', 'economy'));
    await page.goto('/e2e/fixtures/rally-recovery.html');
    const start = page.getByRole('button', { name: 'Ready to race' });
    await expect(start).toBeEnabled();
    await expectHitTarget(start);
    await expectHitTarget(page.getByRole('combobox', { name: 'Race graphics' }));
    await page.screenshot({ path: info.outputPath('ready.png') });
    expect((await new AxeBuilder({ page }).include('.rally-intro-overlay').analyze()).violations).toEqual([]);
    const instructions = page.getByRole('region', { name: 'Race instructions' });
    await instructions.focus();
    await page.keyboard.press('End');
    await expectHitTarget(start);
    await start.click();
    await expect(page.getByRole('button', { name: 'Pause race' })).toBeEnabled();
    await expect.poll(() => page.getByRole('progressbar', { name: 'Race progress' }).getAttribute('value')).not.toBe('0');
    await page.getByRole('button', { name: 'Pause race' }).click();
    const progress = await page.getByRole('progressbar', { name: 'Race progress' }).getAttribute('value');
    await page.waitForTimeout(700);
    expect(await page.getByRole('progressbar', { name: 'Race progress' }).getAttribute('value')).toBe(progress);
    const resume = page.getByRole('button', { name: 'Continue race' });
    await expectHitTarget(resume);
    await resume.click();
    await expect.poll(() => page.getByRole('progressbar', { name: 'Race progress' }).getAttribute('value')).not.toBe(progress);
    await page.screenshot({ path: info.outputPath('racing.png') });
});

test('world toast expires despite 10 parent renders per second and has a keyboard close', async ({ page }, info) => {
    await page.goto('/e2e/fixtures/player-friction.html?toast');
    await expect(page.getByRole('status')).toContainText('The trail closes');
    const dismiss = page.getByRole('button', { name: 'Dismiss world update' });
    await expectHitTarget(dismiss);
    await page.screenshot({ path: info.outputPath('toast.png') });
    const bounds = await page.locator('.world-toast').boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(300);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect((await new AxeBuilder({ page }).include('.world-toast').analyze()).violations).toEqual([]);
    await expect(dismiss).toHaveCount(0, { timeout: 8500 });
    await page.getByRole('button', { name: 'Show update' }).click();
    await dismiss.focus();
    await page.keyboard.press('Enter');
    await expect(dismiss).toHaveCount(0);
});

test('Guild gates level 30 contracts at level 16 and explains independent rank and quota', async ({ page }, info) => {
    await page.goto('/e2e/fixtures/player-friction.html');
    await expect(page.getByRole('button', { name: 'Requires level 30' }).first()).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Accept Hunt' }).first()).toBeEnabled();
    await expect(page.getByText('23 / 23', { exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('still accept and track');
    await page.screenshot({ path: info.outputPath('guild.png'), fullPage: true });
    await page.goto('/e2e/fixtures/player-friction.html?level=30');
    await expect(page.getByText('Hunt the Shadow Panther', { exact: true })).toBeVisible();
    await expect(page.locator('.hunt-contract-card').filter({ hasText: 'Hunt the Shadow Panther' }).getByRole('button', { name: 'Accept Hunt' })).toBeEnabled();
    await page.goto('/e2e/fixtures/player-friction.html?rank=0');
    await expect(page.getByText('Requires Beast Slayer', { exact: false })).toBeVisible();
    await expect(page.getByText('Hunt the Shadow Panther', { exact: true })).toHaveCount(0);
});

test('hunt claim uses readable busy label and recovers after an unsuccessful response', async ({ page }) => {
    let release: () => void = () => {};
    await page.route('**/api/missions/hunt-trail', route => route.fulfill({ json: { ok: true, _saveVersion: 1, state: { claimable: true, targetDefeated: true, progress: 3 } } }));
    await page.route('**/api/missions/claim-mission', async route => {
        await new Promise<void>(resolve => { release = resolve; });
        await route.fulfill({ json: { ok: true, applied: false, reason: 'daily-limit' } });
    });
    page.on('dialog', dialog => void dialog.dismiss());
    await page.goto('/e2e/fixtures/player-friction.html?claim');
    await page.getByRole('button', { name: 'Claim Reward' }).click();
    const busy = page.getByRole('button', { name: 'Claiming...', exact: true });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute('aria-busy', 'true');
    release();
    await expect(page.getByRole('button', { name: 'Claim Reward' })).toBeEnabled();
});

test('daily cap is readable at 320x568 with the complete reset explanation', async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/e2e/fixtures/sector-hud.html?capped');
    const explore = page.getByRole('button', { name: 'Explore', exact: true });
    await expect(explore).toBeDisabled();
    await expectHitTarget(explore);
    await expect(explore).toContainText('Daily 100/100');
    await expect(explore).toHaveAccessibleDescription('Your daily exploration: 100/100 · Resets at midnight UTC');
    await expect(page.getByText('Shared sector pool: 1,475 explores left', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Sector Info/ }).click();
    await expect(page.getByText('Your daily exploration: 100/100 · Resets at midnight UTC', { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).include('.sector-hud').analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('daily-cap-320.png') });
});

test('daily explore cap keeps Hunt and richer-ground navigation available', async ({ page }, info) => {
    await page.goto('/e2e/fixtures/sector-hud.html?capped');
    await expect(page.getByRole('button', { name: 'Explore', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Explore', exact: true })).toContainText('Daily 100/100');
    await expect(page.getByRole('button', { name: 'Explore', exact: true })).toHaveAccessibleDescription('Your daily exploration: 100/100 · Resets at midnight UTC');
    await expect(page.getByText('Shared sector pool: 1,475 explores left', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Track Trail Beast' }).click();
    expect(await page.evaluate(() => window.sectorFixture.events)).toContain('hunt');
    expect(await page.evaluate(() => window.sectorFixture.events)).not.toContain('explore');
    await page.getByRole('button', { name: /^Sector Info/ }).click();
    await expect(page.getByText('Your daily exploration: 100/100 · Resets at midnight UTC', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close Sector Info', exact: true }).click();
    await page.screenshot({ path: info.outputPath('daily-cap.png') });
    await page.evaluate(() => window.sectorFixture.configure({ depleted: true }));
    await page.getByRole('button', { name: 'Find richer ground' }).click();
    expect(await page.evaluate(() => window.sectorFixture.events)).toContain('richer');
    await page.goto('/e2e/fixtures/sector-hud.html');
    await expect(page.getByRole('button', { name: 'Explore', exact: true })).toBeEnabled();
});
