import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test('controller can enter Card Clash from the live Dojo Circuit without touch input', async ({ page }) => {
    const now = Date.now();
    let startBody: Record<string, unknown> | null = null;
    const save = uiAuditSave();
    save.character = { ...save.character, starterCardsClaimed: true };
    const runtime = await installUiAuditRuntime(page, save);
    await page.addInitScript(() => {
        const pad = {
            id: 'Standard test controller', index: 0, mapping: 'standard', connected: true, timestamp: 0,
            axes: [0, 0],
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
        (window as Window & { dojoTestGamepad?: typeof pad }).dojoTestGamepad = pad;
    });

    const entrant = { id: 'qa-controller', name: 'AuditNinja', village: 'Stormveil Village', joinedAt: now - 30_000, seals: [] };
    const initial = {
        enabled: true,
        event: {
            id: 'qa-live-circuit', name: 'Lantern Trials', startsAt: now - 60_000, endsAt: now + 3_600_000,
            createdAt: now - 3_600_000, featured: 'combat', entrants: [entrant],
        },
        history: [], serverNow: now, attempt: null,
    };
    await page.route('**/api/dojo-circuit/event*', async (route) => {
        if (route.request().method() === 'POST') {
            startBody = route.request().postDataJSON() as Record<string, unknown>;
            await route.fulfill({ json: { ...initial, attempt: { discipline: 'cards', openedAt: now } } });
            return;
        }
        await route.fulfill({ json: initial });
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await expectUiAuditBoot(page, runtime, 'dojoCircuit');
    await expect(page.locator('html')).toHaveAttribute('data-gamepad-connected', 'true');

    const trialCards = page.locator('.dc-trial-card');
    await expect(trialCards).toHaveCount(3);
    await trialCards.nth(0).focus();
    const press = async (index: number) => {
        await page.evaluate(async (buttonIndex) => {
            const pad = (window as Window & { dojoTestGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).dojoTestGamepad;
            const sampledFrames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            pad.buttons[buttonIndex] = { pressed: true, value: 1 };
            // The production controller polls on RAF. Keep both edges present
            // for sampled frames, including while the Card Hall mounts.
            await sampledFrames();
            pad.buttons[buttonIndex] = { pressed: false, value: 0 };
            await sampledFrames();
        }, index);
    };

    await press(15); // D-pad right: Shinobi Combat -> Card Clash.
    await expect(trialCards.nth(1)).toBeFocused();
    await press(0); // A: open the Card Clash briefing.
    const briefing = page.getByRole('region', { name: 'Card Clash briefing' });
    await expect(briefing).toBeVisible();
    const enterTrial = briefing.getByRole('button', { name: 'Enter this trial' });
    // Opening a briefing with a controller hands focus to its action and scrolls it into view.
    await expect(enterTrial).toBeFocused();
    await expect(enterTrial).toBeInViewport();
    await press(0); // A: begin the server-confirmed trial.

    await expect.poll(() => startBody).toMatchObject({ action: 'begin', discipline: 'cards', eventId: 'qa-live-circuit' });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'shinobiTiles');
    const tutorial = page.getByRole('dialog', { name: 'Shinobi Chronicle Showdown tutorial' });
    await expect(tutorial).toBeVisible();
    await expect(tutorial.getByRole('button', { name: 'Enter the Card Hall' })).toBeFocused();
    await press(0);
    await expect(tutorial).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Shinobi Chronicle Showdown/ })).toBeVisible();
});
