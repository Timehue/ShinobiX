import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { publicAchievementRecord } from '../../api/achievements/_public';

for (const evidence of ['receipts', 'permanent ledger'] as const) {
    test(`another player's existing profile displays every career badge from ${evidence}`, async ({ page }, testInfo) => {
        const base = uiAuditSave();
        const badges = [
            ['exam-genin', 'Field Proven'], ['exam-chunin', 'Trusted in the Field'],
            ['exam-jonin', "Veteran's Resolve"], ['exam-special-jonin', 'Service and Steel'],
        ];
        const rival = {
            ...base.character,
            examsPassed: evidence === 'receipts' ? ['genin', 'chunin', 'jonin', 'specialJonin'] : [],
            unlockedAchievements: evidence === 'permanent ledger' ? badges.map(([id]) => id) : [],
            nindo: 'Every journey leaves a record.',
        };
        const runtime = await installUiAuditRuntime(page, base);
        await page.route('**/api/player/roster', route => route.fulfill({ json: { players: [{
            name: 'RivalNinja', level: 85, village: 'Stormveil Village', specialty: 'Ninjutsu', online: true,
            character: { name: 'RivalNinja', level: 85, village: 'Stormveil Village', rankTitle: 'Special Jonin',
                nindo: rival.nindo, ...publicAchievementRecord(rival) }, eligiblePets: [],
        }] } }));
        await expectUiAuditBoot(page, runtime, 'village');
        const users = page.getByRole('button', { name: 'Users', exact: true }).filter({ visible: true });
        const menu = page.getByRole('button', { name: 'Menu', exact: true }).filter({ visible: true });
        await expect(users.or(menu).first()).toBeVisible();
        if (await users.count() === 0) await menu.click();
        await users.click();
        await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'userHub');
        await page.locator('.user-hub-row').filter({ hasText: 'RivalNinja' }).first().locator('.user-hub-name').click();
        await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'userView');
        await expect(page.getByText('Every journey leaves a record.', { exact: true })).toBeAttached();
        const tab = page.getByRole('button', { name: 'Achievements', exact: true });
        if (await tab.isVisible()) await tab.click();
        await page.locator('.achievements-panel').scrollIntoViewIfNeeded();
        for (const [id, name] of badges) {
            const badge = page.locator('.achievement-badge').filter({ has: page.getByText(name, { exact: true }) });
            await expect(badge).toBeVisible();
            await expect(badge).toHaveClass(/unlocked/);
            await expect.poll(() => badge.locator(`img[src="/badges/${id}.webp"]`).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(256);
            await badge.click();
            const detail = page.locator('.achievement-detail-card');
            await expect(detail.getByRole('heading', { name, exact: true })).toBeVisible();
            await expect.poll(() => detail.locator(`img[src="/badges/${id}.webp"]`).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(256);
            await page.keyboard.press('Escape');
            await expect(detail).toHaveCount(0);
        }
        await page.screenshot({ path: testInfo.outputPath('public-career-achievements.png') });
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    });
}

