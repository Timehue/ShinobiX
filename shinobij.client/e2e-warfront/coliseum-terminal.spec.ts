import { expect, test } from '@playwright/test';

test('a completed duel keeps a long winner name contained through settlement retry and re-entry', async ({ page }, testInfo) => {
    test.skip(!['desktop', 'phone'].includes(testInfo.project.name), 'desktop and phone cover this terminal-dialog workflow');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // This is the settlement/replay workflow gate. Use the shipped Performance
    // preset on software-rendered runners: playback deliberately advances at
    // most one simulation tick per rendered frame, so the default desktop
    // outline/post passes can take over 30 wall seconds to show 0:01. The
    // separate resource lifecycle matrix exercises all three graphics presets.
    await page.goto('/petvfx.html?duel=1&cine=1&quick=1&dueltick=5000&seed=20260601&settlementqa=1&petQuality=low', { waitUntil: 'domcontentloaded' });
    const dialog = page.getByRole('dialog', { name: /Pet Colosseum result/ });
    const qa = page.getByTestId('pet-settlement-qa');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    const title = page.getByTestId('pet-duel-result-title');
    await expect(title).toContainText('Guardhound');
    expect(await title.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(dialog.getByRole('button', { name: 'Exit', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Retry Gate Settlement' }).click();
    await expect(qa).toHaveAttribute('data-retries', '1');
    await expect(dialog.getByRole('status')).toContainText('Sealing');
    await expect(dialog.getByRole('button', { name: 'Exit', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Complete QA settlement' }).click();
    await expect(dialog.getByRole('button', { name: 'Return to Gate' })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`coliseum-result-${testInfo.project.name}.png`), animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Return to Gate' }).click();
    await expect(page.getByTestId('pet-duel-root')).toHaveCount(0);
    await expect(qa).toHaveAttribute('data-exits', '1');
    await page.getByRole('button', { name: 'Re-enter duel' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /Replay/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('pet-duel-root').locator('canvas')).toBeVisible();
    // Require actual playback near the beginning. Merely seeing Pause for one
    // frame also passed when Replay incorrectly restored terminal tick 5000.
    await expect(page.getByTestId('pet-duel-root').getByText(/^0:0[1-5]$/)).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('pet-duel-root').getByRole('button', { name: /Pause/ })).toBeVisible();
    await expect(qa).toHaveAttribute('data-retries', '1');
    await expect(qa).toHaveAttribute('data-exits', '1');
    expect(errors).toEqual([]);
});
