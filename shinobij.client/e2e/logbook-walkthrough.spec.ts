import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

const stages = [
    { id: 'early-career', character: { level: 10, rankTitle: 'Academy Student', examsPassed: [], profession: null, totalMissionsCompleted: 4, totalAiKills: 3, totalStatsTrained: 40 } },
    { id: 'advancement-hold', character: { level: 39, rankTitle: 'Chunin', examsPassed: ['genin'], clan: null, elements: ['Fire', 'Water'], element: 'Fire' } },
    { id: 'veteran', character: { examsPassed: ['genin', 'chunin', 'jonin', 'specialJonin'], profession: 'petTamer', professionRank: 5 } },
    { id: 'legacy', character: { level: 10, rankTitle: 'Academy Student', examsPassed: [], unlockedAchievements: ['exam-genin', 'exam-chunin', 'exam-jonin', 'exam-special-jonin'], legacy: { legacyId: 'storm-born', stage: 1, eraBorn: 2, acceptedAt: 1, titles: [] } } },
];

for (const stage of stages) {
    test(`${stage.id}: next goal and career record remain readable and connected`, async ({ page }, testInfo) => {
        const base = uiAuditSave();
        const runtime = await installUiAuditRuntime(page, { ...base, character: { ...base.character, ...stage.character } });
        await expectUiAuditBoot(page, runtime, 'logbook');
        const priority = page.locator('.logbook-priority');
        await expect(priority).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('next-goal.png') });
        const review = priority.getByRole('button', { name: 'Review milestone' });
        if (await review.count()) {
            await review.click();
            await expect(page.locator('[id^="logbook-"][tabindex="-1"]:focus')).toBeVisible();
            await page.screenshot({ path: testInfo.outputPath('milestone-requirements.png') });
            if (stage.id === 'early-career') {
                await page.locator('.logbook-chapter-card.active').getByRole('button', { name: 'Go jutsu', exact: true }).click();
                await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'jutsuTraining');
                await page.screenshot({ path: testInfo.outputPath('next-action.png') });
                const logbook = page.getByRole('button', { name: 'Logbook', exact: true }).filter({ visible: true });
                if (await logbook.count() === 0) await page.getByRole('button', { name: 'Menu', exact: true }).filter({ visible: true }).click();
                await logbook.click();
                await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'logbook');
            }
        }
        const career = page.getByRole('region', { name: 'Career record' });
        await career.scrollIntoViewIfNeeded();
        await expect(career).toBeVisible();
        const heading = career.getByRole('heading', { name: 'Career Record', exact: true });
        expect(await heading.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(35);
        expect(await career.locator('p').first().evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(13);
        if (stage.id === 'veteran') {
            await expect(career.getByText('Profession: Pet Tamer · Rank 5', { exact: true })).toBeVisible();
            const passedExam = page.locator('#logbook-exam-chunin');
            await expect(passedExam).toContainText('Passed · Trusted in the Field');
            await expect(passedExam).not.toContainText('Progression hold');
            await passedExam.getByText('Review exam requirements', { exact: true }).click();
            await expect(passedExam.getByText(/This milestone is already earned; you do not need to repeat/)).toBeVisible();
            await expect(passedExam.getByRole('button')).toHaveCount(0);
            await page.screenshot({ path: testInfo.outputPath('earned-requirements.png') });
            await passedExam.getByText('Review exam requirements', { exact: true }).click();
            await career.scrollIntoViewIfNeeded();
        }
        await page.screenshot({ path: testInfo.outputPath('career-record.png') });
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
        await career.getByRole('button', { name: 'View achievements' }).click();
        await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'profile');
        await expect(page.getByRole('heading', { name: 'Achievements', exact: true })).toBeInViewport();
        if (stage.id === 'legacy' || stage.id === 'veteran') {
            for (const name of ['Field Proven', 'Trusted in the Field', "Veteran's Resolve", 'Service and Steel']) {
                const badge = page.locator('.achievement-badge').filter({ has: page.getByText(name, { exact: true }) });
                await expect(badge).toHaveClass(/unlocked/);
            }
        }
        await page.screenshot({ path: testInfo.outputPath('achievement-gallery.png') });
    });
}
