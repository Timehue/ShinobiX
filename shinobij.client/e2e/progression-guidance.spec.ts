import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test('advancement requirements are visible before the hold without enabling a pass', async ({ page }) => {
    const base = uiAuditSave();
    const runtime = await installUiAuditRuntime(page, { ...base, character: { ...base.character, level: 30, examsPassed: ['genin'] } });
    await expectUiAuditBoot(page, runtime, 'logbook');
    const exam = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Chunin Advancement Exam', exact: true }) });
    await expect(exam.getByText('Upcoming — prepare now', { exact: true })).toBeVisible();
    await expect(exam.getByRole('button', { name: 'Opens at level 39' })).toBeDisabled();
    await expect(exam.getByRole('button', { name: 'Go Clan' })).toBeVisible();
    await exam.getByRole('button', { name: 'Go Clan' }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'clan');
});

test('clan contributions count toward the visible Chunin exam total', async ({ page }) => {
    const base = uiAuditSave();
    const runtime = await installUiAuditRuntime(page, {
        ...base,
        character: {
            ...base.character,
            level: 39,
            examsPassed: ['genin'],
            elements: ['Fire', 'Water'],
            element: 'Fire',
            totalMissionsCompleted: 0,
            clanMissionContrib: 50,
            totalTilesExplored: 100,
            clan: 'Emberfall',
            defeatedAiIds: ['builtin-ai-exam-proctor'],
        },
    });
    await expectUiAuditBoot(page, runtime, 'logbook');
    const exam = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Chunin Advancement Exam', exact: true }) });
    await expect(exam.getByRole('heading', { name: /Complete 50 missions/ })).toBeVisible();
    await expect(exam.getByText('50/50', { exact: false })).toBeVisible();
    await expect(exam.getByRole('button', { name: 'Pass Chunin Advancement Exam' })).toBeEnabled();
});

test('mission reward guidance distinguishes ryo claims from the shared growth budget', async ({ page }) => {
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, 'missions');
    await page.getByRole('tab', { name: 'Combat', exact: true }).click();
    await page.getByText('How rewards grow your shinobi', { exact: true }).click();
    await expect(page.getByText('Eligible AI and player wins share 18 combat stat points per UTC day.', { exact: true })).toBeVisible();
    await expect(page.getByText(/Their mission claim does not award combat-growth points/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('a completed first assignment offers a concrete next goal and follows its destination', async ({ page }) => {
    const base = uiAuditSave();
    const firstContract = { version: 1, source: 'skip', route: 'combat', offeredAt: Date.now(), completedAt: Date.now() };
    const save = { ...base, currentSector: 0, character: { ...base.character, level: 10, examsPassed: [], totalAiKills: 1, firstContract } };
    const runtime = await installUiAuditRuntime(page, save);
    await page.route('**/api/player/academy-narrative', async (route) => {
        expect(route.request().postDataJSON().action).toBe('contract-acknowledge');
        const character = { ...save.character, firstContract: { ...firstContract, acknowledgedAt: Date.now() } };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(character, version);
        await route.fulfill({ json: { character, _saveVersion: version } });
    });
    await expectUiAuditBoot(page, runtime, 'village');
    await page.locator('.fc-ribbon button').click();
    const journal = page.getByRole('dialog', { name: 'First Contract field journal' });
    await expect(journal.getByText('Next goal: First Steps as a Shinobi', { exact: true })).toBeVisible();
    await expect(journal.getByText(/Win 3 AI battles: 1\/3/)).toBeVisible();
    await journal.getByRole('button', { name: 'Go Combat', exact: true }).click();
    await expect(journal).toHaveCount(0);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'missions');
    await expect(page.getByRole('tab', { name: 'Combat', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('the return journal opens its saved next goal on the right Mission Hall tab', async ({ page }) => {
    const base = uiAuditSave();
    const yesterday = Date.now() - 86_400_000;
    const firstContract = { version: 1, source: 'skip', route: 'combat', offeredAt: yesterday, completedAt: yesterday, acknowledgedAt: yesterday };
    const save = { ...base, currentSector: 0, character: { ...base.character, level: 3, examsPassed: [], totalAiKills: 1, totalMissionsCompleted: 0, firstContract } };
    const runtime = await installUiAuditRuntime(page, save);
    await page.route('**/api/player/academy-narrative', async (route) => {
        expect(route.request().postDataJSON().action).toBe('contract-return');
        const character = { ...save.character, firstContract: { ...firstContract, returnedAt: Date.now() } };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(character, version);
        await route.fulfill({ json: { character, _saveVersion: version } });
    });
    await expectUiAuditBoot(page, runtime, 'village');
    await page.locator('.fc-ribbon').getByRole('button', { name: 'Continue' }).click();
    const journal = page.getByRole('dialog', { name: 'First Contract field journal' });
    await expect(journal.getByText(/Win 3 AI battles: 1\/3/)).toBeVisible();
    await journal.getByRole('button', { name: 'Go Combat' }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'missions');
    await expect(page.getByRole('tab', { name: 'Combat', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('profession choice explains the switching cost and reset before committing', async ({ page }) => {
    const base = uiAuditSave();
    const runtime = await installUiAuditRuntime(page, { ...base, currentSector: 0, character: { ...base.character, level: 13, profession: null } });
    await expectUiAuditBoot(page, runtime, 'village');
    const picker = page.locator('.pp-root');
    await picker.getByRole('button', { name: /Continue/ }).click();
    await expect(picker.getByText(/base 200 Fate Shards.*resets profession rank, XP, and mastery/)).toBeVisible();
    await picker.getByRole('button', { name: /Walk the Healer's path/ }).click();
    await expect(picker.getByText(/base price is 200 Fate Shards/)).toBeVisible();
    await expect(picker.getByText(/Changes from level 20 require a Profession Change Scroll from the Grand Marketplace/)).toBeVisible();
    await expect(picker.getByText(/Each change consumes the scroll and resets profession rank, XP, and mastery/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