test('accepted work appears ahead of optional prestige and repeatable activity counts', async ({ page }) => {
    const base = uiAuditSave();
    const runtime = await installUiAuditRuntime(page, { ...base, acceptedMissionIds: ['fetch-d-supply-trail'], missionProgress: { 'fetch-d-supply-trail': 1 } });
    await expectUiAuditBoot(page, runtime, 'logbook');
    const assigned = page.getByRole('region', { name: 'Assigned missions' });
    await expect(assigned.getByText('D Rank Supply Trail Sweep', { exact: true })).toBeVisible();
    expect(await assigned.evaluate((node) => Boolean(node.compareDocumentPosition(document.querySelector('.logbook-board-overview')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await expect(assigned.getByRole('button', { name: 'Abandon' })).toBeEnabled();
});

test('the active advancement hold leads the Logbook and links to its requirements', async ({ page }, testInfo) => {
    const base = uiAuditSave();
    const runtime = await installUiAuditRuntime(page, { ...base, character: { ...base.character, level: 39, examsPassed: ['genin'], clan: null } });
    await expectUiAuditBoot(page, runtime, 'logbook');
    const priority = page.locator('.logbook-priority');
    await expect(priority.getByText('Chunin Advancement Exam', { exact: true })).toBeVisible();
    await expect(priority.getByText('Pass this exam to continue beyond level 39.', { exact: true })).toBeVisible();
    expect(await priority.evaluate((node) => Boolean(node.compareDocumentPosition(document.querySelector('[aria-label="Career record"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('logbook-priority.png') });
    await priority.getByRole('button', { name: 'Review milestone' }).click();
    const requirements = page.locator('#logbook-exam-chunin');
    await expect(requirements).toBeFocused();
    await expect(requirements.getByRole('button', { name: 'Requirements incomplete' })).toBeDisabled();
    await requirements.getByRole('button', { name: 'Go Clan' }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'clan');
});

test('career context points to the existing achievement gallery with working badge art', async ({ page }, testInfo) => {
    const base = uiAuditSave();
    const runtime = await installUiAuditRuntime(page, base);
    await expectUiAuditBoot(page, runtime, 'logbook');
    const career = page.getByRole('region', { name: 'Career record' });
    await expect(career.getByText(/Field Proven · Trusted in the Field/)).toBeVisible();
    await expect(page.locator('#logbook-exam-genin details')).not.toHaveAttribute('open', '');
    await expect(page.locator('.logbook-priority').getByText('An optional distinction', { exact: true })).toBeVisible();
    await career.getByRole('button', { name: 'View achievements' }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'profile');
    await expect(page.getByRole('heading', { name: 'Achievements', exact: true })).toBeInViewport();
    const badge = page.locator('.achievement-badge').filter({ has: page.getByText('Field Proven', { exact: true }) });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveClass(/unlocked/);
    await page.screenshot({ path: testInfo.outputPath('career-gallery.png') });
    await badge.click();
    const detail = page.locator('.achievement-detail-card');
    await expect(detail.getByText('Recognition of your career milestone.', { exact: true })).toBeVisible();
    await expect.poll(() => detail.locator('img[src="/badges/exam-genin.webp"]').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(256);
    await page.screenshot({ path: testInfo.outputPath('career-achievement.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('passing advancement celebrates the earned milestone with keyboard dismissal', async ({ page }, testInfo) => {
    const base = uiAuditSave();
    const save = { ...base, character: { ...base.character, level: 39, examsPassed: ['genin'], elements: ['Fire', 'Water'], element: 'Fire', clan: 'Emberfall', defeatedAiIds: ['builtin-ai-exam-proctor'] } };
    const runtime = await installUiAuditRuntime(page, save);
    await page.route('**/api/exams/pass', async (route) => {
        expect(route.request().postDataJSON().examKey).toBe('chunin');
        const character = { ...save.character, examsPassed: ['genin', 'chunin'] };
        runtime.commitServerCharacter(character, runtime.currentVersion());
        await route.fulfill({ json: { character } });
    });
    await expectUiAuditBoot(page, runtime, 'logbook');
    await page.locator('#logbook-exam-chunin').getByRole('button', { name: 'Pass Chunin Advancement Exam' }).click();
    const ceremony = page.getByRole('dialog', { name: 'Chunin advancement earned' });
    await expect(ceremony).toBeVisible();
    await expect(ceremony.getByText('Trusted in the Field', { exact: true })).toBeVisible();
    await expect.poll(() => ceremony.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(256);
    await page.screenshot({ path: testInfo.outputPath('chunin-ceremony.png') });
    await page.keyboard.press('Tab');
    await expect(ceremony.getByRole('button', { name: 'Return to Logbook' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(ceremony).toHaveCount(0);
    await expect(page.locator('#logbook-exam-chunin')).toBeFocused();
    await expect(page.locator('#logbook-exam-chunin')).toContainText('Passed');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
