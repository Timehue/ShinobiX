import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { AMBIGUOUS_ACTION_MESSAGE } from '../src/lib/ambiguous-action';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

async function dismissStatNotice(page: Page, notice: Locator) {
    await expect(notice.getByRole('button', { name: 'OK', exact: true })).toBeFocused();
    const keyboardState = () => page.evaluate(() => ({
        activeElement: document.activeElement?.outerHTML,
        dialogs: Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).map(node => ({
            label: node.getAttribute('aria-label'), text: node.textContent,
        })),
        bodyOverflow: getComputedStyle(document.body).overflow,
        bodyInlineStyle: document.body.getAttribute('style'),
    }));
    const before = await keyboardState();
    await page.keyboard.press('Escape');
    try {
        await expect(notice).toHaveCount(0);
    } catch (error) {
        await test.info().attach('notice-keyboard-state', {
            body: JSON.stringify({ before, after: await keyboardState() }, null, 2),
            contentType: 'application/json',
        });
        throw error;
    }
}
type Failure = 'rejected' | 'network' | 'busy' | 'malformed';
async function failTraining(route: Route, failure: Failure, error: string) {
    if (failure === 'network') return route.abort('failed');
    if (failure === 'rejected') return route.fulfill({ status: 409, json: { error } });
    if (failure === 'busy') return route.fulfill({ status: 503, json: { error: 'Could not save training. Please retry.' } });
    return route.fulfill({ status: 200, json: {} });
}

function trainingSave() {
    const save = uiAuditSave();
    save.currentSector = 0;
    save.character = { ...save.character, ryo: 10_000 };
    return save;
}

