import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test.use({ contextOptions: { reducedMotion: 'no-preference' } });

test.beforeEach(({ browserName }, info) => {
    test.skip(browserName !== 'chromium' || !['chromium-desktop', 'chromium-desktop-live'].includes(info.project.name), 'This suite owns its viewport matrix.');
});

for (const viewport of [{ width: 360, height: 640 }, { width: 844, height: 390 }, { width: 979, height: 768 }, { width: 980, height: 768 }]) {
    test(`Academy guide clears notices and navigation at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        const save = uiAuditSave();
        save.currentSector = 0;
        save.character = { ...save.character, level: 1, onboardingStep: 'training', profession: undefined, academyChecklistClaimed: false };
        const runtime = await installUiAuditRuntime(page, save);
        await page.addInitScript(() => localStorage.removeItem('shinobix:storage-notice-ack'));
        await expectUiAuditBoot(page, runtime, 'training');
        const guide = page.locator('.onboarding-coach-banner');
        const notice = page.locator('.storage-notice');
        await expect(guide).toBeVisible();
        await expect(guide.locator('.coach-guide-line')).toContainText('We can keep moving while it runs.');
        await page.waitForTimeout(600);
        const evidence = resolve('..', 'docs/audits/ux-journey-2026-09-13', process.env.UX_AUDIT_PHASE ?? 'recheck');
        mkdirSync(evidence, { recursive: true });
        await page.screenshot({ path: resolve(evidence, `26-shell-${viewport.width}x${viewport.height}.png`) });
        const guideBox = (await guide.boundingBox())!;
        const noticeBox = (await notice.boundingBox())!;
        const target = page.locator('.academy-click-target[data-academy-autoscroll="true"]').first();
        const targetBox = await target.boundingBox();
        writeFileSync(resolve(evidence, `26-shell-${viewport.width}x${viewport.height}.json`), JSON.stringify({ guideBox, noticeBox, targetBox }, null, 2));
        expect(guideBox.y + guideBox.height, 'The guide must not cover the storage notice').toBeLessThanOrEqual(noticeBox.y);
        expect(guideBox.y, 'Guide starts inside the viewport').toBeGreaterThanOrEqual(0);
        const hudBox = await page.locator('.mobile-top-hud').boundingBox();
        expect(targetBox!.y, 'The highlighted action must be below the HUD').toBeGreaterThanOrEqual(hudBox?.height ? hudBox.y + hudBox.height : 0);
        expect(targetBox!.y + targetBox!.height, 'The highlighted action must be above the guide').toBeLessThanOrEqual(guideBox.y - 8);
        await target.click({ trial: true });
        const skip = guide.getByRole('button', { name: 'Skip', exact: true });
        await expect(skip).toBeInViewport({ ratio: 1 });
        await skip.click({ trial: true });
        await notice.getByRole('button', { name: 'Got it', exact: true }).click();
        await expect(notice).toHaveCount(0);
        const navBox = await page.locator('.mobile-bottom-nav').boundingBox();
        if (navBox?.height) {
            await expect.poll(async () => {
                const bounds = (await guide.boundingBox())!;
                return bounds.y + bounds.height;
            }, { message: 'The guide must not cover navigation after the notice is dismissed' }).toBeLessThanOrEqual(navBox.y);
        }
    });
}
