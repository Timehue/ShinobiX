import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

// This suite owns both viewports. Run it once rather than repeating the same
// layout matrix under every project in the general smoke configuration.
test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== 'chromium' || !['chromium-desktop', 'chromium-desktop-live'].includes(testInfo.project.name), 'The desktop Chromium project runs both viewport sizes.');
});

async function capture(page: Page, name: string) {
    if (!process.env.UX_AUDIT_PHASE) return;
    const directory = resolve('..', 'docs/audits/ux-journey-2026-09-13', process.env.UX_AUDIT_PHASE);
    mkdirSync(directory, { recursive: true });
    const filename = `${name}-${page.viewportSize()!.width}`;
    await page.screenshot({ path: resolve(directory, `${filename}.png`) });
    writeFileSync(resolve(directory, `${filename}.txt`), await page.locator('body').innerText());
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    test.describe(`${viewport.width}px player journeys`, () => {
        test.use({ viewport });

        test('training shows its stamina cost before starting', async ({ page }) => {
            const save = uiAuditSave();
            save.currentSector = 0;
            save.character = { ...save.character, stamina: 7 };
            const runtime = await installUiAuditRuntime(page, save);
            await expectUiAuditBoot(page, runtime, 'training');
            const start = page.getByRole('button', { name: /Start 15 Minutes/ });
            await start.scrollIntoViewIfNeeded();
            await capture(page, '15-training-cost');
            await expect(start).toContainText('5 stamina');
            const longSession = page.getByRole('button', { name: /Start 8 Hours/ });
            await expect(longSession).toBeDisabled();
            // Stamina regenerates while the page is open; the visible shortfall
            // must track it rather than assume the fixture's opening value.
            await expect(longSession).toContainText(/60 stamina · need \d+ more/);
        });

        test('collecting training leaves an announced receipt without an acknowledgement dialog', async ({ page }) => {
            const save = uiAuditSave();
            save.currentSector = 0;
            save.activeTraining = { token: 'ux-ready', stat: 'strength', statGain: 3, label: '15 Minutes Strength', durationMs: 900000, endsAt: Date.now() - 1000 };
            const runtime = await installUiAuditRuntime(page, save);
            await page.route('**/api/training/complete', async route => {
                const character = { ...save.character };
                const version = runtime.currentVersion() + 1;
                runtime.commitServerCharacter(character, version);
                return route.fulfill({ json: { granted: true, character, _saveVersion: version, activeTraining: null, applied: 3, overflow: 0, cap: 100 } });
            });
            await expectUiAuditBoot(page, runtime, 'training');
            await page.getByRole('button', { name: 'Collect Training', exact: true }).click();
            await expect(page.locator('.training-feedback[role="status"]')).toContainText('+3 Strength');
            await expect(page.getByRole('alertdialog', { name: 'Notice' })).toHaveCount(0);
            await expect(page.getByRole('button', { name: /Start 15 Minutes/ })).toBeEnabled();
            await capture(page, '21-training-receipt');
        });

        for (const screen of ['training', 'jutsuTraining']) {
            test(`${screen} respects server time on a device three minutes ahead`, async ({ page }) => {
                const save = uiAuditSave();
                save.currentSector = 0;
                const start = Date.now();
                if (screen === 'training') {
                    save.activeTraining = { token: 'ux-training', stat: 'strength', statGain: 3, label: '15 Minutes Strength', durationMs: 900000, endsAt: start + 90000 };
                } else {
                    save.activeJutsuTraining = { serverToken: 'ux-lesson', jutsuId: 'starter-universal-flicker', label: 'Flicker', fromLevel: 1, toLevel: 2, ryoCost: 3000, startedAt: start - 510000, endsAt: start + 90000, autoClaim: false };
                }
                const runtime = await installUiAuditRuntime(page, save);
                await page.addInitScript(() => {
                    const realNow = Date.now.bind(Date);
                    Date.now = () => realNow() + 180000;
                });
                await page.route('**/api/player/heartbeat', route => route.fulfill({ json: { serverNow: Date.now(), sectorMates: [], allPlayers: [] } }));
                await expectUiAuditBoot(page, runtime, screen);
                const session = page.locator(screen === 'training' ? '.training-screen .summary-box' : '.jutsu-session-card').first();
                await session.scrollIntoViewIfNeeded();
                await page.waitForTimeout(1200);
                await capture(page, `16-clock-${screen}`);
                const claim = session.getByRole('button', { name: screen === 'training' ? /Collect Training|Training…/ : /Claim jutsu level|Claim when ready/ });
                await expect(claim).toBeDisabled();
                await expect(session).not.toContainText(screen === 'training' ? 'Ready to collect!' : 'Lesson complete.');
                if (screen === 'jutsuTraining') await expect(session.getByRole('button', { name: /Finish now/ })).toContainText('1,000 ryo');
            });
        }

        test('an automatic discharge failure explains how to retry, then confirms recovery', async ({ page }) => {
            const save = uiAuditSave();
            save.currentSector = 0;
            save.character = { ...save.character, profession: 'vanguard', hp: 0, hospitalized: true, hospitalizedAt: Date.now() - 60000, hospitalizedUntil: Date.now() - 1000 };
            const runtime = await installUiAuditRuntime(page, save);
            let requests = 0;
            let allowDischarge = false;
            await page.route('**/api/player/heal', async route => {
                requests++;
                if (!allowDischarge) return route.fulfill({ status: 503, json: { error: 'Treatment service unavailable.' } });
                const character = { ...save.character, hp: save.character!.maxHp, hospitalized: false, hospitalizedUntil: 0, hospitalizedAt: 0 };
                const version = runtime.currentVersion() + 1;
                runtime.commitServerCharacter(character, version);
                return route.fulfill({ json: { character, _saveVersion: version, chargedRyo: 0 } });
            });
            await expectUiAuditBoot(page, runtime, 'hospital');
            await expect.poll(() => requests).toBeGreaterThan(0);
            await page.locator('.hospital-release-grid').scrollIntoViewIfNeeded();
            await page.waitForTimeout(1300);
            await capture(page, '17-hospital-retry');
            await expect(page.getByRole('alert')).toContainText(/check out free.*try again/i);
            const countAfterFailure = requests;
            await page.waitForTimeout(2200);
            expect(requests).toBe(countAfterFailure);
            allowDischarge = true;
            await page.getByRole('button', { name: 'Check out free', exact: true }).click();
            await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'village');
            await expect(page.locator('.game-toast-stack')).toContainText(/Discharged.*HP restored/i);
            await expect(page.locator('.stormveil-village-screen')).toBeVisible();
            await capture(page, '18-hospital-recovered');
        });

        test('the storage notice can be dismissed while Academy guidance is present', async ({ page }) => {
            const save = uiAuditSave();
            save.currentSector = 0;
            save.character = { ...save.character, level: 1, onboardingStep: 'training', profession: undefined, academyChecklistClaimed: false };
            const runtime = await installUiAuditRuntime(page, save);
            await page.addInitScript(() => localStorage.removeItem('shinobix:storage-notice-ack'));
            await expectUiAuditBoot(page, runtime, 'training');
            await expect(page.locator('.onboarding-coach-banner')).toBeVisible();
            const notice = page.getByRole('region', { name: 'Data storage notice' });
            await expect(notice).toBeVisible();
            if ((page.viewportSize()?.width ?? 0) < 800) {
                expect(await notice.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(100);
            }
            await capture(page, '19-academy-notice');
            const guideBounds = await page.locator('.onboarding-coach-banner').boundingBox();
            const noticeBounds = await notice.boundingBox();
            expect(guideBounds!.y + guideBounds!.height).toBeLessThanOrEqual(noticeBounds!.y);
            await notice.getByRole('button', { name: 'Got it', exact: true }).click({ timeout: 4000 });
            await expect(notice).toHaveCount(0);
            await expect(page.locator('.onboarding-coach-banner')).toBeVisible();
        });

        test('the Academy reward stays clear of its guide after resizing', async ({ page }) => {
            const save = uiAuditSave();
            save.currentSector = 0;
            save.character = { ...save.character, level: 1, onboardingStep: 'firstMission', academyTrialClaimed: false, academySparClaimed: true };
            const runtime = await installUiAuditRuntime(page, save);
            await expectUiAuditBoot(page, runtime, 'missions');
            const reward = page.getByRole('button', { name: 'Claim Academy Trial Reward' });
            const guide = page.locator('.onboarding-coach-banner');
            const sizes = [{ width: 1366, height: 768 }, { width: 390, height: 844 }, viewport]
                .filter((size, index, all) => index === 0 || size.width !== all[index - 1].width || size.height !== all[index - 1].height);
            for (const size of sizes) {
                await page.setViewportSize(size);
                await expect.poll(async () => {
                    const buttonBounds = await reward.boundingBox();
                    const guideBounds = await guide.boundingBox();
                    const hudBounds = await page.locator('.mobile-top-hud').boundingBox();
                    return Boolean(buttonBounds && guideBounds && buttonBounds.y >= (hudBounds?.height ? hudBounds.y + hudBounds.height : 0)
                        && buttonBounds.y + buttonBounds.height <= guideBounds.y - 8);
                }).toBe(true).catch(async error => {
                    console.log('Academy resize geometry', await reward.evaluate(element => {
                        const parents = [];
                        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                            const style = getComputedStyle(parent);
                            parents.push({ tag: parent.tagName, className: parent.className, top: parent.scrollTop, height: parent.clientHeight, content: parent.scrollHeight, overflow: style.overflowY, padding: style.paddingBottom });
                        }
                        return { viewport: [innerWidth, innerHeight], scrollY, target: element.getBoundingClientRect().toJSON(), guide: document.querySelector('.onboarding-coach-banner')?.getBoundingClientRect().toJSON(), parents };
                    }));
                    throw error;
                });
                await reward.click({ trial: true });
            }
            await capture(page, '23-academy-reward-clearance');
        });

        test('the loadout header reports the same usable slots as the loadout tab', async ({ page }) => {
            const save = uiAuditSave();
            save.currentSector = 0;
            save.character = { ...save.character, equippedJutsuIds: ['starter-universal-flicker'], jutsuMastery: [{ jutsuId: 'starter-universal-flicker', level: 1, xp: 0 }] };
            const runtime = await installUiAuditRuntime(page, save);
            await expectUiAuditBoot(page, runtime, 'profile');
            await page.locator('.profile-mobile-tabs').getByRole('button', { name: 'Jutsu', exact: true }).click();
            await capture(page, '20-loadout-slots');
            await expect(page.locator('.jutsu-workbench-heading strong')).toContainText('/ 12');
        });

        test('an empty jutsu loadout leads to the hall where techniques are learned', async ({ page }) => {
            const save = uiAuditSave();
            save.currentSector = 0;
            const runtime = await installUiAuditRuntime(page, save);
            await expectUiAuditBoot(page, runtime, 'profile');
            await page.locator('.profile-mobile-tabs').getByRole('button', { name: 'Jutsu', exact: true }).click();
            await capture(page, '22-empty-loadout');
            await page.getByRole('button', { name: 'Go to Jutsu Training Hall' }).click();
            await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'jutsuTraining');
        });
    });
}