for (const failure of ['rejected', 'network', 'busy', 'malformed'] as const) {
    test(`jutsu ${failure} feedback preserves the curriculum and request identity`, async ({ page }) => {
        const save = trainingSave();
        const runtime = await installUiAuditRuntime(page, save);
        const bodies: string[] = [];
        await page.route('**/api/training/jutsu-ryo', route => {
            bodies.push(route.request().postData() ?? '');
            return failTraining(route, failure, 'not-enough-ryo');
        });
        await expectUiAuditBoot(page, runtime, 'jutsuTraining');
        await expect(page.getByRole('heading', { name: 'Jutsu Training Hall', exact: true })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const plan = page.locator('.jutsu-plan-card');
        const start = plan.locator('.jutsu-start-action');
        await expect(start).toBeEnabled();
        const selected = await plan.getByRole('heading').innerText();
        await start.click();
        const notice = page.locator('.jutsu-notice[role="alert"]');
        await expect(notice).toContainText('Training needs attention');
        await expect(notice).toContainText(failure === 'rejected'
            ? 'You do not have enough ryo for that lesson.'
            : AMBIGUOUS_ACTION_MESSAGE);
        await expect(start).toBeEnabled();
        await expect(plan.getByRole('heading')).toHaveText(selected, { useInnerText: true });
        await expect(page.locator('.jutsu-hall-stats')).toContainText('10,000');
        await expect(page.locator('.jutsu-notice.success')).toHaveCount(0);
        expect(bodies).toHaveLength(failure === 'network' || failure === 'busy' ? 2 : 1);
        expect(new Set(bodies).size).toBe(1);
        await expect(notice).toBeInViewport({ ratio: 1 });
        await expect(notice.getByRole('button', { name: 'Dismiss training notice' })).toBeInViewport({ ratio: 1 });
        await notice.getByRole('button', { name: 'Dismiss training notice' }).click();
        await expect(notice).toHaveCount(0);
    });
}

const statCases = [
    { action: 'start', failure: 'rejected' },
    { action: 'start', failure: 'busy' },
    { action: 'collect', failure: 'network' },
    { action: 'cancel', failure: 'malformed' },
] as const;
for (const { action, failure } of statCases) {
    test(`stat ${action} ${failure} feedback preserves selection or the active session`, async ({ page }) => {
        const save = trainingSave();
        if (action !== 'start') {
            save.activeTraining = {
                token: 'training-feedback-token', stat: 'strength', statGain: 3,
                label: '15 Minutes Strength', durationMs: 900_000,
                endsAt: Date.now() + (action === 'collect' ? -1_000 : 600_000),
            };
        }
        const runtime = await installUiAuditRuntime(page, save);
        const requests: Array<Record<string, unknown>> = [];
        await page.route(`**/api/training/${action === 'start' ? 'start' : 'complete'}`, route => {
            requests.push(route.request().postDataJSON() as Record<string, unknown>);
            return failTraining(route, failure, 'Not enough stamina.');
        });
        await expectUiAuditBoot(page, runtime, 'training');
        await expect(page.getByRole('heading', { name: 'Training Grounds', exact: true })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const speed = page.getByRole('button', { name: /^Speed/ });
        await speed.click();
        const control = page.getByRole('button', { name: action === 'start'
            ? /Start 15 Minutes/
            : action === 'collect' ? 'Collect Training' : 'Cancel (keep prorated stats)', exact: action !== 'start' });
        await control.click();
        if (action === 'cancel') {
            const confirmation = page.getByRole('alertdialog', { name: 'Confirm', exact: true });
            await expect(confirmation).toContainText('Stamina already spent is not refunded.');
            expect(requests).toHaveLength(0);
            await confirmation.getByRole('button', { name: 'Confirm', exact: true }).click();
        }
        const notice = page.getByRole('alertdialog', { name: 'Notice', exact: true });
        await expect(notice).toContainText(failure === 'rejected' ? 'Not enough stamina.' : AMBIGUOUS_ACTION_MESSAGE);
        expect(requests).toHaveLength(1);
        if (action === 'start') expect(requests[0].stat).toBe('speed');
        else expect(requests[0].token).toBe('training-feedback-token');
        if (action === 'cancel') expect(requests[0].cancel).toBe(true);
        await dismissStatNotice(page, notice);
        await expect(control).toBeEnabled();
        await expect(speed).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.training-feedback')).toHaveCount(0);
        if (action !== 'start') await expect(page.locator('.training-screen .summary-box')).toContainText('15 Minutes Strength');
    });
}

for (const screen of ['training', 'jutsuTraining'] as const) {
    test(`${screen} stale settlement is announced and preserves the active session`, async ({ page }) => {
        const save = trainingSave();
        if (screen === 'training') {
            save.activeTraining = {
                token: 'stale-training-token', stat: 'strength', statGain: 3,
                label: '15 Minutes Strength', durationMs: 900_000, endsAt: Date.now() - 1_000,
            };
        } else {
            save.activeJutsuTraining = {
                serverToken: 'stale-jutsu-token', jutsuId: 'starter-universal-flicker', label: 'Flicker',
                fromLevel: 1, toLevel: 2, ryoCost: 3_000, startedAt: Date.now() - 901_000,
                endsAt: Date.now() - 1_000, autoClaim: false,
            };
        }
        const runtime = await installUiAuditRuntime(page, save);
        runtime.commitServerCharacter(save.character!, 40);
        let calls = 0;
        await page.route(`**/api/training/${screen === 'training' ? 'complete' : 'jutsu-ryo'}`, route => {
            calls++;
            return route.fulfill({ json: {
                granted: true, character: { ...save.character, ryo: 1 }, _saveVersion: 39,
                activeTraining: null, activeJutsuTraining: null, applied: 3, overflow: 0,
            } });
        });
        await expectUiAuditBoot(page, runtime, screen);
        const control = page.getByRole('button', { name: screen === 'training' ? 'Collect Training' : 'Claim jutsu level', exact: true });
        await expect(control).toBeEnabled();
        await control.click();
        const notice = screen === 'training'
            ? page.getByRole('alertdialog', { name: 'Notice', exact: true })
            : page.locator('.jutsu-notice[role="alert"]');
        await expect(notice).toContainText(AMBIGUOUS_ACTION_MESSAGE);
        expect(calls).toBe(1);
        if (screen === 'training') {
            await dismissStatNotice(page, notice);
            await expect(page.locator('.training-screen .summary-box')).toContainText('15 Minutes Strength');
            await expect(page.locator('.training-feedback')).toHaveCount(0);
        } else {
            await expect(notice).toContainText('Training needs attention');
            await expect(notice).toBeInViewport({ ratio: 1 });
            await expect(notice.getByRole('button', { name: 'Dismiss training notice' })).toBeInViewport({ ratio: 1 });
            await expect(page.locator('.jutsu-session-card')).toContainText('Flicker');
            await expect(page.locator('.jutsu-hall-stats')).toContainText('10,000');
            await expect(page.locator('.jutsu-notice.success')).toHaveCount(0);
        }
        await expect(control).toBeEnabled();
    });
}