for (const skew of [-180000, 180000]) {
    test(`automatic jutsu completion follows the server with ${skew}ms device drift`, async ({ page }) => {
        const save = uiAuditSave();
        save.currentSector = 0;
        const deadline = Date.now() + 6000;
        save.activeJutsuTraining = { serverToken: 'ux-auto', jutsuId: 'starter-universal-flicker', label: 'Flicker', fromLevel: 1, toLevel: 2, ryoCost: 3000, startedAt: deadline - 600000, endsAt: deadline, autoClaim: true };
        const runtime = await installUiAuditRuntime(page, save);
        await page.addInitScript(offset => {
            const realNow = Date.now.bind(Date);
            Date.now = () => realNow() + offset;
        }, skew);
        await page.route('**/api/player/heartbeat', route => route.fulfill({ json: { serverNow: Date.now(), sectorMates: [], allPlayers: [] } }));
        const requests: number[] = [];
        await page.route('**/api/training/jutsu-ryo', async route => {
            requests.push(Date.now());
            const character = { ...save.character, jutsuMastery: [{ jutsuId: 'starter-universal-flicker', level: 2, xp: 0 }] };
            const version = runtime.currentVersion() + 1;
            runtime.commitServerCharacter(character, version);
            await route.fulfill({ json: { ok: true, character, _saveVersion: version, activeJutsuTraining: null } });
        });
        await expectUiAuditBoot(page, runtime, 'village');
        await expect.poll(() => requests.length, { timeout: 10000 }).toBe(1);
        expect(requests[0]).toBeGreaterThanOrEqual(deadline - 100);
        expect(requests[0]).toBeLessThan(deadline + 2500);
    });
}
